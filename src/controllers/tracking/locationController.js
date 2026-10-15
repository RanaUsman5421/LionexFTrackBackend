const distanceSummary = require('../../services/tracking/distanceSummaryService');
const { getMatchedRoute } = require('../../services/tracking/roadMatchingService');
const {
  canAccessEmployee,
  createTrackingSession,
  getCurrentLocationForEmployee,
  getCurrentLocations,
  getLocationHistory,
  storeHistoryLocation,
  storeHistoryBatch,
  touchCurrentLocation,
  touchTrackingSession,
  upsertCurrentLocationIfNewer,
  validateLocationPayload,
  validateHeartbeatPayload,
} = require('../../services/tracking/locationService');
const { emitLocationUpdate } = require('../../services/realtime/socketService');
const { getVerificationGate, publicChallenge, wasTimestampVerificationBlocked } = require('../../services/tracking/verificationService');
const LocationHistory = require('../../models/tracking/LocationHistory');
const User = require('../../models/organization/User');
const { hasPermission } = require('../../utils/access/adminPermissions');

const leaderboardCache = new Map();
const LEADERBOARD_CACHE_MS = 60_000;
const invalidateLeaderboard = (organizationId) => leaderboardCache.delete(String(organizationId || ''));

const rejectWhenVerificationRequired = async (req, res) => {
  const gate = await getVerificationGate(req.user.employeeId);
  if (!gate.blocked) return false;
  res.status(423).json({
    success: false,
    code: 'VERIFICATION_REQUIRED',
    message: 'Biometric verification is required before tracking can continue.',
    challenge: publicChallenge(gate.challenge),
  });
  return true;
};

const serializeCurrent = (doc) => {
  if (!doc) return null;
  return {
    employeeId: doc.employeeId,
    latitude: doc.location?.coordinates?.[1] ?? null,
    longitude: doc.location?.coordinates?.[0] ?? null,
    accuracy: doc.accuracy,
    speed: doc.speed,
    heading: doc.heading,
    altitude: doc.altitude,
    batteryPercentage: doc.batteryPercentage,
    timestamp: doc.timestamp,
    locationCapturedAt: doc.locationCapturedAt || doc.timestamp,
    lastSeenAt: doc.lastSeenAt,
    trackingStatus: doc.trackingStatus,
    sessionStatus: doc.sessionStatus,
    updatedAt: doc.updatedAt,
  };
};

const formatPayload = (employeeId, locationDoc, organizationId) => ({
  organizationId,
  employeeId,
  latitude: locationDoc.location.coordinates[1],
  longitude: locationDoc.location.coordinates[0],
  accuracy: locationDoc.accuracy,
  speed: locationDoc.speed,
  heading: locationDoc.heading,
  altitude: locationDoc.altitude,
  batteryPercentage: locationDoc.batteryPercentage,
  timestamp: locationDoc.timestamp,
  locationCapturedAt: locationDoc.locationCapturedAt || locationDoc.timestamp,
  lastSeenAt: locationDoc.lastSeenAt || locationDoc.timestamp,
  trackingStatus: locationDoc.trackingStatus,
  sessionStatus: locationDoc.sessionStatus,
});

