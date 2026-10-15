const crypto = require('crypto');
const mongoose = require('mongoose');
const Metadata = require('../../models/sync/AppSyncMetadata');
const Change = require('../../models/sync/AppSyncChange');
const Receipt = require('../../models/sync/AppSyncReceipt');
const User = require('../../models/organization/User');
const Organization = require('../../models/organization/Organization');
const models = {
  state: require('../../models/sync/AppSyncState'),
  lead: require('../../models/sync/LeadRecord'),
  followUp: require('../../models/sync/FollowUpRecord'),
  activity: require('../../models/sync/ActivityRecord'),
  notification: require('../../models/sync/AppNotificationRecord'),
};
const kinds = Object.keys(models);
const {emitEmployeeEvent} = require('../realtime/appDataRealtimeService');
const {emitAppDataUpdate} = require('../realtime/socketService');
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const error = (message, status = 400) => Object.assign(new Error(message), {status});
const scopeFor = (employeeId, organizationId) => ({employeeId, organizationId});
const idForNotification = item => item.id || `notice-${crypto.createHash('sha256').update(JSON.stringify(item)).digest('hex').slice(0, 24)}`;
const boundedPage = (rows,limit) => {
  const page=[]; let bytes=0;
  for(const row of rows.slice(0,limit)) {
    const size=Buffer.byteLength(JSON.stringify(row));
    if(page.length&&bytes+size>1_000_000)break;
    page.push(row);bytes+=size;
  }
  return page;
};
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
function decode(cursor, scope, epoch) {
  if (!cursor || cursor.length > 4096) throw error('A valid sync cursor is required.');
  let value;
  try { value = JSON.parse(Buffer.from(cursor, 'base64url').toString()); } catch (_) { throw error('Invalid sync cursor.'); }
  if (value.employeeId !== scope.employeeId || value.organizationId !== String(scope.organizationId) || value.epoch !== epoch) return null;
  if (!['bootstrap', 'delta'].includes(value.mode) || !Number.isSafeInteger(value.sequence) || value.sequence < 0) throw error('Invalid sync cursor.');
  if (value.mode === 'bootstrap' && (!Number.isInteger(value.kind) || value.kind < 0 || value.kind >= kinds.length || typeof value.after !== 'string' || value.after.length > 200)) throw error('Invalid bootstrap cursor.');
  return value;
}
function validateOperations(operations) {
  if (!Array.isArray(operations) || !operations.length || operations.length > 100) throw error('Send between 1 and 100 sync operations.');
  const ids = new Set();
  return operations.map(op => {
    if (!op || !kinds.includes(op.kind) || !/^[A-Za-z0-9_-]{8,100}$/.test(op.operationId || '') || ids.has(op.operationId)) throw error('Invalid or duplicate operation.');
    ids.add(op.operationId);
    if (typeof op.entityId !== 'string' || !op.entityId.trim() || op.entityId.length > 200 || (op.kind === 'state' && op.entityId !== '__state__')) throw error('Invalid record id.');
    if (!Number.isSafeInteger(op.baseRevision) || op.baseRevision < 0 || typeof op.deleted !== 'boolean') throw error('Invalid record revision.');
    if (!op.deleted && (!op.data || typeof op.data !== 'object' || Array.isArray(op.data))) throw error('Record data is required.');
    if (op.kind === 'state' && op.deleted) throw error('App state cannot be deleted.');
    if (JSON.stringify(op).length > 256000) throw error('Sync record is too large.', 413);
    return op;
  });
}

async function ensureReady(employeeId, organizationId) {
  const scope = scopeFor(employeeId, organizationId);
  let metadata = await Metadata.findOne(scope).lean();
  if (metadata?.epoch) return metadata;
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      metadata = await Metadata.findOneAndUpdate(scope, {$inc:{mutationLock:1}}, {returnDocument:'after', upsert:true, session}).lean();
      if (metadata.epoch) return;
      let sequence = 0;
      await require('./snapshotMigrationService').importEmployee(employeeId, organizationId, session);
      const state = await models.state.findOne({employeeId}).session(session).lean();
      const notices = state?.data?.notifications || [];
      if (notices.length) await models.notification.bulkWrite(notices.map(item=>({updateOne:{filter:{employeeId,entityId:idForNotification(item)},update:{$setOnInsert:{organizationId,data:item,deletedAt:null}},upsert:true}})),{session,ordered:true});
      // Seed one bootstrap revision in bulk; historical records do not need individual log entries.
      sequence = 1;
      for (const Model of Object.values(models)) {
        await Model.updateMany({employeeId}, {$set:{organizationId, revision:sequence}}, {session});
      }
      if(state)await models.state.updateOne({employeeId},{$unset:{'data.notifications':''}},{session});
      metadata = await Metadata.findOneAndUpdate(scope, {$set:{epoch:crypto.randomUUID(), sequence, logFloor:sequence}}, {returnDocument:'after', session}).lean();
    });
  } finally { await session.endSession(); }
  return metadata;
}

