const express = require('express');
const router = express.Router();
const predictionController = require('../controllers/predictionController');
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { predictionSchema, batchPredictionSchema } = require('../utils/schemas');

// All prediction routes require authentication
router.use(authenticate);

router.post('/', validate(predictionSchema), predictionController.predict);
router.post('/batch', validate(batchPredictionSchema), predictionController.batchPredict);
router.get('/history', predictionController.getPredictionHistory);

module.exports = router;
