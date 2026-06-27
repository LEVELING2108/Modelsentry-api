const authService = require('../services/authService');
const { sendSuccess, sendError } = require('../utils/response');
const logger = require('../utils/logger');

const register = async (req, res, next) => {
  try {
    const result = await authService.register(req.body);
    return sendSuccess(res, result, 201);
  } catch (error) {
    if (error.status) return sendError(res, error.message, error.status);
    next(error);
  }
};

const login = async (req, res, next) => {
  try {
    const result = await authService.login(req.body);
    return sendSuccess(res, result);
  } catch (error) {
    if (error.status) return sendError(res, error.message, error.status);
    next(error);
  }
};

const getMe = async (req, res) => {
  return sendSuccess(res, { user: req.user.toSafeObject() });
};

const generateApiKey = async (req, res, next) => {
  try {
    const { scopes, rateLimit } = req.body;
    const result = await authService.generateApiKey(req.user._id, scopes, rateLimit);
    return sendSuccess(res, {
      ...result,
      warning: 'Store this API key securely — it will not be shown again.',
    });
  } catch (error) {
    if (error.status) return sendError(res, error.message, error.status);
    next(error);
  }
};

module.exports = { register, login, getMe, generateApiKey };
