const mongoose = require('mongoose');
const config = require('../src/config');
const { runInference } = require('../src/services/modelService');
const ModelMetadata = require('../src/models/ModelMetadata');
const redisCache = require('../src/config/redis');

const TEST_DB = process.env.MONGODB_URI_TEST || 'mongodb://localhost:27017/ml_serving_test_fallback';

describe('Upstream Multi-Provider Fallback Tests', () => {
  let originalConfig;
  let originalFetch;
  let redisGetSpy;
  let redisSetSpy;

  beforeAll(async () => {
    // Connect to database
    await mongoose.connect(TEST_DB);

    // Save original configs
    originalConfig = JSON.parse(JSON.stringify(config));
    originalFetch = global.fetch;

    // Bypass Redis cache during tests
    redisGetSpy = jest.spyOn(redisCache, 'get').mockResolvedValue(null);
    redisSetSpy = jest.spyOn(redisCache, 'set').mockResolvedValue(undefined);
  });

  afterAll(async () => {
    // Restore spies
    redisGetSpy.mockRestore();
    redisSetSpy.mockRestore();

    // Cleanup DB and disconnect
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();

    // Restore configs
    Object.assign(config, originalConfig);
    global.fetch = originalFetch;
  });

  beforeEach(async () => {
    await ModelMetadata.deleteMany({});
    // Seed model metadata
    await ModelMetadata.insertMany([
      {
        version: 'v1',
        modelType: 'sentiment',
        description: 'V1 Stable model',
        labels: ['POSITIVE', 'NEGATIVE', 'NEUTRAL'],
        trafficWeight: 0.8,
        isActive: true,
      },
      {
        version: 'v2',
        modelType: 'sentiment',
        description: 'V2 Canary model',
        labels: ['POSITIVE', 'NEGATIVE', 'NEUTRAL'],
        trafficWeight: 0.2,
        isActive: true,
      },
    ]);

    // Reset config fallback values
    config.model.hfApiKey = ''; // Force HF to fail or bypass
    config.fallback = {
      provider: '',
      openai: { apiKey: '', model: 'gpt-4o-mini' },
      gemini: { apiKey: '', model: 'gemini-1.5-flash' },
      selfHosted: { url: '', apiKey: '' },
    };
  });

  it('should fall back to simulation when no fallback provider is configured and HF fails', async () => {
    // Force Hugging Face to be configured but fail (since HF API key is set but we mock fetch to fail)
    config.model.hfApiKey = 'dummy-hf-key';
    global.fetch = jest.fn().mockRejectedValue(new Error('Hugging Face Down'));

    const result = await runInference('This is an awesome day!', 'v1', 'sentiment');

    // Should return a response
    expect(result).toHaveProperty('modelVersion', 'v1');
    expect(result).toHaveProperty('label');
    expect(result).toHaveProperty('confidence');
    // Result should not have cached since Redis is mocked/skipped, but should not crash
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('should query OpenAI fallback for Sentiment analysis successfully', async () => {
    config.fallback.provider = 'openai';
    config.fallback.openai.apiKey = 'dummy-openai-key';

    const mockOpenAIResponse = {
      choices: [
        {
          message: {
            content: JSON.stringify({
              label: 'POSITIVE',
              confidence: 0.985,
              scores: { POSITIVE: 0.985, NEGATIVE: 0.005, NEUTRAL: 0.01 },
            }),
          },
        },
      ],
    };

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => mockOpenAIResponse,
    });

    const result = await runInference('OpenAI fallback test!', 'v1', 'sentiment', { returnScores: true });

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.openai.com/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'Authorization': 'Bearer dummy-openai-key',
        }),
      })
    );

    expect(result.label).toBe('POSITIVE');
    expect(result.confidence).toBe(0.985);
    expect(result.scores).toBeDefined();
    expect(result.scores.POSITIVE).toBe(0.985);
  });

  it('should fallback to regex/keyword parser if OpenAI response is not valid JSON', async () => {
    config.fallback.provider = 'openai';
    config.fallback.openai.apiKey = 'dummy-openai-key';

    // OpenAI returns plain text instead of JSON
    const mockOpenAIResponse = {
      choices: [
        {
          message: {
            content: 'The sentiment of this text is negative.',
          },
        },
      ],
    };

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => mockOpenAIResponse,
    });

    const result = await runInference('OpenAI fallback text test!', 'v1', 'sentiment');

    expect(result.label).toBe('NEGATIVE');
    expect(result.confidence).toBe(1.0);
  });

  it('should query Gemini fallback for Summarization successfully', async () => {
    config.fallback.provider = 'gemini';
    config.fallback.gemini.apiKey = 'dummy-gemini-key';
    config.fallback.gemini.model = 'gemini-1.5-flash';

    const mockGeminiResponse = {
      candidates: [
        {
          content: {
            parts: [
              {
                text: 'This is a summary generated by Gemini.',
              },
            ],
          },
        },
      ],
    };

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => mockGeminiResponse,
    });

    const result = await runInference('A very long text to summarize...', 'v1', 'summarization');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=dummy-gemini-key'),
      expect.objectContaining({
        method: 'POST',
      })
    );

    expect(result.summaryText).toBe('This is a summary generated by Gemini.');
  });

  it('should query OpenAI fallback for NER successfully', async () => {
    config.fallback.provider = 'openai';
    config.fallback.openai.apiKey = 'dummy-openai-key';

    const mockEntities = [
      { entity: 'PER', word: 'Alice', score: 0.95 },
      { entity: 'LOC', word: 'Paris', score: 0.99 },
    ];

    const mockOpenAIResponse = {
      choices: [
        {
          message: {
            content: JSON.stringify(mockEntities),
          },
        },
      ],
    };

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => mockOpenAIResponse,
    });

    const result = await runInference('Alice went to Paris.', 'v1', 'ner');

    expect(result.entities).toHaveLength(2);
    expect(result.entities[0]).toEqual({ entity: 'PER', word: 'Alice', score: 0.95 });
  });

  it('should query self-hosted fallback successfully', async () => {
    config.fallback.provider = 'self-hosted';
    config.fallback.selfHosted.url = 'http://localhost:9000/fallback-predict';
    config.fallback.selfHosted.apiKey = 'dummy-self-hosted-key';

    const mockSelfHostedResponse = {
      label: 'NEUTRAL',
      confidence: 0.85,
    };

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => mockSelfHostedResponse,
    });

    const result = await runInference('Neutral text.', 'v1', 'sentiment');

    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:9000/fallback-predict',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'Authorization': 'Bearer dummy-self-hosted-key',
        }),
      })
    );

    expect(result.label).toBe('NEUTRAL');
    expect(result.confidence).toBe(0.85);
  });

  it('should gracefully fall back to simulation if the fallback provider throws an error', async () => {
    config.fallback.provider = 'openai';
    config.fallback.openai.apiKey = 'dummy-openai-key';

    // Mock OpenAI call throwing error
    global.fetch = jest.fn().mockRejectedValue(new Error('OpenAI API Quota Exceeded'));

    const result = await runInference('Excellent product!', 'v1', 'sentiment');

    // Should still succeed via simulation
    expect(result.label).toBeDefined();
    expect(result.confidence).toBeDefined();
  });
});
