const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const adminSchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
      required: true,
      trim: true,
    },
    employeeId: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },
    username: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },
    email: {
      type: String,
      required: true,
      trim: true,
      unique: true,
      lowercase: true,
    },
    password: {
      type: String,
      required: true,
      minlength: 6,
    },
    role: {
      type: String,
      default: 'admin',
    },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      default: null,
      index: true,
    },
    adminRole: {
      type: String,
      enum: ['owner', 'super_admin', 'hr_admin', 'operations_admin', 'regional_manager', 'area_manager', 'report_viewer'],
      default: 'owner',
      index: true,
    },
    accountStatus: {
      type: String,
      enum: ['active', 'suspended'],
      default: 'active',
      index: true,
    },
    invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', default: null },
    authVersion: { type: Number, default: 0, min: 0 },
  },
  {
    timestamps: true,
    collection: 'admins',
  }
);

adminSchema.index({ organizationId: 1, adminRole: 1, accountStatus: 1 });

adminSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('Admin', adminSchema);
