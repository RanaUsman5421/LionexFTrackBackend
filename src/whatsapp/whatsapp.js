// ════════════════════════════════════════════════════════════════
// whatsapp.js — Simple WhatsApp (Baileys) connect: ek hi file mein sab.
//
// Kya karta hai:
//   • Naya profile banata hai aur QR deta hai (phone se scan karo)
//   • Session disk par save hota hai (./sessions/<profileId>) — server restart
//     ke baad bina QR ke khud dobara connect ho jata hai
//   • Saare profiles ki list deta hai
//
// Koi database nahi — sab kuch sirf ./sessions folder mein.
//
// Routes:
//   POST /api/wa/qr        body: { "profileId": "optional" }
//        → naya profile (ya diya hua profileId) start karke QR deta hai
//        → { profileId, status, qr }   qr = "data:image/png;base64,..." (<img src> mein lagao)
//   GET  /api/wa/profiles  → [{ profileId, status, phone }]
//   POST /api/wa/disconnect body: { "profileId": "..." } → logout + session delete
//   POST /api/wa/send      body: { "profileId": "...", "to": "923...", "text": "..." }
//
// Chalana:  node whatsapp.js        (port: PORT env ya 4000)
// Ya apne Express app mein:  const waRouter = require('./whatsapp'); app.use(waRouter);
// ════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const express = require('express');
const QRCode = require('qrcode');
const pino = require('pino');
const { protect } = require('../middleware/authMiddleware');

const SESSIONS_DIR = path.join(__dirname, 'sessions');
fs.mkdirSync(SESSIONS_DIR, { recursive: true });

const logger = pino({ level: 'silent' }); // Baileys ke andar ke logs band
const log = (...args) => console.log(`[WA ${new Date().toLocaleTimeString()}]`, ...args);

// profileId -> { profileId, status, qr, phone, sock }
// status: 'starting' | 'qr' | 'connected' | 'reconnecting' | 'logged_out'
const profiles = new Map();

// ── Connect ──────────────────────────────────────────────────────
async function startProfile(profileId) {
  // Baileys v7 is ESM-only, so load it dynamically from this CommonJS file.
  const {
    default: makeWASocket,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    Browsers,
    DisconnectReason,
  } = await import('@whiskeysockets/baileys');

  const authDir = path.join(SESSIONS_DIR, profileId);
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const { version } = await fetchLatestBaileysVersion();

  const profile = profiles.get(profileId) || { profileId, status: 'starting', qr: null, phone: null, sock: null, disconnectRequested: false };
  profiles.set(profileId, profile);
  profile.disconnectRequested = false;

  const sock = makeWASocket({
    version,
    auth: state,
    logger,
    printQRInTerminal: false,
    browser: Browsers.macOS('Chrome'),
  });
  profile.sock = sock;

  // Session (keys/creds) har tabdeeli par disk par save
  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      profile.qr = await QRCode.toDataURL(qr);
      profile.status = 'qr';
      log(profileId, 'QR ready — scan it');
    }

    if (connection === 'open') {
      profile.status = 'connected';
      profile.qr = null;
      profile.phone = sock.user?.id?.split(':')[0]?.split('@')[0] || null;
      log(profileId, 'connected', profile.phone);
    }

    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.loggedOut || profile.disconnectRequested) {
        // Phone se logout hua — session hata do, dobara QR chahiye hoga
        profile.status = 'logged_out';
        profile.qr = null;
        profile.phone = null;
        profile.sock = null;
        profile.disconnectRequested = false;
        fs.rmSync(authDir, { recursive: true, force: true });
        log(profileId, 'logged out — session deleted');
      } else {
        // Baaqi sab (QR scan ke baad restart, internet gaya waghera) → dobara connect
        profile.status = 'reconnecting';
        log(profileId, `connection closed (${code}) — reconnecting`);
        setTimeout(() => startProfile(profileId).catch((e) => log(profileId, 'reconnect failed:', e.message)), 3000);
      }
    }
  });

  return profile;
}

/** QR aane ya connect hone tak ruko (max 25 sec). */
async function waitForQrOrConnect(profile, ms = 25000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (profile.status === 'qr' || profile.status === 'connected') return;
    await new Promise((r) => setTimeout(r, 300));
  }
}
async function sendWhatsAppText(profileId, rawNumber, text) {
  const phone = String(rawNumber || '').replace(/[\s()+-]/g, '');
  if (!/^\d{8,15}$/.test(phone)) throw new Error('Invalid WhatsApp phone number.');
  if (typeof text !== 'string' || !text.trim() || text.length > 4096) throw new Error('WhatsApp text must be between 1 and 4096 characters.');
  const profile = profiles.get(profileId);
  if (!profile?.sock || profile.status !== 'connected') throw new Error('WhatsApp profile is not connected.');
  const sent = await profile.sock.sendMessage(`${phone}@s.whatsapp.net`, { text });
  return { to: phone, messageId: sent?.key?.id || null };
}

