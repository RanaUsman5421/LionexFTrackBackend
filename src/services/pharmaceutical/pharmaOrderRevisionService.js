const {randomUUID}=require('node:crypto');
const Revision=require('../../models/pharmaceutical/PharmaOrderRevision');
const pending=new Map(),boot=randomUUID();let failureEpoch=0;
function changed(organizationId){
 if(Revision.db.readyState!==1){failureEpoch++;return;}
 const key=String(organizationId),previous=pending.get(key)||Promise.resolve();
 const job=previous.then(async()=>{
  await Revision.init();
  try{await Revision.updateOne({organizationId},{$inc:{revision:1}},{upsert:true})}
  catch(error){if(error.code!==11000)throw error;await Revision.updateOne({organizationId},{$inc:{revision:1}})}
 }).catch(()=>{failureEpoch++}).finally(()=>{if(pending.get(key)===job)pending.delete(key)});
 pending.set(key,job);
}
async function current(organizationId){
 if(Revision.db.readyState!==1)return `${boot}:${failureEpoch}:disconnected`;
 await Revision.init();
 await pending.get(String(organizationId));
 const row=await Revision.findOne({organizationId}).select('revision').lean();
 return `${boot}:${failureEpoch}:${row?.revision||0}`;
}
module.exports={changed,current};
