const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const Admin = require('../models/Admin');
const Organization = require('../models/Organization');
const AdminSignupChallenge = require('../models/AdminSignupChallenge');
const generateToken = require('../utils/generateToken');
const { generateCompanyCode } = require('../services/organizationBootstrapService');
const { sendAdminSignupEmail } = require('../services/passwordResetEmailService');
const { CATEGORY_MODULES } = require('./organizationController');
const { permissionsFor } = require('../utils/adminPermissions');

const OTP_MINUTES = 10;
const MAX_ATTEMPTS = 5;
const secret = () => process.env.ADMIN_SIGNUP_SECRET || process.env.PASSWORD_RESET_SECRET || process.env.SECRET_JWT_KEY;
const digest = (value) => crypto.createHmac('sha256', secret()).update(value).digest('hex');
const normalizeEmail = (value) => String(value || '').trim().toLowerCase();
const safeEqual = (left, right) => {
  const a = Buffer.from(String(left)); const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

const requestOwnerSignup = async (req, res) => {
  try {
    if (!secret()) throw new Error('Admin signup secret is not configured.');
    const fullName = String(req.body?.fullName || '').trim();
    const username = String(req.body?.username || '').trim();
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || '');
    const confirmPassword = String(req.body?.confirmPassword || '');
    const companyName = String(req.body?.companyName || '').trim();
    const category = String(req.body?.category || 'general').trim();
    if (!fullName || !username || !companyName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ success: false, message: 'Name, username, valid email, and company name are required.' });
    if (!/^[a-zA-Z0-9._-]{3,50}$/.test(username)) return res.status(400).json({ success: false, message: 'Username must be 3–50 letters, numbers, dots, dashes, or underscores.' });
    if (password.length < 8 || password.length > 128 || password !== confirmPassword) return res.status(400).json({ success: false, message: 'Matching password of 8–128 characters is required.' });
    if (!CATEGORY_MODULES[category]) return res.status(400).json({ success: false, message: 'Select a valid field category.' });
    if (await Admin.exists({ $or: [{ email }, { username }] })) return res.status(409).json({ success: false, message: 'This email or username is already registered.' });

    const existing = await AdminSignupChallenge.findOne({ email }).select('resendAvailableAt');
    if (existing?.resendAvailableAt > new Date()) return res.status(429).json({ success: false, message: 'Please wait one minute before requesting another code.' });
    const requestIpHash = digest(`ip:${req.ip || req.socket?.remoteAddress || 'unknown'}`);
    const recentForIp = await AdminSignupChallenge.countDocuments({ requestIpHash, updatedAt: { $gte: new Date(Date.now() - 15 * 60_000) } });
    if (recentForIp >= 10) return res.status(429).json({ success: false, message: 'Too many signup requests. Please try again later.' });

    const otp = crypto.randomInt(100000, 1000000).toString();
    const challenge = await AdminSignupChallenge.findOneAndUpdate({ email }, {
      $set: {
        otpHash: digest(`${email}:${otp}`), attempts: 0, claimedAt: null, requestIpHash,
        resendAvailableAt: new Date(Date.now() + 60_000), expiresAt: new Date(Date.now() + OTP_MINUTES * 60_000),
        registration: { fullName, username, passwordHash: await bcrypt.hash(password, 10), companyName, category },
      },
    }, { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true });
    try {
      await sendAdminSignupEmail({ to: email, name: fullName, otp, companyName, expiresInMinutes: OTP_MINUTES });
    } catch (error) {
      await AdminSignupChallenge.deleteOne({ _id: challenge._id });
      throw error;
    }
    return res.status(200).json({ success: true, message: 'Verification code sent to your email.' });
  } catch (error) {
    return res.status(503).json({ success: false, message: error.message || 'Could not start admin signup.' });
  }
};

const verifyOwnerSignup = async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const otp = String(req.body?.otp || '').trim();
  if (!/^\d{6}$/.test(otp)) return res.status(400).json({ success: false, message: 'Enter the six-digit verification code.' });
  const challenge = await AdminSignupChallenge.findOne({ email }).select('+otpHash +registration.passwordHash');
  if (!challenge || challenge.expiresAt <= new Date() || challenge.claimedAt) return res.status(400).json({ success: false, message: 'The verification code is invalid or expired.' });
  if (challenge.attempts >= MAX_ATTEMPTS) return res.status(429).json({ success: false, message: 'Too many incorrect attempts. Request a new code.' });
  if (!safeEqual(challenge.otpHash, digest(`${email}:${otp}`))) {
    await AdminSignupChallenge.updateOne({ _id: challenge._id }, { $inc: { attempts: 1 } });
    return res.status(400).json({ success: false, message: 'The verification code is incorrect.' });
  }
  const claimed = await AdminSignupChallenge.updateOne({ _id: challenge._id, claimedAt: null }, { $set: { claimedAt: new Date() } });
  if (claimed.modifiedCount !== 1) return res.status(409).json({ success: false, message: 'This signup has already been completed.' });

  const session = await mongoose.startSession();
  let admin;
  try {
    await session.withTransaction(async () => {
      if (await Admin.exists({ $or: [{ email }, { username: challenge.registration.username }] }).session(session)) {
        const conflict = new Error('This email or username is already registered.'); conflict.statusCode = 409; throw conflict;
      }
      let companyCode;
      do { companyCode = generateCompanyCode(); } while (await Organization.exists({ companyCode }).session(session));
      const [organization] = await Organization.create([{
        name: challenge.registration.companyName, companyCode, category: challenge.registration.category,
        enabledModules: CATEGORY_MODULES[challenge.registration.category],
        settings: { manualEmployeeApproval: ['pharmaceutical', 'banking'].includes(challenge.registration.category) },
      }], { session });
      const [createdAdmin] = await Admin.create([{
        fullName: challenge.registration.fullName, employeeId: `ADMIN-${crypto.randomBytes(5).toString('hex').toUpperCase()}`,
        username: challenge.registration.username, email, password: challenge.registration.passwordHash,
        role: 'admin', adminRole: 'owner', accountStatus: 'active', organizationId: organization._id,
      }], { session });
      organization.ownerAdminId = createdAdmin._id;
      await organization.save({ session });
      admin = createdAdmin;
    });
    await AdminSignupChallenge.deleteOne({ _id: challenge._id });
    return res.status(201).json({ success: true, message: 'Organization and Owner account created.', token: generateToken(admin), user: {
      id: String(admin._id), fullName: admin.fullName, employeeId: admin.employeeId, username: admin.username, email: admin.email,
      role: admin.role, adminRole: admin.adminRole, organizationId: String(admin.organizationId), permissions: permissionsFor(admin), accountStatus: admin.accountStatus,
      organization: { id: String(admin.organizationId), name: challenge.registration.companyName, category: challenge.registration.category, enabledModules: CATEGORY_MODULES[challenge.registration.category] },
    } });
  } catch (error) {
    await AdminSignupChallenge.updateOne({ _id: challenge._id }, { $set: { claimedAt: null } });
    return res.status(error.statusCode || (error?.code === 11000 ? 409 : 500)).json({ success: false, message: error.message || 'Could not complete admin signup.' });
  } finally {
    await session.endSession();
  }
};

module.exports = { requestOwnerSignup, verifyOwnerSignup, digest };
