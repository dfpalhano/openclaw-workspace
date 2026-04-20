const fs=require('fs');
const data=JSON.parse(fs.readFileSync('/home/diegopalhano/projects/mission-control/data/jess-inbox.json','utf8'));
const sp9=data.filter(x=>String(x.houseCode||x.propertyCode||'').toUpperCase()==='SP9');
console.log(`Total SP9 entries: ${sp9.length}`);
const now=Date.now();
const threeDaysAgo=now-(3*24*60*60*1000);
const recent=sp9.filter(x=>new Date(x.updatedAt).getTime()>threeDaysAgo);
console.log(`Recent (last 3 days): ${recent.length}`);
console.log('Recent entries:',recent.map(r=>({name:r.name,updatedAt:r.updatedAt,lastActive:r.lastActive})));