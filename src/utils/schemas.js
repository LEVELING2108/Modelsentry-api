const { z } = require('zod');

// --- Auth schemas ---

const registerSchema = z.object({
  name: z
    .string()
    .min(2, 'Name must be at least 2 characters')
    .max(100, 'Name too long')
    .trim(),
  email: z.string().email('Invalid email address').toLowerCase(),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1, 'Password required'),
});

// --- Prediction schemas ---

const predictionSchema = z.object({
  text: z
    .string()
    .min(1, 'Input text is required')
    .max(5000, 'Input text cannot exceed 5000 characters')
    .trim(),
  modelVersion: z.enum(['v1', 'v2', 'auto']).default('auto'),
  options: z
    .object({
      returnScores: z.boolean().default(false),
      topK: z.number().int().min(1).max(10).default(1),
    })
    .optional()
    .default({}),
});

const batchPredictionSchema = z.object({
  inputs: z
    .array(
      z.object({
        id: z.string().min(1).max(100),
        text: z.string().min(1).max(5000).trim(),
      })
    )
    .min(1, 'At least one input required')
    .max(50, 'Batch size cannot exceed 50'),
  modelVersion: z.enum(['v1', 'v2', 'auto']).default('auto'),
});

// --- Admin schemas ---

const updateModelWeightSchema = z.object({
  version: z.enum(['v1', 'v2']),
  weight: z.number().min(0).max(1),
});

module.exports = {
  registerSchema,
  loginSchema,
  predictionSchema,
  batchPredictionSchema,
  updateModelWeightSchema,
};
