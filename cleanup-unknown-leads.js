const fs = require('fs');
const path = require('path');

const inboxFile = '/home/diegopalhano/projects/mission-control/data/jess-inbox.json';
const backupFile = `/home/diegopalhano/projects/mission-control/data/jess-inbox.json.cleanup-backup-${Date.now()}.json`;

console.log('Reading inbox file...');
const data = JSON.parse(fs.readFileSync(inboxFile, 'utf8'));

console.log(`Total leads: ${data.length}`);

// Count unknown leads
const unknownLeads = data.filter(item => !item.houseCode && !item.propertyCode);
console.log(`Unknown leads (no houseCode): ${unknownLeads.length}`);

// Check for bulk-created leads (same timestamp)
const timestampCounts = {};
unknownLeads.forEach(item => {
  const ts = item.createdAt;
  timestampCounts[ts] = (timestampCounts[ts] || 0) + 1;
});

console.log('\nTimestamp analysis:');
Object.entries(timestampCounts)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 5)
  .forEach(([ts, count]) => {
    console.log(`  ${ts}: ${count} leads`);
  });

// Find the bulk timestamp (most common)
const bulkTimestamp = Object.entries(timestampCounts).sort((a, b) => b[1] - a[1])[0];
console.log(`\nBulk timestamp: ${bulkTimestamp[0]} (${bulkTimestamp[1]} leads)`);

// Create cleaned data (remove bulk unknown leads)
const cleanedData = data.filter(item => {
  // Keep leads with house codes
  if (item.houseCode || item.propertyCode) return true;
  
  // Remove leads from bulk timestamp
  if (item.createdAt === bulkTimestamp[0]) {
    console.log(`Removing: ${item.id} - ${item.name} (${item.createdAt})`);
    return false;
  }
  
  // Keep other unknown leads (should be few)
  return true;
});

console.log(`\nAfter cleanup: ${cleanedData.length} leads (removed ${data.length - cleanedData.length})`);

// Create backup
fs.writeFileSync(backupFile, JSON.stringify(data, null, 2));
console.log(`Backup created: ${backupFile}`);

// Write cleaned data
fs.writeFileSync(inboxFile, JSON.stringify(cleanedData, null, 2));
console.log(`Cleaned data written to: ${inboxFile}`);

// Also create archive of removed leads
const removedLeads = data.filter(item => !item.houseCode && !item.propertyCode && item.createdAt === bulkTimestamp[0]);
const archiveFile = `/home/diegopalhano/projects/mission-control/data/jess-inbox-archive-${Date.now()}.json`;
fs.writeFileSync(archiveFile, JSON.stringify(removedLeads, null, 2));
console.log(`Archive created: ${archiveFile} (${removedLeads.length} leads)`);