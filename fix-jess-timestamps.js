const fs = require('fs');
const path = require('path');

const inboxFile = '/home/diegopalhano/projects/mission-control/data/jess-inbox.json';
const backupFile = `/home/diegopalhano/projects/mission-control/data/jess-inbox-timestamp-fix-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;

// Read the data
console.log('Reading inbox data...');
const data = JSON.parse(fs.readFileSync(inboxFile, 'utf8'));
console.log(`Total items: ${data.length}`);

// Create backup
console.log(`Creating backup: ${backupFile}`);
fs.copyFileSync(inboxFile, backupFile);

let fixedCount = 0;
let removed2001Count = 0;
let removedFutureCount = 0;

// Process each item
const now = new Date();
const currentYear = now.getFullYear();
const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);

data.forEach(item => {
  if (item.messageHistory && typeof item.messageHistory === 'object') {
    const newMessageHistory = {};
    let hasValidMessages = false;
    
    Object.entries(item.messageHistory).forEach(([key, msg]) => {
      if (msg && msg.ts) {
        const date = new Date(msg.ts);
        const year = date.getFullYear();
        
        // Check for obviously wrong timestamps
        if (year < 2020 || year > currentYear + 1) {
          // Remove 2001 and far future timestamps
          removed2001Count++;
          return;
        }
        
        // If timestamp is in the future (more than 2 days ahead), adjust it
        if (date > twoDaysAgo && date.getTime() - now.getTime() > 2 * 24 * 60 * 60 * 1000) {
          // This is a future timestamp - adjust to current year
          const adjustedDate = new Date(date);
          adjustedDate.setFullYear(currentYear);
          
          // If still in future, subtract 1 year
          if (adjustedDate > twoDaysAgo) {
            adjustedDate.setFullYear(currentYear - 1);
          }
          
          msg.ts = adjustedDate.toISOString();
          fixedCount++;
          removedFutureCount++;
        }
        
        newMessageHistory[key] = msg;
        hasValidMessages = true;
      } else {
        newMessageHistory[key] = msg;
        hasValidMessages = true;
      }
    });
    
    if (hasValidMessages) {
      item.messageHistory = newMessageHistory;
    } else {
      // No valid messages - remove messageHistory
      delete item.messageHistory;
    }
  }
});

// Write fixed data
console.log('\nFixing timestamps...');
fs.writeFileSync(inboxFile, JSON.stringify(data, null, 2));
console.log('Done!');

console.log('\nSummary:');
console.log(`Fixed future timestamps: ${fixedCount}`);
console.log(`Removed 2001/far future timestamps: ${removed2001Count}`);
console.log(`Total items after cleanup: ${data.length}`);

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