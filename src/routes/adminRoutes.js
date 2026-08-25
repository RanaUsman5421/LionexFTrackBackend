const express = require('express');
const { protect } = require('../middleware/authMiddleware');
const { approveUser, changeUserStatus, createAdmin, createUser, deleteUser, listUsers, loginAdmin, rejectUser, updateUser } = require('../controllers/adminController');

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
router.post('/users', protect, createUser);
router.put('/users/:userId', protect, updateUser);
router.patch('/users/:userId/status', protect, changeUserStatus);
router.patch('/users/:userId/approve', protect, approveUser);
router.patch('/users/:userId/reject', protect, rejectUser);
router.delete('/users/:userId', protect, deleteUser);

module.exports = router;
