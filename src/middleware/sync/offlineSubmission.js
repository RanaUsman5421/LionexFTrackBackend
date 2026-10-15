const mongoose=require('mongoose');
const {createHash}=require('node:crypto');
const Receipt=require('../../models/sync/FormSubmissionReceipt');
// Automatically enlist existing controller model operations in this transaction.
mongoose.set('transactionAsyncLocalStorage',true);
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
const digest=body=>createHash('sha256').update(JSON.stringify(canonical(body))).digest('hex');
function offlineSubmission(kind,handler){
 return async(req,res,next)=>{
  const submissionId=req.get('Idempotency-Key');
  if(!submissionId)return handler(req,res,next); // Existing clients are unchanged.
  if(!/^[A-Za-z0-9_-]{1,120}$/.test(submissionId))return res.status(400).json({success:false,message:'Invalid submission ID.'});
  const scope={organizationId:req.organizationId,actor:`${req.principalType}:${req.user.employeeId||req.user._id}`,kind,submissionId};
  const hash=digest(req.body||{});
  const replay=receipt=>receipt.digest===hash?res.status(receipt.statusCode).json(receipt.response):res.status(409).json({success:false,message:'This submission ID already belongs to different form data.'});
  try{
   await Receipt.init();
   const previous=await Receipt.findOne(scope).lean();if(previous)return replay(previous);
   let captured;
   await mongoose.connection.transaction(async()=>{
    captured=null;
    const prior=await Receipt.findOne(scope).lean();
    if(prior){if(prior.digest!==hash)throw Object.assign(new Error('Submission conflict'),{response:{code:409,body:{success:false,message:'This submission ID already belongs to different form data.'}}});captured={code:prior.statusCode,body:prior.response};return;}
    // Reserve unique identity before business writes. Response only leaves after commit.
    const receipt=await Receipt.create({...scope,digest:hash,statusCode:202,response:{success:false}});
    const capture={statusCode:200,status(code){this.statusCode=code;return this},json(body){captured={code:this.statusCode,body:JSON.parse(JSON.stringify(body))};return this}};
    await handler(req,capture,error=>{throw error||new Error('Submission did not complete');});
    if(!captured||captured.code>=400||captured.body.success!==true)throw Object.assign(new Error('Submission failed'),{response:captured||{code:500,body:{success:false,message:'Submission did not complete.'}}});
    await Receipt.updateOne({_id:receipt._id},{$set:{statusCode:captured.code,response:captured.body}});
   });
   return res.status(captured.code).json(captured.body);
  }catch(error){
   if(error.code===11000){const previous=await Receipt.findOne(scope).lean();if(previous)return replay(previous);}
   if(error.response)return res.status(error.response.code).json(error.response.body);
   if(error.name==='ValidationError'||error.name==='CastError')return res.status(400).json({success:false,message:'Form validation failed. Review the saved form fields.'});
   if(error.code===11000)return res.status(409).json({success:false,message:'A record with this identifier already exists. Review the saved form.'});
   return res.status(503).json({success:false,message:'Submission could not be confirmed. Your device can safely retry.'});
  }
 };
}
module.exports={offlineSubmission,digest};
