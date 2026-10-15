const mongoose = require('mongoose');
const schema = new mongoose.Schema({
 organizationId: {type:mongoose.Schema.Types.ObjectId,required:true,index:true},
 recipientId: {type:mongoose.Schema.Types.ObjectId,default:null,index:true},
 audience: {type:String,enum:['admin','rider'],required:true},
 orderId: {type:mongoose.Schema.Types.ObjectId,required:true},
 eventKey: {type:String,required:true},
 title: String, body: String,
 readBy: [{type:mongoose.Schema.Types.ObjectId}],
}, {timestamps:true});
schema.index({organizationId:1,audience:1,recipientId:1,eventKey:1},{unique:true});
schema.index({organizationId:1,audience:1,recipientId:1,createdAt:-1});
module.exports=mongoose.model('PharmaNotification',schema);
