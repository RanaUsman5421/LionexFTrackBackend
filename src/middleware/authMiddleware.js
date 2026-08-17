const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Admin = require('../models/Admin');

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

    req.user = principal;
    next();
  } catch (error) {
    return res.status(401).json({ success: false, message: 'Not authorized. Invalid token.' });
  }
};

module.exports = { protect };
