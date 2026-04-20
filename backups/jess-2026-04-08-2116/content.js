/**
 * Jess Flatmates Bridge — Content Script
 * Runs on flatmates.com.au/messages*
 * Scrapes conversations and messages from the DOM,
 * routes all relay communication through background script (avoids mixed content).
 */

const POLL_INTERVAL = 15000; // 15 seconds
const SCRAPE_INTERVAL = 15000; // 15 seconds — continuous monitoring
const POLL_ERROR_WINDOW_MS = 60000;
const POLL_ERROR_LIMIT = 5;

let lastScrapeHash = '';
let isRunning = false;
let isProcessingCommand = false;
let isDeepLoading = false;
let pollStopped = false;
let contextInvalidationLogged = false;
let runtimeUnavailableLogged = false;
let pollCircuitBreakerLogged = false;
let pollErrorTimestamps = [];
let cmdRuntimeUnavailableCount = 0;
let cmdRuntimeBackoffUntil = 0;

// ─── Runtime Guards ─────────────────────────────────

function isRuntimeAvailable() {
  return typeof chrome !== 'undefined' && !!chrome.runtime?.id;
}

function logRuntimeUnavailableOnce() {
  if (runtimeUnavailableLogged) return;
  runtimeUnavailableLogged = true;
  console.warn('[Jess] Chrome runtime unavailable — stopping.');
}

function isContextInvalidated(err) {
  return !!(err && (
    err.message?.includes('Extension context invalidated') ||
    err.message?.includes('Cannot read properties of undefined') ||
    chrome?.runtime?.id === undefined
  ));
}

function stopPollingForInvalidatedContext(err) {
  if (!contextInvalidationLogged) {
    contextInvalidationLogged = true;
    console.warn('[Jess] Extension context invalidated — stopping poll loop. Reload the extension to resume.', err);
  }
  pollStopped = true;
}

function recordPollErrorAndShouldStop() {
  const now = Date.now();
  pollErrorTimestamps = pollErrorTimestamps.filter((ts) => now - ts <= POLL_ERROR_WINDOW_MS);
  pollErrorTimestamps.push(now);

  if (pollErrorTimestamps.length > POLL_ERROR_LIMIT) {
    if (!pollCircuitBreakerLogged) {
      pollCircuitBreakerLogged = true;
      console.warn('[Jess] Poll loop stopped by circuit breaker after repeated errors (more than 5 in 60 seconds). Reload the extension to resume.');
    }
    pollStopped = true;
    return true;
  }

  return false;
}

function resetPollErrorCircuit() {
  pollErrorTimestamps = [];
  pollCircuitBreakerLogged = false;
}

function shouldStopPollingCycle() {
  if (pollStopped) return true;
  if (!isRuntimeAvailable()) {
    logRuntimeUnavailableOnce();
    // Do NOT set pollStopped here — runtime may recover; let the command processor retry.
    return true;
  }
  return false;
}

// ─── Relay via Background Script ────────────────────

function sendToRelay(endpoint, data) {
  if (!isRuntimeAvailable()) {
    logRuntimeUnavailableOnce();
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: 'relay', endpoint, data }, (resp) => {
        if (chrome.runtime.lastError) {
          console.warn('[Jess Bridge] Background unreachable:', chrome.runtime.lastError.message);
          resolve(null);
          return;
        }
        resolve(resp);
      });
    } catch (err) {
      if (isContextInvalidated(err)) {
        stopPollingForInvalidatedContext(err);
        resolve(null);
        return;
      }
      console.error('[Jess Bridge] Failed to send message to relay:', err);
      resolve(null);
    }
  });
}

function pollCommands() {
  if (shouldStopPollingCycle()) {
    return Promise.resolve([]);
  }

  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: 'relay-get', endpoint: '/api/commands' }, (resp) => {
        if (chrome.runtime.lastError || !resp) {
          resolve([]);
          return;
        }
        resolve(resp.commands || []);
      });
    } catch (err) {
      if (isContextInvalidated(err)) {
        stopPollingForInvalidatedContext(err);
        resolve([]);
        return;
      }
      throw err;
    }
  });
}

// ─── DOM Scrapers ───────────────────────────────────

function extractPropertyCode(url) {
  if (!url) return null;
  const match = url.match(/P(\d+)/);
  return match ? `P${match[1]}` : null;
}

