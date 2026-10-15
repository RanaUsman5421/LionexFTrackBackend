const mongoose = require('mongoose');

const whatsappOrderSchema = new mongoose.Schema(
  {
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    orderNumber: { type: String, required: true },
    customerName: { type: String, required: true, trim: true, maxlength: 120 },
    // Stored as country-code digits, for example 923001234567.
    customerPhone: { type: String, required: true, trim: true, maxlength: 15 },
    customerAddress: { type: String, required: true, trim: true, maxlength: 500 },
    product: { type: String, required: true, trim: true, maxlength: 250 },
    quantity: { type: Number, required: true, min: 1, max: 99999, validate: Number.isInteger },
    totalAmount: { type: Number, default: null, min: 0 },
    notes: { type: String, default: '', trim: true, maxlength: 500 },
    status: { type: String, enum: ['Booked', 'On the Way', 'Arrived', 'Delivered'], default: 'Booked', index: true },
    statusHistory: { type: [mongoose.Schema.Types.Mixed], default: [] },
    createdBy: { type: String, default: '' },
  },
  { timestamps: true }
);

whatsappOrderSchema.index({ organizationId: 1, orderNumber: 1 }, { unique: true });
whatsappOrderSchema.index({ organizationId: 1, createdAt: -1 });

module.exports = mongoose.model('WhatsAppOrder', whatsappOrderSchema);
