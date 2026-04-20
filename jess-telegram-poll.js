#!/usr/bin/env node
/**
 * Jess Telegram Poller
 * Polls Telegram for messages, forwards to MC /mc/jess/ask, sends replies.
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const TELEGRAM_TOKEN = '8660019141:AAEa8Oaext8nL7-Rbk505lrlbdxlbn5EmX0';
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;
const MC_URL = 'http://localhost:8899/mc/jess/ask';
const POLL_INTERVAL_MS = 3000;
const STATE_FILE = path.join(__dirname, 'jess-telegram-state.json');

let lastUpdateId = 0;
try {
  const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  lastUpdateId = state.lastUpdateId || 0;
} catch (e) {
  // ignore
}

function saveState() {
  fs.writeFileSync(STATE_FILE, JSON.stringify({ lastUpdateId }, null, 2));
}

function httpRequest(options, data = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error(`Parse error: ${e.message}, body: ${body.substring(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    if (data) {
      req.write(JSON.stringify(data));
    }
    req.end();
  });
}

async function getUpdates() {
  try {
    const result = await httpRequest({
      hostname: 'api.telegram.org',
      path: `/bot${TELEGRAM_TOKEN}/getUpdates?offset=${lastUpdateId + 1}&timeout=2&allowed_updates=["message"]`,
      method: 'GET',
    });
    
    if (result.ok && Array.isArray(result.result)) {
      return result.result;
    } else {
      console.error('Telegram error:', JSON.stringify(result));
      return [];
    }
  } catch (error) {
    console.error('getUpdates failed:', error.message, error.stack?.split('\n')[0]);
    return [];
  }
}

async function sendMessage(chatId, text) {
  try {
    const result = await httpRequest({
      hostname: 'api.telegram.org',
      path: `/bot${TELEGRAM_TOKEN}/sendMessage`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }, {
      chat_id: chatId,
      text: text,
    });
    
    if (result.ok) {
      console.log(`Sent to ${chatId}: ${text.substring(0, 50)}...`);
      return true;
    } else {
      console.error('Send failed:', result);
      return false;
    }
  } catch (error) {
    console.error('sendMessage failed:', error.message);
    return false;
  }
}

async function askMC(question) {
  return new Promise((resolve, reject) => {
    const req = http.request(`${MC_URL}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json.answer || 'No answer');
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.write(JSON.stringify({ question }));
    req.end();
  });
}

async function processUpdates() {
  const updates = await getUpdates();
  
  for (const update of updates) {
    lastUpdateId = Math.max(lastUpdateId, update.update_id);
    
    const message = update.message;
    if (!message || !message.text) continue;
    
    const chatId = message.chat.id;
    const text = message.text.trim();
    const userId = message.from.id;
    
    console.log(`[${new Date().toISOString()}] ${userId}: ${text}`);
    
    // Forward to MC
    try {
      const answer = await askMC(text);
      console.log(`MC answer: ${answer.substring(0, 50)}...`);
      
      // Send reply
      await sendMessage(chatId, answer);
    } catch (error) {
      console.error('MC error:', error.message);
      await sendMessage(chatId, 'Sorry, Jess is having trouble right now.');
    }
  }
  
  if (updates.length > 0) {
    saveState();
  }
}

async function main() {
  console.log('Jess Telegram Poller starting...');
  console.log(`Token: ${TELEGRAM_TOKEN.substring(0, 10)}...`);
  console.log(`MC URL: ${MC_URL}`);
  console.log(`Last update ID: ${lastUpdateId}`);
  
  // Test MC connection
  try {
    const test = await askMC('hi');
    console.log(`MC test: ${test}`);
  } catch (error) {
    console.error('MC test failed:', error.message);
    process.exit(1);
  }
  
  // Poll loop
  while (true) {
    try {
      await processUpdates();
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
    } catch (error) {
      console.error('Poll loop error:', error);
      await new Promise(resolve => setTimeout(resolve, 10000));
    }
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error('Fatal:', error);
    process.exit(1);
  });
}

module.exports = { getUpdates, sendMessage, askMC };