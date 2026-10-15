require('dotenv').config({quiet:true});
const path=require('node:path');
const releases=require('../src/services/updates/appReleaseService');
(async()=>{
 const [command,arg,...notes]=process.argv.slice(2);
 if(command==='add'){if(!arg)throw Error('Provide a signed APK path.');console.log(JSON.stringify(await releases.register(path.resolve(arg),notes.join(' '),'local-cli'),null,2));}
 else if(command==='publish')console.log(JSON.stringify(await releases.publish(arg,'local-cli'),null,2));
 else if(command==='withdraw')console.log(JSON.stringify(await releases.withdraw(arg,'local-cli'),null,2));
 else if(command==='list')console.log(JSON.stringify(await releases.catalog(),null,2));
 else throw Error('Usage: node scripts/manage-app-release.js add <apk> [notes] | publish <id> | withdraw <id> | list');
})().catch(e=>{console.error(e.message);process.exitCode=1;});
