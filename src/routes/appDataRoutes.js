const express = require('express');
const { protect } = require('../middleware/authMiddleware');
const {
  getActivityController,
  getDutyController,
  getFollowUpsController,
  getLeadsController,
  updateLeadController,
  deleteLeadController,
  getSnapshotController,
  getSummaryController,
  uploadLeadPhotoController,
  uploadProfilePhotoController,
  syncSnapshot,
  syncEntitiesController,
  getEntityBundleController,
  subscribeToAppData,
} = require('../controllers/appDataController');

const router = express.Router();

router.post('/snapshot', protect, syncSnapshot);
router.post('/entities/sync', protect, syncEntitiesController);
router.get('/entities/:employeeId', protect, getEntityBundleController);
router.get('/events', protect, subscribeToAppData);
router.post('/upload-photo', protect, express.raw({ type: 'multipart/form-data', limit: '25mb' }), uploadLeadPhotoController);
router.post('/upload-profile-photo', protect, express.raw({ type: 'multipart/form-data', limit: '25mb' }), uploadProfilePhotoController);
router.get('/snapshot/:employeeId', protect, getSnapshotController);
router.get('/summary/:employeeId', protect, getSummaryController);
router.get('/duty/:employeeId', protect, getDutyController);
router.get('/leads/:employeeId', protect, getLeadsController);
router.put('/leads/:employeeId/:leadId', protect, updateLeadController);
router.delete('/leads/:employeeId/:leadId', protect, deleteLeadController);
router.get('/follow-ups/:employeeId', protect, getFollowUpsController);
router.get('/activity/:employeeId', protect, getActivityController);

module.exports = router;
