const mongoose = require('mongoose');

const organizationSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 160 },
    companyCode: { type: String, required: true, trim: true, uppercase: true, unique: true, index: true },
    category: {
      type: String,
      enum: ['pharmaceutical', 'electronics_sales', 'electronics_service', 'banking', 'general'],
      default: 'general',
      index: true,
    },
    logoUrl: { type: String, default: null },
    companySize: { type: String, default: '' },
    headOfficeCity: { type: String, default: '' },
    address: { type: String, default: '' },
    registrationNumber: { type: String, default: '' },
    website: { type: String, default: '' },
    enabledModules: { type: [String], default: ['visits', 'leads', 'meetings', 'activities'] },
    settings: {
      manualEmployeeApproval: { type: Boolean, default: true },
      trackingFrequencySeconds: { type: Number, default: 60, min: 15, max: 3600 },
      timezone: { type: String, default: 'Asia/Karachi' },
    },
    status: { type: String, enum: ['active', 'suspended'], default: 'active', index: true },
    ownerAdminId: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Organization', organizationSchema);
