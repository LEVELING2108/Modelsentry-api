const jwt = require('jsonwebtoken');
const User = require('../models/User');
const config = require('../config');
const { sendError } = require('../utils/response');
const logger = require('../utils/logger');
const { metrics } = require('../utils/metrics');

/**
 * Authenticate via JWT bearer token OR API key.
 * Priority: Authorization: Bearer <token> → X-API-Key: <key>
 */
const authenticate = async (req, res, next) => {
  try {
    let user = null;

    const authHeader = req.headers['authorization'];
    const apiKey = req.headers['x-api-key'];

    if (authHeader && authHeader.startsWith('Bearer ')) {
      // --- JWT path ---
      const token = authHeader.split(' ')[1];
      let decoded;
      try {
        decoded = jwt.verify(token, config.jwt.secret);
      } catch (err) {
        const reason = err.name === 'TokenExpiredError' ? 'token_expired' : 'token_invalid';
        metrics.authFailuresTotal.inc({ reason });
        return sendError(res, 'Invalid or expired token', 401);
      }

      user = await User.findById(decoded.id).select('+isActive');
      if (!user || !user.isActive) {
        metrics.authFailuresTotal.inc({ reason: 'user_not_found' });
        return sendError(res, 'User not found or deactivated', 401);
      }
    } else if (apiKey) {
      // --- API key path ---
      // Find user by prefix for efficient lookup before expensive bcrypt compare
      const prefix = apiKey.substring(0, 8);
      user = await User.findOne({ apiKeyPrefix: prefix, isActive: true }).select(
        '+apiKeyHash +isActive'
      );

      if (!user) {
        metrics.authFailuresTotal.inc({ reason: 'api_key_not_found' });
        return sendError(res, 'Invalid API key', 401);
      }

      const isValid = await user.verifyApiKey(apiKey);
      if (!isValid) {
        metrics.authFailuresTotal.inc({ reason: 'api_key_invalid' });
        return sendError(res, 'Invalid API key', 401);
      }
    } else {
      return sendError(res, 'Authentication required. Provide Bearer token or X-API-Key header', 401);
    }

    // Attach user and update last login asynchronously (fire-and-forget)
    req.user = user;
    User.findByIdAndUpdate(user._id, { lastLogin: new Date() }).catch(() => {});

    next();
  } catch (error) {
    logger.error('Auth middleware error', { error: error.message });
    return sendError(res, 'Authentication error', 500);
  }
};

/**
 * Authorize by role.
 * Usage: router.delete('/model', authenticate, authorize('admin'), handler)
 */
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      logger.warn('Unauthorized access attempt', {
        userId: req.user?._id,
        requiredRoles: roles,
        userRole: req.user?.role,
      });
      return sendError(res, 'Insufficient permissions', 403);
    }
    next();
  };
};

module.exports = { authenticate, authorize };
