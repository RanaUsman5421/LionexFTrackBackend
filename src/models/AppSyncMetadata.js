const mongoose = require('mongoose');

const appSyncMetadataSchema = new mongoose.Schema(
  {
    employeeId: { type: String, required: true, unique: true, index: true, trim: true },
    version: { type: Number, default: 0 },
    lastLegacyUpdatedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('AppSyncMetadata', appSyncMetadataSchema);
