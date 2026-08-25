const bcrypt = require('bcryptjs');
const User = require('../models/User');
const generateToken = require('../utils/generateToken');
const { userAccessState } = require('../utils/userAccess');
const { emitAdminUserEvent } = require('../services/socketService');

const sanitizeUser = (user) => ({
  id: user._id.toString(),
  fullName: user.fullName,
  employeeId: user.employeeId,
  username: user.username,
  email: user.email,
  phone: user.phone,
  city: user.city,
  area: user.area,
  role: user.role,
  department: user.department,
  joiningDate: user.joiningDate,
  profilePhotoUrl: user.profilePhotoUrl,
  cnic: user.cnic || '',
  cvUrl: user.cvUrl || null,
  selfieUrl: user.selfieUrl || null,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
  ...userAccessState(user),
});

const signup = async (req, res) => {
  try {
    const {
      fullName,
      employeeId,
      username,
      email,
      phone,
      password,
      confirmPassword,
      city,
      area,
      role,
      department,
      joiningDate,
      profilePhotoUrl,
      cnic,
      cvUrl,
      selfieUrl,
    } = req.body;

    if (!fullName || !employeeId || !username || !email || !password) {
      return res.status(400).json({ success: false, message: 'Please fill in all required fields.' });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ success: false, message: 'Passwords do not match.' });
    }

    if (password.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters.' });
    }

    const existingUser = await User.findOne({
      $or: [{ email: email.toLowerCase() }, { username: username.trim() }, { employeeId: employeeId.trim() }],
    });

    if (existingUser) {
      const existingState = userAccessState(existingUser);
      return res.status(409).json({
        success: false,
        code: existingState.approvalStatus === 'pending' ? 'ACCOUNT_PENDING' : 'USER_EXISTS',
        message: existingState.approvalStatus === 'pending'
          ? 'This account is already waiting for admin approval.'
          : 'User already exists.',
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await User.create({
      fullName: fullName.trim(),
      employeeId: employeeId.trim(),
      username: username.trim(),
      email: email.trim().toLowerCase(),
      phone: phone || '',
      password: hashedPassword,
      city: city || '',
      area: area || '',
      role: role || '',
      department: department || '',
      joiningDate: joiningDate || '',
      profilePhotoUrl: profilePhotoUrl || null,
      cnic: cnic || '',
      cvUrl: cvUrl || null,
      selfieUrl: selfieUrl || null,
      approvalStatus: 'pending',
      accountStatus: 'inactive',
    });

    const publicUser = sanitizeUser(user);
    emitAdminUserEvent('admin:user-pending', publicUser);

    return res.status(202).json({
      success: true,
      requiresApproval: true,
      approvalStatus: 'pending',
      message: 'Account submitted successfully. Please wait for admin approval before logging in.',
      user: publicUser,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || 'Signup failed. Please try again.',
    });
  }
};

const login = async (req, res) => {
  try {
    const { identifier, password } = req.body;

    if (!identifier || !password) {
      return res.status(400).json({ success: false, message: 'Username/email and password are required.' });
    }

    const normalizedIdentifier = identifier.trim();
    const user = await User.findOne({
      $or: [{ username: normalizedIdentifier }, { email: normalizedIdentifier.toLowerCase() }],
    });

    if (!user) {
      return res.status(404).json({ success: false, message: 'Username or email not found.' });
    }

    const isMatch = await user.comparePassword(password);

    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Incorrect password.' });
    }

    const { approvalStatus, accountStatus } = userAccessState(user);
    if (approvalStatus === 'pending') {
      return res.status(403).json({ success: false, code: 'ACCOUNT_PENDING', message: 'Your account is waiting for admin approval.' });
    }
    if (approvalStatus === 'rejected') {
      return res.status(403).json({ success: false, code: 'ACCOUNT_REJECTED', message: 'Your account application was rejected. Contact an administrator for help.' });
    }
    if (accountStatus === 'blocked') {
      return res.status(403).json({ success: false, code: 'ACCOUNT_BLOCKED', message: 'Your account has been blocked. Contact an administrator.' });
    }
    if (accountStatus !== 'active') {
      return res.status(403).json({ success: false, code: 'ACCOUNT_INACTIVE', message: 'Your account is inactive. Contact an administrator.' });
    }

    const token = generateToken(user);

    return res.status(200).json({
      success: true,
      message: 'Logged in successfully.',
      token,
      user: sanitizeUser(user),
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || 'Login failed. Please try again.',
    });
  }
};

const getMe = async (req, res) => {
  return res.status(200).json({
    success: true,
    user: sanitizeUser(req.user),
  });
};

module.exports = { signup, login, getMe };
