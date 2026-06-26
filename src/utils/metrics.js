const promClient = require('prom-client');

// Collect default Node.js metrics (memory, CPU, event loop lag, etc.)
promClient.collectDefaultMetrics({ prefix: 'ml_api_' });

// --- Custom Metrics ---

const httpRequestDuration = new promClient.Histogram({
  name: 'ml_api_http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
});

const httpRequestsTotal = new promClient.Counter({
  name: 'ml_api_http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
});

const predictionDuration = new promClient.Histogram({
  name: 'ml_api_prediction_duration_seconds',
  help: 'Duration of ML model inference in seconds',
  labelNames: ['model_version', 'model_type'],
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1],
});

const predictionsTotal = new promClient.Counter({
  name: 'ml_api_predictions_total',
  help: 'Total number of predictions served',
  labelNames: ['model_version', 'model_type', 'status'],
});

const activeConnections = new promClient.Gauge({
  name: 'ml_api_active_connections',
  help: 'Number of active connections',
});

const modelABTrafficGauge = new promClient.Gauge({
  name: 'ml_api_model_traffic_ratio',
  help: 'Current A/B traffic split ratio',
  labelNames: ['model_version'],
});

const authFailuresTotal = new promClient.Counter({
  name: 'ml_api_auth_failures_total',
  help: 'Total authentication failures',
  labelNames: ['reason'],
});

module.exports = {
  register: promClient.register,
  metrics: {
    httpRequestDuration,
    httpRequestsTotal,
    predictionDuration,
    predictionsTotal,
    activeConnections,
    modelABTrafficGauge,
    authFailuresTotal,
  },
};