async function pull(employeeId, organizationId, cursor, limit = 100) {
  const scope = scopeFor(employeeId, organizationId);
  const metadata = await ensureReady(employeeId, organizationId);
  limit = Math.min(100, Math.max(1, Math.floor(Number(limit) || 100)));
  let position = cursor ? decode(cursor, scope, metadata.epoch) : null;
  const reset = !position || position.sequence < metadata.logFloor || position.sequence > metadata.sequence;
  if (reset) position = {...scope, organizationId:String(organizationId), epoch:metadata.epoch, mode:'bootstrap', sequence:metadata.sequence, kind:0, after:''};
  if (position.mode === 'bootstrap') {
    const kind = kinds[position.kind];
    const query = {...scope, revision:{$lte:position.sequence}};
    if (kind !== 'state') { query.deletedAt = null; query.entityId = {$gt:position.after}; }
    const rows = await models[kind].find(query).sort(kind === 'state' ? {_id:1} : {entityId:1}).limit(limit + 1).lean();
    const page = boundedPage(rows,limit);
    const more = rows.length > page.length;
    const changes = page.map(row => ({kind, entityId:kind === 'state' ? '__state__' : row.entityId, revision:row.revision, deleted:false, data:row.data}));
    let next;
    if (more) next = {...position, after:page.at(-1).entityId};
    else if (position.kind < kinds.length - 1) next = {...position, kind:position.kind + 1, after:''};
    else next = {...position, mode:'delta'};
    return {success:true, reset, bootstrap:true, bootstrapComplete:next.mode === 'delta', changes, cursor:encode(next), hasMore:true};
  }
  const rows = await Change.find({...scope, sequence:{$gt:position.sequence}}).sort({sequence:1}).limit(limit + 1).lean();
  const page = boundedPage(rows,limit);
  return {success:true, reset:false, bootstrap:false, changes:page.map(row => ({kind:row.kind, entityId:row.entityId, revision:row.sequence, deleted:row.deleted, data:row.data})), cursor:encode({...position, sequence:page.at(-1)?.sequence || position.sequence}), hasMore:rows.length > page.length};
}

