const Prediction = require('../models/Prediction');
const ModelMetadata = require('../models/ModelMetadata');
const config = require('../config');
const logger = require('./logger');
const { metrics } = require('./metrics');

const DRIFT_CHECK_INTERVAL_MS = 30000; // Check every 30 seconds
const MIN_SAMPLE_SIZE = 5; // Minimum predictions needed to trigger rollback
const MAX_ERROR_RATE_THRESHOLD = 0.15; // 15% error rate threshold

let intervalId = null;

const checkDriftAndRollback = async () => {
  // Only run drift checks if the canary model has some traffic allocation
  if (config.model.v2Weight <= 0) {
    return;
  }

  try {
    const windowStart = new Date(Date.now() - 5 * 60 * 1000); // Look back 5 minutes

    // Aggregate successes and errors for Canary v2 model
    const stats = await Prediction.aggregate([
      {
        $match: {
          modelVersion: 'v2',
          createdAt: { $gte: windowStart },
        },
      },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
        },
      },
    ]);

    let successCount = 0;
    let errorCount = 0;

    stats.forEach((stat) => {
      if (stat._id === 'success') {
        successCount = stat.count;
      } else {
        errorCount += stat.count; // Includes 'error' and 'timeout' status
      }
    });

    const totalCount = successCount + errorCount;

    if (totalCount < MIN_SAMPLE_SIZE) {
      return; // Not enough samples to draw conclusions
    }

    const errorRate = errorCount / totalCount;

    if (errorRate >= MAX_ERROR_RATE_THRESHOLD) {
      logger.error(`[ALERT] Auto-Rollback Triggered! Canary (v2) error rate is ${(errorRate * 100).toFixed(1)}% (Threshold: ${(MAX_ERROR_RATE_THRESHOLD * 100)}%). Rolling back to 100% Stable (v1).`, {
        v2TotalRequests: totalCount,
        v2ErrorCount: errorCount,
        errorRate,
      });

      // Rollback weights in DB
      await Promise.all([
        ModelMetadata.findOneAndUpdate({ version: 'v1' }, { trafficWeight: 1.0 }),
        ModelMetadata.findOneAndUpdate({ version: 'v2' }, { trafficWeight: 0.0 }),
      ]);

      // Rollback live config
      config.model.v1Weight = 1.0;
      config.model.v2Weight = 0.0;

      // Update Prometheus metrics
      metrics.modelABTrafficGauge.set({ model_version: 'v1' }, 1.0);
      metrics.modelABTrafficGauge.set({ model_version: 'v2' }, 0.0);

      logger.info('Auto-rollback: Traffic weights successfully set to v1: 100%, v2: 0%');
    }
  } catch (error) {
    logger.error('Failed to perform Canary drift/error rate checks', { error: error.message });
  }
};

const startDriftChecker = () => {
  if (intervalId) return;

  logger.info('Starting Canary Auto-Rollback drift detector', {
    intervalMs: DRIFT_CHECK_INTERVAL_MS,
    minSamples: MIN_SAMPLE_SIZE,
    thresholdPct: MAX_ERROR_RATE_THRESHOLD * 100,
  });

  intervalId = setInterval(checkDriftAndRollback, DRIFT_CHECK_INTERVAL_MS);
};

const stopDriftChecker = () => {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    logger.info('Canary Auto-Rollback drift detector stopped');
  }
};

module.exports = {
  startDriftChecker,
  stopDriftChecker,
};
