const mongoose = require('mongoose');

const modelMetadataSchema = new mongoose.Schema(
  {
    version: {
      type: String,
      required: true,
      unique: true,
    },
    modelType: {
      type: String,
      required: true,
    },
    description: String,
    labels: [String],
    trafficWeight: {
      type: Number,
      min: 0,
      max: 1,
      default: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    metrics: {
      accuracy: Number,
      f1Score: Number,
      trainedAt: Date,
      datasetSize: Number,
    },
    totalPredictions: {
      type: Number,
      default: 0,
    },
    avgLatencyMs: {
      type: Number,
      default: 0,
    },
    deployedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    deployedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('ModelMetadata', modelMetadataSchema);
