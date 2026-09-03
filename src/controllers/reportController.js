const User = require('../models/User');
const LocationHistory = require('../models/LocationHistory');
const EmployeeCurrentLocation = require('../models/EmployeeCurrentLocation');
const TrackingSession = require('../models/TrackingSession');
const LeadRecord = require('../models/LeadRecord');
const FollowUpRecord = require('../models/FollowUpRecord');
const ActivityRecord = require('../models/ActivityRecord');
const VerificationChallenge = require('../models/VerificationChallenge');
const { hasPermission } = require('../utils/adminPermissions');

const MAX_ROWS = 500;
const REPORT_CACHE_TTL_MS = 60_000;
const REPORT_CACHE_LIMIT = 100;
const reportCache = new Map();
const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const text = (value, fallback = '') => String(value ?? fallback);
const radians = (value) => value * Math.PI / 180;
const haversineKm = (a, b) => {
  const dLat = radians(b.latitude - a.latitude);
  const dLng = radians(b.longitude - a.longitude);
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(value)));
};
const dateRange = (req) => {
  const from = new Date(req.query.from);
  const to = new Date(req.query.to);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) return null;
  if (to - from > 366 * 86400000) return null;
  return { from, to };
};
const GROUP_BY_VALUES = new Set(['summary', 'day', 'week', 'month', 'detailed']);
const normalizeGroupBy = (value) => GROUP_BY_VALUES.has(value) ? value : 'detailed';
const isPeriodGrouping = (groupBy) => ['day', 'week', 'month'].includes(groupBy);
const periodStart = (value, groupBy) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  if (groupBy === 'week') start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  if (groupBy === 'month') start.setUTCDate(1);
  return start.toISOString().slice(0, 10);
};
const periodColumn = { key: 'period', label: 'Period', format: 'date' };
const employeeDirectory = async (organizationId, employeeIds = []) => {
  if (!employeeIds.length) return new Map();
  const query = { organizationId };
  query.employeeId = { $in: employeeIds };
  const users = await User.find(query).select('employeeId fullName username role city area accountStatus approvalStatus').limit(MAX_ROWS + 1).lean();
  return new Map(users.map((user) => [user.employeeId, user]));
};
const identity = (directory, employeeId) => {
  const user = directory.get(employeeId) || {};
  return { employeeId, employee: user.fullName || user.username || employeeId, role: user.role || 'Employee', city: user.city || '', area: user.area || '' };
};
const response = (type, title, range, columns, rows, summary = [], extra = {}) => ({
  type, title, available: true, from: range.from, to: range.to, columns, rows: rows.slice(0, MAX_ROWS), summary,
  meta: { totalRows: rows.length, truncated: rows.length > MAX_ROWS }, ...extra,
});
const unavailable = (type, title, range, reason) => ({ type, title, available: false, reason, from: range.from, to: range.to, columns: [], rows: [], summary: [], meta: { totalRows: 0, truncated: false } });

