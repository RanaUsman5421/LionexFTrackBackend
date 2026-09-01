const mongoose = require('mongoose');

const verificationChallengeSchema = new mongoose.Schema(
  {
    employeeId: { type: String, required: true, trim: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', required: true },
    scheduledAt: { type: Date, required: true, index: true },
    notifyAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true, index: true },
    nonce: { type: String, required: true, select: false },
    authenticator: { type: String, enum: ['strong_biometric'], default: 'strong_biometric' },
    status: {
      type: String,
      enum: ['scheduled', 'pending', 'missed', 'verified', 'cancelled'],
      default: 'scheduled',
      index: true,
    },
    attempts: { type: Number, default: 0, min: 0 },
    notifiedAt: { type: Date, default: null },
    openedAt: { type: Date, default: null },
    missedAt: { type: Date, default: null },
    verifiedAt: { type: Date, default: null },
    verifiedLate: { type: Boolean, default: false },
    cancelledAt: { type: Date, default: null },
    cancelReason: { type: String, default: '', maxlength: 500 },
    deviceId: { type: String, default: '' },
  },
  { timestamps: true }
);

verificationChallengeSchema.index({ employeeId: 1, status: 1, scheduledAt: -1 });

module.exports = mongoose.model('VerificationChallenge', verificationChallengeSchema);
