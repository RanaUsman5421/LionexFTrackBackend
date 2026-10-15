const AppSyncState = require('../../models/sync/AppSyncState');
const AppSyncMetadata = require('../../models/sync/AppSyncMetadata');
const LeadRecord = require('../../models/sync/LeadRecord');
const FollowUpRecord = require('../../models/sync/FollowUpRecord');
const ActivityRecord = require('../../models/sync/ActivityRecord');
const { verifyDeviceSignature } = require('../tracking/verificationService');

const activityId = (item = {}) => String(item.id || '').trim()
  || `activity-${Number(item.timestampMs || 0)}-${String(item.type || item.title || '').trim()}`;

const VERIFICATION_STATUSES = new Set(['Verified', 'Verified with Observations', 'Partially Verified', 'Revisit Required', 'Not Verified', 'Suspicious/High Risk', 'Customer Refused', 'Address Not Found']);
const VERIFICATION_VALUE_KEYS = new Set([
  'applicationCaseId', 'customerFullName', 'cnicNumber', 'mobileNumber', 'residentialAddress', 'city',
  'productName', 'financeAmount', 'customerAvailable', 'submittedAddressMatched', 'visitRemarks',
  'originalCnicChecked', 'cnicInformationMatched', 'customerFaceMatched', 'customerLivesAtAddress',
  'residenceType', 'utilityBillChecked', 'workType', 'employerName', 'businessName', 'otherWorkDetails',
  'monthlyIncome', 'workStatus', 'identityResult', 'residenceResult', 'workResult', 'informationMismatch',
  'suspiciousActivity', 'revisitRequired', 'overallStatus', 'finalOfficerRemarks',
  'additionalDocumentDescription', 'officerDeviceId', 'officerBiometricPayload',
  'officerBiometricSignature', 'officerBiometricPublicKey', 'automaticGps', 'automaticGpsAccuracy',
  'automaticVisitDateTimeMs', 'officerDeclaration', 'verificationSchemaVersion',
]);
const REQUIRED_VERIFICATION_VALUES = [
  'applicationCaseId', 'customerFullName', 'cnicNumber', 'mobileNumber', 'residentialAddress', 'city',
  'productName', 'financeAmount', 'customerAvailable', 'submittedAddressMatched', 'visitRemarks',
  'originalCnicChecked', 'cnicInformationMatched', 'customerFaceMatched', 'customerLivesAtAddress',
  'residenceType', 'utilityBillChecked', 'workType', 'monthlyIncome', 'workStatus', 'identityResult',
  'residenceResult', 'workResult', 'informationMismatch', 'suspiciousActivity', 'revisitRequired',
  'overallStatus', 'finalOfficerRemarks', 'automaticGps', 'automaticGpsAccuracy',
  'automaticVisitDateTimeMs', 'officerDeclaration',
];
const VERIFICATION_EVIDENCE_KEYS = new Set([
  'cnicFront', 'cnicBack', 'customerLive', 'residenceExterior', 'workplace', 'additionalDocument',
]);
const INVESTOR_TYPES = new Set(['Individual Investor', 'Business Owner', 'Angel Investor', 'Investment Firm', 'Corporate Investor', 'Existing Investor', 'Referral']);
const INVESTMENT_CAPACITIES = new Set(['Below 1 Million', '1-5 Million', '5-10 Million', '10-25 Million', '25-50 Million', '50M+']);
const INVESTMENT_INTERESTS = new Set(['Interested', 'Maybe / Considering', 'Not Interested', 'Need More Information']);
const INVESTOR_VISIT_TYPES = new Set(['First Meeting', 'Follow-up', 'Presentation', 'Proposal Discussion', 'Negotiation', 'Due Diligence', 'Closing Meeting']);
const INVESTOR_MEETING_STATUSES = new Set(['Successful', 'Interested', 'Follow-up Required', 'Proposal Requested', 'Management Meeting Required', 'Not Interested', 'No Meeting / Person Unavailable']);

