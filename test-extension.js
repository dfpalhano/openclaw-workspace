console.log("[TEST] Extension loaded!");

async function testScrape() {
  console.log("[TEST] Checking if on /messages...");
  console.log("[TEST] window.location.pathname:", window.location.pathname);
  console.log("[TEST] isInboxRootPage?", /^\/messages\/?$/.test(window.location.pathname));
  
  // Try to find conversation items
  const items = document.querySelectorAll('.conversation-item');
  console.log("[TEST] Found", items.length, "conversation items");
  
  if (items.length > 0) {
    const firstItem = items[0];
    console.log("[TEST] First item HTML:", firstItem.outerHTML.substring(0, 200));
  }
}

// Run test after page loads
if (document.readyState === 'complete') {
  testScrape();
} else {
  window.addEventListener('load', testScrape);
}
