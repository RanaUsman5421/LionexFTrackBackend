const EmployeeCurrentLocation = require('../../models/tracking/EmployeeCurrentLocation');
const LocationHistory = require('../../models/tracking/LocationHistory');
const TrackingSession = require('../../models/tracking/TrackingSession');
const { canAccessEmployee } = require('../../utils/access/tenantAccess');

const MAX_ACCURACY_METERS = 5000;

const normalizeTimestamp = (value) => {
  const timestamp = value ? new Date(value) : new Date();
  return Number.isNaN(timestamp.getTime()) ? null : timestamp;
};

const validateLocationPayload = (payload) => {
  const trackingSessionId = payload.trackingSessionId == null ? null : String(payload.trackingSessionId).trim();
  if (trackingSessionId !== null && !/^[A-Za-z0-9_-]{1,80}$/.test(trackingSessionId)) {
    return {valid:false,message:'Invalid tracking session ID.'};
  }
  const latitude = Number(payload.latitude);
  const longitude = Number(payload.longitude);
  const accuracy = payload.accuracy === undefined || payload.accuracy === null ? null : Number(payload.accuracy);
  const timestamp = normalizeTimestamp(payload.timestamp);

  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    return { valid: false, message: 'Invalid latitude.' };
  }

  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    return { valid: false, message: 'Invalid longitude.' };
  }

  if (!timestamp) {
    return { valid: false, message: 'Invalid timestamp.' };
  }

  if (accuracy !== null && (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > MAX_ACCURACY_METERS)) {
    return { valid: false, message: 'Invalid accuracy value.' };
  }

  return {
    valid: true,
    data: {
      trackingSessionId,
      clientLocationId: String(payload.clientLocationId || '').trim(),
      latitude,
      longitude,
      accuracy,
      speed: payload.speed === undefined || payload.speed === null ? null : Number(payload.speed),
      heading: payload.heading === undefined || payload.heading === null ? null : Number(payload.heading),
      altitude: payload.altitude === undefined || payload.altitude === null ? null : Number(payload.altitude),
      timestamp,
      batteryPercentage: payload.batteryPercentage === undefined || payload.batteryPercentage === null ? null : Number(payload.batteryPercentage),
      networkType: String(payload.networkType || ''),
    },
  };
};

const validateHeartbeatPayload = (payload) => {
  const latitude = Number(payload.latitude);
  const longitude = Number(payload.longitude);
  const accuracy = payload.accuracy === undefined || payload.accuracy === null ? null : Number(payload.accuracy);
  const timestamp = normalizeTimestamp(payload.timestamp);

  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    return { valid: false, message: 'Invalid latitude.' };
  }

  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    return { valid: false, message: 'Invalid longitude.' };
  }

  if (!timestamp) {
    return { valid: false, message: 'Invalid timestamp.' };
  }

  if (accuracy !== null && (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > MAX_ACCURACY_METERS)) {
    return { valid: false, message: 'Invalid accuracy value.' };
  }

  const captured = payload.locationCapturedAt ? normalizeTimestamp(payload.locationCapturedAt) : null;
  if (payload.locationCapturedAt && (!captured || captured > new Date(timestamp.getTime()+30000))) return {valid:false,message:'Invalid GPS capture time.'};
  return {
    valid: true,
    data: {
      locationCapturedAt: captured,
      latitude,
      longitude,
      accuracy,
      speed: payload.speed === undefined || payload.speed === null ? null : Number(payload.speed),
      heading: payload.heading === undefined || payload.heading === null ? null : Number(payload.heading),
      altitude: payload.altitude === undefined || payload.altitude === null ? null : Number(payload.altitude),
      timestamp,
      batteryPercentage: payload.batteryPercentage === undefined || payload.batteryPercentage === null ? null : Number(payload.batteryPercentage),
      networkType: String(payload.networkType || ''),
    },
  };
};

const buildHistoryDocument = (employeeId, location, organizationId) => ({
  organizationId,
  employeeId,
  clientLocationId: location.clientLocationId,
  trackingSessionId: location.trackingSessionId || null,
  location: {
    type: 'Point',
    coordinates: [location.longitude, location.latitude],
  },
  accuracy: location.accuracy,
  speed: location.speed,
  heading: location.heading,
  altitude: location.altitude,
  timestamp: location.timestamp,
  batteryPercentage: location.batteryPercentage,
  networkType: location.networkType,
});