const cleanInvestorRecord = (record = {}) => {
  if (record.leadType !== 'Investor Program' || record.draft === true || !record.investorType) return record;
  const requiredText = ['brand', 'phone', 'city', 'discussionSummary', 'followUpRequired'];
  if (requiredText.some((field) => !String(record[field] || '').trim())) {
    throw new Error('Investor visit is missing required information.');
  }
  if (!INVESTOR_TYPES.has(record.investorType)
    || !INVESTMENT_CAPACITIES.has(record.investmentCapacity)
    || !INVESTMENT_INTERESTS.has(record.investmentInterestStatus)
    || !INVESTOR_VISIT_TYPES.has(record.visitType)
    || !INVESTOR_MEETING_STATUSES.has(record.meetingStatus)
    || !['Yes', 'No'].includes(record.followUpRequired)) {
    throw new Error('Investor visit contains an invalid selection.');
  }
  if (record.followUpRequired === 'Yes' && (!record.followUps?.length || !record.nextAction)) {
    throw new Error('Investor follow-up details are required.');
  }
  const meetingDateTimeMs = Number(record.meetingDateTimeMs || 0);
  const visitStartTimeMs = Number(record.visitStartTimeMs || 0);
  const visitEndTimeMs = Number(record.visitEndTimeMs || 0);
  const latitude = Number(record.gpsLatitude);
  const longitude = Number(record.gpsLongitude);
  const accuracy = Number(record.gpsAccuracyMeters || 0);
  if (meetingDateTimeMs <= 0 || visitStartTimeMs <= 0 || visitEndTimeMs < visitStartTimeMs
    || !Number.isFinite(latitude) || latitude < -90 || latitude > 90
    || !Number.isFinite(longitude) || longitude < -180 || longitude > 180
    || !Number.isFinite(accuracy) || accuracy < 0) {
    throw new Error('Investor visit contains invalid automatic visit data.');
  }
  if (record.emailAddress && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(record.emailAddress))) {
    throw new Error('Investor email address is invalid.');
  }
  return {
    ...record,
    meetingDateTimeMs,
    visitStartTimeMs,
    visitEndTimeMs,
    meetingDurationSeconds: Math.max(0, Number(record.meetingDurationSeconds) || 0),
    gpsLatitude: latitude,
    gpsLongitude: longitude,
    gpsAccuracyMeters: accuracy,
  };
};
const cleanVerificationRecord = (record = {}) => {
  if (record.recordType !== 'customer_verification') return record;
  const verification = record.customerVerification && typeof record.customerVerification === 'object' ? record.customerVerification : {};
  const rawValues = verification.values && typeof verification.values === 'object' ? verification.values : {};
  const biometricPayload = String(rawValues.officerBiometricPayload || '');
  const payloadParts = biometricPayload.split(':');
  const biometricTimestamp = Number(payloadParts.at(-1));
  const biometricValid = verification.officerBiometricVerified === true
    && biometricPayload.startsWith(`lionex-customer-verification-v1:${record.id}:`)
    && Number.isFinite(biometricTimestamp) && biometricTimestamp > 0
    && verifyDeviceSignature({ publicKey: rawValues.officerBiometricPublicKey, signature: rawValues.officerBiometricSignature, payload: biometricPayload });
  if (!biometricValid) throw new Error('A valid officer biometric proof is required to submit a customer verification.');
  const usesCompactSchema = String(rawValues.verificationSchemaVersion || '') === '2';
  const values = Object.fromEntries(
    Object.entries(rawValues).slice(0, 120)
      .filter(([key]) => usesCompactSchema
        ? VERIFICATION_VALUE_KEYS.has(key)
        : /^[A-Za-z][A-Za-z0-9]{0,79}$/.test(key))
      .map(([key, value]) => [key, String(value ?? '').trim().slice(0, 2000)])
  );
  if (usesCompactSchema && REQUIRED_VERIFICATION_VALUES.some((key) => !values[key])) {
    throw new Error('Customer verification is missing required information.');
  }
  const conditionalWorkField = {
    Salaried: 'employerName',
    'Business Owner': 'businessName',
    Freelancer: 'otherWorkDetails',
    Other: 'otherWorkDetails',
  }[values.workType];
  if (usesCompactSchema && (!conditionalWorkField || !values[conditionalWorkField])) {
    throw new Error('Customer verification is missing required work information.');
  }
  if (usesCompactSchema && !VERIFICATION_STATUSES.has(values.overallStatus)) {
    throw new Error('Customer verification contains an invalid overall status.');
  }
  const rawEvidence = verification.evidence && typeof verification.evidence === 'object' ? verification.evidence : {};
  const evidence = Object.fromEntries(Object.entries(rawEvidence).slice(0, 20).filter(([key]) => usesCompactSchema
    ? VERIFICATION_EVIDENCE_KEYS.has(key)
    : /^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(key)).map(([key, item = {}]) => [key, {
    remoteUrl: /^https:\/\//i.test(String(item.remoteUrl || '')) ? String(item.remoteUrl).slice(0, 2048) : '',
    latitude: Number(item.latitude) || 0, longitude: Number(item.longitude) || 0,
    accuracy: Math.max(0, Number(item.accuracy) || 0), capturedAtMs: Math.max(0, Number(item.capturedAtMs) || 0),
    caseId: String(item.caseId || record.id || '').slice(0, 120),
  }]));
  const status = usesCompactSchema
    ? values.overallStatus
    : (VERIFICATION_STATUSES.has(String(record.status)) ? String(record.status) : 'Partially Verified');
  return { ...record, status, recordType: 'customer_verification', customerVerification: {
    values, evidence, officerBiometricVerified: verification.officerBiometricVerified === true,
    submittedAtMs: Math.max(0, Number(verification.submittedAtMs) || Date.now()),
  } };
};

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

