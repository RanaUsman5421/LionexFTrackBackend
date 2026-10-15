const Profile=require('../../models/whatsapp/WhatsAppProfile');
const Organization=require('../../models/organization/Organization');
async function resolveSendingProfile(organizationId,branchId){
 const transport=require('../../whatsapp/whatsapp');
 if(branchId){const branch=await Profile.findOne({organizationId,branchId}).lean();if(branch&&transport.getProfileState(branch.profileId).status==='connected')return branch.profileId;}
 const org=await Organization.findById(organizationId).select('whatsappDefaultProfileId').lean();
 if(org?.whatsappDefaultProfileId){const fallback=await Profile.findOne({_id:org.whatsappDefaultProfileId,organizationId}).lean();if(fallback&&transport.getProfileState(fallback.profileId).status==='connected')return fallback.profileId;}
 throw new Error('No connected WhatsApp profile for this branch or default profile. Connect a profile in Settings and retry.');
}
module.exports={resolveSendingProfile};
