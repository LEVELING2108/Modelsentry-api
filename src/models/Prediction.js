const mongoose = require('mongoose');

const predictionSchema = new mongoose.Schema(
  {
    requestId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    modelVersion: {
      type: String,
      required: true,
      enum: ['v1', 'v2'],
    },
    modelType: {
      type: String,
      required: true,
    },
    // Input payload — store sanitized, never raw user input
    input: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    inputLength: Number,

    // Model output
    output: {
      label: String,
      confidence: Number,
      scores: mongoose.Schema.Types.Mixed,
    },

    // Performance
    latencyMs: {
      type: Number,
      required: true,
    },
    status: {
      type: String,
      enum: ['success', 'error', 'timeout'],
      default: 'success',
    },
    errorMessage: String,

    // Metadata
    clientIp: String,
    userAgent: String,
  },
  {
    timestamps: true,
  }
);

// Compound index for analytics queries
predictionSchema.index({ userId: 1, createdAt: -1 });
predictionSchema.index({ modelVersion: 1, createdAt: -1 });
predictionSchema.index({ status: 1, createdAt: -1 });

// TTL index: auto-delete logs older than 90 days
predictionSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

module.exports = mongoose.model('Prediction', predictionSchema);
