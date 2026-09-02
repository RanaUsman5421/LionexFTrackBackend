const test = require('node:test');
const assert = require('node:assert/strict');
const Invitation = require('../src/models/Invitation');
const User = require('../src/models/User');
const { buildInvitationEmail } = require('../src/services/passwordResetEmailService');
const { hashToken } = require('../src/controllers/invitationController');
const { hasPermission, permissionsFor } = require('../src/utils/adminPermissions');
const { canAccessEmployee } = require('../src/utils/tenantAccess');

test('invitation stores a hash and enforces organization, expiry, and creator', async () => {
  const row = new Invitation({ type: 'employee', email: 'person@example.com', tokenHash: hashToken('private-token') });
  await assert.rejects(row.validate(), /organizationId.*required|expiresAt.*required|createdByAdminId.*required/);
  assert.notEqual(row.tokenHash, 'private-token');
  assert.equal(hashToken('private-token'), hashToken('private-token'));
});

test('invitation email escapes user-controlled content and includes the private URL', () => {
  const html = buildInvitationEmail({
    name: '<img src=x>', organizationName: '<script>bad</script>', inviterName: 'Owner <owner@example.com>',
    inviteUrl: 'https://example.com/invite/safe-token', type: 'employee', expiresInHours: 48,
  });
  assert.doesNotMatch(html, /<script>|<img/);
  assert.match(html, /https:\/\/example.com\/invite\/safe-token/);
  assert.match(html, /48 hours/);
});

test('admin roles use explicit least-privilege permissions', () => {
  assert.equal(hasPermission({ adminRole: 'owner' }, 'organization.manage'), true);
  assert.equal(hasPermission({ adminRole: 'hr_admin' }, 'employees.approve'), true);
  assert.equal(hasPermission({ adminRole: 'report_viewer' }, 'employees.manage'), false);
  assert.deepEqual(permissionsFor({ adminRole: 'unknown' }), []);
});

test('manager access requires target employee in the same organization', async () => {
  const originalExists = User.exists;
  try {
    User.exists = async (query) => query.organizationId === 'org-a' && query.employeeId === 'A-1';
    assert.equal(await canAccessEmployee({ role: 'manager', organizationId: 'org-a' }, 'A-1'), true);
    assert.equal(await canAccessEmployee({ role: 'manager', organizationId: 'org-b' }, 'A-1'), false);
    assert.equal(await canAccessEmployee({ role: 'employee', organizationId: 'org-a', employeeId: 'SELF' }, 'SELF'), true);
  } finally {
    User.exists = originalExists;
  }
});
