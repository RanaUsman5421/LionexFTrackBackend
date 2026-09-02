const mongoose = require('mongoose');

const invitationSchema = new mongoose.Schema(
  {
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    type: { type: String, enum: ['employee', 'admin'], required: true, index: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    tokenHash: { type: String, required: true, unique: true, select: false },
    status: { type: String, enum: ['pending', 'used', 'revoked', 'expired'], default: 'pending', index: true },
    expiresAt: { type: Date, required: true, index: true },
    usedAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
    createdByAdminId: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', required: true },
    lastSentAt: { type: Date, default: Date.now },
    sendCount: { type: Number, default: 1, min: 1 },
    employee: {
      fullName: { type: String, default: '' },
      employeeId: { type: String, default: '' },
      phone: { type: String, default: '' },
      city: { type: String, default: '' },
      area: { type: String, default: '' },
      role: { type: String, default: '' },
      department: { type: String, default: '' },
      joiningDate: { type: String, default: '' },
    },
    adminRole: {
      type: String,
      enum: ['owner', 'super_admin', 'hr_admin', 'operations_admin', 'regional_manager', 'area_manager', 'report_viewer'],
      default: 'report_viewer',
    },
  },
  { timestamps: true }
);

invitationSchema.index({ organizationId: 1, email: 1, type: 1, status: 1 });
invitationSchema.index({ organizationId: 1, createdAt: -1 });

module.exports = mongoose.model('Invitation', invitationSchema);
