const mongoose = require('mongoose');
const retailProductSchema = new mongoose.Schema({
  organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
  productName: { type: String, required: true, trim: true, maxlength: 160 }, brand: { type: String, default: '', trim: true },
  sku: { type: String, required: true, trim: true, maxlength: 80 }, model: { type: String, default: '' }, variant: { type: String, default: '' }, colour: { type: String, default: '' },
  category: { type: String, required: true, trim: true }, compatibility: { type: String, default: '' }, warranty: { type: String, default: '' },
  wholesalePrice: { type: Number, required: true, min: 0 }, retailPrice: { type: Number, default: 0, min: 0 }, availableStock: { type: Number, default: 0, min: 0 },
  scheme: { type: String, default: '' }, discountPercent: { type: Number, default: 0, min: 0, max: 100 }, taxPercent: { type: Number, default: 0, min: 0, max: 100 }, active: { type: Boolean, default: true, index: true },
}, { timestamps: true });
retailProductSchema.index({ organizationId: 1, sku: 1 }, { unique: true });
module.exports = mongoose.model('RetailProduct', retailProductSchema);
