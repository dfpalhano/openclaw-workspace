// Patch to add self-improvement to Jess

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

// Check if Jess gave an "I don't know" type response
function isUncertainResponse(answer) {
  const uncertainPhrases = [
    "i don't know",
    "i'm not sure",
    "i can't answer",
    "i don't have enough",
    "i need more",
    "unclear",
    "ambiguous",
    "could you clarify",
    "please provide",
    "what do you mean",
    "which house",
    "which room",
    "when are you",
    "what is your"
  ];
  
  const lower = answer.toLowerCase();
  return uncertainPhrases.some(phrase => lower.includes(phrase));
}

// Log when Jess is uncertain
function logIfUncertain(question, answer, context) {
  if (isUncertainResponse(answer)) {
    const log = loadHelpLog();
    log.questions.push({
      timestamp: new Date().toISOString(),
      question,
      answer,
      context,
      resolved: false
    });
    saveHelpLog(log);
    
    // Send notification to Atlas via Telegram
    try {
      const { notifyAtlas } = require('/home/diegopalhano/.openclaw/workspace/jess-atlas-notify.js');
      notifyAtlas(question, answer, context);
      console.log(`[JESS-HELP] Sent help request to Atlas for: "${question}"`);
    } catch (error) {
      console.error(`[JESS-HELP] Failed to notify Atlas:`, error.message);
    }
  }
}

// Add improvement from Atlas
function addImprovement(question, solution) {
  const log = loadHelpLog();
  log.improvements.push({
    timestamp: new Date().toISOString(),
    question,
    solution,
    applied: true
  });
  saveHelpLog(log);
}

module.exports = {
  loadHelpLog,
  logIfUncertain,
  addImprovement,
  isUncertainResponse
};
