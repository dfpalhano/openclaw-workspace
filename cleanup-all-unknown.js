const fs = require('fs');
const path = require('path');

const inboxFile = '/home/diegopalhano/projects/mission-control/data/jess-inbox.json';
const backupFile = `/home/diegopalhano/projects/mission-control/data/jess-inbox.json.full-cleanup-${Date.now()}.json`;

console.log('Reading inbox file...');
const data = JSON.parse(fs.readFileSync(inboxFile, 'utf8'));

console.log(`Total leads: ${data.length}`);

// Separate known and unknown leads
const knownLeads = data.filter(item => item.houseCode || item.propertyCode);
const unknownLeads = data.filter(item => !item.houseCode && !item.propertyCode);

console.log(`Known leads (with house codes): ${knownLeads.length}`);
console.log(`Unknown leads (no house codes): ${unknownLeads.length}`);

// Create backup
fs.writeFileSync(backupFile, JSON.stringify(data, null, 2));
console.log(`Backup created: ${backupFile}`);

// Write only known leads
fs.writeFileSync(inboxFile, JSON.stringify(knownLeads, null, 2));
console.log(`Cleaned data written: ${knownLeads.length} leads (removed ${unknownLeads.length} unknown)`);

// Create archive of all unknown leads
const archiveFile = `/home/diegopalhano/projects/mission-control/data/jess-inbox-unknown-archive-${Date.now()}.json`;
fs.writeFileSync(archiveFile, JSON.stringify(unknownLeads, null, 2));
console.log(`Archive created: ${archiveFile} (${unknownLeads.length} unknown leads)`);

// Show house code distribution
const houseCounts = {};
knownLeads.forEach(item => {
  const house = item.houseCode || item.propertyCode;
  houseCounts[house] = (houseCounts[house] || 0) + 1;
});

console.log('\nHouse code distribution after cleanup:');
Object.entries(houseCounts)
  .sort((a, b) => b[1] - a[1])
  .forEach(([house, count]) => {
    console.log(`  ${house}: ${count} leads`);
  });