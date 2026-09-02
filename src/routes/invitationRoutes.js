const express = require('express');
const { resolveInvitation, acceptInvitation, openInvitation } = require('../controllers/invitationController');
const router = express.Router();
router.get('/open/:token', openInvitation);
router.get('/:token', resolveInvitation);
router.post('/:token/accept', acceptInvitation);
module.exports = router;
