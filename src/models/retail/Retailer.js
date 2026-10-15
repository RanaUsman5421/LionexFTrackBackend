const mongoose = require('mongoose');

const retailerSchema = new mongoose.Schema({
  organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
  retailerCode: { type: String, required: true, trim: true, maxlength: 40 },
  shopName: { type: String, required: true, trim: true, maxlength: 160 },
  ownerName: { type: String, required: true, trim: true, maxlength: 120 },
  ownerCnic: { type: String, default: '', trim: true, maxlength: 32 },
  mobileNumber: { type: String, required: true, trim: true, maxlength: 32 },
  whatsappNumber: { type: String, default: '', trim: true, maxlength: 32 },
  email: { type: String, default: '', trim: true, lowercase: true, maxlength: 160 },
  shopCategory: { type: String, required: true, trim: true, maxlength: 80 },
  retailerType: { type: String, required: true, trim: true, maxlength: 60 },
  retailerClass: { type: String, default: 'New/Unclassified', trim: true, maxlength: 60 },
  marketName: { type: String, default: '', trim: true, maxlength: 120 },
  address: { type: String, required: true, trim: true, maxlength: 500 },
  city: { type: String, required: true, trim: true, maxlength: 80 },
  territory: { type: String, required: true, trim: true, maxlength: 120 },
  location: { latitude: { type: Number }, longitude: { type: Number }, accuracy: { type: Number, default: 0 } },
  businessStartYear: { type: String, default: '' }, ntn: { type: String, default: '' },
  mainProductCategories: { type: [String], default: [] }, currentSuppliers: { type: String, default: '' }, preferredBrands: { type: String, default: '' },
  paymentPreference: { type: String, default: '' }, creditLimit: { type: Number, default: 0, min: 0 }, outstandingBalance: { type: Number, default: 0, min: 0 },
  orderFrequency: { type: String, default: '' }, expectedOrderValue: { type: Number, default: 0, min: 0 },
  accountTitle: { type: String, default: '' }, bankName: { type: String, default: '' }, iban: { type: String, default: '' }, mobileWalletNumber: { type: String, default: '' },
  shopExteriorPhotoUrl: { type: String, default: '' }, visitingCardPhotoUrl: { type: String, default: '' },
  onboardingStatus: { type: String, enum: ['Draft', 'Submitted', 'Pending Approval', 'Approved', 'Rejected', 'More Information Required'], default: 'Submitted', index: true },
  active: { type: Boolean, default: true, index: true }, createdByEmployeeId: { type: String, default: '', index: true },
}, { timestamps: true });

retailerSchema.index({ organizationId: 1, retailerCode: 1 }, { unique: true });
retailerSchema.index({ organizationId: 1, shopName: 1 });
module.exports = mongoose.model('Retailer', retailerSchema);
