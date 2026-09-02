const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const Invitation = require('../models/Invitation');
const Organization = require('../models/Organization');
const User = require('../models/User');
const Admin = require('../models/Admin');
const { hasPermission } = require('../utils/adminPermissions');
const { sendInvitationEmail } = require('../services/passwordResetEmailService');
const { userAccessState } = require('../utils/userAccess');

const INVITE_TTL_HOURS = Math.min(72, Math.max(24, Number(process.env.INVITATION_EXPIRY_HOURS || 48)));
const normalizeEmail = (value) => String(value || '').trim().toLowerCase();
const hashToken = (token) => crypto.createHash('sha256').update(String(token || '')).digest('hex');
const newToken = () => crypto.randomBytes(32).toString('base64url');
const inviteUrl = (token) => `${(process.env.EMPLOYEE_INVITE_BASE_URL || 'https://lionexftrackbackend.onrender.com/api/invitations/open').replace(/\/$/, '')}/${encodeURIComponent(token)}`;
const validEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

const publicInvitation = (row) => ({
  id: String(row._id), type: row.type, email: row.email, status: row.status,
  expiresAt: row.expiresAt, usedAt: row.usedAt, revokedAt: row.revokedAt,
  employee: row.employee, adminRole: row.adminRole, sendCount: row.sendCount,
  lastSentAt: row.lastSentAt, createdAt: row.createdAt,
});

const invitationWithOrganization = async (token) => {
  if (!token || token.length > 256) return null;
  return Invitation.findOne({ tokenHash: hashToken(token) }).select('+tokenHash').populate('organizationId', 'name logoUrl category status settings');
};

const ensureUsable = (invitation) => {
  if (!invitation || invitation.status !== 'pending') return 'This invitation is invalid or has already been used.';
  if (invitation.expiresAt <= new Date()) return 'This invitation has expired. Ask your administrator for a new one.';
  if (invitation.organizationId?.status !== 'active') return 'This organization is not currently active.';
  return '';
};

const deliver = async (invitation, rawToken, req, organization) => sendInvitationEmail({
  to: invitation.email,
  name: invitation.employee?.fullName || invitation.email.split('@')[0],
  organizationName: organization?.name || invitation.organizationId?.name,
  inviterName: req.user.fullName,
  inviteUrl: inviteUrl(rawToken),
  type: invitation.type,
  expiresInHours: INVITE_TTL_HOURS,
});

const createInvitation = async (req, res) => {
  try {
    const type = req.body?.type === 'admin' ? 'admin' : 'employee';
    const permission = type === 'admin' ? 'admins.manage' : 'employees.manage';
    if (!hasPermission(req.user, permission)) return res.status(403).json({ success: false, message: 'Not authorized to send this invitation.' });
    const email = normalizeEmail(req.body?.email);
    if (!validEmail(email)) return res.status(400).json({ success: false, message: 'A valid email address is required.' });

    const organization = await Organization.findById(req.organizationId);
    if (!organization) return res.status(404).json({ success: false, message: 'Organization not found.' });
    if (type === 'employee' && (!String(req.body?.fullName || '').trim() || !String(req.body?.employeeId || '').trim())) {
      return res.status(400).json({ success: false, message: 'Employee name and employee ID are required.' });
    }
    if (type === 'employee' && await User.exists({ $or: [{ email }, { employeeId: String(req.body.employeeId).trim() }] })) {
      return res.status(409).json({ success: false, message: 'Email or employee ID is already in use.' });
    }
    if (type === 'admin' && await Admin.exists({ email })) return res.status(409).json({ success: false, message: 'An admin with this email already exists.' });

    await Invitation.updateMany(
      { organizationId: req.organizationId, email, type, status: 'pending' },
      { $set: { status: 'revoked', revokedAt: new Date() } }
    );
    const rawToken = newToken();
    const invitation = await Invitation.create({
      organizationId: req.organizationId,
      type,
      email,
      tokenHash: hashToken(rawToken),
      createdByAdminId: req.user._id,
      expiresAt: new Date(Date.now() + INVITE_TTL_HOURS * 60 * 60 * 1000),
      employee: type === 'employee' ? {
        fullName: String(req.body.fullName || '').trim(), employeeId: String(req.body.employeeId || '').trim(),
        phone: String(req.body.phone || '').trim(), city: String(req.body.city || '').trim(), area: String(req.body.area || '').trim(),
        role: String(req.body.role || '').trim(), department: String(req.body.department || '').trim(), joiningDate: String(req.body.joiningDate || '').trim(),
      } : { fullName: String(req.body.fullName || '').trim() },
      adminRole: type === 'admin' ? String(req.body.adminRole || 'report_viewer') : 'report_viewer',
    });
    invitation.organizationId = organization;
    try {
      await deliver(invitation, rawToken, req, organization);
    } catch (error) {
      await Invitation.deleteOne({ _id: invitation._id });
      throw error;
    }
    return res.status(201).json({ success: true, message: `Invitation sent to ${email}.`, invitation: publicInvitation(invitation) });
  } catch (error) {
    const duplicate = error?.code === 11000;
    return res.status(duplicate ? 409 : 503).json({ success: false, message: duplicate ? 'An invitation conflict occurred. Please retry.' : error.message || 'Invitation could not be sent.' });
  }
};