const travelRows = async (organizationId, range, employeeId, groupBy) => {
  const metrics = new Map();
  const previous = new Map();
  const locationQuery = { organizationId, timestamp: { $gte: range.from, $lte: range.to } };
  if (employeeId) locationQuery.employeeId = employeeId;
  const cursor = LocationHistory.find(locationQuery)
    .select('employeeId location.coordinates timestamp -_id').sort({ timestamp: 1 }).lean().cursor({ batchSize: 1000 });
  for await (const point of cursor) {
    const coordinates = point.location?.coordinates;
    const latitude = Number(coordinates?.[1]);
    const longitude = Number(coordinates?.[0]);
    const current = { latitude, longitude, timestamp: new Date(point.timestamp), day: new Date(point.timestamp).toISOString().slice(0, 10) };
    if (!point.employeeId || !Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
    const period = isPeriodGrouping(groupBy) ? periodStart(current.timestamp, groupBy) : '';
    const metricKey = period ? `${point.employeeId}\u0000${period}` : point.employeeId;
    const metric = metrics.get(metricKey) || { employeeId: point.employeeId, period, distanceKm: 0, points: 0, firstSeen: null, lastSeen: null };
    const prior = previous.get(point.employeeId);
    if (prior && prior.day === current.day) {
      const segment = haversineKm(prior, current);
      if (Number.isFinite(segment) && segment <= 20) metric.distanceKm += segment;
    }
    metric.points += 1;
    metric.firstSeen ||= current.timestamp;
    metric.lastSeen = current.timestamp;
    metrics.set(metricKey, metric);
    previous.set(point.employeeId, current);
  }
  const ranked = [...metrics.values()].sort((left, right) => left.period && right.period ? left.period.localeCompare(right.period) || right.distanceKm - left.distanceKm : right.distanceKm - left.distanceKm).slice(0, MAX_ROWS + 1);
  const directory = await employeeDirectory(organizationId, [...new Set(ranked.map((metric) => metric.employeeId))]);
  return ranked.map((metric) => ({ ...identity(directory, metric.employeeId), ...(metric.period ? { period: metric.period } : {}), distanceKm: Number(metric.distanceKm.toFixed(2)), points: metric.points, firstSeen: metric.firstSeen, lastSeen: metric.lastSeen }));
};

const buildTravelReport = async (type, organizationId, range, req, employeeId, groupBy) => {
  const rows = await travelRows(organizationId, range, employeeId, groupBy);
  const totalDistance = rows.reduce((sum, row) => sum + row.distanceKm, 0);
  const efficiency = Math.max(1, Math.min(200, number(req.query.kmPerLiter) || 50));
  const fuelPrice = Math.max(0, number(req.query.fuelPrice));
  const fuelRows = rows.map((row) => ({ ...row, liters: Number((row.distanceKm / efficiency).toFixed(2)), fuelCost: Number((row.distanceKm / efficiency * fuelPrice).toFixed(2)), costPerKm: fuelPrice ? Number((fuelPrice / efficiency).toFixed(2)) : 0 }));
  if (type === 'fuel_cost' && !fuelPrice) return unavailable(type, 'Fuel Cost Report', range, 'Enter a fuel price to calculate cost.');
  const titles = { distance: 'Distance Report', route_history: 'Route History Report', petrol_consumption: 'Petrol Consumption Report', fuel_cost: 'Fuel Cost Report', cost_per_km: 'Cost per Kilometer Report', cost_per_employee: 'Cost per Employee Report' };
  const fuelType = !['distance', 'route_history'].includes(type);
  const periodColumns = isPeriodGrouping(groupBy) ? [periodColumn] : [];
  const columns = fuelType
    ? [...periodColumns, { key: 'employee', label: 'Employee' }, { key: 'employeeId', label: 'Employee ID' }, { key: 'distanceKm', label: 'Distance', format: 'km' }, { key: 'liters', label: 'Petrol', format: 'liters' }, ...(fuelPrice ? [{ key: 'fuelCost', label: 'Fuel Cost', format: 'currency' }, { key: 'costPerKm', label: 'Cost / km', format: 'currency' }] : [])]
    : [...periodColumns, { key: 'employee', label: 'Employee' }, { key: 'employeeId', label: 'Employee ID' }, { key: 'distanceKm', label: 'Distance', format: 'km' }, { key: 'points', label: 'GPS Points' }, { key: 'firstSeen', label: 'First Point', format: 'datetime' }, { key: 'lastSeen', label: 'Last Point', format: 'datetime' }];
  return response(type, titles[type], range, columns, fuelType ? fuelRows : rows, [
    { label: 'Employees', value: rows.length }, { label: 'Total distance', value: Number(totalDistance.toFixed(2)), format: 'km' },
    ...(fuelType ? [{ label: 'Petrol consumed', value: Number((totalDistance / efficiency).toFixed(2)), format: 'liters' }] : []),
    ...(fuelPrice ? [{ label: 'Estimated cost', value: Number((totalDistance / efficiency * fuelPrice).toFixed(2)), format: 'currency' }] : []),
  ]);
};

const buildWorkforceReport = async (type, organizationId, range, employeeId, groupBy) => {
  const sessionQuery = { organizationId, startedAt: { $lte: range.to }, $or: [{ endedAt: null }, { endedAt: { $gte: range.from } }] };
  if (employeeId) sessionQuery.employeeId = employeeId;
  const metrics = new Map();
  const sessionCursor = TrackingSession.find(sessionQuery).select('employeeId startedAt endedAt lastHeartbeatAt -_id').sort({ startedAt: 1 }).lean().cursor({ batchSize: 1000 });
  for await (const session of sessionCursor) {
    const start = new Date(Math.max(new Date(session.startedAt).getTime(), range.from.getTime()));
    const end = new Date(Math.min(new Date(session.endedAt || session.lastHeartbeatAt || range.to).getTime(), range.to.getTime()));
    const period = isPeriodGrouping(groupBy) ? periodStart(session.startedAt, groupBy) : '';
    const metricKey = period ? `${session.employeeId}\u0000${period}` : session.employeeId;
    const row = metrics.get(metricKey) || { employeeId: session.employeeId, period, dutyMs: 0, fieldDays: new Set(), sessions: 0, lateStarts: 0, overtimeMs: 0 };
    const duration = Math.max(0, end - start);
    row.dutyMs += duration; row.sessions += 1; row.fieldDays.add(new Date(session.startedAt).toISOString().slice(0, 10));
    if (new Date(session.startedAt).getHours() >= 10) row.lateStarts += 1;
    row.overtimeMs += Math.max(0, duration - 8 * 3600000);
    metrics.set(metricKey, row);
  }
  const rankedMetrics = [...metrics.values()].sort((left, right) => left.period && right.period ? left.period.localeCompare(right.period) || right.dutyMs - left.dutyMs : right.dutyMs - left.dutyMs).slice(0, MAX_ROWS + 1);
  const directory = await employeeDirectory(organizationId, [...new Set(rankedMetrics.map((metric) => metric.employeeId))]);
  const rows = rankedMetrics.map((metric) => ({ ...identity(directory, metric.employeeId), ...(metric.period ? { period: metric.period } : {}), dutyMs: metric.dutyMs, fieldDays: metric.fieldDays.size, sessions: metric.sessions, lateStarts: metric.lateStarts, overtimeMs: metric.overtimeMs }));
  const titles = { employee_performance: 'Employee Performance Report', attendance: 'Attendance Report', duty_hours: 'Duty Hours Report', overtime: 'Overtime Report', late_start_early_stop: 'Late Start / Early Stop Report', productivity: 'Productivity Report' };
  return response(type, titles[type], range, [...(isPeriodGrouping(groupBy) ? [periodColumn] : []), { key: 'employee', label: 'Employee' }, { key: 'employeeId', label: 'Employee ID' }, { key: 'fieldDays', label: 'Field Days' }, { key: 'sessions', label: 'Sessions' }, { key: 'dutyMs', label: 'Duty Time', format: 'duration' }, { key: 'overtimeMs', label: 'Overtime', format: 'duration' }, { key: 'lateStarts', label: 'Late Starts' }], rows, [{ label: 'Employees', value: new Set(rows.map((row) => row.employeeId)).size }, { label: 'Field days', value: rows.reduce((sum, row) => sum + row.fieldDays, 0) }, { label: 'Duty hours', value: Number((rows.reduce((sum, row) => sum + row.dutyMs, 0) / 3600000).toFixed(1)) }]);
};

const buildFieldReport = async (type, organizationId, range, employeeId, groupBy) => {
  const query = { organizationId, deletedAt: null, createdAt: { $gte: range.from, $lte: range.to } };
  if (employeeId) query.employeeId = employeeId;
  if (['leads', 'lead_conversion', 'area_performance'].includes(type)) {
    if (groupBy === 'detailed') {
      const documents = await LeadRecord.find(query).sort({ createdAt: -1 }).limit(MAX_ROWS + 1).lean();
      const directory = await employeeDirectory(organizationId, [...new Set(documents.map((row) => row.employeeId))]);
      const rows = documents.map((row) => ({ ...identity(directory, row.employeeId), brand: text(row.data?.brand || row.data?.name, 'Untitled lead'), status: text(row.data?.status, 'New'), leadType: text(row.data?.leadType || row.data?.type), createdAt: row.createdAt }));
      const totalRegistered = rows.filter((row) => row.status === 'Registered').length;
      return response(type, type === 'leads' ? 'Leads Report' : type === 'lead_conversion' ? 'Lead Conversion Report' : 'Area-wise Performance Report', range, [{ key: 'brand', label: 'Lead' }, { key: 'employee', label: 'Employee' }, { key: 'area', label: 'Area' }, { key: 'status', label: 'Status' }, { key: 'leadType', label: 'Type' }, { key: 'createdAt', label: 'Created', format: 'datetime' }], rows, [{ label: 'Total leads', value: rows.length }, { label: 'Registered', value: totalRegistered }, { label: 'Conversion', value: rows.length ? Number((totalRegistered / rows.length * 100).toFixed(1)) : 0, format: 'percent' }]);
    }
    const grouped = new Map();
    const employeeIds = new Set();
    let totalLeads = 0;
    let totalRegistered = 0;
    const cursor = LeadRecord.find(query).select('employeeId data.status createdAt -_id').sort({ createdAt: 1 }).lean().cursor({ batchSize: 1000 });
    for await (const document of cursor) {
      const period = isPeriodGrouping(groupBy) ? periodStart(document.createdAt, groupBy) : '';
      const key = `${document.employeeId}\u0000${period}`;
      const item = grouped.get(key) || { employeeId: document.employeeId, ...(period ? { period } : {}), total: 0, registered: 0 };
      item.total += 1;
      totalLeads += 1;
      if (text(document.data?.status) === 'Registered') { item.registered += 1; totalRegistered += 1; }
      employeeIds.add(document.employeeId);
      grouped.set(key, item);
    }
    const directory = await employeeDirectory(organizationId, [...employeeIds]);
    const rows = [...grouped.values()].map((row) => ({ ...identity(directory, row.employeeId), ...row, conversion: row.total ? Number((row.registered / row.total * 100).toFixed(1)) : 0 })).sort((a, b) => (a.period || '').localeCompare(b.period || '') || b.total - a.total);
    const columns = [...(isPeriodGrouping(groupBy) ? [periodColumn] : []), { key: 'employee', label: 'Employee' }, { key: 'area', label: 'Area' }, { key: 'total', label: 'Total Leads' }, { key: 'registered', label: 'Registered' }, { key: 'conversion', label: 'Conversion', format: 'percent' }];
    return response(type, type === 'leads' ? 'Leads Report' : type === 'lead_conversion' ? 'Lead Conversion Report' : 'Area-wise Performance Report', range, columns, rows, [{ label: 'Total leads', value: totalLeads }, { label: 'Registered', value: totalRegistered }, { label: 'Conversion', value: totalLeads ? Number((totalRegistered / totalLeads * 100).toFixed(1)) : 0, format: 'percent' }]);
  }
  const Model = type === 'follow_ups' ? FollowUpRecord : ActivityRecord;
  if (groupBy === 'detailed') {
    let documents = await Model.find(query).sort({ createdAt: -1 }).limit(MAX_ROWS + 1).lean();
    if (type === 'meetings_visits') documents = documents.filter((row) => /meeting|visit/i.test(text(row.data?.type || row.data?.title || row.data?.activityType)));
    const directory = await employeeDirectory(organizationId, [...new Set(documents.map((row) => row.employeeId))]);
    const rows = documents.map((row) => ({ ...identity(directory, row.employeeId), activity: text(row.data?.title || row.data?.type || row.data?.activityType, type === 'follow_ups' ? 'Follow-up' : 'Activity'), status: text(row.data?.status || row.data?.result), notes: text(row.data?.notes || row.data?.description), createdAt: row.createdAt }));
    return response(type, type === 'follow_ups' ? 'Follow-up Report' : type === 'meetings_visits' ? 'Meetings / Visits Report' : 'Activity Report', range, [{ key: 'employee', label: 'Employee' }, { key: 'employeeId', label: 'Employee ID' }, { key: 'activity', label: 'Activity' }, { key: 'status', label: 'Status' }, { key: 'notes', label: 'Notes' }, { key: 'createdAt', label: 'Created', format: 'datetime' }], rows, [{ label: 'Records', value: rows.length }, { label: 'Employees', value: new Set(rows.map((row) => row.employeeId)).size }]);
  }
  const grouped = new Map();
  const employeeIds = new Set();
  let totalRecords = 0;
  const cursor = Model.find(query).select('employeeId data createdAt -_id').sort({ createdAt: 1 }).lean().cursor({ batchSize: 1000 });
  for await (const document of cursor) {
    if (type === 'meetings_visits' && !/meeting|visit/i.test(text(document.data?.type || document.data?.title || document.data?.activityType))) continue;
    const period = isPeriodGrouping(groupBy) ? periodStart(document.createdAt, groupBy) : '';
    const key = `${document.employeeId}\u0000${period}`;
    const item = grouped.get(key) || { employeeId: document.employeeId, ...(period ? { period } : {}), records: 0 };
    item.records += 1;
    totalRecords += 1;
    employeeIds.add(document.employeeId);
    grouped.set(key, item);
  }
  const directory = await employeeDirectory(organizationId, [...employeeIds]);
  const rows = [...grouped.values()].map((row) => ({ ...identity(directory, row.employeeId), ...row })).sort((a, b) => (a.period || '').localeCompare(b.period || '') || b.records - a.records);
  const columns = [...(isPeriodGrouping(groupBy) ? [periodColumn] : []), { key: 'employee', label: 'Employee' }, { key: 'employeeId', label: 'Employee ID' }, { key: 'records', label: 'Records' }];
  return response(type, type === 'follow_ups' ? 'Follow-up Report' : type === 'meetings_visits' ? 'Meetings / Visits Report' : 'Activity Report', range, columns, rows, [{ label: 'Records', value: totalRecords }, { label: 'Employees', value: employeeIds.size }]);
};

const buildSecurityReport = async (type, organizationId, range, employeeId, groupBy) => {
  if (type === 'suspicious_activity') return unavailable(type, 'Suspicious Activity Report', range, 'Suspicious-event scoring is not available in the current data model.');
  if (type === 'blocked_accounts') {
    const userQuery = { organizationId, accountStatus: { $in: ['blocked', 'inactive'] } };
    if (employeeId) userQuery.employeeId = employeeId;
    const users = await User.find(userQuery).select('employeeId fullName username role accountStatus updatedAt').limit(MAX_ROWS + 1).lean();
    const rows = users.map((user) => ({ employee: user.fullName || user.username, employeeId: user.employeeId, role: user.role, status: user.accountStatus, updatedAt: user.updatedAt }));
    return response(type, 'Blocked / Inactive Accounts Report', range, [{ key: 'employee', label: 'Employee' }, { key: 'employeeId', label: 'Employee ID' }, { key: 'role', label: 'Role' }, { key: 'status', label: 'Status' }, { key: 'updatedAt', label: 'Updated', format: 'datetime' }], rows, [{ label: 'Accounts', value: rows.length }]);
  }
  if (type === 'tracking_interruptions') {
    const locationQuery = { organizationId, trackingStatus: { $in: ['GPS_DISABLED', 'TRACKING_STOPPED', 'VERIFICATION_REQUIRED', 'OFFLINE'] } };
    if (employeeId) locationQuery.employeeId = employeeId;
    const locations = await EmployeeCurrentLocation.find(locationQuery).limit(MAX_ROWS + 1).lean();
    const directory = await employeeDirectory(organizationId, locations.map((row) => row.employeeId));
    const rows = locations.map((row) => ({ ...identity(directory, row.employeeId), status: row.trackingStatus, lastSeenAt: row.lastSeenAt || row.updatedAt }));
    return response(type, 'Tracking Interruptions Report', range, [{ key: 'employee', label: 'Employee' }, { key: 'employeeId', label: 'Employee ID' }, { key: 'status', label: 'Tracking Status' }, { key: 'lastSeenAt', label: 'Last Seen', format: 'datetime' }], rows, [{ label: 'Interruptions', value: rows.length }]);
  }
  const query = { organizationId, scheduledAt: { $gte: range.from, $lte: range.to } };
  if (employeeId) query.employeeId = employeeId;
  if (type === 'missed_verification') query.status = 'missed';
  if (groupBy === 'detailed') {
    const challenges = await VerificationChallenge.find(query).sort({ scheduledAt: -1 }).limit(MAX_ROWS + 1).lean();
    const directory = await employeeDirectory(organizationId, [...new Set(challenges.map((row) => row.employeeId))]);
    const rows = challenges.map((row) => ({ ...identity(directory, row.employeeId), status: row.status, scheduledAt: row.scheduledAt, attempts: row.attempts, verifiedLate: row.verifiedLate ? 'Yes' : 'No' }));
    return response(type, type === 'missed_verification' ? 'Missed Verification Report' : 'Verification & Compliance Report', range, [{ key: 'employee', label: 'Employee' }, { key: 'employeeId', label: 'Employee ID' }, { key: 'status', label: 'Status' }, { key: 'scheduledAt', label: 'Scheduled', format: 'datetime' }, { key: 'attempts', label: 'Attempts' }, { key: 'verifiedLate', label: 'Verified Late' }], rows, [{ label: 'Checks', value: rows.length }, { label: 'Verified', value: rows.filter((row) => row.status === 'verified').length }, { label: 'Missed', value: rows.filter((row) => row.status === 'missed').length }]);
  }
  const grouped = new Map();
  const employeeIds = new Set();
  const totals = { checks: 0, verified: 0, missed: 0 };
  const cursor = VerificationChallenge.find(query).select('employeeId status scheduledAt attempts -_id').sort({ scheduledAt: 1 }).lean().cursor({ batchSize: 1000 });
  for await (const challenge of cursor) {
    const period = isPeriodGrouping(groupBy) ? periodStart(challenge.scheduledAt, groupBy) : '';
    const key = `${challenge.employeeId}\u0000${period}`;
    const item = grouped.get(key) || { employeeId: challenge.employeeId, ...(period ? { period } : {}), checks: 0, verified: 0, missed: 0, attempts: 0 };
    item.checks += 1;
    item.verified += challenge.status === 'verified' ? 1 : 0;
    item.missed += challenge.status === 'missed' ? 1 : 0;
    item.attempts += number(challenge.attempts);
    totals.checks += 1;
    totals.verified += challenge.status === 'verified' ? 1 : 0;
    totals.missed += challenge.status === 'missed' ? 1 : 0;
    employeeIds.add(challenge.employeeId);
    grouped.set(key, item);
  }
  const directory = await employeeDirectory(organizationId, [...employeeIds]);
  const rows = [...grouped.values()].map((row) => ({ ...identity(directory, row.employeeId), ...row })).sort((a, b) => (a.period || '').localeCompare(b.period || '') || b.checks - a.checks);
  const columns = [...(isPeriodGrouping(groupBy) ? [periodColumn] : []), { key: 'employee', label: 'Employee' }, { key: 'employeeId', label: 'Employee ID' }, { key: 'checks', label: 'Checks' }, { key: 'verified', label: 'Verified' }, { key: 'missed', label: 'Missed' }, { key: 'attempts', label: 'Attempts' }];
  return response(type, type === 'missed_verification' ? 'Missed Verification Report' : 'Verification & Compliance Report', range, columns, rows, [{ label: 'Checks', value: totals.checks }, { label: 'Verified', value: totals.verified }, { label: 'Missed', value: totals.missed }]);
};

const getReport = async (req, res) => {
  try {
    if (req.principalType !== 'admin' || !hasPermission(req.user, 'reports.read')) return res.status(403).json({ success: false, message: 'Not authorized to view reports.' });
    const range = dateRange(req);
    if (!range) return res.status(400).json({ success: false, message: 'A valid date range of up to 366 days is required.' });
    const type = text(req.query.type).trim();
    const groupBy = normalizeGroupBy(text(req.query.groupBy).trim());
    const employeeId = text(req.query.employeeId).trim().slice(0, 100);
    if (employeeId && !await User.exists({ organizationId: req.organizationId, employeeId })) return res.status(404).json({ success: false, message: 'Employee not found in this organization.' });
    const cacheKey = [req.organizationId, type, employeeId, groupBy, range.from.toISOString(), range.to.toISOString(), req.query.kmPerLiter || '', req.query.fuelPrice || ''].join('|');
    const cached = reportCache.get(cacheKey);
    if (cached && Date.now() - cached.createdAt < REPORT_CACHE_TTL_MS) return res.json({ success: true, report: cached.report, cached: true });
    const travel = ['distance', 'route_history', 'petrol_consumption', 'fuel_cost', 'cost_per_km', 'cost_per_employee'];
    const workforce = ['employee_performance', 'attendance', 'duty_hours', 'overtime', 'late_start_early_stop', 'productivity'];
    const field = ['leads', 'lead_conversion', 'follow_ups', 'meetings_visits', 'activity', 'area_performance'];
    const security = ['verification', 'missed_verification', 'tracking_interruptions', 'suspicious_activity', 'blocked_accounts'];
    let report;
    if (travel.includes(type)) report = await buildTravelReport(type, req.organizationId, range, req, employeeId, groupBy);
    else if (workforce.includes(type)) report = await buildWorkforceReport(type, req.organizationId, range, employeeId, groupBy);
    else if (field.includes(type)) report = await buildFieldReport(type, req.organizationId, range, employeeId, groupBy);
    else if (security.includes(type)) report = await buildSecurityReport(type, req.organizationId, range, employeeId, groupBy);
    else if (type === 'live_tracking' || type === 'area_coverage') {
      const locationQuery = { organizationId: req.organizationId };
      if (employeeId) locationQuery.employeeId = employeeId;
      const locations = await EmployeeCurrentLocation.find(locationQuery).sort({ updatedAt: -1 }).limit(MAX_ROWS).lean();
      const directory = await employeeDirectory(req.organizationId, locations.map((row) => row.employeeId));
      const rows = locations.map((row) => ({ ...identity(directory, row.employeeId), status: row.trackingStatus, latitude: row.location?.coordinates?.[1], longitude: row.location?.coordinates?.[0], lastSeenAt: row.lastSeenAt || row.updatedAt }));
      report = response(type, type === 'live_tracking' ? 'Live Tracking Summary' : 'Location / Area Coverage Report', range, [{ key: 'employee', label: 'Employee' }, { key: 'employeeId', label: 'Employee ID' }, { key: 'area', label: 'Area' }, { key: 'city', label: 'City' }, { key: 'status', label: 'Status' }, { key: 'lastSeenAt', label: 'Last Seen', format: 'datetime' }], rows, [{ label: 'Employees located', value: rows.length }, { label: 'Active', value: rows.filter((row) => row.status === 'ACTIVE').length }]);
    } else report = unavailable(type, 'Report', range, 'This report is not available yet.');
    report = { ...report, groupBy };
    if (employeeId && Array.isArray(report.rows)) {
      const scopedRows = report.rows.filter((row) => text(row.employeeId).trim() === employeeId);
      const removedForeignRows = scopedRows.length !== report.rows.length;
      report = {
        ...report,
        rows: scopedRows,
        summary: removedForeignRows ? [] : report.summary,
        meta: { ...report.meta, employeeId, totalRows: scopedRows.length, truncated: false },
      };
    }
    reportCache.set(cacheKey, { createdAt: Date.now(), report });
    if (reportCache.size > REPORT_CACHE_LIMIT) reportCache.delete(reportCache.keys().next().value);
    return res.json({ success: true, report });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to build report.' });
  }
};

const listReportEmployees = async (req, res) => {
  try {
    if (req.principalType !== 'admin' || !hasPermission(req.user, 'reports.read')) return res.status(403).json({ success: false, message: 'Not authorized to view reports.' });
    const search = text(req.query.search).trim().slice(0, 80);
    const query = { organizationId: req.organizationId, approvalStatus: 'approved' };
    if (search) query.$text = { $search: search };
    const users = await User.find(query).select('employeeId fullName username role area city').sort(search ? { score: { $meta: 'textScore' } } : { fullName: 1 }).limit(50).lean();
    return res.json({ success: true, employees: users.map((user) => ({ employeeId: user.employeeId, fullName: user.fullName || user.username || user.employeeId, role: user.role || 'Employee', area: user.area || user.city || '' })) });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to load report employees.' });
  }
};

module.exports = { getReport, listReportEmployees };
