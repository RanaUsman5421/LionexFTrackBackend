const EmployeeCurrentLocation = require('../models/EmployeeCurrentLocation');
const LocationHistory = require('../models/LocationHistory');
const TrackingSession = require('../models/TrackingSession');

const MAX_ACCURACY_METERS = 5000;

const isManagerOrAdmin = (user) => {
  const role = String(user?.role || '').toLowerCase();
  return role.includes('admin') || role.includes('manager');
};

const canAccessEmployee = (user, employeeId) => isManagerOrAdmin(user) || String(user?.employeeId || '') === String(employeeId);

const normalizeTimestamp = (value) => {
  const timestamp = value ? new Date(value) : new Date();
  return Number.isNaN(timestamp.getTime()) ? null : timestamp;
};

const validateLocationPayload = (payload) => {
  const latitude = Number(payload.latitude);
  const longitude = Number(payload.longitude);
  const accuracy = payload.accuracy === undefined || payload.accuracy === null ? null : Number(payload.accuracy);
  const timestamp = normalizeTimestamp(payload.timestamp);

  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    return { valid: false, message: 'Invalid latitude.' };
  }

  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    return { valid: false, message: 'Invalid longitude.' };
  }

  if (!timestamp) {
    return { valid: false, message: 'Invalid timestamp.' };
  }

  if (accuracy !== null && (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > MAX_ACCURACY_METERS)) {
    return { valid: false, message: 'Invalid accuracy value.' };
  }

  return {
    valid: true,
    data: {
      clientLocationId: String(payload.clientLocationId || '').trim(),
      latitude,
      longitude,
      accuracy,
      speed: payload.speed === undefined || payload.speed === null ? null : Number(payload.speed),
      heading: payload.heading === undefined || payload.heading === null ? null : Number(payload.heading),
      altitude: payload.altitude === undefined || payload.altitude === null ? null : Number(payload.altitude),
      timestamp,
      batteryPercentage: payload.batteryPercentage === undefined || payload.batteryPercentage === null ? null : Number(payload.batteryPercentage),
      networkType: String(payload.networkType || ''),
    },
  };
};

const validateHeartbeatPayload = (payload) => {
  const latitude = Number(payload.latitude);
  const longitude = Number(payload.longitude);
  const accuracy = payload.accuracy === undefined || payload.accuracy === null ? null : Number(payload.accuracy);
  const timestamp = normalizeTimestamp(payload.timestamp);

  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    return { valid: false, message: 'Invalid latitude.' };
  }

  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    return { valid: false, message: 'Invalid longitude.' };
  }

  if (!timestamp) {
    return { valid: false, message: 'Invalid timestamp.' };
  }

  if (accuracy !== null && (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > MAX_ACCURACY_METERS)) {
    return { valid: false, message: 'Invalid accuracy value.' };
  }

  return {
    valid: true,
    data: {
      latitude,
      longitude,
      accuracy,
      speed: payload.speed === undefined || payload.speed === null ? null : Number(payload.speed),
      heading: payload.heading === undefined || payload.heading === null ? null : Number(payload.heading),
      altitude: payload.altitude === undefined || payload.altitude === null ? null : Number(payload.altitude),
      timestamp,
      batteryPercentage: payload.batteryPercentage === undefined || payload.batteryPercentage === null ? null : Number(payload.batteryPercentage),
      networkType: String(payload.networkType || ''),
    },
  };
};

const buildHistoryDocument = (employeeId, location) => ({
  employeeId,
  clientLocationId: location.clientLocationId,
  location: {
    type: 'Point',
    coordinates: [location.longitude, location.latitude],
  },
  accuracy: location.accuracy,
  speed: location.speed,
  heading: location.heading,
  altitude: location.altitude,
  timestamp: location.timestamp,
  batteryPercentage: location.batteryPercentage,
  networkType: location.networkType,
});

const buildCurrentDocument = (employeeId, location, sessionStatus = 'active') => ({
  employeeId,
  location: {
    type: 'Point',
    coordinates: [location.longitude, location.latitude],
  },
  accuracy: location.accuracy,
  speed: location.speed,
  heading: location.heading,
  altitude: location.altitude,
  batteryPercentage: location.batteryPercentage,
  timestamp: location.timestamp,
  lastSeenAt: location.timestamp,
  trackingStatus: sessionStatus === 'stopped' ? 'TRACKING_STOPPED' : 'ACTIVE',
  sessionStatus,
});

