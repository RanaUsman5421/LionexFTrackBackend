// Read-only legacy input. No Mongoose snapshot model or runtime snapshot writes.
const mongoose = require('mongoose');
const crypto = require('crypto');
const collection = () => mongoose.connection.db.collection('appsnapshots');
const fingerprint = value => crypto.createHash('sha256').update(mongoose.mongo.BSON.EJSON.stringify(value)).digest('hex');
const maps = value => value instanceof Map ? Object.fromEntries(value) : value || {};

function chooseRecord(row, previous, sourceTime, importedTime) {
  const newerSource = sourceTime > importedTime && sourceTime >= new Date(previous?.updatedAt || 0).getTime();
  const chosen = !previous || newerSource ? {...row} : {...previous};
  if (Object.hasOwn(row,'adminOverrides')) {
    chosen.adminOverrides = {...row.adminOverrides,...previous?.adminOverrides};
    chosen.permanentlyDeleted = !!(row.permanentlyDeleted || previous?.permanentlyDeleted);
    chosen.data = {...chosen.data,...chosen.adminOverrides};
    if (chosen.permanentlyDeleted) chosen.deletedAt = chosen.deletedAt || new Date();
  }
  return chosen;
}

function planSnapshot(snapshot) {
  const {singletonData, activityId} = require('./entitySyncService');
  const {idForNotification} = require('./recordSyncService');
  const deleted = new Set(snapshot.deletedLeadIds || []);
  const overrides = maps(snapshot.leadAdminOverrides);
  const records = {lead:new Map(), followUp:new Map(), activity:new Map(), notification:new Map()};
  const put = (kind, id, data, extra = {}) => {
    id = String(id || '').trim();
    if (!id) throw new Error(`Migration: ${kind} record has no identity.`);
    records[kind].set(id, {entityId:id, data:{...data, id}, deletedAt:null, ...extra});
  };
  for (const lead of snapshot.leads || []) {
    const override = overrides[lead.id] || {};
    const data = {...lead, ...override};
    put('lead', lead.id, data, {adminOverrides:override, permanentlyDeleted:deleted.has(lead.id), deletedAt:deleted.has(lead.id) ? new Date(0) : null});
    for (const child of data.followUps || []) put('followUp', child.id, {...child, leadId:lead.id, leadBrand:data.brand}, {leadId:lead.id});
  }
  for (const child of snapshot.followUps || []) {
    if (Object.hasOwn(overrides[child.leadId] || {}, 'followUps')) continue;
    put('followUp', child.id, child, {leadId:String(child.leadId || '')});
  }
  for (const [id, override] of Object.entries(overrides)) {
    if (!records.lead.has(id)) records.lead.set(id, {entityId:id, data:{id,...override}, adminOverrides:override, deletedAt:new Date(0), permanentlyDeleted:deleted.has(id)});
  }
  for (const id of deleted) {
    const row = records.lead.get(id) || {entityId:id,data:{id},adminOverrides:{}};
    records.lead.set(id, {...row, deletedAt:new Date(0), permanentlyDeleted:true});
  }
  for (const [id, child] of records.followUp) if (deleted.has(child.leadId)) records.followUp.set(id, {...child,deletedAt:new Date(0)});
  for (const item of snapshot.activityLog || []) put('activity', activityId(item), item);
  for (const item of snapshot.notifications || []) put('notification', idForNotification(item), item);
  const state = singletonData(snapshot);
  delete state.notifications;
  if (deleted.has(state.activeLeadSession?.draftLeadId)) { state.activeLeadSession = null; state.activeSessionRoute = null; }
  return {state,records};
}

