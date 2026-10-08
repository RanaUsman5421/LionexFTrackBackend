const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema({
  productId: { type: String, default: '', trim: true, maxlength: 80 },
  productName: { type: String, required: true, trim: true, maxlength: 200 },
  sku: { type: String, default: '', trim: true, maxlength: 80 },
  quantity: { type: Number, required: true, min: 1, max: 99999, validate: Number.isInteger },
  unitPrice: { type: Number, default: null, min: 0 },
}, { _id: false });

const assignedToSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  employeeId: { type: String, default: '', trim: true },
  username: { type: String, default: '', trim: true },
  fullName: { type: String, default: '', trim: true },
}, { _id: false });

const historySchema = new mongoose.Schema({
  status: { type: String, required: true },
  changedAt: { type: Date, default: Date.now },
  changedByUserId: { type: mongoose.Schema.Types.ObjectId, default: null },
  changedByEmployeeId: { type: String, default: '' },
  changedByName: { type: String, default: '' },
  notifications: { type: mongoose.Schema.Types.Mixed, default: null },
}, { _id: false });

const pharmaOrderSchema = new mongoose.Schema({
  organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
  orderNumber: { type: String, required: true, trim: true },
  customerName: { type: String, required: true, trim: true, maxlength: 120 },
  customerPhone: { type: String, required: true, trim: true, maxlength: 15 },
  customerAddress: { type: String, required: true, trim: true, maxlength: 500 },
  items: { type: [orderItemSchema], required: true, validate: (items) => items.length > 0 },
  totalAmount: { type: Number, default: null, min: 0 },
  notes: { type: String, default: '', trim: true, maxlength: 1000 },
  status: { type: String, enum: ['Booked', 'Order Picked', 'On the Way', 'Arrived', 'Delivered', 'Cancelled'], default: 'Booked', index: true },
  assignedTo: { type: assignedToSchema, default: () => ({}) },
  takenAt: { type: Date, default: null },
  trackingExpiresAt: { type: Date, default: null, index: true },
  statusHistory: { type: [historySchema], default: [] },
  createdByUserId: { type: mongoose.Schema.Types.ObjectId, default: null },
  createdByName: { type: String, default: '' },
}, { timestamps: true });

pharmaOrderSchema.index({ organizationId: 1, orderNumber: 1 }, { unique: true });
pharmaOrderSchema.index({ organizationId: 1, createdAt: -1, _id: -1 });
pharmaOrderSchema.index({ organizationId: 1, 'assignedTo.userId': 1, createdAt: -1 });
pharmaOrderSchema.index({ organizationId: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model('PharmaOrder', pharmaOrderSchema);
