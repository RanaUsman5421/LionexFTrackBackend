const ROLE_PERMISSIONS = Object.freeze({
  owner: ['*'],
  super_admin: ['organization.manage', 'admins.manage', 'employees.manage', 'employees.approve', 'tracking.read', 'reports.read', 'verifications.manage'],
  hr_admin: ['employees.manage', 'employees.approve', 'reports.read'],
  operations_admin: ['employees.manage', 'tracking.read', 'reports.read', 'verifications.manage'],
  regional_manager: ['employees.read', 'tracking.read', 'reports.read', 'verifications.manage'],
  area_manager: ['employees.read', 'tracking.read', 'reports.read'],
  report_viewer: ['employees.read', 'tracking.read', 'reports.read'],
});

const normalizeAdminRole = (admin) => admin?.adminRole || (String(admin?.role || '').toLowerCase().includes('admin') ? 'owner' : 'report_viewer');
const permissionsFor = (admin) => ROLE_PERMISSIONS[normalizeAdminRole(admin)] || [];
const hasPermission = (admin, permission) => {
  const permissions = permissionsFor(admin);
  return permissions.includes('*') || permissions.includes(permission);
};

module.exports = { ROLE_PERMISSIONS, normalizeAdminRole, permissionsFor, hasPermission };