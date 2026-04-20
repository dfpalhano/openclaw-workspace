#!/usr/bin/env node
/**
 * Simple Telegram poller using curl child process
 */

const { exec } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const TELEGRAM_TOKEN = '8660019141:AAEa8Oaext8nL7-Rbk505lrlbdxlbn5EmX0';
const MC_URL = 'http://localhost:8899/mc/jess/ask';
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

function askMC(question) {
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

function sendTelegram(chatId, text) {
  return new Promise((resolve, reject) => {
    const cmd = `curl -s -X POST https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage -H "Content-Type: application/json" -d '{"chat_id":${chatId},"text":"${text.replace(/"/g, '\\"')}"}'`;
    exec(cmd, (error, stdout, stderr) => {
      if (error) {
        reject(error);
      } else {
        try {
          const result = JSON.parse(stdout);
          resolve(result.ok);
        } catch (e) {
          reject(e);
        }
      }
    });
  });
}

function getUpdates() {
  return new Promise((resolve, reject) => {
    const cmd = `curl -s 'https://api.telegram.org/bot${TELEGRAM_TOKEN}/getUpdates?offset=${lastUpdateId + 1}&timeout=5'`;
    exec(cmd, (error, stdout, stderr) => {
      if (error) {
        reject(error);
      } else {
        try {
          const result = JSON.parse(stdout);
          if (result.ok && Array.isArray(result.result)) {
            resolve(result.result);
          } else {
            resolve([]);
          }
        } catch (e) {
          reject(e);
        }
      }
    });
  });
}

async function main() {
  console.log('Jess Telegram Simple Poller starting...');
  
  while (true) {
    try {
      const updates = await getUpdates();
      
      for (const update of updates) {
        lastUpdateId = Math.max(lastUpdateId, update.update_id);
        
        const message = update.message;
        if (!message || !message.text) continue;
        
        const chatId = message.chat.id;
        const text = message.text.trim();
        const userId = message.from.id;
        
        console.log(`[${new Date().toISOString()}] ${userId}: ${text}`);
        
        try {
          const answer = await askMC(text);
          console.log(`MC answer: ${answer.substring(0, 50)}...`);
          
          await sendTelegram(chatId, answer);
          console.log(`Sent to ${chatId}`);
        } catch (error) {
          console.error('Error:', error.message);
        }
      }
      
      if (updates.length > 0) {
        saveState();
      }
      
      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      console.error('Poll error:', error.message);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error('Fatal:', error);
    process.exit(1);
  });
}