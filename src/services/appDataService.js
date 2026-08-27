const AppSnapshot = require('../models/AppSnapshot');
const User = require('../models/User');

const canAccessEmployee = (user, employeeId) => {
  const role = String(user?.role || '').toLowerCase();
  return role.includes('admin') || role.includes('manager') || String(user?.employeeId || '') === String(employeeId);
};

const normalizeActivityLog = (activityLog = []) => activityLog.map((activity, index) => {
  if (String(activity?.id || '').trim()) return activity;
  const timestamp = Number(activity?.timestampMs || 0);
  return {
    ...activity,
    id: `activity-${timestamp || 'unknown'}-${index}`,
  };
});

const repairLegacyActivityIds = (snapshot) => {
  if (!snapshot?.activityLog) return;
  snapshot.activityLog.forEach((activity, index) => {
    if (!String(activity.id || '').trim()) {
      const timestamp = Number(activity.timestampMs || 0);
      activity.id = `activity-${timestamp || 'unknown'}-${index}`;
    }
  });
};

const ensureSnapshotShape = (payload = {}) => ({
  employeeId: String(payload.employeeId || '').trim(),
  user: payload.user || {},
  duty: payload.duty || {},
  tracking: payload.tracking || {},
  activeLeadSession: payload.activeLeadSession?.id ? payload.activeLeadSession : null,
  activeSessionRoute: payload.activeLeadSession?.id
    ? String(payload.activeSessionRoute || '') || null
    : null,
  leadFormDraft: payload.leadFormDraft || {},
  leadFormStep: Number(payload.leadFormStep || 0),
  leads: Array.isArray(payload.leads) ? payload.leads : [],
  followUps: Array.isArray(payload.followUps) ? payload.followUps : [],
  dismissedFollowUpReminderIds: Array.isArray(payload.dismissedFollowUpReminderIds)
    ? payload.dismissedFollowUpReminderIds
    : [],
  activityLog: normalizeActivityLog(Array.isArray(payload.activityLog) ? payload.activityLog : []),
  notifications: Array.isArray(payload.notifications) ? payload.notifications : [],
  lastSyncedAtMs: Number(payload.lastSyncedAtMs || Date.now()),
  lastSyncedAt: payload.lastSyncedAt ? new Date(payload.lastSyncedAt) : new Date(),
});

