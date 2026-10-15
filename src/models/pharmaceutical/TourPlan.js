const mongoose = require('mongoose');

const tourPlanSchema = new mongoose.Schema({
  organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
  employeeId: { type: String, required: true, trim: true, index: true },
  doctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Doctor', required: true, index: true },
  plannedAt: { type: Date, required: true, index: true },
  territory: { type: String, default: '', trim: true, maxlength: 120 },
  purpose: { type: [String], default: [] },
  notes: { type: String, default: '', maxlength: 1000 },
  status: { type: String, enum: ['planned', 'completed', 'rescheduled', 'cancelled', 'missed'], default: 'planned', index: true },
  completedVisitId: { type: String, default: '', trim: true },
}, { timestamps: true });

tourPlanSchema.index({ organizationId: 1, employeeId: 1, plannedAt: 1 });
tourPlanSchema.index({ organizationId: 1, doctorId: 1, plannedAt: -1 });

module.exports = mongoose.model('TourPlan', tourPlanSchema);
