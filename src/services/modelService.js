const config = require('../config');
const logger = require('../utils/logger');
const { metrics } = require('../utils/metrics');
const ModelMetadata = require('../models/ModelMetadata');

/**
 * Simulated ML inference — in production this would call a Python FastAPI
 * inference server, SageMaker endpoint, or load a TensorFlow/ONNX model.
 *
 * Sentiment classification example:
 *   labels: POSITIVE | NEGATIVE | NEUTRAL
 */
const LABELS = ['POSITIVE', 'NEGATIVE', 'NEUTRAL'];

// Simulate softmax scores from model weights
const simulateSoftmax = (text, modelVersion) => {
  // Deterministic-ish pseudo-inference based on text characteristics
  const lowerText = text.toLowerCase();
  const positiveWords = ['good', 'great', 'excellent', 'happy', 'love', 'best', 'amazing'];
  const negativeWords = ['bad', 'terrible', 'awful', 'hate', 'worst', 'horrible', 'poor'];

  let positiveScore = 0.33;
  let negativeScore = 0.33;
  let neutralScore = 0.34;

  positiveWords.forEach((w) => { if (lowerText.includes(w)) positiveScore += 0.15; });
  negativeWords.forEach((w) => { if (lowerText.includes(w)) negativeScore += 0.15; });

  // v2 model is "more confident" — demonstrates version differentiation
  const noiseFactor = modelVersion === 'v2' ? 0.05 : 0.12;
  positiveScore += (Math.random() - 0.5) * noiseFactor;
  negativeScore += (Math.random() - 0.5) * noiseFactor;

  const total = positiveScore + negativeScore + neutralScore;
  return {
    POSITIVE: Math.max(0, positiveScore / total),
    NEGATIVE: Math.max(0, negativeScore / total),
    NEUTRAL: Math.max(0, neutralScore / total),
  };
};

/**
 * A/B routing: routes a single request to v1 or v2 based on configured weights.
 * Uses simple random split — production would use consistent hashing by userId.
 */
const selectModelVersion = () => {
  const rand = Math.random();
  return rand < config.model.v1Weight ? 'v1' : 'v2';
};

/**
 * Helper to normalize labels returned by Hugging Face to uppercase POSITIVE, NEGATIVE, or NEUTRAL
 */
const normalizeLabel = (label, modelId) => {
  const l = String(label).toLowerCase();
  if (l === 'positive' || l === 'pos') return 'POSITIVE';
  if (l === 'negative' || l === 'neg') return 'NEGATIVE';
  if (l === 'neutral' || l === 'neu') return 'NEUTRAL';

  // Fallbacks for pipeline index labels
  if (l === 'label_0') return 'NEGATIVE';
  if (l === 'label_1') {
    return modelId.includes('sst-2') ? 'POSITIVE' : 'NEUTRAL';
  }
  if (l === 'label_2') return 'POSITIVE';

  return null;
};

/**
 * Direct call to Hugging Face Inference API using native fetch
 */
const queryHuggingFace = async (text, modelId) => {
  const url = `https://api-inference.huggingface.co/models/${modelId}`;
  const headers = {
    'Content-Type': 'application/json',
  };
  if (config.model.hfApiKey) {
    headers['Authorization'] = `Bearer ${config.model.hfApiKey}`;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ inputs: text }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Hugging Face API error: ${response.status} - ${errText}`);
  }

  const data = await response.json();
  if (Array.isArray(data) && Array.isArray(data[0])) {
    return data[0];
  } else if (Array.isArray(data)) {
    return data;
  }
  throw new Error('Unexpected response format from Hugging Face');
};

/**
 * Core inference function with timeout, metrics, and structured logging.
 */
const runInference = async (text, requestedVersion, options = {}) => {
  const modelVersion = requestedVersion === 'auto' ? selectModelVersion() : requestedVersion;
  const modelType = 'sentiment';

  const endTimer = metrics.predictionDuration.startTimer({
    model_version: modelVersion,
    model_type: modelType,
  });

  const startMs = Date.now();

  try {
    let scores;
    let usedRealModel = false;

    if (config.model.hfApiKey) {
      try {
        const modelId = modelVersion === 'v1' ? config.model.v1ModelId : config.model.v2ModelId;
        const rawResults = await queryHuggingFace(text, modelId);

        scores = { POSITIVE: 0, NEGATIVE: 0, NEUTRAL: 0 };
        rawResults.forEach((item) => {
          const normLabel = normalizeLabel(item.label, modelId);
          if (normLabel) {
            scores[normLabel] = item.score;
          }
        });
        usedRealModel = true;
      } catch (error) {
        logger.warn('Hugging Face inference failed, falling back to simulation', {
          error: error.message,
          modelVersion,
        });
        scores = simulateSoftmax(text, modelVersion);
      }
    } else {
      scores = simulateSoftmax(text, modelVersion);
    }

    // Simulate basic network/inference latency delay if it wasn't real network request
    if (!usedRealModel) {
      const latencyBase = modelVersion === 'v2' ? 40 : 80;
      const latencyMs = latencyBase + Math.random() * 60;
      await new Promise((resolve) => setTimeout(resolve, latencyMs));
    }

    const topLabel = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
    const label = topLabel[0];
    const confidence = topLabel[1];

    const actualLatency = Date.now() - startMs;
    endTimer(); // Record to histogram

    metrics.predictionsTotal.inc({ model_version: modelVersion, model_type: modelType, status: 'success' });

    // Update model stats async (fire-and-forget — non-blocking)
    ModelMetadata.findOneAndUpdate(
      { version: modelVersion },
      {
        $inc: { totalPredictions: 1 },
        $set: { avgLatencyMs: actualLatency },
      }
    ).catch(() => {});

    logger.debug('Inference complete', { modelVersion, label, confidence, latencyMs: actualLatency, realModel: usedRealModel });

    return {
      label,
      confidence: parseFloat(confidence.toFixed(4)),
      scores: options.returnScores ? Object.fromEntries(
        Object.entries(scores).map(([k, v]) => [k, parseFloat(v.toFixed(4))])
      ) : undefined,
      modelVersion,
      latencyMs: actualLatency,
    };
  } catch (error) {
    endTimer();
    metrics.predictionsTotal.inc({ model_version: modelVersion, model_type: modelType, status: 'error' });

    logger.error('Inference failed', { modelVersion, error: error.message });
    throw error;
  }
};

/**
 * Batch inference — runs predictions in parallel with concurrency limit.
 */
const runBatchInference = async (inputs, modelVersion) => {
  const CONCURRENCY = 5;
  const results = [];

  for (let i = 0; i < inputs.length; i += CONCURRENCY) {
    const chunk = inputs.slice(i, i + CONCURRENCY);
    const chunkResults = await Promise.allSettled(
      chunk.map((item) =>
        runInference(item.text, modelVersion).then((result) => ({ id: item.id, ...result }))
      )
    );
    chunkResults.forEach((r, idx) => {
      if (r.status === 'fulfilled') {
        results.push(r.value);
      } else {
        results.push({ id: chunk[idx].id, error: r.reason.message, status: 'error' });
      }
    });
  }

  return results;
};

module.exports = { runInference, runBatchInference, selectModelVersion };
