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

module.exports = { buildPasswordResetEmail, sendPasswordResetEmail };
