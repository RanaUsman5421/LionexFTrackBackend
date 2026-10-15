const mongoose = require('mongoose');

const appSyncStateSchema = new mongoose.Schema(
  {
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', default: null, index: true },
    employeeId: { type: String, required: true, unique: true, index: true, trim: true },
    revision: { type: Number, default: 0 },
    data: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true, minimize: false }
);

module.exports = mongoose.model('AppSyncState', appSyncStateSchema);
