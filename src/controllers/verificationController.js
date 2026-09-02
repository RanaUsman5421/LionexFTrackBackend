const crypto = require('crypto');
const User = require('../models/User');
const VerificationChallenge = require('../models/VerificationChallenge');
const BiometricDevice = require('../models/BiometricDevice');
const EmployeeCurrentLocation = require('../models/EmployeeCurrentLocation');
const {
  getCurrentChallenge,
  getVerificationGate,
  publicChallenge,
  refreshEmployeeChallenges,
  signingPayload,
  verifyDeviceSignature,
} = require('../services/verificationService');
const { emitVerificationEvent } = require('../services/socketService');
const { userAccessState } = require('../utils/userAccess');
const { hasPermission } = require('../utils/adminPermissions');

const isAdmin = (req) => req.principalType === 'admin' && String(req.user?.role || '').toLowerCase().includes('admin');
const isEmployee = (req) => req.principalType === 'user' && Boolean(req.user?.employeeId);

const decorate = (challenge) => ({
  ...publicChallenge(challenge),
  employee: challenge?.userId && typeof challenge.userId === 'object'
    ? {
        id: String(challenge.userId._id),
        fullName: challenge.userId.fullName,
        employeeId: challenge.userId.employeeId,
        role: challenge.userId.role || '',
        department: challenge.userId.department || '',
      }
    : undefined,
});

const createVerification = async (req, res) => {
  try {
    if (!isAdmin(req) || !hasPermission(req.user, 'verifications.manage')) return res.status(403).json({ success: false, message: 'Verification management permission required.' });
    const employeeId = String(req.body?.employeeId || '').trim();
    const scheduledAt = new Date(req.body?.scheduledAt);
    if (!employeeId || Number.isNaN(scheduledAt.getTime())) {
      return res.status(400).json({ success: false, message: 'Employee and a valid verification time are required.' });
    }
    if (scheduledAt.getTime() <= Date.now()) {
      return res.status(400).json({ success: false, message: 'Verification time must be in the future.' });
    }
    const user = await User.findOne({ employeeId, organizationId: req.organizationId }).select('fullName employeeId role department approvalStatus accountStatus');
    if (!user) return res.status(404).json({ success: false, message: 'Employee not found.' });
    const access = userAccessState(user);
    if (access.approvalStatus !== 'approved' || access.accountStatus !== 'active') {
      return res.status(409).json({ success: false, message: 'Verification can only be scheduled for an approved active employee.' });
    }
    await refreshEmployeeChallenges(employeeId);
    const existing = await VerificationChallenge.findOne({ employeeId, organizationId: req.organizationId, status: { $in: ['scheduled', 'pending', 'missed'] } });
    if (existing) {
      return res.status(409).json({ success: false, message: 'This employee already has an unresolved verification.' });
    }
    const challenge = await VerificationChallenge.create({
      organizationId: req.organizationId,
      employeeId,
      userId: user._id,
      createdBy: req.user._id,
      scheduledAt,
      notifyAt: new Date(scheduledAt.getTime() - 5 * 60_000),
      expiresAt: new Date(scheduledAt.getTime() + 5 * 60_000),
      nonce: crypto.randomBytes(32).toString('base64url'),
    });
    const payload = { organizationId: req.organizationId, employeeId, challenge: decorate({ ...challenge.toObject(), userId: user }), trackingBlocked: false };
    emitVerificationEvent('employee:verification-scheduled', payload);
    return res.status(201).json({ success: true, message: 'Employee verification scheduled.', ...payload });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to schedule verification.' });
  }
};

const listVerifications = async (req, res) => {
  try {
    if (!isAdmin(req) || !hasPermission(req.user, 'verifications.manage')) return res.status(403).json({ success: false, message: 'Verification management permission required.' });
    const employeeId = String(req.query.employeeId || '').trim();
    const employeeIds = employeeId
      ? [employeeId]
      : await VerificationChallenge.distinct('employeeId', { organizationId: req.organizationId, status: { $in: ['scheduled', 'pending'] } });
    await Promise.all(employeeIds.map((id) => refreshEmployeeChallenges(id)));
    const query = employeeId ? { employeeId, organizationId: req.organizationId } : { organizationId: req.organizationId };
    const rows = await VerificationChallenge.find(query)
      .populate('userId', 'fullName employeeId role department')
      .sort({ scheduledAt: -1 })
      .limit(500);
    return res.status(200).json({ success: true, verifications: rows.map(decorate), serverTime: new Date() });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to load verifications.' });
  }
};

const cancelVerification = async (req, res) => {
  try {
    if (!isAdmin(req) || !hasPermission(req.user, 'verifications.manage')) return res.status(403).json({ success: false, message: 'Verification management permission required.' });
    const challenge = await VerificationChallenge.findOne({
      _id: req.params.verificationId,
      organizationId: req.organizationId,
      status: { $in: ['scheduled', 'pending', 'missed'] },
    });
    if (!challenge) return res.status(404).json({ success: false, message: 'Active verification not found.' });
    challenge.status = 'cancelled';
    challenge.cancelledAt = new Date();
    challenge.cancelReason = String(req.body?.reason || '').trim().slice(0, 500);
    await challenge.save();
    const gate = await getVerificationGate(challenge.employeeId);
    if (!gate.blocked) {
      await EmployeeCurrentLocation.findOneAndUpdate(
        { employeeId: challenge.employeeId, trackingStatus: 'VERIFICATION_REQUIRED' },
        { $set: { trackingStatus: 'TRACKING_STOPPED', sessionStatus: 'stopped', lastSeenAt: new Date() } }
      );
    }
    const payload = { organizationId: req.organizationId, employeeId: challenge.employeeId, challenge: publicChallenge(challenge), trackingBlocked: gate.blocked };
    emitVerificationEvent('employee:verification-cancelled', payload);
    return res.status(200).json({ success: true, message: 'Verification cancelled.', ...payload });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to cancel verification.' });
  }
};

