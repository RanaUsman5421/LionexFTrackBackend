const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  organizationId: {type: mongoose.Schema.Types.ObjectId, required: true},
  employeeId: {type: String, required: true},
  operationId: {type: String, required: true},
  requestHash: {type:String,required:true},
  result: {type: mongoose.Schema.Types.Mixed, required: true},
}, {timestamps: true});
schema.index({organizationId: 1, employeeId: 1, operationId: 1}, {unique: true});
module.exports = mongoose.model('AppSyncReceipt', schema);
