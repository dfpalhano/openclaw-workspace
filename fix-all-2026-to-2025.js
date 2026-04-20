const fs = require('fs');
const path = require('path');

const inboxFile = '/home/diegopalhano/projects/mission-control/data/jess-inbox.json';
const backupFile = `/home/diegopalhano/projects/mission-control/data/jess-inbox-2026-to-2025-fix-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;

// Read the data
console.log('Reading inbox data...');
const data = JSON.parse(fs.readFileSync(inboxFile, 'utf8'));
console.log(`Total items: ${data.length}`);

// Create backup
console.log(`Creating backup: ${backupFile}`);
fs.copyFileSync(inboxFile, backupFile);

let fixedCount = 0;
let messagesExamined = 0;

// Process each item - subtract 1 year from ALL 2026 dates
data.forEach(item => {
  if (item.messageHistory && typeof item.messageHistory === 'object') {
    Object.entries(item.messageHistory).forEach(([key, msg]) => {
      if (msg && msg.ts) {
        messagesExamined++;
        const date = new Date(msg.ts);
        const year = date.getFullYear();
        
        // Only process if year is 2026
        if (year === 2026) {
          // Subtract 1 year
          date.setFullYear(2025);
          msg.ts = date.toISOString();
          fixedCount++;
        }
      }
    });
  }
});

// Also fix extraction timestamps (updatedAt/createdAt)
let extractionFixed = 0;
data.forEach(item => {
  if (item.updatedAt) {
    const date = new Date(item.updatedAt);
    if (date.getFullYear() === 2026) {
      date.setFullYear(2025);
      item.updatedAt = date.toISOString();
      extractionFixed++;
    }
  }
  if (item.createdAt) {
    const date = new Date(item.createdAt);
    if (date.getFullYear() === 2026) {
      date.setFullYear(2025);
      item.createdAt = date.toISOString();
      extractionFixed++;
    }
  }
});

// Write fixed data
console.log('\nConverting 2026 dates to 2025...');
fs.writeFileSync(inboxFile, JSON.stringify(data, null, 2));
console.log('Done!');

console.log('\nSummary:');
console.log(`Messages examined: ${messagesExamined}`);
console.log(`Fixed 2026 message timestamps: ${fixedCount}`);
console.log(`Fixed extraction timestamps: ${extractionFixed}`);
console.log(`Total items: ${data.length}`);

// Check the result
console.log('\nChecking years after fix:');
const yearCounts = {};
data.forEach(item => {
  if (item.messageHistory && typeof item.messageHistory === 'object') {
    Object.values(item.messageHistory).forEach(msg => {
      if (msg && msg.ts) {
        const date = new Date(msg.ts);
        const year = date.getFullYear();
        yearCounts[year] = (yearCounts[year] || 0) + 1;
      }
    });
  }
});

console.log('Message timestamp years:');
Object.entries(yearCounts).sort((a, b) => a[0] - b[0]).forEach(([year, count]) => {
  console.log(`  ${year}: ${count} messages`);
});