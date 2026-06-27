const Redis = require('ioredis');
const config = require('./index');
const logger = require('../utils/logger');

let redisClient = null;

if (config.redis.enabled) {
  try {
    redisClient = new Redis({
      host: config.redis.host,
      port: config.redis.port,
      maxRetriesPerRequest: 1, // Fail fast to not block API requests
      retryStrategy(times) {
        // Retry connection up to 3 times, then stop
        if (times > 3) {
          logger.error('Redis connection failed permanently. Caching disabled.');
          return null; 
        }
        return Math.min(times * 100, 2000);
      }
    });

    redisClient.on('connect', () => {
      logger.info('Redis connected successfully', { host: config.redis.host, port: config.redis.port });
    });

    redisClient.on('error', (error) => {
      logger.warn('Redis client error', { error: error.message });
    });
  } catch (error) {
    logger.error('Failed to initialize Redis client', { error: error.message });
    redisClient = null;
  }
} else {
  logger.info('Redis caching is disabled by configuration');
}

/**
 * Get value from cache.
 * Falls back to returning null if Redis is offline/disabled.
 */
const get = async (key) => {
  if (!redisClient || redisClient.status !== 'ready') return null;
  try {
    const data = await redisClient.get(key);
    if (!data) return null;
    return JSON.parse(data);
  } catch (error) {
    logger.warn('Redis GET failed', { key, error: error.message });
    return null;
  }
};

/**
 * Set value in cache with TTL.
 * No-op if Redis is offline/disabled.
 */
const set = async (key, value, ttlSec = config.redis.ttlSec) => {
  if (!redisClient || redisClient.status !== 'ready') return;
  try {
    const data = JSON.stringify(value);
    await redisClient.set(key, data, 'EX', ttlSec);
  } catch (error) {
    logger.warn('Redis SET failed', { key, error: error.message });
  }
};

module.exports = {
  client: redisClient,
  get,
  set,
};
