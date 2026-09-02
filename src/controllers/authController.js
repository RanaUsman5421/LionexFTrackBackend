const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const User = require('../models/User');
const PasswordReset = require('../models/PasswordReset');
const generateToken = require('../utils/generateToken');
const { userAccessState } = require('../utils/userAccess');
const { emitAdminUserEvent } = require('../services/socketService');
const { sendPasswordResetEmail } = require('../services/passwordResetEmailService');
const Organization = require('../models/Organization');

const OTP_EXPIRY_MINUTES = 10;
const OTP_RESEND_DELAY_MS = 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;
const RESET_TOKEN_EXPIRY_MS = 10 * 60 * 1000;
const GENERIC_RESET_MESSAGE = 'If an account exists for that email, a verification code has been sent.';

const resetSecret = () => process.env.PASSWORD_RESET_SECRET || process.env.SECRET_JWT_KEY;
const hashOtp = (email, otp) => crypto
  .createHmac('sha256', resetSecret())
  .update(`${email}:${otp}`)
  .digest('hex');
const hashResetToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

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
  organizationId: user.organizationId ? String(user.organizationId) : null,
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

    const defaultOrganization = await Organization.findOne({ status: 'active' }).sort({ createdAt: 1 });
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
      organizationId: defaultOrganization?._id || null,
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

const requestPasswordReset = async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      return res.status(400).json({ success: false, message: 'Enter a valid registered email address.' });
    }
    if (!resetSecret()) {
      throw new Error('PASSWORD_RESET_SECRET or SECRET_JWT_KEY must be configured.');
    }

    const user = await User.findOne({ email }).select('fullName email');
    if (!user) {
      return res.status(200).json({ success: true, message: GENERIC_RESET_MESSAGE });
    }

    const now = new Date();
    const existingReset = await PasswordReset.findOne({ email });
    if (existingReset?.resendAvailableAt > now) {
      return res.status(200).json({ success: true, message: GENERIC_RESET_MESSAGE });
    }

    const otp = crypto.randomInt(100000, 1000000).toString();
    const otpExpiresAt = new Date(now.getTime() + OTP_EXPIRY_MINUTES * 60 * 1000);
    const passwordReset = await PasswordReset.findOneAndUpdate(
      { email },
      {
        email,
        otpHash: hashOtp(email, otp),
        otpExpiresAt,
        attempts: 0,
        resendAvailableAt: new Date(now.getTime() + OTP_RESEND_DELAY_MS),
        verified: false,
        resetTokenHash: null,
        resetTokenExpiresAt: null,
        expiresAt: otpExpiresAt,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    try {
      await sendPasswordResetEmail({
        to: email,
        name: user.fullName,
        otp,
        expiresInMinutes: OTP_EXPIRY_MINUTES,
      });
    } catch (emailError) {
      await PasswordReset.deleteOne({ _id: passwordReset._id });
      throw emailError;
    }

    return res.status(200).json({ success: true, message: GENERIC_RESET_MESSAGE });
  } catch (error) {
    console.error('Password reset email failed:', error.message);
    return res.status(503).json({
      success: false,
      message: 'We could not send the verification email right now. Please try again shortly.',
    });
  }
};

const verifyPasswordResetOtp = async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const otp = String(req.body.otp || '').trim();
    if (!/^\S+@\S+\.\S+$/.test(email) || !/^\d{6}$/.test(otp)) {
      return res.status(400).json({ success: false, message: 'Enter the email and six-digit verification code.' });
    }
    if (!resetSecret()) throw new Error('Password reset secret is not configured.');

    const reset = await PasswordReset.findOne({ email });
    const now = new Date();
    if (!reset || !reset.otpHash || reset.otpExpiresAt <= now) {
      return res.status(400).json({ success: false, code: 'OTP_EXPIRED', message: 'The verification code has expired. Request a new one.' });
    }
    if (reset.attempts >= MAX_OTP_ATTEMPTS) {
      await PasswordReset.deleteOne({ _id: reset._id });
      return res.status(429).json({ success: false, code: 'OTP_ATTEMPTS_EXCEEDED', message: 'Too many incorrect attempts. Request a new code.' });
    }

    if (reset.otpHash !== hashOtp(email, otp)) {
      reset.attempts += 1;
      await reset.save();
      return res.status(400).json({ success: false, message: 'The verification code is incorrect.' });
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    reset.verified = true;
    reset.otpHash = null;
    reset.otpExpiresAt = null;
    reset.resetTokenHash = hashResetToken(resetToken);
    reset.resetTokenExpiresAt = new Date(now.getTime() + RESET_TOKEN_EXPIRY_MS);
    reset.expiresAt = reset.resetTokenExpiresAt;
    await reset.save();

    return res.status(200).json({
      success: true,
      message: 'Code verified. You can now create a new password.',
      resetToken,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Verification failed. Please try again.' });
  }
};

const resetPassword = async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const resetToken = String(req.body.resetToken || '');
    const password = String(req.body.password || '');
    const confirmPassword = String(req.body.confirmPassword || '');

    if (!email || !resetToken) {
      return res.status(400).json({ success: false, message: 'Your reset session is invalid. Request a new code.' });
    }
    if (password.length < 8 || password.length > 128) {
      return res.status(400).json({ success: false, message: 'Password must be between 8 and 128 characters.' });
    }
    if (password !== confirmPassword) {
      return res.status(400).json({ success: false, message: 'Passwords do not match.' });
    }

    const reset = await PasswordReset.findOne({
      email,
      verified: true,
      resetTokenHash: hashResetToken(resetToken),
      resetTokenExpiresAt: { $gt: new Date() },
    });
    if (!reset) {
      return res.status(400).json({ success: false, message: 'Your reset session has expired. Request a new code.' });
    }

    const user = await User.findOne({ email });
    if (!user) {
      await PasswordReset.deleteOne({ _id: reset._id });
      return res.status(400).json({ success: false, message: 'Your reset session is invalid.' });
    }

    user.password = await bcrypt.hash(password, 10);
    user.authVersion = Number(user.authVersion || 0) + 1;
    await user.save();
    await PasswordReset.deleteOne({ _id: reset._id });

    return res.status(200).json({ success: true, message: 'Your password has been reset successfully. You can now log in.' });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Password reset failed. Please try again.' });
  }
};

module.exports = {
  signup,
  login,
  getMe,
  requestPasswordReset,
  verifyPasswordResetOtp,
  resetPassword,
};
