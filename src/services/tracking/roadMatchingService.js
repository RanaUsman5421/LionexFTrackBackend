const { createHash } = require('node:crypto');
const pending = new Map();
const MAX_CALLS = 32;
const distance = (a,b) => {
  const rad = x => x*Math.PI/180;
  const x=Math.sin(rad(b.latitude-a.latitude)/2)**2+Math.cos(rad(a.latitude))*Math.cos(rad(b.latitude))*Math.sin(rad(b.longitude-a.longitude)/2)**2;
  return 6371000*2*Math.asin(Math.min(1,Math.sqrt(x)));
};
function splitPoints(points) {
  const runs=[];let run=[];
  for(const point of [...points].sort((a,b)=>new Date(a.timestamp)-new Date(b.timestamp))) {
    const valid=Number.isFinite(point.latitude)&&Math.abs(point.latitude)<=90&&Number.isFinite(point.longitude)&&Math.abs(point.longitude)<=180&&Number.isFinite(new Date(point.timestamp).getTime())&&point.accuracy!=null&&Number.isFinite(Number(point.accuracy))&&Number(point.accuracy)<=25&&Number(point.accuracy)>=0;
    if(!valid){if(run.length)runs.push(run);run=[];continue;}
    const previous=run.at(-1);
    if(previous){
      const seconds=(new Date(point.timestamp)-new Date(previous.timestamp))/1000;
      if(seconds<=0)continue;
      const metres=distance(previous,point);
      if(!point.trackingSessionId||previous.trackingSessionId!==point.trackingSessionId||seconds>120||metres>300||metres/seconds>55){runs.push(run);run=[];}
      else if(metres<3)continue;
    }
    run.push(point);
  }
  if(run.length)runs.push(run);
  return runs;
}
const raw = points => ({matched:false,points:points.map(({latitude,longitude})=>({latitude,longitude}))});
async function matchRoute(points,{key=process.env.GOOGLE_MAPS_ROADS_API_KEY,fetchImpl=fetch}={}) {
  const runs=splitPoints(points),segments=[];
  let calls=0,matchedEdges=0,fallbackEdges=0,failure='',providerFailed=false;
  const started=Date.now();
  for(const run of runs){
    if(run.length<2){segments.push(raw(run));continue;}
    const edges=new Map();
    for(let start=0;start<run.length-1;start+=95){
      const batch=run.slice(start,start+100);
      if(providerFailed||!key||calls>=MAX_CALLS||Date.now()-started>25000){failure ||= key?'Matching limit reached; remaining GPS sections are unverified.':'Road matching is not configured.';break;}
      calls++;
      try {
        const url=new URL('https://roads.googleapis.com/v1/snapToRoads');
        url.searchParams.set('key',key);url.searchParams.set('interpolate','true');
        url.searchParams.set('path',batch.map(p=>`${p.latitude},${p.longitude}`).join('|'));
        const response=await fetchImpl(url,{signal:AbortSignal.timeout(8000)});
        const data=await response.json();
        if(!response.ok){
          const messages={400:'Roads API key or request was rejected. Check backend key configuration.',403:'Roads API access denied. Check API enablement, billing and key restrictions.',429:'Roads API quota reached.'};
          throw new Error(messages[response.status]||'Road matching is temporarily unavailable.');
        }
        const snapped=Array.isArray(data.snappedPoints)?data.snappedPoints:[];
        let anchor=null;
        for(let i=0;i<snapped.length;i++){
          const index=snapped[i].originalIndex;
          if(!Number.isInteger(index)||index<0||index>=batch.length)continue;
          if(anchor&&index===anchor.index+1){
            const path=snapped.slice(anchor.position,i+1).map(p=>({latitude:p.location?.latitude,longitude:p.location?.longitude}));
            const valid=path.length>=2&&path.every(p=>Number.isFinite(p.latitude)&&Math.abs(p.latitude)<=90&&Number.isFinite(p.longitude)&&Math.abs(p.longitude)<=180);
            if(valid&&distance(path[0],batch[anchor.index])<=75&&distance(path.at(-1),batch[index])<=75){
              const length=path.slice(1).reduce((sum,p,j)=>sum+distance(path[j],p),0);
              if(length<=distance(batch[anchor.index],batch[index])*4+100) edges.set(start+anchor.index,path);
            }
          }
          anchor={index,position:i};
        }
      }catch(error){providerFailed=true;failure=error.name==='TimeoutError'?'Road matching timed out.':error.message.startsWith('Road')?error.message:'Road matching is temporarily unavailable.';break;}
      if(start+100>=run.length)break;
    }
    let segment=null;
    for(let i=0;i<run.length-1;i++){
      const path=edges.get(i),matched=Boolean(path),edge=path||raw(run.slice(i,i+2)).points;
      if(matched)matchedEdges++;else fallbackEdges++;
      // Merge only identical shared endpoints. Never bridge different snapped roads.
      const tail=segment?.points.at(-1);
      if(segment&&segment.matched===matched&&tail.latitude===edge[0].latitude&&tail.longitude===edge[0].longitude)segment.points.push(...edge.slice(1));
      else {segment={matched,points:[...edge]};segments.push(segment);}
    }
  }
  return {segments,status:matchedEdges?(fallbackEdges?'partial':'matched'):'raw',message:failure||(fallbackEdges?'Some GPS sections could not be confidently road-matched.':''),sourcePointCount:points.length};
}
function getMatchedRoute(points,scope) {
  const id=createHash('sha256').update(JSON.stringify([scope,points])).digest('hex');
  if(pending.has(id))return pending.get(id);
  if(pending.size>=4)return Promise.resolve({segments:splitPoints(points).map(raw),status:'raw',message:'Road matching is busy; showing unverified GPS sections.',sourcePointCount:points.length});
  // In-flight coalescing only; no Google geometry is stored or cached.
  const task=matchRoute(points).finally(()=>pending.delete(id));pending.set(id,task);return task;
}
module.exports={matchRoute,getMatchedRoute,splitPoints};
