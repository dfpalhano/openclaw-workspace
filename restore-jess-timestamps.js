const fs = require('fs');
const path = require('path');

console.log('🔧 Restoring original timestamps to Jess inbox data...\n');

// Load current cleaned data
const currentPath = '/home/diegopalhano/projects/mission-control/data/jess-inbox.json';
const backupPath = '/home/diegopalhano/projects/mission-control/data/jess-inbox.json.backup-20260418-184525';

const currentData = JSON.parse(fs.readFileSync(currentPath, 'utf8'));
const backupData = JSON.parse(fs.readFileSync(backupPath, 'utf8'));

console.log(`Current data: ${currentData.length} items (cleaned)`);
console.log(`Backup data: ${backupData.length} items (original with timestamps)\n`);

// Create map of backup items by ID for quick lookup
const backupMap = new Map();
backupData.forEach(item => {
  if (item.id) {
    backupMap.set(item.id, item);
  }
});

console.log(`Backup items with IDs: ${backupMap.size}`);

// Restore timestamps for current items
let updatedCount = 0;
let missingCount = 0;

const restoredData = currentData.map(item => {
  if (!item.id) {
    missingCount++;
    return item; // Keep as-is if no ID
  }
  
  const backupItem = backupMap.get(item.id);
  if (backupItem) {
    // Restore original timestamps
    const restored = { ...item };
    if (backupItem.updatedAt) restored.updatedAt = backupItem.updatedAt;
    if (backupItem.createdAt) restored.createdAt = backupItem.createdAt;
    updatedCount++;
    return restored;
  } else {
    missingCount++;
    return item; // Keep as-is if not in backup
  }
});

console.log(`\n📊 Results:`);
console.log(`- Items with restored timestamps: ${updatedCount}`);
console.log(`- Items without backup match: ${missingCount}`);

// Save restored data
const outputPath = '/home/diegopalhano/projects/mission-control/data/jess-inbox-restored.json';
fs.writeFileSync(outputPath, JSON.stringify(restoredData, null, 2));
console.log(`\n💾 Saved restored data to: ${outputPath}`);

// Create backup of current data before replacing
const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const backupCurrentPath = `/home/diegopalhano/projects/mission-control/data/jess-inbox-timestamp-fix-backup-${timestamp}.json`;
fs.copyFileSync(currentPath, backupCurrentPath);
console.log(`📦 Created backup of current data: ${backupCurrentPath}`);

// Replace current data with restored data
fs.copyFileSync(outputPath, currentPath);
console.log(`✅ Replaced current data with restored timestamps!`);

// Verify the fix
console.log(`\n🔍 Verification:`);
const verifyData = JSON.parse(fs.readFileSync(currentPath, 'utf8'));
const now = Date.now();
const twentyFourHoursAgo = now - (24 * 60 * 60 * 1000);
let count24h = 0;
verifyData.forEach(item => {
  const ts = Date.parse(item.updatedAt || item.createdAt || 0);
  if (ts >= twentyFourHoursAgo) {
    count24h++;
  }
});

console.log(`- Total inquiries: ${verifyData.length}`);
console.log(`- Inquiries in last 24h: ${count24h}`);
console.log(`- Percentage: ${Math.round((count24h / verifyData.length) * 100)}%`);

if (count24h < 10) {
  console.log(`\n🎉 SUCCESS! Timestamps restored to realistic values.`);
} else {
  console.log(`\n⚠️  WARNING: Still showing ${count24h} inquiries in last 24h.`);
}