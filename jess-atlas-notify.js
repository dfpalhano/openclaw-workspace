// Jess to Atlas notification system
// When Jess is uncertain, she sends a Telegram message to Atlas asking for help

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const TELEGRAM_BOT_TOKEN = '8328181739:AAGLnEcAKMvGSmFSfypSSk2BYfS4HejG940'; // Jess bot token
const ATLAS_CHAT_ID = '1267601160'; // Your Telegram chat ID

// Send Telegram message to Atlas
function sendToAtlas(message) {
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const data = {
      chat_id: ATLAS_CHAT_ID,
      text: message,
      parse_mode: 'HTML'
    };
    
    // Use temp file to avoid shell escaping issues
    const tempFile = '/tmp/jess-telegram-' + Date.now() + '.json';
    fs.writeFileSync(tempFile, JSON.stringify(data));
    
    const cmd = `curl -s -X POST "${url}" -H "Content-Type: application/json" --data-binary @${tempFile}`;
    execSync(cmd, { stdio: 'pipe' });
    
    fs.unlinkSync(tempFile);
    return true;
  } catch (error) {
    console.error('Failed to send Telegram message:', error.message);
    return false;
  }
}

// Format a help request from Jess
function formatHelpRequest(question, answer, context) {
  const timestamp = new Date().toLocaleString('en-AU', { timeZone: 'Australia/Brisbane' });
  
  return `🚨 <b>JESS NEEDS HELP</b> 🚨

<b>Question:</b> ${question}

<b>Jess tried:</b> ${answer}

<b>Context:</b>
• House: ${context.houseCode || 'Not specified'}
• Timeframe: ${context.requestedDays} days
• Counts: ${context.count3} (3d), ${context.count7} (7d), ${context.onlineAtLeast3DaysAgo} (online ≥3d)

<b>Timestamp:</b> ${timestamp}

<b>Please reply with:</b>
1. What Jess should have answered
2. Any missing data she needs
3. How to improve her prompt`;
}

// Main function to notify Atlas
function notifyAtlas(question, answer, context) {
  const message = formatHelpRequest(question, answer, context);
  return sendToAtlas(message);
}

module.exports = {
  notifyAtlas,
  formatHelpRequest,
  sendToAtlas
};
