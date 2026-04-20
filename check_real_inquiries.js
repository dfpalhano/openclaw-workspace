const fs = require('fs');
const data = JSON.parse(fs.readFileSync('/home/diegopalhano/projects/mission-control/data/jess-inbox.json', 'utf8'));

const now = Date.now();
const sevenDaysAgo = now - (7 * 24 * 60 * 60 * 1000);

// Filter inquiries from last 7 days
const recent = data.filter(item => {
  const updated = new Date(item.updatedAt || 0).getTime();
  return updated > sevenDaysAgo;
});

console.log(`Total inquiries in inbox: ${data.length}`);
console.log(`Recent inquiries (last 7 days): ${recent.length}`);

// Group by house
const byHouse = {};
recent.forEach(item => {
  const house = item.houseCode || item.propertyCode || 'unknown';
  byHouse[house] = byHouse[house] || [];
  byHouse[house].push(item);
});

// Show counts per house
console.log('\nBy house (last 7 days):');
Object.entries(byHouse).forEach(([house, items]) => {
  console.log(`  ${house}: ${items.length} inquiries`);
});

// Show sample of recent items
console.log('\nSample recent items:');
recent.slice(0, 5).forEach(item => {
  console.log(`  - ${item.name} (${item.houseCode || 'unknown'}): ${item.updatedAt}`);
});