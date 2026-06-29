const request = require('supertest');
const mongoose = require('mongoose');
const createApp = require('../src/app');
const User = require('../src/models/User');
const ModelMetadata = require('../src/models/ModelMetadata');
const redisCache = require('../src/config/redis');

const app = createApp();
const TEST_DB = process.env.MONGODB_URI_TEST || 'mongodb://localhost:27017/ml_serving_test_billing';

describe('Token/Character Usage Billing Tests', () => {
  let redisGetSpy;
  let redisSetSpy;

  beforeAll(async () => {
    await mongoose.connect(TEST_DB);

    // Bypass Redis cache to test direct DB behavior
    redisGetSpy = jest.spyOn(redisCache, 'get').mockResolvedValue(null);
    redisSetSpy = jest.spyOn(redisCache, 'set').mockResolvedValue(undefined);
  });

  afterAll(async () => {
    redisGetSpy.mockRestore();
    redisSetSpy.mockRestore();
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    await User.deleteMany({});
    await ModelMetadata.deleteMany({});

    // Seed models
    await ModelMetadata.insertMany([
      { version: 'v1', modelType: 'sentiment', trafficWeight: 1.0, isActive: true },
      { version: 'v2', modelType: 'sentiment', trafficWeight: 0.0, isActive: true },
    ]);
  });

  const registerAndGetKey = async (monthlyUsageBudget = 50) => {
    // 1. Register
    const regRes = await request(app)
      .post('/api/v1/auth/register')
      .send({ name: 'Bill User', email: 'bill@example.com', password: 'Password1' });
    const token = regRes.body.data.token;

    // 2. Generate API Key with custom budget
    const keyRes = await request(app)
      .post('/api/v1/auth/api-key')
      .set('Authorization', `Bearer ${token}`)
      .send({ scopes: ['*'], rateLimit: 100, monthlyUsageBudget });
    
    return keyRes.body.data.apiKey;
  };

  it('should successfully execute a request and increment usage in the database', async () => {
    const apiKey = await registerAndGetKey(100);
    const text = 'Hello world, billing test!'; // 26 chars

    const res = await request(app)
      .post('/api/v1/predict')
      .set('X-API-Key', apiKey)
      .send({ text, task: 'sentiment' });

    expect(res.status).toBe(200);

    const user = await User.findOne({ email: 'bill@example.com' });
    // Text (26) + Sentiment Output (1) = 27 units
    expect(user.apiKeyCurrentMonthUsage).toBe(27);
  });

  it('should block requests when the monthly usage budget is exceeded', async () => {
    // Set low budget of 20 characters
    const apiKey = await registerAndGetKey(20);
    const text = 'This text has twenty three!'; // 27 chars

    // First request exceeds budget (takes 27+1 = 28 units), but should proceed since current usage was 0
    const res1 = await request(app)
      .post('/api/v1/predict')
      .set('X-API-Key', apiKey)
      .send({ text, task: 'sentiment' });

    expect(res1.status).toBe(200);

    // Second request should be blocked immediately as usage (28) >= budget (20)
    const res2 = await request(app)
      .post('/api/v1/predict')
      .set('X-API-Key', apiKey)
      .send({ text, task: 'sentiment' });

    expect(res2.status).toBe(403);
    expect(res2.body.error.message).toContain('Monthly API Key usage budget exceeded');
  });

  it('should reset usage and allow request if the usage reset date has passed', async () => {
    const apiKey = await registerAndGetKey(20);
    
    // Manually update user to have exceeded usage AND set reset date to the past
    const pastDate = new Date();
    pastDate.setMinutes(pastDate.getMinutes() - 5); // 5 mins in the past

    await User.findOneAndUpdate(
      { email: 'bill@example.com' },
      {
        apiKeyCurrentMonthUsage: 35, // Exceeded budget
        apiKeyUsageResetDate: pastDate,
      }
    );

    const text = 'Hello!'; // 6 chars + 1 output = 7 units

    // This request should trigger checkAndResetUsageBudget, reset usage to 0, and succeed!
    const res = await request(app)
      .post('/api/v1/predict')
      .set('X-API-Key', apiKey)
      .send({ text, task: 'sentiment' });

    expect(res.status).toBe(200);

    const user = await User.findOne({ email: 'bill@example.com' });
    expect(user.apiKeyCurrentMonthUsage).toBe(7); // Reset to 0 then incremented by 7
    expect(user.apiKeyUsageResetDate.getTime()).toBeGreaterThan(Date.now()); // Future reset date
  });

  it('should calculate and consume usage for batch requests correctly', async () => {
    const apiKey = await registerAndGetKey(100);

    const res = await request(app)
      .post('/api/v1/predict/batch')
      .set('X-API-Key', apiKey)
      .send({
        inputs: [
          { id: '1', text: 'Text one' },  // 8 chars + 1 output = 9
          { id: '2', text: 'Text two!' }, // 9 chars + 1 output = 10
        ],
        task: 'sentiment',
      });

    expect(res.status).toBe(200);

    const user = await User.findOne({ email: 'bill@example.com' });
    // Total usage = 9 + 10 = 19
    expect(user.apiKeyCurrentMonthUsage).toBe(19);
  });
});
