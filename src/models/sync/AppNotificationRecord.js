const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  organizationId: {type: mongoose.Schema.Types.ObjectId, required: true},
  employeeId: {type: String, required: true},
  entityId: {type: String, required: true},
  revision: {type: Number, default: 0},
  data: {type: mongoose.Schema.Types.Mixed, default: {}},
  deletedAt: {type: Date, default: null},
}, {timestamps: true, minimize: false});
schema.index({employeeId: 1, entityId: 1}, {unique: true});
schema.index({organizationId: 1, employeeId: 1, deletedAt: 1, entityId: 1});
module.exports = mongoose.model('AppNotificationRecord', schema);
