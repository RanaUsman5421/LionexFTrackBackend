const test = require('node:test');
const assert = require('node:assert/strict');

const { isWebpBuffer } = require('../src/services/cloudinaryService');

test('lead upload validation recognizes WebP bytes and rejects JPEG bytes', () => {
  const webp = Buffer.concat([
    Buffer.from('RIFF', 'ascii'),
    Buffer.alloc(4),
    Buffer.from('WEBP', 'ascii'),
    Buffer.from('VP8 ', 'ascii'),
  ]);
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

  assert.equal(isWebpBuffer(webp), true);
  assert.equal(isWebpBuffer(jpeg), false);
});
