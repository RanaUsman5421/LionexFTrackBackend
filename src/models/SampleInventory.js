const mongoose = require('mongoose');

const sampleInventorySchema = new mongoose.Schema({
  organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'PharmaProduct', required: true, index: true },
  employeeId: { type: String, default: '', trim: true, index: true },
  territory: { type: String, default: '', trim: true, maxlength: 120 },
  batchNumber: { type: String, required: true, trim: true, maxlength: 100 },
  expiryDate: { type: Date, required: true, index: true },
  quantityAvailable: { type: Number, required: true, min: 0, default: 0 },
  quantityIssued: { type: Number, min: 0, default: 0 },
  lastAdjustedBy: { type: String, default: '', trim: true },
}, { timestamps: true });

sampleInventorySchema.index({ organizationId: 1, productId: 1, employeeId: 1, batchNumber: 1 }, { unique: true });
sampleInventorySchema.index({ organizationId: 1, employeeId: 1, expiryDate: 1, quantityAvailable: 1 });

module.exports = mongoose.model('SampleInventory', sampleInventorySchema);
