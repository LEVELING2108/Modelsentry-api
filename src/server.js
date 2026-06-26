const createApp = require('./app');
const { connect, disconnect } = require('./config/database');
const config = require('./config');
const logger = require('./utils/logger');
const { metrics } = require('./utils/metrics');
const ModelMetadata = require('./models/ModelMetadata');

const start = async () => {
  // Connect to MongoDB
  await connect();

  // Seed model metadata if not present
  await seedModelMetadata();

  const app = createApp();

  const server = app.listen(config.port, () => {
    logger.info(`ML Serving API running`, {
      port: config.port,
      env: config.env,
      pid: process.pid,
    });
  });

  // Initialise A/B traffic gauges
  metrics.modelABTrafficGauge.set({ model_version: 'v1' }, config.model.v1Weight);
  metrics.modelABTrafficGauge.set({ model_version: 'v2' }, config.model.v2Weight);

  // ── Graceful shutdown ───────────────────────────────────────────────────────
  const shutdown = async (signal) => {
    logger.info(`${signal} received — shutting down gracefully`);

    // Stop accepting new connections
    server.close(async () => {
      logger.info('HTTP server closed');
      await disconnect();
      logger.info('Shutdown complete');
      process.exit(0);
    });

    // Force shutdown after 10s if graceful close hangs
    setTimeout(() => {
      logger.error('Graceful shutdown timeout — forcing exit');
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Handle unhandled rejections and uncaught exceptions
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection', { reason: String(reason) });
    shutdown('unhandledRejection');
  });

  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', { error: error.message, stack: error.stack });
    shutdown('uncaughtException');
  });

  return server;
};

const seedModelMetadata = async () => {
  const count = await ModelMetadata.countDocuments();
  if (count > 0) return;

  await ModelMetadata.insertMany([
    {
      version: 'v1',
      modelType: 'sentiment',
      description: 'Stable sentiment classifier — BERT-based fine-tuned on SST-2',
      labels: ['POSITIVE', 'NEGATIVE', 'NEUTRAL'],
      trafficWeight: config.model.v1Weight,
      isActive: true,
      metrics: { accuracy: 0.924, f1Score: 0.921, trainedAt: new Date('2024-01-15'), datasetSize: 67349 },
    },
    {
      version: 'v2',
      modelType: 'sentiment',
      description: 'Canary release — DistilBERT with improved neutral class handling',
      labels: ['POSITIVE', 'NEGATIVE', 'NEUTRAL'],
      trafficWeight: config.model.v2Weight,
      isActive: true,
      metrics: { accuracy: 0.937, f1Score: 0.934, trainedAt: new Date('2024-06-01'), datasetSize: 120000 },
    },
  ]);

  logger.info('Model metadata seeded');
};

start().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
