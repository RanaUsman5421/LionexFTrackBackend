const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Admin = require('../models/Admin');
const User = require('../models/User');
const AppSnapshot = require('../models/AppSnapshot');
const EmployeeCurrentLocation = require('../models/EmployeeCurrentLocation');
const LocationHistory = require('../models/LocationHistory');
const TrackingSession = require('../models/TrackingSession');
const generateToken = require('../utils/generateToken');
const { userAccessState } = require('../utils/userAccess');
const { disconnectEmployeeSockets, emitAdminUserEvent } = require('../services/socketService');

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

const sanitizeUser = (user, metrics = {}) => ({
  id: user._id.toString(),
  ...Object.fromEntries(USER_FIELDS.map((field) => [field, user[field] ?? (field === 'profilePhotoUrl' ? null : '')])),
  cnic: user.cnic || '',
  cvUrl: user.cvUrl || null,
  selfieUrl: user.selfieUrl || null,
  submittedCV: Boolean(user.cvUrl),
  submittedPhoto: Boolean(user.profilePhotoUrl),
  submittedSelfie: Boolean(user.selfieUrl),
  ...(metrics.leadsCount !== undefined ? { leadsCount: Number(metrics.leadsCount || 0) } : {}),
  ...(metrics.registeredCount !== undefined ? { registeredCount: Number(metrics.registeredCount || 0) } : {}),
  ...(metrics.fieldDaysCount !== undefined ? { fieldDaysCount: Number(metrics.fieldDaysCount || 0) } : {}),
  ...userAccessState(user),
  approvedAt: user.approvedAt || null,
  approvedBy: user.approvedBy || null,
  rejectedAt: user.rejectedAt || null,
  rejectionReason: user.rejectionReason || '',
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

    const [users, snapshots, fieldDayRows] = await Promise.all([
      User.find({}).select('-password').sort({ createdAt: -1 }).lean(),
      AppSnapshot.find({}).select('employeeId leads').lean(),
      TrackingSession.aggregate([
        { $match: { startedAt: { $type: 'date' } } },
        { $group: { _id: { employeeId: '$employeeId', day: { $dateToString: { format: '%Y-%m-%d', date: '$startedAt' } } } } },
        { $group: { _id: '$_id.employeeId', fieldDaysCount: { $sum: 1 } } },
      ]),
    ]);

    const snapshotByEmployee = new Map(snapshots.map((snapshot) => [snapshot.employeeId, snapshot]));
    const fieldDaysByEmployee = new Map(fieldDayRows.map((row) => [row._id, row.fieldDaysCount]));
    const sanitizedUsers = users.map((user) => {
      const snapshot = snapshotByEmployee.get(user.employeeId);
      const leads = Array.isArray(snapshot?.leads) ? snapshot.leads : [];
      return sanitizeUser(user, {
        leadsCount: leads.length,
        registeredCount: leads.filter((lead) => lead.status === 'Registered').length,
        fieldDaysCount: fieldDaysByEmployee.get(user.employeeId) || 0,
      });
    });
    return res.status(200).json({
      success: true,
      users: sanitizedUsers,
      counts: {
        total: sanitizedUsers.length,
        pending: sanitizedUsers.filter((user) => user.approvalStatus === 'pending').length,
        approved: sanitizedUsers.filter((user) => user.approvalStatus === 'approved').length,
        rejected: sanitizedUsers.filter((user) => user.approvalStatus === 'rejected').length,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch users.',
    });
  }
};

const createUser = async (req, res) => {
  try {
    if (!isAuthenticatedAdmin(req)) {
      return res.status(403).json({ success: false, message: 'Not authorized.' });
    }

    const values = Object.fromEntries(
      USER_FIELDS.filter((field) => field !== 'profilePhotoUrl').map((field) => [field, typeof req.body[field] === 'string' ? req.body[field].trim() : ''])
    );
    values.email = values.email.toLowerCase();
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const cnic = typeof req.body.cnic === 'string' ? req.body.cnic.trim() : '';

    if (!values.fullName || !values.employeeId || !values.username || !values.email || !password) {
      return res.status(400).json({ success: false, message: 'Full name, employee ID, username, email, and password are required.' });
    }
    if (password.length < 6 || password.length > 128) {
      return res.status(400).json({ success: false, message: 'Password must be between 6 and 128 characters.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) {
      return res.status(400).json({ success: false, message: 'Please enter a valid email address.' });
    }
    if (cnic.length > 32 || Object.values(values).some((value) => value.length > 255)) {
      return res.status(400).json({ success: false, message: 'One or more user fields are too long.' });
    }

    const duplicate = await User.findOne({
      $or: [{ email: values.email }, { username: values.username }, { employeeId: values.employeeId }],
    });
    if (duplicate) {
      return res.status(409).json({ success: false, message: 'Email, username, or employee ID is already in use.' });
    }

    const user = await User.create({
      ...values,
      cnic,
      password: await bcrypt.hash(password, 10),
      approvalStatus: 'approved',
      accountStatus: 'active',
      approvedAt: new Date(),
      approvedBy: req.user._id,
    });
    const publicUser = sanitizeUser(user);
    emitAdminUserEvent('admin:user-created', publicUser);
    return res.status(201).json({ success: true, message: 'Employee account created successfully.', user: publicUser });
  } catch (error) {
    const duplicateKey = error?.code === 11000;
    return res.status(duplicateKey ? 409 : 500).json({
      success: false,
      message: duplicateKey ? 'Email, username, or employee ID is already in use.' : error.message || 'Failed to create user.',
    });
  }
};

const changeUserStatus = async (req, res) => {
  try {
    if (!isAuthenticatedAdmin(req)) {
      return res.status(403).json({ success: false, message: 'Not authorized.' });
    }
    const userId = String(req.params.userId || '');
    if (!userId.match(/^[a-f\d]{24}$/i)) {
      return res.status(400).json({ success: false, message: 'Invalid user ID.' });
    }
    const accountStatus = String(req.body?.accountStatus || '').toLowerCase();
    if (!['active', 'inactive', 'blocked'].includes(accountStatus)) {
      return res.status(400).json({ success: false, message: 'Account status must be active, inactive, or blocked.' });
    }

    const statusUpdate = { accountStatus };
    if (accountStatus === 'active') {
      Object.assign(statusUpdate, {
        approvalStatus: 'approved',
        approvedAt: new Date(),
        approvedBy: req.user._id,
        rejectedAt: null,
        rejectionReason: '',
      });
    }
    const user = await User.findByIdAndUpdate(
      userId,
      { $set: statusUpdate, $inc: { authVersion: 1 } },
      { new: true, runValidators: true }
    );
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

    await disconnectEmployeeSockets(user.employeeId);
    const publicUser = sanitizeUser(user);
    emitAdminUserEvent('admin:user-updated', publicUser);
    return res.status(200).json({ success: true, message: `Employee account set to ${accountStatus}.`, user: publicUser });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to update account status.' });
  }
};

const approveUser = async (req, res) => {
  try {
    if (!isAuthenticatedAdmin(req)) {
      return res.status(403).json({ success: false, message: 'Not authorized.' });
    }
    const userId = String(req.params.userId || '');
    if (!userId.match(/^[a-f\d]{24}$/i)) {
      return res.status(400).json({ success: false, message: 'Invalid user ID.' });
    }
    const user = await User.findOneAndUpdate(
      { _id: userId, approvalStatus: 'pending' },
      {
        $set: {
          approvalStatus: 'approved',
          accountStatus: 'active',
          approvedAt: new Date(),
          approvedBy: req.user._id,
          rejectedAt: null,
          rejectionReason: '',
        },
      },
      { new: true, runValidators: true }
    );
    if (!user) {
      const existing = await User.findById(userId);
      return res.status(existing ? 409 : 404).json({
        success: false,
        message: existing ? 'This account is no longer pending approval.' : 'User not found.',
      });
    }
    const publicUser = sanitizeUser(user);
    emitAdminUserEvent('admin:user-updated', publicUser);
    return res.status(200).json({ success: true, message: 'Employee approved and activated successfully.', user: publicUser });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to approve user.' });
  }
};

const rejectUser = async (req, res) => {
  try {
    if (!isAuthenticatedAdmin(req)) {
      return res.status(403).json({ success: false, message: 'Not authorized.' });
    }
    const userId = String(req.params.userId || '');
    if (!userId.match(/^[a-f\d]{24}$/i)) {
      return res.status(400).json({ success: false, message: 'Invalid user ID.' });
    }
    const rejectionReason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 500) : '';
    const user = await User.findOneAndUpdate(
      { _id: userId, approvalStatus: 'pending' },
      {
        $set: {
          approvalStatus: 'rejected',
          accountStatus: 'inactive',
          rejectedAt: new Date(),
          rejectionReason,
          approvedAt: null,
          approvedBy: null,
        },
      },
      { new: true, runValidators: true }
    );
    if (!user) {
      const existing = await User.findById(userId);
      return res.status(existing ? 409 : 404).json({
        success: false,
        message: existing ? 'This account is no longer pending approval.' : 'User not found.',
      });
    }
    const publicUser = sanitizeUser(user);
    emitAdminUserEvent('admin:user-updated', publicUser);
    return res.status(200).json({ success: true, message: 'Employee registration rejected.', user: publicUser });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to reject user.' });
  }
};

const deleteUser = async (req, res) => {
  if (!isAuthenticatedAdmin(req)) {
    return res.status(403).json({ success: false, message: 'Not authorized.' });
  }

  const userId = String(req.params.userId || '');
  if (!userId.match(/^[a-f\d]{24}$/i)) {
    return res.status(400).json({ success: false, message: 'Invalid user ID.' });
  }

  const session = await User.startSession();
  let deletedUser;

  try {
    await session.withTransaction(async () => {
      const user = await User.findById(userId).session(session);
      if (!user) {
        const notFoundError = new Error('User not found.');
        notFoundError.statusCode = 404;
        throw notFoundError;
      }

      deletedUser = { id: user._id.toString(), employeeId: user.employeeId, fullName: user.fullName };
      const employeeQuery = { employeeId: user.employeeId };

      await AppSnapshot.deleteMany(employeeQuery, { session });
      await EmployeeCurrentLocation.deleteMany(employeeQuery, { session });
      await LocationHistory.deleteMany(employeeQuery, { session });
      await TrackingSession.deleteMany(employeeQuery, { session });
      await User.deleteOne({ _id: user._id }, { session });
    });

    emitAdminUserEvent('admin:user-deleted', deletedUser);
    return res.status(200).json({
      success: true,
      message: 'User and associated tracking data deleted successfully.',
      deletedUser,
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Failed to delete user.',
    });
  } finally {
    await session.endSession();
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

module.exports = { createAdmin, createUser, loginAdmin, listUsers, updateUser, approveUser, rejectUser, deleteUser, changeUserStatus };
