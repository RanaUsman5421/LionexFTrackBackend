const service = require('../../services/sync/recordSyncService');
const respond = (handler) => async (req,res) => {
  try {
    if (!req.user.employeeId || !req.organizationId) return res.status(403).json({success:false,message:'Employee session required.'});
    return res.json(await handler(req));
  } catch (error) { return res.status(error.status || 500).json({success:false,message:error.message}); }
};
exports.pull = respond(req => service.pull(req.user.employeeId,req.organizationId,req.query.cursor,req.query.limit));
exports.push = respond(req => service.push(req.user.employeeId,req.organizationId,req.body?.operations));
