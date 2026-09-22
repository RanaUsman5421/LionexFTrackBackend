const mongoose = require('mongoose');

const sampleInventoryLedgerSchema = new mongoose.Schema({
  organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
  inventoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'SampleInventory', required: true, index: true },
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'PharmaProduct', required: true, index: true },
  employeeId: { type: String, default: '', trim: true, index: true },
  visitId: { type: String, default: '', trim: true, index: true },
  batchNumber: { type: String, required: true, trim: true },
  transactionType: { type: String, enum: ['adjustment', 'distribution', 'rollback'], required: true },
  quantityChange: { type: Number, required: true },
  balanceAfter: { type: Number, required: true, min: 0 },
  createdBy: { type: String, default: '', trim: true },
}, { timestamps: true });

sampleInventoryLedgerSchema.index({ organizationId: 1, createdAt: -1 });
sampleInventoryLedgerSchema.index({ organizationId: 1, visitId: 1, inventoryId: 1 }, { unique: true, partialFilterExpression: { visitId: { $type: 'string', $gt: '' } } });

module.exports = mongoose.model('SampleInventoryLedger', sampleInventoryLedgerSchema);
