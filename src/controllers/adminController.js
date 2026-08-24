const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Admin = require('../models/Admin');
const User = require('../models/User');
const AppSnapshot = require('../models/AppSnapshot');
const EmployeeCurrentLocation = require('../models/EmployeeCurrentLocation');
const LocationHistory = require('../models/LocationHistory');
const TrackingSession = require('../models/TrackingSession');
const generateToken = require('../utils/generateToken');

const USER_FIELDS = [
  'fullName',
  'employeeId',
  'username',
  'email',
  'phone',
  'city',
  'area',
  'role',
  'department',
  'joiningDate',
  'profilePhotoUrl',
];

const sanitizeUser = (user) => ({
  id: user._id.toString(),
  ...Object.fromEntries(USER_FIELDS.map((field) => [field, user[field] ?? (field === 'profilePhotoUrl' ? null : '')])),
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});

const sanitizeAdmin = (admin) => ({
  id: admin._id.toString(),
  fullName: admin.fullName,
  employeeId: admin.employeeId,
  username: admin.username,
  email: admin.email,
  role: admin.role,
  createdAt: admin.createdAt,
  updatedAt: admin.updatedAt,
});

const isAdminRole = (role) => String(role || '').toLowerCase().includes('admin');
const isAuthenticatedAdmin = (req) => req.principalType === 'admin' && req.user && isAdminRole(req.user.role);

const toTitleCase = (value) =>
  String(value || '')
    .trim()
    .replace(/[._-]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');

const buildAdminEmployeeId = (username) => {
  const slug = String(username || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  return `ADMIN-${slug || Date.now()}`;
};

const getRequestAdmin = async (req) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.split(' ')[1];
  const decoded = jwt.verify(token, process.env.SECRET_JWT_KEY);
  const admin = await Admin.findById(decoded.id);

  if (!admin || !isAdminRole(admin.role)) {
    return null;
  }

  return admin;
};

const createAdmin = async (req, res) => {
  try {
    const existingAdminCount = await Admin.countDocuments();
    const requestAdmin = existingAdminCount > 0 ? await getRequestAdmin(req).catch(() => null) : null;

    if (existingAdminCount > 0 && !requestAdmin) {
      return res.status(403).json({ success: false, message: 'Admin authorization required.' });
    }

    const { username, email, password, confirmPassword } = req.body;

    if (!username || !email || !password || !confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'Username, email, password, and confirm password are required.',
      });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ success: false, message: 'Passwords do not match.' });
    }

    if (password.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters.' });
    }

    const normalizedUsername = String(username).trim();
    const normalizedEmail = String(email).trim().toLowerCase();
    const employeeId = buildAdminEmployeeId(normalizedUsername);
    const fullName = toTitleCase(normalizedUsername) || 'Admin';

    const existingAdmin = await Admin.findOne({
      $or: [{ email: normalizedEmail }, { username: normalizedUsername }, { employeeId }],
    });

    if (existingAdmin) {
      return res.status(409).json({ success: false, message: 'Admin user already exists.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const admin = await Admin.create({
      fullName,
      employeeId,
      username: normalizedUsername,
      email: normalizedEmail,
      password: hashedPassword,
      role: 'admin',
    });

    const token = generateToken(admin);

    return res.status(201).json({
      success: true,
      message: existingAdminCount > 0 ? 'Admin account created successfully.' : 'Initial admin account created successfully.',
      token,
      user: sanitizeAdmin(admin),
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to create admin.',
    });
  }
};

const loginAdmin = async (req, res) => {
  try {
    const { identifier, password } = req.body;

    if (!identifier || !password) {
      return res.status(400).json({ success: false, message: 'Username/email and password are required.' });
    }

    const normalizedIdentifier = String(identifier).trim();
    const admin = await Admin.findOne({
      $or: [{ username: normalizedIdentifier }, { email: normalizedIdentifier.toLowerCase() }],
    });

    if (!admin) {
      return res.status(404).json({ success: false, message: 'Admin account not found.' });
    }

    if (!isAdminRole(admin.role)) {
      return res.status(403).json({ success: false, message: 'Admin access only.' });
    }

    const isMatch = await admin.comparePassword(password);

    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Incorrect password.' });
    }

    const token = generateToken(admin);

    return res.status(200).json({
      success: true,
      message: 'Admin logged in successfully.',
      token,
      user: sanitizeAdmin(admin),
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || 'Admin login failed. Please try again.',
    });
  }
};

