const crypto = require('crypto');
const express = require('express');
const mongoose = require('mongoose');
const { protect } = require('../middleware/authMiddleware');
const { hasPermission } = require('../utils/adminPermissions');
const WhatsAppOrder = require('../models/WhatsAppOrder');
const WhatsAppOrderSettings = require('../models/WhatsAppOrderSettings');
const whatsappRouter = require('../whatsapp/whatsapp');

const router = express.Router();
const STATUSES = ['Booked', 'On the Way', 'Arrived', 'Delivered'];
const PROFILE_ID = 'ftrack-dashboard';
router.use(protect);

const canManageOrders = (req) => req.principalType === 'admin' && (
  hasPermission(req.user, 'organization.manage') || hasPermission(req.user, 'employees.manage')
);

const requireOrderManager = (req, res) => {
  if (canManageOrders(req)) return true;
  res.status(403).json({ success: false, message: 'Order management permission required.' });
  return false;
};

const normalizePhone = (value) => {
  const digits = String(value || '').replace(/\D/g, '');
  if (/^03\d{9}$/.test(digits)) return `92${digits.slice(1)}`;
  if (/^3\d{9}$/.test(digits)) return `92${digits}`;
  if (/^92\d{10}$/.test(digits)) return digits;
  if (/^0\d{8,14}$/.test(digits)) return digits.slice(1);
  return digits;
};

const publicSettings = (settings) => ({
  adminPhone: settings?.adminPhone || '',
  brandName: settings?.brandName || '',
  updatedAt: settings?.updatedAt || null,
});

const sendNotification = async (phone, text) => {
  try {
    const result = await whatsappRouter.sendWhatsAppText(PROFILE_ID, phone, text);
    return { sent: true, messageId: result.messageId, to: result.to };
  } catch (error) {
    return { sent: false, error: error.message || 'WhatsApp message could not be sent.' };
  }
};