async function importEmployee(employeeId, organizationId, session) {
  const snapshot = await collection().findOne({employeeId}, {session});
  const {models} = require('./recordSyncService');
  if (!snapshot || snapshot.recordMigration?.complete) {
    await models.state.updateOne({employeeId}, {$setOnInsert:{organizationId,data:{}}}, {upsert:true,session});
    return;
  }
  const user = await require('../../models/organization/User').findOne({employeeId}).session(session).lean();
  const existingState = await models.state.findOne({employeeId}).session(session).lean();
  const owner = user?.organizationId || snapshot.organizationId || existingState?.organizationId || null;
  if (String(owner) !== String(organizationId || null)) throw new Error('Snapshot migration organization mismatch.');
  const {state,records} = planSnapshot(snapshot);
  const metadata = await require('../../models/sync/AppSyncMetadata').findOne({employeeId}).session(session).lean();
  // Already-normalized rows can be newer than the legacy document: never replace those.
  const sourceTime = new Date(snapshot.updatedAt || snapshot.lastSyncedAt || 0).getTime();
  const importedTime = new Date(metadata?.lastLegacyUpdatedAt || 0).getTime();
  const importState = !existingState || (sourceTime > importedTime && sourceTime >= new Date(existingState.updatedAt || 0).getTime());
  if (importState) await models.state.updateOne({employeeId}, {$set:{organizationId,data:state}}, {upsert:true,session});
  for (const [kind, entries] of Object.entries(records)) {
    if (!entries.size) continue;
    const previousRows = await models[kind].find({employeeId,entityId:{$in:[...entries.keys()]}}).session(session).lean();
    const previousById = new Map(previousRows.map(row=>[row.entityId,row]));
    const expected = new Map();
    const operations = [];
    for (const [entityId,row] of entries) {
      const chosen = chooseRecord(row,previousById.get(entityId),sourceTime,importedTime);
      expected.set(entityId,chosen);
      const update = {organizationId,data:chosen.data,deletedAt:chosen.deletedAt};
      if (kind === 'lead') Object.assign(update,{adminOverrides:chosen.adminOverrides,permanentlyDeleted:chosen.permanentlyDeleted});
      if (kind === 'followUp') update.leadId = chosen.leadId;
      operations.push({updateOne:{filter:{employeeId,entityId},update:{$set:update},upsert:true}});
    }
    await models[kind].bulkWrite(operations,{session,ordered:true});
    const written = await models[kind].find({employeeId,entityId:{$in:[...entries.keys()]}}).session(session).lean();
    if (written.length !== expected.size) throw new Error(`Migration record count failed: ${kind}.`);
    for (const row of written) {
      const chosen = expected.get(row.entityId);
      if (fingerprint(row.data) !== fingerprint(chosen.data) || !!row.deletedAt !== !!chosen.deletedAt) throw new Error(`Migration verification failed: ${kind}.`);
    }
  }
  // Deleted parents must not leave live children or an active draft behind.
  const removed = await models.lead.find({employeeId,permanentlyDeleted:true}).session(session).lean();
  if (removed.length) await models.followUp.updateMany({employeeId,leadId:{$in:removed.map(row=>row.entityId)}}, {$set:{deletedAt:new Date()}}, {session});
  const finalState = await models.state.findOne({employeeId}).session(session).lean();
  if (removed.some(row=>row.entityId === finalState?.data?.activeLeadSession?.draftLeadId)) {
    await models.state.updateOne({employeeId}, {$set:{'data.activeLeadSession':null,'data.activeSessionRoute':null}}, {session});
  }
  await collection().updateOne({_id:snapshot._id}, {$set:{recordMigration:{complete:true,at:new Date(),sourceHash:fingerprint(snapshot)}}}, {session});
}

async function migrateAll({fullScan=false} = {}) {
  const {ensureReady,models} = require('./recordSyncService');
  const ids = new Set(await collection().distinct('employeeId', {'recordMigration.complete':{$ne:true}}));
  const pending = await require('../../models/sync/AppSyncMetadata').find({epoch:null}).select('employeeId').lean();
  for (const row of pending) ids.add(row.employeeId);
  // Explicit migration audits discover record-only legacy users. Normal startup
  // does not scan growing history collections after migration has completed.
  if (fullScan) for (const Model of Object.values(models)) for (const id of await Model.distinct('employeeId')) ids.add(id);
  let migrated = 0, unowned = 0;
  for (const employeeId of ids) {
    if (!employeeId) throw new Error('Legacy data has no employee identity; migration stopped.');
    const user = await require('../../models/organization/User').findOne({employeeId}).select('organizationId').lean();
    const legacy = await collection().findOne({employeeId}, {projection:{organizationId:1,recordMigration:1}});
    const state = await models.state.findOne({employeeId}).select('organizationId').lean();
    const org = user?.organizationId || legacy?.organizationId || state?.organizationId || null;
    if (!org) unowned++;
    await ensureReady(employeeId,org);
    migrated++;
  }
  return {employees:migrated,unowned};
}

module.exports = {planSnapshot,chooseRecord,importEmployee,migrateAll,fingerprint,collection};
