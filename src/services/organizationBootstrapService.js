const crypto = require('crypto');
const Organization = require('../models/Organization');
const Admin = require('../models/Admin');
const User = require('../models/User');
const AppSnapshot = require('../models/AppSnapshot');
const AppSyncState = require('../models/AppSyncState');
const AppSyncMetadata = require('../models/AppSyncMetadata');
const EmployeeCurrentLocation = require('../models/EmployeeCurrentLocation');
const LocationHistory = require('../models/LocationHistory');
const TrackingSession = require('../models/TrackingSession');
const LeadRecord = require('../models/LeadRecord');
const FollowUpRecord = require('../models/FollowUpRecord');
const ActivityRecord = require('../models/ActivityRecord');
const VerificationChallenge = require('../models/VerificationChallenge');
const BiometricDevice = require('../models/BiometricDevice');

const legacyCollections = [
  AppSnapshot,
  AppSyncState,
  AppSyncMetadata,
  EmployeeCurrentLocation,
  LocationHistory,
  TrackingSession,
  LeadRecord,
  FollowUpRecord,
  ActivityRecord,
  VerificationChallenge,
  BiometricDevice,
];

const generateCompanyCode = () => `LNX-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

const ensureLegacyOrganization = async () => {
  const firstAdmin = await Admin.findOne({}).sort({ createdAt: 1 });
  if (!firstAdmin) return null;

  let organization = firstAdmin.organizationId
    ? await Organization.findById(firstAdmin.organizationId)
    : await Organization.findOne({ ownerAdminId: firstAdmin._id });

  if (!organization) {
    let companyCode;
    do {
      companyCode = generateCompanyCode();
    } while (await Organization.exists({ companyCode }));

    organization = await Organization.create({
      name: process.env.LEGACY_ORGANIZATION_NAME || 'LionEx',
      companyCode,
      category: process.env.LEGACY_ORGANIZATION_CATEGORY || 'general',
      ownerAdminId: firstAdmin._id,
    });
  }

  await Admin.updateOne(
    { _id: firstAdmin._id },
    { $set: { organizationId: organization._id, adminRole: 'owner', accountStatus: 'active' } }
  );
  await Admin.updateMany(
    { _id: { $ne: firstAdmin._id }, organizationId: null },
    { $set: { organizationId: organization._id, adminRole: 'super_admin', accountStatus: 'active' } }
  );
  await User.updateMany({ organizationId: null }, { $set: { organizationId: organization._id } });
  await Promise.all(legacyCollections.map((Model) =>
    Model.updateMany({ organizationId: null }, { $set: { organizationId: organization._id } })
  ));

  return organization;
};

module.exports = { ensureLegacyOrganization, generateCompanyCode };
