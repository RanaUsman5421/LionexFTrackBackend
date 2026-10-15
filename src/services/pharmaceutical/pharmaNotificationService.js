const Organization=require('../../models/organization/Organization');
const Notification=require('../../models/pharmaceutical/PharmaNotification');
const {emitEmployeeEvent}=require('../realtime/appDataRealtimeService');
const {getIo}=require('../realtime/socketService');
const User=require('../../models/organization/User');
const enabled=(settings,key)=>settings?.[key] !== false;
async function notifyOrderEvent(order,status,changedAt=new Date()) {
 try {
  const org=await Organization.findById(order.organizationId).select('settings').lean();
  const eventKey=`${order._id}:${status}:${new Date(changedAt).toISOString()}`;
  const rows=[];
  if(['Booked','Delivered','Failed','Cancelled'].includes(status)&&enabled(org?.settings,'pharmaAdminAlerts')) rows.push({audience:'admin',recipientId:null,title:`Order ${status}`,body:`${order.orderNumber}: ${status}`});
  if(['Taken','Reassigned'].includes(status)&&order.assignedTo?.userId&&enabled(org?.settings,'pharmaRiderPush')) rows.push({audience:'rider',recipientId:order.assignedTo.userId,title:'New order assigned',body:`Order ${order.orderNumber} has been assigned to you.`});
  for(const row of rows){
   const result=await Notification.updateOne({organizationId:order.organizationId,audience:row.audience,recipientId:row.recipientId,eventKey},{$setOnInsert:{...row,organizationId:order.organizationId,orderId:order._id,eventKey}},{upsert:true});
   if(!result.upsertedCount) continue;
   if(row.audience==='admin') getIo()?.to(`org:${order.organizationId}:dashboard`).emit('pharma:notification-changed',{orderId:String(order._id)});
   else {
    const rider=await User.findOne({_id:row.recipientId,organizationId:order.organizationId}).select('employeeId').lean();
    if(rider) emitEmployeeEvent(order.organizationId,rider.employeeId,'pharma-notification-changed',{orderId:String(order._id)});
   }
  }
 } catch(error){console.error('Order notification inbox failed:',error.message);}
}
module.exports={notifyOrderEvent,enabled};
