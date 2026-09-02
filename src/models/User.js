const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(
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
    phone: {
      type: String,
      default: '',
    },
    password: {
      type: String,
      required: true,
      minlength: 6,
    },
    city: {
      type: String,
      default: '',
    },
    area: {
      type: String,
      default: '',
    },
    role: {
      type: String,
      default: '',
    },
    department: {
      type: String,
      default: '',
    },
    joiningDate: {
      type: String,
      default: '',
    },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      default: null,
      index: true,
    },
    profilePhotoUrl: {
      type: String,
      default: null,
    },
    cnic: {
      type: String,
      trim: true,
      default: '',
      maxlength: 32,
    },
    cvUrl: {
      type: String,
      default: null,
    },
    selfieUrl: {
      type: String,
      default: null,
    },
    authVersion: {
      type: Number,
      default: 0,
      min: 0,
    },
    approvalStatus: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      index: true,
    },
    accountStatus: {
      type: String,
      enum: ['active', 'inactive', 'blocked'],
      index: true,
    },
    approvedAt: {
      type: Date,
      default: null,
    },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
      default: null,
    },
    rejectedAt: {
      type: Date,
      default: null,
    },
    rejectionReason: {
      type: String,
      default: '',
      maxlength: 500,
    },
    invitationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Invitation', default: null },
    invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', default: null },
  },
  {
    timestamps: true,
  }
);

userSchema.index({ organizationId: 1, approvalStatus: 1, accountStatus: 1, createdAt: -1 });
userSchema.index({ organizationId: 1, employeeId: 1 });
userSchema.index({ fullName: 'text', employeeId: 'text', email: 'text', username: 'text' });

userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('User', userSchema);
