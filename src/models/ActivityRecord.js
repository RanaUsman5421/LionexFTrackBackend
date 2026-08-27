const mongoose = require('mongoose');

const activityRecordSchema = new mongoose.Schema(
  {
    employeeId: { type: String, required: true, index: true, trim: true },
    entityId: { type: String, required: true, trim: true },
    data: { type: mongoose.Schema.Types.Mixed, default: {} },
    deletedAt: { type: Date, default: null, index: true },
  },
  { timestamps: true, minimize: false }
);

activityRecordSchema.index({ employeeId: 1, entityId: 1 }, { unique: true });

module.exports = mongoose.model('ActivityRecord', activityRecordSchema);
