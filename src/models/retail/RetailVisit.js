const mongoose = require('mongoose');
const retailVisitSchema = new mongoose.Schema({
  organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
  visitId: { type: String, required: true, trim: true }, employeeId: { type: String, required: true, trim: true, index: true },
  retailerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Retailer', default: null, index: true }, retailerSnapshot: { type: mongoose.Schema.Types.Mixed, default: {} },
  plannedVisit: { type: Boolean, default: false }, visitPurposes: { type: [String], default: [] }, personMet: { type: String, default: '' }, retailerAvailability: { type: String, required: true },
  checkInAt: { type: Date, required: true }, checkOutAt: { type: Date, required: true }, checkIn: { type: mongoose.Schema.Types.Mixed, default: {} }, checkOut: { type: mongoose.Schema.Types.Mixed, default: {} },
  distanceFromRetailerMeters: { type: Number, default: 0 }, deviceStatus: { type: String, default: '' }, internetStatus: { type: String, default: '' }, durationSeconds: { type: Number, default: 0 },
  stockChecks: { type: [mongoose.Schema.Types.Mixed], default: [] }, order: { type: mongoose.Schema.Types.Mixed, default: {} }, productDemand: { type: mongoose.Schema.Types.Mixed, default: {} }, competitor: { type: mongoose.Schema.Types.Mixed, default: {} },
  payment: { type: mongoose.Schema.Types.Mixed, default: {} }, returns: { type: [mongoose.Schema.Types.Mixed], default: [] }, display: { type: mongoose.Schema.Types.Mixed, default: {} },
  outcome: { type: String, required: true }, noOrderReason: { type: String, default: '' }, followUp: { type: mongoose.Schema.Types.Mixed, default: {} }, retailerResponse: { type: String, default: '' }, visitRating: { type: Number, default: 0, min: 0, max: 5 }, finalRemarks: { type: String, default: '' }, additionalDetails: { type: mongoose.Schema.Types.Mixed, default: {} },
  voiceNoteUrl: { type: String, default: '' }, shopPhotoUrl: { type: String, default: '' }, status: { type: String, enum: ['Planned', 'En Route', 'Checked In', 'In Progress', 'Completed', 'No Order', 'Follow-Up Required', 'Rescheduled', 'Shop Closed', 'Owner Unavailable', 'Cancelled'], default: 'Completed', index: true },
  draft: { type: Boolean, default: false, index: true },
}, { timestamps: true });
retailVisitSchema.index({ organizationId: 1, visitId: 1 }, { unique: true });
retailVisitSchema.index({ organizationId: 1, createdAt: -1 });
module.exports = mongoose.model('RetailVisit', retailVisitSchema);
