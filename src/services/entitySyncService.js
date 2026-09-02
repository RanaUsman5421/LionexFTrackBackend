const AppSnapshot = require('../models/AppSnapshot');
const AppSyncState = require('../models/AppSyncState');
const AppSyncMetadata = require('../models/AppSyncMetadata');
const LeadRecord = require('../models/LeadRecord');
const FollowUpRecord = require('../models/FollowUpRecord');
const ActivityRecord = require('../models/ActivityRecord');
const { emitAppDataChanged } = require('./appDataRealtimeService');
const { emitAppDataUpdate } = require('./socketService');

const activityId = (item = {}) => String(item.id || '').trim()
  || `activity-${Number(item.timestampMs || 0)}-${String(item.type || item.title || '').trim()}`;

const singletonData = (snapshot = {}) => ({
  user: snapshot.user || {},
  duty: snapshot.duty || {},
  tracking: snapshot.tracking || {},
  activeLeadSession: snapshot.activeLeadSession?.id ? snapshot.activeLeadSession : null,
  activeSessionRoute: snapshot.activeLeadSession?.id ? snapshot.activeSessionRoute || null : null,
  leadFormDraft: snapshot.leadFormDraft || {},
  leadFormStep: Number(snapshot.leadFormStep || 0),
  dismissedFollowUpReminderIds: Array.isArray(snapshot.dismissedFollowUpReminderIds)
    ? snapshot.dismissedFollowUpReminderIds
    : [],
  notifications: Array.isArray(snapshot.notifications) ? snapshot.notifications : [],
  lastSyncedAtMs: Number(snapshot.lastSyncedAtMs || Date.now()),
});

const upsertRecords = async (Model, employeeId, records, idOf, extra = () => ({}), organizationId) => {
  if (!records.length) return;
  await Model.bulkWrite(records.map((data, index) => {
    const entityId = String(idOf(data, index) || '').trim();
    return {
      updateOne: {
        filter: { employeeId, entityId },
        update: { $set: { data, deletedAt: null, ...extra(data), ...(organizationId ? { organizationId } : {}) } },
        upsert: true,
      },
    };
  }).filter((operation) => operation.updateOne.filter.entityId), { ordered: false });
};

const softDeleteRecords = async (Model, employeeId, ids = []) => {
  const normalized = [...new Set(ids.map((id) => String(id || '').trim()).filter(Boolean))];
  if (!normalized.length) return;
  await Model.updateMany(
    { employeeId, entityId: { $in: normalized } },
    { $set: { deletedAt: new Date() } }
  );
};