function extractRoomId(url) {
  const match = url?.match(/#room(\d+)/);
  return match ? match[1] : null;
}

function extractWaNumberFromProfile() {
  const telLink = document.querySelector('a[href^="tel:"]');
  const fullPhone = telLink?.href?.replace('tel:', '').replace(/\s+/g, '');
  const waNumber = fullPhone?.replace('+', '') || null;
  const partialDisplay = document.querySelector('.verified-mobile .number')?.textContent?.trim() || null;

  return {
    waNumber,
    partialDisplay
  };
}

function classifyFromSnippet(snippet) {
  const s = String(snippet || '').toLowerCase();
  if (/couple|partner|girlfriend|boyfriend|wife|husband|we are|both of us/.test(s)) return 'couple';
  if (/student/.test(s)) return 'student';
  if (/working holiday|whv/.test(s)) return 'whv';
  if (/professional|work in|employed|full.time/.test(s)) return 'professional';
  return 'unknown';
}

function scrapeConversationList() {
  const convItems = document.querySelectorAll('.conversation-item');
  const conversations = [];
  const unreadCount = Number.parseInt(
    document.querySelector('.counts a')?.textContent?.match(/(\d+)/)?.[1] || '0',
    10
  ) || 0;

  if (convItems.length === 0) {
    conversations.unreadTotal = unreadCount;
    return conversations;
  }

  convItems.forEach((item) => {
    const link = item.querySelector('.conversation-link');
    const href = link?.href || link?.getAttribute('href') || null;
    const threadId = href?.match(/\/messages\/(\d+)/)?.[1] || null;
    const avatarImg = item.querySelector('.avatar-img')?.src || null;
    const initial = item.querySelector('.initial')?.textContent?.trim() || null;
    const name = item.querySelector('.member')?.textContent?.trim() || initial || null;
    const lastActive = item.querySelector('.last-active')?.textContent?.trim() || null;
    const snippet = item.querySelector('.snippet')?.textContent?.replace(/^\s*\S*\s/, '').trim() || null;
    const isUnread = item.classList.contains('unread');

    // Extract subject link — try all possible selectors for inbox list rows
    const _subjectSelectors = [
      'div.inbox-messages-subject > a.detail',
      'div.inbox-messages-subject > a',
      '.inbox-messages-subject a',
      'a.detail[href*="flatmates"]',
      'a[href*="flatmates.com.au/share"]',
      'a[href*="/share-"]',
      '.conversation-subject a',
      '.subject a',
      'a.listing-link',
    ];
    let subjectLink = null;
    let _usedSelector = null;
    for (const _sel of _subjectSelectors) {
      subjectLink = item.querySelector(_sel);
      if (subjectLink) { _usedSelector = _sel; break; }
    }
    // Also try any link that looks like a listing URL
    if (!subjectLink) {
      const allLinks = Array.from(item.querySelectorAll('a[href]'));
      subjectLink = allLinks.find(a => {
        const h = a.href || '';
        return h.includes('flatmates.com.au/share') || h.match(/P\d{5,}/) || h.includes('/room-');
      }) || null;
      if (subjectLink) _usedSelector = 'any-listing-link-fallback';
    }
    const subjectHref = subjectLink?.href || subjectLink?.getAttribute('href') || null;
    const subjectText = subjectLink?.textContent?.trim() || null;
    let listingId = null;
    if (subjectHref) {
      const pMatch = subjectHref.match(/[?&/]P?(\d{6,})/i) || subjectHref.match(/P(\d{6,})/i);
      if (pMatch) listingId = pMatch[1];
    }

    // Browser-side diagnostic: log first 10 rows regardless of unread status
    if (conversations.length < 10) {
      const allItemLinks = Array.from(item.querySelectorAll('a[href]')).map(a => a.href).filter(h => h).slice(0, 5);
      const itemSnippet = item.outerHTML.slice(0, 400).replace(/\n/g, ' ');
      console.log('[Jess Bridge][convRow]', JSON.stringify({
        idx: conversations.length,
        threadId, isUnread, subjectLinkFound: !!subjectLink,
        usedSelector: _usedSelector, subjectHref, listingId,
        allLinks: allItemLinks,
        itemHTMLSnippet: itemSnippet
      }));
    }

    if (!threadId && !href && !name && !snippet) {
      return;
    }

    conversations.push({
      threadId,
      href,
      threadUrl: href,
      name,
      initial,
      avatarImg,
      lastActive,
      snippet,
      lastMessagePreview: snippet,
      isUnread,
      unread: isUnread,
      enquirerType: classifyFromSnippet(snippet),
      rawText: item.textContent?.trim()?.substring(0, 300) || null,
      listingId,
      subjectText,
      subjectHref
    });
  });

  conversations.unreadTotal = unreadCount;
  return conversations;
}

function parseThreadMessageTimestamp(timeSent) {
  if (!timeSent) return null;

  const raw = String(timeSent).trim();
  if (!raw) return null;

  const now = new Date();
  const localNow = new Date(now.toLocaleString('en-US', { timeZone: 'Australia/Brisbane' }));
  const weekdayMap = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6
  };

  const applyTime = (baseDate, timePart) => {
    const m = String(timePart || '').trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
    if (!m) return null;
    let hour = Number(m[1]) % 12;
    const minute = Number(m[2] || '0');
    if (m[3].toLowerCase() === 'pm') hour += 12;
    const d = new Date(baseDate);
    d.setHours(hour, minute, 0, 0);
    return d;
  };

  const yesterdayMatch = raw.match(/^yesterday\s+(.+)$/i);
  if (yesterdayMatch) {
    const base = new Date(localNow);
    base.setDate(base.getDate() - 1);
    const parsed = applyTime(base, yesterdayMatch[1]);
    return parsed ? parsed.toISOString() : null;
  }

  const weekdayMatch = raw.match(/^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)\s+(.+)$/i);
  if (weekdayMatch) {
    const targetDow = weekdayMap[weekdayMatch[1].toLowerCase()];
    const base = new Date(localNow);
    const diff = (base.getDay() - targetDow + 7) % 7;
    base.setDate(base.getDate() - diff);
    const parsed = applyTime(base, weekdayMatch[2]);
    return parsed ? parsed.toISOString() : null;
  }

  const specificDateMatch = raw.match(/^(\d{1,2})\s+([A-Za-z]{3,})\s+(.+)$/i);
  if (specificDateMatch) {
    const day = Number(specificDateMatch[1]);
    const monthText = specificDateMatch[2].slice(0, 3).toLowerCase();
    const monthMap = { jan:0, feb:1, mar:2, apr:3, may:4, jun:5, jul:6, aug:7, sep:8, oct:9, nov:10, dec:11 };
    const month = monthMap[monthText];
    if (month === undefined) return null;
    const base = new Date(localNow.getFullYear(), month, day);
    const parsed = applyTime(base, specificDateMatch[3]);
    return parsed ? parsed.toISOString() : null;
  }

  const direct = new Date(raw);
  if (!Number.isNaN(direct.getTime())) return direct.toISOString();

  return null;
}

