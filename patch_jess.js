const fs = require('fs');

let code = fs.readFileSync('/home/diegopalhano/projects/jess-bot/jess-v3.js', 'utf8');

// 1. Add checkRelayJam definition before main()
const checkRelayJamCode = `
// Jam detection state (module-level)
let lastJamAlertLevel = null;
let lastJamAlertTime = 0;

async function checkRelayJam() {
  try {
    const status = await fetch('http://127.0.0.1:3847/api/status').then(r => r.json());
    const q = status.pendingCommands || 0;
    const now = Date.now();
    const alertCooldown = 10 * 60 * 1000; // 10 min

    if (q > 500 && lastJamAlertLevel !== 'critical' && (now - lastJamAlertTime > alertCooldown)) {
      await sendTelegramAlert(\`🚨 *Jess CRITICAL jam* — \${q} commands queued!\\n\\nRefresh the Flatmates tab in Chrome to clear it.\`);
      lastJamAlertLevel = 'critical'; lastJamAlertTime = now;
    } else if (q > 200 && lastJamAlertLevel !== 'warning' && lastJamAlertLevel !== 'critical' && (now - lastJamAlertTime > alertCooldown)) {
      await sendTelegramAlert(\`⚠️ *Jess relay jam* — \${q} commands queued. Refresh Flatmates tab if messages stop sending.\`);
      lastJamAlertLevel = 'warning'; lastJamAlertTime = now;
    } else if (q < 20 && lastJamAlertLevel) {
      await sendTelegramAlert(\`✅ *Jess relay cleared* — queue back to normal (\${q} commands)\`);
      lastJamAlertLevel = null; lastJamAlertTime = 0;
    }
    if (q > 50) log(\`WARN relay queue depth: \${q} commands\`);
  } catch(e) { /* relay may be starting */ }
}

async function sendTelegramAlert(msg) {
  return sendToDiego(msg);
}
`;

if (!code.includes('checkRelayJam()')) {
  code = code.replace('// ─── Main poll loop ───────────────────────────────────────────────────────────', checkRelayJamCode + '\n// ─── Main poll loop ───────────────────────────────────────────────────────────');
}

// 2. Add checkRelayJam() call inside runPollCycle()
if (!code.includes('await checkRelayJam();')) {
  code = code.replace('log(\'─── Starting poll cycle ───\');', 'log(\'─── Starting poll cycle ───\');\n  await checkRelayJam();');
}

// 3. Add health endpoint in callbackServer
const healthEndpointCode = `
    if (req.method === 'GET' && (req.url === '/health' || req.url === '/status')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      let pending = 0;
      try {
         const st = await httpJsonRequest('http://127.0.0.1:3847/api/status', 'GET');
         pending = st.pendingCommands || 0;
      } catch(e) {}
      res.end(JSON.stringify({ ok: true, pendingCommands: pending }));
      return;
    }
`;
if (!code.includes("req.url === '/health'")) {
  code = code.replace("if (req.method !== 'POST' || req.url !== RELAY_CALLBACK_PATH) {", healthEndpointCode + "    if (req.method !== 'POST' || req.url !== RELAY_CALLBACK_PATH) {");
}

fs.writeFileSync('/home/diegopalhano/projects/jess-bot/jess-v3.js', code);
console.log('jess-v3.js patched');

