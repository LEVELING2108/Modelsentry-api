const { ZodError } = require('zod');
const { sendValidationError } = require('../utils/response');

/**
 * Returns an Express middleware that validates req.body against a Zod schema.
 * Attaches the parsed (coerced) data back to req.body on success.
 *
 * Usage:
 *   router.post('/predict', authenticate, validate(predictionSchema), predictController)
 */
const validate = (schema) => (req, res, next) => {
  try {
    req.body = schema.parse(req.body);
    next();
  } catch (error) {
    if (error instanceof ZodError) {
      const fields = error.errors.map((e) => ({
        field: e.path.join('.'),
        message: e.message,
      }));
      return sendValidationError(res, fields);
    }
    next(error);
  }
};

/**
 * Validates req.query against a Zod schema.
 */
const validateQuery = (schema) => (req, res, next) => {
  try {
    req.query = schema.parse(req.query);
    next();
  } catch (error) {
    if (error instanceof ZodError) {
      const fields = error.errors.map((e) => ({
        field: e.path.join('.'),
        message: e.message,
      }));
      return sendValidationError(res, fields);
    }
    next(error);
  }
};

module.exports = { validate, validateQuery };