function scrapeOpenThread() {
  const messages = [];
  const messageSection = document.querySelector('div.inbox-messages-section');
  const root = messageSection || document;

  // Confirmed Flatmates DOM selectors (verified 2026-03-11)
  const liItems = Array.from(root.querySelectorAll('div.message-body ul li'));

  if (liItems.length > 0) {
    liItems.forEach((li) => {
      // Presence of div.message-details.other-message means it's the enquirer's message
      const otherMessageEl = li.querySelector('div.message-details.other-message');
      const isFromEnquirer = !!otherMessageEl;
      const isMine = !isFromEnquirer;

      // Confirmed selectors (verified 2026-03-11):
      // Incoming: li > div.message-details.other-message > div.message-text > p
      // Outgoing: li > div > div.message-text > p
      // Both use div.message-text > p — wrapper class distinguishes direction
      const messageText = li.querySelector('div.message-text > p')?.textContent?.trim() || null;

      // Timestamp — confirmed selectors per direction
      // Incoming: div.message-details.other-message > div.time-sent
      // Outgoing: div.time-sent > div
      const timeSent = isFromEnquirer
        ? otherMessageEl.querySelector('div.time-sent')?.textContent?.trim() || null
        : li.querySelector('div.time-sent > div')?.textContent?.trim() || null;

      const sentAt = parseThreadMessageTimestamp(timeSent);
      const text = messageText || li.textContent?.trim()?.substring(0, 500);

      messages.push({
        text,
        isMine,
        isFromEnquirer,
        timestamp: timeSent,
        sentAt
      });
    });
  } else {
    // Fallback: try .message-details selector (older DOM or edge cases)
    let elements = Array.from(root.querySelectorAll('.message-details'));

    if (elements.length === 0) {
      const selectors = [
        '[class*="message-bubble"]',
        '[class*="message-item"]',
        '[class*="chat-message"]',
        '[data-testid*="message"]',
        '.message'
      ];
      for (const sel of selectors) {
        elements = Array.from(root.querySelectorAll(sel));
        if (elements.length > 0) break;
      }
    }

    elements.forEach((el) => {
      const messageText = el.querySelector('.message-text p')?.innerText?.trim();
      const timeSent = el.querySelector('.time-sent')?.innerText?.trim();
      const isFromEnquirer = el.classList.contains('other-message');
      const isMine = !isFromEnquirer;
      const text = messageText || el.textContent?.trim()?.substring(0, 500);
      const sentAt = parseThreadMessageTimestamp(timeSent);

      messages.push({
        text,
        isMine,
        isFromEnquirer,
        timestamp: timeSent,
        sentAt
      });
    });
  }

  const threadId = window.location.pathname.match(/\/messages\/(\d+)/)?.[1] || null;

  // ── Extract listing ID (used for reliable house matching) ──────────────────
  // Primary: first item in message list subject line — most reliable when on thread page
  let listingIdEl = document.querySelector('ul > li:nth-child(1) > div.inbox-messages-subject > a');
  // Fallback: SubHeader listing link
  let listingLinkEl = listingIdEl || document.querySelector('div.SubHeader__container___1llko div.inbox-messages-listings a');

  let listingHref = listingLinkEl?.href || listingLinkEl?.getAttribute('href') || window.location.href;
  const listingTitle = listingLinkEl?.textContent?.trim() || null;

  // Extract P-number (listing ID) — try href first, then element id attribute
  let listingId = null;
  let listingUrl = null;
  if (listingLinkEl) {
    const href = listingLinkEl.href || listingLinkEl.getAttribute('href') || '';
    const hrefMatch = href.match(/P(\d+)/i);
    if (hrefMatch) {
      listingId = hrefMatch[1];
      listingUrl = href;
    } else {
      // Try id attribute: id="listingId-1362277"
      const idAttr = listingLinkEl.id || listingLinkEl.getAttribute('id') || '';
      const idMatch = idAttr.match(/listingId-(\d+)/i) || idAttr.match(/(\d{5,})/);
      if (idMatch) listingId = idMatch[1];
    }
  }
  // Last resort: scan href for any Flatmates listing URL P-number
  if (!listingId && listingHref) {
    const fallbackMatch = listingHref.match(/P(\d{5,})/i);
    if (fallbackMatch) listingId = fallbackMatch[1];
  }

  // Enquirer name from mobile header
  const enquirerNameEl = document.querySelector('div.SubHeader__container___1llko div.inbox-messages-mobile h1 a');
  const enquirerName = enquirerNameEl?.textContent?.trim() || null;

  // Detect "no longer active" — Flatmates shows SubHeader__inactive class when person left the platform
  const isThreadInactive = !!document.querySelector('div.SubHeader__container___1llko.SubHeader__inactive___1p0i6');

  const lastEnquirerMessage = [...messages].reverse().find((msg) => msg.isFromEnquirer && msg.sentAt) || null;
  const lastOurMessageIndex = messages.reduce((lastIndex, msg, index) => (
    msg.isMine ? index : lastIndex
  ), -1);
  const enquirerMessagesSinceOurLastReply = messages.slice(lastOurMessageIndex + 1)
    .filter((msg) => msg.isFromEnquirer);
  const { waNumber, partialDisplay } = extractWaNumberFromProfile();

  // ── Selector-based structured age from profile key-features panel ──────────
  // Flatmates shows 3 key feature chips (e.g. "Female", "23", "Student") in a
  // div.styles__keyFeatures___3CJA7 panel visible while a conversation is open.
  // We read all three text values and parse the first numeric one (18-99) as age.
  const profileAge = (() => {
    try {
      const featureEls = document.querySelectorAll(
        'div.styles__keyFeatures___3CJA7 div.styles__text__wrapper___2QRUH > div'
      );
      for (const el of featureEls) {
        const txt = el.textContent?.trim() || '';
        const n = parseInt(txt, 10);
        if (!isNaN(n) && n >= 18 && n <= 99 && String(n) === txt) return n;
      }
    } catch (_) {}
    return null;
  })();

  return {
    threadId,
    personName: enquirerName || document.querySelector('.message-avatar .initial')?.textContent?.trim() || null,
    listingTitle,
    listingId,      // just the number, e.g. "1362277" — no "P" prefix
    listingUrl: listingUrl || listingHref || null,
    propertyCode: extractPropertyCode(listingHref),
    roomId: extractRoomId(listingHref),
    waNumber,
    partialPhoneDisplay: partialDisplay,
    profileAge,     // structured age from profile keyFeatures panel (null if not visible)
    messages,
    lastMessageAt: lastEnquirerMessage?.sentAt || null,
    hasFollowUp: enquirerMessagesSinceOurLastReply.length > 1,
    isThreadInactive,   // true when Flatmates shows "is no longer active" SubHeader
    url: window.location.href
  };
}

// ─── Actions ────────────────────────────────────────

function findReplyInput() {
  const selectors = [
    // Confirmed from Flatmates DOM (2026-03-09)
    'textarea.text-input',
    'textarea[class*="messageInput"]',
    // Fallbacks
    'textarea[class*="message"]',
    'textarea[class*="reply"]',
    'textarea[class*="chat"]',
    'textarea[name*="message"]',
    'textarea[placeholder*="message"]',
    'textarea[placeholder*="reply"]',
    'textarea[placeholder*="type"]',
    'textarea',
    '[contenteditable="true"]',
    'input[type="text"][class*="message"]'
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el) return el;
  }
  return null;
}

function findSendButton() {
  const selectors = [
    // Confirmed from Flatmates DOM (2026-03-09)
    'button.send-button[aria-label="send"]',
    'button.send-button',
    // Fallbacks
    'button[type="submit"]',
    'button[class*="send"]',
    '[class*="send-button"]',
    'button[aria-label*="send" i]',
    'input[type="submit"]'
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el) return el;
  }
  const buttons = document.querySelectorAll('button');
  for (const btn of buttons) {
    if (btn.textContent.toLowerCase().includes('send') || 
        btn.textContent.toLowerCase().includes('reply')) {
      return btn;
    }
  }
  return null;
}

async function typeReply(text) {
  let input = findReplyInput();
  if (!input) {
    console.log('[Jess Bridge] Reply input not found immediately, waiting...');
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 500));
      input = findReplyInput();
      if (input) break;
    }
  }
  if (!input) {
    console.warn('[Jess Bridge] Reply input still not found, aborting send');
    return { success: false, error: 'Reply input not found' };
  }

  input.focus();
  input.click();
  
  if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') {
    // React-controlled input: use native setter to trigger React's synthetic event
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype, 'value'
    )?.set || Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value'
    )?.set;
    if (nativeSetter) {
      nativeSetter.call(input, text);
    } else {
      input.value = text;
    }
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  } else {
    input.textContent = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  await new Promise(r => setTimeout(r, 500 + Math.random() * 1000));
  
  let sendBtn = findSendButton();
  if (!sendBtn) {
    console.log('[Jess Bridge] Send button not found immediately, waiting...');
    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, 500));
      sendBtn = findSendButton();
      if (sendBtn) break;
    }
  }

  if (!sendBtn) {
    console.warn('[Jess Bridge] Send button still not found, aborting send');
    return { success: false, error: 'Send button not found' };
  }

  sendBtn.click();
  console.log('[Jess Bridge] Reply sent:', text.substring(0, 50) + '...');
  return { success: true };
}

// ─── Main Loop ──────────────────────────────────────

