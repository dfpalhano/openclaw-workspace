const fs = require('fs');
let code = fs.readFileSync('/home/diegopalhano/projects/jess-bot/extension/content.js', 'utf8');

// Add state flags
code = code.replace(
  "let isRunning = false;",
  "let isRunning = false;\nlet isProcessingCommand = false;\nlet isDeepLoading = false;"
);

// Update loadAllAndScrape to respect flags and be safer
code = code.replace(
  /async function loadAllAndScrape\(\) \{[\s\S]*?async function scrapeAndSend\(\) \{/m,
  `async function loadAllAndScrape() {
  if (isProcessingCommand || isDeepLoading) {
    console.log('[Jess Bridge] Skipping deep load (command processing or already loading)');
    return;
  }
  if (!window.location.href.includes('/messages')) return;
  
  isDeepLoading = true;
  console.log('[Jess Bridge] Deep load starting...');
  let iterations = 0;
  const MAX_ITER = 5; // Reduced from 25 to prevent bot detection and extreme slowness

  const getScrollContainer = () =>
    document.querySelector('.inbox-conversations.selected') ||
    document.querySelector('ul.inbox-conversations-list') ||
    document.querySelector('[class*="inbox-conversations"]');

  while (iterations < MAX_ITER) {
    if (isProcessingCommand) {
      console.log('[Jess Bridge] Aborting deep load, command processing started');
      break;
    }

    const prevCount = document.querySelectorAll('.conversation-item').length;

    const loadMoreEl = document.querySelector('li.load-more a, .load-more a, a.load-more');
    if (loadMoreEl) {
      loadMoreEl.click();
      console.log(\`[Jess Bridge] Load more clicked (iter \${iterations})\`);
    } else {
      const container = getScrollContainer();
      if (container) {
        container.scrollTop = container.scrollHeight;
        console.log(\`[Jess Bridge] Scrolled container to bottom (iter \${iterations})\`);
      } else {
        console.log('[Jess Bridge] No load mechanism found — done');
        break;
      }
    }

    await new Promise(r => setTimeout(r, 2000 + Math.random() * 1000)); // Increased delay for safety

    const newCount = document.querySelectorAll('.conversation-item').length;
    if (newCount === prevCount) {
      console.log(\`[Jess Bridge] No new items after iter \${iterations} — done\`);
      break;
    }

    iterations++;
  }

  const count = document.querySelectorAll('.conversation-item').length;
  console.log(\`[Jess Bridge] Deep load done — \${count} conversations visible\`);
  lastScrapeHash = ''; 
  if (!isProcessingCommand) {
    await scrapeAndSend();
  }
  isDeepLoading = false;
}

// ─── Main Loop ──────────────────────────────────────

async function scrapeAndSend() {`
);

// Ensure scrapeAndSend respects isProcessingCommand
code = code.replace(
  /async function scrapeAndSend\(\) \{/,
  `async function scrapeAndSend() {
  if (isProcessingCommand || isDeepLoading) return;`
);

// Update processCommands to use the flag
code = code.replace(
  /async function processCommands\(\) \{[\s\S]*?const commands = await pollCommands\(\);/,
  `async function processCommands() {
  if (shouldStopPollingCycle() || isProcessingCommand) return;

  const commands = await pollCommands();`
);

code = code.replace(
  /for \(const cmd of commands\) \{/,
  `if (commands.length > 0) isProcessingCommand = true;
  for (const cmd of commands) {`
);

code = code.replace(
  /resetPollErrorCircuit\(\);\n\}/,
  `resetPollErrorCircuit();
  isProcessingCommand = false;
}`
);

// Update intervals
code = code.replace(
  "setInterval(loadAllAndScrape, 10 * 60 * 1000);",
  "setInterval(loadAllAndScrape, 4 * 60 * 60 * 1000); // Once every 4 hours instead of 10 mins"
);

// Add flag check to mutation observer
code = code.replace(
  "window._jessBridgeDebounce = setTimeout(scrapeAndSend, 2000);",
  "if (!isProcessingCommand && !isDeepLoading) window._jessBridgeDebounce = setTimeout(scrapeAndSend, 2000);"
);

// Add flag check to autoNavigateUnreadConversations
code = code.replace(
  /async function autoNavigateUnreadConversations\(\) \{/,
  `async function autoNavigateUnreadConversations() {
  if (isProcessingCommand || isDeepLoading) return;`
);

fs.writeFileSync('/home/diegopalhano/projects/jess-bot/extension/content.js', code);
