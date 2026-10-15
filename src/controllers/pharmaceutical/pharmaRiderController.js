const mongoose = require('mongoose');
const { assignWithCapacity } = require('../../services/pharmaceutical/pharmaAssignmentService');
const Organization = require('../../models/organization/Organization');
const PharmaBranch = require('../../models/pharmaceutical/PharmaBranch');
const PharmaOrder = require('../../models/pharmaceutical/PharmaOrder');
const User = require('../../models/organization/User');
const PharmaRiderProfile = require('../../models/pharmaceutical/PharmaRiderProfile');
const { hasPermission } = require('../../utils/access/adminPermissions');
const { emitOrganizationEvent } = require('../../services/realtime/appDataRealtimeService');
const { emitPharmaOrderSocketChange } = require('../../services/realtime/socketService');

async function access(req, res, write = false) {
  const org = await Organization.findById(req.organizationId).select('category').lean();
  if (org?.category !== 'pharmaceutical') { res.status(403).json({ message: 'Pharmaceutical organization required.' }); return false; }
  if (req.principalType !== 'admin' || !(write ? hasPermission(req.user, 'employees.manage') : ['tracking.read', 'reports.read', 'employees.manage'].some(p => hasPermission(req.user, p)))) {
    res.status(403).json({ message: 'Permission required.' }); return false;
  }
  return true;
}
exports.branches = async (req, res) => {
  if (!await access(req, res)) return;
  res.json({ branches: await PharmaBranch.find({ organizationId: req.organizationId }).sort({ name: 1 }).lean() });
};
exports.createBranch = async (req, res) => {
  if (!await access(req, res, true)) return;
  const fields = {};
  for (const [key, max] of Object.entries({ name: 120, city: 100, area: 100, address: 500, manager: 120, phone: 24 })) fields[key] = String(req.body?.[key] || '').trim().slice(0, max);
  if (!fields.name || (!fields.city && !fields.area)) return res.status(400).json({ message: 'Branch name and area are required.' });
  const branch = await PharmaBranch.create({ ...fields, organizationId: req.organizationId });
  res.status(201).json({ branch });
};
exports.assignRiders = async (req, res) => {
  if (!await access(req, res, true)) return;
  const ids = req.body?.riderIds;
  if (!mongoose.isValidObjectId(req.params.branchId) || !Array.isArray(ids) || ids.length > 1000 || ids.some(id => !mongoose.isValidObjectId(id))) return res.status(400).json({ message: 'Invalid riders or branch.' });
  const unique = [...new Set(ids.map(String))];
  if (await User.countDocuments({ _id: { $in: unique }, organizationId: req.organizationId }) !== unique.length) return res.status(400).json({ message: 'Riders must belong to this organization.' });
  const branch = await PharmaBranch.findOne({ _id: req.params.branchId, organizationId: req.organizationId });
  if (!branch) return res.status(404).json({ message: 'Branch not found.' });
  await PharmaBranch.updateMany({ organizationId: req.organizationId, _id: { $ne: branch._id } }, { $pull: { riderIds: { $in: unique } } });
  branch.riderIds = unique;
  await branch.save();
  res.json({ branch });
};
exports.dashboard = async (req, res) => {
  if (!await access(req, res)) return;
  // Only delivery fields are needed for charts; customer addresses and phone numbers stay in orders.
  const orders = await PharmaOrder.find({ organizationId: req.organizationId }).select('orderNumber branchId status assignedTo takenAt createdAt deliverySequence dispatchVersion totalAmount statusHistory.status statusHistory.changedAt').lean();
  const profiles = await PharmaRiderProfile.find({ organizationId: req.organizationId }).lean();
  res.json({ orders, profiles });
};
exports.saveProfile = async (req, res) => {
  if (!await access(req, res, true)) return;
  if (!mongoose.isValidObjectId(req.params.userId) || !await User.exists({ _id: req.params.userId, organizationId: req.organizationId })) return res.status(404).json({ message: 'Rider not found.' });
  const profile = await PharmaRiderProfile.findOneAndUpdate({ organizationId: req.organizationId, userId: req.params.userId }, { $set: { vehicle: String(req.body?.vehicle || '').trim().slice(0, 120), plate: String(req.body?.plate || '').trim().slice(0, 40) } }, { upsert: true, new: true, runValidators: true });
  res.json({ profile });
};
exports.dispatch = async (req, res) => {
  if (!await access(req, res, true)) return;
  if (!mongoose.isValidObjectId(req.params.orderId)) return res.status(400).json({ message: 'Invalid order.' });
  const action = req.body?.action;
  if (['Delivered','reassign'].includes(action)) {
    const body=req.body||{};
    if(!mongoose.isValidObjectId(body.expectedRiderId)||!Number.isInteger(body.expectedVersion)||body.expectedVersion<0||typeof body.expectedStatus!=='string'||String(body.remarks||'').length>500||(action==='reassign'&&!mongoose.isValidObjectId(body.riderId)))return res.status(400).json({message:'Invalid confirmation. Refresh the order and try again.'});
    try {
      const result=await require('../../services/pharmaceutical/pharmaDropService').manageDrop(req.organizationId,req.params.orderId,req.user,body);
      await require('../../services/pharmaceutical/pharmaNotificationService').notifyOrderEvent(result.order,result.status,result.changedAt);
      const notifier=require('./pharmaOrderController');
      notifier.scheduleOrderNotification(result.order,result.status,result.changedAt,notifier.buildTrackingUrl(result.order,result.order.trackingExpiresAt));
      emitOrganizationEvent(req.organizationId,'pharma-order-changed',{orderId:String(result.order._id),action});
      emitPharmaOrderSocketChange(req.organizationId,result.order._id,action);
      return res.json({order:result.order});
    }catch(e){if(e.status)return res.status(e.status).json({message:e.message});throw e;}
  }
  const now = new Date();
  const query = { _id: req.params.orderId, organizationId: req.organizationId };
  const history = { changedAt: now, changedByUserId: req.user._id, changedByName: req.user.fullName || req.user.username };
  let update;
  let assignmentRider;
  if (action === 'assign') {
    if (!mongoose.isValidObjectId(req.body.riderId)) return res.status(400).json({ message: 'Choose a rider.' });
    const rider = await User.findOne({ _id: req.body.riderId, organizationId: req.organizationId, accountStatus: 'active', approvalStatus: 'approved' }).lean();
    if (!rider) return res.status(400).json({ message: 'Choose an approved, active rider in this organization.' });
    const current = await PharmaOrder.findOne(query).select('branchId').lean();
    if (current?.branchId && !await PharmaBranch.exists({ _id: current.branchId, organizationId: req.organizationId, riderIds: rider._id })) return res.status(400).json({ message: 'Choose a rider assigned to the order branch.' });
    assignmentRider = rider._id;
    query.status = 'Booked'; query['assignedTo.userId'] = null;
    update = { $set: { assignedTo: { userId: rider._id, employeeId: rider.employeeId, fullName: rider.fullName, username: rider.username }, takenAt: now }, $push: { statusHistory: { ...history, status: 'Taken' } } };
  } else if (['Failed', 'Cancelled'].includes(action)) {
    query.status = { $nin: ['Delivered', 'Cancelled', 'Failed'] };
    update = { $inc: { dispatchVersion: 1 }, $set: { status: action, trackingExpiresAt: null }, $push: { statusHistory: { ...history, status: action } } };
  } else return res.status(400).json({ message: 'Invalid dispatch action.' });
  let order;
  try { order = assignmentRider ? await assignWithCapacity(req.organizationId, assignmentRider, query, update) : await PharmaOrder.findOneAndUpdate(query, update, { new: true, runValidators: true }); }
  catch (e) { if (e.status) return res.status(e.status).json({ message: e.message }); throw e; }
  if (!order) return res.status(409).json({ message: 'Order is no longer available for this action. Refresh and try again.' });
  await require('../../services/pharmaceutical/pharmaNotificationService').notifyOrderEvent(order, action === 'assign' ? 'Taken' : action, now);
  require('./pharmaOrderController').scheduleOrderNotification(order, action === 'assign' ? 'Taken' : action, now);
  emitOrganizationEvent(req.organizationId, 'pharma-order-changed', { orderId: String(order._id), action });
  emitPharmaOrderSocketChange(req.organizationId, order._id, action);
  res.json({ order });
};

