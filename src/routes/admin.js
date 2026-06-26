const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { authenticate, authorize } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { updateModelWeightSchema } = require('../utils/schemas');

// All admin routes require authenticated admin role
router.use(authenticate, authorize('admin'));

router.get('/models', adminController.getModels);
router.patch('/models/weights', validate(updateModelWeightSchema), adminController.updateTrafficWeights);
router.get('/analytics', adminController.getAnalytics);

module.exports = router;