// Compatibility endpoints use record storage; the old collection is migration-only.
const reconcileLegacySnapshot = async (employeeId) => {
  const metadata = await AppSyncMetadata.findOne({employeeId}).select('epoch').lean();
  if (metadata?.epoch) return;
  const user = await require('../../models/organization/User').findOne({employeeId}).select('organizationId').lean();
  return require('./recordSyncService').ensureReady(employeeId, user?.organizationId || null);
};

const importLegacySnapshot = (employeeId, snapshot, {organizationId = snapshot?.organizationId} = {}) =>
  require('./recordSyncService').ingestLegacySnapshot(employeeId, snapshot, organizationId);

const buildNormalizedSnapshot = async (employeeId) => {
  const [state, leads, followUps, activities, notices] = await Promise.all([
    AppSyncState.findOne({ employeeId }).lean(),
    LeadRecord.find({ employeeId, deletedAt: null }).sort({ createdAt: 1 }).lean(),
    FollowUpRecord.find({ employeeId, deletedAt: null }).sort({ createdAt: 1 }).lean(),
    ActivityRecord.find({ employeeId, deletedAt: null }).sort({ 'data.timestampMs': -1, createdAt: -1 }).lean(),
    require('../../models/sync/AppNotificationRecord').find({employeeId,deletedAt:null}).sort({createdAt:-1}).lean(),
  ]);
  if (!state) return null;
  const data = state.data || {};
  return {
    employeeId,
    ...data,
    notifications: notices.length ? notices.map(row=>({...row.data,id:row.entityId})) : (data.notifications || []),
    leads: leads.map((record) => record.data),
    followUps: followUps.map((record) => record.data),
    activityLog: activities.map((record) => ({ ...record.data, id: record.entityId })),
    lastSyncedAtMs: Number(data.lastSyncedAtMs || Date.now()),
  };
};

const applyEntityDelta = (employeeId, delta = {}, organizationId) =>
  require('./recordSyncService').ingestLegacyDelta(employeeId, organizationId, delta);

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
  cleanVerificationRecord,
  cleanInvestorRecord,
  applyEntityDelta,
  buildNormalizedSnapshot,
  getEntityBundle,
  importLegacySnapshot,
  singletonData,
  reconcileLegacySnapshot,
};
