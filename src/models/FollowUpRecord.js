const mongoose = require('mongoose');

const followUpRecordSchema = new mongoose.Schema(
  {
    employeeId: { type: String, required: true, index: true, trim: true },
    entityId: { type: String, required: true, trim: true },
    leadId: { type: String, default: '', index: true, trim: true },
    data: { type: mongoose.Schema.Types.Mixed, default: {} },
    deletedAt: { type: Date, default: null, index: true },
  },
  { timestamps: true, minimize: false }
);

followUpRecordSchema.index({ employeeId: 1, entityId: 1 }, { unique: true });

module.exports = mongoose.model('FollowUpRecord', followUpRecordSchema);
