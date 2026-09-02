const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Admin = require('../models/Admin');
const { canUserAccessApp } = require('../utils/userAccess');

let io;

const initializeSocket = (httpServer) => {
  const { Server } = require('socket.io');
  io = new Server(httpServer, {
    cors: {
      origin: process.env.CLIENT_URL || true,
      methods: ['GET', 'POST'],
    },
  });

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.split(' ')[1];
      if (!token) {
        return next(new Error('Unauthorized'));
      }

      const decoded = jwt.verify(token, process.env.SECRET_JWT_KEY);
      const user = await User.findById(decoded.id).select('email employeeId approvalStatus accountStatus role authVersion organizationId');
      const admin = user ? null : await Admin.findById(decoded.id).select('email employeeId role adminRole accountStatus authVersion organizationId');
      if (!user && !admin) return next(new Error('Unauthorized'));
      if (user && Number(decoded.authVersion || 0) !== Number(user.authVersion || 0)) return next(new Error('Session revoked'));
      if (user && !canUserAccessApp(user)) return next(new Error('Account access denied'));
      socket.user = user || admin;
      socket.principalType = user ? 'user' : 'admin';
      if (!socket.user.organizationId || (admin && admin.accountStatus === 'suspended')) return next(new Error('Organization access denied'));
      return next();
    } catch (error) {
      return next(new Error('Unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const organizationId = String(socket.user.organizationId);
    socket.join(`org:${organizationId}:employee:${socket.user.employeeId || socket.user.email || socket.user.id}`);
    const role = String(socket.user.role || '').toLowerCase();
    if (socket.principalType === 'admin' || role.includes('admin') || role.includes('manager')) {
      socket.join(`org:${organizationId}:dashboard`);
    }
  });

  return io;
};

const emitAdminUserEvent = (eventName, payload) => {
  if (!io || !payload?.organizationId) return;
  io.to(`org:${payload.organizationId}:dashboard`).emit(eventName, payload);
};

const disconnectEmployeeSockets = async (employeeId, organizationId) => {
  if (!io || !employeeId || !organizationId) return;
  const sockets = await io.in(`org:${organizationId}:employee:${employeeId}`).fetchSockets();
  sockets.forEach((socket) => socket.disconnect(true));
};

const getIo = () => io;

const emitLocationUpdate = (payload) => {
  if (!io) return;
  if (!payload.organizationId) return;
  io.to(`org:${payload.organizationId}:employee:${payload.employeeId}`).emit('employee:location-updated', payload);
  io.to(`org:${payload.organizationId}:dashboard`).emit('employee:location-updated', payload);
};

const emitTrackingStatus = (payload) => {
  if (!io) return;
  if (!payload.organizationId) return;
  io.to(`org:${payload.organizationId}:employee:${payload.employeeId}`).emit('employee:tracking-status', payload);
  io.to(`org:${payload.organizationId}:dashboard`).emit('employee:tracking-status', payload);
};

const emitAppDataUpdate = (payload) => {
  if (!io) return;
  if (!payload.organizationId) return;
  io.to(`org:${payload.organizationId}:employee:${payload.employeeId}`).emit('employee:app-data-changed', payload);
  io.to(`org:${payload.organizationId}:dashboard`).emit('employee:app-data-changed', payload);
};

const emitVerificationEvent = (eventName, payload) => {
  if (!io || !payload?.employeeId || !payload?.organizationId) return;
  io.to(`org:${payload.organizationId}:employee:${payload.employeeId}`).emit(eventName, payload);
  io.to(`org:${payload.organizationId}:dashboard`).emit(eventName, payload);
};

module.exports = {
  initializeSocket,
  getIo,
  emitLocationUpdate,
  emitTrackingStatus,
  emitAdminUserEvent,
  disconnectEmployeeSockets,
  emitAppDataUpdate,
  emitVerificationEvent,
};
