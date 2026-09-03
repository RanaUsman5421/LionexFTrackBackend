const mongoose = require('mongoose');

const activityRecordSchema = new mongoose.Schema(
  {
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', default: null, index: true },
    employeeId: { type: String, required: true, index: true, trim: true },
    entityId: { type: String, required: true, trim: true },
    data: { type: mongoose.Schema.Types.Mixed, default: {} },
    deletedAt: { type: Date, default: null, index: true },
  },
  { timestamps: true, minimize: false }
);

activityRecordSchema.index({ employeeId: 1, entityId: 1 }, { unique: true });
activityRecordSchema.index({ organizationId: 1, employeeId: 1, deletedAt: 1 });
activityRecordSchema.index({ organizationId: 1, deletedAt: 1, createdAt: -1 });

module.exports = mongoose.model('ActivityRecord', activityRecordSchema);
