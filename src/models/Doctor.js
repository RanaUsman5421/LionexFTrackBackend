const mongoose = require('mongoose');

const doctorSchema = new mongoose.Schema({
  organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
  doctorId: { type: String, required: true, trim: true, maxlength: 80 },
  fullName: { type: String, required: true, trim: true, maxlength: 160 },
  gender: { type: String, enum: ['', 'Male', 'Female', 'Other'], default: '' },
  specialization: { type: String, required: true, trim: true, maxlength: 120 },
  qualification: { type: String, default: '', trim: true, maxlength: 160 },
  pmdcNumber: { type: String, default: '', trim: true, maxlength: 80 },
  category: { type: String, enum: ['A', 'B', 'C'], required: true },
  clinicHospitalName: { type: String, required: true, trim: true, maxlength: 200 },
  department: { type: String, default: '', trim: true, maxlength: 120 },
  mobileNumber: { type: String, default: '', trim: true, maxlength: 40 },
  email: { type: String, default: '', trim: true, lowercase: true, maxlength: 160 },
  address: { type: String, required: true, trim: true, maxlength: 500 },
  city: { type: String, required: true, trim: true, maxlength: 100 },
  area: { type: String, default: '', trim: true, maxlength: 120 },
  territory: { type: String, required: true, trim: true, maxlength: 120 },
  location: {
    latitude: { type: Number, min: -90, max: 90, default: 0 },
    longitude: { type: Number, min: -180, max: 180, default: 0 },
    accuracy: { type: Number, min: 0, default: 0 },
  },
  clinicExteriorPhotoUrl: { type: String, default: '', maxlength: 2048 },
  visitingDays: { type: [String], default: [] },
  visitingHours: { type: String, default: '', maxlength: 160 },
  potentialLevel: { type: String, enum: ['High', 'Medium', 'Low'], default: 'Medium', index: true },
  remarks: { type: String, default: '', maxlength: 2000 },
  lastVisitAt: { type: Date, default: null },
  lastVisitOutcome: { type: String, default: '', maxlength: 120 },
  nextFollowUpAt: { type: Date, default: null },
  status: { type: String, enum: ['active', 'inactive', 'pending_review'], default: 'active', index: true },
  createdByEmployeeId: { type: String, default: '', trim: true },
}, { timestamps: true });

doctorSchema.index({ organizationId: 1, doctorId: 1 }, { unique: true });
doctorSchema.index({ organizationId: 1, pmdcNumber: 1 }, { unique: true, partialFilterExpression: { pmdcNumber: { $type: 'string', $gt: '' } } });
doctorSchema.index({ organizationId: 1, fullName: 'text', clinicHospitalName: 'text', specialization: 'text', territory: 'text' });
doctorSchema.index({ organizationId: 1, territory: 1, status: 1, fullName: 1 });

module.exports = mongoose.model('Doctor', doctorSchema);
