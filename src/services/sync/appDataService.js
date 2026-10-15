const User = require('../../models/organization/User');
const SyncState=require('../../models/sync/AppSyncState');
const { canAccessEmployee } = require('../../utils/access/tenantAccess');

const normalizeActivityLog = (activityLog = []) => activityLog.map((activity, index) => {
  if (String(activity?.id || '').trim()) return activity;
  const timestamp = Number(activity?.timestampMs || 0);
  return {
    ...activity,
    id: `activity-${timestamp || 'unknown'}-${index}`,
  };
});

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

const upsertSnapshot = async (employeeId, payload, organizationId) => {
  await require('./recordSyncService').ingestLegacySnapshot(employeeId, ensureSnapshotShape(payload), organizationId);
  return getSnapshot(employeeId);
};

const getSnapshot = async (employeeId) => {
  await require('./entitySyncService').reconcileLegacySnapshot(employeeId);
  const [snapshot, user] = await Promise.all([
    require('./entitySyncService').buildNormalizedSnapshot(employeeId),
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

const getAllSnapshots = async (organizationId) => {
  const states=await SyncState.find(organizationId ? {organizationId}:{}).select('employeeId').lean();
  const ids=[...new Set(states.map(row=>row.employeeId))];
  const results=[];
  for(const id of ids) { const snapshot=await getSnapshot(id);if(snapshot)results.push(snapshot); }
  return results;
};

const getDuty = async (employeeId) => {
  await require('./entitySyncService').reconcileLegacySnapshot(employeeId);
  const state=await SyncState.findOne({employeeId}).select('data.duty').lean();
  return state?.data?.duty || null;
};

const getLeads = async (employeeId) => {
  await require('./entitySyncService').reconcileLegacySnapshot(employeeId);
  const rows=await require('../../models/sync/LeadRecord').find({employeeId,deletedAt:null}).sort({createdAt:1}).select('data').lean();
  return rows.map(row=>row.data);
};

const mutableLeadFields = [
  'brand', 'address', 'city', 'area', 'contact', 'phone', 'phone2', 'workingSince', 'website',
  'socials', 'remarks', 'status', 'leadType', 'investmentInterest', 'investmentRange', 'decisionTimeline', 'sessionType', 'dailyVolume', 'weeklyVolume',
  'whatsappNumber', 'emailAddress', 'companyName', 'designation', 'businessIndustry', 'investorType',
  'investmentCapacity', 'minimumInvestmentAmount', 'maximumInvestmentAmount', 'investmentInterestStatus',
  'preferredInvestmentType', 'visitType', 'meetingStatus', 'discussionSummary', 'investorRequirements',
  'investorQuestions', 'expectedInvestmentAmount', 'expectedDecisionDate', 'leadStrength', 'followUpRequired',
  'nextAction', 'followUpRemarks',
  'monthlyVolume', 'productType', 'avgWeight', 'presence', 'model', 'payment', 'metWith',
  'decisionMakerAvailable', 'experience', 'meetingTime', 'gps', 'startPhotoUrl',
  'indoorPhotoUrl', 'followUps', 'timeline', 'photoUrl', 'expiresAtMs', 'durationMinutes', 'draft',
];

const editableLeadValues = (payload = {}) => mutableLeadFields.reduce((values, field) => {
  if (Object.prototype.hasOwnProperty.call(payload, field)) values[field] = payload[field];
  return values;
}, {});

const updateLead = (employeeId, leadId, payload) =>
  require('./recordSyncService').editLead(employeeId, leadId, editableLeadValues(payload));

const deleteLead = (employeeId, leadId) =>
  require('./recordSyncService').editLead(employeeId, leadId, {}, true);

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
  await require('./entitySyncService').reconcileLegacySnapshot(employeeId);
  const rows=await require('../../models/sync/ActivityRecord').find({employeeId,deletedAt:null}).sort({'data.timestampMs':-1}).select('data entityId').lean();
  return rows.map(row=>({...row.data,id:row.entityId}));
};

const getSummary = async (employeeId) => {
  await require('./entitySyncService').reconcileLegacySnapshot(employeeId);
  const Lead=require('../../models/sync/LeadRecord');
  const FollowUp=require('../../models/sync/FollowUpRecord');
  const Activity=require('../../models/sync/ActivityRecord');
  const query={employeeId,deletedAt:null};
  const [state,leadCounts,followUps,pendingFollowUps,activity,lead,followUp,event]=await Promise.all([
    SyncState.findOne({employeeId}).select('data.user data.duty data.tracking').lean(),
    Lead.aggregate([{$match:query},{$group:{_id:'$data.status',count:{$sum:1}}}]),
    FollowUp.countDocuments(query),
    FollowUp.countDocuments({...query,'data.result':{$in:['Pending',null]}}),
    Activity.countDocuments(query),
    Lead.findOne(query).sort({createdAt:-1}).select('data').lean(),
    FollowUp.findOne(query).sort({createdAt:-1}).select('data').lean(),
    Activity.findOne(query).sort({'data.timestampMs':-1}).select('data').lean(),
  ]);
  if(!state)return null;
  const count=status=>leadCounts.find(row=>row._id===status)?.count||0;
  return {employeeId,user:state.data.user||{},duty:state.data.duty||{},tracking:state.data.tracking||{},
    counts:{leads:leadCounts.reduce((sum,row)=>sum+row.count,0),registered:count('Registered'),interested:count('Interested'),lost:count('Closed / Lost')+count('Dead Lead'),followUps,pendingFollowUps,activity},
    latest:{lead:lead?.data||null,followUp:followUp?.data||null,activity:event?.data||null}};
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
