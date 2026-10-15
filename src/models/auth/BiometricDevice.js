const mongoose = require('mongoose');

const biometricDeviceSchema = new mongoose.Schema(
  {
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', default: null, index: true },
    employeeId: { type: String, required: true, trim: true, unique: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    deviceId: { type: String, required: true, trim: true },
    publicKey: { type: String, required: true },
    algorithm: { type: String, enum: ['EC_P256_SHA256'], default: 'EC_P256_SHA256' },
    registeredAt: { type: Date, default: Date.now },
    lastVerifiedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('BiometricDevice', biometricDeviceSchema);
