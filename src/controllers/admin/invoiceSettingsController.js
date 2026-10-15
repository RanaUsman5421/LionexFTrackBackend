const Organization=require('../../models/organization/Organization');
const {hasPermission}=require('../../utils/access/adminPermissions');
const {publicOrganization}=require('./organizationController');
const {parseMultipartFormData}=require('../../utils/http/multipartParser');
const {uploadCompanyLogoToCloudinary,isWebpBuffer}=require('../../services/storage/cloudinaryService');
function validateInvoice(body){
 const fields={};
 for(const [key,max] of Object.entries({client:160,phone:40,email:160,taxId:80,notes:2000,footer:500})){
  if(typeof body[key]!=='string'||body[key].length>max)throw new Error(`Invalid invoice ${key}.`);
  fields[key]=body[key].trim();
 }
 if(fields.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email))throw new Error('Enter a valid company email.');
 for(const [key,max]of [['tax',100],['delivery',1000000]]){
  if(typeof body[key]!=='number'||!Number.isFinite(body[key])||body[key]<0||body[key]>max)throw new Error(`Invalid invoice ${key}.`);
  fields[key]=body[key];
 }
 return fields;
}
function logoMime(buffer){
 if(buffer.length>=8&&buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png';
 if(buffer.length>=3&&buffer[0]===255&&buffer[1]===216&&buffer[2]===255)return 'image/jpeg';
 if(isWebpBuffer(buffer))return 'image/webp';
 return null;
}
exports.save=async(req,res)=>{
 if(req.principalType!=='admin'||!hasPermission(req.user,'organization.manage'))return res.status(403).json({message:'Organization management permission required.'});
 const existing=await Organization.findById(req.organizationId).select('category').lean();
 if(existing?.category!=='pharmaceutical')return res.status(403).json({message:'Pharmaceutical organization required.'});
 let parsed,invoice,name,address,file;
 try{
  parsed=parseMultipartFormData(req.body,req.headers['content-type']);
  invoice=validateInvoice(JSON.parse(parsed.fields.invoiceSettings||'{}'));
  name=String(parsed.fields.name||'').trim();address=String(parsed.fields.address||'').trim();
  if(!name||name.length>160||address.length>1000)throw new Error('Enter a company name (up to 160 characters) and a valid address.');
  file=parsed.files.logo;
  if(file&&(!file.buffer.length||file.buffer.length>2*1024*1024||!logoMime(file.buffer)))throw new Error('Choose a JPG, PNG or WebP logo up to 2 MB.');
 }catch(e){return res.status(400).json({message:e.message});}
 try{
  const update={name,address,invoiceSettings:invoice};
  if(file){
   const uploaded=await uploadCompanyLogoToCloudinary({buffer:file.buffer,filename:file.filename,mimeType:logoMime(file.buffer),organizationId:req.organizationId});
   if(!uploaded.secureUrl||!uploaded.secureUrl.startsWith('https://res.cloudinary.com/'))throw new Error('Cloudinary did not return a valid logo URL.');
   update.logoUrl=uploaded.secureUrl;
  }
  const organization=await Organization.findByIdAndUpdate(req.organizationId,{$set:update},{new:true,runValidators:true});
  if(!organization)return res.status(404).json({message:'Organization not found.'});
  return res.json({organization:publicOrganization(organization),message:'Company and invoice settings saved.'});
 }catch(e){return res.status(503).json({message:e.message||'Company settings could not be saved.'});}
};
exports.validateInvoice=validateInvoice;exports.logoMime=logoMime;
