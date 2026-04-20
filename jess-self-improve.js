// Jess self-improvement system
// When Jess doesn't know something, she calls this endpoint to ask Atlas for help

const fs = require('fs');
const path = require('path');

const HELP_LOG = '/home/diegopalhano/projects/mission-control/data/jess-help-log.json';

// Load or create help log
function loadHelpLog() {
  try {
    if (fs.existsSync(HELP_LOG)) {
      return JSON.parse(fs.readFileSync(HELP_LOG, 'utf8'));
    }
  } catch (e) {}
  return { questions: [], improvements: [], lastUpdated: new Date().toISOString() };
}

// Save help log
function saveHelpLog(log) {
  log.lastUpdated = new Date().toISOString();
  fs.writeFileSync(HELP_LOG, JSON.stringify(log, null, 2), 'utf8');
}

// Add a question Jess couldn't answer
function logUnansweredQuestion(question, context, jessResponse) {
  const log = loadHelpLog();
  log.questions.push({
    timestamp: new Date().toISOString(),
    question,
    context,
    jessResponse,
    resolved: false
  });
  saveHelpLog(log);
  
  // Send notification to Atlas (via Telegram or internal message)
  sendToAtlas(question, context, jessResponse);
}

// Add an improvement (solution from Atlas)
function logImprovement(question, solution, implementation) {
  const log = loadHelpLog();
  log.improvements.push({
    timestamp: new Date().toISOString(),
    question,
    solution,
    implementation,
    applied: false
  });
  saveHelpLog(log);
}

// Send to Atlas (placeholder - implement actual notification)
function sendToAtlas(question, context, jessResponse) {
  console.log(`[JESS-HELP] Jess needs help with: "${question}"`);
  console.log(`[JESS-HELP] Context: ${JSON.stringify(context)}`);
  console.log(`[JESS-HELP] Jess tried: ${jessResponse}`);
  
  // TODO: Implement actual notification to Atlas
  // Could be: Telegram message, internal API call, etc.
}

// Check if we have a solution for a similar question
function findSimilarSolution(question) {
  const log = loadHelpLog();
  // Simple keyword matching for now
  const keywords = question.toLowerCase().split(/\s+/);
  
  for (const imp of log.improvements) {
    if (imp.applied) {
      const impKeywords = imp.question.toLowerCase().split(/\s+/);
      const matchCount = keywords.filter(k => impKeywords.some(ik => ik.includes(k) || k.includes(ik))).length;
      if (matchCount >= 2) { // At least 2 keyword matches
        return imp;
      }
    }
  }
  return null;
}

module.exports = {
  loadHelpLog,
  logUnansweredQuestion,
  logImprovement,
  findSimilarSolution
};
