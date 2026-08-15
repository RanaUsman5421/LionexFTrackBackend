const TrackingSession = require('../models/TrackingSession');
const {
  canAccessEmployee,
  createTrackingSession,
  stopTrackingSession,
  validateLocationPayload,
} = require('../services/locationService');
const { emitTrackingStatus } = require('../services/socketService');

const startTracking = async (req, res) => {
  try {
    const validated = validateLocationPayload(req.body || {});
    if (!validated.valid) {
      return res.status(400).json({ success: false, message: validated.message });
    }

    const employeeId = req.user.employeeId;
    const session = await createTrackingSession(employeeId, validated.data);
    emitTrackingStatus({
      employeeId,
      status: 'active',
      timestamp: validated.data.timestamp,
    });

    return res.status(200).json({
      success: true,
      message: 'Tracking started.',
      session,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to start tracking.' });
  }
};

const stopTracking = async (req, res) => {
  try {
    const employeeId = req.user.employeeId;
    const validated = req.body?.location ? validateLocationPayload(req.body.location) : { valid: true, data: null };
    const location = validated.valid ? validated.data : null;

    const session = await stopTrackingSession(employeeId, location);
    emitTrackingStatus({
      employeeId,
      status: 'stopped',
      timestamp: location?.timestamp || new Date(),
    });

    return res.status(200).json({
      success: true,
      message: 'Tracking stopped.',
      session,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to stop tracking.' });
  }
};

const getTrackingStatus = async (req, res) => {
  try {
    const employeeId = req.params.employeeId || req.user.employeeId;
    if (!canAccessEmployee(req.user, employeeId)) {
      return res.status(403).json({ success: false, message: 'Not authorized.' });
    }

    const session = await TrackingSession.findOne({ employeeId }).sort({ startedAt: -1 }).lean();
    return res.status(200).json({ success: true, session: session || null });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to fetch tracking status.' });
  }
};

module.exports = {
  startTracking,
  stopTracking,
  getTrackingStatus,
};