const publicProfile = (p) => ({ profileId: p.profileId, status: p.status, phone: p.phone });

// ── Routes ───────────────────────────────────────────────────────
const router = express.Router();
router.use(protect);

// Naya profile banao (ya purane ka QR dobara lo) → QR
router.post('/api/wa/qr', async (req, res) => {
  try {
    const requestedProfileId = req.body?.profileId;
    const profileId = requestedProfileId == null || requestedProfileId === ''
      ? `profile_${Date.now()}`
      : String(requestedProfileId).trim();
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(profileId)) {
      return res.status(400).json({ error: 'profileId must be 1–64 letters, numbers, underscores, or hyphens.' });
    }
    let profile = profiles.get(profileId);

    if (profile?.status === 'connected') {
      return res.json({ ...publicProfile(profile), qr: null, message: 'Already connected' });
    }
    if (!profile?.sock) profile = await startProfile(profileId);

    await waitForQrOrConnect(profile);
    return res.json({ ...publicProfile(profile), qr: profile.qr });
  } catch (err) {
    log('QR error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// Saare profiles
router.get('/api/wa/profiles', (req, res) => {
  res.json([...profiles.values()].map(publicProfile));
});

// ── Server start par purane sessions dobara connect ──────────────
// Connected WhatsApp profile se plain-text message bhejo.
// Connected WhatsApp device ko unlink karo aur uska saved login session delete karo.
router.post('/api/wa/disconnect', async (req, res) => {
  const profileId = String(req.body?.profileId || '').trim();
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(profileId)) {
    return res.status(400).json({ success: false, message: 'Valid profileId is required.' });
  }

  const profile = profiles.get(profileId);
  if (!profile?.sock || profile.status !== 'connected') {
    return res.status(409).json({ success: false, message: `WhatsApp profile "${profileId}" is not connected.` });
  }

  const sock = profile.sock;
  profile.disconnectRequested = true;
  try {
    await sock.logout();
    profile.status = 'logged_out';
    profile.qr = null;
    profile.phone = null;
    profile.sock = null;
    fs.rmSync(path.join(SESSIONS_DIR, profileId), { recursive: true, force: true });
    log(profileId, 'disconnected by dashboard');
    return res.json({ success: true, profileId, status: profile.status, message: 'WhatsApp disconnected.' });
  } catch (err) {
    profile.disconnectRequested = false;
    log(profileId, 'disconnect failed:', err.message);
    return res.status(500).json({ success: false, message: 'WhatsApp could not be disconnected.' });
  }
});

router.post('/api/wa/send', async (req, res) => {
  try {
    const profileId = String(req.body?.profileId || '').trim();
    const rawNumber = String(req.body?.to || '').trim();
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';

    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(profileId)) {
      return res.status(400).json({ success: false, message: 'Valid profileId is required.' });
    }

    // Accept international phone numbers with optional spaces, +, dashes, or parentheses.
    const phone = rawNumber.replace(/[\s()+-]/g, '');
    if (!/^\d{8,15}$/.test(phone)) {
      return res.status(400).json({
        success: false,
        message: 'to must be an international phone number with country code, for example 923001234567.',
      });
    }
    if (!text || text.length > 4096) {
      return res.status(400).json({ success: false, message: 'text is required and must be at most 4096 characters.' });
    }

    const profile = profiles.get(profileId);
    if (!profile?.sock || profile.status !== 'connected') {
      return res.status(409).json({ success: false, message: `WhatsApp profile "${profileId}" is not connected.` });
    }

    const sent = await profile.sock.sendMessage(`${phone}@s.whatsapp.net`, { text });
    return res.json({
      success: true,
      profileId,
      to: phone,
      messageId: sent?.key?.id || null,
      message: 'Message sent.',
    });
  } catch (err) {
    log('Send message error:', err.message);
    return res.status(500).json({ success: false, message: 'WhatsApp message could not be sent.' });
  }
});

async function restoreSessions() {
  const ids = fs.readdirSync(SESSIONS_DIR).filter((d) => fs.statSync(path.join(SESSIONS_DIR, d)).isDirectory());
  for (const id of ids) {
    await startProfile(id).catch((e) => log(id, 'restore failed:', e.message));
  }
  if (ids.length) log(`restored ${ids.length} session(s)`);
}
restoreSessions();

module.exports = router;
module.exports.sendWhatsAppText = sendWhatsAppText;

// `node whatsapp.js` se seedha chalao to apna chhota server bhi start ho jata hai
if (require.main === module) {
  const app = express();
  app.use(router);
  const PORT = process.env.PORT || 4000;
  app.listen(PORT, () => log(`server running on http://localhost:${PORT}`));
}
