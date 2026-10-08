const crypto = require('crypto');
const mongoose = require('mongoose');
const Organization = require('../models/Organization');
const PharmaOrder = require('../models/PharmaOrder');
const User = require('../models/User');
const EmployeeCurrentLocation = require('../models/EmployeeCurrentLocation');
const WhatsAppOrderSettings = require('../models/WhatsAppOrderSettings');
const whatsappRouter = require('../whatsapp/whatsapp');
const { hasPermission } = require('../utils/adminPermissions');
const { emitOrganizationEvent } = require('../services/appDataRealtimeService');
const { emitPharmaOrderSocketChange } = require('../services/socketService');

const ORDER_STATUSES = ['Booked', 'Order Picked', 'On the Way', 'Arrived', 'Delivered'];
const text = (value, max = 500) => String(value ?? '').trim().slice(0, max);
const oneLine = (value, max = 500) => text(value, max).replace(/\s+/g, ' ');
const normalizePhone = (value) => {
  const digits = String(value || '').replace(/\D/g, '');
  if (/^03\d{9}$/.test(digits)) return `92${digits.slice(1)}`;
  if (/^3\d{9}$/.test(digits)) return `92${digits}`;
  if (/^92\d{10}$/.test(digits)) return digits;
  if (/^0\d{8,14}$/.test(digits)) return digits.slice(1);
  return digits;
};
const orderCode = () => `PH-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
const actor = (req) => ({
  changedByUserId: req.user?._id || null,
  changedByEmployeeId: req.principalType === 'user' ? text(req.user?.employeeId, 100) : '',
  changedByName: text(req.user?.username || req.user?.fullName || req.user?.email, 120),
});
const isManager = (req) => req.principalType === 'admin' && hasPermission(req.user, 'employees.manage');

const ensurePharma = async (req, res) => {
  const organization = await Organization.findById(req.organizationId).select('category').lean();
  if (!organization) {
    res.status(404).json({ success: false, message: 'Organization not found.' });
    return false;
  }
  if (organization.category !== 'pharmaceutical') {
    res.status(403).json({ success: false, message: 'Pharma orders are only available to Pharmaceutical organizations.' });
    return false;
  }
  return true;
};

const listOrders = async (req, res) => {
  if (!await ensurePharma(req, res)) return;
  const query = { organizationId: req.organizationId };
  if (req.principalType === 'user') {
    if (req.query.scope === 'mine') query['assignedTo.userId'] = req.user._id;
    else if (req.query.scope && req.query.scope !== 'all') return res.status(400).json({ success: false, message: 'Scope must be all or mine.' });
  }
  if (req.query.status) {
    const statuses = String(req.query.status).split(',').map((value) => text(value, 40)).filter(Boolean);
    if (statuses.some((status) => !['Booked', ...ORDER_STATUSES.slice(1), 'Cancelled'].includes(status))) {
      return res.status(400).json({ success: false, message: 'Invalid order status filter.' });
    }
    query.status = statuses.length === 1 ? statuses[0] : { $in: statuses };
  }
  const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 30));
  const page = Math.min(10000, Math.max(1, Number.parseInt(req.query.page, 10) || 1));
  const orders = await PharmaOrder.find(query).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean();
  const total = await PharmaOrder.countDocuments(query);
  return res.json({ success: true, orders, pagination: { page, limit, total, hasMore: page * limit < total } });
};

const getOrder = async (req, res) => {
  if (!await ensurePharma(req, res)) return;
  if (!mongoose.isValidObjectId(req.params.orderId)) return res.status(400).json({ success: false, message: 'Invalid order ID.' });
  const order = await PharmaOrder.findOne({ _id: req.params.orderId, organizationId: req.organizationId }).lean();
  if (!order) return res.status(404).json({ success: false, message: 'Order not found.' });
  return res.json({ success: true, order });
};

const createOrder = async (req, res) => {
  if (!await ensurePharma(req, res)) return;
  if (!isManager(req)) return res.status(403).json({ success: false, message: 'Employee management permission required.' });

  const body = req.body || {};
  const customerName = text(body.customerName, 120);
  const customerPhone = normalizePhone(body.customerPhone);
  const customerCity = text(body.customerCity, 100);
  const customerAddress = text(body.customerAddress, 500);
  const notes = text(body.notes, 1000);
  const totalAmount = body.totalAmount === '' || body.totalAmount == null ? null : Number(body.totalAmount);
  const rawItems = Array.isArray(body.items) ? body.items.slice(0, 50) : [];
  const items = rawItems.map((item) => ({
    productId: text(item?.productId, 80),
    productName: text(item?.productName, 200),
    sku: text(item?.sku, 80),
    quantity: Number(item?.quantity),
    unitPrice: item?.unitPrice === '' || item?.unitPrice == null ? null : Number(item.unitPrice),
  }));

  if (!customerName || !customerCity || !customerAddress || !/^\d{8,15}$/.test(customerPhone) || totalAmount === null || !items.length || items.some((item) => !item.productName || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 99999 || (item.unitPrice !== null && (!Number.isFinite(item.unitPrice) || item.unitPrice < 0)))) {
    return res.status(400).json({ success: false, message: 'Enter customer name, valid phone, city, address, total amount, and at least one valid product with quantity.' });
  }
  if (totalAmount !== null && (!Number.isFinite(totalAmount) || totalAmount < 0)) {
    return res.status(400).json({ success: false, message: 'Total amount must be zero or more.' });
  }

  const createdByName = text(req.user?.fullName || req.user?.username || req.user?.email, 120);
  const bookedAt = new Date();
  const order = await PharmaOrder.create({
    organizationId: req.organizationId,
    orderNumber: orderCode(),
    customerName,
    customerPhone,
    customerCity,
    customerAddress,
    items,
    totalAmount,
    notes,
    createdByUserId: req.user._id,
    createdByName,
    statusHistory: [{
      status: 'Booked',
      changedAt: bookedAt,
      changedByUserId: req.user._id,
      changedByName: createdByName,
      notifications: { status: 'pending' },
    }],
  });
  emitOrganizationEvent(req.organizationId, 'pharma-order-changed', { orderId: String(order._id), action: 'created' });
  emitPharmaOrderSocketChange(req.organizationId, order._id, 'created');
  scheduleOrderNotification(order, 'Booked', bookedAt);
  return res.status(201).json({
    success: true,
    order,
    notifications: { status: 'pending' },
    message: 'Pharma order created. Booking WhatsApp notifications are being sent.',
  });
};

const claimOrder = async (req, res) => {
  if (!await ensurePharma(req, res)) return;
  if (req.principalType !== 'user' || !req.user?.employeeId) return res.status(403).json({ success: false, message: 'Only an active representative can take an order.' });
  if (!mongoose.isValidObjectId(req.params.orderId)) return res.status(400).json({ success: false, message: 'Invalid order ID.' });

  const name = text(req.user.fullName || req.user.username, 120);
  const username = text(req.user.username || req.user.fullName, 80);
  const now = new Date();
  const order = await PharmaOrder.findOneAndUpdate(
    { _id: req.params.orderId, organizationId: req.organizationId, status: 'Booked', 'assignedTo.userId': null },
    {
      $set: { assignedTo: { userId: req.user._id, employeeId: text(req.user.employeeId, 100), username, fullName: name }, takenAt: now },
      $push: { statusHistory: { status: 'Taken', changedAt: now, changedByUserId: req.user._id, changedByEmployeeId: text(req.user.employeeId, 100), changedByName: name } },
    },
    { new: true, runValidators: true }
  );
  if (!order) {
    const exists = await PharmaOrder.exists({ _id: req.params.orderId, organizationId: req.organizationId });
    return res.status(exists ? 409 : 404).json({ success: false, message: exists ? 'This order has already been taken or is no longer available.' : 'Order not found.' });
  }
  emitOrganizationEvent(req.organizationId, 'pharma-order-changed', { orderId: String(order._id), action: 'claimed' });
  emitPharmaOrderSocketChange(req.organizationId, order._id, 'claimed');
  return res.json({ success: true, order, message: 'Order taken successfully.' });
};

const amountText = (amount) => {
  const value = Number(amount);
  return amount == null || !Number.isFinite(value)
    ? 'Not provided'
    : value.toLocaleString('en-PK', { maximumFractionDigits: 2 });
};

const formatOrderStatusMessage = async (order, status, settings) => {
  const brandName = oneLine(settings?.brandName, 100) || 'Pharma';
  const customerName = oneLine(order.customerName, 120) || 'Customer';
  const orderNumber = oneLine(order.orderNumber, 80) || 'Not provided';
  const customerCity = oneLine(order.customerCity, 100) || 'Not provided';
  const deliveryAddress = oneLine(order.customerAddress, 500) || 'Not provided';
  const addressWithCity = `${deliveryAddress}, ${customerCity}`;
  let riderName = oneLine(order.assignedTo?.fullName || order.assignedTo?.username, 120) || 'Not assigned';
  let riderPhone = '';
  if (order.assignedTo?.userId) {
    const rider = await User.findById(order.assignedTo.userId).select('fullName phone').lean();
    riderName = oneLine(rider?.fullName || riderName, 120);
    riderPhone = oneLine(rider?.phone, 24);
  }
  const riderDetails = [
    `🛵 Rider: ${riderName}`,
    `📞 Rider Contact: ${riderPhone || 'Not provided'}`,
  ];
  const orderDetails = [
    `🔍 Order No: ${orderNumber}`,
    `👤 Customer: ${customerName}`,
  ];
  const footer = [`🏥 ${brandName}`, 'Care, delivered to your doorstep 💚'].join('\n');
  const payable = `Rs. ${amountText(order.totalAmount)}`;

  switch (status) {
    case 'Booked':
      return [
        '✅ Order Booked',
        'Thank you for your order! 💚',
        'Your parcel has been booked and will be delivered soon 📦',
        '',
        `🔍 Order No: ${orderNumber}`,
        `👤 Customer: ${customerName}`,
        `🏙️ City: ${customerCity}`,
        `📍 Address: ${deliveryAddress}`,
        `💸 Order Amount: ${payable}`,
        '',
        footer,
      ].join('\n');
    case 'Order Picked':
      return [
        '📦 Order Picked',
        'Your order has been picked for delivery. We’ll keep you updated 📦',
        '',
        ...orderDetails,
        ...riderDetails,
        `📍 Address: ${addressWithCity}`,
        '',
        footer,
      ].join('\n');
    case 'On the Way':
      return [
        '🛵 Rider On the Way',
        `Your ${brandName} order is on the way 📦`,
        '',
        'Expected delivery within 30–40 minutes ⏳',
        'We’ll notify you when your rider arrives 🔔',
        '',
        ...orderDetails,
        ...riderDetails,
        `📍 Address: ${addressWithCity}`,
        '',
        ...(order.trackingUrl ? [`🔗 Live Track`, order.trackingUrl] : []),
        '',
        footer,
      ].join('\n');
    case 'Arrived':
      return [
        '📍 Rider Arrived',
        'Your rider is waiting outside! 🛵',
        'Please collect your parcel at the entrance 📦',
        '',
        ...orderDetails,
        ...riderDetails,
        `💸 Amount Payable: ${payable}`,
        `📍 Address: ${addressWithCity}`,
        '',
        'Thank you for choosing us 💚',
        '',
        footer,
      ].join('\n');
    case 'Delivered': {
      const deliveryTime = new Date(order.statusChangedAt || Date.now()).toLocaleTimeString('en-PK', {
        timeZone: 'Asia/Karachi',
        hour: 'numeric',
        minute: '2-digit',
      });
      return [
        '📦 Parcel Delivered Successfully!',
        'Your parcel has been delivered successfully. Thank you for choosing us! 💚',
        '',
        `🔍 Order No: ${orderNumber}`,
        `👤 Customer: ${customerName}`,
        ...riderDetails,
        `💸 Amount Paid: ${payable}`,
        `📍 Delivered At: ${addressWithCity}`,
        `🕐 Delivery Time: ${deliveryTime}`,
        '',
        'Thank you for choosing us 💚',
        '',
        footer,
      ].join('\n');
    }
    default:
      return [
        `📦 Order Update: ${status}`,
        ...orderDetails,
        `📍 Address: ${addressWithCity}`,
        '',
        footer,
      ].join('\n');
  }
};

const sendStatusMessages = async (order, status, settings, previousResults = null) => {
  const message = await formatOrderStatusMessage(order, status, settings);
  const send = async (phone, previousResult) => {
    if (previousResult?.sent) return previousResult;
    if (!/^\d{8,15}$/.test(String(phone || ''))) return { sent: false, error: 'Phone number is not configured.' };
    try {
      const result = await whatsappRouter.sendWhatsAppText('ftrack-dashboard', phone, message);
      return { sent: true, messageId: result.messageId || null };
    } catch (error) {
      return { sent: false, error: error.message || 'WhatsApp message could not be sent.' };
    }
  };
  const [customer, admin] = await Promise.all([
    send(order.customerPhone, previousResults?.customer),
    send(settings?.adminPhone, previousResults?.admin),
  ]);
  return { customer, admin };
};

const scheduleOrderNotification = (order, status, changedAt, trackingUrl = '', previousResults = null) => {
  const orderSnapshot = {
    ...(typeof order.toObject === 'function' ? order.toObject() : order),
    statusChangedAt: changedAt,
    trackingUrl,
  };
  setImmediate(async () => {
    let notifications;
    try {
      const settings = await WhatsAppOrderSettings.findOne({ organizationId: order.organizationId }).lean();
      notifications = await sendStatusMessages(orderSnapshot, status, settings, previousResults);
    } catch (error) {
      const failure = error.message || 'WhatsApp notification could not be sent.';
      notifications = {
        customer: { sent: false, error: failure },
        admin: { sent: false, error: failure },
      };
      console.error(`Pharma order WhatsApp notification failed for ${order.orderNumber}:`, error);
    }
    try {
      await PharmaOrder.updateOne(
        { _id: order._id, organizationId: order.organizationId },
        { $set: { 'statusHistory.$[entry].notifications': notifications } },
        { arrayFilters: [{ 'entry.changedAt': changedAt, 'entry.status': status }] }
      );
    } catch (error) {
      console.error(`Could not save WhatsApp notification result for ${order.orderNumber}:`, error);
    }
  });
};

const retryOrderNotification = async (req, res) => {
  if (!await ensurePharma(req, res)) return;
  if (!isManager(req)) return res.status(403).json({ success: false, message: 'Employee management permission required.' });
  if (!mongoose.isValidObjectId(req.params.orderId)) return res.status(400).json({ success: false, message: 'Invalid order ID.' });

  const order = await PharmaOrder.findOne({ _id: req.params.orderId, organizationId: req.organizationId });
  if (!order) return res.status(404).json({ success: false, message: 'Order not found.' });
  if (!ORDER_STATUSES.includes(order.status)) return res.status(409).json({ success: false, message: 'This order status cannot be notified.' });

  const historyEntry = [...order.statusHistory].reverse().find((entry) => entry.status === order.status);
  if (!historyEntry) return res.status(409).json({ success: false, message: 'Order status history is missing.' });
  const previousResults = historyEntry.notifications;
  if (previousResults?.customer?.sent && previousResults?.admin?.sent) {
    return res.status(409).json({ success: false, message: 'Both WhatsApp notifications were already sent.' });
  }

  const changedAt = historyEntry.changedAt;
  await PharmaOrder.updateOne(
    { _id: order._id, organizationId: req.organizationId },
    { $set: { 'statusHistory.$[entry].notifications': { status: 'pending' } } },
    { arrayFilters: [{ 'entry.changedAt': changedAt, 'entry.status': order.status }] }
  );
  scheduleOrderNotification(order, order.status, changedAt, buildTrackingUrl(order, order.trackingExpiresAt), previousResults);
  return res.status(202).json({ success: true, notifications: { status: 'pending' }, message: 'WhatsApp notification retry started.' });
};

const trackingSignature = (orderId, expiresAtMs) => crypto
  .createHmac('sha256', process.env.SECRET_JWT_KEY)
  .update(`${orderId}.${expiresAtMs}`)
  .digest('base64url');

const buildTrackingUrl = (order, expiresAt) => {
  const baseUrl = String(process.env.PUBLIC_TRACKING_BASE_URL || process.env.CLIENT_URL || '').trim().replace(/\/+$/, '');
  if (!baseUrl || !expiresAt || !process.env.SECRET_JWT_KEY) return '';
  const expiresAtMs = new Date(expiresAt).getTime();
  const signature = trackingSignature(String(order._id), expiresAtMs);
  const token = Buffer.from(`${order._id}.${expiresAtMs}.${signature}`).toString('base64url');
  return `${baseUrl}/?track=${encodeURIComponent(token)}`;
};

const publicTracking = async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    const token = Buffer.from(String(req.params.token || ''), 'base64url').toString('utf8');
    const [orderId, expiresValue, suppliedSignature] = token.split('.');
    const expiresAtMs = Number(expiresValue);
    if (!mongoose.isValidObjectId(orderId) || !Number.isSafeInteger(expiresAtMs) || !suppliedSignature) {
      return res.status(404).json({ success: false, message: 'Tracking link is invalid or expired.' });
    }
    if (!process.env.SECRET_JWT_KEY) return res.status(404).json({ success: false, message: 'Tracking link is invalid or expired.' });
    const expected = Buffer.from(trackingSignature(orderId, expiresAtMs));
    const supplied = Buffer.from(suppliedSignature);
    if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied) || expiresAtMs <= Date.now()) {
      return res.status(404).json({ success: false, message: 'Tracking link is invalid or expired.' });
    }
    const order = await PharmaOrder.findOne({
      _id: orderId,
      trackingExpiresAt: new Date(expiresAtMs),
      status: { $in: ['On the Way', 'Arrived'] },
      'assignedTo.employeeId': { $ne: '' },
    }).select('orderNumber status organizationId assignedTo.employeeId').lean();
    if (!order) return res.status(404).json({ success: false, message: 'Live tracking is no longer available for this order.' });

    const current = await EmployeeCurrentLocation.findOne({
      organizationId: order.organizationId,
      employeeId: order.assignedTo.employeeId,
    }).select('location.coordinates accuracy timestamp trackingStatus sessionStatus').lean();
    const fresh = Boolean(current?.timestamp && Date.now() - new Date(current.timestamp).getTime() <= 180_000);
    const trackingAvailable = Boolean(fresh && current.trackingStatus === 'ACTIVE' && current.sessionStatus === 'active');
    const coordinates = current?.location?.coordinates || [];
    const hasCoordinates = coordinates.length >= 2 &&
      Number.isFinite(coordinates[1]) && coordinates[1] >= -90 && coordinates[1] <= 90 &&
      Number.isFinite(coordinates[0]) && coordinates[0] >= -180 && coordinates[0] <= 180;
    return res.json({
      success: true,
      orderNumber: order.orderNumber,
      status: order.status,
      trackingAvailable,
      locationFresh: fresh,
      location: hasCoordinates
        ? { latitude: coordinates[1], longitude: coordinates[0], accuracy: current.accuracy, updatedAt: current.timestamp }
        : null,
      refreshedAt: new Date().toISOString(),
    });
  } catch (_) {
    return res.status(404).json({ success: false, message: 'Tracking link is invalid or expired.' });
  }
};

const updateStatus = async (req, res) => {
  if (!await ensurePharma(req, res)) return;
  if (!mongoose.isValidObjectId(req.params.orderId)) return res.status(400).json({ success: false, message: 'Invalid order ID.' });
  const status = text(req.body?.status, 40);
  if (!ORDER_STATUSES.slice(1).includes(status)) return res.status(400).json({ success: false, message: 'Choose a valid delivery status.' });

  const current = await PharmaOrder.findOne({ _id: req.params.orderId, organizationId: req.organizationId });
  if (!current) return res.status(404).json({ success: false, message: 'Order not found.' });
  const isAssignedUser = req.principalType === 'user' && String(current.assignedTo?.userId || '') === String(req.user._id);
  if (!isAssignedUser) return res.status(403).json({ success: false, message: 'Only the representative who took this order can update its delivery status.' });
  const previousUpdate = [...current.statusHistory].reverse().find((entry) => (
    entry.status === status && String(entry.changedByUserId || '') === String(req.user._id)
  ));
  if (previousUpdate) {
    return res.json({
      success: true,
      order: current,
      notifications: previousUpdate.notifications || { status: 'pending' },
      alreadyApplied: true,
      message: 'This order status was already updated.',
    });
  }
  if (status === 'On the Way') {
    const publicTrackingBaseUrl = String(
      process.env.PUBLIC_TRACKING_BASE_URL || process.env.CLIENT_URL || ''
    ).trim();
    if (!publicTrackingBaseUrl || !process.env.SECRET_JWT_KEY) {
      return res.status(503).json({
        success: false,
        code: 'ORDER_TRACKING_LINK_NOT_CONFIGURED',
        message: 'Customer tracking link is not configured on the server.',
      });
    }
  }
  const targetIndex = ORDER_STATUSES.indexOf(status);
  const currentIndex = ORDER_STATUSES.indexOf(current.status);
  if (currentIndex < 0 || targetIndex !== currentIndex + 1) {
    return res.status(409).json({ success: false, message: `Next allowed status is ${ORDER_STATUSES[currentIndex + 1] || 'none'}.` });
  }
  const changedAt = new Date();
  const action = actor(req);
  const trackingExpiresAt = status === 'On the Way'
    ? new Date(Date.now() + 8 * 60 * 60 * 1000)
    : status === 'Arrived' ? current.trackingExpiresAt : null;
  const setFields = { status, trackingExpiresAt };
  const order = await PharmaOrder.findOneAndUpdate(
    { _id: current._id, organizationId: req.organizationId, status: current.status, 'assignedTo.userId': current.assignedTo.userId },
    {
      $set: setFields,
      $push: { statusHistory: { status, changedAt, ...action, notifications: { status: 'pending' } } },
    },
    { new: true, runValidators: true }
  );
  if (!order) {
    const latest = await PharmaOrder.findOne({ _id: current._id, organizationId: req.organizationId });
    const alreadyApplied = latest?.statusHistory?.some((entry) => (
      entry.status === status && String(entry.changedByUserId || '') === String(req.user._id)
    ));
    if (alreadyApplied) {
      const entry = [...latest.statusHistory].reverse().find((item) => (
        item.status === status && String(item.changedByUserId || '') === String(req.user._id)
      ));
      return res.json({
        success: true,
        order: latest,
        notifications: entry?.notifications || { status: 'pending' },
        alreadyApplied: true,
        message: 'This order status was already updated.',
      });
    }
    return res.status(409).json({ success: false, message: 'Order changed on another device. Refresh and try again.' });
  }

  const notificationsPending = { status: 'pending' };
  emitOrganizationEvent(req.organizationId, 'pharma-order-changed', { orderId: String(order._id), action: 'status-updated' });
  emitPharmaOrderSocketChange(req.organizationId, order._id, 'status-updated');
  scheduleOrderNotification(order, status, changedAt, buildTrackingUrl(order, trackingExpiresAt));

  return res.json({
    success: true,
    order,
    notifications: notificationsPending,
    message: 'Order status updated. WhatsApp notifications are being sent.',
  });
};

module.exports = { listOrders, getOrder, createOrder, claimOrder, updateStatus, retryOrderNotification, ensurePharma, publicTracking };
