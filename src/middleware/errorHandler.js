const logger = require('../utils/logger');
const { sendError } = require('../utils/response');

/**
 * Global error handler — must be the last middleware registered.
 * Catches all errors passed via next(err).
 */
// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, next) => {
  logger.error('Unhandled error', {
    requestId: req.requestId,
    error: err.message,
    stack: process.env.NODE_ENV !== 'production' ? err.stack : undefined,
    method: req.method,
    path: req.path,
  });

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const fields = Object.values(err.errors).map((e) => ({
      field: e.path,
      message: e.message,
    }));
    return res.status(422).json({
      success: false,
      error: { message: 'Validation failed', code: 422, fields },
      meta: { timestamp: new Date().toISOString() },
    });
  }

  // Mongoose duplicate key error
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0] || 'field';
    return sendError(res, `${field} already exists`, 409);
  }

  // Mongoose cast error (invalid ObjectId, etc.)
  if (err.name === 'CastError') {
    return sendError(res, `Invalid ${err.path}`, 400);
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    return sendError(res, 'Invalid token', 401);
  }
  if (err.name === 'TokenExpiredError') {
    return sendError(res, 'Token expired', 401);
  }

  // Payload too large
  if (err.type === 'entity.too.large') {
    return sendError(res, 'Request payload too large', 413);
  }

  // Default 500
  const message =
    process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message;

  return sendError(res, message, err.status || 500);
};

/**
 * 404 handler — register BEFORE the global error handler.
 */
const notFoundHandler = (req, res) => {
  return sendError(res, `Route ${req.method} ${req.path} not found`, 404);
};

module.exports = { errorHandler, notFoundHandler };
