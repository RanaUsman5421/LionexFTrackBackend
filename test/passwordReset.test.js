const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const PasswordReset = require('../src/models/PasswordReset');
const User = require('../src/models/User');
const { buildPasswordResetEmail } = require('../src/services/passwordResetEmailService');
const { verifyPasswordResetOtp, resetPassword } = require('../src/controllers/authController');

const mockResponse = () => ({
  statusCode: 200,
  body: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});

test('password reset record requires an expiry and resend boundary', async () => {
  const reset = new PasswordReset({
    email: 'user@example.com',
    otpHash: 'hashed-value',
    otpExpiresAt: new Date(Date.now() + 60_000),
  });

  await assert.rejects(reset.validate(), /resendAvailableAt.*required|expiresAt.*required/);
});

test('password reset email contains the OTP and escapes the recipient name', () => {
  const html = buildPasswordResetEmail({
    name: '<script>alert("x")</script>',
    otp: '483921',
    expiresInMinutes: 10,
  });

  assert.match(html, /483921/);
  assert.match(html, /Expires in 10 minutes/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

test('OTP verification issues a one-time reset token and password reset revokes sessions', async () => {
  const originalSecret = process.env.SECRET_JWT_KEY;
  const originalResetFindOne = PasswordReset.findOne;
  const originalResetDeleteOne = PasswordReset.deleteOne;
  const originalUserFindOne = User.findOne;
  process.env.SECRET_JWT_KEY = 'password-reset-test-secret';

  const email = 'user@example.com';
  const otp = '483921';
  const resetRecord = {
    _id: 'reset-id',
    email,
    otpHash: crypto.createHmac('sha256', process.env.SECRET_JWT_KEY).update(`${email}:${otp}`).digest('hex'),
    otpExpiresAt: new Date(Date.now() + 60_000),
    attempts: 0,
    verified: false,
    async save() {},
  };

  try {
    PasswordReset.findOne = async () => resetRecord;
    const verifyResponse = mockResponse();
    await verifyPasswordResetOtp({ body: { email, otp } }, verifyResponse);

    assert.equal(verifyResponse.statusCode, 200);
    assert.equal(verifyResponse.body.success, true);
    assert.equal(typeof verifyResponse.body.resetToken, 'string');
    assert.equal(resetRecord.verified, true);
    assert.equal(resetRecord.otpHash, null);

    const user = {
      password: 'old-password-hash',
      authVersion: 2,
      async save() {},
    };
    PasswordReset.findOne = async (query) => {
      assert.equal(query.resetTokenHash, resetRecord.resetTokenHash);
      return resetRecord;
    };
    let deletedResetId = null;
    PasswordReset.deleteOne = async ({ _id }) => { deletedResetId = _id; };
    User.findOne = async () => user;

    const confirmResponse = mockResponse();
    await resetPassword({
      body: {
        email,
        resetToken: verifyResponse.body.resetToken,
        password: 'SecurePassword123!',
        confirmPassword: 'SecurePassword123!',
      },
    }, confirmResponse);

    assert.equal(confirmResponse.statusCode, 200);
    assert.equal(confirmResponse.body.success, true);
    assert.equal(await bcrypt.compare('SecurePassword123!', user.password), true);
    assert.equal(user.authVersion, 3);
    assert.equal(deletedResetId, 'reset-id');
  } finally {
    PasswordReset.findOne = originalResetFindOne;
    PasswordReset.deleteOne = originalResetDeleteOne;
    User.findOne = originalUserFindOne;
    if (originalSecret === undefined) delete process.env.SECRET_JWT_KEY;
    else process.env.SECRET_JWT_KEY = originalSecret;
  }
});
