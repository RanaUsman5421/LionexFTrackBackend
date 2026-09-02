const crypto = require('crypto');
const VerificationChallenge = require('../models/VerificationChallenge');
const TrackingSession = require('../models/TrackingSession');
const EmployeeCurrentLocation = require('../models/EmployeeCurrentLocation');
const { emitTrackingStatus, emitVerificationEvent } = require('./socketService');

const ACTIVE_STATUSES = ['scheduled', 'pending', 'missed'];

const publicChallenge = (challenge) => {
  if (!challenge) return null;
  const row = challenge.toObject ? challenge.toObject() : { ...challenge };
  return {
    id: String(row._id),
    employeeId: row.employeeId,
    scheduledAt: row.scheduledAt,
    notifyAt: row.notifyAt,
    expiresAt: row.expiresAt,
    authenticator: row.authenticator,
    status: row.status,
    attempts: Number(row.attempts || 0),
    notifiedAt: row.notifiedAt,
    openedAt: row.openedAt,
    missedAt: row.missedAt,
    verifiedAt: row.verifiedAt,
    verifiedLate: Boolean(row.verifiedLate),
    cancelledAt: row.cancelledAt,
    cancelReason: row.cancelReason || '',
    deviceId: row.deviceId || '',
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
};

const signingPayload = (challengeId, nonce) => `lionex-verification-v1:${challengeId}:${nonce}`;

const verifyDeviceSignature = ({ publicKey, signature, payload }) => {
  try {
    const key = crypto.createPublicKey({
      key: Buffer.from(String(publicKey || ''), 'base64'),
      format: 'der',
      type: 'spki',
    });
    return crypto.verify('sha256', Buffer.from(payload, 'utf8'), key, Buffer.from(String(signature || ''), 'base64'));
  } catch (_) {
    return false;
  }
};

const markEmployeeVerificationRequired = async (employeeId, challenge) => {
  const now = new Date();
  await Promise.all([
    TrackingSession.findOneAndUpdate(
      { employeeId, status: 'active' },
      { $set: { status: 'stopped', endedAt: now, lastHeartbeatAt: now, note: 'verification_required' } },
      { sort: { startedAt: -1 }, new: true }
    ),
    EmployeeCurrentLocation.findOneAndUpdate(
      { employeeId },
      { $set: { trackingStatus: 'VERIFICATION_REQUIRED', sessionStatus: 'stopped', lastSeenAt: now } },
      { new: true }
    ),
  ]);
  const payload = {
    organizationId: challenge.organizationId,
    employeeId,
    challenge: publicChallenge(challenge),
    trackingBlocked: true,
    timestamp: now,
  };
  emitTrackingStatus({ organizationId: challenge.organizationId, employeeId, status: 'verification_required', trackingStatus: 'VERIFICATION_REQUIRED', timestamp: now });
  emitVerificationEvent('employee:verification-missed', payload);
};

const refreshEmployeeChallenges = async (employeeId, now = new Date()) => {
  await VerificationChallenge.updateMany(
    { employeeId, status: 'scheduled', scheduledAt: { $lte: now }, expiresAt: { $gt: now } },
    { $set: { status: 'pending', openedAt: now } }
  );

  const expiring = await VerificationChallenge.find({
    employeeId,
    status: { $in: ['scheduled', 'pending'] },
    expiresAt: { $lte: now },
  });
  for (const challenge of expiring) {
    challenge.status = 'missed';
    challenge.missedAt = challenge.missedAt || now;
    await challenge.save();
    await markEmployeeVerificationRequired(employeeId, challenge);
  }
};

const getVerificationGate = async (employeeId, now = new Date()) => {
  await refreshEmployeeChallenges(employeeId, now);
  const blocking = await VerificationChallenge.findOne({ employeeId, status: 'missed' }).sort({ expiresAt: -1 });
  return { blocked: Boolean(blocking), challenge: blocking };
};

const wasTimestampVerificationBlocked = async (employeeId, timestamp) => {
  return Boolean(await VerificationChallenge.exists({
    employeeId,
    status: 'verified',
    verifiedLate: true,
    expiresAt: { $lte: timestamp },
    verifiedAt: { $gte: timestamp },
  }));
};

const getCurrentChallenge = async (employeeId, now = new Date()) => {
  await refreshEmployeeChallenges(employeeId, now);
  const blocking = await VerificationChallenge.findOne({ employeeId, status: 'missed' })
    .sort({ expiresAt: 1 })
    .select('+nonce');
  if (blocking) return blocking;
  return VerificationChallenge.findOne({ employeeId, status: { $in: ['pending', 'scheduled'] } })
    .sort({ scheduledAt: 1 })
    .select('+nonce');
};

module.exports = {
  ACTIVE_STATUSES,
  getCurrentChallenge,
  getVerificationGate,
  publicChallenge,
  refreshEmployeeChallenges,
  signingPayload,
  verifyDeviceSignature,
  wasTimestampVerificationBlocked,
};