async function push(employeeId, organizationId, rawOperations, {admin = false} = {}) {
  const operations = validateOperations(rawOperations);
  const scope = scopeFor(employeeId, organizationId);
  await ensureReady(employeeId, organizationId);
  const session = await mongoose.startSession();
  let results, metadata;
  try {
    await session.withTransaction(async () => {
      results = [];
      metadata = await Metadata.findOneAndUpdate(scope, {$inc:{mutationLock:1}}, {returnDocument:'after', session}).lean();
      for (const op of operations) {
        const previousReceipt = await Receipt.findOne({...scope, operationId:op.operationId}).session(session).lean();
        const requestHash=crypto.createHash('sha256').update(JSON.stringify(op)).digest('hex');
        if (previousReceipt) {
          if(previousReceipt.requestHash!==requestHash)throw error('Operation ID was reused with a different payload.',409);
          const current=await models[op.kind].findOne(op.kind==='state'?scope:{...scope,entityId:op.entityId}).session(session).lean();
          results.push({...previousReceipt.result,revision:current?.revision||previousReceipt.result.revision,deleted:!current||!!current.deletedAt,data:current?.deletedAt?null:current?.data||null}); continue;
        }
        const Model = models[op.kind];
        const query = op.kind === 'state' ? scope : {...scope, entityId:op.entityId};
        const existing = await Model.findOne(query).session(session).lean();
        let data = op.kind==='state'?op.data:{...op.data,id:op.entityId};
        let rejected = false;
        if(admin&&op.kind==='lead'&&!op.deleted&&op.adminPatch)data={...existing?.data,...op.adminPatch};
        if(op.kind==='followUp'&&!admin) {
          const parentId=String(data?.leadId||existing?.leadId||'');
          const parent=parentId?await models.lead.findOne({...scope,entityId:parentId}).session(session).lean():null;
          if(parent?.deletedAt || Object.hasOwn(parent?.adminOverrides||{},'followUps'))rejected=true;
        }
        // Admin-owned fields and permanent deletions always take precedence over offline edits.
        if (op.kind === 'lead' && !admin) {
          if (existing?.permanentlyDeleted) rejected = true;
          if (!op.deleted) {
            const cleaners = require('./entitySyncService');
            data = cleaners.cleanInvestorRecord(cleaners.cleanVerificationRecord({...data, id:op.entityId}));
            if (data.recordType === 'customer_verification' || data.leadType === 'Investor Program') {
              const org = await Organization.findById(organizationId).select('category').session(session).lean();
              if (data.recordType === 'customer_verification' && org?.category !== 'electronics_sales') throw error('Verification category not allowed.',403);
              if (data.leadType === 'Investor Program' && org?.category !== 'investor_program') throw error('Investor category not allowed.',403);
            }
            data = {...data, ...(existing?.adminOverrides || {})};
          }
        }
        // A stale client cannot overwrite a concurrently edited record. Return its current value.
        const conflict = !admin && Number(existing?.revision || 0) !== op.baseRevision;
        if (conflict || rejected) {
          const result = {operationId:op.operationId, conflict:true, kind:op.kind, entityId:op.entityId, revision:existing?.revision || 0, deleted:!existing || !!existing.deletedAt, data:existing?.data || null};
          results.push(result);
          // Conflicts are not receipted: a rebased retry uses a new operation ID.
          continue;
        }
        if (!op.deleted && op.kind === 'state') {
          data=require('./entitySyncService').singletonData(data);
          const draftLeadId=data.activeLeadSession?.draftLeadId;
          if(draftLeadId) {
            const parent=await models.lead.findOne({...scope,entityId:draftLeadId}).session(session).lean();
            if(parent?.deletedAt){data.activeLeadSession=null;data.activeSessionRoute=null;}
          }
          const user = await User.findOne(scope).select('-password').session(session).lean();
          const org=await Organization.findById(organizationId).select('category name').session(session).lean();
          if (user) data = {...data, user:{...(data.user || {}), name:user.fullName, empId:employeeId, email:user.email, phone:user.phone, role:user.role, city:user.city,area:user.area,department:user.department,joiningDate:user.joiningDate,organizationCategory:org?.category||'general',organizationName:org?.name||'',profilePhotoUrl:user.profilePhotoUrl}};
          data = {...data, notifications:undefined, lastSyncedAtMs:Date.now()};
        }
        metadata.sequence++;
        const revision = metadata.sequence;
        const update = {revision, deletedAt:op.deleted ? new Date() : null};
        if (!op.deleted) update.data = data;
        if (op.kind === 'followUp') update.leadId = String(data?.leadId || existing?.leadId || '');
        if (op.kind === 'lead' && admin) { update.permanentlyDeleted = op.deleted; if (!op.deleted) update.adminOverrides = {...existing?.adminOverrides, ...(op.adminPatch||{})}; }
        await Model.updateOne(query, {$set:update}, {upsert:true, session});
        const change = {...scope, sequence:revision, kind:op.kind, entityId:op.entityId, deleted:op.deleted, data:op.deleted ? null : data};
        await Change.create([change], {session});
        const result = {operationId:op.operationId, conflict:false, kind:op.kind, entityId:op.entityId, revision, deleted:op.deleted, data:op.deleted ? null : data};
        await Receipt.create([{...scope, operationId:op.operationId, requestHash, result:{...result,data:undefined}}], {session});
        results.push(result);
        if(op.kind==='lead'&&admin&&!op.deleted&&Object.hasOwn(op.adminPatch||{},'brand')&&!Object.hasOwn(op.adminPatch||{},'followUps')) {
          const children=await models.followUp.find({...scope,leadId:op.entityId,deletedAt:null}).session(session).lean();
          for(const child of children) {
            metadata.sequence++;
            const childData={...child.data,leadBrand:data.brand};
            await models.followUp.updateOne({_id:child._id},{$set:{data:childData,revision:metadata.sequence}},{session});
            await Change.create([{...scope,sequence:metadata.sequence,kind:'followUp',entityId:child.entityId,deleted:false,data:childData}],{session});
          }
        }
        if (op.kind === 'lead' && op.deleted) {
          const activeState=await models.state.findOne(scope).session(session).lean();
          if(activeState?.data?.activeLeadSession?.draftLeadId===op.entityId) {
            metadata.sequence++;
            const stateData={...activeState.data,activeLeadSession:null,activeSessionRoute:null};
            await models.state.updateOne(scope,{$set:{data:stateData,revision:metadata.sequence}},{session});
            await Change.create([{...scope,sequence:metadata.sequence,kind:'state',entityId:'__state__',deleted:false,data:stateData}],{session});
          }
          const children = await models.followUp.find({...scope, leadId:op.entityId, deletedAt:null}).session(session).lean();
          for (const child of children) {
            metadata.sequence++;
            await models.followUp.updateOne({_id:child._id}, {$set:{deletedAt:new Date(), revision:metadata.sequence}}, {session});
            await Change.create([{...scope, sequence:metadata.sequence, kind:'followUp', entityId:child.entityId, deleted:true, data:null}], {session});
          }
        }
      }
      await Metadata.updateOne(scope, {$set:{sequence:metadata.sequence}, $inc:{version:1}}, {session});
    });
  } finally { await session.endSession(); }
  emitEmployeeEvent(organizationId, employeeId, 'app-data-changed', {version:metadata.sequence, protocol:2});
  emitAppDataUpdate({...scope, version:metadata.sequence, source:'record-sync',changedKinds:[...new Set(operations.flatMap(op=>op.kind==='lead'?['lead','followUp','state']:[op.kind]))]});
  return {success:true, results};
}

