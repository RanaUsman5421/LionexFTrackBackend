const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  organizationId: {type: mongoose.Schema.Types.ObjectId, required: true},
  employeeId: {type: String, required: true},
  sequence: {type: Number, required: true},
  kind: {type: String, enum: ['state', 'lead', 'followUp', 'activity', 'notification'], required: true},
  entityId: {type: String, required: true},
  deleted: {type: Boolean, default: false},
  data: {type: mongoose.Schema.Types.Mixed, default: null},
}, {timestamps: true, minimize: false});
schema.index({organizationId: 1, employeeId: 1, sequence: 1}, {unique: true});
schema.index({organizationId:1,employeeId:1,createdAt:1,sequence:1});
// No TTL: history is removed only after advancing logFloor transactionally.
module.exports = mongoose.model('AppSyncChange', schema);
