const express = require('express');
const { protect } = require('../middleware/authMiddleware');
const {
  getCurrentLocationsController,
  getHistoryController,
  submitLocation,
  submitLocationBulk,
} = require('../controllers/locationController');

const router = express.Router();

router.post('/', protect, submitLocation);
router.post('/bulk', protect, submitLocationBulk);
router.get('/current', protect, getCurrentLocationsController);
router.get('/current/:employeeId', protect, getCurrentLocationsController);
router.get('/history/:employeeId', protect, getHistoryController);

module.exports = router;