// Atomic conditional updates keep concurrent heartbeat/offline uploads from
// replacing a newer fix. timestamp retains its historical GPS-capture meaning.
const updateCurrent = async (employeeId, location, sessionStatus, organizationId, heartbeat) => {
  const captured = heartbeat ? location.locationCapturedAt : location.timestamp;
  const seen = heartbeat ? location.timestamp : new Date(Math.min(Date.now(),location.timestamp.getTime()));
  const newer = captured ? {$gt:[captured,{$ifNull:['$locationCapturedAt',{$ifNull:['$timestamp',new Date(0)]}]}]} : {$literal:false};
  const fields={employeeId:{$literal:employeeId},...(organizationId ? {organizationId:{$literal:EmployeeCurrentLocation.schema.path('organizationId').cast(organizationId)}} : {}),
    lastSeenAt:{$max:[{$ifNull:['$lastSeenAt',new Date(0)]},seen]},
    trackingStatus:{$literal:sessionStatus==='stopped'?'TRACKING_STOPPED':'ACTIVE'},sessionStatus:{$literal:sessionStatus}};
  // An old app's heartbeat has no capture time. It may update liveness only.
  for(const [field,value] of Object.entries({location:{type:'Point',coordinates:[location.longitude,location.latitude]},
    timestamp:captured,locationCapturedAt:captured,accuracy:location.accuracy,speed:location.speed,heading:location.heading,altitude:location.altitude})) {
    fields[field]={$cond:[newer,{$literal:value},'$'+field]};
  }
  if(Number.isFinite(location.batteryPercentage))fields.batteryPercentage={$cond:[{$gte:[seen,{$ifNull:['$lastSeenAt',new Date(0)]}]},location.batteryPercentage,'$batteryPercentage']};
  if(heartbeat && !captured) {
    // Do not create a coordinate-less row from an older heartbeat client.
    return EmployeeCurrentLocation.findOneAndUpdate({employeeId,...(organizationId?{organizationId}:{})},[{$set:fields}],{returnDocument:'after',updatePipeline:true});
  }
  try {
    return await EmployeeCurrentLocation.findOneAndUpdate({employeeId,...(organizationId?{organizationId}:{})},[{$set:fields}],{upsert:true,returnDocument:'after',updatePipeline:true});
  }catch(error){
    if(error.code!==11000)throw error;
    return EmployeeCurrentLocation.findOneAndUpdate({employeeId,...(organizationId?{organizationId}:{})},[{$set:fields}],{returnDocument:'after',updatePipeline:true});
  }
};
const upsertCurrentLocationIfNewer = (employeeId,location,sessionStatus='active',organizationId) => updateCurrent(employeeId,location,sessionStatus,organizationId,false);
const touchCurrentLocation = (employeeId,location,sessionStatus='active',organizationId) => updateCurrent(employeeId,location,sessionStatus,organizationId,true);

const storeHistoryLocation = async (employeeId, location, organizationId) => {
  try {
    return await LocationHistory.create(buildHistoryDocument(employeeId, location, organizationId));
  } catch (error) {
    if (error.code === 11000) {
      return null;
    }
    throw error;
  }
};

const storeHistoryBatch = async (employeeId, rows, organizationId) => {
  if (!rows.length) return [];
  const unique=[...new Map(rows.map(row=>[row.clientLocationId,row])).values()];
  try {
    await LocationHistory.bulkWrite(unique.map(row=>({updateOne:{
      filter:{employeeId,clientLocationId:row.clientLocationId},
      update:{$setOnInsert:buildHistoryDocument(employeeId,row,organizationId)},upsert:true,timestamps:false
    }})),{ordered:false});
  } catch(error) {
    if(error.code!==11000 || error.writeErrors?.some(item=>item.code!==11000))throw error;
  }
  return LocationHistory.find({organizationId,employeeId,clientLocationId:{$in:unique.map(row=>row.clientLocationId)}}).sort({timestamp:1,_id:1}).lean();
};

const createTrackingSession = async (employeeId, location, organizationId) => {
  const active = await TrackingSession.findOne({ employeeId, status: 'active' }).sort({ startedAt: -1 });
  if (active) {
    return active;
  }

  return TrackingSession.create({
    organizationId,
    employeeId,
    startedAt: location.timestamp,
    lastHeartbeatAt: location.timestamp,
    startLocation: {
      latitude: location.latitude,
      longitude: location.longitude,
    },
    status: 'active',
  });
};

const touchTrackingSession = async (employeeId, timestamp = new Date()) => {
  return TrackingSession.findOneAndUpdate(
    { employeeId, status: 'active' },
    { $max: { lastHeartbeatAt: timestamp } },
    { sort: { startedAt: -1 }, new: true }
  );
};

const stopTrackingSession = async (employeeId, location) => {
  return TrackingSession.findOneAndUpdate(
    { employeeId, status: 'active' },
    {
      endedAt: location?.timestamp || new Date(),
      lastHeartbeatAt: location?.timestamp || new Date(),
      status: 'stopped',
      endLocation: location
        ? { latitude: location.latitude, longitude: location.longitude }
        : undefined,
    },
    { sort: { startedAt: -1 }, new: true }
  );
};

const setCurrentTrackingStatus = async (employeeId, trackingStatus) => {
  return EmployeeCurrentLocation.findOneAndUpdate(
    { employeeId },
    {
      $set: {
        trackingStatus,
        sessionStatus: 'stopped',
        lastSeenAt: new Date(),
      },
    },
    { new: true }
  );
};

const getCurrentLocationForEmployee = async (employeeId) => {
  return EmployeeCurrentLocation.findOne({ employeeId }).lean();
};

const getCurrentLocations = async (organizationId, employeeIds = []) => {
  const query = organizationId ? { organizationId } : {};
  if (employeeIds.length) query.employeeId = { $in: employeeIds };
  return EmployeeCurrentLocation.find(query).sort({ updatedAt: -1 }).limit(500).lean();
};

const getLocationHistory = async (employeeId, { from, to, limit = 100 }) => {
  const query = { employeeId };
  if (from || to) {
    query.timestamp = {};
    if (from) query.timestamp.$gte = new Date(from);
    if (to) query.timestamp.$lte = new Date(to);
  }

  return LocationHistory.find(query)
    .sort({ timestamp: 1 })
    .limit(Math.min(Number(limit) || 100, 20000))
    .lean();
};

module.exports = {
  canAccessEmployee,
  validateLocationPayload,
  validateHeartbeatPayload,
  normalizeTimestamp,
  upsertCurrentLocationIfNewer,
  touchCurrentLocation,
  storeHistoryLocation,
  storeHistoryBatch,
  createTrackingSession,
  touchTrackingSession,
  stopTrackingSession,
  setCurrentTrackingStatus,
  getCurrentLocationForEmployee,
  getCurrentLocations,
  getLocationHistory,
};
