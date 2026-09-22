const crypto = require('crypto');
const mongoose = require('mongoose');
const Organization = require('../models/Organization');
const User = require('../models/User');
const Doctor = require('../models/Doctor');
const PharmaProduct = require('../models/PharmaProduct');
const SampleInventory = require('../models/SampleInventory');
const SampleInventoryLedger = require('../models/SampleInventoryLedger');
const TourPlan = require('../models/TourPlan');
const PharmaVisit = require('../models/PharmaVisit');
const { hasPermission } = require('../utils/adminPermissions');

const text = (value, max = 500) => String(value ?? '').trim().slice(0, max);
const list = (value, max = 20) => (Array.isArray(value) ? value : []).slice(0, max).map((item) => text(item, 160)).filter(Boolean);
const objectId = (value) => String(value || '').match(/^[a-f\d]{24}$/i) ? String(value) : null;
const pageLimit = (value) => Math.min(100, Math.max(1, Number(value) || 30));
const escapeRegex = (value) => String(value || '').replace(/[.*+?^{}$()|[\]\\]/g, '\\$&');
const nextCode = (prefix) => prefix + '-' + Date.now().toString(36).toUpperCase() + '-' + crypto.randomBytes(3).toString('hex').toUpperCase();
const radians = (value) => Number(value) * Math.PI / 180;
const distanceMeters = (first = {}, second = {}) => {
  const lat1 = Number(first.latitude); const lon1 = Number(first.longitude);
  const lat2 = Number(second.latitude); const lon2 = Number(second.longitude);
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return 0;
  const dLat = radians(lat2 - lat1); const dLon = radians(lon2 - lon1);
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLon / 2) ** 2;
  return Math.round(6371000 * 2 * Math.asin(Math.min(1, Math.sqrt(value))));
};
const cleanEvidence = (evidence) => {
  const allowed = new Set(['clinicExteriorPhoto', 'sampleAcknowledgement', 'supportingDocument', 'doctorSignature', 'voiceNote']);
  return Object.fromEntries(Object.entries(evidence && typeof evidence === 'object' ? evidence : {}).filter(([key]) => allowed.has(key)).map(([key, item]) => {
    if (typeof item === 'string') return [key, /^https:\/\//i.test(item) ? item.slice(0, 2048) : ''];
    return [key, {
      url: /^https:\/\//i.test(String(item?.url || item?.remoteUrl || '')) ? String(item.url || item.remoteUrl).slice(0, 2048) : '',
      capturedAtMs: Math.max(0, Number(item?.capturedAtMs) || 0),
      latitude: Number(item?.latitude) || 0,
      longitude: Number(item?.longitude) || 0,
      accuracy: Math.max(0, Number(item?.accuracy) || 0),
    }];
  }));
};

const pharmaOrganization = async (req, res) => {
  const organization = await Organization.findById(req.organizationId).select('category settings name').lean();
  if (!organization) {
    res.status(404).json({ success: false, message: 'Organization not found.' });
    return null;
  }
  if (organization.category !== 'pharmaceutical') {
    res.status(403).json({ success: false, message: 'Pharma modules are only available to Pharmaceutical organizations.' });
    return null;
  }
  return organization;
};

const canManage = (req) => req.principalType === 'admin' && hasPermission(req.user, 'employees.manage');
const requireManager = (req, res) => {
  if (canManage(req)) return true;
  res.status(403).json({ success: false, message: 'Employee management permission required.' });
  return false;
};

const listDoctors = async (req, res) => {
  if (!await pharmaOrganization(req, res)) return;
  const query = { organizationId: req.organizationId };
  if (req.query.status) query.status = text(req.query.status, 40);
  if (req.query.territory) query.territory = text(req.query.territory, 120);
  if (req.query.search) {
    const search = new RegExp(escapeRegex(text(req.query.search, 100)), 'i');
    query.$or = [{ fullName: search }, { clinicHospitalName: search }, { specialization: search }, { pmdcNumber: search }];
  }
  const doctors = await Doctor.find(query).sort({ fullName: 1 }).limit(pageLimit(req.query.limit)).lean();
  return res.json({ success: true, doctors });
};

const createDoctor = async (req, res) => {
  const organization = await pharmaOrganization(req, res);
  if (!organization) return;
  const employeeId = req.principalType === 'admin' ? '' : text(req.user?.employeeId, 100);
  if (req.principalType === 'admin' && !requireManager(req, res)) return;
  const values = {
    organizationId: req.organizationId,
    doctorId: text(req.body?.doctorId, 80) || nextCode('DOC'),
    fullName: text(req.body?.fullName, 160),
    gender: text(req.body?.gender, 20),
    specialization: text(req.body?.specialization, 120),
    qualification: text(req.body?.qualification, 160),
    pmdcNumber: text(req.body?.pmdcNumber, 80),
    category: text(req.body?.category, 1),
    clinicHospitalName: text(req.body?.clinicHospitalName, 200),
    department: text(req.body?.department, 120),
    mobileNumber: text(req.body?.mobileNumber, 40),
    email: text(req.body?.email, 160).toLowerCase(),
    address: text(req.body?.address, 500),
    city: text(req.body?.city, 100),
    area: text(req.body?.area, 120),
    territory: text(req.body?.territory, 120),
    location: {
      latitude: Number(req.body?.location?.latitude) || 0,
      longitude: Number(req.body?.location?.longitude) || 0,
      accuracy: Math.max(0, Number(req.body?.location?.accuracy) || 0),
    },
    clinicExteriorPhotoUrl: /^https:\/\//i.test(text(req.body?.clinicExteriorPhotoUrl, 2048)) ? text(req.body.clinicExteriorPhotoUrl, 2048) : '',
    visitingDays: list(req.body?.visitingDays, 7),
    visitingHours: text(req.body?.visitingHours, 160),
    potentialLevel: text(req.body?.potentialLevel, 20) || 'Medium',
    remarks: text(req.body?.remarks, 2000),
    status: employeeId ? 'pending_review' : text(req.body?.status, 30) || 'active',
    createdByEmployeeId: employeeId,
  };
  if (!values.fullName || !values.specialization || !values.category || !values.clinicHospitalName || !values.address || !values.city || !values.territory) {
    return res.status(400).json({ success: false, message: 'Doctor name, specialization, category, clinic, address, city, and territory are required.' });
  }
  try {
    const doctor = await Doctor.create(values);
    return res.status(201).json({ success: true, message: 'Doctor profile created.', doctor });
  } catch (error) {
    return res.status(error?.code === 11000 ? 409 : 400).json({ success: false, message: error?.code === 11000 ? 'Doctor ID or PMDC number already exists.' : error.message });
  }
};

const updateDoctor = async (req, res) => {
  if (!await pharmaOrganization(req, res) || !requireManager(req, res)) return;
  const allowed = ['fullName', 'gender', 'specialization', 'qualification', 'pmdcNumber', 'category', 'clinicHospitalName', 'department', 'mobileNumber', 'email', 'address', 'city', 'area', 'territory', 'clinicExteriorPhotoUrl', 'visitingDays', 'visitingHours', 'potentialLevel', 'remarks', 'status', 'location'];
  const update = {};
  allowed.forEach((key) => { if (Object.prototype.hasOwnProperty.call(req.body || {}, key)) update[key] = req.body[key]; });
  const doctor = await Doctor.findOneAndUpdate({ _id: req.params.doctorId, organizationId: req.organizationId }, { $set: update }, { new: true, runValidators: true });
  if (!doctor) return res.status(404).json({ success: false, message: 'Doctor not found.' });
  return res.json({ success: true, message: 'Doctor profile updated.', doctor });
};

const listProducts = async (req, res) => {
  if (!await pharmaOrganization(req, res)) return;
  const query = { organizationId: req.organizationId };
  if (req.query.status) query.status = text(req.query.status, 30);
  if (req.query.search) {
    const search = new RegExp(escapeRegex(text(req.query.search, 100)), 'i');
    query.$or = [{ productName: search }, { brandName: search }, { genericName: search }, { productCode: search }];
  }
  const products = await PharmaProduct.find(query).sort({ productName: 1 }).limit(pageLimit(req.query.limit)).lean();
  return res.json({ success: true, products });
};

const listInventory = async (req, res) => {
  if (!await pharmaOrganization(req, res)) return;
  const query = { organizationId: req.organizationId };
  if (req.query.employeeId) query.employeeId = text(req.query.employeeId, 100);
  if (req.principalType !== 'admin') query.$or = [{ employeeId: req.user.employeeId }, { employeeId: '' }];
  if (objectId(req.query.productId)) query.productId = req.query.productId;
  const inventory = await SampleInventory.find(query).populate('productId', 'productCode productName brandName strength dosageForm').sort({ expiryDate: 1 }).limit(pageLimit(req.query.limit)).lean();
  return res.json({ success: true, inventory });
};

const listTourPlans = async (req, res) => {
  if (!await pharmaOrganization(req, res)) return;
  const query = { organizationId: req.organizationId };
  if (req.query.employeeId) query.employeeId = text(req.query.employeeId, 100);
  if (req.query.status) query.status = text(req.query.status, 30);
  if (req.principalType !== 'admin') query.employeeId = req.user.employeeId;
  const tourPlans = await TourPlan.find(query).populate('doctorId', 'doctorId fullName specialization clinicHospitalName territory').sort({ plannedAt: 1 }).limit(pageLimit(req.query.limit)).lean();
  return res.json({ success: true, tourPlans });
};

const createTourPlan = async (req, res) => {
  if (!await pharmaOrganization(req, res) || !requireManager(req, res)) return;
  const doctorId = objectId(req.body?.doctorId);
  const employeeId = text(req.body?.employeeId, 100);
  const plannedAt = new Date(req.body?.plannedAt);
  if (!doctorId || !employeeId || !Number.isFinite(plannedAt.getTime())) return res.status(400).json({ success: false, message: 'Doctor, employee, and planned date/time are required.' });
  const [doctor, employee] = await Promise.all([
    Doctor.findOne({ _id: doctorId, organizationId: req.organizationId }).lean(),
    User.findOne({ employeeId, organizationId: req.organizationId }).select('_id').lean(),
  ]);
  if (!doctor || !employee) return res.status(404).json({ success: false, message: 'Doctor or employee was not found in this organization.' });
  const tourPlan = await TourPlan.create({ organizationId: req.organizationId, doctorId, employeeId, plannedAt, territory: text(req.body?.territory, 120) || doctor.territory, purpose: list(req.body?.purpose), notes: text(req.body?.notes, 1000) });
  await tourPlan.populate('doctorId', 'doctorId fullName specialization clinicHospitalName territory');
  return res.status(201).json({ success: true, message: 'Tour plan created.', tourPlan });
};

const updateTourPlan = async (req, res) => {
  if (!await pharmaOrganization(req, res) || !requireManager(req, res)) return;
  const allowed = ['plannedAt', 'territory', 'purpose', 'notes', 'status', 'completedVisitId'];
  const update = {};
  allowed.forEach((key) => { if (Object.prototype.hasOwnProperty.call(req.body || {}, key)) update[key] = req.body[key]; });
  const tourPlan = await TourPlan.findOneAndUpdate({ _id: req.params.planId, organizationId: req.organizationId }, { $set: update }, { new: true, runValidators: true }).populate('doctorId', 'doctorId fullName specialization clinicHospitalName territory');
  if (!tourPlan) return res.status(404).json({ success: false, message: 'Tour plan not found.' });
  return res.json({ success: true, message: 'Tour plan updated.', tourPlan });
};

const listVisits = async (req, res) => {
  if (!await pharmaOrganization(req, res)) return;
  const query = { organizationId: req.organizationId };
  if (req.query.employeeId) query.employeeId = text(req.query.employeeId, 100);
  if (req.query.status) query.finalStatus = text(req.query.status, 80);
  if (req.principalType !== 'admin') query.employeeId = req.user.employeeId;
  const visits = await PharmaVisit.find(query).populate('doctorId', 'doctorId fullName specialization clinicHospitalName city territory').sort({ checkInAt: -1 }).limit(pageLimit(req.query.limit)).lean();
  return res.json({ success: true, visits });
};

const getVisit = async (req, res) => {
  if (!await pharmaOrganization(req, res)) return;
  const visitObjectId = objectId(req.params.visitId);
  if (!visitObjectId) return res.status(400).json({ success: false, message: 'Invalid pharma visit ID.' });
  const query = { organizationId: req.organizationId, _id: visitObjectId };
  if (req.principalType !== 'admin') query.employeeId = req.user.employeeId;
  const visit = await PharmaVisit.findOne(query).populate('doctorId').populate('tourPlanId').lean();
  if (!visit) return res.status(404).json({ success: false, message: 'Pharma visit not found.' });
  return res.json({ success: true, visit });
};

const createVisit = async (req, res) => {
  const organization = await pharmaOrganization(req, res);
  if (!organization || (req.principalType === 'admin' && !requireManager(req, res))) return;
  const employeeId = req.principalType === 'admin' ? text(req.body?.employeeId, 100) : text(req.user?.employeeId, 100);
  const doctorId = objectId(req.body?.doctorId);
  const visitId = text(req.body?.visitId, 120);
  const checkInAt = new Date(req.body?.checkInAt);
  const checkOutAt = new Date(req.body?.checkOutAt);
  const samples = Array.isArray(req.body?.samples) ? req.body.samples.slice(0, 50) : [];
  const evidence = cleanEvidence(req.body?.evidence);
  const hasEvidence = (key) => typeof evidence[key] === 'string' ? Boolean(evidence[key]) : Boolean(evidence[key]?.url);
  if (!visitId || !employeeId || !doctorId || !Number.isFinite(checkInAt.getTime()) || !Number.isFinite(checkOutAt.getTime()) || checkOutAt < checkInAt) {
    return res.status(400).json({ success: false, message: 'Visit, employee, doctor, check-in, and check-out data are required.' });
  }
  if (!list(req.body?.visitPurposes).length || !text(req.body?.doctorAvailable, 3) || !text(req.body?.outcome, 120) || !text(req.body?.overallRemarks, 4000) || !text(req.body?.finalStatus, 120) || req.body?.declarationAccepted !== true) {
    return res.status(400).json({ success: false, message: 'Visit purpose, availability, outcome, remarks, final status, and declaration are required.' });
  }
  if (req.body?.doctorAvailable === 'Yes' && !(Array.isArray(req.body?.productDetails) && req.body.productDetails.length)) {
    return res.status(400).json({ success: false, message: 'At least one product detail is required when the doctor meeting occurs.' });
  }
  if (req.body?.followUpRequired === true && !req.body?.followUp?.date) return res.status(400).json({ success: false, message: 'Follow-up date is required.' });
  if (organization.settings?.pharmaSignatureRequired && !hasEvidence('doctorSignature')) return res.status(400).json({ success: false, message: 'Doctor signature is required by organization policy.' });
  if (organization.settings?.pharmaAcknowledgementRequired && samples.length && !hasEvidence('sampleAcknowledgement')) return res.status(400).json({ success: false, message: 'Sample acknowledgement is required by organization policy.' });
  const existing = await PharmaVisit.findOne({ organizationId: req.organizationId, visitId }).lean();
  if (existing) return res.json({ success: true, duplicate: true, message: 'Visit was already submitted.', visit: existing });
  const [doctor, employee] = await Promise.all([
    Doctor.findOne({ _id: doctorId, organizationId: req.organizationId }),
    User.findOne({ employeeId, organizationId: req.organizationId }).select('_id').lean(),
  ]);
  if (!doctor || !employee) return res.status(404).json({ success: false, message: 'Doctor or employee was not found in this organization.' });

  const deducted = [];
  let createdVisit = null;
  try {
    for (const item of samples) {
      const inventoryId = objectId(item.inventoryId);
      const quantity = Number(item.quantity);
      if (!inventoryId || !Number.isInteger(quantity) || quantity <= 0) throw new Error('Every sample requires a valid inventory batch and quantity.');
      const inventory = await SampleInventory.findOneAndUpdate(
        { _id: inventoryId, organizationId: req.organizationId, $or: [{ employeeId }, { employeeId: '' }], expiryDate: { $gte: new Date() }, quantityAvailable: { $gte: quantity } },
        { $inc: { quantityAvailable: -quantity, quantityIssued: quantity } },
        { new: true }
      );
      if (!inventory) throw new Error('Sample stock is insufficient, expired, or not assigned to this representative.');
      deducted.push({ id: inventory._id, productId: inventory.productId, employeeId: inventory.employeeId, batchNumber: inventory.batchNumber, quantity, balanceAfter: inventory.quantityAvailable });
    }
    const calculatedDoctorDistance = distanceMeters(req.body?.checkIn, doctor.location);
    const calculatedTravelDistance = distanceMeters(req.body?.checkIn, req.body?.checkOut);
    const radius = Math.max(25, Number(organization.settings?.pharmaVisitRadiusMeters) || 250);
    const visit = await PharmaVisit.create({
      organizationId: req.organizationId, visitId, schemaVersion: Math.max(1, Number(req.body?.schemaVersion) || 1),
      employeeId, doctorId, tourPlanId: objectId(req.body?.tourPlanId), visitType: text(req.body?.visitType, 20),
      visitCategory: text(req.body?.visitCategory, 20), visitPurposes: list(req.body?.visitPurposes), territory: text(req.body?.territory, 120) || doctor.territory,
      doctorAvailable: text(req.body?.doctorAvailable, 3), personMet: text(req.body?.personMet, 80), checkInAt, checkOutAt,
      checkIn: req.body?.checkIn || {}, checkOut: req.body?.checkOut || {}, visitDetails: req.body?.visitDetails || {},
      productDetails: (req.body?.productDetails || []).slice(0, 50), samples, promotionalMaterials: (req.body?.promotionalMaterials || []).slice(0, 50),
      competitorInformation: req.body?.competitorInformation || {}, outcome: text(req.body?.outcome, 120), doctorResponse: text(req.body?.doctorResponse, 120),
      followUpRequired: req.body?.followUpRequired === true, followUp: req.body?.followUp || {}, nextAction: text(req.body?.nextAction, 160),
      overallRemarks: text(req.body?.overallRemarks, 4000), evidence, finalStatus: text(req.body?.finalStatus, 120),
      declarationAccepted: true, totalDurationSeconds: Math.max(0, Math.round((checkOutAt - checkInAt) / 1000)),
      distanceFromDoctorMeters: calculatedDoctorDistance,
      distanceFromCheckInMeters: calculatedTravelDistance,
      insideAssignedRadius: calculatedDoctorDistance <= radius,
      submissionStatus: req.body?.submissionStatus === 'offline_synced' && organization.settings?.allowOfflinePharmaVisits !== false ? 'offline_synced' : 'online',
      draft: req.body?.draft === true,
    });
    createdVisit = visit;
    if (deducted.length) {
      await SampleInventoryLedger.insertMany(deducted.map((item) => ({
        organizationId: req.organizationId, inventoryId: item.id, productId: item.productId,
        employeeId: item.employeeId, visitId, batchNumber: item.batchNumber,
        transactionType: 'distribution', quantityChange: -item.quantity,
        balanceAfter: item.balanceAfter, createdBy: employeeId,
      })));
    }
    doctor.lastVisitAt = checkOutAt;
    doctor.lastVisitOutcome = visit.outcome;
    doctor.nextFollowUpAt = visit.followUpRequired && visit.followUp?.date ? new Date(visit.followUp.date) : null;
    await doctor.save();
    if (visit.tourPlanId) await TourPlan.updateOne({ _id: visit.tourPlanId, organizationId: req.organizationId }, { $set: { status: 'completed', completedVisitId: visit.visitId } });
    return res.status(201).json({ success: true, message: 'Pharma visit submitted.', visit });
  } catch (error) {
    if (createdVisit) await PharmaVisit.deleteOne({ _id: createdVisit._id });
    await SampleInventoryLedger.deleteMany({ organizationId: req.organizationId, visitId });
    await Promise.all(deducted.map((item) => SampleInventory.updateOne({ _id: item.id }, { $inc: { quantityAvailable: item.quantity, quantityIssued: -item.quantity } })));
    return res.status(error?.code === 11000 ? 409 : 400).json({ success: false, message: error?.code === 11000 ? 'Visit ID already exists.' : error.message });
  }
};

const summary = async (req, res) => {
  const organization = await pharmaOrganization(req, res);
  if (!organization) return;
  const from = req.query.from ? new Date(req.query.from) : new Date(Date.now() - 30 * 86400000);
  const query = { organizationId: req.organizationId, checkInAt: { $gte: from } };
  if (req.principalType !== 'admin') query.employeeId = req.user.employeeId;
  const inventoryMatch = { organizationId: new mongoose.Types.ObjectId(req.organizationId) };
  if (req.principalType !== 'admin') inventoryMatch.employeeId = { $in: [req.user.employeeId, ''] };
  const [visits, doctors, products, sampleTotals] = await Promise.all([
    PharmaVisit.find(query).select('doctorAvailable followUpRequired finalStatus').lean(),
    Doctor.countDocuments({ organizationId: req.organizationId, status: 'active' }),
    PharmaProduct.countDocuments({ organizationId: req.organizationId, status: 'active' }),
    SampleInventory.aggregate([{ $match: inventoryMatch }, { $group: { _id: null, available: { $sum: '$quantityAvailable' }, issued: { $sum: '$quantityIssued' } } }]),
  ]);
  const statuses = visits.reduce((map, item) => {
    map[item.finalStatus] = (map[item.finalStatus] || 0) + 1;
    return map;
  }, {});
  return res.json({ success: true, summary: {
    totalVisits: visits.length,
    productiveCalls: visits.filter((item) => item.doctorAvailable === 'Yes').length,
    followUps: visits.filter((item) => item.followUpRequired).length,
    activeDoctors: doctors,
    activeProducts: products,
    samplesAvailable: sampleTotals[0]?.available || 0,
    samplesIssued: sampleTotals[0]?.issued || 0,
    policies: {
      signatureRequired: organization.settings?.pharmaSignatureRequired === true,
      acknowledgementRequired: organization.settings?.pharmaAcknowledgementRequired === true,
      allowOfflineVisits: organization.settings?.allowOfflinePharmaVisits !== false,
    },
    statuses: Object.entries(statuses).map(([status, count]) => ({ status, count })),
  } });
};

module.exports = {
  listDoctors, createDoctor, updateDoctor, listProducts,
  listInventory, listTourPlans, createTourPlan, updateTourPlan,
  listVisits, getVisit, createVisit, summary,
};
