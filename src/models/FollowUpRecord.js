const mongoose = require('mongoose');

const followUpRecordSchema = new mongoose.Schema(
  {
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', default: null, index: true },
    employeeId: { type: String, required: true, index: true, trim: true },
    entityId: { type: String, required: true, trim: true },
    leadId: { type: String, default: '', index: true, trim: true },
    data: { type: mongoose.Schema.Types.Mixed, default: {} },
    deletedAt: { type: Date, default: null, index: true },
  },
  { timestamps: true, minimize: false }
);

followUpRecordSchema.index({ employeeId: 1, entityId: 1 }, { unique: true });
followUpRecordSchema.index({ organizationId: 1, employeeId: 1, deletedAt: 1 });
followUpRecordSchema.index({ organizationId: 1, deletedAt: 1, createdAt: -1 });

module.exports = mongoose.model('FollowUpRecord', followUpRecordSchema);
