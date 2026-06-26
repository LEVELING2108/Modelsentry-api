/**
 * Standardized API response helpers.
 * All responses follow: { success, data, error, meta }
 */

const sendSuccess = (res, data = {}, statusCode = 200, meta = {}) => {
  return res.status(statusCode).json({
    success: true,
    data,
    meta: {
      timestamp: new Date().toISOString(),
      ...meta,
    },
  });
};

const sendError = (res, message, statusCode = 500, details = null) => {
  const body = {
    success: false,
    error: {
      message,
      code: statusCode,
    },
    meta: {
      timestamp: new Date().toISOString(),
    },
  };

  // Only expose error details in non-production environments
  if (details && process.env.NODE_ENV !== 'production') {
    body.error.details = details;
  }

  return res.status(statusCode).json(body);
};

const sendValidationError = (res, errors) => {
  return res.status(422).json({
    success: false,
    error: {
      message: 'Validation failed',
      code: 422,
      fields: errors,
    },
    meta: { timestamp: new Date().toISOString() },
  });
};

module.exports = { sendSuccess, sendError, sendValidationError };
