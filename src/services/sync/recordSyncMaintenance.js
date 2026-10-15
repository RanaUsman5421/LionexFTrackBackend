const mongoose=require('mongoose');
const Metadata=require('../../models/sync/AppSyncMetadata');
const Change=require('../../models/sync/AppSyncChange');
// Run from scheduled maintenance. Advancing the floor and deleting history are atomic.
async function compactEmployee(employeeId,organizationId,days=90) {
  const scope={employeeId,organizationId};
  const cutoff=new Date(Date.now()-Math.max(7,days)*86400000);
  const session=await mongoose.startSession();
  try {
    await session.withTransaction(async()=>{
      const meta=await Metadata.findOneAndUpdate(scope,{$inc:{mutationLock:1}},{new:true,session}).lean();
      if(!meta?.epoch)return;
      const last=await Change.findOne({...scope,createdAt:{$lt:cutoff}}).sort({sequence:-1}).session(session).lean();
      if(!last)return;
      await Metadata.updateOne(scope,{$max:{logFloor:last.sequence}},{session});
      await Change.deleteMany({...scope,sequence:{$lte:last.sequence}},{session});
    });
  }finally{await session.endSession()}
}
function startMaintenance() {
  let running=false;
  const sweep=async()=>{
    if(running)return;
    running=true;
    try {
      for await(const metadata of Metadata.find({epoch:{$ne:null}}).select('employeeId organizationId').cursor()) {
        await compactEmployee(metadata.employeeId,metadata.organizationId);
      }
    } catch(error) { console.error('Record sync maintenance failed:',error.message); }
    finally { running=false; }
  };
  // Avoid startup latency; retain at least 90 days of immutable change history.
  const timer=setInterval(()=>void sweep(),24*60*60*1000);
  timer.unref();
  return ()=>clearInterval(timer);
}
module.exports={compactEmployee,startMaintenance};
