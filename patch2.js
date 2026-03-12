const fs = require('fs');
let code = fs.readFileSync('/home/diegopalhano/projects/jess-bot/extension/content.js', 'utf8');

code = code.replace(
  "let isRunning = false;",
  "let isRunning = false;\nlet isProcessingCommand = false;\nlet isDeepLoading = false;"
);

const loadAllOld = `async function loadAllAndScrape() {
  if (!window.location.href.includes('/messages')) return;
  console.log('[Jess Bridge] Deep load starting...');
  let iterations = 0;
  const MAX_ITER = 25; // load up to ~150+ conversations

  // Confirmed container from Flatmates DOM: .inbox-conversations.selected
  const getScrollContainer = () =>
    document.querySelector('.inbox-conversations.selected') ||
    document.querySelector('ul.inbox-conversations-list') ||
    document.querySelector('[class*="inbox-conversations"]');

  while (iterations < MAX_ITER) {
    const prevCount = document.querySelectorAll('.conversation-item').length;

    // Strategy 1: click "Load more" button if present
    const loadMoreEl = document.querySelector('li.load-more a, .load-more a, a.load-more');
    if (loadMoreEl) {
      loadMoreEl.click();
      console.log(\`[Jess Bridge] Load more clicked (iter \${iterations})\`);
    } else {
      // Strategy 2: scroll bottom of inbox container to trigger infinite scroll
      const container = getScrollContainer();
      if (container) {
        container.scrollTop = container.scrollHeight;
        console.log(\`[Jess Bridge] Scrolled container to bottom (iter \${iterations})\`);
      } else {
        console.log('[Jess Bridge] No load mechanism found — done');
        break;
      }
    }

    await new Promise(r => setTimeout(r, 1200));

    const newCount = document.querySelectorAll('.conversation-item').length;
    if (newCount === prevCount) {
      console.log(\`[Jess Bridge] No new items after iter \${iterations} — done\`);
      break; // nothing loaded, we're at the end
    }

    iterations++;
  }

  const count = document.querySelectorAll('.conversation-item').length;
  console.log(\`[Jess Bridge] Deep load done — \${count} conversations visible\`);
  lastScrapeHash = ''; // force resend after load more — new conversations may be present
  await scrapeAndSend();
}`;

const loadAllNew = `async function loadAllAndScrape() {
  if (isProcessingCommand || isDeepLoading) {
    console.log('[Jess Bridge] Skipping deep load (command processing or already loading)');
    return;
  }
  if (!window.location.href.includes('/messages')) return;
  
  isDeepLoading = true;
  console.log('[Jess Bridge] Deep load starting...');
  let iterations = 0;
  const MAX_ITER = 3; // Drastically reduced from 25 to prevent bot detection and extreme slowness

  // Confirmed container from Flatmates DOM: .inbox-conversations.selected
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
}`;

code = code.replace(loadAllOld, loadAllNew);

code = code.replace(
  "async function scrapeAndSend() {",
  "async function scrapeAndSend() {\n  if (isProcessingCommand || isDeepLoading) return;"
);

code = code.replace(
  "async function processCommands() {\n  if (shouldStopPollingCycle()) return;",
  "async function processCommands() {\n  if (shouldStopPollingCycle() || isProcessingCommand) return;\n  isProcessingCommand = true;"
);

code = code.replace(
  "resetPollErrorCircuit();\n}",
  "resetPollErrorCircuit();\n  isProcessingCommand = false;\n}"
);

code = code.replace(
  "setInterval(loadAllAndScrape, 10 * 60 * 1000);",
  "setInterval(loadAllAndScrape, 4 * 60 * 60 * 1000); // Once every 4 hours instead of 10 mins"
);

code = code.replace(
  "window._jessBridgeDebounce = setTimeout(scrapeAndSend, 2000);",
  "if (!isProcessingCommand && !isDeepLoading) window._jessBridgeDebounce = setTimeout(scrapeAndSend, 2000);"
);

code = code.replace(
  "async function autoNavigateUnreadConversations() {\n  if (!window.location.href.includes('/messages')) return;",
  "async function autoNavigateUnreadConversations() {\n  if (isProcessingCommand || isDeepLoading) return;\n  if (!window.location.href.includes('/messages')) return;"
);

fs.writeFileSync('/home/diegopalhano/projects/jess-bot/extension/content.js', code);
