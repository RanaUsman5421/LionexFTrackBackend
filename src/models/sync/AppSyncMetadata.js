const mongoose = require('mongoose');

const appSyncMetadataSchema = new mongoose.Schema(
  {
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', default: null, index: true },
    employeeId: { type: String, required: true, unique: true, index: true, trim: true },
    epoch: { type: String, default: null },
    sequence: { type: Number, default: 0 },
    logFloor: { type: Number, default: 0 },
    mutationLock: { type: Number, default: 0 },
    version: { type: Number, default: 0 },
    lastLegacyUpdatedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('AppSyncMetadata', appSyncMetadataSchema);
