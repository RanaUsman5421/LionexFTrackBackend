const mongoose = require('mongoose');

const whatsappOrderSettingsSchema = new mongoose.Schema(
  {
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, unique: true, index: true },
    adminPhone: { type: String, default: '', trim: true, maxlength: 20 },
    brandName: { type: String, default: '', trim: true, maxlength: 100 },
    updatedBy: { type: String, default: '' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('WhatsAppOrderSettings', whatsappOrderSettingsSchema);
