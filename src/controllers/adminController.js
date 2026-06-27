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

    const [totalStats, modelStats, latencyStats, errorStats, sentimentStats, timeSeriesStats, modelSentimentStats] = await Promise.all([
      // Total predictions
      Prediction.countDocuments({ createdAt: { $gte: since } }),

      // Per-model breakdown
      Prediction.aggregate([
        { $match: { createdAt: { $gte: since } } },
        {
          $group: {
            _id: '$modelVersion',
            count: { $sum: 1 },
            avgLatency: { $avg: '$latencyMs' },
            errorCount: {
              $sum: { $cond: [{ $ne: ['$status', 'success'] }, 1, 0] }
            },
            successCount: {
              $sum: { $cond: [{ $eq: ['$status', 'success'] }, 1, 0] }
            },
            avgConfidence: { $avg: '$output.confidence' }
          }
        },
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

      // Sentiment distribution breakdown
      Prediction.aggregate([
        { $match: { createdAt: { $gte: since }, status: 'success' } },
        { $group: { _id: '$output.label', count: { $sum: 1 } } },
      ]),

      // Hourly time series (throughput, latency, error count)
      Prediction.aggregate([
        { $match: { createdAt: { $gte: since } } },
        {
          $group: {
            _id: {
              $dateToString: { format: '%Y-%m-%d %H:00', date: '$createdAt', timezone: 'UTC' }
            },
            count: { $sum: 1 },
            avgLatency: { $avg: '$latencyMs' },
            errorCount: {
              $sum: { $cond: [{ $ne: ['$status', 'success'] }, 1, 0] }
            }
          }
        },
        { $sort: { _id: 1 } }
      ]),

      // Sentiment breakdown per model (A/B comparisons)
      Prediction.aggregate([
        { $match: { createdAt: { $gte: since }, status: 'success' } },
        {
          $group: {
            _id: { model: '$modelVersion', label: '$output.label' },
            count: { $sum: 1 }
          }
        }
      ]),
    ]);

    const errorMap = {};
    errorStats.forEach((s) => { errorMap[s._id] = s.count; });

    // Map timeSeries results into an hour-based object
    const timeSeriesMap = {};
    timeSeriesStats.forEach((t) => {
      timeSeriesMap[t._id] = {
        count: t.count,
        avgLatencyMs: Math.round(t.avgLatency),
        errorCount: t.errorCount,
      };
    });

    const filledTimeSeries = [];
    for (let i = hours - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 60 * 60 * 1000);
      const year = d.getUTCFullYear();
      const month = String(d.getUTCMonth() + 1).padStart(2, '0');
      const day = String(d.getUTCDate()).padStart(2, '0');
      const hour = String(d.getUTCHours()).padStart(2, '0');
      const dateStr = `${year}-${month}-${day} ${hour}:00`;

      const existing = timeSeriesMap[dateStr] || { count: 0, avgLatencyMs: 0, errorCount: 0 };
      filledTimeSeries.push({
        time: dateStr,
        ...existing,
      });
    }

    // Map model sentiment distributions
    const modelSentimentMap = {
      v1: { POSITIVE: 0, NEGATIVE: 0, NEUTRAL: 0 },
      v2: { POSITIVE: 0, NEGATIVE: 0, NEUTRAL: 0 }
    };
    modelSentimentStats.forEach((s) => {
      const model = s._id.model;
      const label = s._id.label;
      if (modelSentimentMap[model] && label) {
        modelSentimentMap[model][label] = s.count;
      }
    });

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
      byModel: modelStats.map((m) => {
        const total = m.count || 0;
        const errorCount = m.errorCount || 0;
        const errorRate = total > 0 ? parseFloat(((errorCount / total) * 100).toFixed(2)) : 0;
        
        return {
          version: m._id,
          predictions: total,
          avgLatencyMs: Math.round(m.avgLatency) || 0,
          errorRate: errorRate,
          avgConfidence: m.avgConfidence ? parseFloat(m.avgConfidence.toFixed(4)) : 0,
          sentiment: modelSentimentMap[m._id] || { POSITIVE: 0, NEGATIVE: 0, NEUTRAL: 0 }
        };
      }),
      sentimentDistribution: sentimentStats.map((s) => ({
        sentiment: s._id || 'UNKNOWN',
        count: s.count,
      })),
      timeSeries: filledTimeSeries,
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