const upsertCurrentLocationIfNewer = async (employeeId, location, sessionStatus = 'active') => {
  const existing = await EmployeeCurrentLocation.findOne({ employeeId });
  if (existing && existing.timestamp && existing.timestamp >= location.timestamp) {
    return existing;
  }

  return EmployeeCurrentLocation.findOneAndUpdate(
    { employeeId },
    buildCurrentDocument(employeeId, location, sessionStatus),
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
};

const touchCurrentLocation = async (employeeId, location, sessionStatus = 'active') => {
  const existing = await EmployeeCurrentLocation.findOne({ employeeId });
  const lastSeenAt = location.timestamp;
  if (existing && existing.lastSeenAt && existing.lastSeenAt >= lastSeenAt) {
    return existing;
  }

  const update = {
    lastSeenAt,
    trackingStatus: sessionStatus === 'stopped' ? 'TRACKING_STOPPED' : 'ACTIVE',
    sessionStatus,
  };

  if (existing) {
    if (Number.isFinite(location.accuracy)) update.accuracy = location.accuracy;
    if (Number.isFinite(location.speed)) update.speed = location.speed;
    if (Number.isFinite(location.heading)) update.heading = location.heading;
    if (Number.isFinite(location.altitude)) update.altitude = location.altitude;
    if (Number.isFinite(location.batteryPercentage)) update.batteryPercentage = location.batteryPercentage;
    if (Number.isFinite(location.latitude) && Number.isFinite(location.longitude)) {
      update.location = {
        type: 'Point',
        coordinates: [location.longitude, location.latitude],
      };
    }

    return EmployeeCurrentLocation.findOneAndUpdate(
      { employeeId },
      { $set: update },
      { new: true }
    );
  }

  return EmployeeCurrentLocation.findOneAndUpdate(
    { employeeId },
    {
      $set: {
        ...buildCurrentDocument(employeeId, location, sessionStatus),
        lastSeenAt,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
};

const storeHistoryLocation = async (employeeId, location) => {
  try {
    return await LocationHistory.create(buildHistoryDocument(employeeId, location));
  } catch (error) {
    if (error.code === 11000) {
      return null;
    }
    throw error;
  }
};

const createTrackingSession = async (employeeId, location) => {
  const active = await TrackingSession.findOne({ employeeId, status: 'active' }).sort({ startedAt: -1 });
  if (active) {
    return active;
  }

  return TrackingSession.create({
    employeeId,
    startedAt: location.timestamp,
    lastHeartbeatAt: location.timestamp,
    startLocation: {
      latitude: location.latitude,
      longitude: location.longitude,
    },
    status: 'active',
  });
};

const touchTrackingSession = async (employeeId, timestamp = new Date()) => {
  return TrackingSession.findOneAndUpdate(
    { employeeId, status: 'active' },
    { $set: { lastHeartbeatAt: timestamp } },
    { sort: { startedAt: -1 }, new: true }
  );
};

const stopTrackingSession = async (employeeId, location) => {
  return TrackingSession.findOneAndUpdate(
    { employeeId, status: 'active' },
    {
      endedAt: location?.timestamp || new Date(),
      lastHeartbeatAt: location?.timestamp || new Date(),
      status: 'stopped',
      endLocation: location
        ? { latitude: location.latitude, longitude: location.longitude }
        : undefined,
    },
    { sort: { startedAt: -1 }, new: true }
  );
};

const setCurrentTrackingStatus = async (employeeId, trackingStatus) => {
  return EmployeeCurrentLocation.findOneAndUpdate(
    { employeeId },
    {
      $set: {
        trackingStatus,
        sessionStatus: 'stopped',
        lastSeenAt: new Date(),
      },
    },
    { new: true }
  );
};

const getCurrentLocationForEmployee = async (employeeId) => {
  return EmployeeCurrentLocation.findOne({ employeeId }).lean();
};

const getCurrentLocations = async () => {
  return EmployeeCurrentLocation.find({}).sort({ updatedAt: -1 }).lean();
};

const getLocationHistory = async (employeeId, { from, to, limit = 100 }) => {
  const query = { employeeId };
  if (from || to) {
    query.timestamp = {};
    if (from) query.timestamp.$gte = new Date(from);
    if (to) query.timestamp.$lte = new Date(to);
  }

  return LocationHistory.find(query)
    .sort({ timestamp: 1 })
    .limit(Math.min(Number(limit) || 100, 20000))
    .lean();
};

module.exports = {
  isManagerOrAdmin,
  canAccessEmployee,
  validateLocationPayload,
  validateHeartbeatPayload,
  normalizeTimestamp,
  upsertCurrentLocationIfNewer,
  touchCurrentLocation,
  storeHistoryLocation,
  createTrackingSession,
  touchTrackingSession,
  stopTrackingSession,
  setCurrentTrackingStatus,
  getCurrentLocationForEmployee,
  getCurrentLocations,
  getLocationHistory,
};
