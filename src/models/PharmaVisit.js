const mongoose = require('mongoose');

const pharmaVisitSchema = new mongoose.Schema({
  organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
  visitId: { type: String, required: true, trim: true, maxlength: 120 },
  schemaVersion: { type: Number, default: 1 },
  employeeId: { type: String, required: true, trim: true, index: true },
  doctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Doctor', required: true, index: true },
  tourPlanId: { type: mongoose.Schema.Types.ObjectId, ref: 'TourPlan', default: null },
  visitType: { type: String, enum: ['Planned', 'Unplanned'], required: true },
  visitCategory: { type: String, enum: ['Doctor', 'Clinic', 'Hospital'], required: true },
  visitPurposes: { type: [String], required: true },
  territory: { type: String, default: '', trim: true },
  doctorAvailable: { type: String, enum: ['Yes', 'No'], required: true },
  personMet: { type: String, default: '', trim: true },
  checkInAt: { type: Date, required: true, index: true },
  checkOutAt: { type: Date, required: true },
  checkIn: { type: mongoose.Schema.Types.Mixed, default: {} },
  checkOut: { type: mongoose.Schema.Types.Mixed, default: {} },
  visitDetails: { type: mongoose.Schema.Types.Mixed, default: {} },
  productDetails: { type: [mongoose.Schema.Types.Mixed], default: [] },
  samples: { type: [mongoose.Schema.Types.Mixed], default: [] },
  promotionalMaterials: { type: [mongoose.Schema.Types.Mixed], default: [] },
  competitorInformation: { type: mongoose.Schema.Types.Mixed, default: {} },
  outcome: { type: String, required: true, trim: true, index: true },
  doctorResponse: { type: String, default: '', trim: true },
  followUpRequired: { type: Boolean, required: true },
  followUp: { type: mongoose.Schema.Types.Mixed, default: {} },
  nextAction: { type: String, default: '', trim: true },
  overallRemarks: { type: String, required: true, maxlength: 4000 },
  evidence: { type: mongoose.Schema.Types.Mixed, default: {} },
  finalStatus: { type: String, required: true, trim: true, index: true },
  declarationAccepted: { type: Boolean, required: true },
  totalDurationSeconds: { type: Number, min: 0, default: 0 },
  distanceFromDoctorMeters: { type: Number, min: 0, default: 0 },
  distanceFromCheckInMeters: { type: Number, min: 0, default: 0 },
  insideAssignedRadius: { type: Boolean, default: false },
  submissionStatus: { type: String, enum: ['online', 'offline_synced'], default: 'online' },
  draft: { type: Boolean, default: false, index: true },
}, { timestamps: true, minimize: false });

pharmaVisitSchema.index({ organizationId: 1, visitId: 1 }, { unique: true });
pharmaVisitSchema.index({ organizationId: 1, employeeId: 1, checkInAt: -1 });
pharmaVisitSchema.index({ organizationId: 1, doctorId: 1, checkInAt: -1 });
pharmaVisitSchema.index({ organizationId: 1, finalStatus: 1, checkInAt: -1 });

module.exports = mongoose.model('PharmaVisit', pharmaVisitSchema);
