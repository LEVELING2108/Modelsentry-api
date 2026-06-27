require('dotenv').config();

const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT, 10) || 3000,

  db: {
    uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/ml_serving_db',
    options: {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    },
  },

  jwt: {
    secret: process.env.JWT_SECRET || 'fallback_dev_secret_do_not_use_in_prod',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },

  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000,
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10) || 100,
  },

  model: {
    v1Weight: parseFloat(process.env.MODEL_V1_WEIGHT) || 0.8,
    v2Weight: parseFloat(process.env.MODEL_V2_WEIGHT) || 0.2,
    timeoutMs: parseInt(process.env.MODEL_TIMEOUT_MS, 10) || 5000,
    hfApiKey: process.env.HF_API_KEY || '',
    v1ModelId: process.env.MODEL_V1_ID || 'distilbert-base-uncased-finetuned-sst-2-english',
    v2ModelId: process.env.MODEL_V2_ID || 'cardiffnlp/twitter-roberta-base-sentiment-latest',
  },

  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT, 10) || 6379,
    ttlSec: parseInt(process.env.REDIS_TTL_SEC, 10) || 86400,
    enabled: process.env.REDIS_ENABLED !== 'false',
  },

  logging: {
    level: process.env.LOG_LEVEL || 'info',
    file: process.env.LOG_FILE || 'logs/app.log',
  },
};

// Validate critical config at startup
if (config.env === 'production') {
  const required = ['JWT_SECRET', 'MONGODB_URI'];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required env vars in production: ${missing.join(', ')}`);
  }
}

module.exports = config;
