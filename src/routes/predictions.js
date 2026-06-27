const express = require('express');
const router = express.Router();
const predictionController = require('../controllers/predictionController');
const { authenticate, apiKeyRateLimiter, requireScope } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { predictionSchema, batchPredictionSchema } = require('../utils/schemas');

// All prediction routes require authentication and API key rate limiting
router.use(authenticate);
router.use(apiKeyRateLimiter);

router.post('/', validate(predictionSchema), predictionController.predict);
router.post('/batch', requireScope('predict:batch'), validate(batchPredictionSchema), predictionController.batchPredict);
router.get('/history', requireScope('history:read'), predictionController.getPredictionHistory);

module.exports = router;
