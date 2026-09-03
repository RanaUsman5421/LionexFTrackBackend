const express = require('express');
const { protect } = require('../middleware/authMiddleware');
const { approveUser, changeUserStatus, createAdmin, createUser, deleteUser, listUsers, loginAdmin, rejectUser, updateUser } = require('../controllers/adminController');
const { getOrganization, updateOrganization, listAdmins } = require('../controllers/organizationController');
const { createInvitation, listInvitations, revokeInvitation, resendInvitation } = require('../controllers/invitationController');
const { requestOwnerSignup, verifyOwnerSignup } = require('../controllers/ownerSignupController');
const { getReport } = require('../controllers/reportController');

const router = express.Router();

const methodHint = (routeName) => (req, res) => {
  res.status(405).json({
    success: false,
    message: `${routeName} expects a POST request. Use the app or Postman to send JSON data.`,
  });
};

router.get('/login', methodHint('Admin login'));
router.post('/login', loginAdmin);
router.post('/signup/request', requestOwnerSignup);
router.post('/signup/verify', verifyOwnerSignup);

router.get('/create', methodHint('Admin creation'));
router.post('/create', createAdmin);

router.get('/users', protect, listUsers);
router.post('/users', protect, createUser);
router.put('/users/:userId', protect, updateUser);
router.patch('/users/:userId/status', protect, changeUserStatus);
router.patch('/users/:userId/approve', protect, approveUser);
router.patch('/users/:userId/reject', protect, rejectUser);
router.delete('/users/:userId', protect, deleteUser);
router.get('/organization', protect, getOrganization);
router.patch('/organization', protect, updateOrganization);
router.get('/admins', protect, listAdmins);
router.get('/invitations', protect, listInvitations);
router.get('/reports', protect, getReport);
router.post('/invitations', protect, createInvitation);
router.post('/invitations/:invitationId/resend', protect, resendInvitation);
router.patch('/invitations/:invitationId/revoke', protect, revokeInvitation);

module.exports = router;
