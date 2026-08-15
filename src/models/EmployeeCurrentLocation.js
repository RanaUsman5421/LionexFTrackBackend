const mongoose = require('mongoose');

const employeeCurrentLocationSchema = new mongoose.Schema(
  {
    employeeId: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    location: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point',
      },
      coordinates: {
        type: [Number],
        required: true,
      },
    },
    accuracy: { type: Number, default: null },
    speed: { type: Number, default: null },
    heading: { type: Number, default: null },
    altitude: { type: Number, default: null },
    batteryPercentage: { type: Number, default: null },
    timestamp: { type: Date, required: true },
    trackingStatus: {
      type: String,
      enum: ['ACTIVE', 'STALE', 'OFFLINE', 'GPS_DISABLED', 'TRACKING_STOPPED'],
      default: 'ACTIVE',
    },
    sessionStatus: {
      type: String,
      enum: ['active', 'stopped'],
      default: 'active',
    },
  },
  { timestamps: true }
);

employeeCurrentLocationSchema.index({ location: '2dsphere' });

module.exports = mongoose.model('EmployeeCurrentLocation', employeeCurrentLocationSchema);