const listUsers = async (req, res) => {
  try {
    if (!isAuthenticatedAdmin(req)) {
      return res.status(403).json({ success: false, message: 'Not authorized.' });
    }

    const users = await User.find({}).select('-password').sort({ createdAt: -1 }).lean();

    return res.status(200).json({
      success: true,
      users: users.map(sanitizeUser),
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch users.',
    });
  }
};

const updateUser = async (req, res) => {
  if (!isAuthenticatedAdmin(req)) {
    return res.status(403).json({ success: false, message: 'Not authorized.' });
  }

  const userId = String(req.params.userId || '');
  if (!userId.match(/^[a-f\d]{24}$/i)) {
    return res.status(400).json({ success: false, message: 'Invalid user ID.' });
  }

  const values = Object.fromEntries(
    USER_FIELDS.map((field) => [field, typeof req.body[field] === 'string' ? req.body[field].trim() : ''])
  );
  values.email = values.email.toLowerCase();
  values.profilePhotoUrl = values.profilePhotoUrl || null;
  const password = typeof req.body.password === 'string' ? req.body.password : '';

  if (!values.fullName || !values.employeeId || !values.username || !values.email) {
    return res.status(400).json({
      success: false,
      message: 'Full name, employee ID, username, and email are required.',
    });
  }
  if (Object.values(values).some((value) => typeof value === 'string' && value.length > 255)) {
    return res.status(400).json({ success: false, message: 'User fields cannot exceed 255 characters.' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) {
    return res.status(400).json({ success: false, message: 'Please enter a valid email address.' });
  }
  if (password && password.length < 6) {
    return res.status(400).json({ success: false, message: 'Password must be at least 6 characters.' });
  }
  if (password.length > 128) {
    return res.status(400).json({ success: false, message: 'Password cannot exceed 128 characters.' });
  }

  const session = await User.startSession();
  let updatedUser;

  try {
    await session.withTransaction(async () => {
      const existingUser = await User.findById(userId).session(session);
      if (!existingUser) {
        const notFoundError = new Error('User not found.');
        notFoundError.statusCode = 404;
        throw notFoundError;
      }

      const duplicate = await User.findOne({
        _id: { $ne: existingUser._id },
        $or: [
          { email: values.email },
          { username: values.username },
          { employeeId: values.employeeId },
        ],
      }).session(session);
      if (duplicate) {
        const conflictError = new Error('Email, username, or employee ID is already in use.');
        conflictError.statusCode = 409;
        throw conflictError;
      }

      const previousEmployeeId = existingUser.employeeId;
      Object.assign(existingUser, values);
      if (password) existingUser.password = await bcrypt.hash(password, 10);
      await existingUser.save({ session, runValidators: true });

      if (previousEmployeeId !== values.employeeId) {
        await EmployeeCurrentLocation.updateMany(
          { employeeId: previousEmployeeId },
          { $set: { employeeId: values.employeeId } },
          { session }
        );
        await LocationHistory.updateMany(
          { employeeId: previousEmployeeId },
          { $set: { employeeId: values.employeeId } },
          { session }
        );
        await TrackingSession.updateMany(
          { employeeId: previousEmployeeId },
          { $set: { employeeId: values.employeeId } },
          { session }
        );
        await AppSnapshot.updateMany(
          { employeeId: previousEmployeeId },
          { $set: { employeeId: values.employeeId, 'user.empId': values.employeeId } },
          { session }
        );
      }

      await AppSnapshot.updateMany(
        { employeeId: values.employeeId },
        {
          $set: {
            'user.name': values.fullName,
            'user.email': values.email,
            'user.phone': values.phone,
            'user.city': values.city,
            'user.area': values.area,
            'user.role': values.role,
            'user.department': values.department,
            'user.joiningDate': values.joiningDate,
            'user.profilePhotoUrl': values.profilePhotoUrl,
          },
        },
        { session }
      );

      updatedUser = existingUser.toObject();
    });

    return res.status(200).json({
      success: true,
      message: 'User updated successfully.',
      user: sanitizeUser(updatedUser),
    });
  } catch (error) {
    const duplicateKey = error?.code === 11000;
    return res.status(error.statusCode || (duplicateKey ? 409 : 500)).json({
      success: false,
      message: duplicateKey
        ? 'Email, username, or employee ID is already in use.'
        : error.message || 'Failed to update user.',
    });
  } finally {
    await session.endSession();
  }
};

module.exports = { createAdmin, loginAdmin, listUsers, updateUser };
