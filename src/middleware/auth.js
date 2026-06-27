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
      req.authType = 'jwt';
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
      req.authType = 'api_key';
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

/**
 * Fallback in-memory rate limiting store for when Redis is offline or not enabled.
 */
const memoryStore = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of memoryStore.entries()) {
    if (value.resetTime < now) {
      memoryStore.delete(key);
    }
  }
}, 60000);

/**
 * Custom rate limiting for API keys.
 * Reads user.apiKeyRateLimit and enforces it using Redis (if active) or local memory fallback.
 */
const apiKeyRateLimiter = async (req, res, next) => {
  if (req.authType !== 'api_key' || !req.user) {
    return next();
  }

  const redisCache = require('../config/redis');
  const limit = req.user.apiKeyRateLimit || 100;
  const keyIdentifier = `ratelimit:${req.user._id}`;
  const windowMs = 60000;

  if (redisCache.client && redisCache.client.status === 'ready') {
    try {
      const current = await redisCache.client.get(keyIdentifier);
      if (current && parseInt(current, 10) >= limit) {
        return sendError(res, 'Too many requests. API Key rate limit exceeded.', 429);
      }

      if (!current) {
        await redisCache.client.set(keyIdentifier, 1, 'PX', windowMs);
      } else {
        await redisCache.client.incr(keyIdentifier);
      }
      return next();
    } catch (err) {
      logger.warn('Redis rate limiting failed, falling back to in-memory store', { error: err.message });
    }
  }

  const now = Date.now();
  let record = memoryStore.get(keyIdentifier);

  if (!record || record.resetTime < now) {
    record = { count: 1, resetTime: now + windowMs };
    memoryStore.set(keyIdentifier, record);
  } else {
    record.count++;
  }

  if (record.count > limit) {
    return sendError(res, 'Too many requests. API Key rate limit exceeded.', 429);
  }

  next();
};

/**
 * Authorize requests based on API key scope.
 * Usage: router.get('/history', requireScope('history:read'), handler)
 */
const requireScope = (scope) => {
  return (req, res, next) => {
    if (req.authType !== 'api_key') {
      return next(); // Skip scope check for UI sessions (JWT)
    }

    const userScopes = req.user.apiKeyScopes || [];
    const hasScope = userScopes.includes('*') || userScopes.includes(scope);

    if (!hasScope) {
      metrics.authFailuresTotal.inc({ reason: 'insufficient_scope' });
      return sendError(res, `Forbidden: API key lacks required scope '${scope}'`, 403);
    }
    next();
  };
};

module.exports = { authenticate, authorize, apiKeyRateLimiter, requireScope };