const upsertSnapshot = async (employeeId, payload) => {
  const existing = await AppSnapshot.findOne({ employeeId })
    .select('+leadAdminOverrides +deletedLeadIds')
    .lean();
  const deletedLeadIds = new Set(existing?.deletedLeadIds || []);
  const leadAdminOverrides = existing?.leadAdminOverrides instanceof Map
    ? Object.fromEntries(existing.leadAdminOverrides)
    : existing?.leadAdminOverrides || {};
  const incomingLeads = Array.isArray(payload?.leads) ? payload.leads : [];
  const leads = incomingLeads
    .filter((lead) => !deletedLeadIds.has(lead?.id))
    .map((lead) => ({ ...lead, ...(leadAdminOverrides[lead.id] || {}) }));
  let followUps = (Array.isArray(payload?.followUps) ? payload.followUps : [])
    .filter((followUp) => !deletedLeadIds.has(followUp?.leadId));
  Object.entries(leadAdminOverrides).forEach(([leadId, override]) => {
    if (!Object.prototype.hasOwnProperty.call(override || {}, 'followUps')) return;
    followUps = followUps.filter((followUp) => followUp.leadId !== leadId);
    (override.followUps || []).forEach((followUp) => followUps.push({
      ...followUp,
      leadId,
      leadBrand: override.brand || leads.find((lead) => lead.id === leadId)?.brand || followUp.leadBrand || '',
    }));
  });
  const snapshot = ensureSnapshotShape({ ...payload, employeeId, leads, followUps });
  return AppSnapshot.findOneAndUpdate(
    { employeeId },
    { $set: snapshot },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();
};

const getSnapshot = async (employeeId) => {
  const [snapshot, user] = await Promise.all([
    AppSnapshot.findOne({ employeeId }).lean(),
    User.findOne({ employeeId }).lean(),
  ]);
  if (!snapshot) return null;
  const fallbackTimestamp = new Date(snapshot.updatedAt || snapshot.lastSyncedAt || 0).getTime();
  const currentUser = user
    ? {
        name: user.fullName || snapshot.user?.name || '',
        empId: user.employeeId || employeeId,
        email: user.email || snapshot.user?.email || '',
        phone: user.phone || '',
        city: user.city || '',
        area: user.area || '',
        role: user.role || '',
        department: user.department || '',
        joiningDate: user.joiningDate || '',
        profilePhotoUrl: user.profilePhotoUrl || snapshot.user?.profilePhotoUrl || null,
      }
    : snapshot.user || {};
  return {
    ...snapshot,
    user: currentUser,
    activeLeadSession: snapshot.activeLeadSession?.id ? snapshot.activeLeadSession : null,
    activeSessionRoute: snapshot.activeLeadSession?.id ? snapshot.activeSessionRoute || null : null,
    lastSyncedAtMs: Number(snapshot.lastSyncedAtMs || fallbackTimestamp || 0),
  };
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

const mutableLeadFields = [
  'brand', 'address', 'city', 'area', 'contact', 'phone', 'phone2', 'workingSince', 'website',
  'socials', 'remarks', 'status', 'leadType', 'sessionType', 'dailyVolume', 'weeklyVolume',
  'monthlyVolume', 'productType', 'avgWeight', 'presence', 'model', 'payment', 'metWith',
  'decisionMakerAvailable', 'experience', 'meetingTime', 'gps', 'startPhotoUrl',
  'indoorPhotoUrl', 'followUps', 'timeline', 'photoUrl', 'expiresAtMs', 'durationMinutes', 'draft',
];

const editableLeadValues = (payload = {}) => mutableLeadFields.reduce((values, field) => {
  if (Object.prototype.hasOwnProperty.call(payload, field)) values[field] = payload[field];
  return values;
}, {});

const updateLead = async (employeeId, leadId, payload) => {
  const snapshot = await AppSnapshot.findOne({ employeeId }).select('+leadAdminOverrides +deletedLeadIds');
  if (!snapshot) return null;

  repairLegacyActivityIds(snapshot);

  const lead = snapshot.leads.find((item) => item.id === leadId);
  if (!lead) return null;

  const values = editableLeadValues(payload);
  lead.set(values);
  const previousOverride = snapshot.leadAdminOverrides?.get(leadId) || {};
  snapshot.leadAdminOverrides.set(leadId, { ...previousOverride, ...values });

  if (Object.prototype.hasOwnProperty.call(values, 'followUps')) {
    snapshot.followUps = snapshot.followUps.filter((followUp) => followUp.leadId !== leadId);
    lead.followUps.forEach((followUp) => {
      snapshot.followUps.push({
        ...followUp.toObject(),
        leadId,
        leadBrand: lead.brand,
      });
    });
  }

  if (Object.prototype.hasOwnProperty.call(values, 'brand')) {
    lead.followUps.forEach((followUp) => { followUp.leadBrand = lead.brand; });
    snapshot.followUps.forEach((followUp) => {
      if (followUp.leadId === leadId) followUp.leadBrand = lead.brand;
    });
  }

  snapshot.lastSyncedAtMs = Date.now();
  snapshot.lastSyncedAt = new Date();
  await snapshot.save();
  return lead.toObject();
};

const deleteLead = async (employeeId, leadId) => {
  const snapshot = await AppSnapshot.findOne({ employeeId }).select('+leadAdminOverrides +deletedLeadIds');
  if (!snapshot) return null;

  repairLegacyActivityIds(snapshot);

  const lead = snapshot.leads.find((item) => item.id === leadId);
  if (!lead) return null;

  snapshot.leads = snapshot.leads.filter((item) => item.id !== leadId);
  snapshot.followUps = snapshot.followUps.filter((item) => item.leadId !== leadId);
  snapshot.leadAdminOverrides.delete(leadId);
  if (!snapshot.deletedLeadIds.includes(leadId)) snapshot.deletedLeadIds.push(leadId);
  if (snapshot.activeLeadSession?.draftLeadId === leadId) {
    snapshot.activeLeadSession = null;
    snapshot.activeSessionRoute = null;
  }
  snapshot.lastSyncedAtMs = Date.now();
  snapshot.lastSyncedAt = new Date();
  await snapshot.save();
  return lead.toObject();
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
  updateLead,
  deleteLead,
  getFollowUps,
  getActivity,
  getSummary,
  upsertSnapshot,
};
