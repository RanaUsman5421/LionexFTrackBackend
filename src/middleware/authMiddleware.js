const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Admin = require('../models/Admin');
const { canUserAccessApp, userAccessState } = require('../utils/userAccess');

const protect = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Not authorized. Token missing.' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.SECRET_JWT_KEY);
    const user = await User.findById(decoded.id).select('-password');
    const admin = user ? null : await Admin.findById(decoded.id).select('-password');
    const principal = user || admin;

    if (!principal) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    if (user && Number(decoded.authVersion || 0) !== Number(user.authVersion || 0)) {
      return res.status(401).json({ success: false, code: 'SESSION_REVOKED', message: 'This session has been revoked. Please log in again.' });
    }
    if (admin && Number(decoded.authVersion || 0) !== Number(admin.authVersion || 0)) {
      return res.status(401).json({ success: false, code: 'SESSION_REVOKED', message: 'This admin session has been revoked.' });
    }
    if (admin && admin.accountStatus === 'suspended') {
      return res.status(403).json({ success: false, code: 'ACCOUNT_SUSPENDED', message: 'This admin account is suspended.' });
    }

    if (user && !canUserAccessApp(user)) {
      const { approvalStatus, accountStatus } = userAccessState(user);
      const code = approvalStatus === 'pending'
        ? 'ACCOUNT_PENDING'
        : approvalStatus === 'rejected'
          ? 'ACCOUNT_REJECTED'
          : accountStatus === 'blocked'
            ? 'ACCOUNT_BLOCKED'
            : 'ACCOUNT_INACTIVE';
      return res.status(403).json({ success: false, code, message: 'This account is not approved and active.' });
    }

    req.user = principal;
    req.principalType = user ? 'user' : 'admin';
    req.organizationId = principal.organizationId || null;
    if (!req.organizationId) {
      return res.status(403).json({ success: false, code: 'ORGANIZATION_REQUIRED', message: 'This account is not linked to an organization.' });
    }
    next();
  } catch (error) {
    if (error?.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        code: 'TOKEN_EXPIRED',
        message: 'Your session has expired. Please log in again.',
      });
    }

    return res.status(401).json({
      success: false,
      code: 'INVALID_TOKEN',
      message: 'Not authorized. Invalid token.',
    });
  }
};

module.exports = { protect };
