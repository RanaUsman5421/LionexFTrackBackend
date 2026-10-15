const mongoose = require('mongoose');

const organizationSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 160 },
    companyCode: { type: String, required: true, trim: true, uppercase: true, unique: true, index: true },
    category: {
      type: String,
      enum: ['pharmaceutical', 'electronics_sales', 'electronics_service', 'banking', 'investor_program', 'retailer_distribution', 'general'],
      default: 'general',
      index: true,
    },
    whatsappDefaultProfileId: {type:mongoose.Schema.Types.ObjectId,ref:'WhatsAppProfile',default:null},
    logoUrl: { type: String, default: null },
    companySize: { type: String, default: '' },
    headOfficeCity: { type: String, default: '' },
    address: { type: String, default: '' },
    registrationNumber: { type: String, default: '' },
    website: { type: String, default: '' },
    enabledModules: { type: [String], default: ['visits', 'leads', 'meetings', 'activities'] },
    invoiceSettings: {
      client: {type:String,default:'Shifa for Health Care',maxlength:160},
      phone: {type:String,default:'',maxlength:40},
      email: {type:String,default:'',maxlength:160},
      taxId: {type:String,default:'',maxlength:80},
      tax: {type:Number,default:0,min:0,max:100},
      delivery: {type:Number,default:0,min:0,max:1000000},
      notes: {type:String,default:'',maxlength:2000},
      footer: {type:String,default:'Thank you for your business.',maxlength:500},
    },
    settings: {
      manualEmployeeApproval: { type: Boolean, default: true },
      trackingFrequencySeconds: { type: Number, default: 60, min: 15, max: 3600 },
      timezone: { type: String, default: 'Asia/Karachi' },
      pharmaVisitRadiusMeters: { type: Number, default: 250, min: 25, max: 5000 },
      pharmaSignatureRequired: { type: Boolean, default: false },
      pharmaAcknowledgementRequired: { type: Boolean, default: false },
      allowOfflinePharmaVisits: { type: Boolean, default: true },
      pharmaDeliverySlaMinutes: { type: Number, default: 40, min: 1, max: 1440 },
      pharmaFuelKmPerLiter: { type: Number, default: 60, min: 1, max: 300 },
      pharmaCustomerWhatsapp: { type: Boolean, default: true },
      pharmaRiderPush: { type: Boolean, default: true },
      pharmaAdminAlerts: { type: Boolean, default: true },
      pharmaAutoAssignOrders: { type: Boolean, default: false },
      pharmaMaxDropsPerRider: { type: Number, default: 5, min: 1, max: 100, validate: Number.isInteger },
      pharmaFuelPrice: { type: Number, default: 280, min: 0, max: 10000 },
    },
    status: { type: String, enum: ['active', 'suspended'], default: 'active', index: true },
    ownerAdminId: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Organization', organizationSchema);