const listInvitations = async (req, res) => {
  if (!hasPermission(req.user, 'employees.read') && !hasPermission(req.user, 'employees.manage') && !hasPermission(req.user, 'admins.manage')) {
    return res.status(403).json({ success: false, message: 'Not authorized.' });
  }
  const limit = Math.min(100, Math.max(1, Number(req.query.limit || 50)));
  const query = { organizationId: req.organizationId };
  if (['employee', 'admin'].includes(req.query.type)) query.type = req.query.type;
  if (!hasPermission(req.user, 'admins.manage')) query.type = 'employee';
  if (req.query.cursor?.match(/^[a-f\d]{24}$/i)) query._id = { $lt: req.query.cursor };
  const rows = await Invitation.find(query).sort({ _id: -1 }).limit(limit + 1).lean();
  const hasMore = rows.length > limit;
  if (hasMore) rows.pop();
  return res.json({ success: true, invitations: rows.map(publicInvitation), pagination: { hasMore, nextCursor: hasMore ? String(rows.at(-1)._id) : null } });
};

const revokeInvitation = async (req, res) => {
  const row = await Invitation.findOne({ _id: req.params.invitationId, organizationId: req.organizationId, status: 'pending' });
  if (!row) return res.status(404).json({ success: false, message: 'Pending invitation not found.' });
  const permission = row.type === 'admin' ? 'admins.manage' : 'employees.manage';
  if (!hasPermission(req.user, permission)) return res.status(403).json({ success: false, message: 'Not authorized.' });
  row.status = 'revoked'; row.revokedAt = new Date(); await row.save();
  return res.json({ success: true, message: 'Invitation revoked.', invitation: publicInvitation(row) });
};

const resendInvitation = async (req, res) => {
  const row = await Invitation.findOne({ _id: req.params.invitationId, organizationId: req.organizationId, status: 'pending' }).populate('organizationId', 'name');
  if (!row) return res.status(404).json({ success: false, message: 'Pending invitation not found.' });
  const permission = row.type === 'admin' ? 'admins.manage' : 'employees.manage';
  if (!hasPermission(req.user, permission)) return res.status(403).json({ success: false, message: 'Not authorized.' });
  if (row.lastSentAt && Date.now() - row.lastSentAt.getTime() < 60_000) return res.status(429).json({ success: false, message: 'Wait one minute before resending.' });
  const rawToken = newToken();
  row.tokenHash = hashToken(rawToken); row.expiresAt = new Date(Date.now() + INVITE_TTL_HOURS * 3600_000);
  row.lastSentAt = new Date(); row.sendCount += 1;
  await deliver(row, rawToken, req); await row.save();
  return res.json({ success: true, message: `Invitation resent to ${row.email}.`, invitation: publicInvitation(row) });
};

const resolveInvitation = async (req, res) => {
  const invitation = await invitationWithOrganization(req.params.token);
  const problem = ensureUsable(invitation);
  if (problem) return res.status(400).json({ success: false, code: 'INVITATION_INVALID', message: problem });
  return res.json({ success: true, invitation: {
    type: invitation.type, email: invitation.email, expiresAt: invitation.expiresAt, employee: invitation.employee,
    adminRole: invitation.adminRole, organization: { name: invitation.organizationId.name, logoUrl: invitation.organizationId.logoUrl, category: invitation.organizationId.category },
  } });
};

