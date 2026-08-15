const {
  canAccessEmployee,
  getCurrentLocationForEmployee,
  getCurrentLocations,
  getLocationHistory,
  storeHistoryLocation,
  upsertCurrentLocationIfNewer,
  validateLocationPayload,
} = require('../services/locationService');
const { emitLocationUpdate } = require('../services/socketService');

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
    trackingStatus: doc.trackingStatus,
    sessionStatus: doc.sessionStatus,
    updatedAt: doc.updatedAt,
  };
};

const formatPayload = (employeeId, locationDoc) => ({
  employeeId,
  latitude: locationDoc.location.coordinates[1],
  longitude: locationDoc.location.coordinates[0],
  accuracy: locationDoc.accuracy,
  speed: locationDoc.speed,
  heading: locationDoc.heading,
  altitude: locationDoc.altitude,
  batteryPercentage: locationDoc.batteryPercentage,
  timestamp: locationDoc.timestamp,
});

const submitLocation = async (req, res) => {
  try {
    const validated = validateLocationPayload(req.body || {});
    if (!validated.valid) {
      return res.status(400).json({ success: false, message: validated.message });
    }

    if (!validated.data.clientLocationId) {
      return res.status(400).json({ success: false, message: 'clientLocationId is required.' });
    }

    const employeeId = req.user.employeeId;
    const historyDoc = await storeHistoryLocation(employeeId, validated.data);
    const currentDoc = await upsertCurrentLocationIfNewer(employeeId, validated.data, 'active');

    if (currentDoc && currentDoc.timestamp && currentDoc.timestamp.getTime() === validated.data.timestamp.getTime()) {
      emitLocationUpdate(formatPayload(employeeId, currentDoc));
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

      const historyDoc = await storeHistoryLocation(employeeId, data);
      const currentDoc = await upsertCurrentLocationIfNewer(employeeId, data, 'active');
      processed.push(data.clientLocationId);

      if (historyDoc && currentDoc && currentDoc.timestamp.getTime() === data.timestamp.getTime()) {
        emitLocationUpdate({
          employeeId,
          latitude: currentDoc.location.coordinates[1],
          longitude: currentDoc.location.coordinates[0],
          accuracy: currentDoc.accuracy,
          speed: currentDoc.speed,
          heading: currentDoc.heading,
          altitude: currentDoc.altitude,
          batteryPercentage: currentDoc.batteryPercentage,
          timestamp: currentDoc.timestamp,
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
      if (!canAccessEmployee(req.user, employeeId)) {
        return res.status(403).json({ success: false, message: 'Not authorized to view this employee.' });
      }

      const current = await getCurrentLocationForEmployee(employeeId);
      return res.status(200).json({ success: true, current: serializeCurrent(current) });
    }

    if (!canAccessEmployee(req.user, req.user.employeeId)) {
      return res.status(403).json({ success: false, message: 'Not authorized.' });
    }

    const currentLocations = await getCurrentLocations();
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
    if (!canAccessEmployee(req.user, employeeId)) {
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

module.exports = {
  submitLocation,
  submitLocationBulk,
  getCurrentLocationsController,
  getHistoryController,
};
