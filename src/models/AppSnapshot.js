const mongoose = require('mongoose');

const investorTypes = ['', 'Individual Investor', 'Business Owner', 'Angel Investor', 'Investment Firm', 'Corporate Investor', 'Existing Investor', 'Referral'];
const investmentCapacities = ['', 'Below 1 Million', '1-5 Million', '5-10 Million', '10-25 Million', '25-50 Million', '50M+'];
const investmentInterestStatuses = ['', 'Interested', 'Maybe / Considering', 'Not Interested', 'Need More Information'];
const preferredInvestmentTypes = ['', 'Equity', 'Profit Sharing', 'Partnership', 'Loan / Financing', 'Strategic Investment', 'Not Decided'];
const investorVisitTypes = ['', 'First Meeting', 'Follow-up', 'Presentation', 'Proposal Discussion', 'Negotiation', 'Due Diligence', 'Closing Meeting'];
const investorMeetingStatuses = ['', 'Successful', 'Interested', 'Follow-up Required', 'Proposal Requested', 'Management Meeting Required', 'Not Interested', 'No Meeting / Person Unavailable'];
const leadStrengths = ['', 'Cold', 'Warm', 'Hot'];
const followUpRequiredValues = ['', 'Yes', 'No'];

const socialLinkSchema = new mongoose.Schema(
  {
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', default: null, index: true },
    platform: { type: String, default: '' },
    value: { type: String, default: '' },
  },
  { _id: false }
);

const followUpSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    leadId: { type: String, default: '' },
    leadBrand: { type: String, default: '' },
    type: { type: String, default: '' },
    date: { type: String, default: '' },
    time: { type: String, default: '' },
    notes: { type: String, default: '' },
    result: { type: String, default: 'Pending' },
    closingRemarks: { type: String, default: '' },
    createdAtMs: { type: Number, default: Date.now },
  },
  { _id: false }
);

const activitySchema = new mongoose.Schema(
  {
    id: {
      type: String,
      required: true,
      default: () => `activity-${Date.now()}-${new mongoose.Types.ObjectId()}`,
    },
    title: { type: String, default: '' },
    subtitle: { type: String, default: '' },
    time: { type: String, default: '' },
    type: { type: String, default: '' },
    dotColor: { type: String, default: '' },
    timestampMs: { type: Number, default: Date.now },
  },
  { _id: false }
);

const notificationSchema = new mongoose.Schema(
  {
    title: { type: String, default: '' },
    subtitle: { type: String, default: '' },
    icon: { type: String, default: '' },
    time: { type: String, default: '' },
    timestampMs: { type: Number, default: Date.now },
  },
  { _id: false }
);

const leadSessionSchema = new mongoose.Schema(
  {
    id: { type: String, default: '' },
    coords: {
      latitude: { type: Number, default: 0 },
      longitude: { type: Number, default: 0 },
      accuracy: { type: Number, default: 0 },
    },
    address: { type: String, default: '' },
    startTimeMs: { type: Number, default: 0 },
    startLabel: { type: String, default: '' },
    meetingStartTimeMs: { type: Number, default: 0 },
    meetingStartLabel: { type: String, default: '' },
    sessionType: { type: String, default: 'Lead' },
    startPhotoUrl: { type: String, default: null },
    brand: { type: String, default: '' },
    draftLeadId: { type: String, default: null },
  },
  { _id: false }
);