async function updateUserState(employeeId, organizationId, userPatch) {
  await ensureReady(employeeId, organizationId);
  const state = await models.state.findOne(scopeFor(employeeId, organizationId)).lean();
  return push(employeeId, organizationId, [{operationId:crypto.randomUUID(), kind:'state', entityId:'__state__', baseRevision:state?.revision || 0, deleted:false, data:{...state?.data, user:{...state?.data?.user, ...userPatch}}}], {admin:true});
}

async function ingestLegacyDelta(employeeId, organizationId, delta) {
  await ensureReady(employeeId, organizationId);
  const operations=[];
  const add=async(kind,entityId,data,deleted=false)=>{
    const row=await models[kind].findOne(kind==='state'?scopeFor(employeeId,organizationId):{...scopeFor(employeeId,organizationId),entityId}).lean();
    if(!deleted&&same(row?.data,data))return;
    operations.push({operationId:crypto.randomUUID(),kind,entityId,baseRevision:row?.revision||0,deleted,data});
  };
  if(delta.state) {
    const {notifications=[],...state}=delta.state;
    await add('state','__state__',state);
    for(const notice of notifications)await add('notification',idForNotification(notice),notice);
  }
  for(const [kind,upserts,deletes,idOf] of [
    ['lead',delta.upsertLeads,delta.deleteLeadIds,row=>row.id],
    ['followUp',delta.upsertFollowUps,delta.deleteFollowUpIds,row=>row.id],
    ['activity',delta.upsertActivities,delta.deleteActivityIds,require('./entitySyncService').activityId],
  ]) {
    for(const row of upserts||[])await add(kind,idOf(row),row);
    for(const id of deletes||[])await add(kind,id,null,true);
  }
  for(let index=0;index<operations.length;index+=100)await push(employeeId,organizationId,operations.slice(index,index+100));
  const metadata=await Metadata.findOne(scopeFor(employeeId,organizationId)).lean();
  return {version:metadata.version,snapshot:await require('./entitySyncService').buildNormalizedSnapshot(employeeId)};
}
async function ingestLegacySnapshot(employeeId,snapshot,organizationId) {
  const scope=scopeFor(employeeId,organizationId);
  const current=await require('./entitySyncService').buildNormalizedSnapshot(employeeId);
  const ids=items=>new Set((items||[]).map(item=>item.id));
  const state=require('./entitySyncService').singletonData(snapshot);
  return ingestLegacyDelta(employeeId,organizationId,{
    state,upsertLeads:snapshot.leads||[],upsertFollowUps:snapshot.followUps||[],upsertActivities:snapshot.activityLog||[],
    deleteLeadIds:(current?.leads||[]).filter(item=>!ids(snapshot.leads).has(item.id)).map(item=>item.id),
    deleteFollowUpIds:(current?.followUps||[]).filter(item=>!ids(snapshot.followUps).has(item.id)).map(item=>item.id),
    deleteActivityIds:[],
  });
}

async function editLead(employeeId,leadId,values,deleted=false) {
  const user=await User.findOne({employeeId}).select('organizationId').lean();
  if(!user)return null;
  const org=user.organizationId;
  await ensureReady(employeeId,org);
  const row=await models.lead.findOne({...scopeFor(employeeId,org),entityId:leadId,deletedAt:null}).lean();
  if(!row)return null;
  const operations=[{operationId:crypto.randomUUID(),kind:'lead',entityId:leadId,baseRevision:row.revision,deleted,data:{...row.data,...values},adminPatch:values}];
  if(!deleted&&Object.hasOwn(values,'followUps')) {
    const before=await models.followUp.find({...scopeFor(employeeId,org),leadId,deletedAt:null}).lean();
    for(const child of before)if(!(values.followUps||[]).some(item=>item.id===child.entityId))operations.push({operationId:crypto.randomUUID(),kind:'followUp',entityId:child.entityId,baseRevision:child.revision,deleted:true});
    for(const child of values.followUps||[])operations.push({operationId:crypto.randomUUID(),kind:'followUp',entityId:child.id,baseRevision:0,deleted:false,data:{...child,leadId,leadBrand:values.brand||row.data.brand}});
  }
  await push(employeeId,org,operations,{admin:true});
  return deleted?row.data:{...row.data,...values};
}

module.exports = {ingestLegacyDelta, ingestLegacySnapshot, editLead, pull, push, ensureReady, validateOperations, decode, encode, idForNotification, updateUserState, models, same};
