const express = require('express');
const { protect } = require('../middleware/authMiddleware');
const {
  getActivityController,
  getDutyController,
  getFollowUpsController,
  getLeadsController,
  getSnapshotController,
  getSummaryController,
  uploadLeadPhotoController,
  uploadProfilePhotoController,
  syncSnapshot,
} = require('../controllers/appDataController');

const router = express.Router();

router.post('/snapshot', protect, syncSnapshot);
router.post('/upload-photo', protect, express.raw({ type: 'multipart/form-data', limit: '25mb' }), uploadLeadPhotoController);
router.post('/upload-profile-photo', protect, express.raw({ type: 'multipart/form-data', limit: '25mb' }), uploadProfilePhotoController);
router.get('/snapshot/:employeeId', protect, getSnapshotController);
router.get('/summary/:employeeId', protect, getSummaryController);
router.get('/duty/:employeeId', protect, getDutyController);
router.get('/leads/:employeeId', protect, getLeadsController);
router.get('/follow-ups/:employeeId', protect, getFollowUpsController);
router.get('/activity/:employeeId', protect, getActivityController);

module.exports = router;
