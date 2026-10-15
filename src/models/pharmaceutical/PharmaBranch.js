const mongoose = require('mongoose');
module.exports = mongoose.model('PharmaBranch', new mongoose.Schema({
  organizationId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  city: { type: String, default: '', trim: true, maxlength: 100 },
  area: { type: String, default: '', trim: true, maxlength: 100 },
  address: { type: String, default: '', maxlength: 500 },
  manager: { type: String, default: '', maxlength: 120 },
  phone: { type: String, default: '', maxlength: 24 },
  riderIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
}, { timestamps: true }));
