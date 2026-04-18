#!/usr/bin/env node
/**
 * Jess Telegram Poller - Fixed version
 */

const { exec } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const TELEGRAM_TOKEN = '8328181739:AAGLnEcAKMvGSmFSfypSSk2BYfS4HejG940';
const MC_URL = 'http://localhost:8899/mc/jess/ask';
const STATE_FILE = path.join(__dirname, 'jess-telegram-state.json');
const LOG_FILE = '/tmp/jess-telegram-fixed.log';

function log(msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n');
}

let lastUpdateId = 0;
try {
  const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  lastUpdateId = state.lastUpdateId || 0;
  log(`Loaded state: lastUpdateId=${lastUpdateId}`);
} catch (e) {
  log(`No state file: ${e.message}`);
}

function saveState() {
  fs.writeFileSync(STATE_FILE, JSON.stringify({ lastUpdateId }, null, 2));
}

function askMC(question) {
  return new Promise((resolve, reject) => {
    const req = http.request(`${MC_URL}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000 // 30 second timeout
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
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('MC request timeout'));
    });
    req.write(JSON.stringify({ question }));
    req.end();
  });
}

function sendTelegram(chatId, text) {
  return new Promise((resolve, reject) => {
    // Use JSON.stringify to properly escape
    const payload = JSON.stringify({
      chat_id: chatId,
      text: text
    });
    // Write to temp file to avoid all shell escaping issues
    const tmpFile = `/tmp/jess-telegram-${Date.now()}.json`;
    fs.writeFileSync(tmpFile, payload);
    const cmd = `curl -s -X POST https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage -H "Content-Type: application/json" -d @${tmpFile}`;
    exec(cmd, { timeout: 10000 }, (error, stdout, stderr) => {
      // Clean up temp file
      try { fs.unlinkSync(tmpFile); } catch (_) {}
      if (error) {
        log(`Send error: ${error.message}`);
        reject(error);
      } else {
        try {
          const result = JSON.parse(stdout);
          if (result.ok) {
            resolve(result.result); // Return full result with message_id
          } else {
            log(`Send failed: ${stdout}`);
            reject(new Error(stdout));
          }
        } catch (e) {
          log(`Send parse error: ${e.message}, stdout: ${stdout.substring(0, 100)}`);
          reject(e);
        }
      }
    });
  });
}

function editTelegram(chatId, messageId, text) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      text: text
    });
    // Write to temp file to avoid all shell escaping issues
    const tmpFile = `/tmp/jess-telegram-edit-${Date.now()}.json`;
    fs.writeFileSync(tmpFile, payload);
    const cmd = `curl -s -X POST https://api.telegram.org/bot${TELEGRAM_TOKEN}/editMessageText -H "Content-Type: application/json" -d @${tmpFile}`;
    exec(cmd, { timeout: 10000 }, (error, stdout, stderr) => {
      // Clean up temp file
      try { fs.unlinkSync(tmpFile); } catch (_) {}
      if (error) {
        log(`Edit error: ${error.message}`);
        reject(error);
      } else {
        try {
          const result = JSON.parse(stdout);
          if (result.ok) {
            resolve(true);
          } else {
            log(`Edit failed: ${stdout}`);
            reject(new Error(stdout));
          }
        } catch (e) {
          log(`Edit parse error: ${e.message}, stdout: ${stdout.substring(0, 100)}`);
          reject(e);
        }
      }
    });
  });
}

function getUpdates() {
  return new Promise((resolve, reject) => {
    const cmd = `curl -s "https://api.telegram.org/bot${TELEGRAM_TOKEN}/getUpdates?offset=${lastUpdateId + 1}&timeout=5"`;
    log(`Executing: ${cmd.substring(0, 80)}...`);
    exec(cmd, { timeout: 10000 }, (error, stdout, stderr) => {
      if (error) {
        log(`Curl error: ${error.code} ${error.message}`);
        reject(error);
      } else if (stderr) {
        log(`Curl stderr: ${stderr}`);
        reject(new Error(stderr));
      } else {
        try {
          const result = JSON.parse(stdout);
          if (result.ok && Array.isArray(result.result)) {
            resolve(result.result);
          } else {
            // Handle conflict gracefully
            if (result.error_code === 409) {
              log(`Conflict detected, will retry later: ${result.description}`);
              resolve([]); // Empty updates, not an error
            } else {
              log(`Telegram API error: ${stdout}`);
              resolve([]);
            }
          }
        } catch (e) {
          log(`Parse error: ${e.message}, stdout: ${stdout.substring(0, 100)}`);
          reject(e);
        }
      }
    });
  });
}

async function main() {
  log('Jess Telegram Fixed Poller starting...');
  
  // Test MC
  try {
    const test = await askMC('hi');
    log(`MC test: ${test}`);
  } catch (error) {
    log(`MC test failed: ${error.message}`);
    process.exit(1);
  }
  
  let conflictCount = 0;
  const MAX_CONFLICT_BACKOFF = 30000; // 30 seconds
  
  while (true) {
    try {
      const updates = await getUpdates();
      log(`Got ${updates.length} updates`);
      
      // Reset conflict count if we got updates successfully
      if (updates.length > 0) {
        conflictCount = 0;
      }
      
      for (const update of updates) {
        lastUpdateId = Math.max(lastUpdateId, update.update_id);
        
        const message = update.message;
        if (!message || !message.text) continue;
        
        const chatId = message.chat.id;
        const text = message.text.trim();
        const userId = message.from.id;
        
        log(`Message from ${userId}: ${text}`);
        
        try {
          // Check for /jess scrape command
          if (text.trim().toLowerCase() === '/jess scrape') {
            log('Manual scrape requested');
            // Send immediate response
            await sendTelegram(chatId, 'Scraping Flatmates inbox now... This may take a minute.');
            
            // Trigger scrape in background
            exec('cd /home/diegopalhano/projects/jess-bot && node -e "const ns=require(\'./modules/natural-scraper\'); ns.triggerFullScrape().then(r=>console.log(\'Scrape triggered:\',r)).catch(e=>console.error(e))"', 
              (error, stdout, stderr) => {
                log(`Scrape trigger result: ${stdout} ${stderr}`);
                // Send completion message
                sendTelegram(chatId, 'Scrape completed. You can now ask for updated counts.');
              }
            );
            continue;
          }
          
          // Send "working" message
          const workingMsg = await sendTelegram(chatId, "Working on it... ⏳");
          const workingMsgId = workingMsg.message_id;
          
          const answer = await askMC(text);
          log(`MC answer: ${answer.substring(0, 50)}...`);
          
          // Edit the working message with final answer
          await editTelegram(chatId, workingMsgId, answer);
          log(`Updated reply to ${chatId}`);
        } catch (error) {
          log(`Processing error: ${error.message}`);
          // If error, send error message
          await sendTelegram(chatId, `Error: ${error.message}`);
        }
      }
      
      if (updates.length > 0) {
        saveState();
      }
      
      // Exponential backoff for conflicts
      let waitTime = 1000;
      if (updates.length === 0) {
        conflictCount++;
        if (conflictCount > 5) {
          waitTime = Math.min(1000 * Math.pow(2, conflictCount - 5), MAX_CONFLICT_BACKOFF);
          log(`Conflict backoff: ${waitTime}ms (count: ${conflictCount})`);
        }
      } else {
        conflictCount = 0;
      }
      
      await new Promise(resolve => setTimeout(resolve, waitTime));
    } catch (error) {
      log(`Poll loop error: ${error.message}`);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}

if (require.main === module) {
  main().catch(error => {
    log(`Fatal: ${error.message}`);
    process.exit(1);
  });
}