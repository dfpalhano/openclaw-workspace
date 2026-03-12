const fs = require('fs');
let code = fs.readFileSync('/home/diegopalhano/projects/mission-control/server.js', 'utf8');

const newStatus = `  if (pathname === '/mc/jess/status') {
    const disabled = fs.existsSync(JESS_DISABLED);
    let active = false;
    try { require('child_process').execSync('pgrep -f jess-v3.js', { stdio: 'pipe' }); active = true; } catch(_) {}
    let relayPending = 0;
    try {
      const resp = await fetch('http://localhost:3848/health', { signal: AbortSignal.timeout(1000) });
      if (resp.ok) {
        const data = await resp.json();
        relayPending = data.pendingCommands || 0;
      }
    } catch (_) {
      try {
        const fallback = await fetch('http://localhost:3847/api/status', { signal: AbortSignal.timeout(1000) });
        if (fallback.ok) {
           const d = await fallback.json();
           relayPending = d.pendingCommands || 0;
        }
      } catch(__) {}
    }
    return json(res, 200, { enabled: !disabled, active, relayPending });
  }`;

code = code.replace(/if \(pathname === '\/mc\/jess\/status'\) \{[\s\S]*?return json\(res, 200, \{ enabled: !disabled, active, relayPending \}\);\n  \}/, newStatus);

// Also fix the HTML pill logic if the prompt specifically asked for dots
const oldPill = `        if (st.relayPending > 200) rq.classList.add('status-off');
        else if (st.relayPending > 50) { rq.style.background = '#3A3A1E'; rq.style.color = '#D4C46B'; rq.style.border = '1px solid #D4C46B44'; }
        else rq.classList.add('status-on');`;

const newPill = `        rq.innerHTML = '';
        const dot = document.createElement('span');
        dot.style.display = 'inline-block'; dot.style.width = '8px'; dot.style.height = '8px'; dot.style.borderRadius = '50%'; dot.style.marginRight = '6px';
        if (st.relayPending > 200) { dot.style.background = '#FF4444'; rq.appendChild(dot); rq.appendChild(document.createTextNode(st.relayPending + ' pending')); }
        else if (st.relayPending >= 50) { dot.style.background = '#FFBB33'; rq.appendChild(dot); rq.appendChild(document.createTextNode('Queue OK')); }
        else { dot.style.background = '#00C851'; rq.appendChild(dot); rq.appendChild(document.createTextNode('Queue Clear')); }
        rq.style.background = 'transparent'; rq.style.border = 'none'; rq.style.color = '#aaa'; rq.style.fontWeight = 'bold';`;

code = code.replace(oldPill, newPill);

fs.writeFileSync('/home/diegopalhano/projects/mission-control/server.js', code);
console.log('server.js patched');
