const express = require('express');
const { protect } = require('../../middleware/auth/authMiddleware');
const { getTrackingStatus, startTracking, stopTracking } = require('../../controllers/tracking/trackingController');

const router = express.Router();

router.post('/start', protect, startTracking);
router.post('/stop', protect, stopTracking);
router.get('/status', protect, getTrackingStatus);
router.get('/status/:employeeId', protect, getTrackingStatus);

module.exports = router;