const acceptInvitation = async (req, res) => {
  try {
    const invitation = await invitationWithOrganization(req.params.token);
    const problem = ensureUsable(invitation);
    if (problem) return res.status(400).json({ success: false, code: 'INVITATION_INVALID', message: problem });
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');
    const confirmPassword = String(req.body?.confirmPassword || '');
    if (!username || password.length < 8 || password.length > 128 || password !== confirmPassword) {
      return res.status(400).json({ success: false, message: 'Username and matching password of 8–128 characters are required.' });
    }
    const passwordHash = await bcrypt.hash(password, 10);
    let principal;
    if (invitation.type === 'employee') {
      const duplicate = await User.exists({ $or: [{ email: invitation.email }, { username }, { employeeId: invitation.employee.employeeId }] });
      if (duplicate) return res.status(409).json({ success: false, message: 'This account is already registered. Try logging in.' });
      const manualApproval = invitation.organizationId.settings?.manualEmployeeApproval !== false;
      principal = await User.create({
        ...invitation.employee.toObject(), username, email: invitation.email, password: passwordHash,
        organizationId: invitation.organizationId._id, invitationId: invitation._id, invitedBy: invitation.createdByAdminId,
        approvalStatus: manualApproval ? 'pending' : 'approved', accountStatus: manualApproval ? 'inactive' : 'active',
        approvedAt: manualApproval ? null : new Date(), approvedBy: manualApproval ? null : invitation.createdByAdminId,
      });
    } else {
      if (await Admin.exists({ $or: [{ email: invitation.email }, { username }] })) return res.status(409).json({ success: false, message: 'This admin account already exists.' });
      const employeeId = `ADMIN-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
      principal = await Admin.create({
        fullName: String(req.body?.fullName || invitation.employee?.fullName || username).trim(), employeeId, username,
        email: invitation.email, password: passwordHash, role: 'admin', adminRole: invitation.adminRole,
        organizationId: invitation.organizationId._id, invitedBy: invitation.createdByAdminId, accountStatus: 'active',
      });
    }
    const claimed = await Invitation.updateOne({ _id: invitation._id, status: 'pending' }, { $set: { status: 'used', usedAt: new Date() } });
    if (claimed.modifiedCount !== 1) {
      await principal.deleteOne();
      return res.status(409).json({ success: false, message: 'This invitation was already used.' });
    }
    const access = invitation.type === 'employee' ? userAccessState(principal) : { approvalStatus: 'approved', accountStatus: 'active' };
    return res.status(201).json({ success: true, requiresApproval: invitation.type === 'employee' && access.approvalStatus === 'pending', ...access, message: invitation.type === 'admin' ? 'Admin account created. You can now sign in on the dashboard.' : access.approvalStatus === 'pending' ? 'Registration completed. Please wait for admin approval.' : 'Registration completed. You can now log in.' });
  } catch (error) {
    return res.status(error?.code === 11000 ? 409 : 500).json({ success: false, message: error?.code === 11000 ? 'Account details are already in use.' : error.message || 'Invitation could not be accepted.' });
  }
};

const openInvitation = async (req, res) => {
  const token = encodeURIComponent(String(req.params.token || ''));
  const invitation = await invitationWithOrganization(req.params.token);
  if (invitation?.type === 'admin') {
    return res.set('Referrer-Policy', 'no-referrer').type('html').send(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>Join ${String(invitation.organizationId.name).replace(/[<>]/g, '')}</title></head><body style="font-family:Arial;background:#f4f6f8;color:#252832;padding:24px"><main style="max-width:440px;margin:40px auto;background:white;padding:30px;border-radius:18px"><h1>Join ${String(invitation.organizationId.name).replace(/[<>]/g, '')}</h1><p>Create your administrator login.</p><form id="join" style="display:grid;gap:12px"><input name="fullName" required placeholder="Full name" value="${String(invitation.employee?.fullName || '').replace(/["<>]/g, '')}" style="padding:12px"><input name="username" required placeholder="Username" style="padding:12px"><input name="password" required type="password" minlength="8" maxlength="128" placeholder="Password" style="padding:12px"><input name="confirmPassword" required type="password" minlength="8" maxlength="128" placeholder="Confirm password" style="padding:12px"><button style="padding:13px;background:#f97316;color:white;border:0;border-radius:9px;font-weight:bold">Create admin account</button></form><p id="message" style="font-size:13px"></p></main><script>document.getElementById('join').addEventListener('submit',async function(e){e.preventDefault();const m=document.getElementById('message');m.textContent='Creating account…';const body=Object.fromEntries(new FormData(e.target));try{const r=await fetch('/api/invitations/${token}/accept',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json();m.textContent=d.message||'Request completed.';if(r.ok)e.target.remove()}catch(_){m.textContent='Unable to connect. Please try again.'}})</script></body></html>`);
  }
  const deepLink = `lionexftrack://join/${token}`;
  res.set('Referrer-Policy', 'no-referrer').type('html').send(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>Open LionEx FTrack</title></head><body style="font-family:Arial;text-align:center;padding:48px;background:#f4f6f8;color:#252832"><h1>Open LionEx FTrack</h1><p>Continue in the employee app to accept your private invitation.</p><p><a href="${deepLink}" style="display:inline-block;background:#f97316;color:white;padding:14px 24px;border-radius:10px;text-decoration:none;font-weight:bold">Open app</a></p><p style="color:#777;font-size:13px">Install the app first if it is not already available on this device.</p><script>location.href=${JSON.stringify(deepLink)}</script></body></html>`);
};

module.exports = { createInvitation, listInvitations, revokeInvitation, resendInvitation, resolveInvitation, acceptInvitation, openInvitation, hashToken };
