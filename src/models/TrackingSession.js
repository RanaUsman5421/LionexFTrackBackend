const mongoose = require('mongoose');

const trackingSessionSchema = new mongoose.Schema(
  {
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', default: null, index: true },
    employeeId: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    startedAt: { type: Date, required: true },
    endedAt: { type: Date, default: null },
    lastHeartbeatAt: { type: Date, default: null },
    startLocation: {
      latitude: { type: Number, default: null },
      longitude: { type: Number, default: null },
    },
    endLocation: {
      latitude: { type: Number, default: null },
      longitude: { type: Number, default: null },
    },
    status: {
      type: String,
      enum: ['active', 'stopped'],
      default: 'active',
    },
    note: { type: String, default: '' },
  },
  { timestamps: true }
);

trackingSessionSchema.index({ employeeId: 1, startedAt: -1 });
trackingSessionSchema.index({ organizationId: 1, employeeId: 1, startedAt: -1 });

module.exports = mongoose.model('TrackingSession', trackingSessionSchema);
