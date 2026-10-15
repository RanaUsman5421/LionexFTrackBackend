const mongoose=require('mongoose');
const Notification=require('../../models/pharmaceutical/PharmaNotification');
const Organization=require('../../models/organization/Organization');
const {hasPermission}=require('../../utils/access/adminPermissions');
async function scope(req,res){
 const org=await Organization.findById(req.organizationId).select('category').lean();
 if(org?.category!=='pharmaceutical'){res.status(403).json({message:'Pharmaceutical organization required.'});return null;}
 if(req.principalType==='user') return {organizationId:req.organizationId,audience:'rider',recipientId:req.user._id};
 if(req.principalType==='admin'&&['employees.read','employees.manage','reports.read','tracking.read'].some(p=>hasPermission(req.user,p))) return {organizationId:req.organizationId,audience:'admin',recipientId:null};
 res.status(403).json({message:'Notification permission required.'});return null;
}
exports.list=async(req,res)=>{
 const query=await scope(req,res);if(!query)return;
 const limit=Math.min(100,Math.max(1,parseInt(req.query.limit,10)||50));
 if(req.query.unread==='true')query.readBy={$ne:req.user._id};
 const unreadQuery={...query,readBy:{$ne:req.user._id}};
 const [rows,unread,unreadRows]=await Promise.all([Notification.find(query).sort({createdAt:-1}).limit(limit).lean(),Notification.countDocuments(unreadQuery),
  req.query.includeUnread==='true'?Notification.find(unreadQuery).sort({createdAt:-1}).limit(limit).lean():Promise.resolve([])]);
 const present=({readBy,...n})=>({...n,read:(readBy||[]).some(id=>String(id)===String(req.user._id))});
 res.json({notifications:rows.map(present),unread,...(req.query.includeUnread==='true'?{unreadNotifications:unreadRows.map(present)}:{})});
};
exports.read=async(req,res)=>{
 const query=await scope(req,res);if(!query)return;
 if(!mongoose.isValidObjectId(req.params.notificationId))return res.status(400).json({message:'Invalid notification.'});
 const row=await Notification.findOneAndUpdate({...query,_id:req.params.notificationId},{$addToSet:{readBy:req.user._id}},{new:true});
 if(!row)return res.status(404).json({message:'Notification not found.'});
 res.json({success:true});
};
