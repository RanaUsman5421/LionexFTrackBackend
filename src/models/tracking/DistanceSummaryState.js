const mongoose=require('mongoose');
module.exports=mongoose.model('DistanceSummaryState',new mongoose.Schema({organizationId:{type:mongoose.Schema.Types.ObjectId,unique:true,required:true},initialized:{type:Boolean,default:false}},{timestamps:true}));
