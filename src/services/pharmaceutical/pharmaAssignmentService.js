const mongoose = require('mongoose');
const User = require('../../models/organization/User');
const Organization = require('../../models/organization/Organization');
const Order = require('../../models/pharmaceutical/PharmaOrder');
const Branch = require('../../models/pharmaceutical/PharmaBranch');
const Location = require('../../models/tracking/EmployeeCurrentLocation');
const terminal = ['Delivered', 'Failed', 'Cancelled'];
const limitFor = settings => Number.isInteger(settings?.pharmaMaxDropsPerRider) ? settings.pharmaMaxDropsPerRider : 5;

async function assignWithCapacity(organizationId, riderId, query, update, options = {}) {
  // Every assignment path writes the same rider document inside the transaction.
  // Concurrent assignments conflict and retry before counting open orders again.
  return mongoose.connection.transaction(async session => {
    const rider = await User.updateOne({ _id: riderId, organizationId, accountStatus: 'active', approvalStatus: 'approved' }, { $inc: { pharmaAssignmentVersion: 1 } }, { session });
    if (!rider.matchedCount) { const e = new Error('Rider must be active and approved.'); e.status = 409; throw e; }
    const organization = await Organization.findById(organizationId).select('settings').session(session).lean();
    if (options.automatic && !options.explicitAuto && !organization?.settings?.pharmaAutoAssignOrders) return null;
    if (options.branchId && !await Branch.exists({ _id: options.branchId, organizationId, riderIds: riderId }).session(session)) {
      const e = new Error('Rider is no longer assigned to this branch.'); e.status = 409; throw e;
    }
    const limit = limitFor(organization?.settings);
    const open = await Order.countDocuments({ organizationId, 'assignedTo.userId': riderId, status: { $nin: terminal } }).session(session);
    if (open >= limit) { const e = new Error(`Rider capacity full (${open}/${limit} open orders). Choose another rider.`); e.status = 409; throw e; }
    const deliverySequence = await require('./pharmaDropService').nextPosition(organizationId, riderId, session);
    update = { ...update, $set: { ...update.$set, deliverySequence }, $inc: { ...update.$inc, dispatchVersion: 1 } };
    return Order.findOneAndUpdate({ ...query, organizationId }, update, { new: true, runValidators: true, session });
  });
}
// Match dashboard ACTIVE freshness: a ping within the last two minutes.
function isOnline(location, now = Date.now()) {
  if (!location || location.sessionStatus === 'stopped' || ['TRACKING_STOPPED','GPS_DISABLED','VERIFICATION_REQUIRED','OFFLINE'].includes(location.trackingStatus)) return false;
  const stamp = new Date(location.lastSeenAt || location.updatedAt || location.timestamp).getTime();
  return Number.isFinite(stamp) && stamp <= now + 60000 && now - stamp < 120000;
}
async function assignBookedOrder(order, actor, requestedRider = '') {
  const organizationId = order.organizationId;
  const organization = await Organization.findById(organizationId).select('settings').lean();
  const explicitAuto = requestedRider === 'auto';
  const automatic = !requestedRider || explicitAuto;
  if (automatic && !explicitAuto && !organization?.settings?.pharmaAutoAssignOrders) return { order, reason: 'Auto-assignment is disabled.' };
  if (automatic && !order.branchId) return { order, reason: 'Choose a branch for automatic assignment.' };
  const branch = order.branchId ? await Branch.findOne({ _id: order.branchId, organizationId }).lean() : null;
  const query = { organizationId, accountStatus: 'active', approvalStatus: 'approved' };
  if (!automatic) query._id = requestedRider;
  else query._id = { $in: branch?.riderIds || [] };
  let riders = await User.find(query).select('employeeId fullName username').lean();
  if (!automatic && branch) riders = riders.filter(r => branch.riderIds.some(id => String(id) === String(r._id)));
  const onlineIds = new Set();
  if (automatic) {
    const locations = await Location.find({ organizationId, employeeId: { $in: riders.map(r => r.employeeId) } }).lean();
    for (const location of locations) if (isOnline(location)) onlineIds.add(location.employeeId);
  }
  const loads = await Order.aggregate([
    { $match: { organizationId: new mongoose.Types.ObjectId(String(organizationId)), 'assignedTo.userId': { $in: riders.map(r => r._id) }, status: { $nin: terminal } } },
    { $group: { _id: '$assignedTo.userId', count: { $sum: 1 } } },
  ]);
  const load = r => loads.find(item => String(item._id) === String(r._id))?.count || 0;
  riders = riders.filter(r => load(r) < limitFor(organization?.settings)).sort((a,b) => Number(onlineIds.has(b.employeeId)) - Number(onlineIds.has(a.employeeId)) || load(a)-load(b) || String(a._id).localeCompare(String(b._id)));
  for (const rider of riders) {
    const now = new Date();
    try {
      const assigned = await assignWithCapacity(organizationId, rider._id,
        { _id: order._id, status: 'Booked', 'assignedTo.userId': null },
        { $set: { assignedTo: { userId: rider._id, employeeId: rider.employeeId, username: rider.username, fullName: rider.fullName }, takenAt: now },
          $push: { statusHistory: { status: 'Taken', changedAt: now, changedByUserId: actor?._id, changedByName: actor?.fullName || actor?.username || '' } } },
        { automatic, explicitAuto, employeeId: rider.employeeId, branchId: order.branchId });
      if (assigned) return { order: assigned, assigned: true };
      return { order, reason: 'Order was already assigned or auto-assignment was disabled.' };
    } catch (e) { if (e.status !== 409) throw e; }
  }
  return { order, reason: automatic ? 'No active, approved rider with free capacity in this branch. Order remains in the queue.' : 'Selected rider is unavailable, outside the branch, or at capacity. Order remains in the queue.' };
}
module.exports = { assignWithCapacity, limitFor, isOnline, assignBookedOrder };
