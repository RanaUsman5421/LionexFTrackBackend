const { Resend } = require('resend');

const escapeHtml = (value) => String(value || '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

const buildPasswordResetEmail = ({ name, otp, expiresInMinutes }) => {
  const safeName = escapeHtml(name || 'there');
  const safeOtp = escapeHtml(otp);

  return `<!doctype html>
<html lang="en">
  <body style="margin:0;background:#f4f6f8;font-family:Arial,Helvetica,sans-serif;color:#252832;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f6f8;padding:32px 12px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 8px 28px rgba(24,28,38,.08);">
          <tr><td style="background:#22252d;padding:28px 36px;">
            <div style="font-size:24px;font-weight:800;color:#ffffff;letter-spacing:.2px;">LionEx <span style="color:#f97316;">FTrack</span></div>
            <div style="margin-top:6px;color:#b8bdc8;font-size:13px;">Secure account recovery</div>
          </td></tr>
          <tr><td style="padding:36px;">
            <h1 style="margin:0 0 16px;font-size:24px;line-height:1.3;color:#22252d;">Reset your password</h1>
            <p style="margin:0 0 16px;font-size:15px;line-height:1.7;">Hello ${safeName},</p>
            <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#555b67;">We received a request to reset the password for your LionEx FTrack account. Enter the verification code below in the app to continue.</p>
            <div style="margin:0 auto 24px;padding:20px;text-align:center;background:#fff4ec;border:1px solid #ffd8bd;border-radius:14px;">
              <div style="font-size:12px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:#7a4a27;">Verification code</div>
              <div style="margin-top:10px;font-size:36px;font-weight:800;letter-spacing:8px;color:#f97316;">${safeOtp}</div>
              <div style="margin-top:10px;font-size:12px;color:#7a6b61;">Expires in ${expiresInMinutes} minutes</div>
            </div>
            <p style="margin:0 0 12px;font-size:14px;line-height:1.7;color:#555b67;">For your security, never share this code with anyone. LionEx staff will never ask you for it.</p>
            <p style="margin:0;font-size:14px;line-height:1.7;color:#555b67;">If you did not request a password reset, you can safely ignore this email. Your password will remain unchanged.</p>
          </td></tr>
          <tr><td style="padding:22px 36px;background:#f8f9fb;border-top:1px solid #eceef2;color:#858b96;font-size:12px;line-height:1.6;">
            This is an automated security message from LionEx FTrack. Please do not reply to this email.
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
};

const sendPasswordResetEmail = async ({ to, name, otp, expiresInMinutes }) => {
  const apiKey = process.env.RESEND_EMAIL_API_KEY;
  if (!apiKey) throw new Error('RESEND_EMAIL_API_KEY is not configured.');

  const resend = new Resend(apiKey);
  const { data, error } = await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL || 'LionEx FTrack <onboarding@resend.dev>',
    to: [to],
    subject: 'Your LionEx FTrack password reset code',
    html: buildPasswordResetEmail({ name, otp, expiresInMinutes }),
  });

  if (error) throw new Error(error.message || 'The reset email could not be sent.');
  return data;
};

const buildInvitationEmail = ({ name, organizationName, inviterName, inviteUrl, type, expiresInHours }) => {
  const safeName = escapeHtml(name || 'there');
  const safeOrganization = escapeHtml(organizationName);
  const safeInviter = escapeHtml(inviterName || 'an administrator');
  const safeUrl = escapeHtml(inviteUrl);
  const accountType = type === 'admin' ? 'administrator' : 'employee';
  return `<!doctype html><html lang="en"><body style="margin:0;background:#f4f6f8;font-family:Arial,Helvetica,sans-serif;color:#252832;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:32px 12px;"><tr><td align="center">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#fff;border-radius:18px;overflow:hidden;box-shadow:0 8px 28px rgba(24,28,38,.08);">
  <tr><td style="background:#22252d;padding:28px 36px;color:#fff;font-size:24px;font-weight:800;">LionEx <span style="color:#f97316;">FTrack</span></td></tr>
  <tr><td style="padding:36px;"><h1 style="margin:0 0 16px;font-size:24px;">Join ${safeOrganization}</h1>
  <p style="font-size:15px;line-height:1.7;">Hello ${safeName},</p><p style="font-size:15px;line-height:1.7;color:#555b67;">${safeInviter} invited you to join ${safeOrganization} as an ${accountType}.</p>
  <p style="margin:28px 0;text-align:center;"><a href="${safeUrl}" style="display:inline-block;background:#f97316;color:#fff;text-decoration:none;font-weight:700;padding:14px 24px;border-radius:10px;">Accept invitation</a></p>
  <p style="font-size:13px;line-height:1.7;color:#777;">This private, one-time link expires in ${Number(expiresInHours || 48)} hours. If you were not expecting it, ignore this email.</p>
  <p style="font-size:12px;line-height:1.6;color:#858b96;word-break:break-all;">${safeUrl}</p></td></tr></table></td></tr></table></body></html>`;
};

const sendInvitationEmail = async (details) => {
  const apiKey = process.env.RESEND_EMAIL_API_KEY;
  if (!apiKey) throw new Error('RESEND_EMAIL_API_KEY is not configured.');
  const resend = new Resend(apiKey);
  const { data, error } = await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL || 'LionEx FTrack <onboarding@resend.dev>',
    to: [details.to],
    subject: `You're invited to ${details.organizationName} on LionEx FTrack`,
    html: buildInvitationEmail(details),
  });
  if (error) throw new Error(error.message || 'The invitation email could not be sent.');
  return data;
};

const buildAdminSignupEmail = ({ name, otp, companyName, expiresInMinutes }) => `<!doctype html><html lang="en"><body style="margin:0;background:#f4f6f8;font-family:Arial,Helvetica,sans-serif;color:#252832;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:32px 12px"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#fff;border-radius:18px;overflow:hidden"><tr><td style="background:#22252d;padding:28px 36px;color:#fff;font-size:24px;font-weight:800">LionEx <span style="color:#f97316">FTrack</span></td></tr><tr><td style="padding:36px"><h1 style="margin:0 0 16px">Verify your admin signup</h1><p>Hello ${escapeHtml(name)},</p><p style="color:#555b67;line-height:1.7">Use this code to create the ${escapeHtml(companyName)} organization and its Owner account.</p><div style="margin:24px 0;padding:20px;text-align:center;background:#fff4ec;border:1px solid #ffd8bd;border-radius:14px"><div style="font-size:36px;font-weight:800;letter-spacing:8px;color:#f97316">${escapeHtml(otp)}</div><div style="font-size:12px;color:#777;margin-top:8px">Expires in ${Number(expiresInMinutes)} minutes</div></div><p style="font-size:13px;color:#777">If you did not request this account, ignore this email.</p></td></tr></table></td></tr></table></body></html>`;

const sendAdminSignupEmail = async (details) => {
  const apiKey = process.env.RESEND_EMAIL_API_KEY;
  if (!apiKey) throw new Error('RESEND_EMAIL_API_KEY is not configured.');
  const resend = new Resend(apiKey);
  const { data, error } = await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL || 'LionEx FTrack <onboarding@resend.dev>',
    to: [details.to],
    subject: 'Verify your LionEx FTrack organization',
    html: buildAdminSignupEmail(details),
  });
  if (error) throw new Error(error.message || 'The verification email could not be sent.');
  return data;
};

module.exports = { buildPasswordResetEmail, sendPasswordResetEmail, buildInvitationEmail, sendInvitationEmail, buildAdminSignupEmail, sendAdminSignupEmail };
