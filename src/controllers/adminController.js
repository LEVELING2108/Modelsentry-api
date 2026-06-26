const ModelMetadata = require('../models/ModelMetadata');
const Prediction = require('../models/Prediction');
const { sendSuccess, sendError } = require('../utils/response');
const { metrics } = require('../utils/metrics');
const config = require('../config');
const logger = require('../utils/logger');

const getModels = async (req, res, next) => {
  try {
    const models = await ModelMetadata.find().populate('deployedBy', 'name email');
    return sendSuccess(res, { models });
  } catch (error) {
    next(error);
  }
};

const updateTrafficWeights = async (req, res, next) => {
  try {
    const { version, weight } = req.body;

    // Recalculate complementary weight
    const otherVersion = version === 'v1' ? 'v2' : 'v1';
    const otherWeight = parseFloat((1 - weight).toFixed(4));

    await Promise.all([
      ModelMetadata.findOneAndUpdate({ version }, { trafficWeight: weight }, { new: true }),
      ModelMetadata.findOneAndUpdate({ version: otherVersion }, { trafficWeight: otherWeight }, { new: true }),
    ]);

    // Update live config
    if (version === 'v1') {
      config.model.v1Weight = weight;
      config.model.v2Weight = otherWeight;
    } else {
      config.model.v2Weight = weight;
      config.model.v1Weight = otherWeight;
    }

    // Update Prometheus gauge
    metrics.modelABTrafficGauge.set({ model_version: 'v1' }, config.model.v1Weight);
    metrics.modelABTrafficGauge.set({ model_version: 'v2' }, config.model.v2Weight);

    logger.info('Traffic weights updated', { version, weight, otherVersion, otherWeight, adminId: req.user._id });

    return sendSuccess(res, {
      trafficSplit: {
        v1: config.model.v1Weight,
        v2: config.model.v2Weight,
      },
    });
  } catch (error) {
    next(error);
  }
};

const getAnalytics = async (req, res, next) => {
  try {
    const hours = Math.min(720, parseInt(req.query.hours, 10) || 24);
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    const [totalStats, modelStats, latencyStats, errorStats] = await Promise.all([
      // Total predictions
      Prediction.countDocuments({ createdAt: { $gte: since } }),

      // Per-model breakdown
      Prediction.aggregate([
        { $match: { createdAt: { $gte: since } } },
        { $group: { _id: '$modelVersion', count: { $sum: 1 }, avgLatency: { $avg: '$latencyMs' } } },
      ]),

      // Latency percentiles
      Prediction.aggregate([
        { $match: { createdAt: { $gte: since }, status: 'success' } },
        {
          $group: {
            _id: null,
            p50: { $avg: '$latencyMs' },
            maxLatency: { $max: '$latencyMs' },
            minLatency: { $min: '$latencyMs' },
          },
        },
      ]),

      // Error rate
      Prediction.aggregate([
        { $match: { createdAt: { $gte: since } } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
    ]);

    const errorMap = {};
    errorStats.forEach((s) => { errorMap[s._id] = s.count; });

    return sendSuccess(res, {
      period: { hours, since },
      summary: {
        totalPredictions: totalStats,
        successRate: totalStats > 0
          ? (((errorMap.success || 0) / totalStats) * 100).toFixed(2) + '%'
          : 'N/A',
        errorCount: errorMap.error || 0,
        timeoutCount: errorMap.timeout || 0,
      },
      byModel: modelStats.map((m) => ({
        version: m._id,
        predictions: m.count,
        avgLatencyMs: Math.round(m.avgLatency),
      })),
      latency: latencyStats[0]
        ? {
            avgMs: Math.round(latencyStats[0].p50),
            maxMs: Math.round(latencyStats[0].maxLatency),
            minMs: Math.round(latencyStats[0].minLatency),
          }
        : null,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = { getModels, updateTrafficWeights, getAnalytics };
