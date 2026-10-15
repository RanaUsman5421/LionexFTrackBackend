const mongoose=require('mongoose');
const User=require('../../models/organization/User');
const Order=require('../../models/pharmaceutical/PharmaOrder');
const Branch=require('../../models/pharmaceutical/PharmaBranch');
const Org=require('../../models/organization/Organization');
const terminal=['Delivered','Failed','Cancelled'];
function conflict(message){const error=new Error(message);error.status=409;return error;}
const position=o=>Number.isFinite(o.deliverySequence)?o.deliverySequence:new Date(o.takenAt||o.createdAt||0).getTime();
function sortDrops(rows){return [...rows].sort((a,b)=>position(a)-position(b)||String(a._id).localeCompare(String(b._id)));}
async function listDrops(organizationId,riderId,session){return sortDrops(await Order.find({organizationId,'assignedTo.userId':riderId,status:{$nin:terminal}}).select('_id deliverySequence takenAt createdAt').session(session).lean());}
async function nextPosition(organizationId,riderId,session){const rows=await listDrops(organizationId,riderId,session);return rows.length?Math.max(...rows.map(position))+1:0;}
async function lockRiders(organizationId,ids,session){for(const id of [...new Set(ids.filter(Boolean).map(String))].sort()){
 const locked=await User.updateOne({_id:id,organizationId},{$inc:{pharmaAssignmentVersion:1}},{session});
 if(!locked.matchedCount)throw conflict('Rider no longer exists. Refresh and try again.');
}}
function sameIds(a,b){return a.length===b.length&&a.every((id,index)=>String(id)===String(b[index]));}
async function reorderDrops(organizationId,riderId,expectedIds,orderIds){
 return mongoose.connection.transaction(async session=>{
  await lockRiders(organizationId,[riderId],session);
  const rows=await listDrops(organizationId,riderId,session);
  if(!sameIds(rows.map(o=>o._id),expectedIds))throw conflict('Drop sequence changed. Refresh and try again.');
  if(new Set(orderIds.map(String)).size!==rows.length||!sameIds([...orderIds].map(String).sort(),rows.map(o=>String(o._id)).sort()))throw conflict('The sequence must include all current open drops exactly once.');
  for(let index=0;index<orderIds.length;index++){
   const result=await Order.updateOne({_id:orderIds[index],organizationId,'assignedTo.userId':riderId,status:{$nin:terminal}},{$set:{deliverySequence:index},$inc:{dispatchVersion:1}},{session});
   if(!result.matchedCount)throw conflict('An order changed. Refresh and try again.');
  }
  return Order.find({organizationId,_id:{$in:orderIds}}).session(session).lean();
 });
}
async function manageDrop(organizationId,orderId,actor,body){
 return mongoose.connection.transaction(async session=>{
  // Lock both riders in a stable order to serialize reassignment with capacity and sequence updates.
  await lockRiders(organizationId,[body.expectedRiderId,body.action==='reassign'?body.riderId:null],session);
  const current=await Order.findOne({_id:orderId,organizationId}).session(session).lean();
  if(!current)throw conflict('Order no longer exists.');
  if(terminal.includes(current.status)||String(current.assignedTo?.userId)!==String(body.expectedRiderId)||current.status!==body.expectedStatus||(current.dispatchVersion||0)!==body.expectedVersion)throw conflict('Order changed on another device. Refresh before confirming again.');
  const now=new Date();
  const history={changedAt:now,changedByUserId:actor._id,changedByName:actor.fullName||actor.username||'',remarks:String(body.remarks||'').trim(),notifications:{status:'pending'}};
  let fields;
  if(body.action==='Delivered'){
   if(Number(current.totalAmount)>0&&body.codConfirmed!==true)throw conflict('Confirm COD collection before completing this delivery.');
   fields={status:'Delivered',trackingExpiresAt:null};history.status='Delivered';history.codConfirmed=body.codConfirmed===true;
  }else{
   if(String(body.riderId)===String(current.assignedTo.userId))throw conflict('Choose a different rider.');
   const rider=await User.findOne({_id:body.riderId,organizationId,accountStatus:'active',approvalStatus:'approved'}).session(session).lean();
   if(!rider)throw conflict('Choose an active, approved rider in this organization.');
   // Branchless orders can only move between branchless riders.
   const branch=current.branchId?await Branch.exists({_id:current.branchId,organizationId,riderIds:rider._id}).session(session):!await Branch.exists({organizationId,riderIds:rider._id}).session(session);
   if(!branch)throw conflict('Choose a rider from the same branch.');
   const org=await Org.findById(organizationId).select('settings').session(session).lean();
   const limit=org?.settings?.pharmaMaxDropsPerRider??5;
   const load=await Order.countDocuments({organizationId,'assignedTo.userId':rider._id,status:{$nin:terminal}}).session(session);
   if(load>=limit)throw conflict(`Rider capacity full (${load}/${limit}).`);
   const assignedTo={userId:rider._id,employeeId:rider.employeeId,fullName:rider.fullName,username:rider.username};
   fields={assignedTo,deliverySequence:await nextPosition(organizationId,rider._id,session),trackingExpiresAt:['On the Way','Arrived'].includes(current.status)?new Date(now.getTime()+8*60*60*1000):null};
   history.status='Reassigned';history.previousAssignedTo=current.assignedTo;history.assignedTo=assignedTo;
  }
  const order=await Order.findOneAndUpdate({_id:orderId,organizationId,status:current.status,'assignedTo.userId':current.assignedTo.userId,...(current.dispatchVersion ? {dispatchVersion:current.dispatchVersion} : {$or:[{dispatchVersion:0},{dispatchVersion:{$exists:false}}]})},{$set:fields,$inc:{dispatchVersion:1},$push:{statusHistory:history}},{new:true,runValidators:true,session});
  // Older orders may not have a stored dispatchVersion field.
  if(!order)throw conflict('Order changed. Refresh and try again.');
  return {order,changedAt:now,status:history.status};
 });
}
module.exports={reorderDrops,manageDrop,nextPosition,sortDrops,sameIds};
