const mongoose = require('mongoose');

const pharmaProductSchema = new mongoose.Schema({
  organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
  productCode: { type: String, required: true, trim: true, maxlength: 80 },
  productName: { type: String, required: true, trim: true, maxlength: 160 },
  brandName: { type: String, required: true, trim: true, maxlength: 160 },
  genericName: { type: String, required: true, trim: true, maxlength: 160 },
  category: { type: String, default: '', trim: true, maxlength: 120 },
  strength: { type: String, default: '', trim: true, maxlength: 80 },
  dosageForm: { type: String, default: '', trim: true, maxlength: 80 },
  focusProduct: { type: Boolean, default: false },
  status: { type: String, enum: ['active', 'inactive'], default: 'active', index: true },
}, { timestamps: true });

pharmaProductSchema.index({ organizationId: 1, productCode: 1 }, { unique: true });
pharmaProductSchema.index({ organizationId: 1, productName: 1, brandName: 1 });

module.exports = mongoose.model('PharmaProduct', pharmaProductSchema);
