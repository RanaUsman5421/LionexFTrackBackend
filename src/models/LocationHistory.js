const mongoose = require('mongoose');

const locationHistorySchema = new mongoose.Schema(
  {
    employeeId: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    clientLocationId: {
      type: String,
      required: true,
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
    timestamp: { type: Date, required: true, index: true },
    batteryPercentage: { type: Number, default: null },
    networkType: { type: String, default: '' },
  },
  { timestamps: true }
);

locationHistorySchema.index({ employeeId: 1, clientLocationId: 1 }, { unique: true });
locationHistorySchema.index({ location: '2dsphere' });
locationHistorySchema.index({ employeeId: 1, timestamp: -1 });

module.exports = mongoose.model('LocationHistory', locationHistorySchema);
