const mongoose=require('mongoose');
const crypto=require('crypto');
const Organization=require('../../models/organization/Organization');
const Profile=require('../../models/whatsapp/WhatsAppProfile');
const Branch=require('../../models/pharmaceutical/PharmaBranch');
const {hasPermission}=require('../../utils/access/adminPermissions');
const transport=()=>require('../../whatsapp/whatsapp');
const connectionOperations=new Map();
async function connectionOperation(row,work){
 const key=String(row._id),previous=connectionOperations.get(key)||Promise.resolve();
 const task=previous.catch(()=>{}).then(async()=>{if(!await Profile.exists({_id:row._id,organizationId:row.organizationId})){const e=new Error('WhatsApp profile not found.');e.status=404;throw e;}return work();});
 connectionOperations.set(key,task);
 try{return await task;}finally{if(connectionOperations.get(key)===task)connectionOperations.delete(key);}
}

async function access(req,res,write=false){
 if(req.principalType!=='admin'||!(write?hasPermission(req.user,'organization.manage'):['organization.manage','employees.manage','reports.read'].some(p=>hasPermission(req.user,p)))){res.status(403).json({message:'WhatsApp profile management permission required.'});return null;}
 const org=await Organization.findById(req.organizationId).select('category whatsappDefaultProfileId').lean();
 if(org?.category!=='pharmaceutical'){res.status(403).json({message:'Pharmaceutical organization required.'});return null;}
 return org;
}
const publicProfile=(p,org)=>({...transport().getProfileState(p.profileId),_id:String(p._id),name:p.name,branchId:p.branchId?String(p.branchId):null,isDefault:String(org.whatsappDefaultProfileId||'')===String(p._id)});
async function owned(req,res){
 if(!mongoose.isValidObjectId(req.params.profileId)){res.status(400).json({message:'Invalid profile.'});return null;}
 const row=await Profile.findOne({_id:req.params.profileId,organizationId:req.organizationId});
 if(!row)res.status(404).json({message:'WhatsApp profile not found.'});return row;
}
async function fields(req){
 const name=String(req.body?.name||'').trim();const branchId=req.body?.branchId||null;
 if(!name||name.length>100)throw new Error('Enter a profile name up to 100 characters.');
 if(branchId&&(!mongoose.isValidObjectId(branchId)||!await Branch.exists({_id:branchId,organizationId:req.organizationId})))throw new Error('Choose a branch in this organization.');
 return {name,branchId};
}
exports.list=async(req,res)=>{const org=await access(req,res);if(!org)return;const rows=await Profile.find({organizationId:req.organizationId}).sort({createdAt:1}).lean();res.json(rows.map(p=>publicProfile(p,org)));};
exports.create=async(req,res)=>{
 const org=await access(req,res,true);if(!org)return;
 let values;try{values=await fields(req);}catch(e){return res.status(400).json({message:e.message});}
 try{
  const profile=await Profile.create({...values,organizationId:req.organizationId,profileId:`pharma_${crypto.randomBytes(18).toString('hex')}`});
  const condition={_id:req.organizationId,...(req.body.makeDefault===true?{}:{whatsappDefaultProfileId:null})};
  await Organization.updateOne(condition,{$set:{whatsappDefaultProfileId:profile._id}});
  const current=await Organization.findById(req.organizationId).select('whatsappDefaultProfileId').lean();
  res.status(201).json({profile:publicProfile(profile,current)});
 }catch(e){res.status(e.code===11000?409:500).json({message:e.code===11000?'This branch already has a WhatsApp profile. Edit that profile or choose All branches.':e.message});}
};
exports.update=async(req,res)=>{
 const org=await access(req,res,true);if(!org)return;const row=await owned(req,res);if(!row)return;
 try{const values=await fields(req);Object.assign(row,values);await row.save();res.json({profile:publicProfile(row,org)});}catch(e){res.status(e.code===11000?409:400).json({message:e.code===11000?'This branch already has a WhatsApp profile.':e.message});}
};
exports.makeDefault=async(req,res)=>{const org=await access(req,res,true);if(!org)return;const row=await owned(req,res);if(!row)return;try{await connectionOperation(row,()=>Organization.updateOne({_id:req.organizationId},{$set:{whatsappDefaultProfileId:row._id}}));res.json({success:true});}catch(e){res.status(e.status||503).json({message:e.message});}};
exports.qr=async(req,res)=>{const org=await access(req,res,true);if(!org)return;const row=await owned(req,res);if(!row)return;try{const result=await connectionOperation(row,()=>transport().connectManagedProfile(row.profileId));res.json(result);}catch(e){res.status(e.status||503).json({message:e.message});}};
exports.disconnect=async(req,res)=>{const org=await access(req,res,true);if(!org)return;const row=await owned(req,res);if(!row)return;try{await connectionOperation(row,()=>transport().disconnectManagedProfile(row.profileId));res.json({success:true,status:'logged_out'});}catch(e){res.status(e.status||503).json({message:e.message});}};
exports.remove=async(req,res)=>{
 const org=await access(req,res,true);if(!org)return;const row=await owned(req,res);if(!row)return;
 try{await connectionOperation(row,async()=>{await transport().disconnectManagedProfile(row.profileId);await Profile.deleteOne({_id:row._id,organizationId:req.organizationId});await Organization.updateOne({_id:req.organizationId,whatsappDefaultProfileId:row._id},{$set:{whatsappDefaultProfileId:null}});});res.json({success:true});}catch(e){res.status(e.status||503).json({message:e.message});}
};