const leadDraftSchema = new mongoose.Schema(
  {
    brand: { type: String, default: '' },
    brandEditing: { type: Boolean, default: false },
    address: { type: String, default: '' },
    city: { type: String, default: '' },
    area: { type: String, default: '' },
    phone1: { type: String, default: '' },
    phone2: { type: String, default: '' },
    workingSince: { type: String, default: '' },
    website: { type: String, default: '' },
    socials: { type: [socialLinkSchema], default: [] },
    remarks: { type: String, default: '' },
    dailyVol: { type: String, default: '' },
    monthlyVol: { type: String, default: '' },
    productType: { type: String, default: '' },
    avgWeight: { type: String, default: '' },
    presence: { type: String, default: '' },
    model: { type: String, default: '' },
    payment: { type: String, default: '' },
    metWith: { type: String, default: '' },
    decisionMakerAvailable: { type: String, default: 'Yes' },
    leadType: { type: String, default: 'Standard' },
    experience: { type: String, default: '' },
    status: { type: String, default: 'Interested' },
    photo: { type: String, default: null },
    followUpType: { type: String, default: 'First' },
    followUpDate: { type: String, default: '' },
    followUpTime: { type: String, default: '' },
    followUpNotes: { type: String, default: '' },
    investmentInterest: { type: String, default: '' },
    investmentRange: { type: String, default: '' },
    decisionTimeline: { type: String, default: '' },
    whatsappNumber: { type: String, default: '' },
    emailAddress: { type: String, default: '' },
    companyName: { type: String, default: '' },
    designation: { type: String, default: '' },
    businessIndustry: { type: String, default: '' },
    investorType: { type: String, enum: investorTypes, default: '' },
    investmentCapacity: { type: String, enum: investmentCapacities, default: '' },
    minimumInvestmentAmount: { type: String, default: '' },
    maximumInvestmentAmount: { type: String, default: '' },
    investmentInterestStatus: { type: String, enum: investmentInterestStatuses, default: '' },
    preferredInvestmentType: { type: String, enum: preferredInvestmentTypes, default: '' },
    visitType: { type: String, enum: investorVisitTypes, default: '' },
    meetingStatus: { type: String, enum: investorMeetingStatuses, default: '' },
    discussionSummary: { type: String, default: '' },
    investorRequirements: { type: String, default: '' },
    investorQuestions: { type: String, default: '' },
    expectedInvestmentAmount: { type: String, default: '' },
    expectedDecisionDate: { type: String, default: '' },
    leadStrength: { type: String, enum: leadStrengths, default: '' },
    followUpRequired: { type: String, enum: followUpRequiredValues, default: '' },
    nextAction: { type: String, default: '' },
    followUpRemarks: { type: String, default: '' },
  },
  { _id: false }
);

const leadSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    brand: { type: String, default: '' },
    address: { type: String, default: '' },
    city: { type: String, default: '' },
    area: { type: String, default: '' },
    contact: { type: String, default: '' },
    phone: { type: String, default: '' },
    phone2: { type: String, default: '' },
    workingSince: { type: String, default: '' },
    website: { type: String, default: '' },
    socials: { type: [socialLinkSchema], default: [] },
    remarks: { type: String, default: '' },
    status: { type: String, default: '' },
    leadType: { type: String, default: '' },
    investmentInterest: { type: String, default: '' },
    investmentRange: { type: String, default: '' },
    decisionTimeline: { type: String, default: '' },
    whatsappNumber: { type: String, default: '' },
    emailAddress: { type: String, default: '' },
    companyName: { type: String, default: '' },
    designation: { type: String, default: '' },
    businessIndustry: { type: String, default: '' },
    investorType: { type: String, enum: investorTypes, default: '' },
    investmentCapacity: { type: String, enum: investmentCapacities, default: '' },
    minimumInvestmentAmount: { type: String, default: '' },
    maximumInvestmentAmount: { type: String, default: '' },
    investmentInterestStatus: { type: String, enum: investmentInterestStatuses, default: '' },
    preferredInvestmentType: { type: String, enum: preferredInvestmentTypes, default: '' },
    visitType: { type: String, enum: investorVisitTypes, default: '' },
    meetingStatus: { type: String, enum: investorMeetingStatuses, default: '' },
    discussionSummary: { type: String, default: '' },
    investorRequirements: { type: String, default: '' },
    investorQuestions: { type: String, default: '' },
    expectedInvestmentAmount: { type: String, default: '' },
    expectedDecisionDate: { type: String, default: '' },
    leadStrength: { type: String, enum: leadStrengths, default: '' },
    followUpRequired: { type: String, enum: followUpRequiredValues, default: '' },
    nextAction: { type: String, default: '' },
    followUpRemarks: { type: String, default: '' },
    sessionType: { type: String, default: '' },
    dailyVolume: { type: String, default: '' },
    weeklyVolume: { type: String, default: '' },
    monthlyVolume: { type: String, default: '' },
    productType: { type: String, default: '' },
    avgWeight: { type: String, default: '' },
    presence: { type: String, default: '' },
    model: { type: String, default: '' },
    payment: { type: String, default: '' },
    metWith: { type: String, default: '' },
    decisionMakerAvailable: { type: String, default: 'Yes' },
    experience: { type: String, default: '' },
    meetingTime: { type: String, default: '' },
    gps: { type: String, default: '' },
    sessionId: { type: String, default: '' },
    startPhotoUrl: { type: String, default: null },
    indoorPhotoUrl: { type: String, default: null },
    followUps: { type: [followUpSchema], default: [] },
    timeline: { type: [String], default: [] },
    photoUrl: { type: String, default: null },
    createdAtMs: { type: Number, default: Date.now },
    expiresAtMs: { type: Number, default: 0 },
    durationMinutes: { type: Number, default: 0 },
    meetingDateTimeMs: { type: Number, default: 0 },
    visitStartTimeMs: { type: Number, default: 0 },
    visitEndTimeMs: { type: Number, default: 0 },
    meetingDurationSeconds: { type: Number, default: 0 },
    gpsLatitude: { type: Number, default: 0 },
    gpsLongitude: { type: Number, default: 0 },
    fullLocationAddress: { type: String, default: '' },
    gpsAccuracyMeters: { type: Number, default: 0 },
    draft: { type: Boolean, default: false },
    recordType: { type: String, enum: ['lead', 'customer_verification'], default: 'lead' },
    customerVerification: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { _id: false }
);

