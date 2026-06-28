const crypto = require('crypto');
const config = require('../config');
const logger = require('../utils/logger');
const { metrics } = require('../utils/metrics');
const ModelMetadata = require('../models/ModelMetadata');
const redisCache = require('../config/redis');

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

const simulateSummarization = (text, modelVersion) => {
  const sentences = text.split(/[.!?]+/).map(s => s.trim()).filter(Boolean);
  let summary = sentences.slice(0, Math.min(2, sentences.length)).join('. ');
  if (summary && !summary.endsWith('.')) summary += '.';
  if (!summary) summary = "No input content available to summarize.";
  return `[${modelVersion.toUpperCase()} Summary] ${summary}`;
};

const simulateNer = (text, modelVersion) => {
  const words = text.split(/[^a-zA-Z]/).filter(w => w.length > 3);
  const entities = [];
  const types = ['PER', 'LOC', 'ORG'];
  
  words.forEach((word) => {
    if (word[0] === word[0].toUpperCase() && Math.random() > 0.4) {
      const type = types[Math.floor(Math.random() * types.length)];
      entities.push({
        entity: type,
        word,
        score: parseFloat((0.80 + Math.random() * 0.19).toFixed(4)),
      });
    }
  });

  if (entities.length === 0) {
    entities.push({ entity: 'ORG', word: 'ModelSentry Gateway', score: 0.999 });
  }

  return entities;
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
 * Safe JSON clean helper to parse LLM outputs.
 */
const parseFallbackResponse = (responseText, task, options = {}) => {
  const cleanText = responseText.replace(/```json/g, '').replace(/```/g, '').trim();

  if (task === 'sentiment') {
    try {
      const parsed = JSON.parse(cleanText);
      const payload = {
        label: parsed.label,
        confidence: parseFloat(parsed.confidence) || 1.0,
      };
      if (options.returnScores && parsed.scores) {
        payload.scores = parsed.scores;
      }
      return payload;
    } catch (err) {
      // Fallback parse if LLM returns text instead of valid JSON
      logger.warn('Failed to parse sentiment JSON from fallback provider, attempting text matching', { responseText });
      const lowerText = cleanText.toLowerCase();
      let label = 'NEUTRAL';
      if (lowerText.includes('positive')) label = 'POSITIVE';
      else if (lowerText.includes('negative')) label = 'NEGATIVE';
      
      const payload = { label, confidence: 1.0 };
      if (options.returnScores) {
        payload.scores = {
          POSITIVE: label === 'POSITIVE' ? 1.0 : 0.0,
          NEGATIVE: label === 'NEGATIVE' ? 1.0 : 0.0,
          NEUTRAL: label === 'NEUTRAL' ? 1.0 : 0.0,
        };
      }
      return payload;
    }
  }

  if (task === 'summarization') {
    return {
      summaryText: cleanText
    };
  }

  if (task === 'ner') {
    try {
      const parsed = JSON.parse(cleanText);
      if (Array.isArray(parsed)) {
        return {
          entities: parsed.map(item => ({
            entity: item.entity || 'MISC',
            word: item.word || '',
            score: parseFloat(item.score) || 1.0
          }))
        };
      }
      return { entities: [] };
    } catch (err) {
      logger.warn('Failed to parse NER JSON from fallback provider', { responseText });
      return { entities: [] };
    }
  }

  throw new Error(`Unsupported task in parseFallbackResponse: ${task}`);
};

/**
 * Direct call to upstream fallback providers (OpenAI, Gemini, or self-hosted API)
 */
const queryFallbackProvider = async (text, task, modelVersion, options) => {
  const provider = (config.fallback?.provider || '').toLowerCase();
  
  if (provider === 'openai') {
    if (!config.fallback.openai.apiKey) {
      throw new Error('OpenAI API key is missing');
    }
    
    let systemPrompt = '';
    if (task === 'sentiment') {
      systemPrompt = "You are a sentiment analysis classifier. Classify the user text into one of the following labels: POSITIVE, NEGATIVE, or NEUTRAL. Return ONLY a valid JSON object matching this schema: {\"label\": \"POSITIVE\" | \"NEGATIVE\" | \"NEUTRAL\", \"confidence\": float (0.0 to 1.0), \"scores\": {\"POSITIVE\": float, \"NEGATIVE\": float, \"NEUTRAL\": float}}. Make sure the scores sum to 1.0. Do not write any markdown code block backticks (e.g. ```json) or any extra explanation.";
    } else if (task === 'summarization') {
      systemPrompt = "You are a text summarizer. Summarize the user text. Return only the summary text without any prefix, markdown, formatting, or extra details.";
    } else if (task === 'ner') {
      systemPrompt = "You are a Named Entity Recognition (NER) classifier. Identify entities of type PER (person), LOC (location), and ORG (organization) in the user text. Return ONLY a JSON array of objects. Each object must have keys: 'entity' (must be PER, LOC, or ORG), 'word' (the matched text), and 'score' (a float confidence score between 0.8 and 1.0). Do not write any markdown code block backticks (e.g. ```json) or any extra explanation. Return an empty array [] if no entities are found.";
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.fallback.openai.apiKey}`
      },
      body: JSON.stringify({
        model: config.fallback.openai.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: text }
        ],
        temperature: 0
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${errText}`);
    }

    const resJson = await response.json();
    const responseText = resJson.choices?.[0]?.message?.content;
    if (!responseText) {
      throw new Error('Empty response from OpenAI');
    }

    return parseFallbackResponse(responseText, task, options);
  }

  if (provider === 'gemini') {
    if (!config.fallback.gemini.apiKey) {
      throw new Error('Gemini API key is missing');
    }

    let systemPrompt = '';
    if (task === 'sentiment') {
      systemPrompt = "You are a sentiment analysis classifier. Classify the user text into one of the following labels: POSITIVE, NEGATIVE, or NEUTRAL. Return ONLY a valid JSON object matching this schema: {\"label\": \"POSITIVE\" | \"NEGATIVE\" | \"NEUTRAL\", \"confidence\": float (0.0 to 1.0), \"scores\": {\"POSITIVE\": float, \"NEGATIVE\": float, \"NEUTRAL\": float}}. Make sure the scores sum to 1.0. Do not write any markdown code block backticks (e.g. ```json) or any extra explanation.";
    } else if (task === 'summarization') {
      systemPrompt = "You are a text summarizer. Summarize the user text. Return only the summary text without any prefix, markdown, formatting, or extra details.";
    } else if (task === 'ner') {
      systemPrompt = "You are a Named Entity Recognition (NER) classifier. Identify entities of type PER (person), LOC (location), and ORG (organization) in the user text. Return ONLY a JSON array of objects. Each object must have keys: 'entity' (must be PER, LOC, or ORG), 'word' (the matched text), and 'score' (a float confidence score between 0.8 and 1.0). Do not write any markdown code block backticks (e.g. ```json) or any extra explanation. Return an empty array [] if no entities are found.";
    }

    const modelName = config.fallback.gemini.model;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${config.fallback.gemini.apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: `${systemPrompt}\n\nUser Text:\n${text}` }]
          }
        ],
        generationConfig: {
          temperature: 0
        }
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gemini API error: ${response.status} - ${errText}`);
    }

    const resJson = await response.json();
    const responseText = resJson.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!responseText) {
      throw new Error('Empty response from Gemini');
    }

    return parseFallbackResponse(responseText, task, options);
  }

  if (provider === 'self-hosted') {
    if (!config.fallback.selfHosted.url) {
      throw new Error('Self-hosted URL is missing');
    }

    const headers = { 'Content-Type': 'application/json' };
    if (config.fallback.selfHosted.apiKey) {
      headers['Authorization'] = `Bearer ${config.fallback.selfHosted.apiKey}`;
    }

    const response = await fetch(config.fallback.selfHosted.url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ text, task, modelVersion })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Self-hosted API error: ${response.status} - ${errText}`);
    }

    return await response.json();
  }

  throw new Error(`Unsupported fallback provider: ${provider}`);
};

