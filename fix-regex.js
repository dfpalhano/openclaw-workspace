const fs = require('fs');
const path = '/home/diegopalhano/projects/mission-control/server.js';
let content = fs.readFileSync(path, 'utf8');

// Find and fix the corrupted regex
const lines = content.split('\n');
let fixed = false;

for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('houseMatch = question.match')) {
    console.log('Found line:', lines[i]);
    // Replace the corrupted regex with clean version
    lines[i] = '      const houseMatch = question.match(/([A-Z]{2,5}\\d{0,2})/);';
    console.log('Fixed line:', lines[i]);
    fixed = true;
    break;
  }
}

if (fixed) {
  content = lines.join('\n');
  fs.writeFileSync(path, content);
  console.log('Fixed regex in server.js');
} else {
  console.log('Could not find the line');
}