const dutySchema = new mongoose.Schema(
  {
    dayKey: { type: String, default: '' },
    active: { type: Boolean, default: false },
    accumulatedMs: { type: Number, default: 0 },
    sessionStartMs: { type: Number, default: 0 },
  },
  { _id: false }
);

const trackingSchema = new mongoose.Schema(
  {
    fieldDayActive: { type: Boolean, default: false },
    distanceKm: { type: Number, default: 0 },
    currentAddress: { type: String, default: '' },
    trackingStatus: { type: String, default: 'Idle' },
    gpsAccuracy: { type: Number, default: 0 },
    currentSpeedKmh: { type: Number, default: 0 },
    currentHeading: { type: Number, default: 0 },
    currentAltitudeMeters: { type: Number, default: 0 },
    lastGpsUpdateMs: { type: Number, default: 0 },
    currentGps: {
      latitude: { type: Number, default: 0 },
      longitude: { type: Number, default: 0 },
      accuracy: { type: Number, default: 0 },
    },
  },
  { _id: false }
);

const appSnapshotSchema = new mongoose.Schema(
  {
    employeeId: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    user: {
      name: { type: String, default: '' },
      empId: { type: String, default: '' },
      email: { type: String, default: '' },
      phone: { type: String, default: '' },
      city: { type: String, default: '' },
      area: { type: String, default: '' },
      role: { type: String, default: '' },
      department: { type: String, default: '' },
      joiningDate: { type: String, default: '' },
      profilePhotoUrl: { type: String, default: null },
    },
    duty: { type: dutySchema, default: () => ({}) },
    tracking: { type: trackingSchema, default: () => ({}) },
    activeLeadSession: { type: leadSessionSchema, default: null },
    activeSessionRoute: { type: String, default: null },
    leadFormDraft: { type: leadDraftSchema, default: () => ({}) },
    leadFormStep: { type: Number, default: 0 },
    leads: { type: [leadSchema], default: [] },
    leadAdminOverrides: {
      type: Map,
      of: mongoose.Schema.Types.Mixed,
      default: () => ({}),
      select: false,
    },
    deletedLeadIds: { type: [String], default: [], select: false },
    followUps: { type: [followUpSchema], default: [] },
    dismissedFollowUpReminderIds: { type: [String], default: [] },
    activityLog: { type: [activitySchema], default: [] },
    notifications: { type: [notificationSchema], default: [] },
    lastSyncedAtMs: { type: Number, default: 0 },
    lastSyncedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('AppSnapshot', appSnapshotSchema);
