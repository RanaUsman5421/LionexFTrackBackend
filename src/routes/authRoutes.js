const express = require('express');
const { signup, login, getMe } = require('../controllers/authController');
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

router.get('/me', protect, getMe);

module.exports = router;
