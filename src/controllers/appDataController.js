const {
  canAccessEmployee,
  getActivity,
  getDuty,
  getFollowUps,
  getLeads,
  getSnapshot,
  getSummary,
  upsertSnapshot,
} = require('../services/appDataService');

const syncSnapshot = async (req, res) => {
  try {
    const employeeId = req.user.employeeId;
    const snapshot = await upsertSnapshot(employeeId, req.body || {});
    return res.status(200).json({
      success: true,
      message: 'App snapshot synced.',
      snapshot,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to sync app snapshot.' });
  }
};

const getSnapshotController = async (req, res) => {
  try {
    const employeeId = req.params.employeeId || req.user.employeeId;
    if (!canAccessEmployee(req.user, employeeId)) {
      return res.status(403).json({ success: false, message: 'Not authorized.' });
    }

    const snapshot = await getSnapshot(employeeId);
    return res.status(200).json({ success: true, snapshot: snapshot || null });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to fetch snapshot.' });
  }
};

const getSummaryController = async (req, res) => {
  try {
    const employeeId = req.params.employeeId || req.user.employeeId;
    if (!canAccessEmployee(req.user, employeeId)) {
      return res.status(403).json({ success: false, message: 'Not authorized.' });
    }

    const summary = await getSummary(employeeId);
    return res.status(200).json({ success: true, summary });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to fetch summary.' });
  }
};

const getDutyController = async (req, res) => {
  try {
    const employeeId = req.params.employeeId || req.user.employeeId;
    if (!canAccessEmployee(req.user, employeeId)) {
      return res.status(403).json({ success: false, message: 'Not authorized.' });
    }

    const duty = await getDuty(employeeId);
    return res.status(200).json({ success: true, duty });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to fetch duty data.' });
  }
};

const getLeadsController = async (req, res) => {
  try {
    const employeeId = req.params.employeeId || req.user.employeeId;
    if (!canAccessEmployee(req.user, employeeId)) {
      return res.status(403).json({ success: false, message: 'Not authorized.' });
    }

    const leads = await getLeads(employeeId);
    return res.status(200).json({ success: true, leads });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to fetch leads.' });
  }
};

const getFollowUpsController = async (req, res) => {
  try {
    const employeeId = req.params.employeeId || req.user.employeeId;
    if (!canAccessEmployee(req.user, employeeId)) {
      return res.status(403).json({ success: false, message: 'Not authorized.' });
    }

    const followUps = await getFollowUps(employeeId);
    return res.status(200).json({ success: true, followUps });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to fetch follow-ups.' });
  }
};

const getActivityController = async (req, res) => {
  try {
    const employeeId = req.params.employeeId || req.user.employeeId;
    if (!canAccessEmployee(req.user, employeeId)) {
      return res.status(403).json({ success: false, message: 'Not authorized.' });
    }

    const activity = await getActivity(employeeId);
    return res.status(200).json({ success: true, activity });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to fetch activity.' });
  }
};

module.exports = {
  syncSnapshot,
  getSnapshotController,
  getSummaryController,
  getDutyController,
  getLeadsController,
  getFollowUpsController,
  getActivityController,
};
