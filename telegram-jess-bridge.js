#!/usr/bin/env node
/**
 * Simple Telegram ↔ Jess MC bridge
 * Polls Telegram for new messages, forwards to MC /mc/jess/ask, sends reply back.
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN; // Not needed if using Composio
const MC_URL = 'http://localhost:8899/mc/jess/ask';
const POLL_INTERVAL_MS = 5000;
const STATE_FILE = path.join(__dirname, 'telegram-jess-state.json');

// Store last update_id
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

function callMC(question) {
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

// This is a skeleton. Actual Telegram polling would need the Bot API.
// Since we have Composio connection, we'd need to integrate with Composio SDK.
// For now, just showing the concept.

console.log('Telegram-Jess bridge would run here');
console.log('Would poll Telegram, forward to MC, send replies');
console.log('But need Composio integration or direct Bot API token');

// To implement:
// 1. Get Telegram Bot API token
// 2. Poll https://api.telegram.org/bot${TELEGRAM_TOKEN}/getUpdates
// 3. For each new message, call MC
// 4. Send reply via https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage
// 5. Update lastUpdateId

process.exit(0);