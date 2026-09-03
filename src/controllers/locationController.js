const {
  canAccessEmployee,
  createTrackingSession,
  getCurrentLocationForEmployee,
  getCurrentLocations,
  getLocationHistory,
  storeHistoryLocation,
  touchCurrentLocation,
  touchTrackingSession,
  upsertCurrentLocationIfNewer,
  validateLocationPayload,
  validateHeartbeatPayload,
} = require('../services/locationService');
const { emitLocationUpdate } = require('../services/socketService');
const { getVerificationGate, publicChallenge, wasTimestampVerificationBlocked } = require('../services/verificationService');
const LocationHistory = require('../models/LocationHistory');
const User = require('../models/User');
const { hasPermission } = require('../utils/adminPermissions');

const leaderboardCache = new Map();
const LEADERBOARD_CACHE_MS = 60_000;
const toRadians = (value) => (value * Math.PI) / 180;
const distanceKmBetween = (left, right) => {
  const earthRadiusKm = 6371;
  const latitudeDelta = toRadians(right.latitude - left.latitude);
  const longitudeDelta = toRadians(right.longitude - left.longitude);
  const latitude1 = toRadians(left.latitude);
  const latitude2 = toRadians(right.latitude);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(latitude1) * Math.cos(latitude2) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * earthRadiusKm * Math.asin(Math.min(1, Math.sqrt(a)));
};
const invalidateLeaderboard = (organizationId) => leaderboardCache.delete(String(organizationId || ''));

const rejectWhenVerificationRequired = async (req, res) => {
  const gate = await getVerificationGate(req.user.employeeId);
  if (!gate.blocked) return false;
  res.status(423).json({
    success: false,
    code: 'VERIFICATION_REQUIRED',
    message: 'Biometric verification is required before tracking can continue.',
    challenge: publicChallenge(gate.challenge),
  });
  return true;
};

const serializeCurrent = (doc) => {
  if (!doc) return null;
  return {
    employeeId: doc.employeeId,
    latitude: doc.location?.coordinates?.[1] ?? null,
    longitude: doc.location?.coordinates?.[0] ?? null,
    accuracy: doc.accuracy,
    speed: doc.speed,
    heading: doc.heading,
    altitude: doc.altitude,
    batteryPercentage: doc.batteryPercentage,
    timestamp: doc.timestamp,
    lastSeenAt: doc.lastSeenAt,
    trackingStatus: doc.trackingStatus,
    sessionStatus: doc.sessionStatus,
    updatedAt: doc.updatedAt,
  };
};

const formatPayload = (employeeId, locationDoc, organizationId) => ({
  organizationId,
  employeeId,
  latitude: locationDoc.location.coordinates[1],
  longitude: locationDoc.location.coordinates[0],
  accuracy: locationDoc.accuracy,
  speed: locationDoc.speed,
  heading: locationDoc.heading,
  altitude: locationDoc.altitude,
  batteryPercentage: locationDoc.batteryPercentage,
  timestamp: locationDoc.timestamp,
  lastSeenAt: locationDoc.lastSeenAt || locationDoc.timestamp,
  trackingStatus: locationDoc.trackingStatus,
  sessionStatus: locationDoc.sessionStatus,
});

