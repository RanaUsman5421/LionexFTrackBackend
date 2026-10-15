const mongoose=require('mongoose');
const schema=new mongoose.Schema({
 organizationId:{type:mongoose.Schema.Types.ObjectId,required:true,index:true,ref:'Organization'},
 profileId:{type:String,required:true,unique:true,immutable:true},
 name:{type:String,required:true,trim:true,maxlength:100},
 branchId:{type:mongoose.Schema.Types.ObjectId,ref:'PharmaBranch',default:null},
},{timestamps:true});
schema.index({organizationId:1,branchId:1},{unique:true,partialFilterExpression:{branchId:{$type:'objectId'}}});
module.exports=mongoose.model('WhatsAppProfile',schema);
