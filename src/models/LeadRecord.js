const mongoose = require('mongoose');

const leadRecordSchema = new mongoose.Schema(
  {
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', default: null, index: true },
    employeeId: { type: String, required: true, index: true, trim: true },
    entityId: { type: String, required: true, trim: true },
    data: { type: mongoose.Schema.Types.Mixed, default: {} },
    deletedAt: { type: Date, default: null, index: true },
  },
  { timestamps: true, minimize: false }
);

leadRecordSchema.index({ employeeId: 1, entityId: 1 }, { unique: true });
leadRecordSchema.index({ organizationId: 1, employeeId: 1, deletedAt: 1 });

module.exports = mongoose.model('LeadRecord', leadRecordSchema);
