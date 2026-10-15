const mongoose=require('mongoose');
const schema=new mongoose.Schema({organizationId:{type:mongoose.Schema.Types.ObjectId,required:true},employeeId:{type:String,required:true},hour:{type:Date,required:true},generation:{type:Number,default:0},computedGeneration:{type:Number,default:-1},metrics:{type:mongoose.Schema.Types.Mixed,default:null}},{timestamps:true});
schema.index({organizationId:1,employeeId:1,hour:1},{unique:true});
schema.index({organizationId:1,hour:1,employeeId:1});
module.exports=mongoose.model('DistanceSummaryBucket',schema);
