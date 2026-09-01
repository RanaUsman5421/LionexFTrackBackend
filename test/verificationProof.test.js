const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { signingPayload, verifyDeviceSignature } = require('../src/services/verificationService');

test('employee verification accepts only a signature for the issued challenge payload', () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const payload = signingPayload('challenge-123', 'one-time-nonce');
  const signature = crypto.sign('sha256', Buffer.from(payload), privateKey).toString('base64');
  const encodedPublicKey = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');

  assert.equal(verifyDeviceSignature({ publicKey: encodedPublicKey, signature, payload }), true);
  assert.equal(verifyDeviceSignature({ publicKey: encodedPublicKey, signature, payload: `${payload}:tampered` }), false);
});

test('malformed biometric proof is rejected without throwing', () => {
  assert.equal(verifyDeviceSignature({ publicKey: 'bad', signature: 'bad', payload: 'payload' }), false);
});