const bumpVersion = async (employeeId, source = 'backend', organizationId) => {
  const metadata = await AppSyncMetadata.findOneAndUpdate(
    { employeeId },
    { $inc: { version: 1 }, $set: organizationId ? { organizationId } : {}, $setOnInsert: { lastLegacyUpdatedAt: null } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();
  const payload = { organizationId, employeeId, version: metadata.version, source, timestamp: new Date().toISOString() };
  emitAppDataChanged(employeeId, metadata.version, source);
  emitAppDataUpdate(payload);
  return metadata;
};

const importLegacySnapshot = async (employeeId, snapshot, { force = false, organizationId = snapshot?.organizationId } = {}) => {
  if (!snapshot) return null;
  const metadata = await AppSyncMetadata.findOne({ employeeId }).lean();
  const snapshotUpdatedAt = new Date(snapshot.updatedAt || snapshot.lastSyncedAt || 0);
  if (!force && metadata?.lastLegacyUpdatedAt && snapshotUpdatedAt <= metadata.lastLegacyUpdatedAt) {
    return metadata;
  }

  const leads = Array.isArray(snapshot.leads) ? snapshot.leads : [];
  const followUps = Array.isArray(snapshot.followUps) ? snapshot.followUps : [];
  const activities = Array.isArray(snapshot.activityLog) ? snapshot.activityLog : [];
  const explicitDeletedLeadIds = Array.isArray(snapshot.deletedLeadIds) ? snapshot.deletedLeadIds : [];

  await AppSyncState.findOneAndUpdate(
    { employeeId },
    { $set: { data: singletonData(snapshot), ...(organizationId ? { organizationId } : {}) } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  await upsertRecords(LeadRecord, employeeId, leads, (lead) => lead.id, undefined, organizationId);
  await upsertRecords(FollowUpRecord, employeeId, followUps, (followUp) => followUp.id, (followUp) => ({
    leadId: String(followUp.leadId || '').trim(),
  }), organizationId);
  await upsertRecords(ActivityRecord, employeeId, activities, activityId, undefined, organizationId);

  if (metadata || force) {
    const currentLeadIds = leads.map((lead) => String(lead.id || '')).filter(Boolean);
    const currentFollowUpIds = followUps.map((followUp) => String(followUp.id || '')).filter(Boolean);
    const currentActivityIds = activities.map(activityId).filter(Boolean);
    const missingLeads = await LeadRecord.find({
      employeeId,
      deletedAt: null,
      entityId: { $nin: currentLeadIds },
    }).select('entityId').lean();
    await softDeleteRecords(
      LeadRecord,
      employeeId,
      [...explicitDeletedLeadIds, ...missingLeads.map((item) => item.entityId)]
    );
    const [missingFollowUps, missingActivities] = await Promise.all([
      FollowUpRecord.find({ employeeId, deletedAt: null, entityId: { $nin: currentFollowUpIds } }).select('entityId').lean(),
      ActivityRecord.find({ employeeId, deletedAt: null, entityId: { $nin: currentActivityIds } }).select('entityId').lean(),
    ]);
    await softDeleteRecords(FollowUpRecord, employeeId, missingFollowUps.map((item) => item.entityId));
    await softDeleteRecords(ActivityRecord, employeeId, missingActivities.map((item) => item.entityId));
  } else {
    await softDeleteRecords(LeadRecord, employeeId, explicitDeletedLeadIds);
  }

  const next = await bumpVersion(employeeId, 'legacy', organizationId);
  return AppSyncMetadata.findOneAndUpdate(
    { employeeId },
    { $set: { lastLegacyUpdatedAt: snapshotUpdatedAt } },
    { new: true }
  ).lean() || next;
};

const reconcileLegacySnapshot = async (employeeId) => {
  const snapshot = await AppSnapshot.findOne({ employeeId })
    .select('+deletedLeadIds')
    .lean();
  if (!snapshot) {
    await AppSyncMetadata.updateOne(
      { employeeId },
      { $setOnInsert: { version: 0, lastLegacyUpdatedAt: null } },
      { upsert: true }
    );
    return;
  }
  await importLegacySnapshot(employeeId, snapshot);
};

const buildNormalizedSnapshot = async (employeeId) => {
  const [state, leads, followUps, activities, legacy] = await Promise.all([
    AppSyncState.findOne({ employeeId }).lean(),
    LeadRecord.find({ employeeId, deletedAt: null }).sort({ createdAt: 1 }).lean(),
    FollowUpRecord.find({ employeeId, deletedAt: null }).sort({ createdAt: 1 }).lean(),
    ActivityRecord.find({ employeeId, deletedAt: null }).sort({ 'data.timestampMs': -1, createdAt: -1 }).lean(),
    AppSnapshot.findOne({ employeeId }).lean(),
  ]);
  if (!state && !legacy) return null;
  const data = state?.data || singletonData(legacy || {});
  return {
    employeeId,
    ...data,
    leads: leads.map((record) => record.data),
    followUps: followUps.map((record) => record.data),
    activityLog: activities.map((record) => ({ ...record.data, id: record.entityId })),
    lastSyncedAtMs: Number(data.lastSyncedAtMs || Date.now()),
  };
};

const materializeLegacySnapshot = async (employeeId, organizationId) => {
  const snapshot = await buildNormalizedSnapshot(employeeId);
  if (!snapshot) return null;
  const saved = await AppSnapshot.findOneAndUpdate(
    { employeeId },
    { $set: { ...snapshot, ...(organizationId ? { organizationId } : {}), lastSyncedAt: new Date() } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();
  await AppSyncMetadata.updateOne(
    { employeeId },
    { $set: { lastLegacyUpdatedAt: saved.updatedAt || new Date() } }
  );
  return saved;
};

const applyEntityDelta = async (employeeId, delta = {}, organizationId) => {
  await reconcileLegacySnapshot(employeeId);
  const serverChangedAtMs = Date.now();
  if (delta.state && typeof delta.state === 'object') {
    await AppSyncState.findOneAndUpdate(
      { employeeId },
      { $set: { data: { ...delta.state, lastSyncedAtMs: serverChangedAtMs }, ...(organizationId ? { organizationId } : {}) } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  } else {
    await AppSyncState.updateOne(
      { employeeId },
      { $set: { 'data.lastSyncedAtMs': serverChangedAtMs, ...(organizationId ? { organizationId } : {}) } }
    );
  }
  const protectedSnapshot = await AppSnapshot.findOne({ employeeId })
    .select('+leadAdminOverrides +deletedLeadIds')
    .lean();
  const deletedLeadIds = new Set(protectedSnapshot?.deletedLeadIds || []);
  const leadAdminOverrides = protectedSnapshot?.leadAdminOverrides instanceof Map
    ? Object.fromEntries(protectedSnapshot.leadAdminOverrides)
    : protectedSnapshot?.leadAdminOverrides || {};
  const safeLeadUpserts = (Array.isArray(delta.upsertLeads) ? delta.upsertLeads : [])
    .filter((lead) => !deletedLeadIds.has(lead?.id))
    .map((lead) => ({ ...lead, ...(leadAdminOverrides[lead.id] || {}) }));
  await upsertRecords(LeadRecord, employeeId, safeLeadUpserts, (lead) => lead.id, undefined, organizationId);
  await softDeleteRecords(LeadRecord, employeeId, delta.deleteLeadIds);
  const cascadedLeadDeletes = [...new Set([...(delta.deleteLeadIds || []), ...deletedLeadIds])];
  if (cascadedLeadDeletes.length) {
    await FollowUpRecord.updateMany(
      { employeeId, leadId: { $in: cascadedLeadDeletes } },
      { $set: { deletedAt: new Date() } }
    );
  }
  const protectedFollowUps = new Map();
  Object.entries(leadAdminOverrides).forEach(([leadId, override]) => {
    if (!Object.prototype.hasOwnProperty.call(override || {}, 'followUps')) return;
    (override.followUps || []).forEach((followUp) => {
      if (followUp?.id) protectedFollowUps.set(followUp.id, { ...followUp, leadId });
    });
  });
  const safeFollowUpUpserts = (Array.isArray(delta.upsertFollowUps) ? delta.upsertFollowUps : [])
    .filter((followUp) => !Object.prototype.hasOwnProperty.call(leadAdminOverrides[followUp?.leadId] || {}, 'followUps'));
  await upsertRecords(
    FollowUpRecord,
    employeeId,
    [...safeFollowUpUpserts, ...protectedFollowUps.values()],
    (followUp) => followUp.id,
    (followUp) => ({ leadId: String(followUp.leadId || '').trim() }),
    organizationId
  );
  await softDeleteRecords(
    FollowUpRecord,
    employeeId,
    (delta.deleteFollowUpIds || []).filter((id) => !protectedFollowUps.has(id))
  );
  await upsertRecords(
    ActivityRecord,
    employeeId,
    Array.isArray(delta.upsertActivities) ? delta.upsertActivities : [],
    activityId,
    undefined,
    organizationId
  );
  await softDeleteRecords(ActivityRecord, employeeId, delta.deleteActivityIds);

  const metadata = await bumpVersion(employeeId, 'entity-sync', organizationId);
  const snapshot = await materializeLegacySnapshot(employeeId, organizationId);
  return { version: metadata.version, snapshot };
};

const getEntityBundle = async (employeeId, sinceVersion = 0) => {
  await reconcileLegacySnapshot(employeeId);
  const metadata = await AppSyncMetadata.findOne({ employeeId }).lean();
  const version = Number(metadata?.version || 0);
  if (version <= Number(sinceVersion || 0)) {
    return { changed: false, version, snapshot: null };
  }
  return { changed: true, version, snapshot: await buildNormalizedSnapshot(employeeId) };
};

module.exports = {
  activityId,
  applyEntityDelta,
  buildNormalizedSnapshot,
  getEntityBundle,
  importLegacySnapshot,
  materializeLegacySnapshot,
  reconcileLegacySnapshot,
};