const resetBiometricDevice = async (req, res) => {
  try {
    if (!isAdmin(req) || !hasPermission(req.user, 'verifications.manage')) return res.status(403).json({ success: false, message: 'Verification management permission required.' });
    const employeeId = String(req.params.employeeId || '').trim();
    const deleted = await BiometricDevice.findOneAndDelete({ employeeId, organizationId: req.organizationId });
    emitVerificationEvent('employee:verification-device-reset', { organizationId: req.organizationId, employeeId, deviceReset: true });
    return res.status(200).json({
      success: true,
      message: deleted ? 'Biometric device binding reset.' : 'No biometric device was registered for this employee.',
      employeeId,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to reset biometric device.' });
  }
};

const currentVerification = async (req, res) => {
  try {
    if (!isEmployee(req)) return res.status(403).json({ success: false, message: 'Employee authorization required.' });
    const challenge = await getCurrentChallenge(req.user.employeeId);
    const gate = await getVerificationGate(req.user.employeeId);
    if (!challenge) {
      return res.status(200).json({ success: true, challenge: null, trackingBlocked: gate.blocked, serverTime: new Date() });
    }
    return res.status(200).json({
      success: true,
      challenge: {
        ...publicChallenge(challenge),
        nonce: challenge.nonce,
        signingPayload: signingPayload(String(challenge._id), challenge.nonce),
      },
      trackingBlocked: gate.blocked,
      serverTime: new Date(),
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to load verification.' });
  }
};

const acknowledgeNotification = async (req, res) => {
  try {
    if (!isEmployee(req)) return res.status(403).json({ success: false, message: 'Employee authorization required.' });
    const challenge = await VerificationChallenge.findOne({ _id: req.params.verificationId, employeeId: req.user.employeeId });
    if (!challenge) return res.status(404).json({ success: false, message: 'Verification not found.' });
    if (!challenge.notifiedAt) {
      challenge.notifiedAt = new Date();
      await challenge.save();
    }
    return res.status(200).json({ success: true, challenge: publicChallenge(challenge) });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to acknowledge notification.' });
  }
};

const completeVerification = async (req, res) => {
  try {
    if (!isEmployee(req)) return res.status(403).json({ success: false, message: 'Employee authorization required.' });
    const challenge = await VerificationChallenge.findOne({
      _id: req.params.verificationId,
      employeeId: req.user.employeeId,
      status: { $in: ['scheduled', 'pending', 'missed'] },
    }).select('+nonce');
    if (!challenge) return res.status(404).json({ success: false, message: 'Active verification not found.' });
    if (new Date() < challenge.scheduledAt) {
      return res.status(409).json({ success: false, code: 'VERIFICATION_NOT_OPEN', message: 'Verification is not open yet.' });
    }
    const deviceId = String(req.body?.deviceId || '').trim();
    const publicKey = String(req.body?.publicKey || '').trim();
    const signature = String(req.body?.signature || '').trim();
    if (!deviceId || !publicKey || !signature) {
      return res.status(400).json({ success: false, message: 'Device biometric proof is incomplete.' });
    }
    challenge.attempts += 1;
    const payload = signingPayload(String(challenge._id), challenge.nonce);
    if (!verifyDeviceSignature({ publicKey, signature, payload })) {
      await challenge.save();
      return res.status(401).json({ success: false, code: 'INVALID_BIOMETRIC_PROOF', message: 'Biometric proof could not be verified.' });
    }
    const registered = await BiometricDevice.findOne({ employeeId: req.user.employeeId });
    if (registered && (registered.publicKey !== publicKey || registered.deviceId !== deviceId)) {
      await challenge.save();
      return res.status(409).json({
        success: false,
        code: 'DEVICE_KEY_MISMATCH',
        message: 'This account is bound to another biometric device. Contact an administrator.',
      });
    }
    const now = new Date();
    if (registered) {
      registered.lastVerifiedAt = now;
      await registered.save();
    } else {
      await BiometricDevice.create({
        organizationId: req.organizationId,
        employeeId: req.user.employeeId,
        userId: req.user._id,
        deviceId,
        publicKey,
        lastVerifiedAt: now,
      });
    }
    const wasLate = challenge.status === 'missed' || now >= challenge.expiresAt;
    challenge.status = 'verified';
    challenge.verifiedAt = now;
    challenge.verifiedLate = wasLate;
    challenge.deviceId = deviceId;
    await challenge.save();
    const gate = await getVerificationGate(req.user.employeeId, now);
    if (!gate.blocked) {
      await EmployeeCurrentLocation.findOneAndUpdate(
        { employeeId: req.user.employeeId, trackingStatus: 'VERIFICATION_REQUIRED' },
        { $set: { trackingStatus: 'TRACKING_STOPPED', sessionStatus: 'stopped', lastSeenAt: now } }
      );
    }
    const responsePayload = { organizationId: req.organizationId, employeeId: req.user.employeeId, challenge: publicChallenge(challenge), trackingBlocked: gate.blocked };
    emitVerificationEvent('employee:verification-verified', responsePayload);
    return res.status(200).json({ success: true, message: wasLate ? 'Identity verified. Tracking can now be restarted.' : 'Identity verified successfully.', ...responsePayload });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to complete verification.' });
  }
};

module.exports = {
  acknowledgeNotification,
  cancelVerification,
  completeVerification,
  createVerification,
  currentVerification,
  listVerifications,
  resetBiometricDevice,
};
