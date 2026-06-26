const jwt = require('jsonwebtoken');
const User = require('../models/User');
const config = require('../config');
const logger = require('../utils/logger');

const signToken = (userId) =>
  jwt.sign({ id: userId }, config.jwt.secret, { expiresIn: config.jwt.expiresIn });

const register = async ({ name, email, password }) => {
  const existing = await User.findOne({ email });
  if (existing) {
    const err = new Error('Email already registered');
    err.status = 409;
    throw err;
  }

  const user = await User.create({ name, email, password });
  const token = signToken(user._id);

  logger.info('New user registered', { userId: user._id, email });

  return { token, user: user.toSafeObject() };
};

const login = async ({ email, password }) => {
  const user = await User.findOne({ email }).select('+password');
  if (!user || !(await user.comparePassword(password))) {
    const err = new Error('Invalid email or password');
    err.status = 401;
    throw err;
  }

  if (!user.isActive) {
    const err = new Error('Account deactivated');
    err.status = 403;
    throw err;
  }

  const token = signToken(user._id);
  user.lastLogin = new Date();
  await user.save({ validateBeforeSave: false });

  logger.info('User logged in', { userId: user._id });

  return { token, user: user.toSafeObject() };
};

const generateApiKey = async (userId) => {
  const user = await User.findById(userId);
  if (!user) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }

  const rawKey = await user.generateApiKey();
  logger.info('API key generated', { userId, prefix: user.apiKeyPrefix });

  return { apiKey: rawKey, prefix: user.apiKeyPrefix };
};

module.exports = { register, login, generateApiKey };
