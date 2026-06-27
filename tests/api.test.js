const request = require('supertest');
const mongoose = require('mongoose');
const createApp = require('../src/app');
const User = require('../src/models/User');

const app = createApp();

// Use separate test DB
const TEST_DB = process.env.MONGODB_URI_TEST || 'mongodb://localhost:27017/ml_serving_test';

beforeAll(async () => {
  await mongoose.connect(TEST_DB);
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

afterEach(async () => {
  await User.deleteMany({});
});

// ── Helpers ────────────────────────────────────────────────────────────────
const registerUser = (overrides = {}) =>
  request(app)
    .post('/api/v1/auth/register')
    .send({ name: 'Test User', email: 'test@example.com', password: 'Password1', ...overrides });

const loginUser = (email = 'test@example.com', password = 'Password1') =>
  request(app).post('/api/v1/auth/login').send({ email, password });

// ── Auth Tests ─────────────────────────────────────────────────────────────
describe('POST /api/v1/auth/register', () => {
  it('should register a new user and return a JWT', async () => {
    const res = await registerUser();
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('token');
    expect(res.body.data.user.email).toBe('test@example.com');
    expect(res.body.data.user).not.toHaveProperty('password');
  });

  it('should reject duplicate email with 409', async () => {
    await registerUser();
    const res = await registerUser();
    expect(res.status).toBe(409);
  });

  it('should reject weak password with 422', async () => {
    const res = await registerUser({ password: 'weak' });
    expect(res.status).toBe(422);
    expect(res.body.error.fields).toBeDefined();
  });

  it('should reject invalid email', async () => {
    const res = await registerUser({ email: 'not-an-email' });
    expect(res.status).toBe(422);
  });
});

describe('POST /api/v1/auth/login', () => {
  beforeEach(async () => { await registerUser(); });

  it('should login and return JWT', async () => {
    const res = await loginUser();
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('token');
  });

  it('should reject wrong password with 401', async () => {
    const res = await loginUser('test@example.com', 'WrongPass1');
    expect(res.status).toBe(401);
  });

  it('should reject unknown email with 401', async () => {
    const res = await loginUser('unknown@example.com', 'Password1');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/v1/auth/me', () => {
  it('should return user profile with valid JWT', async () => {
    await registerUser();
    const { body: { data: { token } } } = await loginUser();

    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe('test@example.com');
  });

  it('should reject request without token with 401', async () => {
    const res = await request(app).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
  });

  it('should reject malformed token with 401', async () => {
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', 'Bearer not.a.valid.token');
    expect(res.status).toBe(401);
  });
});

// ── Prediction Tests ───────────────────────────────────────────────────────
describe('POST /api/v1/predict', () => {
  let token;

  beforeEach(async () => {
    await registerUser();
    const res = await loginUser();
    token = res.body.data.token;
  });

  it('should return a prediction for valid input', async () => {
    const res = await request(app)
      .post('/api/v1/predict')
      .set('Authorization', `Bearer ${token}`)
      .send({ text: 'This product is absolutely amazing!' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.prediction).toHaveProperty('label');
    expect(res.body.data.prediction).toHaveProperty('confidence');
    expect(['POSITIVE', 'NEGATIVE', 'NEUTRAL']).toContain(res.body.data.prediction.label);
    expect(res.body.data.model.version).toMatch(/^v[12]$/);
    expect(res.body.data.performance.latencyMs).toBeGreaterThan(0);
  });

  it('should cache predictions and return cached: true for subsequent requests', async () => {
    const text = `Redis caching test payload! ${Date.now()}-${Math.random()}`;
    const res1 = await request(app)
      .post('/api/v1/predict')
      .set('Authorization', `Bearer ${token}`)
      .send({ text, modelVersion: 'v1' });

    expect(res1.status).toBe(200);
    expect(res1.body.data.performance.cached).toBeUndefined();

    const res2 = await request(app)
      .post('/api/v1/predict')
      .set('Authorization', `Bearer ${token}`)
      .send({ text, modelVersion: 'v1' });

    expect(res2.status).toBe(200);
    if (process.env.REDIS_ENABLED !== 'false') {
      expect(res2.body.data.performance.cached).toBe(true);
    }
  });

  it('should respect explicit model version', async () => {
    const res = await request(app)
      .post('/api/v1/predict')
      .set('Authorization', `Bearer ${token}`)
      .send({ text: 'Good product', modelVersion: 'v1' });

    expect(res.status).toBe(200);
    expect(res.body.data.model.version).toBe('v1');
  });

  it('should return scores when returnScores option is set', async () => {
    const res = await request(app)
      .post('/api/v1/predict')
      .set('Authorization', `Bearer ${token}`)
      .send({ text: 'Great service', options: { returnScores: true } });

    expect(res.status).toBe(200);
    expect(res.body.data.prediction.scores).toBeDefined();
    expect(res.body.data.prediction.scores).toHaveProperty('POSITIVE');
  });

  it('should reject empty text with 422', async () => {
    const res = await request(app)
      .post('/api/v1/predict')
      .set('Authorization', `Bearer ${token}`)
      .send({ text: '' });

    expect(res.status).toBe(422);
  });

  it('should reject text exceeding 5000 chars with 422', async () => {
    const res = await request(app)
      .post('/api/v1/predict')
      .set('Authorization', `Bearer ${token}`)
      .send({ text: 'a'.repeat(5001) });

    expect(res.status).toBe(422);
  });

  it('should reject unauthenticated requests with 401', async () => {
    const res = await request(app)
      .post('/api/v1/predict')
      .send({ text: 'Hello' });

    expect(res.status).toBe(401);
  });
});

describe('POST /api/v1/predict/batch', () => {
  let token;

  beforeEach(async () => {
    await registerUser();
    const res = await loginUser();
    token = res.body.data.token;
  });

  it('should return batch predictions', async () => {
    const res = await request(app)
      .post('/api/v1/predict/batch')
      .set('Authorization', `Bearer ${token}`)
      .send({
        inputs: [
          { id: 'a1', text: 'Love this!' },
          { id: 'a2', text: 'Terrible experience' },
          { id: 'a3', text: 'It was okay' },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.data.results).toHaveLength(3);
    expect(res.body.data.summary.total).toBe(3);
  });

  it('should reject batch exceeding 50 items', async () => {
    const inputs = Array.from({ length: 51 }, (_, i) => ({ id: `id-${i}`, text: 'text' }));
    const res = await request(app)
      .post('/api/v1/predict/batch')
      .set('Authorization', `Bearer ${token}`)
      .send({ inputs });

    expect(res.status).toBe(422);
  });
});

// ── Admin Analytics Tests ──────────────────────────────────────────────────
describe('GET /api/v1/admin/analytics', () => {
  let token;

  beforeEach(async () => {
    await registerUser();
    await User.findOneAndUpdate({ email: 'test@example.com' }, { role: 'admin' });
    const res = await loginUser();
    token = res.body.data.token;
  });

  it('should return analytics metrics, sentimentDistribution, and timeSeries', async () => {
    const res = await request(app)
      .get('/api/v1/admin/analytics')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('summary');
    expect(res.body.data).toHaveProperty('sentimentDistribution');
    expect(res.body.data).toHaveProperty('timeSeries');
    expect(res.body.data).toHaveProperty('byModel');
    
    // Check comparative metrics
    if (res.body.data.byModel.length > 0) {
      const modelStat = res.body.data.byModel[0];
      expect(modelStat).toHaveProperty('errorRate');
      expect(modelStat).toHaveProperty('avgConfidence');
      expect(modelStat).toHaveProperty('sentiment');
      expect(modelStat.sentiment).toHaveProperty('POSITIVE');
      expect(modelStat.sentiment).toHaveProperty('NEGATIVE');
      expect(modelStat.sentiment).toHaveProperty('NEUTRAL');
    }
  });
});

// ── API Key Scoping & Rate Limiting Tests ───────────────────────────────────
describe('API Key Scoping and Rate Limiting', () => {
  it('should allow prediction on v1 for a v1-scoped key', async () => {
    await registerUser();
    const loginRes = await loginUser();
    const userToken = loginRes.body.data.token;

    const res1 = await request(app)
      .post('/api/v1/auth/api-key')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ scopes: ['predict:v1'], rateLimit: 100 });
    const v1OnlyKey = res1.body.data.apiKey;

    const res = await request(app)
      .post('/api/v1/predict')
      .set('X-API-Key', v1OnlyKey)
      .send({ text: 'Hello v1', modelVersion: 'v1' });

    expect(res.status).toBe(200);
    expect(res.body.data.model.version).toBe('v1');
  });

  it('should deny prediction on v2 for a v1-scoped key', async () => {
    await registerUser();
    const loginRes = await loginUser();
    const userToken = loginRes.body.data.token;

    const res1 = await request(app)
      .post('/api/v1/auth/api-key')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ scopes: ['predict:v1'], rateLimit: 100 });
    const v1OnlyKey = res1.body.data.apiKey;

    const res = await request(app)
      .post('/api/v1/predict')
      .set('X-API-Key', v1OnlyKey)
      .send({ text: 'Hello v2', modelVersion: 'v2' });

    expect(res.status).toBe(403);
    expect(res.body.error.message).toContain("API key lacks required scope 'predict:v2'");
  });

  it('should rate limit requests exceeding the custom key rate limit', async () => {
    await registerUser();
    const loginRes = await loginUser();
    const userToken = loginRes.body.data.token;

    const res2 = await request(app)
      .post('/api/v1/auth/api-key')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ scopes: ['predict:v1', 'predict:v2'], rateLimit: 2 });
    const lowRateKey = res2.body.data.apiKey;

    const r1 = await request(app)
      .post('/api/v1/predict')
      .set('X-API-Key', lowRateKey)
      .send({ text: 'R1', modelVersion: 'v1' });
    expect(r1.status).toBe(200);

    const r2 = await request(app)
      .post('/api/v1/predict')
      .set('X-API-Key', lowRateKey)
      .send({ text: 'R2', modelVersion: 'v1' });
    expect(r2.status).toBe(200);

    const r3 = await request(app)
      .post('/api/v1/predict')
      .set('X-API-Key', lowRateKey)
      .send({ text: 'R3', modelVersion: 'v1' });
    
    expect(r3.status).toBe(429);
  });
});

// ── Multi-Task Gateway Tests ───────────────────────────────────────────────
describe('Multi-Task ML Gateway', () => {
  it('should run summarization task successfully with wildcard API key', async () => {
    await registerUser();
    const loginRes = await loginUser();
    const userToken = loginRes.body.data.token;

    const res1 = await request(app)
      .post('/api/v1/auth/api-key')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ scopes: ['*'], rateLimit: 100 });
    const allAccessKey = res1.body.data.apiKey;

    const res = await request(app)
      .post('/api/v1/predict')
      .set('X-API-Key', allAccessKey)
      .send({ text: 'Google DeepMind is an artificial intelligence research laboratory. It was founded in 2010.', task: 'summarization' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.prediction).toHaveProperty('summaryText');
    expect(typeof res.body.data.prediction.summaryText).toBe('string');
  });

  it('should run NER task successfully with wildcard API key', async () => {
    await registerUser();
    const loginRes = await loginUser();
    const userToken = loginRes.body.data.token;

    const res1 = await request(app)
      .post('/api/v1/auth/api-key')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ scopes: ['*'], rateLimit: 100 });
    const allAccessKey = res1.body.data.apiKey;

    const res = await request(app)
      .post('/api/v1/predict')
      .set('X-API-Key', allAccessKey)
      .send({ text: 'Barack Obama visited Berlin in Germany.', task: 'ner' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.prediction).toHaveProperty('entities');
    expect(Array.isArray(res.body.data.prediction.entities)).toBe(true);
    expect(res.body.data.prediction.entities.length).toBeGreaterThan(0);
  });

  it('should deny summarization task for a key without predict:summarization scope', async () => {
    await registerUser();
    const loginRes = await loginUser();
    const userToken = loginRes.body.data.token;

    const res2 = await request(app)
      .post('/api/v1/auth/api-key')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ scopes: ['predict:v1', 'predict:v2'], rateLimit: 100 });
    const sentimentOnlyKey = res2.body.data.apiKey;

    const res = await request(app)
      .post('/api/v1/predict')
      .set('X-API-Key', sentimentOnlyKey)
      .send({ text: 'Some text here.', task: 'summarization' });

    expect(res.status).toBe(403);
    expect(res.body.error.message).toContain("API key lacks required scope 'predict:summarization'");
  });
});

// ── Health Check Tests ─────────────────────────────────────────────────────
describe('Health endpoints', () => {
  it('GET /health/live should return 200', async () => {
    const res = await request(app).get('/health/live');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('GET /health should return server info', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBeOneOf ? expect(res.status).toBeOneOf([200, 503]) : expect([200, 503]).toContain(res.status);
    expect(res.body).toHaveProperty('uptime');
  });
});