// One request creates the login, rider details and branch membership.
exports.createRider = async (req, res) => {
  if (!await access(req, res, true)) return;
  const crypto = require('crypto');
  const bcrypt = require('bcryptjs');
  const { sanitizeUser } = require('../admin/adminController');
  const { emitAdminUserEvent } = require('../../services/realtime/socketService');
  const body = req.body || {};
  const clean = key => String(body[key] || '').trim();
  const fullName = clean('fullName'), username = clean('username'), phone = clean('phone');
  const password = String(body.password || '');
  if (!fullName || !username || !phone || !clean('plate') || password.length < 8 || password.length > 128)
    return res.status(400).json({ message: 'Name, username, phone, vehicle number and an 8-128 character password are required.' });
  if (['fullName','username','phone','email','cnic','vehicle','plate','licenseNumber','licenseExpiry','homeAddress','emergencyName','emergencyPhone'].some(key => clean(key).length > (key === 'homeAddress' ? 500 : key === 'cnic' ? 32 : key === 'plate' ? 40 : key === 'emergencyPhone' ? 24 : 120)))
    return res.status(400).json({ message: 'A rider field is too long.' });
  const images = ['profilePhotoUrl','cnicImageUrl','licenseImageUrl'];
  if (images.some(key => body[key] && (typeof body[key] !== 'string' || body[key].length > 2500000 || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(body[key]))))
    return res.status(400).json({ message: 'Use the cropped JPG images, under 1.8 MB each.' });
  let branch = null;
  if (body.branchId) {
    if (!mongoose.isValidObjectId(body.branchId)) return res.status(400).json({ message: 'Invalid branch.' });
    branch = await PharmaBranch.findOne({ _id: body.branchId, organizationId: req.organizationId });
    if (!branch) return res.status(400).json({ message: 'Choose a branch in this organization.' });
  }
  const employeeId = `PH-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
  // Email is optional in the rider form; this non-deliverable identifier is never emailed.
  const email = clean('email').toLowerCase() || `${employeeId.toLowerCase()}@riders.invalid`;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ message: 'Enter a valid email.' });
  let user;
  try {
    if (await User.exists({ $or: [{ username }, { email }] })) return res.status(409).json({ message: 'Username or email is already in use.' });
    user = await User.create({ fullName, username, email, phone, employeeId, cnic: clean('cnic'), password: await bcrypt.hash(password, 10), organizationId: req.organizationId,
      role: 'Medical Representative', department: 'Sales', city: branch?.city || '', area: branch?.area || '', joiningDate: new Date().toISOString().slice(0,10),
      profilePhotoUrl: body.profilePhotoUrl || null, approvalStatus: 'approved', accountStatus: 'active', approvedAt: new Date(), approvedBy: req.user._id });
    const details = Object.fromEntries(['vehicle','plate','licenseNumber','licenseExpiry','homeAddress','emergencyName','emergencyPhone'].map(key => [key, clean(key)]));
    await PharmaRiderProfile.create({ organizationId: req.organizationId, userId: user._id, ...details, cnicImageUrl: body.cnicImageUrl || '', licenseImageUrl: body.licenseImageUrl || '' });
    if (branch) {
      const result = await PharmaBranch.updateOne({ _id: branch._id, organizationId: req.organizationId }, { $addToSet: { riderIds: user._id } });
      if (!result.matchedCount) throw new Error('Branch no longer exists. Please try again.');
    }
  } catch (error) {
    if (user) {
      await PharmaBranch.updateMany({ organizationId: req.organizationId, riderIds: user._id }, { $pull: { riderIds: user._id } });
      await PharmaRiderProfile.deleteOne({ organizationId: req.organizationId, userId: user._id });
      await User.deleteOne({ _id: user._id, organizationId: req.organizationId });
    }
    return res.status(error.code === 11000 ? 409 : 500).json({ message: error.code === 11000 ? 'Username or email is already in use.' : error.message });
  }
  const publicUser = sanitizeUser(user);
  emitAdminUserEvent('admin:user-created', publicUser);
  return res.status(201).json({ user: publicUser, message: 'Rider account created successfully.' });
};

exports.reorderDrops=async(req,res)=>{
 if(!await access(req,res,true))return;
 const {expectedIds,orderIds}=req.body||{};
 if(!mongoose.isValidObjectId(req.params.riderId)||!Array.isArray(expectedIds)||!Array.isArray(orderIds)||orderIds.length>1000||expectedIds.length>1000||[...expectedIds,...orderIds].some(id=>!mongoose.isValidObjectId(id)))return res.status(400).json({message:'Invalid drop sequence.'});
 try{
  const orders=await require('../../services/pharmaceutical/pharmaDropService').reorderDrops(req.organizationId,req.params.riderId,expectedIds,orderIds);
  emitOrganizationEvent(req.organizationId,'pharma-order-changed',{action:'sequence-updated'});
  emitPharmaOrderSocketChange(req.organizationId,req.params.riderId,'sequence-updated');
  return res.json({orders});
 }catch(e){if(e.status)return res.status(e.status).json({message:e.message});throw e;}
};
