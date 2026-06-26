const { v4: uuidv4 } = require('uuid');
const { runInference, runBatchInference } = require('../services/modelService');
const Prediction = require('../models/Prediction');
const { sendSuccess, sendError } = require('../utils/response');
const logger = require('../utils/logger');

const predict = async (req, res, next) => {
  const requestId = req.requestId || uuidv4();
  const { text, modelVersion, options } = req.body;

  try {
    const result = await runInference(text, modelVersion, options);

    // Persist prediction log (non-blocking)
    Prediction.create({
      requestId,
      userId: req.user._id,
      modelVersion: result.modelVersion,
      modelType: 'sentiment',
      input: { text: text.substring(0, 500) }, // Truncate for storage
      inputLength: text.length,
      output: {
        label: result.label,
        confidence: result.confidence,
        scores: result.scores,
      },
      latencyMs: result.latencyMs,
      status: 'success',
      clientIp: req.ip,
      userAgent: req.get('User-Agent'),
    }).catch((err) => logger.error('Failed to persist prediction', { error: err.message }));

    // Increment user request count async
    req.user.constructor.findByIdAndUpdate(req.user._id, { $inc: { requestCount: 1 } }).catch(() => {});

    return sendSuccess(res, {
      requestId,
      prediction: {
        label: result.label,
        confidence: result.confidence,
        ...(result.scores && { scores: result.scores }),
      },
      model: {
        version: result.modelVersion,
        type: 'sentiment',
      },
      performance: {
        latencyMs: result.latencyMs,
      },
    });
  } catch (error) {
    // Log failed prediction
    Prediction.create({
      requestId,
      userId: req.user._id,
      modelVersion: req.body.modelVersion === 'auto' ? 'v1' : req.body.modelVersion,
      modelType: 'sentiment',
      input: { text: text.substring(0, 200) },
      inputLength: text.length,
      output: {},
      latencyMs: 0,
      status: error.message.includes('timeout') ? 'timeout' : 'error',
      errorMessage: error.message,
      clientIp: req.ip,
    }).catch(() => {});

    if (error.message.includes('timeout')) {
      return sendError(res, 'Model inference timed out', 504);
    }

    next(error);
  }
};

const batchPredict = async (req, res, next) => {
  const { inputs, modelVersion } = req.body;
  const batchId = uuidv4();

  try {
    const startMs = Date.now();
    const results = await runBatchInference(inputs, modelVersion);
    const totalLatencyMs = Date.now() - startMs;

    const successful = results.filter((r) => !r.error).length;
    const failed = results.length - successful;

    logger.info('Batch prediction complete', {
      batchId,
      total: results.length,
      successful,
      failed,
      totalLatencyMs,
    });

    return sendSuccess(res, {
      batchId,
      results,
      summary: {
        total: results.length,
        successful,
        failed,
        totalLatencyMs,
      },
    });
  } catch (error) {
    next(error);
  }
};

const getPredictionHistory = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip = (page - 1) * limit;

    const filter = { userId: req.user._id };
    if (req.query.modelVersion) filter.modelVersion = req.query.modelVersion;
    if (req.query.status) filter.status = req.query.status;

    const [predictions, total] = await Promise.all([
      Prediction.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .select('-__v'),
      Prediction.countDocuments(filter),
    ]);

    return sendSuccess(res, { predictions }, 200, {
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = { predict, batchPredict, getPredictionHistory };
