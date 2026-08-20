const {
  canAccessEmployee,
  getActivity,
  getDuty,
  getFollowUps,
  getLeads,
  getSnapshot,
  getSummary,
  upsertSnapshot,
} = require('../services/appDataService');
const { parseMultipartFormData } = require('../utils/multipartParser');
const { uploadLeadPhotoToCloudinary, uploadProfilePhotoToCloudinary } = require('../services/cloudinaryService');
const User = require('../models/User');
const AppSnapshot = require('../models/AppSnapshot');

const syncSnapshot = async (req, res) => {
  try {
    const employeeId = req.user.employeeId;
    const snapshot = await upsertSnapshot(employeeId, req.body || {});
    return res.status(200).json({
      success: true,
      message: 'App snapshot synced.',
      snapshot,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to sync app snapshot.' });
  }
};

const getSnapshotController = async (req, res) => {
  try {
    const employeeId = req.params.employeeId || req.user.employeeId;
    if (!canAccessEmployee(req.user, employeeId)) {
      return res.status(403).json({ success: false, message: 'Not authorized.' });
    }

    const snapshot = await getSnapshot(employeeId);
    return res.status(200).json({ success: true, snapshot: snapshot || null });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to fetch snapshot.' });
  }
};

const getSummaryController = async (req, res) => {
  try {
    const employeeId = req.params.employeeId || req.user.employeeId;
    if (!canAccessEmployee(req.user, employeeId)) {
      return res.status(403).json({ success: false, message: 'Not authorized.' });
    }

    const summary = await getSummary(employeeId);
    return res.status(200).json({ success: true, summary });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to fetch summary.' });
  }
};

const getDutyController = async (req, res) => {
  try {
    const employeeId = req.params.employeeId || req.user.employeeId;
    if (!canAccessEmployee(req.user, employeeId)) {
      return res.status(403).json({ success: false, message: 'Not authorized.' });
    }

    const duty = await getDuty(employeeId);
    return res.status(200).json({ success: true, duty });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to fetch duty data.' });
  }
};

const getLeadsController = async (req, res) => {
  try {
    const employeeId = req.params.employeeId || req.user.employeeId;
    if (!canAccessEmployee(req.user, employeeId)) {
      return res.status(403).json({ success: false, message: 'Not authorized.' });
    }

    const leads = await getLeads(employeeId);
    return res.status(200).json({ success: true, leads });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to fetch leads.' });
  }
};

const getFollowUpsController = async (req, res) => {
  try {
    const employeeId = req.params.employeeId || req.user.employeeId;
    if (!canAccessEmployee(req.user, employeeId)) {
      return res.status(403).json({ success: false, message: 'Not authorized.' });
    }

    const followUps = await getFollowUps(employeeId);
    return res.status(200).json({ success: true, followUps });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to fetch follow-ups.' });
  }
};

const getActivityController = async (req, res) => {
  try {
    const employeeId = req.params.employeeId || req.user.employeeId;
    if (!canAccessEmployee(req.user, employeeId)) {
      return res.status(403).json({ success: false, message: 'Not authorized.' });
    }

    const activity = await getActivity(employeeId);
    return res.status(200).json({ success: true, activity });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to fetch activity.' });
  }
};

const uploadLeadPhotoController = async (req, res) => {
  try {
    const contentType = String(req.headers['content-type'] || '');
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '');

    if (!contentType.toLowerCase().includes('multipart/form-data')) {
      return res.status(400).json({ success: false, message: 'Multipart form data is required.' });
    }

    const { fields, files } = parseMultipartFormData(body, contentType);
    const photo = files.photo || files.image || files.file;

    if (!photo) {
      return res.status(400).json({ success: false, message: 'Photo file is missing.' });
    }

    const employeeId = String(fields.employeeId || req.user.employeeId || '').trim();
    const leadId = String(fields.leadId || '').trim() || `lead-${Date.now()}`;
    const kind = String(fields.kind || 'lead-photo').trim();
    const uploaded = await uploadLeadPhotoToCloudinary({
      buffer: photo.buffer,
      filename: photo.filename,
      mimeType: photo.contentType,
      employeeId,
      leadId,
      kind,
    });

    return res.status(200).json({
      success: true,
      message: 'Photo uploaded successfully.',
      photoUrl: uploaded.secureUrl,
      publicId: uploaded.publicId,
      assetId: uploaded.assetId,
      folder: uploaded.folder,
      employeeId,
      leadId,
      kind,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to upload photo.' });
  }
};

const uploadProfilePhotoController = async (req, res) => {
  try {
    const contentType = String(req.headers['content-type'] || '');
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '');

    if (!contentType.toLowerCase().includes('multipart/form-data')) {
      return res.status(400).json({ success: false, message: 'Multipart form data is required.' });
    }

    const { fields, files } = parseMultipartFormData(body, contentType);
    const photo = files.photo || files.image || files.file;

    if (!photo) {
      return res.status(400).json({ success: false, message: 'Photo file is missing.' });
    }

    const employeeId = String(fields.employeeId || req.user.employeeId || '').trim();
    if (!employeeId) {
      return res.status(400).json({ success: false, message: 'Employee id is required.' });
    }

    const uploaded = await uploadProfilePhotoToCloudinary({
      buffer: photo.buffer,
      filename: photo.filename,
      mimeType: photo.contentType,
      employeeId,
    });

    await User.findOneAndUpdate(
      { employeeId },
      { $set: { profilePhotoUrl: uploaded.secureUrl } },
      { new: true }
    );

    await AppSnapshot.findOneAndUpdate(
      { employeeId },
      {
        $set: {
          'user.profilePhotoUrl': uploaded.secureUrl,
          lastSyncedAt: new Date(),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return res.status(200).json({
      success: true,
      message: 'Profile photo uploaded successfully.',
      photoUrl: uploaded.secureUrl,
      publicId: uploaded.publicId,
      assetId: uploaded.assetId,
      folder: uploaded.folder,
      employeeId,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to upload profile photo.' });
  }
};

module.exports = {
  syncSnapshot,
  getSnapshotController,
  getSummaryController,
  getDutyController,
  getLeadsController,
  getFollowUpsController,
  getActivityController,
  uploadLeadPhotoController,
  uploadProfilePhotoController,
};