async function scrapeAndSend({ forceRefresh = false, bypassGuard = false } = {}) {
  if (!bypassGuard && (isProcessingCommand || isDeepLoading)) return;
  const pageData = {
    url: window.location.href,
    title: document.title,
    timestamp: new Date().toISOString()
  };

  const threadMatch = window.location.pathname.match(/\/messages\/(\d+)/);
  
  if (threadMatch) {
    pageData.type = 'thread';
    pageData.thread = scrapeOpenThread();
  } else {
    pageData.type = 'inbox';
    pageData.conversations = scrapeConversationList();
  }

  const hashSource = pageData.type === 'inbox'
    ? { count: pageData.conversations?.length || 0, unreadTotal: pageData.conversations?.unreadTotal || 0, conversations: pageData.conversations || [] }
    : (pageData.thread?.messages || []);
  const hash = JSON.stringify(hashSource);
  if (pageData.type === 'inbox') {
    await sendToRelay('/api/heartbeat', {
      url: pageData.url,
      type: pageData.type,
      totalUnread: pageData.conversations?.unreadTotal || 0,
      timestamp: pageData.timestamp,
      source: 'content-inbox'
    });
  }

  if (hash === lastScrapeHash && !forceRefresh) {
    if (pageData.type === 'inbox') {
      await sendToRelay('/api/heartbeat', {
        url: pageData.url,
        type: pageData.type,
        totalUnread: pageData.conversations?.unreadTotal || 0,
        timestamp: pageData.timestamp,
        source: 'content-nochange'
      });
    }
    console.log('[Jess Bridge] No changes detected, skipping send');
    return;
  }
  lastScrapeHash = hash;

  const result = await sendToRelay('/api/scrape', pageData);
  if (pageData.type === 'inbox') {
    // Event-driven: after the regular inbox scrape, click into any NEW unread
    // threads we haven't read yet and post their full message history to the relay.
    // This runs in the background so it doesn't block the scrape response.
    processNewUnreadThreads().catch(err =>
      console.warn('[Jess Bridge] processNewUnreadThreads failed:', err)
    );
  }
  if (result) {
    console.log('[Jess Bridge] Scrape sent to relay:', result);
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForSelector(selector, timeoutMs = 2000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const el = document.querySelector(selector);
    if (el) return el;
    await delay(100);
  }
  return document.querySelector(selector);
}

async function waitForCondition(predicate, timeoutMs = 5000, intervalMs = 150) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const value = predicate();
      if (value) return value;
    } catch (_) {}
    await delay(intervalMs);
  }
  return null;
}

async function navigateToListingEditor(listingId) {
  const normalizedListingId = String(listingId || '').replace(/^P/i, '');
  if (!normalizedListingId) throw new Error('Missing listing ID');

  const editSelector = `#listingId-${normalizedListingId} > div.listing-link > span.link-edit`;
  const manageUrl = 'https://flatmates.com.au/manage/listings';

  if (!window.location.href.includes('/manage/listings')) {
    window.location.href = manageUrl;
    await waitForCondition(() => window.location.href.includes('/manage/listings'), 10000, 200);
    await delay(2500);
  }

  let editLink = await waitForSelector(editSelector, 8000);
  if (!editLink) {
    window.location.href = manageUrl;
    await waitForCondition(() => window.location.href.includes('/manage/listings'), 10000, 200);
    await delay(2500);
    editLink = await waitForSelector(editSelector, 8000);
  }
  if (!editLink) {
    throw new Error(`Listing edit link not found for P${normalizedListingId}`);
  }

  editLink.click();
  const roomsContainer = await waitForSelector('div.styles__roomDetails___3Vm1D', 10000);
  if (!roomsContainer) {
    throw new Error('Room details did not load after opening listing editor');
  }
  await delay(1000);
  return roomsContainer;
}

async function toggleListingAvailability(listingId, action) {
  const normalizedAction = String(action || '').toLowerCase();
  if (!['activate', 'deactivate'].includes(normalizedAction)) {
    throw new Error(`Invalid listing toggle action: ${action}`);
  }

  const targetLabel = normalizedAction === 'deactivate' ? 'Set as unavailable' : 'Set as available';
  const resultLabel = normalizedAction === 'deactivate' ? 'unavailable' : 'available';
  const roomsContainer = await navigateToListingEditor(listingId);
  const roomNodes = Array.from(roomsContainer.querySelectorAll(':scope > div'));

  let toggledCount = 0;
  const errors = [];

  for (let index = 0; index < roomNodes.length; index++) {
    const roomNode = roomNodes[index];
    const button = roomNode.querySelector('div.undefined.styles__PROPERTY___1a2AI > div.sc-hiwPVj.hHzOEw > button:nth-child(1)');
    if (!button) continue;

    const labelEl = button.querySelector('span.Button__LabelWithMargin-sc-etylg7-1');
    const labelText = labelEl?.textContent?.trim() || button.textContent?.trim() || '';
    if (labelText !== targetLabel) continue;

    try {
      button.click();
      const switched = await waitForCondition(() => {
        const currentLabel = button.querySelector('span.Button__LabelWithMargin-sc-etylg7-1')?.textContent?.trim() || button.textContent?.trim() || '';
        return currentLabel && currentLabel !== labelText ? currentLabel : null;
      }, 5000, 150);
      if (!switched) {
        throw new Error(`Button label did not change for room ${index + 1}`);
      }
      toggledCount++;
      await delay(800);
    } catch (err) {
      errors.push(`room ${index + 1}: ${err.message}`);
    }
  }

  return {
    success: errors.length === 0,
    action: normalizedAction,
    resultLabel,
    toggledCount,
    errors,
  };
}

function isInboxRootPage() {
  return /^\/messages\/?$/.test(window.location.pathname);
}

async function postThreadToRelay(threadData) {
  if (!threadData?.threadId) return null;
  return sendToRelay('/api/thread', {
    url: window.location.href,
    timestamp: new Date().toISOString(),
    thread: threadData
  });
}

// ─── Visited Thread Tracking ─────────────────────────────────────────────────

const VISITED_STORAGE_KEY = 'jess_visited_threads';

