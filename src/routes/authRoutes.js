const express = require('express');
const {
  getMe,
  login,
  signup,
  requestPasswordReset,
  verifyPasswordResetOtp,
  resetPassword,
} = require('../controllers/authController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

const methodHint = (routeName) => (req, res) => {
  res.status(405).json({
    success: false,
    message: `${routeName} expects a POST request. Use the app or Postman to send JSON data.`
  });
};

router.get('/signup', methodHint('Signup'));
router.post('/signup', signup);

router.get('/login', methodHint('Login'));
router.post('/login', login);

router.post('/password-reset/request', requestPasswordReset);
router.post('/password-reset/verify', verifyPasswordResetOtp);
router.post('/password-reset/confirm', resetPassword);

router.get('/me', protect, getMe);

module.exports = router;
