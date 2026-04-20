// Command to add improvements to Jess
// Usage: node jess-improve-command.js "question" "solution"

const fs = require('fs');
const path = require('path');

const HELP_LOG = '/home/diegopalhano/projects/mission-control/data/jess-help-log.json';

function addImprovement(question, solution) {
  try {
    let log = { questions: [], improvements: [], lastUpdated: new Date().toISOString() };
    if (fs.existsSync(HELP_LOG)) {
      log = JSON.parse(fs.readFileSync(HELP_LOG, 'utf8'));
    }
    
    log.improvements.push({
      timestamp: new Date().toISOString(),
      question,
      solution,
      applied: true
    });
    
    fs.writeFileSync(HELP_LOG, JSON.stringify(log, null, 2), 'utf8');
    console.log('✅ Improvement added to Jess knowledge base');
    console.log(`Question: ${question}`);
    console.log(`Solution: ${solution}`);
    
    return true;
  } catch (error) {
    console.error('Failed to add improvement:', error.message);
    return false;
  }
}

// If called from command line
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.log('Usage: node jess-improve-command.js "question" "solution"');
    process.exit(1);
  }
  
  const question = args[0];
  const solution = args.slice(1).join(' ');
  addImprovement(question, solution);
}

module.exports = { addImprovement };
