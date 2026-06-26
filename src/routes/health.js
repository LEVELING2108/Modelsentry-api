const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { register } = require('../utils/metrics');
const { sendSuccess } = require('../utils/response');

// Liveness probe — just "am I running?"
router.get('/live', (req, res) => res.status(200).json({ status: 'ok' }));

// Readiness probe — "am I ready to serve traffic?"
router.get('/ready', async (req, res) => {
  const dbState = mongoose.connection.readyState;
  // 1 = connected
  if (dbState !== 1) {
    return res.status(503).json({ status: 'not_ready', db: 'disconnected' });
  }
  return res.status(200).json({ status: 'ready', db: 'connected' });
});

// Full health check with details
router.get('/', async (req, res) => {
  const dbState = mongoose.connection.readyState;
  const dbStatus = ['disconnected', 'connected', 'connecting', 'disconnecting'][dbState] || 'unknown';

  const health = {
    status: dbState === 1 ? 'healthy' : 'degraded',
    version: process.env.npm_package_version || '1.0.0',
    environment: process.env.NODE_ENV,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    services: {
      database: { status: dbStatus },
      memory: {
        usedMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        totalMb: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
      },
    },
  };

  const statusCode = health.status === 'healthy' ? 200 : 503;
  return res.status(statusCode).json(health);
});

// Prometheus metrics endpoint — scrape target for Prometheus / Grafana
router.get('/metrics', async (req, res) => {
  try {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  } catch (error) {
    res.status(500).end(error.message);
  }
});

module.exports = router;
