const History=require('../../models/tracking/LocationHistory');
const Bucket=require('../../models/tracking/DistanceSummaryBucket');
const State=require('../../models/tracking/DistanceSummaryState');
const initializing=new Map(),computing=new Map();
const HOUR=3600000;
const hourOf=value=>new Date(Math.floor(new Date(value).getTime()/HOUR)*HOUR);
const km=(a,b)=>{const rad=x=>x*Math.PI/180;const x=Math.sin(rad(b.latitude-a.latitude)/2)**2+Math.cos(rad(a.latitude))*Math.cos(rad(b.latitude))*Math.sin(rad(b.longitude-a.longitude)/2)**2;return 12742*Math.asin(Math.min(1,Math.sqrt(x)))};
const anchor=row=>({latitude:Number(row.location?.coordinates?.[1]),longitude:Number(row.location?.coordinates?.[0]),timestamp:new Date(row.timestamp),trackingSessionId:row.trackingSessionId||null});
const valid=p=>Number.isFinite(p.latitude)&&Number.isFinite(p.longitude)&&Number.isFinite(p.timestamp.getTime());
function edge(a,b,{utcDays=false,cap=false}={}){
 if(!a||!b||!a.trackingSessionId||a.trackingSessionId!==b.trackingSessionId)return 0;
 if(utcDays&&new Date(a.timestamp).toISOString().slice(0,10)!==new Date(b.timestamp).toISOString().slice(0,10))return 0;
 const distance=km(a,b);return Number.isFinite(distance)&&(!cap||distance<=20)?distance:0;
}
function metricsFor(rows){
 let first=null,last=null,distanceKm=0,reportDistanceKm=0,points=0;
 for(const row of rows){const p=anchor(row);if(!valid(p))continue;first ||= p;distanceKm+=edge(last,p);reportDistanceKm+=edge(last,p,{cap:true});last=p;points++;}
 return {first,last,distanceKm,reportDistanceKm,points};
}
async function dirty(organizationId,employeeId,rows){
 const hours=[...new Set(rows.map(row=>hourOf(row.timestamp).toISOString()))];if(!hours.length)return;
 await Bucket.bulkWrite(hours.map(hour=>({updateOne:{filter:{organizationId,employeeId,hour:new Date(hour)},update:{$inc:{generation:1},$setOnInsert:{computedGeneration:-1}},upsert:true}})),{ordered:false});
}
async function initialize(organizationId){
 const key=String(organizationId);if(initializing.has(key))return initializing.get(key);
 const job=(async()=>{
  if((await State.findOne({organizationId}).lean())?.initialized)return;
  // One resumable discovery pass for pre-existing history; never deletes raw data.
  const cursor=History.find({organizationId}).select('employeeId location.coordinates timestamp trackingSessionId').sort({employeeId:1,timestamp:1,_id:1}).lean().cursor({batchSize:1000});
  let ops=[],currentKey='',currentRows=[],currentEmployee='',currentHour=null;
  const flush=async()=>{if(ops.length){await Bucket.bulkWrite(ops,{ordered:false});ops=[]}};
  const finish=()=>{if(currentRows.length)ops.push({updateOne:{filter:{organizationId,employeeId:currentEmployee,hour:currentHour},update:{$setOnInsert:{generation:0,computedGeneration:0,metrics:metricsFor(currentRows)}},upsert:true}})};
  for await(const row of cursor){
   const hour=hourOf(row.timestamp),id=`${row.employeeId}|${hour.toISOString()}`;
   if(currentKey&&currentKey!==id){finish();currentRows=[];if(ops.length>=500)await flush()}
   currentKey=id;currentEmployee=row.employeeId;currentHour=hour;currentRows.push(row);
  }
  finish();
  await flush();await State.updateOne({organizationId},{$set:{initialized:true}},{upsert:true});
 })().finally(()=>initializing.delete(key));initializing.set(key,job);return job;
}
async function rawMetrics(organizationId,employeeId,from,to){return metricsFor(await History.find({organizationId,employeeId,timestamp:{$gte:from,$lte:to}}).select('location.coordinates timestamp trackingSessionId').sort({timestamp:1,_id:1}).lean())}
async function loadMetrics(row){
 if(row.metrics&&row.generation===row.computedGeneration)return row.metrics;
 const key=String(row._id);if(computing.has(key))return computing.get(key);
 const job=(async()=>{
  const result=await rawMetrics(row.organizationId,row.employeeId,row.hour,new Date(new Date(row.hour).getTime()+HOUR-1));
  // Concurrent arrivals increment generation; never publish a clean stale bucket.
  await Bucket.updateOne({_id:row._id,generation:row.generation},{$set:{metrics:result,computedGeneration:row.generation}});
  return result;
 })().finally(()=>computing.delete(key));computing.set(key,job);return job;
}
async function travelSummaries(organizationId,{from,to,employeeId,employeeIds,utcDays=true,cap=false,groupBy=''}={}){
 await initialize(organizationId);
 const query={organizationId};if(employeeId)query.employeeId=employeeId;else if(employeeIds)query.employeeId={$in:employeeIds};
 if(from||to){query.hour={};if(from)query.hour.$gte=hourOf(from);if(to)query.hour.$lte=hourOf(to)}
 const totals=new Map(),previous=new Map();
 const cursor=Bucket.find(query).sort({employeeId:1,hour:1}).lean().cursor({batchSize:500});
 for await(const row of cursor){
  const start=new Date(row.hour),end=new Date(start.getTime()+HOUR-1);
  const partial=(from&&new Date(from)>start)||(to&&new Date(to)<end);
  const m=partial?await rawMetrics(organizationId,row.employeeId,new Date(Math.max(start.getTime(),from?new Date(from).getTime():0)),new Date(Math.min(end.getTime(),to?new Date(to).getTime():Infinity))):await loadMetrics(row);
  if(!m.points)continue;
  const period=groupBy?groupBy(new Date(m.first.timestamp)):'';
  const id=`${row.employeeId}|${period}`;
  const total=totals.get(id)||{employeeId:row.employeeId,period,distanceKm:0,points:0,firstSeen:null,lastSeen:null};
  total.distanceKm+=(cap?m.reportDistanceKm:m.distanceKm)+edge(previous.get(row.employeeId),m.first,{utcDays,cap});
  total.points+=m.points;total.firstSeen ||= new Date(m.first.timestamp);total.lastSeen=new Date(m.last.timestamp);
  totals.set(id,total);previous.set(row.employeeId,m.last);
 }
 return [...totals.values()];
}
module.exports={dirty,travelSummaries,metricsFor,edge,hourOf};
