const fs = require('fs');
const path = require('path');

const inboxFile = '/home/diegopalhano/projects/mission-control/data/jess-inbox.json';
const backupFile = `/home/diegopalhano/projects/mission-control/data/jess-inbox-year-fix-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;

// Read the data
console.log('Reading inbox data...');
const data = JSON.parse(fs.readFileSync(inboxFile, 'utf8'));
console.log(`Total items: ${data.length}`);

// Create backup
console.log(`Creating backup: ${backupFile}`);
fs.copyFileSync(inboxFile, backupFile);

const now = new Date();
const currentYear = now.getFullYear();
const twoDaysFromNow = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);

let fixedCount = 0;
let messagesExamined = 0;

// Process each item
data.forEach(item => {
  if (item.messageHistory && typeof item.messageHistory === 'object') {
    Object.entries(item.messageHistory).forEach(([key, msg]) => {
      if (msg && msg.ts) {
        messagesExamined++;
        const date = new Date(msg.ts);
        const year = date.getFullYear();
        
        // Only process if year is valid
        if (!isNaN(year) && year >= 2020 && year <= currentYear + 1) {
          // If date is in the future (more than 2 days ahead), adjust year
          if (date > twoDaysFromNow) {
            // Keep subtracting years until date is in the past
            let adjustedYear = year;
            let adjustedDate = new Date(date);
            
            while (adjustedDate > twoDaysFromNow && adjustedYear > 2020) {
              adjustedYear--;
              adjustedDate = new Date(adjustedDate);
              adjustedDate.setFullYear(adjustedYear);
            }
            
            // Update the timestamp
            msg.ts = adjustedDate.toISOString();
            fixedCount++;
            
            console.log(`Fixed: ${year}-${date.getMonth()+1}-${date.getDate()} -> ${adjustedYear}-${adjustedDate.getMonth()+1}-${adjustedDate.getDate()}`);
          }
        }
      }
    });
  }
});

// Write fixed data
console.log('\nFixing years...');
fs.writeFileSync(inboxFile, JSON.stringify(data, null, 2));
console.log('Done!');

console.log('\nSummary:');
console.log(`Messages examined: ${messagesExamined}`);
console.log(`Fixed future timestamps: ${fixedCount}`);
console.log(`Total items: ${data.length}`);

// Test the fix
console.log('\nTesting "past 24 hours" calculation...');
const twentyFourHoursAgo = Date.now() - (24 * 60 * 60 * 1000);
let todayCount = 0;

data.forEach(item => {
  let messageTs = 0;
  
  if (item.messageHistory && typeof item.messageHistory === 'object') {
    Object.values(item.messageHistory).forEach(msg => {
      if (msg && msg.ts) {
        const ts = Date.parse(msg.ts);
        if (ts > messageTs) messageTs = ts;
      }
    });
  }
  
  if (messageTs === 0) {
    messageTs = Date.parse(item.updatedAt || item.createdAt || 0);
  }
  
  // Filter out obviously wrong timestamps
  const date = new Date(messageTs);
  const year = date.getFullYear();
  if (year < 2020 || year > 2027) {
    return;
  }
  
  if (messageTs >= twentyFourHoursAgo) {
    todayCount++;
  }
});

console.log(`Inquiries in last 24h after fix: ${todayCount}`);