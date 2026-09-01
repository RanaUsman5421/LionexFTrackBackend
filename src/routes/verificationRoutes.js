const express = require('express');
const { protect } = require('../middleware/authMiddleware');
const {
  acknowledgeNotification,
  cancelVerification,
  completeVerification,
  createVerification,
  currentVerification,
  listVerifications,
  resetBiometricDevice,
} = require('../controllers/verificationController');

const router = express.Router();

router.post('/admin', protect, createVerification);
router.get('/admin', protect, listVerifications);
router.patch('/admin/:verificationId/cancel', protect, cancelVerification);
router.delete('/admin/devices/:employeeId', protect, resetBiometricDevice);
router.get('/current', protect, currentVerification);
router.post('/:verificationId/acknowledge', protect, acknowledgeNotification);
router.post('/:verificationId/complete', protect, completeVerification);

module.exports = router;
