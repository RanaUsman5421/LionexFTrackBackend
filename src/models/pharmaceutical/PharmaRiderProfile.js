const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  organizationId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  vehicle: { type: String, default: '', maxlength: 120 },
  licenseNumber: { type: String, default: '', maxlength: 120 },
  licenseExpiry: { type: String, default: '' },
  homeAddress: { type: String, default: '', maxlength: 500 },
  emergencyName: { type: String, default: '', maxlength: 120 },
  emergencyPhone: { type: String, default: '', maxlength: 24 },
  cnicImageUrl: { type: String, default: '' },
  licenseImageUrl: { type: String, default: '' },
  plate: { type: String, default: '', maxlength: 40 },
}, { timestamps: true });
schema.index({ organizationId: 1, userId: 1 }, { unique: true });
module.exports = mongoose.model('PharmaRiderProfile', schema);
