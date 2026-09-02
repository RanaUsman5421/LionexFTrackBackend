const Organization = require('../models/Organization');
const Admin = require('../models/Admin');
const { hasPermission, normalizeAdminRole, permissionsFor } = require('../utils/adminPermissions');

const CATEGORY_MODULES = Object.freeze({
  pharmaceutical: ['doctors', 'chemists', 'dcr', 'samples', 'tour_plans'],
  electronics_sales: ['dealers', 'outlets', 'orders', 'stock_audits'],
  electronics_service: ['job_cards', 'warranty', 'installation', 'spare_parts'],
  banking: ['field_verification', 'cases', 'agents', 'maker_checker'],
  general: ['visits', 'leads', 'meetings', 'activities'],
});

const publicOrganization = (organization) => ({
  id: String(organization._id),
  name: organization.name,
  companyCode: organization.companyCode,
  category: organization.category,
  logoUrl: organization.logoUrl,
  companySize: organization.companySize,
  headOfficeCity: organization.headOfficeCity,
  address: organization.address,
  registrationNumber: organization.registrationNumber,
  website: organization.website,
  enabledModules: organization.enabledModules,
  settings: organization.settings,
  status: organization.status,
});

const getOrganization = async (req, res) => {
  const organization = await Organization.findById(req.organizationId).lean();
  if (!organization) return res.status(404).json({ success: false, message: 'Organization not found.' });
  return res.json({ success: true, organization: publicOrganization(organization) });
};

const updateOrganization = async (req, res) => {
  if (!hasPermission(req.user, 'organization.manage')) {
    return res.status(403).json({ success: false, message: 'Organization owner permission required.' });
  }
  const allowed = ['name', 'category', 'logoUrl', 'companySize', 'headOfficeCity', 'address', 'registrationNumber', 'website'];
  const update = {};
  allowed.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(req.body || {}, field)) update[field] = req.body[field];
  });
  if (update.category) {
    if (!CATEGORY_MODULES[update.category]) return res.status(400).json({ success: false, message: 'Invalid organization category.' });
    update.enabledModules = CATEGORY_MODULES[update.category];
  }
  if (req.body?.settings && typeof req.body.settings === 'object') {
    ['manualEmployeeApproval', 'trackingFrequencySeconds', 'timezone'].forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(req.body.settings, key)) update[`settings.${key}`] = req.body.settings[key];
    });
  }
  const organization = await Organization.findByIdAndUpdate(req.organizationId, { $set: update }, { new: true, runValidators: true });
  return res.json({ success: true, message: 'Organization settings updated.', organization: publicOrganization(organization) });
};

const listAdmins = async (req, res) => {
  if (!hasPermission(req.user, 'admins.manage')) return res.status(403).json({ success: false, message: 'Not authorized.' });
  const admins = await Admin.find({ organizationId: req.organizationId }).select('-password').sort({ createdAt: 1 }).lean();
  return res.json({ success: true, admins: admins.map((admin) => ({
    id: String(admin._id), fullName: admin.fullName, username: admin.username, email: admin.email,
    adminRole: normalizeAdminRole(admin), permissions: permissionsFor(admin), accountStatus: admin.accountStatus || 'active', createdAt: admin.createdAt,
  })) });
};

module.exports = { CATEGORY_MODULES, publicOrganization, getOrganization, updateOrganization, listAdmins };
