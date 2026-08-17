const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Admin = require('../models/Admin');
const User = require('../models/User');
const generateToken = require('../utils/generateToken');

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
    if (!req.user || !isAdminRole(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Not authorized.' });
    }

    const users = await User.find({}).sort({ createdAt: -1 }).lean();

    return res.status(200).json({
      success: true,
      users: users.map((user) => ({
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
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      })),
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch users.',
    });
  }
};

module.exports = { createAdmin, loginAdmin, listUsers };
