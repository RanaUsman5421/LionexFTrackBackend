const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { protect } = require('../../middleware/auth/authMiddleware');
const releases = require('../../services/updates/appReleaseService');
const router = express.Router();
const manage = (req,res,next) => releases.canManage(req) ? next() : res.status(403).json({success:false,message:'Release management is restricted to configured platform administrators.'});
const handle = fn => async(req,res,next)=>{try{await fn(req,res);}catch(e){if(res.headersSent)return next(e);res.status(e.status||400).json({success:false,message:e.message?.includes('Command failed')?'APK verification failed. Upload a valid signed release APK.':e.message});}};
router.get('/app-updates/latest', handle(async(req,res)=>{const release=await releases.latest();res.set('Cache-Control','no-store').json({success:true,release:release ? {...release,createdBy:undefined,publishedBy:undefined,downloadPath:`/api/app-updates/${release.id}/download`}:null});}));
router.get('/app-updates/download-latest', handle(async(req,res)=>{const release=await releases.latest();res.set('Cache-Control','no-store');if(!release)return res.status(404).json({success:false,message:'No published Android application is available.'});res.redirect(302,`/api/app-updates/${release.id}/download`);}));
router.get('/app-updates/:id/download',handle(async(req,res)=>{
  const release=(await releases.catalog()).find(r=>r.id===req.params.id && r.status==='published');if(!release)return res.status(404).json({success:false,message:'Release is unavailable.'});
  res.set({'Content-Type':'application/vnd.android.package-archive','Cache-Control':'private, no-cache','X-Content-Type-Options':'nosniff','ETag':`"${release.sha256}"`});
  res.download(releases.apkPath(release.id),`fieldtrack-${release.versionCode}.apk`,e=>{if(e && !res.headersSent)res.status(404).end();});
}));
router.get('/admin/app-releases/capability',protect,(req,res)=>res.json({success:true,canManage:releases.canManage(req)}));
router.get('/admin/app-releases',protect,manage,handle(async(req,res)=>res.json({success:true,releases:(await releases.catalog()).sort((a,b)=>b.versionCode-a.versionCode)})));
router.post('/admin/app-releases',protect,manage,handle(async(req,res)=>{
  if(!req.is('application/vnd.android.package-archive') && !req.is('application/octet-stream'))return res.status(415).json({success:false,message:'Upload an APK binary.'});
  if(Number(req.headers['content-length']||0)>releases.MAX_BYTES)return res.status(413).json({success:false,message:'APK exceeds 250 MB.'});
  await releases.prepare();const file=path.join(releases.root(),`${crypto.randomUUID()}.upload`);let bytes=0;
  const limiter=new Transform({transform(chunk,encoding,done){bytes+=chunk.length;if(bytes>releases.MAX_BYTES)return done(Object.assign(Error('APK exceeds 250 MB.'),{status:413}));done(null,chunk);}});
  try {await pipeline(req,limiter,fs.createWriteStream(file,{flags:'wx'}));const notes=decodeURIComponent(String(req.headers['x-release-notes']||''));res.status(201).json({success:true,release:await releases.register(file,notes,req.user._id)});}
  finally {await fs.promises.unlink(file).catch(()=>{});}
}));
router.post('/admin/app-releases/:id/publish',protect,manage,handle(async(req,res)=>res.json({success:true,release:await releases.publish(req.params.id,req.user._id)})));
router.post('/admin/app-releases/:id/withdraw',protect,manage,handle(async(req,res)=>res.json({success:true,release:await releases.withdraw(req.params.id,req.user._id)})));
module.exports=router;
