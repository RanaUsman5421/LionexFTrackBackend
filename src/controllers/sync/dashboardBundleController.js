const mongoose=require('mongoose');
const User=require('../../models/organization/User');
const State=require('../../models/sync/AppSyncState');
const Lead=require('../../models/sync/LeadRecord');
const Activity=require('../../models/sync/ActivityRecord');
const {hasPermission}=require('../../utils/access/adminPermissions');
async function dashboardBundle(req,res){
 try {
  const ids=[...new Set(String(req.query.employeeIds||'').split(',').filter(Boolean))];
  if(!ids.length||ids.length>100)return res.status(400).json({success:false,message:'Select between 1 and 100 employees.'});
  const team=req.principalType==='admin'&&(hasPermission(req.user,'employees.read')||hasPermission(req.user,'employees.manage')||hasPermission(req.user,'tracking.read'))||/admin|manager/i.test(req.user.role||'');
  if(!team&&ids.some(id=>id!==req.user.employeeId))return res.status(403).json({success:false,message:'Not authorized.'});
  const allowed=await User.find({organizationId:req.organizationId,employeeId:{$in:ids}}).select('employeeId').lean();
  if(allowed.length!==ids.length)return res.status(403).json({success:false,message:'Employee scope is not available.'});
  const scope={organizationId:req.organizationId,employeeId:{$in:ids}};
  const family=req.query.family||'state';
  if(family==='state'){
   const rows=await State.find(scope).select('employeeId data.user data.duty data.tracking').lean();
   return res.json({success:true,rows:rows.map(row=>({employeeId:row.employeeId,data:row.data||{}})),hasMore:false});
  }
  if(family==='activity'){
   const rows=await Activity.find({...scope,deletedAt:null}).select('employeeId data entityId').sort({'data.timestampMs':-1,createdAt:-1}).limit(7).lean();
   return res.json({success:true,rows,hasMore:false});
  }
  if(family!=='lead')return res.status(400).json({success:false,message:'Unknown dashboard record family.'});
  const query={...scope,deletedAt:null};
  if(req.query.cursor){if(!mongoose.isValidObjectId(req.query.cursor))return res.status(400).json({success:false,message:'Invalid cursor.'});query._id={$gt:req.query.cursor};}
  const limit=Math.min(300,Math.max(1,Math.floor(Number(req.query.limit)||200)));
  const rows=await Lead.find(query).select('employeeId data createdAt').sort({_id:1}).limit(limit+1).lean();
  const selected=[];let bytes=0;
  for(const row of rows.slice(0,limit)){const size=Buffer.byteLength(JSON.stringify(row));if(selected.length&&bytes+size>1000000)break;selected.push(row);bytes+=size;}
  const hasMore=rows.length>selected.length;
  return res.json({success:true,rows:selected,hasMore,nextCursor:hasMore?String(selected.at(-1)._id):null});
 }catch(error){return res.status(500).json({success:false,message:'Unable to load dashboard records.'});}
}
module.exports={dashboardBundle};
