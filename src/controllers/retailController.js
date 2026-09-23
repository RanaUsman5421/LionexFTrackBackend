const crypto = require('crypto');
const Organization = require('../models/Organization');
const Retailer = require('../models/Retailer');
const RetailProduct = require('../models/RetailProduct');
const RetailVisit = require('../models/RetailVisit');
const SalesOrder = require('../models/SalesOrder');
const RetailPayment = require('../models/RetailPayment');
const RetailReturn = require('../models/RetailReturn');
const { hasPermission } = require('../utils/adminPermissions');

const text = (value, max = 500) => String(value ?? '').trim().slice(0, max);
const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const list = (value, max = 100) => Array.isArray(value) ? value.slice(0, max) : [];
const code = (prefix) => `${prefix}-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
const validId = (value) => /^[a-f\d]{24}$/i.test(String(value || ''));
const manager = (req) => req.principalType === 'admin' && hasPermission(req.user, 'employees.manage');

async function requireRetail(req, res) {
  const organization = await Organization.findById(req.organizationId).select('category').lean();
  if (!organization) { res.status(404).json({ success: false, message: 'Organization not found.' }); return false; }
  if (organization.category !== 'retailer_distribution') { res.status(403).json({ success: false, message: 'Retail modules are only available to Retail Distribution organizations.' }); return false; }
  return true;
}

async function summary(req, res) {
  if (!await requireRetail(req, res)) return;
  const [retailers, visits, orders, pendingOrders, payments, returns] = await Promise.all([
    Retailer.countDocuments({ organizationId: req.organizationId, active: true }), RetailVisit.countDocuments({ organizationId: req.organizationId, draft: false }),
    SalesOrder.countDocuments({ organizationId: req.organizationId }), SalesOrder.countDocuments({ organizationId: req.organizationId, status: 'Pending Approval' }),
    RetailPayment.aggregate([{ $match: { organizationId: req.organizationId } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
    RetailReturn.countDocuments({ organizationId: req.organizationId, status: { $nin: ['Rejected', 'Closed'] } }),
  ]);
  res.json({ success: true, summary: { retailers, visits, orders, pendingOrders, collectedAmount: payments[0]?.total || 0, openReturns: returns } });
}

async function listRetailers(req, res) {
  if (!await requireRetail(req, res)) return;
  const query = { organizationId: req.organizationId, active: true };
  if (req.query.status) query.onboardingStatus = text(req.query.status, 40);
  const rows = await Retailer.find(query).sort({ shopName: 1 }).limit(500).lean();
  res.json({ success: true, retailers: rows });
}

async function createRetailer(req, res) {
  if (!await requireRetail(req, res)) return;
  const body = req.body || {};
  const values = {
    organizationId: req.organizationId, retailerCode: text(body.retailerCode, 40) || code('RTL'), shopName: text(body.shopName, 160), ownerName: text(body.ownerName, 120), ownerCnic: text(body.ownerCnic, 32),
    mobileNumber: text(body.mobileNumber, 32), whatsappNumber: text(body.whatsappNumber, 32), email: text(body.email, 160).toLowerCase(), shopCategory: text(body.shopCategory, 80), retailerType: text(body.retailerType, 60), retailerClass: text(body.retailerClass, 60) || 'New/Unclassified',
    marketName: text(body.marketName, 120), address: text(body.address, 500), city: text(body.city, 80), territory: text(body.territory, 120), location: body.location || {}, businessStartYear: text(body.businessStartYear, 4), ntn: text(body.ntn, 60),
    mainProductCategories: list(body.mainProductCategories, 30).map((v) => text(v, 100)), currentSuppliers: text(body.currentSuppliers), preferredBrands: text(body.preferredBrands), paymentPreference: text(body.paymentPreference, 60), creditLimit: Math.max(0, number(body.creditLimit)), outstandingBalance: Math.max(0, number(body.outstandingBalance)),
    orderFrequency: text(body.orderFrequency, 60), expectedOrderValue: Math.max(0, number(body.expectedOrderValue)), accountTitle: text(body.accountTitle, 120), bankName: text(body.bankName, 120), iban: text(body.iban, 80), mobileWalletNumber: text(body.mobileWalletNumber, 32), shopExteriorPhotoUrl: text(body.shopExteriorPhotoUrl, 2048), visitingCardPhotoUrl: text(body.visitingCardPhotoUrl, 2048),
    onboardingStatus: manager(req) ? text(body.onboardingStatus, 40) || 'Approved' : 'Pending Approval', createdByEmployeeId: req.principalType === 'user' ? text(req.user.employeeId, 80) : '',
  };
  if (!values.shopName || !values.ownerName || !values.mobileNumber || !values.shopCategory || !values.retailerType || !values.address || !values.city || !values.territory) return res.status(400).json({ success: false, message: 'Shop, owner, mobile, category, retailer type, address, city and territory are required.' });
  try { const retailer = await Retailer.create(values); return res.status(201).json({ success: true, message: 'Retailer submitted successfully.', retailer }); }
  catch (error) { return res.status(error?.code === 11000 ? 409 : 500).json({ success: false, message: error?.code === 11000 ? 'Retailer code already exists.' : error.message }); }
}

async function updateRetailerStatus(req, res) {
  if (!await requireRetail(req, res) || !manager(req)) return res.status(403).json({ success: false, message: 'Employee management permission required.' });
  const allowed = ['Draft', 'Submitted', 'Pending Approval', 'Approved', 'Rejected', 'More Information Required'];
  const status = text(req.body?.status, 40); if (!allowed.includes(status)) return res.status(400).json({ success: false, message: 'Invalid onboarding status.' });
  const retailer = await Retailer.findOneAndUpdate({ _id: req.params.retailerId, organizationId: req.organizationId }, { $set: { onboardingStatus: status } }, { new: true });
  if (!retailer) return res.status(404).json({ success: false, message: 'Retailer not found.' });
  res.json({ success: true, retailer });
}

async function listProducts(req, res) { if (!await requireRetail(req, res)) return; const products = await RetailProduct.find({ organizationId: req.organizationId, active: true }).sort({ productName: 1 }).limit(1000).lean(); res.json({ success: true, products }); }
async function createProduct(req, res) {
  if (!await requireRetail(req, res)) return; if (!manager(req)) return res.status(403).json({ success: false, message: 'Employee management permission required.' });
  const body = req.body || {}; const values = { organizationId: req.organizationId, productName: text(body.productName, 160), brand: text(body.brand, 120), sku: text(body.sku, 80), model: text(body.model, 100), variant: text(body.variant, 100), colour: text(body.colour, 60), category: text(body.category, 120), compatibility: text(body.compatibility, 200), warranty: text(body.warranty, 100), wholesalePrice: Math.max(0, number(body.wholesalePrice)), retailPrice: Math.max(0, number(body.retailPrice)), availableStock: Math.max(0, number(body.availableStock)), scheme: text(body.scheme, 300), discountPercent: Math.max(0, Math.min(100, number(body.discountPercent))), taxPercent: Math.max(0, Math.min(100, number(body.taxPercent))) };
  if (!values.productName || !values.sku || !values.category) return res.status(400).json({ success: false, message: 'Product name, SKU and category are required.' });
  try { const product = await RetailProduct.create(values); res.status(201).json({ success: true, product }); } catch (error) { res.status(error?.code === 11000 ? 409 : 500).json({ success: false, message: error?.code === 11000 ? 'SKU already exists.' : error.message }); }
}

function calculatedOrder(raw, productsById, retailer) {
  const items = list(raw?.items, 100).map((item) => {
    const product = productsById.get(String(item.productId)); if (!product) return null;
    const quantity = Math.max(1, Math.floor(number(item.quantity, 1))); const discount = Math.max(0, Math.min(100, number(item.discountPercent, product.discountPercent)));
    const gross = product.wholesalePrice * quantity; const discountAmount = gross * discount / 100; const tax = (gross - discountAmount) * product.taxPercent / 100;
    return { productId: product._id, productName: product.productName, sku: product.sku, variant: text(item.variant || product.variant, 100), colour: text(item.colour || product.colour, 60), availableStock: product.availableStock, quantity, unitPrice: product.wholesalePrice, discountPercent: discount, scheme: text(item.scheme || product.scheme, 300), freeQuantity: Math.max(0, Math.floor(number(item.freeQuantity))), taxPercent: product.taxPercent, lineTotal: Math.round((gross - discountAmount + tax) * 100) / 100 };
  }).filter(Boolean);
  const grossAmount = items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0); const productDiscount = items.reduce((sum, item) => sum + item.unitPrice * item.quantity * item.discountPercent / 100, 0); const tax = items.reduce((sum, item) => sum + (item.lineTotal - item.unitPrice * item.quantity + item.unitPrice * item.quantity * item.discountPercent / 100), 0); const deliveryCharges = Math.max(0, number(raw?.deliveryCharges)); const schemeDiscount = Math.max(0, number(raw?.schemeDiscount)); const netOrderAmount = Math.max(0, grossAmount - productDiscount - schemeDiscount + deliveryCharges + tax); const availableCredit = Math.max(0, number(retailer?.creditLimit) - number(retailer?.outstandingBalance));
  return { items, summary: { totalProducts: items.length, totalUnits: items.reduce((sum, item) => sum + item.quantity, 0), grossAmount, productDiscount, schemeDiscount, previousBalance: number(retailer?.outstandingBalance), deliveryCharges, tax, netOrderAmount, creditLimit: number(retailer?.creditLimit), availableCredit }, approvalRequired: text(raw?.paymentTerms) === 'Credit' && netOrderAmount > availableCredit, paymentTerms: text(raw?.paymentTerms, 60), expectedDeliveryDate: text(raw?.expectedDeliveryDate, 40) || null };
}

async function createVisit(req, res) {
  if (!await requireRetail(req, res)) return; if (req.principalType !== 'user') return res.status(403).json({ success: false, message: 'A field employee account is required.' });
  const body = req.body || {}; const retailerId = validId(body.retailerId) ? body.retailerId : null; const retailer = retailerId ? await Retailer.findOne({ _id: retailerId, organizationId: req.organizationId }) : null;
  if (retailerId && !retailer) return res.status(404).json({ success: false, message: 'Retailer not found.' });
  const availability = text(body.retailerAvailability, 60); const outcome = text(body.outcome, 80); if (!availability || !outcome) return res.status(400).json({ success: false, message: 'Retailer availability and visit outcome are required.' });
  const productIds = list(body.order?.items).map((item) => item?.productId).filter(validId); const products = await RetailProduct.find({ _id: { $in: productIds }, organizationId: req.organizationId, active: true }); const productsById = new Map(products.map((p) => [String(p._id), p])); const order = calculatedOrder(body.order || {}, productsById, retailer);
  const checkInAt = new Date(body.checkInAt || Date.now()); const checkOutAt = new Date(body.checkOutAt || Date.now());
  const visit = await RetailVisit.create({ organizationId: req.organizationId, visitId: text(body.visitId, 80) || code('VIS'), employeeId: req.user.employeeId, retailerId: retailer?._id || null, retailerSnapshot: body.retailerSnapshot || (retailer ? { retailerCode: retailer.retailerCode, shopName: retailer.shopName, ownerName: retailer.ownerName, mobileNumber: retailer.mobileNumber, marketName: retailer.marketName, address: retailer.address, city: retailer.city, territory: retailer.territory, shopCategory: retailer.shopCategory, retailerType: retailer.retailerType, retailerClass: retailer.retailerClass, creditLimit: retailer.creditLimit, outstandingBalance: retailer.outstandingBalance } : {}), plannedVisit: Boolean(body.plannedVisit), visitPurposes: list(body.visitPurposes, 20).map((v) => text(v, 100)), personMet: text(body.personMet, 60), retailerAvailability: availability, checkInAt, checkOutAt, checkIn: body.checkIn || {}, checkOut: body.checkOut || {}, distanceFromRetailerMeters: Math.max(0, number(body.distanceFromRetailerMeters)), deviceStatus: text(body.deviceStatus, 80), internetStatus: text(body.internetStatus, 80), durationSeconds: Math.max(0, Math.floor((checkOutAt - checkInAt) / 1000)), stockChecks: list(body.stockChecks), order: { ...order, items: order.items }, productDemand: body.productDemand || {}, competitor: body.competitor || {}, payment: body.payment || {}, returns: list(body.returns), display: body.display || {}, outcome, noOrderReason: text(body.noOrderReason, 200), followUp: body.followUp || {}, retailerResponse: text(body.retailerResponse, 1000), additionalDetails: body.additionalDetails && typeof body.additionalDetails === 'object' ? body.additionalDetails : {}, visitRating: Math.max(0, Math.min(5, number(body.visitRating))), finalRemarks: text(body.finalRemarks, 2000), voiceNoteUrl: text(body.voiceNoteUrl, 2048), shopPhotoUrl: text(body.shopPhotoUrl, 2048), status: text(body.status, 40) || (outcome === 'No Order' ? 'No Order' : 'Completed'), draft: Boolean(body.draft) });
  if (!visit.draft && order.items.length && retailer) await SalesOrder.create({ organizationId: req.organizationId, orderNumber: code('ORD'), visitId: visit._id, retailerId: retailer._id, employeeId: req.user.employeeId, items: order.items, summary: order.summary, paymentTerms: order.paymentTerms, expectedDeliveryDate: order.expectedDeliveryDate, approvalRequired: order.approvalRequired, status: order.approvalRequired ? 'Pending Approval' : 'Submitted', statusHistory: [{ status: order.approvalRequired ? 'Pending Approval' : 'Submitted', at: new Date(), by: req.user.employeeId }] });
  if (!visit.draft && body.payment?.collected && number(body.payment?.collectedAmount) > 0 && retailer) await RetailPayment.create({ organizationId: req.organizationId, visitId: visit._id, retailerId: retailer._id, employeeId: req.user.employeeId, amount: number(body.payment.collectedAmount), mode: text(body.payment.mode, 60), referenceNumber: text(body.payment.referenceNumber, 120), receiptNumber: text(body.payment.receiptNumber, 120), evidenceUrl: text(body.payment.evidenceUrl, 2048), status: text(body.payment.status, 60) || 'Partially Paid', remarks: text(body.payment.remarks, 1000) });
  if (!visit.draft && list(body.returns).length && retailer) await RetailReturn.create({ organizationId: req.organizationId, visitId: visit._id, retailerId: retailer._id, employeeId: req.user.employeeId, items: list(body.returns), status: 'Requested', statusHistory: [{ status: 'Requested', at: new Date(), by: req.user.employeeId }] });
  res.status(201).json({ success: true, message: visit.draft ? 'Visit draft saved.' : 'Retailer visit submitted.', visit });
}

async function listVisits(req, res) { if (!await requireRetail(req, res)) return; const query = { organizationId: req.organizationId, draft: false }; if (req.principalType === 'user') query.employeeId = req.user.employeeId; const visits = await RetailVisit.find(query).populate('retailerId', 'retailerCode shopName ownerName city territory').sort({ createdAt: -1 }).limit(300).lean(); res.json({ success: true, visits }); }
async function getVisit(req, res) { if (!await requireRetail(req, res)) return; const query = { _id: req.params.visitId, organizationId: req.organizationId }; if (req.principalType === 'user') query.employeeId = req.user.employeeId; const visit = await RetailVisit.findOne(query).populate('retailerId').lean(); if (!visit) return res.status(404).json({ success: false, message: 'Visit not found.' }); const [order, payment, returns] = await Promise.all([SalesOrder.findOne({ visitId: visit._id }).lean(), RetailPayment.find({ visitId: visit._id }).lean(), RetailReturn.find({ visitId: visit._id }).lean()]); res.json({ success: true, visit: { ...visit, orderRecord: order, paymentRecords: payment, returnRecords: returns } }); }
async function listOrders(req, res) { if (!await requireRetail(req, res)) return; const rows = await SalesOrder.find({ organizationId: req.organizationId }).populate('retailerId', 'retailerCode shopName').sort({ createdAt: -1 }).limit(500).lean(); res.json({ success: true, orders: rows }); }
async function listPayments(req, res) { if (!await requireRetail(req, res)) return; const rows = await RetailPayment.find({ organizationId: req.organizationId }).populate('retailerId', 'retailerCode shopName').sort({ createdAt: -1 }).limit(500).lean(); res.json({ success: true, payments: rows }); }
async function listReturns(req, res) { if (!await requireRetail(req, res)) return; const rows = await RetailReturn.find({ organizationId: req.organizationId }).populate('retailerId', 'retailerCode shopName').sort({ createdAt: -1 }).limit(500).lean(); res.json({ success: true, returns: rows }); }

module.exports = { summary, listRetailers, createRetailer, updateRetailerStatus, listProducts, createProduct, createVisit, listVisits, getVisit, listOrders, listPayments, listReturns };