const getBrand = (name) => `*${String(name || '').trim()}*`;
const orderReference = () => `WA-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;

router.get('/api/wa/orders/settings', async (req, res) => {
  if (!requireOrderManager(req, res)) return;
  const settings = await WhatsAppOrderSettings.findOne({ organizationId: req.organizationId }).lean();
  res.json({ success: true, settings: publicSettings(settings) });
});

router.put('/api/wa/orders/settings', async (req, res) => {
  if (!requireOrderManager(req, res)) return;
  const brandName = String(req.body?.brandName || '').trim();
  const adminPhone = normalizePhone(req.body?.adminPhone);
  if (!brandName || brandName.length > 100) {
    return res.status(400).json({ success: false, message: 'Brand name is required and must be at most 100 characters.' });
  }
  if (!/^\d{8,15}$/.test(adminPhone)) {
    return res.status(400).json({ success: false, message: 'Enter a valid admin phone number with country code, or a Pakistan mobile number starting with 03.' });
  }

  const settings = await WhatsAppOrderSettings.findOneAndUpdate(
    { organizationId: req.organizationId },
    { $set: { brandName, adminPhone, updatedBy: String(req.user._id) } },
    { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
  ).lean();
  return res.json({ success: true, settings: publicSettings(settings), message: 'WhatsApp order settings saved.' });
});

router.get('/api/wa/orders', async (req, res) => {
  if (!requireOrderManager(req, res)) return;
  const orders = await WhatsAppOrder.find({ organizationId: req.organizationId })
    .sort({ createdAt: -1 })
    .limit(300)
    .lean();
  return res.json({ success: true, orders });
});

router.post('/api/wa/orders', async (req, res) => {
  if (!requireOrderManager(req, res)) return;
  const body = req.body || {};
  const customerName = String(body.customerName || '').trim();
  const customerPhone = normalizePhone(body.customerPhone);
  const customerAddress = String(body.customerAddress || '').trim();
  const product = String(body.product || '').trim();
  const quantity = Number(body.quantity);
  const notes = String(body.notes || '').trim();
  const totalAmount = body.totalAmount === '' || body.totalAmount == null ? null : Number(body.totalAmount);

  if (!customerName || customerName.length > 120 || !customerAddress || customerAddress.length > 500 || !product || product.length > 250) {
    return res.status(400).json({ success: false, message: 'Customer name, address, and product are required and must fit the form limits.' });
  }
  if (!/^\d{8,15}$/.test(customerPhone)) {
    return res.status(400).json({ success: false, message: 'Enter a valid customer phone number with country code, or a Pakistan mobile number starting with 03.' });
  }
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99999) {
    return res.status(400).json({ success: false, message: 'Quantity must be a whole number from 1 to 99999.' });
  }
  if (totalAmount !== null && (!Number.isFinite(totalAmount) || totalAmount < 0)) {
    return res.status(400).json({ success: false, message: 'Total amount must be zero or more.' });
  }
  if (notes.length > 500) return res.status(400).json({ success: false, message: 'Notes must be at most 500 characters.' });

  const settings = await WhatsAppOrderSettings.findOne({ organizationId: req.organizationId }).lean();
  if (!settings?.brandName) {
    return res.status(400).json({ success: false, message: 'Save your brand name in WhatsApp order settings before placing an order.' });
  }

  const order = await WhatsAppOrder.create({
    organizationId: req.organizationId,
    orderNumber: orderReference(),
    customerName,
    customerPhone,
    customerAddress,
    product,
    quantity,
    totalAmount,
    notes,
    status: 'Booked',
    createdBy: String(req.user.fullName || req.user.username || req.user.email || ''),
    statusHistory: [{ status: 'Booked', changedAt: new Date(), changedBy: String(req.user.fullName || req.user.username || ''), customerNotificationSent: false }],
  });

  const message = [
    getBrand(settings.brandName),
    '',
    `Hello ${customerName}, your order has been booked and will reach you in a short while.`,
    '',
    `Order: ${order.orderNumber}`,
    `Product: ${product}`,
    `Quantity: ${quantity}`,
    totalAmount === null ? '' : `Total amount: PKR ${totalAmount}`,
    `Delivery address: ${customerAddress}`,
    notes ? `Note: ${notes}` : '',
    'Status: Booked',
  ].filter(Boolean).join('\n');
  const notification = await sendNotification(customerPhone, message);
  order.statusHistory[0].customerNotificationSent = notification.sent;
  order.statusHistory[0].customerNotificationError = notification.sent ? '' : notification.error;
  await order.save();

  return res.status(201).json({
    success: true,
    order: order.toObject(),
    notification,
    message: notification.sent ? 'Order saved and booking notification sent.' : 'Order saved, but WhatsApp notification could not be sent.',
  });
});

router.patch('/api/wa/orders/:orderId/status', async (req, res) => {
  if (!requireOrderManager(req, res)) return;
  const { orderId } = req.params;
  const status = String(req.body?.status || '').trim();
  if (!mongoose.isValidObjectId(orderId)) return res.status(400).json({ success: false, message: 'Invalid order ID.' });
  if (!STATUSES.includes(status)) return res.status(400).json({ success: false, message: 'Choose a valid order status.' });

  const order = await WhatsAppOrder.findOne({ _id: orderId, organizationId: req.organizationId });
  if (!order) return res.status(404).json({ success: false, message: 'Order not found.' });
  if (order.status === status) return res.status(400).json({ success: false, message: 'This order already has that status.' });

  const settings = await WhatsAppOrderSettings.findOne({ organizationId: req.organizationId }).lean();
  if (!settings?.brandName || !/^\d{8,15}$/.test(String(settings.adminPhone || ''))) {
    return res.status(400).json({ success: false, message: 'Save a valid brand name and admin phone in WhatsApp order settings before updating status.' });
  }

  order.status = status;
  order.statusHistory.push({ status, changedAt: new Date(), changedBy: String(req.user.fullName || req.user.username || ''), customerNotificationSent: false, adminNotificationSent: false });
  await order.save();

  const brand = getBrand(settings.brandName);
  const customerMessage = [brand, '', `Hello ${order.customerName}, your order status has been updated.`, '', `Order: ${order.orderNumber}`, `Product: ${order.product}`, `Quantity: ${order.quantity}`, `Status: ${status}`].join('\n');
  const adminMessage = [brand, '', 'Order status update', '', `Order: ${order.orderNumber}`, `Customer: ${order.customerName}`, `Customer phone: +${order.customerPhone}`, `Product: ${order.product}`, `Quantity: ${order.quantity}`, `Status: ${status}`].join('\n');
  const [customer, admin] = await Promise.all([
    sendNotification(order.customerPhone, customerMessage),
    sendNotification(settings.adminPhone, adminMessage),
  ]);
  const latestChange = order.statusHistory[order.statusHistory.length - 1];
  latestChange.customerNotificationSent = customer.sent;
  latestChange.customerNotificationError = customer.sent ? '' : customer.error;
  latestChange.adminNotificationSent = admin.sent;
  latestChange.adminNotificationError = admin.sent ? '' : admin.error;
  await order.save();

  return res.json({
    success: true,
    order: order.toObject(),
    notifications: { customer, admin },
    message: customer.sent && admin.sent
      ? 'Order status updated and both notifications sent.'
      : 'Order status updated; one or more WhatsApp notifications could not be sent.',
  });
});

module.exports = router;