const submitLocation = async (req, res) => {
  try {
    if (await rejectWhenVerificationRequired(req, res)) return;
    const validated = validateLocationPayload(req.body || {});
    if (!validated.valid) {
      return res.status(400).json({ success: false, message: validated.message });
    }

    if (!validated.data.clientLocationId) {
      return res.status(400).json({ success: false, message: 'clientLocationId is required.' });
    }
    if (await wasTimestampVerificationBlocked(req.user.employeeId, validated.data.timestamp)) {
      return res.status(422).json({
        success: false,
        code: 'LOCATION_DURING_VERIFICATION_LOCK',
        message: 'Location was captured while tracking was locked for verification.',
      });
    }

    const employeeId = req.user.employeeId;
    const historyDoc = await storeHistoryLocation(employeeId, validated.data, req.organizationId);
    await distanceSummary.dirty(req.organizationId, employeeId, [{timestamp:validated.data.timestamp}]);
    if (historyDoc) invalidateLeaderboard(req.organizationId);
    const currentDoc = await upsertCurrentLocationIfNewer(employeeId, validated.data, 'active', req.organizationId);
    await touchTrackingSession(employeeId, validated.data.timestamp);

    if (currentDoc && currentDoc.timestamp && currentDoc.timestamp.getTime() === validated.data.timestamp.getTime()) {
      emitLocationUpdate(formatPayload(employeeId, currentDoc, req.organizationId));
    }

    return res.status(201).json({
      success: true,
      message: historyDoc ? 'Location stored successfully.' : 'Location already processed.',
      location: serializeCurrent(currentDoc),
      duplicate: !historyDoc,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to store location.' });
  }
};

const submitLocationBulk = async (req, res) => {
  try {
    if (await rejectWhenVerificationRequired(req, res)) return;
    const locations = Array.isArray(req.body?.locations) ? req.body.locations : [];
    if (!locations.length) {
      return res.status(400).json({ success: false, message: 'locations array is required.' });
    }

    const employeeId = req.user.employeeId;
    const processed = [];
    const rejected = [];

    if(locations.length>1000)return res.status(400).json({success:false,message:'At most 1000 locations may be submitted per batch.'});
    const valid=[];
    for(const item of locations){
      const parsed=validateLocationPayload(item);
      if(!parsed.valid||!parsed.data.clientLocationId){rejected.push({clientLocationId:item?.clientLocationId||'',reason:parsed.message||'clientLocationId is required.'});continue;}
      valid.push(parsed.data);
    }
    if(valid.length){
      const times=valid.map(row=>row.timestamp.getTime());
      const intervals=await require('../../models/tracking/VerificationChallenge').find({employeeId,status:'verified',verifiedLate:true,
        expiresAt:{$lte:new Date(Math.max(...times))},verifiedAt:{$gte:new Date(Math.min(...times))}}).select('expiresAt verifiedAt').lean();
      const accepted=[];
      for(const row of valid){
        if(intervals.some(interval=>row.timestamp>=interval.expiresAt&&row.timestamp<=interval.verifiedAt)){
          processed.push(row.clientLocationId);rejected.push({clientLocationId:row.clientLocationId,reason:'Captured during biometric verification lock.'});
        }else accepted.push(row);
      }
      const stored=await storeHistoryBatch(employeeId,accepted,req.organizationId);
      // Confirm actual stored identities, never infer success from a bulk write attempt.
      processed.push(...stored.map(row=>row.clientLocationId));
      if(stored.length){
        await distanceSummary.dirty(req.organizationId,employeeId,stored);
        invalidateLeaderboard(req.organizationId);
        const last=stored.at(-1);
        const latest={...last,latitude:last.location.coordinates[1],longitude:last.location.coordinates[0]};
        const current=await upsertCurrentLocationIfNewer(employeeId,latest,'active',req.organizationId);
        await touchTrackingSession(employeeId,last.timestamp);
        if(current&&current.timestamp.getTime()===last.timestamp.getTime())emitLocationUpdate(formatPayload(employeeId,current,req.organizationId));
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Bulk location sync complete.',
      processed,
      rejected,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to process bulk locations.' });
  }
};

const getCurrentLocationsController = async (req, res) => {
  try {
    const employeeId = req.params.employeeId;
    if (employeeId) {
      if (!await canAccessEmployee(req.user, employeeId)) {
        return res.status(403).json({ success: false, message: 'Not authorized to view this employee.' });
      }

      const current = await getCurrentLocationForEmployee(employeeId);
      return res.status(200).json({ success: true, current: serializeCurrent(current) });
    }

    if (!await canAccessEmployee(req.user, req.user.employeeId)) {
      return res.status(403).json({ success: false, message: 'Not authorized.' });
    }

    const requestedIds = String(req.query.employeeIds || '').split(',').map((value) => value.trim()).filter(Boolean).slice(0, 200);
    if (requestedIds.length && !(String(req.user.role || '').toLowerCase().includes('manager') || String(req.user.role || '').toLowerCase().includes('admin'))) {
      return res.status(403).json({ success: false, message: 'Not authorized to request team locations.' });
    }
    const currentLocations = await getCurrentLocations(req.organizationId, requestedIds);
    const filtered = String(req.user.role || '').toLowerCase().includes('manager') || String(req.user.role || '').toLowerCase().includes('admin')
      ? currentLocations
      : currentLocations.filter((item) => item.employeeId === req.user.employeeId);

    return res.status(200).json({
      success: true,
      locations: filtered.map(serializeCurrent),
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to fetch current locations.' });
  }
};

const getHistoryController = async (req, res) => {
  try {
    const { employeeId } = req.params;
    if (!await canAccessEmployee(req.user, employeeId)) {
      return res.status(403).json({ success: false, message: 'Not authorized to view this history.' });
    }

    const matching = req.query.roadMatch === 'true';
    if (matching) {
      const from = new Date(req.query.from), to = new Date(req.query.to);
      if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || to < from || to-from > 32*60*60*1000) {
        return res.status(400).json({success:false,message:'Select a valid single-day range for road matching.'});
      }
      res.set('Cache-Control', 'no-store');
    }
    const history = await getLocationHistory(employeeId, req.query);
    const roadRoute = matching ? await getMatchedRoute(history.map(item => ({
      latitude:item.location.coordinates[1], longitude:item.location.coordinates[0],
      accuracy:item.accuracy, timestamp:item.timestamp, trackingSessionId:item.trackingSessionId
    })), [String(req.organizationId), employeeId]) : undefined;
    return res.status(200).json({
      success: true,
      ...(roadRoute ? {roadRoute} : {}),
      history: history.map((item) => ({
        clientLocationId: item.clientLocationId,
        trackingSessionId: item.trackingSessionId || null,
        employeeId: item.employeeId,
        latitude: item.location.coordinates[1],
        longitude: item.location.coordinates[0],
        accuracy: item.accuracy,
        speed: item.speed,
        heading: item.heading,
        altitude: item.altitude,
        batteryPercentage: item.batteryPercentage,
        timestamp: item.timestamp,
        networkType: item.networkType,
      })),
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to fetch history.' });
  }
};

const getDistanceLeaderboardController = async (req, res) => {
  try {
    if (req.principalType !== 'admin' || !hasPermission(req.user, 'tracking.read')) {
      return res.status(403).json({ success: false, message: 'Not authorized to view distance rankings.' });
    }
    const limit = Math.min(10, Math.max(1, Number(req.query.limit) || 4));
    const cacheKey = String(req.organizationId);
    const cached = leaderboardCache.get(cacheKey);
    if (cached && Date.now() - cached.createdAt < LEADERBOARD_CACHE_MS) {
      return res.json({ success: true, leaders: cached.leaders.slice(0, limit) });
    }

    const totals=await distanceSummary.travelSummaries(req.organizationId);
    const ranked=totals.sort((a,b)=>b.distanceKm-a.distanceKm).slice(0,10).map(row=>[row.employeeId,row.distanceKm]);
    const employeeIds = ranked.map(([employeeId]) => employeeId);
    const employees = await User.find({ organizationId: req.organizationId, employeeId: { $in: employeeIds } })
      .select('employeeId fullName username role profilePhotoUrl')
      .lean();
    const employeeById = new Map(employees.map((employee) => [employee.employeeId, employee]));
    const leaders = ranked.map(([employeeId, totalDistanceKm]) => {
      const employee = employeeById.get(employeeId) || {};
      return {
        employeeId,
        fullName: employee.fullName || employee.username || employeeId,
        role: employee.role || 'Employee',
        profilePhotoUrl: employee.profilePhotoUrl || '',
        totalDistanceKm: Number(totalDistanceKm.toFixed(2)),
      };
    });
    if (leaders.length < 10) {
      const zeroDistanceEmployees = await User.find({
        organizationId: req.organizationId,
        employeeId: { $nin: employeeIds },
        approvalStatus: 'approved',
        accountStatus: 'active',
      })
        .select('employeeId fullName username role profilePhotoUrl')
        .sort({ createdAt: 1 })
        .limit(10 - leaders.length)
        .lean();
      leaders.push(...zeroDistanceEmployees.map((employee) => ({
        employeeId: employee.employeeId,
        fullName: employee.fullName || employee.username || employee.employeeId,
        role: employee.role || 'Employee',
        profilePhotoUrl: employee.profilePhotoUrl || '',
        totalDistanceKm: 0,
      })));
    }
    leaderboardCache.set(cacheKey, { createdAt: Date.now(), leaders });
    return res.json({ success: true, leaders: leaders.slice(0, limit) });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to calculate distance rankings.' });
  }
};

const heartbeatLocation = async (req, res) => {
  try {
    if (await rejectWhenVerificationRequired(req, res)) return;
    const validated = validateHeartbeatPayload(req.body || {});
    if (!validated.valid) {
      return res.status(400).json({ success: false, message: validated.message });
    }

    const employeeId = req.user.employeeId;
    const currentDoc = await touchCurrentLocation(employeeId, validated.data, 'active', req.organizationId);
    const session = (await touchTrackingSession(employeeId, validated.data.timestamp)) || await createTrackingSession(employeeId, validated.data, req.organizationId);

    if (currentDoc) {
      emitLocationUpdate({
        organizationId: req.organizationId,
        employeeId,
        latitude: currentDoc.location.coordinates[1],
        longitude: currentDoc.location.coordinates[0],
        accuracy: currentDoc.accuracy,
        speed: currentDoc.speed,
        heading: currentDoc.heading,
        altitude: currentDoc.altitude,
        batteryPercentage: currentDoc.batteryPercentage,
        timestamp: currentDoc.timestamp,
        locationCapturedAt: currentDoc.locationCapturedAt || currentDoc.timestamp,
        lastSeenAt: currentDoc.lastSeenAt,
        trackingStatus: currentDoc.trackingStatus,
        sessionStatus: currentDoc.sessionStatus,
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Heartbeat recorded.',
      current: serializeCurrent(currentDoc),
      session,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to record heartbeat.' });
  }
};

const getDistanceSummaryController = async(req,res)=>{
  try {
    const employeeId=req.params.employeeId;
    if(!await canAccessEmployee(req.user,employeeId))return res.status(403).json({success:false,message:'Not authorized.'});
    const from=new Date(req.query.from),to=new Date(req.query.to);
    if(!Number.isFinite(from.getTime())||!Number.isFinite(to.getTime())||to<from||to-from>366*86400000)return res.status(400).json({success:false,message:'Select a valid date range.'});
    const rows=await distanceSummary.travelSummaries(req.organizationId,{employeeId,from,to,utcDays:false});
    return res.json({success:true,distanceKm:rows.reduce((sum,row)=>sum+row.distanceKm,0),points:rows.reduce((sum,row)=>sum+row.points,0)});
  }catch(error){return res.status(500).json({success:false,message:'Unable to load distance summary.'});}
};

module.exports = {
  submitLocation,
  submitLocationBulk,
  getCurrentLocationsController,
  getDistanceLeaderboardController,
  getHistoryController,
  getDistanceSummaryController,
  heartbeatLocation,
};
