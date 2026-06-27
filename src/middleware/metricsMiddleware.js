const { metrics } = require('../utils/metrics');
const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');

/**
 * Attaches a unique requestId to every incoming request and records
 * HTTP duration + total request count to Prometheus.
 */
const requestMetrics = (req, res, next) => {
  const requestId = uuidv4();
  req.requestId = requestId;
  res.setHeader('X-Request-ID', requestId);

  const startHr = process.hrtime.bigint();

  res.on('finish', () => {
    const durationNs = process.hrtime.bigint() - startHr;
    const durationSec = Number(durationNs) / 1e9;

    // Normalise route (avoid high-cardinality label with :id, etc.)
    const route = req.route?.path || req.path.replace(/\/[0-9a-f-]{8,}/gi, '/:id') || 'unknown';
    const labels = {
      method: req.method,
      route,
      status_code: String(res.statusCode),
    };

    metrics.httpRequestDuration.observe(labels, durationSec);
    metrics.httpRequestsTotal.inc(labels);

    // Log slow requests
    if (durationSec > 1) {
      logger.warn('Slow request detected', {
        requestId,
        method: req.method,
        path: req.path,
        durationMs: (durationSec * 1000).toFixed(2),
        statusCode: res.statusCode,
      });
    }
  });

  next();
};

const connectionTracker = (server) => {
  server.on('connection', (socket) => {
    metrics.activeConnections.inc();
    socket.on('close', () => {
      metrics.activeConnections.dec();
    });
  });
};

module.exports = { requestMetrics, connectionTracker };
