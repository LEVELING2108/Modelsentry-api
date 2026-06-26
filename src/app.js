const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const config = require('./config');
const logger = require('./utils/logger');
const { requestMetrics } = require('./middleware/metricsMiddleware');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');

const authRoutes = require('./routes/auth');
const predictionRoutes = require('./routes/predictions');
const adminRoutes = require('./routes/admin');
const healthRoutes = require('./routes/health');

const createApp = () => {
  const app = express();

  // ── Security headers (Helmet) ──────────────────────────────────────────────
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        scriptSrc: ["'self'"],
      },
    },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
  }));

  // ── CORS ────────────────────────────────────────────────────────────────────
  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',')
    : ['http://localhost:3000', 'http://localhost:5173'];

  app.use(cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      callback(new Error(`CORS: Origin ${origin} not allowed`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-Request-ID'],
  }));

  // ── Body parsing ────────────────────────────────────────────────────────────
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));

  // ── Compression ─────────────────────────────────────────────────────────────
  app.use(compression());

  // ── HTTP request logging ────────────────────────────────────────────────────
  if (config.env !== 'test') {
    app.use(morgan('combined', { stream: logger.stream }));
  }

  // ── Request metrics (attaches requestId, records latency) ──────────────────
  app.use(requestMetrics);

  // ── Global rate limiter ─────────────────────────────────────────────────────
  const globalLimiter = rateLimit({
    windowMs: config.rateLimit.windowMs,
    max: config.rateLimit.max,
    standardHeaders: true,  // Return rate limit info in `RateLimit-*` headers
    legacyHeaders: false,
    message: {
      success: false,
      error: { message: 'Too many requests, please try again later.', code: 429 },
    },
    skip: (req) => process.env.NODE_ENV === 'test' || req.path.startsWith('/health'), // Don't rate-limit health checks in prod, bypass all in tests
  });
  app.use(globalLimiter);

  // Stricter limiter for auth endpoints (brute force protection)
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: {
      success: false,
      error: { message: 'Too many authentication attempts. Please wait 15 minutes.', code: 429 },
    },
    skip: () => process.env.NODE_ENV === 'test',
  });

  // ── Trust proxy (for correct IP behind reverse proxy / load balancer) ───────
  app.set('trust proxy', 1);

  // ── Routes ──────────────────────────────────────────────────────────────────
  app.use('/health', healthRoutes);
  app.use('/api/v1/auth', authLimiter, authRoutes);
  app.use('/api/v1/predict', predictionRoutes);
  app.use('/api/v1/admin', adminRoutes);

  // ── API root info ────────────────────────────────────────────────────────────
  app.get('/', (req, res) => {
    res.json({
      name: 'ML Model Serving API',
      version: '1.0.0',
      docs: '/api/v1/docs',
      health: '/health',
      metrics: '/health/metrics',
    });
  });

  // ── 404 & error handlers (must be last) ─────────────────────────────────────
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};

module.exports = createApp;
