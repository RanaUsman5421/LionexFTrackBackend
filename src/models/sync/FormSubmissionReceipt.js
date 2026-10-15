const mongoose=require('mongoose');
const schema=new mongoose.Schema({
 organizationId:{type:mongoose.Schema.Types.ObjectId,required:true},actor:{type:String,required:true},
 kind:{type:String,required:true},submissionId:{type:String,required:true},digest:{type:String,required:true},
 statusCode:{type:Number,required:true},response:{type:mongoose.Schema.Types.Mixed,required:true}
},{timestamps:true,autoIndex:true});
schema.index({organizationId:1,actor:1,kind:1,submissionId:1},{unique:true});
module.exports=mongoose.model('FormSubmissionReceipt',schema);
