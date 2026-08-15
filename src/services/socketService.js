const jwt = require('jsonwebtoken');

let io;

const initializeSocket = (httpServer) => {
  const { Server } = require('socket.io');
  io = new Server(httpServer, {
    cors: {
      origin: process.env.CLIENT_URL || true,
      methods: ['GET', 'POST'],
    },
  });

  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.split(' ')[1];
      if (!token) {
        return next(new Error('Unauthorized'));
      }

      const decoded = jwt.verify(token, process.env.SECRET_JWT_KEY);
      socket.user = decoded;
      return next();
    } catch (error) {
      return next(new Error('Unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    socket.join(`employee:${socket.user.email || socket.user.id}`);
    const role = String(socket.user.role || '').toLowerCase();
    if (role.includes('admin') || role.includes('manager')) {
      socket.join('dashboard');
    }
  });

  return io;
};

const getIo = () => io;

const emitLocationUpdate = (payload) => {
  if (!io) return;
  io.to(`employee:${payload.employeeId}`).emit('employee:location-updated', payload);
  io.to('dashboard').emit('employee:location-updated', payload);
};

const emitTrackingStatus = (payload) => {
  if (!io) return;
  io.to(`employee:${payload.employeeId}`).emit('employee:tracking-status', payload);
  io.to('dashboard').emit('employee:tracking-status', payload);
};

module.exports = {
  initializeSocket,
  getIo,
  emitLocationUpdate,
  emitTrackingStatus,
};
