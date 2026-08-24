const express = require('express');
const { protect } = require('../middleware/authMiddleware');
const { createAdmin, listUsers, loginAdmin, updateUser } = require('../controllers/adminController');

const router = express.Router();

const methodHint = (routeName) => (req, res) => {
  res.status(405).json({
    success: false,
    message: `${routeName} expects a POST request. Use the app or Postman to send JSON data.`,
  });
};

router.get('/login', methodHint('Admin login'));
router.post('/login', loginAdmin);

router.get('/create', methodHint('Admin creation'));
router.post('/create', createAdmin);

router.get('/users', protect, listUsers);
router.put('/users/:userId', protect, updateUser);

module.exports = router;
