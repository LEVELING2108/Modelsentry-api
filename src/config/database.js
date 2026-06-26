const mongoose = require('mongoose');
const config = require('../config');
const logger = require('../utils/logger');

const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 3000;

const connect = async (retries = MAX_RETRIES) => {
  try {
    await mongoose.connect(config.db.uri, config.db.options);
    logger.info('MongoDB connected', { uri: config.db.uri.replace(/\/\/.*@/, '//***@') });
  } catch (error) {
    if (retries > 0) {
      logger.warn(`MongoDB connection failed. Retrying in ${RETRY_DELAY_MS}ms...`, {
        error: error.message,
        retriesLeft: retries - 1,
      });
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      return connect(retries - 1);
    }
    logger.error('MongoDB connection failed after all retries', { error: error.message });
    throw error;
  }
};

mongoose.connection.on('disconnected', () => {
  logger.warn('MongoDB disconnected');
});

mongoose.connection.on('reconnected', () => {
  logger.info('MongoDB reconnected');
});

const disconnect = async () => {
  await mongoose.disconnect();
  logger.info('MongoDB disconnected gracefully');
};

module.exports = { connect, disconnect };
