const AppSnapshot = require('../models/AppSnapshot');

const canAccessEmployee = (user, employeeId) => {
  const role = String(user?.role || '').toLowerCase();
  return role.includes('admin') || role.includes('manager') || String(user?.employeeId || '') === String(employeeId);
};

const ensureSnapshotShape = (payload = {}) => ({
  employeeId: String(payload.employeeId || '').trim(),
  user: payload.user || {},
  duty: payload.duty || {},
  tracking: payload.tracking || {},
  activeLeadSession: payload.activeLeadSession || {},
  leadFormDraft: payload.leadFormDraft || {},
  leadFormStep: Number(payload.leadFormStep || 0),
  leads: Array.isArray(payload.leads) ? payload.leads : [],
  followUps: Array.isArray(payload.followUps) ? payload.followUps : [],
  activityLog: Array.isArray(payload.activityLog) ? payload.activityLog : [],
  notifications: Array.isArray(payload.notifications) ? payload.notifications : [],
  lastSyncedAt: payload.lastSyncedAt ? new Date(payload.lastSyncedAt) : new Date(),
});

const upsertSnapshot = async (employeeId, payload) => {
  const snapshot = ensureSnapshotShape({ ...payload, employeeId });
  return AppSnapshot.findOneAndUpdate(
    { employeeId },
    { $set: snapshot },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();
};

const getSnapshot = async (employeeId) => {
  return AppSnapshot.findOne({ employeeId }).lean();
};

const getAllSnapshots = async () => {
  return AppSnapshot.find({}).sort({ updatedAt: -1 }).lean();
};

const getDuty = async (employeeId) => {
  const snapshot = await getSnapshot(employeeId);
  return snapshot?.duty || null;
};

const getLeads = async (employeeId) => {
  const snapshot = await getSnapshot(employeeId);
  return snapshot?.leads || [];
};

const getFollowUps = async (employeeId) => {
  const snapshot = await getSnapshot(employeeId);
  if (!snapshot) return [];

  const nested = Array.isArray(snapshot.leads)
    ? snapshot.leads.flatMap((lead) =>
        Array.isArray(lead.followUps)
          ? lead.followUps.map((item) => ({
              ...item,
              leadId: lead.id,
              leadBrand: lead.brand,
            }))
          : []
      )
    : [];

  const direct = Array.isArray(snapshot.followUps) ? snapshot.followUps : [];
  const merged = [...nested, ...direct];
  const seen = new Set();

  return merged.filter((item) => {
    const key = `${item.id || ''}:${item.leadId || ''}:${item.date || ''}:${item.time || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const getActivity = async (employeeId) => {
  const snapshot = await getSnapshot(employeeId);
  return snapshot?.activityLog || [];
};

const getSummary = async (employeeId) => {
  const snapshot = await getSnapshot(employeeId);
  if (!snapshot) {
    return null;
  }

  const leads = Array.isArray(snapshot.leads) ? snapshot.leads : [];
  const followUps = await getFollowUps(employeeId);
  const activityLog = Array.isArray(snapshot.activityLog) ? snapshot.activityLog : [];
  const duty = snapshot.duty || {};
  const tracking = snapshot.tracking || {};
  const totalRegistered = leads.filter((lead) => lead.status === 'Registered').length;
  const totalInterested = leads.filter((lead) => lead.status === 'Interested').length;
  const totalLost = leads.filter((lead) => ['Closed / Lost', 'Dead Lead'].includes(lead.status)).length;
  const pendingFollowUps = followUps.filter((item) => String(item.result || 'Pending') === 'Pending').length;

  return {
    employeeId,
    user: snapshot.user || {},
    duty,
    tracking,
    counts: {
      leads: leads.length,
      registered: totalRegistered,
      interested: totalInterested,
      lost: totalLost,
      followUps: followUps.length,
      pendingFollowUps,
      activity: activityLog.length,
    },
    latest: {
      lead: leads[0] || null,
      followUp: followUps[0] || null,
      activity: activityLog[0] || null,
    },
  };
};

module.exports = {
  canAccessEmployee,
  getSnapshot,
  getAllSnapshots,
  getDuty,
  getLeads,
  getFollowUps,
  getActivity,
  getSummary,
  upsertSnapshot,
};