const submitLocation = async (req, res) => {
  try {
    if (await rejectWhenVerificationRequired(req, res)) return;
    const validated = validateLocationPayload(req.body || {});
    if (!validated.valid) {
      return res.status(400).json({ success: false, message: validated.message });
    }

    if (!validated.data.clientLocationId) {
      return res.status(400).json({ success: false, message: 'clientLocationId is required.' });
    }
    if (await wasTimestampVerificationBlocked(req.user.employeeId, validated.data.timestamp)) {
      return res.status(422).json({
        success: false,
        code: 'LOCATION_DURING_VERIFICATION_LOCK',
        message: 'Location was captured while tracking was locked for verification.',
      });
    }

    const employeeId = req.user.employeeId;
    const historyDoc = await storeHistoryLocation(employeeId, validated.data, req.organizationId);
    if (historyDoc) invalidateLeaderboard(req.organizationId);
    const currentDoc = await upsertCurrentLocationIfNewer(employeeId, validated.data, 'active', req.organizationId);
    await touchTrackingSession(employeeId, validated.data.timestamp);

    if (currentDoc && currentDoc.timestamp && currentDoc.timestamp.getTime() === validated.data.timestamp.getTime()) {
      emitLocationUpdate(formatPayload(employeeId, currentDoc, req.organizationId));
    }

    return res.status(201).json({
      success: true,
      message: historyDoc ? 'Location stored successfully.' : 'Location already processed.',
      location: serializeCurrent(currentDoc),
      duplicate: !historyDoc,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to store location.' });
  }
};

const submitLocationBulk = async (req, res) => {
  try {
    if (await rejectWhenVerificationRequired(req, res)) return;
    const locations = Array.isArray(req.body?.locations) ? req.body.locations : [];
    if (!locations.length) {
      return res.status(400).json({ success: false, message: 'locations array is required.' });
    }

    const employeeId = req.user.employeeId;
    const processed = [];
    const rejected = [];

    const sorted = locations
      .map((item) => ({ raw: item, parsed: validateLocationPayload(item) }))
      .filter((item) => item.parsed.valid)
      .sort((a, b) => a.parsed.data.timestamp - b.parsed.data.timestamp);

    for (const item of sorted) {
      const data = item.parsed.data;
      if (!data.clientLocationId) {
        rejected.push({ clientLocationId: '', reason: 'clientLocationId is required.' });
        continue;
      }
      if (await wasTimestampVerificationBlocked(employeeId, data.timestamp)) {
        processed.push(data.clientLocationId);
        rejected.push({ clientLocationId: data.clientLocationId, reason: 'Captured during biometric verification lock.' });
        continue;
      }

      const historyDoc = await storeHistoryLocation(employeeId, data, req.organizationId);
      if (historyDoc) invalidateLeaderboard(req.organizationId);
      const currentDoc = await upsertCurrentLocationIfNewer(employeeId, data, 'active', req.organizationId);
      await touchTrackingSession(employeeId, data.timestamp);
      processed.push(data.clientLocationId);

      if (historyDoc && currentDoc && currentDoc.timestamp.getTime() === data.timestamp.getTime()) {
        emitLocationUpdate({
          organizationId: req.organizationId,
          employeeId,
          latitude: currentDoc.location.coordinates[1],
          longitude: currentDoc.location.coordinates[0],
          accuracy: currentDoc.accuracy,
          speed: currentDoc.speed,
          heading: currentDoc.heading,
          altitude: currentDoc.altitude,
          batteryPercentage: currentDoc.batteryPercentage,
          timestamp: currentDoc.timestamp,
          lastSeenAt: currentDoc.lastSeenAt,
          trackingStatus: currentDoc.trackingStatus,
          sessionStatus: currentDoc.sessionStatus,
        });
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Bulk location sync complete.',
      processed,
      rejected,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to process bulk locations.' });
  }
};

const getCurrentLocationsController = async (req, res) => {
  try {
    const employeeId = req.params.employeeId;
    if (employeeId) {
      if (!await canAccessEmployee(req.user, employeeId)) {
        return res.status(403).json({ success: false, message: 'Not authorized to view this employee.' });
      }

      const current = await getCurrentLocationForEmployee(employeeId);
      return res.status(200).json({ success: true, current: serializeCurrent(current) });
    }

    if (!await canAccessEmployee(req.user, req.user.employeeId)) {
      return res.status(403).json({ success: false, message: 'Not authorized.' });
    }

    const requestedIds = String(req.query.employeeIds || '').split(',').map((value) => value.trim()).filter(Boolean).slice(0, 200);
    if (requestedIds.length && !(String(req.user.role || '').toLowerCase().includes('manager') || String(req.user.role || '').toLowerCase().includes('admin'))) {
      return res.status(403).json({ success: false, message: 'Not authorized to request team locations.' });
    }
    const currentLocations = await getCurrentLocations(req.organizationId, requestedIds);
    const filtered = String(req.user.role || '').toLowerCase().includes('manager') || String(req.user.role || '').toLowerCase().includes('admin')
      ? currentLocations
      : currentLocations.filter((item) => item.employeeId === req.user.employeeId);

    return res.status(200).json({
      success: true,
      locations: filtered.map(serializeCurrent),
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to fetch current locations.' });
  }
};

const getHistoryController = async (req, res) => {
  try {
    const { employeeId } = req.params;
    if (!await canAccessEmployee(req.user, employeeId)) {
      return res.status(403).json({ success: false, message: 'Not authorized to view this history.' });
    }

    const history = await getLocationHistory(employeeId, req.query);
    return res.status(200).json({
      success: true,
      history: history.map((item) => ({
        clientLocationId: item.clientLocationId,
        employeeId: item.employeeId,
        latitude: item.location.coordinates[1],
        longitude: item.location.coordinates[0],
        accuracy: item.accuracy,
        speed: item.speed,
        heading: item.heading,
        altitude: item.altitude,
        batteryPercentage: item.batteryPercentage,
        timestamp: item.timestamp,
        networkType: item.networkType,
      })),
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to fetch history.' });
  }
};

const getDistanceLeaderboardController = async (req, res) => {
  try {
    if (req.principalType !== 'admin' || !hasPermission(req.user, 'tracking.read')) {
      return res.status(403).json({ success: false, message: 'Not authorized to view distance rankings.' });
    }
    const limit = Math.min(10, Math.max(1, Number(req.query.limit) || 4));
    const cacheKey = String(req.organizationId);
    const cached = leaderboardCache.get(cacheKey);
    if (cached && Date.now() - cached.createdAt < LEADERBOARD_CACHE_MS) {
      return res.json({ success: true, leaders: cached.leaders.slice(0, limit) });
    }

    const totals = new Map();
    const previousByEmployee = new Map();
    const cursor = LocationHistory.find({ organizationId: req.organizationId })
      .select('employeeId location.coordinates timestamp -_id')
      .sort({ employeeId: 1, timestamp: 1 })
      .lean()
      .cursor();

    for await (const row of cursor) {
      const coordinates = row.location?.coordinates;
      const longitude = Number(coordinates?.[0]);
      const latitude = Number(coordinates?.[1]);
      const timestamp = new Date(row.timestamp);
      if (!row.employeeId || !Number.isFinite(latitude) || !Number.isFinite(longitude) || Number.isNaN(timestamp.getTime())) continue;
      const current = { latitude, longitude, day: timestamp.toISOString().slice(0, 10) };
      const previous = previousByEmployee.get(row.employeeId);
      if (previous && previous.day === current.day) {
        const segmentKm = distanceKmBetween(previous, current);
        if (Number.isFinite(segmentKm)) totals.set(row.employeeId, (totals.get(row.employeeId) || 0) + segmentKm);
      }
      previousByEmployee.set(row.employeeId, current);
    }

    const ranked = [...totals.entries()].sort((left, right) => right[1] - left[1]).slice(0, 10);
    const employeeIds = ranked.map(([employeeId]) => employeeId);
    const employees = await User.find({ organizationId: req.organizationId, employeeId: { $in: employeeIds } })
      .select('employeeId fullName username role profilePhotoUrl')
      .lean();
    const employeeById = new Map(employees.map((employee) => [employee.employeeId, employee]));
    const leaders = ranked.map(([employeeId, totalDistanceKm]) => {
      const employee = employeeById.get(employeeId) || {};
      return {
        employeeId,
        fullName: employee.fullName || employee.username || employeeId,
        role: employee.role || 'Employee',
        profilePhotoUrl: employee.profilePhotoUrl || '',
        totalDistanceKm: Number(totalDistanceKm.toFixed(2)),
      };
    });
    if (leaders.length < 10) {
      const zeroDistanceEmployees = await User.find({
        organizationId: req.organizationId,
        employeeId: { $nin: employeeIds },
        approvalStatus: 'approved',
        accountStatus: 'active',
      })
        .select('employeeId fullName username role profilePhotoUrl')
        .sort({ createdAt: 1 })
        .limit(10 - leaders.length)
        .lean();
      leaders.push(...zeroDistanceEmployees.map((employee) => ({
        employeeId: employee.employeeId,
        fullName: employee.fullName || employee.username || employee.employeeId,
        role: employee.role || 'Employee',
        profilePhotoUrl: employee.profilePhotoUrl || '',
        totalDistanceKm: 0,
      })));
    }
    leaderboardCache.set(cacheKey, { createdAt: Date.now(), leaders });
    return res.json({ success: true, leaders: leaders.slice(0, limit) });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to calculate distance rankings.' });
  }
};

const heartbeatLocation = async (req, res) => {
  try {
    if (await rejectWhenVerificationRequired(req, res)) return;
    const validated = validateHeartbeatPayload(req.body || {});
    if (!validated.valid) {
      return res.status(400).json({ success: false, message: validated.message });
    }

    const employeeId = req.user.employeeId;
    const currentDoc = await touchCurrentLocation(employeeId, validated.data, 'active', req.organizationId);
    const session = (await touchTrackingSession(employeeId, validated.data.timestamp)) || await createTrackingSession(employeeId, validated.data, req.organizationId);

    if (currentDoc) {
      emitLocationUpdate({
        organizationId: req.organizationId,
        employeeId,
        latitude: currentDoc.location.coordinates[1],
        longitude: currentDoc.location.coordinates[0],
        accuracy: currentDoc.accuracy,
        speed: currentDoc.speed,
        heading: currentDoc.heading,
        altitude: currentDoc.altitude,
        batteryPercentage: currentDoc.batteryPercentage,
        timestamp: currentDoc.timestamp,
        lastSeenAt: currentDoc.lastSeenAt,
        trackingStatus: currentDoc.trackingStatus,
        sessionStatus: currentDoc.sessionStatus,
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Heartbeat recorded.',
      current: serializeCurrent(currentDoc),
      session,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to record heartbeat.' });
  }
};

module.exports = {
  submitLocation,
  submitLocationBulk,
  getCurrentLocationsController,
  getDistanceLeaderboardController,
  getHistoryController,
  heartbeatLocation,
};
