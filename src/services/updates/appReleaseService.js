const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);
const MAX_BYTES = 250 * 1024 * 1024;
const root = () => path.resolve(process.env.APP_RELEASE_DIR || path.join(__dirname, '../../../fieldtrack'));
const catalogFile = () => path.join(root(), 'catalog.json');
const apkPath = id => { if (!/^[a-f0-9-]{36}$/.test(id)) throw Error('Invalid release ID.'); return path.join(root(), 'apks', `${id}.apk`); };
async function prepare() { await fsp.mkdir(path.join(root(), 'apks'), { recursive: true }); }
async function catalog() { try { return JSON.parse(await fsp.readFile(catalogFile(), 'utf8')); } catch (e) { if (e.code === 'ENOENT') return []; throw e; } }
async function locked(action) {
  await prepare(); const lock = path.join(root(), '.catalog-lock');
  let acquired = false;
  for (let n = 0; n < 100; n++) { try { await fsp.mkdir(lock); acquired = true; break; } catch (e) { if (e.code !== 'EEXIST') throw e; await new Promise(r => setTimeout(r, 50)); } }
  if (!acquired) throw Error('Release catalog busy. Retry shortly.');
  try { const rows = await catalog(); const value = await action(rows); const temp = `${catalogFile()}.${crypto.randomUUID()}.tmp`; await fsp.writeFile(temp, JSON.stringify(rows, null, 2) + '\n', { flag: 'wx' }); await fsp.rename(temp, catalogFile()); return value; }
  finally { await fsp.rmdir(lock); }
}
function tools() {
  const sdk = process.env.ANDROID_SDK_ROOT || process.env.ANDROID_HOME || (process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Android/Sdk'));
  let build = process.env.APP_RELEASE_BUILD_TOOLS;
  if (!build && sdk && fs.existsSync(path.join(sdk, 'build-tools'))) build = path.join(sdk, 'build-tools', fs.readdirSync(path.join(sdk, 'build-tools')).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true})).at(-1));
  const javaHome = process.env.JAVA_HOME || (process.platform === 'win32' ? 'C:/Program Files/Android/Android Studio/jbr' : '');
  return { java: javaHome ? path.join(javaHome, 'bin', process.platform === 'win32' ? 'java.exe' : 'java') : 'java', signer: build && path.join(build, 'lib/apksigner.jar'), aapt: build && path.join(build, process.platform === 'win32' ? 'aapt.exe' : 'aapt') };
}
async function inspect(file) {
  const pinned = (process.env.APP_RELEASE_CERT_SHA256 || '').toLowerCase().replace(/:/g, '');
  if (!/^[a-f0-9]{64}$/.test(pinned)) throw Error('Release signing certificate is not configured.');
  const tool = tools(); if (!tool.signer || !fs.existsSync(tool.signer) || !tool.aapt || !fs.existsSync(tool.aapt)) throw Error('Android build-tools are required on the release server.');
  const options = { timeout: 90000, maxBuffer: 1024 * 1024, windowsHide: true };
  const verified = await run(tool.java, ['-jar', tool.signer, 'verify', '--print-certs', file], options);
  const certificates = [...verified.stdout.matchAll(/Signer #\d+ certificate SHA-256 digest:\s*([a-f0-9]+)/gi)].map(m=>m[1].toLowerCase());
  if (certificates.length !== 1 || certificates[0] !== pinned) throw Error('APK signing certificate does not match the trusted release key.');
  const badging = (await run(tool.aapt, ['dump', 'badging', file], options)).stdout;
  const pkg = badging.match(/package: name='([^']+)' versionCode='(\d+)' versionName='([^']*)'/);
  if (!pkg || pkg[1] !== (process.env.APP_RELEASE_PACKAGE || 'com.example.lionexftrack')) throw Error('APK package does not match FieldTrack.');
  if (!pkg[3] || pkg[3].length > 80) throw Error('APK version name must contain 1 to 80 characters.');
  if (/application-debuggable/.test(badging)) throw Error('Debug APKs cannot be released.');
  const sizeBytes = (await fsp.stat(file)).size;
  if (!sizeBytes || sizeBytes > MAX_BYTES) throw Error('APK size is invalid (maximum 250 MB).');
  const hash = crypto.createHash('sha256'); for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return { packageName: pkg[1], versionCode: Number(pkg[2]), versionName: pkg[3], minSdk: Number(badging.match(/sdkVersion:'(\d+)'/)?.[1] || 1), certificateSha256: pinned, sha256: hash.digest('hex'), sizeBytes };
}
async function register(file, notes, actor) {
  const info = await inspect(file); if (!Number.isSafeInteger(info.versionCode) || info.versionCode < 1) throw Error('Invalid APK version.');
  return locked(async rows => {
    if (rows.some(r => r.versionCode === info.versionCode)) throw Error('This version code already exists; increase versionCode.');
    const id = crypto.randomUUID(); const row = { id, ...info, notes: String(notes || '').slice(0,1000), status: 'draft', createdAt: new Date().toISOString(), createdBy: String(actor), publishedAt: null };
    await fsp.copyFile(file, apkPath(id), fs.constants.COPYFILE_EXCL); rows.push(row); return row;
  });
}
async function publish(id, actor) { return locked(async rows => { const r = rows.find(r=>r.id===id); if (!r || r.status !== 'draft') throw Error('Only draft releases can be published.'); if (rows.some(x=>x.publishedAt && x.versionCode>=r.versionCode)) throw Error('Published versions must increase.'); const info = await inspect(apkPath(id)); if (info.sha256 !== r.sha256) throw Error('APK integrity check failed.'); r.status='published';r.publishedAt=new Date().toISOString();r.publishedBy=String(actor); return r; }); }
async function withdraw(id, actor) { return locked(async rows => { const r=rows.find(r=>r.id===id);if(!r)throw Error('Release not found.'); r.status='withdrawn';r.withdrawnAt=new Date().toISOString();r.withdrawnBy=String(actor);return r; }); }
async function latest() { return (await catalog()).filter(r=>r.status==='published').sort((a,b)=>b.versionCode-a.versionCode)[0] || null; }
function canManage(req) { const ids=(process.env.APP_RELEASE_ADMIN_IDS||'').split(',').map(x=>x.trim()).filter(Boolean); return req.principalType==='admin' && ids.includes(String(req.user._id)); }
module.exports = { MAX_BYTES, root, prepare, catalog, apkPath, inspect, register, publish, withdraw, latest, canManage };
