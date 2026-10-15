const mongoose = require('mongoose');

const adminSignupChallengeSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, trim: true, lowercase: true, unique: true, index: true },
    otpHash: { type: String, required: true, select: false },
    attempts: { type: Number, default: 0, min: 0 },
    resendAvailableAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
    claimedAt: { type: Date, default: null },
    requestIpHash: { type: String, required: true, index: true, select: false },
    registration: {
      fullName: { type: String, required: true },
      username: { type: String, required: true },
      passwordHash: { type: String, required: true, select: false },
      companyName: { type: String, required: true },
      category: { type: String, required: true },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('AdminSignupChallenge', adminSignupChallengeSchema);
