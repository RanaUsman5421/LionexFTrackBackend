const crypto = require('crypto');
const { Blob } = require('buffer');

const REQUIRED_ENV_KEYS = ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'];

function ensureCloudinaryConfig() {
  const missing = REQUIRED_ENV_KEYS.filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error(`Missing Cloudinary configuration: ${missing.join(', ')}`);
  }
}

function sanitizeSegment(value, fallback) {
  const normalized = String(value || '').trim().replace(/[^A-Za-z0-9._-]+/g, '_');
  return normalized || fallback;
}

function buildSignature(params, apiSecret) {
  const signatureBase = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');

  return crypto.createHash('sha1').update(`${signatureBase}${apiSecret}`).digest('hex');
}

async function uploadLeadPhotoToCloudinary({ buffer, filename, mimeType, employeeId, leadId, kind }) {
  ensureCloudinaryConfig();

  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('Upload payload is empty.');
  }

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  const timestamp = Math.floor(Date.now() / 1000);
  const safeEmployeeId = sanitizeSegment(employeeId, 'employee');
  const safeLeadId = sanitizeSegment(leadId, 'lead');
  const safeKind = sanitizeSegment(kind, 'lead-photo');
  const publicId = `${safeKind}-${Date.now()}`;
  const folder = `lionexftrack/leads/${safeEmployeeId}/${safeLeadId}`;

  const uploadParams = {
    folder,
    overwrite: 'true',
    public_id: publicId,
    timestamp,
  };
  const signature = buildSignature(uploadParams, apiSecret);
  const uploadUrl = `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`;
  const form = new FormData();

  form.append('file', new Blob([buffer], { type: mimeType || 'image/jpeg' }), filename || `${publicId}.jpg`);
  form.append('api_key', apiKey);
  form.append('timestamp', String(timestamp));
  form.append('signature', signature);
  form.append('folder', folder);
  form.append('public_id', publicId);
  form.append('overwrite', 'true');

  const response = await fetch(uploadUrl, {
    method: 'POST',
    body: form,
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok || data.error) {
    throw new Error(data?.error?.message || data?.message || 'Cloudinary upload failed.');
  }

  return {
    secureUrl: data.secure_url,
    publicId: data.public_id,
    assetId: data.asset_id || null,
    folder: data.folder || folder,
  };
}

module.exports = {
  uploadLeadPhotoToCloudinary,
};
