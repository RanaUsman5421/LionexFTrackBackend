const mongoose = require('mongoose');

const leadRecordSchema = new mongoose.Schema(
  {
    employeeId: { type: String, required: true, index: true, trim: true },
    entityId: { type: String, required: true, trim: true },
    data: { type: mongoose.Schema.Types.Mixed, default: {} },
    deletedAt: { type: Date, default: null, index: true },
  },
  { timestamps: true, minimize: false }
);

leadRecordSchema.index({ employeeId: 1, entityId: 1 }, { unique: true });

module.exports = mongoose.model('LeadRecord', leadRecordSchema);
