const fs=require('fs');
const data=JSON.parse(fs.readFileSync('/home/diegopalhano/projects/mission-control/data/jess-inbox.json','utf8'));
const rows=data.filter(x=>String(x.houseCode||x.propertyCode||'').toUpperCase()==='SP9').slice(0,10);
console.log(JSON.stringify(rows.map(r=>({name:r.name,lastActive:r.lastActive,unread:r.unread,status:r.status,updatedAt:r.updatedAt})),null,2));