function loadVisitedThreads() {
  try {
    const raw = localStorage.getItem(VISITED_STORAGE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch (_) {
    return new Set();
  }
}

function saveVisitedThreads(visitedSet) {
  try {
    localStorage.setItem(VISITED_STORAGE_KEY, JSON.stringify([...visitedSet]));
  } catch (_) {}
}

/**
 * Process new unread threads in the inbox that haven't been visited yet.
 * Called as part of the default scrape cycle (scrapeAndSend) for inbox pages.
 * Clicks into each unread thread, reads full message history, posts to relay.
 * Applies the same 2-day online / 7-day activity filter as /jess count.
 * Rate-limited to max 5 threads per cycle; visited Set persisted in localStorage.
 */
async function processNewUnreadThreads() {
  if (!isInboxRootPage()) return;
  if (isProcessingCommand || isDeepLoading) return;

  const MAX_ONLINE_DAYS = 2;
  const MAX_MSG_DAYS    = 7;
  const MAX_PER_CYCLE   = 5;

  const visited = loadVisitedThreads();
  const unreadItems = Array.from(document.querySelectorAll('li.conversation-item.unread'));

  if (unreadItems.length === 0) return;

  const toProcess = [];
  for (const item of unreadItems) {
    if (toProcess.length >= MAX_PER_CYCLE) break;

    const link = item.querySelector('a.conversation-link[href^="/messages/"]');
    if (!link) continue;

    const href = link.getAttribute('href') || '';
    const threadId = href.match(/\/messages\/(\d+)/)?.[1];
    if (!threadId || visited.has(threadId)) continue;

    // Apply 2-day online / 7-day activity filter (same as scrapeAllThreadsForCount)
    const lastActiveEl = item.querySelector('div.details > div.last-active') ||
                         item.querySelector('.last-active');
    const lastActiveText = lastActiveEl?.textContent?.trim() || '';
    const daysAgo = parseLastActiveDays(lastActiveText);
    const isInfinite = daysAgo === Infinity; // unparseable → include by default

    const onlineRecently = isInfinite || daysAgo <= MAX_ONLINE_DAYS;
    const msgRecently    = isInfinite || daysAgo <= MAX_MSG_DAYS;

    if (!onlineRecently || !msgRecently) {
      // Stale thread — mark visited so we don't re-check every cycle
      visited.add(threadId);
      continue;
    }

    toProcess.push({ threadId, link });
  }

  if (toProcess.length === 0) {
    saveVisitedThreads(visited);
    return;
  }

  console.log(`[Jess Bridge] processNewUnreadThreads: reading ${toProcess.length} new unread thread(s)`);

  for (const { threadId, link } of toProcess) {
    if (isProcessingCommand || isDeepLoading) break;

    try {
      link.click();

      const msgSection = await waitForSelector('div.inbox-messages-section', 4000);
      if (!msgSection) {
        console.warn(`[Jess Bridge] processNewUnreadThreads: message section not found for thread ${threadId}`);
        visited.add(threadId); // avoid infinite retry
      } else {
        await delay(800); // let messages fully render

        const threadData = scrapeOpenThread();
        if (threadData?.threadId) {
          await postThreadToRelay(threadData);
          console.log(`[Jess Bridge] processNewUnreadThreads: posted thread ${threadId} to relay`);
        }
        visited.add(threadId);
      }
    } catch (err) {
      console.warn(`[Jess Bridge] processNewUnreadThreads: error on thread ${threadId}:`, err);
      visited.add(threadId); // mark visited even on error to prevent infinite retries
    }

    // Return to inbox root via SPA history (avoids full reload)
    if (!isInboxRootPage()) {
      window.history.pushState({}, '', '/messages');
      await delay(600);
    }

    await delay(400); // brief pause between threads
  }

  saveVisitedThreads(visited);
  console.log(`[Jess Bridge] processNewUnreadThreads: done (visited set: ${visited.size} threads)`);
}

async function autoNavigateUnreadConversations() {
  if (isProcessingCommand || isDeepLoading) return;
  if (!window.location.href.includes('/messages')) return;
  if (!isInboxRootPage()) return;

  const conversations = scrapeConversationList();
  const unreadCount = conversations?.unreadTotal || 0;
  if (!unreadCount) return;

  const unreadLinks = Array.from(document.querySelectorAll('a.conversation-link[href^="/messages/"]'))
    .filter((link) => {
      const item = link.closest('.conversation-item');
      if (!item) return false;
      const unreadBadge = item.querySelector('.unread, .is-unread, [class*="unread"]');
      return !!unreadBadge;
    })
    .slice(0, 5);

  for (const link of unreadLinks) {
    const href = link.getAttribute('href') || '';
    const threadId = href.match(/\/messages\/(\d+)/)?.[1];
    if (!threadId) continue;

    try {
      link.click();
      await waitForSelector('div.inbox-messages-section', 2000);
      const threadData = scrapeOpenThread();
      if (threadData?.threadId) await postThreadToRelay(threadData);
    } catch (err) {
      console.warn('[Jess Bridge] Auto-nav scrape failed for thread', threadId, err);
    }

    await delay(1000);

    const inboxLink = document.querySelector('a[href="/messages"], a.messages-link, a[title*="Messages" i]');
    if (inboxLink) {
      inboxLink.click();
      await delay(1000);
    } else if (!isInboxRootPage()) {
      window.history.pushState({}, '', '/messages');
      await delay(500);
    }
  }
}

/**
 * Navigate into each conversation visible in the inbox list and POST
 * the full message history to the relay via /api/thread.
 * Called during count mode (forceRefresh: true) so countLeads() in
 * jess-v3.js can read message direction from the relay thread store.
 *
 * Skips conversations where the person was not online in the last 2 days OR
 * the last message is older than 7 days, to keep count mode fast.
 */

/**
 * Parse a .last-active text string into a number of days ago.
 * Returns:
 *   0   — "Online Now", "Online Today", "Active today"
 *   1   — "Active yesterday"
 *   N   — "Active N days ago"
 *   7   — any weeks/months reference (treated as excluded)
 *   Infinity — unknown / empty (caller decides; default INCLUDE)
 */
function parseLastActiveDays(text) {
  if (!text) return Infinity;
  const t = text.toLowerCase().trim();
  if (t === 'online now' || t === 'online today' || t === 'active today') return 0;
  if (t === 'active yesterday') return 1;
  const daysMatch = t.match(/active\s+(\d+)\s+days?\s+ago/);
  if (daysMatch) return Number(daysMatch[1]);
  // Weeks or months → very old
  if (/week|month|year/.test(t)) return 999;
  // Couldn't parse → caller defaults to include
  return Infinity;
}

async function scrapeAllThreadsForCount() {
  if (!isInboxRootPage()) {
    console.log('[Jess Bridge] scrapeAllThreadsForCount: not on inbox root, skipping');
    return { success: false, reason: 'not_on_inbox' };
  }

  const conversations = scrapeConversationList();
  const convArray = Array.isArray(conversations) ? conversations : [];
  if (convArray.length === 0) {
    console.log('[Jess Bridge] scrapeAllThreadsForCount: no conversations found');
    return { success: true, scraped: 0 };
  }

  console.log(`[Jess Bridge] scrapeAllThreadsForCount: navigating into ${convArray.length} conversations`);
  // Thresholds
  const MAX_ONLINE_DAYS = 2;  // person must have been online within 2 days
  const MAX_MSG_DAYS    = 7;  // last message must be within 7 days
  let scraped = 0;
  let skipped = 0;

  for (const conv of convArray) {
    if (!conv.threadId) { skipped++; continue; }

    // ── Activity filter ────────────────────────────────────────────────────────
    // Condition 1: person online within 2 days
    // Condition 2: last message within 7 days
    // Both are derived from the same .last-active text for now;
    // unknown values default to INCLUDE so we don't drop valid threads.
    const daysAgo = parseLastActiveDays(conv.lastActive || '');
    const isInfinite = daysAgo === Infinity; // truly unparseable → include

    const onlineRecently  = isInfinite || daysAgo <= MAX_ONLINE_DAYS;   // ≤ 2 days
    const msgRecently     = isInfinite || daysAgo <= MAX_MSG_DAYS;      // ≤ 7 days

    if (!onlineRecently || !msgRecently) {
      console.log(`[Jess Bridge] scrapeAllThreadsForCount: skipping inactive thread ${conv.threadId} (lastActive="${conv.lastActive}")`);
      // Post minimal dead record so countLeads has an entry
      await sendToRelay('/api/thread', {
        url: `https://flatmates.com.au/messages/${conv.threadId}`,
        timestamp: new Date().toISOString(),
        thread: {
          threadId: conv.threadId,
          status: 'dead',
          houseCode: '?',
          skippedReason: 'inactive',
          personName: conv.name,
          lastActive: conv.lastActive,
          messages: [],
          snippet: conv.snippet,
          isUnread: conv.isUnread
        }
      });
      skipped++;
      continue;
    }
    // ── End activity filter ────────────────────────────────────────────────────

    // Prefer SPA click to stay on inbox page
    const convLink = document.querySelector(`a.conversation-link[href="/messages/${conv.threadId}"]`);
    if (!convLink) { skipped++; continue; }

    // Debug first 10 clicked threads
    const _dbgThread = scraped < 10;
    try {
      convLink.click();
      // Wait for message section to appear
      const msgSection = await waitForSelector('div.inbox-messages-section', 4000);
      if (!msgSection) {
        if (_dbgThread) console.log(`[Jess Bridge][click-debug] thread=${conv.threadId} threadViewLoaded=NO msgSection=null`);
        console.warn(`[Jess Bridge] scrapeAllThreadsForCount: messages section not found for thread ${conv.threadId}`);
        skipped++;
        window.history.pushState({}, '', '/messages');
        await delay(600);
        continue;
      }

      await delay(800);
      const threadData = scrapeOpenThread();
      
      if (_dbgThread) {
        const listingLinkEl = document.querySelector('ul > li:nth-child(1) > div.inbox-messages-subject > a') ||
                              document.querySelector('div.SubHeader__container___1llko div.inbox-messages-listings a');
        const listingHref = listingLinkEl?.href || null;
        const listingIdParsed = listingHref?.match(/P(\d{5,})/i)?.[1] || null;
        const payload = {
          threadId: threadData?.threadId, clicked: true, threadViewLoaded: true,
          listingLinkFound: !!listingLinkEl, listingHref, listingId: listingIdParsed,
          subjectText: threadData?.subjectText || null,
          houseCode: threadData?.houseCode || null,
          payloadFields: threadData ? Object.keys(threadData).join(',') : 'none'
        };
        if (!listingLinkEl) {
          const allLinks = Array.from(document.querySelectorAll('a[href*="flatmates"]')).map(a=>a.href).slice(0,5);
          payload.failReason = 'selector_not_found';
          payload.flatmatesLinks = allLinks;
        }
        console.log('[Jess Bridge][click-debug]', JSON.stringify(payload));
      }
      
      if (threadData?.threadId) {
        await postThreadToRelay(threadData);
        scraped++;
      }
    } catch (err) {
      if (_dbgThread) console.log(`[Jess Bridge][click-debug] thread=${conv.threadId} error=${err.message}`);
      console.warn(`[Jess Bridge] scrapeAllThreadsForCount: error on thread ${conv.threadId}:`, err);
      skipped++;
    }

    // Return to inbox root via history (SPA — avoids full reload)
    if (!isInboxRootPage()) {
      window.history.pushState({}, '', '/messages');
      await delay(600);
    }

    await delay(400); // brief pause between threads to avoid hammering the DOM
  }

  console.log(`[Jess Bridge] scrapeAllThreadsForCount done — scraped ${scraped}, skipped ${skipped}`);
  // Re-scrape inbox list so relay has fresh snapshot
  lastScrapeHash = '';
  await scrapeAndSend({ forceRefresh: true, bypassGuard: true });
  return { success: true, scraped, skipped };
}

async function processCommands() {
  if (shouldStopPollingCycle() || isProcessingCommand) return;

  const commands = await pollCommands();
  if (pollStopped) return;

  if (commands.length > 0) isProcessingCommand = true;
  for (const cmd of commands) {
    if (shouldStopPollingCycle()) return;

    console.log('[Jess Bridge] Processing command:', cmd.action);
    
    let result;
    switch (cmd.action) {
      case 'reply':
        result = await typeReply(cmd.text);
        break;
      case 'navigate-and-reply': {
        // Navigate to thread then send reply — all in one command to avoid poll-batch race
        const convLinkNR = document.querySelector(`a.conversation-link[href="/messages/${cmd.threadId}"]`);
        if (convLinkNR) {
          convLinkNR.click();
          for (let i = 0; i < 20; i++) {
            if (window.location.pathname.includes(cmd.threadId)) break;
            await new Promise(r => setTimeout(r, 200));
          }
          await new Promise(r => setTimeout(r, 2000));
        } else {
          // Store reply text in localStorage so new page can pick it up
          try { localStorage.setItem('jess_pending_reply', JSON.stringify({ threadId: cmd.threadId, text: cmd.text, cmdId: cmd.id })); } catch(_) {}
          window.location.href = `https://flatmates.com.au/messages/${cmd.threadId}`;
          // Page will reload — new content script picks up from localStorage
          result = { success: true, method: 'navigate-pending' };
          break;
        }
        result = await typeReply(cmd.text);
        if (result && result.success) {
          await new Promise(r => setTimeout(r, 2000));
          await scrapeAndSend({ bypassGuard: true });
          // Return to inbox after sending so Jess can read new messages
          if (/\/messages\/\d+/.test(window.location.href)) {
            setTimeout(() => { window.location.href = 'https://flatmates.com.au/messages'; }, 2000);
          }
        }
        result = { success: true, method: 'navigate-click-reply' };
        break;
      }
      case 'navigate': {
        // Prefer clicking the inbox link (SPA — keeps inbox list visible)
        const convLink = document.querySelector(`a.conversation-link[href="/messages/${cmd.threadId}"]`);
        if (convLink) {
          convLink.click();
          // Wait for thread content to load then scrape
          await new Promise(r => setTimeout(r, 2500));
          await scrapeAndSend({ bypassGuard: true });
          result = { success: true, method: 'click' };
        } else {
          // Not in visible inbox — full navigate
          window.location.href = `https://flatmates.com.au/messages/${cmd.threadId}`;
          result = { success: true, method: 'navigate' };
        }
        break;
      }
      case 'scrape':
        if (cmd.forceRefresh || cmd.countMode) {
          // Deep scrape: navigate into each conversation to read message history
          await scrapeAndSend({ forceRefresh: true, bypassGuard: true });
          result = await scrapeAllThreadsForCount();
        } else {
          await scrapeAndSend({ bypassGuard: true });
          result = { success: true };
        }
        break;
      case 'deactivate-listing': {
        result = await toggleListingAvailability(cmd.listingId, cmd.requestedAction || cmd.action);
        break;
      }
      case 'verify-and-send': {
        // Navigate to the thread, read listing ID from DOM.
        //
        // Two modes — determined by which field is set:
        //
        // blastListingId mode (correction flow):
        //   If detected listing === blastListingId → SKIP (real lead, no correction needed)
        //   Otherwise → SEND correction
        //
        // expectedListingId mode (blast approval flow):
        //   If detected listing === expectedListingId → SEND (correct house ✅)
        //   If detected listing !== expectedListingId → SKIP (wrong house, don't send)
        //   If listing not detectable → SEND anyway (can't verify, assume ok)
        const vsThreadId = cmd.threadId;
        const vsUrl = cmd.conversationUrl || `https://flatmates.com.au/messages/${vsThreadId}`;
        const vsBlastListingId = cmd.blastListingId ? String(cmd.blastListingId) : null;
        const vsExpectedListingId = cmd.expectedListingId ? String(cmd.expectedListingId) : null;
        const vsText = cmd.text;

        // Navigate to thread — prefer SPA click, fall back to full navigate
        const vsConvLink = document.querySelector(`a.conversation-link[href="/messages/${vsThreadId}"]`);
        if (vsConvLink) {
          vsConvLink.click();
          for (let i = 0; i < 25; i++) {
            if (window.location.pathname.includes(vsThreadId)) break;
            await new Promise(r => setTimeout(r, 200));
          }
          await new Promise(r => setTimeout(r, 2000));
        } else {
          // Full page navigate — store pending in localStorage, new page picks it up
          try {
            localStorage.setItem('jess_pending_verify_send', JSON.stringify({
              threadId: vsThreadId,
              blastListingId: vsBlastListingId,
              expectedListingId: vsExpectedListingId,
              text: vsText,
              cmdId: cmd.id
            }));
          } catch (_) {}
          window.location.href = vsUrl;
          result = { success: true, method: 'navigate-pending' };
          break;
        }

        // Read listing ID from DOM: first item in inbox list subject link
        await waitForSelector('ul > li:nth-child(1) > div.inbox-messages-subject > a', 3000);
        const vsListingEl = document.querySelector('ul > li:nth-child(1) > div.inbox-messages-subject > a');
        const vsHref = vsListingEl?.href || vsListingEl?.getAttribute('href') || '';
        const vsPMatch = vsHref.match(/P(\d+)/i);
        const vsDetectedListingId = vsPMatch ? vsPMatch[1] : null;

        console.log(`[Jess Bridge] verify-and-send thread=${vsThreadId} detectedListingId=${vsDetectedListingId} blastListingId=${vsBlastListingId} expectedListingId=${vsExpectedListingId}`);

        let vsShouldSend;
        if (vsExpectedListingId) {
          // expectedListingId mode: send ONLY if listing matches (or can't detect)
          if (vsDetectedListingId && vsDetectedListingId !== vsExpectedListingId) {
            // Wrong house — skip
            result = { success: true, skipped: true, reason: 'wrong_listing', detectedListingId: vsDetectedListingId, expectedListingId: vsExpectedListingId };
            vsShouldSend = false;
          } else {
            // Correct house or undetectable — send
            vsShouldSend = true;
          }
        } else {
          // blastListingId mode: skip if listing matches (real blast lead)
          if (vsDetectedListingId && vsBlastListingId && vsDetectedListingId === vsBlastListingId) {
            result = { success: true, skipped: true, reason: 'real_listing_match', detectedListingId: vsDetectedListingId };
            vsShouldSend = false;
          } else {
            vsShouldSend = true;
          }
        }

        if (vsShouldSend) {
          const vsReplyResult = await typeReply(vsText);
          if (vsReplyResult && vsReplyResult.success) {
            await new Promise(r => setTimeout(r, 2000));
            await scrapeAndSend({ bypassGuard: true });
            if (/\/messages\/\d+/.test(window.location.href)) {
              setTimeout(() => { window.location.href = 'https://flatmates.com.au/messages'; }, 2000);
            }
          }
          result = { success: vsReplyResult?.success ?? false, sent: vsReplyResult?.success ?? false, detectedListingId: vsDetectedListingId, method: 'verify-and-send' };
        }
        break;
      }
      default:
        result = { success: false, error: `Unknown action: ${cmd.action}` };
    }

    if (shouldStopPollingCycle()) return;
    await sendToRelay('/api/command-ack', { commandId: cmd.id, result });
  }

  resetPollErrorCircuit();
  isProcessingCommand = false;
}

async function runProcessCommandsCycle() {
  // Respect permanent stops (context invalidated, circuit breaker triggered)
  if (pollStopped) return;

  // If runtime was repeatedly unavailable, honour the backoff window before retrying
  if (cmdRuntimeBackoffUntil && Date.now() < cmdRuntimeBackoffUntil) return;

  // Check runtime availability independently — skip this cycle without permanently stopping
  if (!isRuntimeAvailable()) {
    cmdRuntimeUnavailableCount++;
    if (cmdRuntimeUnavailableCount >= 3) {
      // Exponential-ish backoff: 30s per miss, capped at 5 minutes
      const backoffMs = Math.min(cmdRuntimeUnavailableCount * 30000, 5 * 60 * 1000);
      cmdRuntimeBackoffUntil = Date.now() + backoffMs;
      console.error(`[Jess] Chrome runtime unavailable ${cmdRuntimeUnavailableCount}x — backing off ${backoffMs / 1000}s, will retry.`);
    } else {
      console.warn(`[Jess] Chrome runtime unavailable — skipping command cycle (miss #${cmdRuntimeUnavailableCount}).`);
    }
    return;
  }

  // Runtime is back — reset unavailability tracking so warnings fire fresh next time
  if (cmdRuntimeUnavailableCount > 0) {
    console.log('[Jess] Chrome runtime restored — resuming command processor.');
    cmdRuntimeUnavailableCount = 0;
    cmdRuntimeBackoffUntil = 0;
    runtimeUnavailableLogged = false;
  }

  try {
    await processCommands();
  } catch (err) {
    if (isContextInvalidated(err)) {
      stopPollingForInvalidatedContext(err);
      return;
    }

    console.error('[Jess Bridge] processCommands failed:', err);
    recordPollErrorAndShouldStop();
  }
}

async function mainLoop() {
  if (isRunning) return;
  isRunning = true;
  
  console.log('[Jess Bridge] Content script active on', window.location.href);

  // Check for pending reply left by navigate-and-reply command (full-navigate case)
  try {
    const pendingReply = localStorage.getItem('jess_pending_reply');
    if (pendingReply) {
      localStorage.removeItem('jess_pending_reply');
      const pr = JSON.parse(pendingReply);
      const currentThreadId = window.location.pathname.match(/\/messages\/([^/?#]+)/)?.[1];
      if (pr.threadId && currentThreadId === String(pr.threadId)) {
        console.log('[Jess Bridge] Resuming pending reply for thread', pr.threadId);
        setTimeout(async () => {
          try {
            const r = await typeReply(pr.text);
            await sendToRelay('/api/command-ack', { commandId: pr.cmdId, result: r || { success: true, method: 'resumed-reply' } });
            await scrapeAndSend();
            // Return to inbox after sending so Jess can read new messages
            if (/\/messages\/\d+/.test(window.location.href)) {
              setTimeout(() => { window.location.href = 'https://flatmates.com.au/messages'; }, 2000);
            }
          } catch(e) { console.warn('[Jess Bridge] Resumed reply failed:', e); }
        }, 4000);
      } else {
        console.log('[Jess Bridge] Ignoring pending reply — on wrong thread', currentThreadId, 'vs', pr.threadId);
      }
    }
  } catch(_) {}

  // Check for pending verify-and-send left by verify-and-send command (full-navigate case)
  try {
    const pendingVS = localStorage.getItem('jess_pending_verify_send');
    if (pendingVS) {
      localStorage.removeItem('jess_pending_verify_send');
      const pv = JSON.parse(pendingVS);
      const currentThreadId = window.location.pathname.match(/\/messages\/([^/?#]+)/)?.[1];
      if (pv.threadId && currentThreadId === String(pv.threadId)) {
        console.log('[Jess Bridge] Resuming pending verify-and-send for thread', pv.threadId);
        setTimeout(async () => {
          try {
            // Read listing ID from DOM
            await waitForSelector('ul > li:nth-child(1) > div.inbox-messages-subject > a', 4000);
            const listingEl = document.querySelector('ul > li:nth-child(1) > div.inbox-messages-subject > a');
            const href = listingEl?.href || listingEl?.getAttribute('href') || '';
            const pMatch = href.match(/P(\d+)/i);
            const detectedListingId = pMatch ? pMatch[1] : null;
            const pvExpectedListingId = pv.expectedListingId ? String(pv.expectedListingId) : null;
            const pvBlastListingId = pv.blastListingId ? String(pv.blastListingId) : null;
            console.log(`[Jess Bridge] verify-and-send (resumed) detectedListingId=${detectedListingId} blastListingId=${pvBlastListingId} expectedListingId=${pvExpectedListingId}`);
            let r;
            let pvShouldSend;
            if (pvExpectedListingId) {
              // expectedListingId mode: send only if listing matches (or can't detect)
              if (detectedListingId && detectedListingId !== pvExpectedListingId) {
                r = { success: true, skipped: true, reason: 'wrong_listing', detectedListingId, expectedListingId: pvExpectedListingId };
                pvShouldSend = false;
              } else {
                pvShouldSend = true;
              }
            } else {
              // blastListingId mode: skip if listing matches
              if (detectedListingId && pvBlastListingId && detectedListingId === pvBlastListingId) {
                r = { success: true, skipped: true, reason: 'real_listing_match', detectedListingId };
                pvShouldSend = false;
              } else {
                pvShouldSend = true;
              }
            }
            if (pvShouldSend) {
              const replyResult = await typeReply(pv.text);
              if (replyResult?.success) {
                await new Promise(res => setTimeout(res, 2000));
                await scrapeAndSend();
                if (/\/messages\/\d+/.test(window.location.href)) {
                  setTimeout(() => { window.location.href = 'https://flatmates.com.au/messages'; }, 2000);
                }
              }
              r = { success: replyResult?.success ?? false, sent: replyResult?.success ?? false, detectedListingId, method: 'resumed-verify-and-send' };
            }
            await sendToRelay('/api/command-ack', { commandId: pv.cmdId, result: r });
          } catch(e) { console.warn('[Jess Bridge] Resumed verify-and-send failed:', e); }
        }, 4000);
      } else {
        console.log('[Jess Bridge] Ignoring pending verify-and-send — on wrong thread', currentThreadId, 'vs', pv.threadId);
      }
    }
  } catch(_) {}

  // Initial deep load — click "Load more" until all conversations are visible
  setTimeout(loadAllAndScrape, 3000);

  // Quick scrape every 30s
  setInterval(scrapeAndSend, SCRAPE_INTERVAL);
  setInterval(() => autoNavigateUnreadConversations().catch(err => console.warn('[Jess Bridge] Auto-nav cycle failed:', err)), 30 * 1000);
  // Deep load (Load More clicks) every 10 minutes — continuous monitoring
  setInterval(loadAllAndScrape, 4 * 60 * 60 * 1000); // Once every 4 hours instead of 10 mins
  setInterval(runProcessCommandsCycle, POLL_INTERVAL);
}

// ─── Deep Load: click "Load more" until exhausted ──────────────────────────

async function loadAllAndScrape() {
  if (isProcessingCommand || isDeepLoading) {
    console.log('[Jess Bridge] Skipping deep load (command processing or already loading)');
    return;
  }
  if (!window.location.href.includes('/messages')) return;
  
  isDeepLoading = true;
  console.log('[Jess Bridge] Deep load starting...');
  let iterations = 0;
  const MAX_ITER = 20; // Allow up to ~500 conversations (25 per click × 20)
  const MAX_CONVERSATIONS = 500;
  const MAX_ELAPSED_MS = 30000; // 30-second wall-clock cap
  const deepLoadStart = Date.now();

  // Container selector with fallbacks to match actual Flatmates DOM structure
  const getScrollContainer = () =>
    document.querySelector('.inbox-conversations.selected') ||
    document.querySelector('div.inbox-conversations') ||
    document.querySelector('ul.inbox-conversations-list') ||
    document.querySelector('[class*="inbox-conversations"]');

  while (iterations < MAX_ITER) {
    if (isProcessingCommand) {
      console.log('[Jess Bridge] Aborting deep load, command processing started');
      break;
    }
    if (Date.now() - deepLoadStart >= MAX_ELAPSED_MS) {
      console.log('[Jess Bridge] Deep load time limit reached (30s) — stopping');
      break;
    }

    const prevCount = document.querySelectorAll('.conversation-item').length;
    if (prevCount >= MAX_CONVERSATIONS) {
      console.log(`[Jess Bridge] Reached ${prevCount} conversations (cap ${MAX_CONVERSATIONS}) — stopping`);
      break;
    }

    const loadMoreEl = document.querySelector('li.load-more a, .load-more a, a.load-more');
    if (loadMoreEl) {
      loadMoreEl.click();
      console.log(`[Jess Bridge] Load more clicked (iter ${iterations})`);
    } else {
      const container = getScrollContainer();
      if (container) {
        container.scrollTop = container.scrollHeight;
        console.log(`[Jess Bridge] Scrolled container to bottom (iter ${iterations})`);
      } else {
        console.log('[Jess Bridge] No load mechanism found — done');
        break;
      }
    }

    await new Promise(r => setTimeout(r, 2000 + Math.random() * 1000)); // Increased delay for safety

    const newCount = document.querySelectorAll('.conversation-item').length;
    if (newCount === prevCount) {
      console.log(`[Jess Bridge] No new items after iter ${iterations} — done`);
      break;
    }

    iterations++;
  }

  const count = document.querySelectorAll('.conversation-item').length;
  console.log(`[Jess Bridge] Deep load done — ${count} conversations visible`);
  lastScrapeHash = ''; 
  if (!isProcessingCommand) {
    await scrapeAndSend();
  }
  isDeepLoading = false;
}

// ─── Mutation Observer ──────────────────────────────

const observer = new MutationObserver((mutations) => {
  let hasNewContent = false;
  for (const m of mutations) {
    if (m.addedNodes.length > 0) { hasNewContent = true; break; }
  }
  if (hasNewContent) {
    clearTimeout(window._jessBridgeDebounce);
    if (!isProcessingCommand && !isDeepLoading) window._jessBridgeDebounce = setTimeout(scrapeAndSend, 2000);
  }
});

function startObserver() {
  const target = document.querySelector('.inbox-conversations.selected, ul.inbox-conversations-list, [class*="inbox-conversations"], main, #app, #root, body');
  if (target) {
    observer.observe(target, { childList: true, subtree: true });
    console.log('[Jess Bridge] Mutation observer active');
  }
}

// ─── Init ───────────────────────────────────────────

if (document.readyState === 'complete') {
  mainLoop();
  startObserver();
} else {
  window.addEventListener('load', () => {
    mainLoop();
    startObserver();
  });
}