/**
 * Core inference function with timeout, metrics, and structured logging.
 */
const runInference = async (text, requestedVersion, task = 'sentiment', options = {}) => {
  const modelVersion = requestedVersion === 'auto' ? selectModelVersion() : requestedVersion;
  const modelType = task;

  const startMs = Date.now();
  const textHash = crypto.createHash('md5').update(text).digest('hex');
  const cacheKey = `inference:${task}:${modelVersion}:${textHash}:${options.returnScores ? 'scores' : 'simple'}`;

  try {
    // Try fetching from Redis cache first
    const cachedResult = await redisCache.get(cacheKey);
    if (cachedResult) {
      const actualLatency = Date.now() - startMs;
      logger.debug('Inference cache hit', { modelVersion, task, latencyMs: actualLatency });

      // Update model stats async (fire-and-forget — non-blocking)
      ModelMetadata.findOne({ version: modelVersion })
        .then((meta) => {
          if (meta) {
            const currentTotal = meta.totalPredictions || 0;
            const currentAvg = meta.avgLatencyMs || 0;
            const newTotal = currentTotal + 1;
            const newAvg = ((currentAvg * currentTotal) + actualLatency) / newTotal;

            meta.totalPredictions = newTotal;
            meta.avgLatencyMs = parseFloat(newAvg.toFixed(2));
            return meta.save();
          }
        })
        .catch(() => {});

      return {
        ...cachedResult,
        cached: true,
        latencyMs: actualLatency,
      };
    }
  } catch (err) {
    logger.warn('Failed to read from Redis cache', { error: err.message });
  }

  const endTimer = metrics.predictionDuration.startTimer({
    model_version: modelVersion,
    model_type: modelType,
  });

  try {
    let rawResults;
    let usedRealModel = false;
    let fallbackPayload = null;
    let modelId = '';

    if (task === 'sentiment') {
      modelId = modelVersion === 'v1' ? config.model.v1ModelId : config.model.v2ModelId;
    } else if (task === 'summarization') {
      modelId = modelVersion === 'v1' ? config.model.v1SummarizationId : config.model.v2SummarizationId;
    } else if (task === 'ner') {
      modelId = modelVersion === 'v1' ? config.model.v1NerId : config.model.v2NerId;
    }

    // Try Hugging Face first
    if (config.model.hfApiKey && modelId) {
      try {
        rawResults = await queryHuggingFace(text, modelId);
        usedRealModel = true;
      } catch (error) {
        logger.warn('Hugging Face inference failed, trying fallback provider', {
          error: error.message,
          modelVersion,
          task,
        });
      }
    }

    // Try Fallback Provider if Hugging Face was not tried or failed
    if (!usedRealModel && config.fallback && config.fallback.provider) {
      try {
        fallbackPayload = await queryFallbackProvider(text, task, modelVersion, options);
        if (fallbackPayload) {
          usedRealModel = true;
        }
      } catch (error) {
        logger.warn('Fallback provider inference failed, falling back to simulation', {
          error: error.message,
          fallbackProvider: config.fallback.provider,
          modelVersion,
          task,
        });
      }
    }

    // Simulate basic network/inference latency delay if it wasn't real network request
    if (!usedRealModel) {
      const latencyBase = modelVersion === 'v2' ? 40 : 80;
      const latencyMs = latencyBase + Math.random() * 60;
      await new Promise((resolve) => setTimeout(resolve, latencyMs));
    }

    let resultPayload = { modelVersion };

    if (fallbackPayload) {
      Object.assign(resultPayload, fallbackPayload);
    } else if (task === 'sentiment') {
      let scores;
      if (usedRealModel && Array.isArray(rawResults)) {
        scores = { POSITIVE: 0, NEGATIVE: 0, NEUTRAL: 0 };
        rawResults.forEach((item) => {
          const normLabel = normalizeLabel(item.label, modelId);
          if (normLabel) {
            scores[normLabel] = item.score;
          }
        });
      } else {
        scores = simulateSoftmax(text, modelVersion);
      }

      const topLabel = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
      resultPayload.label = topLabel[0];
      resultPayload.confidence = parseFloat(topLabel[1].toFixed(4));
      if (options.returnScores) {
        resultPayload.scores = Object.fromEntries(
          Object.entries(scores).map(([k, v]) => [k, parseFloat(v.toFixed(4))])
        );
      }
    } else if (task === 'summarization') {
      let summaryText = '';
      if (usedRealModel && Array.isArray(rawResults) && rawResults[0]?.summary_text) {
        summaryText = rawResults[0].summary_text;
      } else {
        summaryText = simulateSummarization(text, modelVersion);
      }
      resultPayload.summaryText = summaryText;
    } else if (task === 'ner') {
      let entities = [];
      if (usedRealModel && Array.isArray(rawResults)) {
        entities = rawResults.map(item => ({
          entity: item.entity_group || item.entity || 'MISC',
          word: item.word,
          score: parseFloat(item.score.toFixed(4))
        }));
      } else {
        entities = simulateNer(text, modelVersion);
      }
      resultPayload.entities = entities;
    }

    const actualLatency = Date.now() - startMs;
    endTimer(); // Record to histogram

    metrics.predictionsTotal.inc({ model_version: modelVersion, model_type: modelType, status: 'success' });

    // Update model stats async (fire-and-forget — non-blocking)
    ModelMetadata.findOne({ version: modelVersion })
      .then((meta) => {
        if (meta) {
          const currentTotal = meta.totalPredictions || 0;
          const currentAvg = meta.avgLatencyMs || 0;
          const newTotal = currentTotal + 1;
          const newAvg = ((currentAvg * currentTotal) + actualLatency) / newTotal;

          meta.totalPredictions = newTotal;
          meta.avgLatencyMs = parseFloat(newAvg.toFixed(2));
          return meta.save();
        }
      })
      .catch((err) => {
        logger.error('Failed to update model stats', { error: err.message, modelVersion });
      });

    logger.debug('Inference complete', { modelVersion, task, latencyMs: actualLatency, realModel: usedRealModel });

    // Cache the result in Redis async (fire-and-forget)
    redisCache.set(cacheKey, resultPayload).catch(() => {});

    return {
      ...resultPayload,
      latencyMs: actualLatency,
    };
  } catch (error) {
    endTimer();
    metrics.predictionsTotal.inc({ model_version: modelVersion, model_type: modelType, status: 'error' });

    logger.error('Inference failed', { modelVersion, task, error: error.message });
    throw error;
  }
};

/**
 * Batch inference — runs predictions in parallel with concurrency limit.
 */
const runBatchInference = async (inputs, modelVersion, task = 'sentiment') => {
  const CONCURRENCY = 5;
  const results = [];

  for (let i = 0; i < inputs.length; i += CONCURRENCY) {
    const chunk = inputs.slice(i, i + CONCURRENCY);
    const chunkResults = await Promise.allSettled(
      chunk.map((item) =>
        runInference(item.text, modelVersion, task).then((result) => ({ id: item.id, ...result }))
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
