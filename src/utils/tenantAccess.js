const User = require('../models/User');

const sameId = (left, right) => Boolean(left && right) && String(left) === String(right);

const canAccessEmployee = async (principal, employeeId) => {
  if (!principal || !employeeId || !principal.organizationId) return false;
  if (String(principal.employeeId || '') === String(employeeId)) return true;
  const role = String(principal.role || '').toLowerCase();
  if (!role.includes('admin') && !role.includes('manager')) return false;
  return Boolean(await User.exists({ employeeId: String(employeeId), organizationId: principal.organizationId }));
};

module.exports = { canAccessEmployee, sameId };
