const mongoose=require('mongoose');
module.exports=mongoose.model('PharmaOrderRevision',new mongoose.Schema({organizationId:{type:mongoose.Schema.Types.ObjectId,required:true,unique:true},revision:{type:Number,default:0}},{timestamps:true,bufferCommands:false,autoIndex:true}));
