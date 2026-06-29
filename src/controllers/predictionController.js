const { v4: uuidv4 } = require('uuid');
const { runInference, runBatchInference } = require('../services/modelService');
const Prediction = require('../models/Prediction');
const { sendSuccess, sendError } = require('../utils/response');
const logger = require('../utils/logger');
const { consumeUsage } = require('../middleware/auth');

const predict = async (req, res, next) => {
  const requestId = req.requestId || uuidv4();
  const { text, modelVersion, task = 'sentiment', options } = req.body;

  if (req.authType === 'api_key') {
    const userScopes = req.user.apiKeyScopes || [];
    const isWildcard = userScopes.includes('*') || userScopes.includes('predict:*');

    if (!isWildcard) {
      if (task === 'sentiment') {
        if (modelVersion === 'v1' && !userScopes.includes('predict:v1')) {
          return sendError(res, "Forbidden: API key lacks required scope 'predict:v1'", 403);
        }
        if (modelVersion === 'v2' && !userScopes.includes('predict:v2')) {
          return sendError(res, "Forbidden: API key lacks required scope 'predict:v2'", 403);
        }
        if ((modelVersion === 'auto' || !modelVersion) && (!userScopes.includes('predict:v1') || !userScopes.includes('predict:v2'))) {
          return sendError(res, "Forbidden: API key lacks required scopes for auto routing (requires both 'predict:v1' and 'predict:v2')", 403);
        }
      } else {
        const requiredScope = `predict:${task}`;
        if (!userScopes.includes(requiredScope)) {
          return sendError(res, `Forbidden: API key lacks required scope '${requiredScope}'`, 403);
        }
      }
    }
  }

  try {
    const result = await runInference(text, modelVersion, task, options);

    // Persist prediction log (non-blocking)
    Prediction.create({
      requestId,
      userId: req.user._id,
      modelVersion: result.modelVersion,
      modelType: task,
      input: { text: text.substring(0, 500) }, // Truncate for storage
      inputLength: text.length,
      output: {
        label: result.label,
        confidence: result.confidence,
        scores: result.scores,
        summaryText: result.summaryText,
        entities: result.entities,
      },
      latencyMs: result.latencyMs,
      status: 'success',
      clientIp: req.ip,
      userAgent: req.get('User-Agent'),
    }).catch((err) => logger.error('Failed to persist prediction', { error: err.message }));

    // Increment user request count async
    req.user.constructor.findByIdAndUpdate(req.user._id, { $inc: { requestCount: 1 } }).catch(() => {});

    // Consume character usage budget if using an API key
    if (req.authType === 'api_key') {
      let outputLen = 0;
      if (task === 'sentiment') {
        outputLen = 1;
      } else if (task === 'summarization') {
        outputLen = result.summaryText ? result.summaryText.length : 0;
      } else if (task === 'ner') {
        outputLen = result.entities ? JSON.stringify(result.entities).length : 0;
      }
      const totalUsage = text.length + outputLen;
      consumeUsage(req.user._id, req.apiKeyHash, totalUsage).catch(() => {});
    }

    return sendSuccess(res, {
      requestId,
      prediction: {
        ...(result.label && { label: result.label }),
        ...(result.confidence && { confidence: result.confidence }),
        ...(result.scores && { scores: result.scores }),
        ...(result.summaryText && { summaryText: result.summaryText }),
        ...(result.entities && { entities: result.entities }),
      },
      model: {
        version: result.modelVersion,
        type: task,
      },
      performance: {
        latencyMs: result.latencyMs,
        ...(result.cached && { cached: true }),
      },
    });
  } catch (error) {
    // Log failed prediction
    Prediction.create({
      requestId,
      userId: req.user._id,
      modelVersion: req.body.modelVersion === 'auto' ? 'v1' : req.body.modelVersion,
      modelType: task,
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
  const { inputs, modelVersion, task = 'sentiment' } = req.body;
  const batchId = uuidv4();

  if (req.authType === 'api_key') {
    const userScopes = req.user.apiKeyScopes || [];
    const isWildcard = userScopes.includes('*') || userScopes.includes('predict:*');
    if (!isWildcard && task !== 'sentiment') {
      const requiredScope = `predict:${task}`;
      if (!userScopes.includes(requiredScope)) {
        return sendError(res, `Forbidden: API key lacks required scope '${requiredScope}'`, 403);
      }
    }
  }

  try {
    const startMs = Date.now();
    const results = await runBatchInference(inputs, modelVersion, task);
    const totalLatencyMs = Date.now() - startMs;

    const successful = results.filter((r) => !r.error).length;
    const failed = results.length - successful;

    logger.info('Batch prediction complete', {
      batchId,
      total: results.length,
      successful,
      failed,
      totalLatencyMs,
      task,
    });

    // Consume character usage budget for batch if using API key
    if (req.authType === 'api_key') {
      let totalUsage = 0;
      results.forEach((r, idx) => {
        const inputLen = inputs[idx]?.text ? inputs[idx].text.length : 0;
        let outputLen = 0;
        if (!r.error) {
          if (task === 'sentiment') {
            outputLen = 1;
          } else if (task === 'summarization') {
            outputLen = r.summaryText ? r.summaryText.length : 0;
          } else if (task === 'ner') {
            outputLen = r.entities ? JSON.stringify(r.entities).length : 0;
          }
        }
        totalUsage += inputLen + outputLen;
      });

      if (totalUsage > 0) {
        consumeUsage(req.user._id, req.apiKeyHash, totalUsage).catch(() => {});
      }
    }

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
