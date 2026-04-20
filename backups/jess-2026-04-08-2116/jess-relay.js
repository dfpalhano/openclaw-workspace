#!/usr/bin/env node
/**
 * Jess Relay Server
 * Lightweight HTTP bridge between the Chrome extension and Jess bot.
 * 
 * Extension → Relay: scrape data (conversations, messages)
 * Relay → Extension: commands (reply, navigate, scrape)
 * Jess → Relay: queue commands, read inbox data
 * 
 * Port: 3847
 */

const http = require('http');
const path = require('path');
const fs = require('fs');

const PORT = 3847;
const DATA_DIR = path.join(__dirname, 'relay-data');
const INBOX_FILE = path.join(DATA_DIR, 'inbox.json');
const THREADS_DIR = path.join(DATA_DIR, 'threads');
const THREADS_FILE = path.join(DATA_DIR, 'jess-threads.json');
const COMMANDS_FILE = path.join(DATA_DIR, 'commands.json');
const LOG_FILE = path.join(DATA_DIR, 'relay.log');

// Ensure data dirs exist
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(THREADS_DIR)) fs.mkdirSync(THREADS_DIR, { recursive: true });

// In-memory state
let pendingCommands = [];
let lastExtensionHeartbeat = null;
let lastScrapeData = null;
let commandIdCounter = 1;
const sseClients = new Set();

function commandKey(cmd = {}) {
  return [
    cmd.action || '',
    cmd.threadId || '',
    cmd.listingId || '',
    cmd.requestedAction || '',
    cmd.expectedListingId || '',
    cmd.blastListingId || '',
    cmd.text || ''
  ].join('|');
}

function queueCommand(cmd, logMessage) {
  const key = commandKey(cmd);
  if (cmd.action === 'scrape' && pendingCommands.some(existing => existing.action === 'scrape')) {
    return false;
  }
  if (pendingCommands.some(existing => commandKey(existing) === key)) {
    return false;
  }
  if (pendingCommands.length >= 1000) return false;
  pendingCommands.push(cmd);
  if (logMessage) log(logMessage);
  return true;
}

// Pause state — when true, incoming commands are rejected (not queued)
let relayPaused = false;
let relayPausedAt = null;
let relayPausedReason = null;

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function readJsonFile(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function writeJsonFile(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function loadThreads() {
  return readJsonFile(THREADS_FILE, []);
}

function saveThreads(threads) {
  writeJsonFile(THREADS_FILE, Array.isArray(threads) ? threads : []);
}

function broadcastSse(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of [...sseClients]) {
    try {
      client.res.write(payload);
    } catch (_) {
      clearInterval(client.keepalive);
      sseClients.delete(client);
    }
  }
}

function normaliseConversation(conv = {}, fallback = {}) {
  const threadId = String(conv.threadId || conv.conversationId || conv.id || fallback.threadId || '').trim();
  const nowIso = new Date().toISOString();
  return {
    ...fallback,
    ...conv,
    threadId: threadId || fallback.threadId || null,
    href: conv.href || conv.threadUrl || fallback.href || fallback.threadUrl || null,
    threadUrl: conv.threadUrl || conv.href || fallback.threadUrl || fallback.href || null,
    name: conv.name || fallback.name || null,
    initial: conv.initial || fallback.initial || null,
    avatarImg: conv.avatarImg || fallback.avatarImg || null,
    lastActive: conv.lastActive || fallback.lastActive || null,
    listingId: conv.listingId || fallback.listingId || null,
    subjectText: conv.subjectText || fallback.subjectText || null,
    subjectHref: conv.subjectHref || fallback.subjectHref || null,
    snippet: conv.snippet || conv.lastMessagePreview || fallback.snippet || fallback.lastMessagePreview || null,
    lastMessagePreview: conv.lastMessagePreview || conv.snippet || fallback.lastMessagePreview || fallback.snippet || null,
    isUnread: typeof conv.isUnread === 'boolean' ? conv.isUnread : !!(conv.unread ?? fallback.isUnread ?? fallback.unread),
    unread: typeof conv.unread === 'boolean' ? conv.unread : !!(conv.isUnread ?? fallback.unread ?? fallback.isUnread),
    enquirerType: conv.enquirerType || fallback.enquirerType || 'unknown',
    rawText: conv.rawText || fallback.rawText || null,
    firstSeenAt: fallback.firstSeenAt || conv.firstSeenAt || nowIso,
    updatedAt: nowIso
  };
}

function mergeInboxPayload(data) {
  const existing = readJsonFile(INBOX_FILE, { type: 'inbox', conversations: [], updatedAt: null, totalStored: 0 });
  const existingList = safeArray(existing?.conversations);
  const incomingList = safeArray(data?.conversations);

  if (incomingList.length === 0 && existingList.length > 0) {
    log('[scrape] Empty inbox scrape ignored, preserving existing inbox state');
    return existing;
  }

  const map = new Map();

  existingList.forEach((conv, idx) => {
    const key = String(conv?.threadId || conv?.conversationId || conv?.id || `existing-${idx}`);
    map.set(key, normaliseConversation(conv));
  });

  incomingList.forEach((conv, idx) => {
    const key = String(conv?.threadId || conv?.conversationId || conv?.id || `incoming-${idx}`);
    const prev = map.get(key) || {};
    map.set(key, normaliseConversation(conv, prev));
  });

  const merged = Array.from(map.values()).filter(conv => conv.threadId || conv.name || conv.snippet);
  merged.sort((a, b) => {
    const aTime = Date.parse(a.updatedAt || a.lastActive || a.lastMessageAt || 0) || 0;
    const bTime = Date.parse(b.updatedAt || b.lastActive || b.lastMessageAt || 0) || 0;
    return bTime - aTime;
  });

  const payload = {
    ...(existing && typeof existing === 'object' ? existing : {}),
    ...(data && typeof data === 'object' ? data : {}),
    type: 'inbox',
    conversations: merged,
    totalStored: merged.length,
    visibleCount: incomingList.length,
    unreadTotal: typeof incomingList.unreadTotal === 'number' ? incomingList.unreadTotal : (typeof data?.totalUnread === 'number' ? data.totalUnread : (existing.unreadTotal || 0)),
    updatedAt: new Date().toISOString()
  };

  writeJsonFile(INBOX_FILE, payload);
  return payload;
}

function log(msg) {
  const ts = new Date().toLocaleString('en-AU', { timeZone: 'Australia/Brisbane' });
  const line = `[${ts}] ${msg}`;
  console.log(line);
  try {
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch (_) {}
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 5e6) reject(new Error('Too large')); });
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); } catch (e) { reject(e); }
    });
  });
}

function json(res, data, status = 200) {
  res.writeHead(status, { 
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(data));
}

// ─── Handlers ───────────────────────────────────────

const routes = {};

// Extension sends scraped data
routes['POST /api/scrape'] = async (req, res) => {
  const data = await parseBody(req);
  lastScrapeData = data;
  
  if (data.type === 'inbox' && data.conversations) {
    const mergedInbox = mergeInboxPayload(data);
    log(`Inbox scraped: visible=${safeArray(data.conversations).length}, stored=${mergedInbox.totalStored}`);
    broadcastSse('inbox', {
      type: 'inbox',
      receivedAt: new Date().toISOString(),
      lastScrapeTime: data.timestamp || new Date().toISOString(),
      payload: mergedInbox
    });
  } else if (data.type === 'thread' && data.thread) {
    const threadFile = path.join(THREADS_DIR, `${data.thread.threadId || 'unknown'}.json`);
    fs.writeFileSync(threadFile, JSON.stringify(data, null, 2));
    log(`Thread scraped: ${data.thread.threadId} (${data.thread.messages?.length || 0} messages)`);
    broadcastSse('thread', {
      type: 'thread',
      receivedAt: new Date().toISOString(),
      lastScrapeTime: data.timestamp || new Date().toISOString(),
      payload: data.thread
    });
  }

  // Notify Jess via callback if registered
  notifyJess('scrape', data);

  json(res, { ok: true, received: data.type });
};

// Extension polls for commands
routes['GET /api/commands'] = async (req, res) => {
  const commands = [...pendingCommands];
  pendingCommands = []; // drain queue
  json(res, { commands });
};

// Extension acknowledges a command
routes['POST /api/command-ack'] = async (req, res) => {
  const data = await parseBody(req);
  log(`Command ${data.commandId} ack: ${JSON.stringify(data.result)}`);
  
  // Notify Jess of the result
  notifyJess('command-result', data);
  
  json(res, { ok: true });
};

// Extension heartbeat
routes['POST /api/heartbeat'] = async (req, res) => {
  const data = await parseBody(req);
  lastExtensionHeartbeat = Date.now();
  const lastScrapeMs = lastScrapeData?.timestamp ? new Date(lastScrapeData.timestamp).getTime() : 0;
  const hasQueuedScrape = pendingCommands.some(cmd => cmd.action === 'scrape');
  if (!relayPaused && (!lastScrapeMs || (Date.now() - lastScrapeMs) > 45000) && !hasQueuedScrape) {
    queueCommand({
      id: commandIdCounter++,
      action: 'scrape',
      queuedAt: new Date().toISOString(),
      source: 'heartbeat'
    }, 'Heartbeat detected stale scrape (>45s) — queued immediate scrape');
  }
  broadcastSse('heartbeat', {
    type: 'heartbeat',
    receivedAt: new Date().toISOString(),
    lastScrapeTime: lastScrapeData?.timestamp || null,
    totalUnread: data?.totalUnread || 0
  });
  json(res, { 
    ok: true, 
    pendingCommands: pendingCommands.length,
    serverTime: new Date().toISOString()
  });
};

// ─── Jess API ───────────────────────────────────────

// Jess reads latest inbox
routes['GET /api/inbox'] = async (req, res) => {
  try {
    if (fs.existsSync(INBOX_FILE)) {
      const data = JSON.parse(fs.readFileSync(INBOX_FILE, 'utf8'));
      const payload = { ...(data || {}), conversations: safeArray(data?.conversations) };
      json(res, payload);
    } else {
      json(res, { conversations: [], note: 'No inbox data yet' });
    }
  } catch (e) {
    json(res, { error: e.message }, 500);
  }
};

// POST /api/enrich-housecodes — run house-matcher against stored inbox, update houseCode for all '?' entries
routes['POST /api/enrich-housecodes'] = async (req, res) => {
  try {
    if (!fs.existsSync(INBOX_FILE)) return json(res, { matched: 0, total: 0, note: 'No inbox file' });
    const houseMatcher = require('./modules/house-matcher');
    const rooms = houseMatcher.loadRooms();
    const threadStates = houseMatcher.loadThreadStates();
    const data = JSON.parse(fs.readFileSync(INBOX_FILE, 'utf8'));
    const convs = Array.isArray(data) ? data : (Array.isArray(data.conversations) ? data.conversations : []);
    let matched = 0;
    for (const conv of convs) {
      if (!conv.houseCode || conv.houseCode === '?') {
        const code = houseMatcher.matchHouseCode(conv, rooms, threadStates);
        if (code) { conv.houseCode = code; matched++; }
      }
    }
    // Write back
    const updated = Array.isArray(data) ? convs : { ...data, conversations: convs };
    fs.writeFileSync(INBOX_FILE, JSON.stringify(updated, null, 2));
    log(`[enrich-housecodes] ${matched}/${convs.length} conversations enriched`);
    json(res, { matched, total: convs.length });
  } catch (e) {
    log('[enrich-housecodes] error: ' + e.message);
    json(res, { error: e.message }, 500);
  }
};

// Jess stores a scraped full thread
routes['POST /api/thread'] = async (req, res) => {
  const data = await parseBody(req);
  const thread = data?.thread || data;
  if (!thread?.threadId) return json(res, { error: 'Missing threadId' }, 400);

  const threads = loadThreads();
  const idx = threads.findIndex(t => String(t.threadId) === String(thread.threadId));
  const record = {
    ...thread,
    threadId: String(thread.threadId),
    receivedAt: new Date().toISOString(),
    updatedAt: data?.timestamp || new Date().toISOString()
  };
  if (idx >= 0) threads[idx] = { ...threads[idx], ...record };
  else threads.unshift(record);
  saveThreads(threads);

  const threadFile = path.join(THREADS_DIR, `${record.threadId}.json`);
  writeJsonFile(threadFile, { thread: record });

  broadcastSse('thread', {
    type: 'thread',
    receivedAt: new Date().toISOString(),
    lastScrapeTime: record.updatedAt,
    payload: record
  });
  notifyJess('scrape', { type: 'thread', thread: record });
  json(res, { ok: true, threadId: record.threadId });
};

// Jess reads a specific thread
routes['GET /api/thread'] = async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const threadId = url.searchParams.get('id');
  if (!threadId) return json(res, { error: 'Missing ?id=' }, 400);
  
  const threadFile = path.join(THREADS_DIR, `${threadId}.json`);
  try {
    if (fs.existsSync(threadFile)) {
      const data = JSON.parse(fs.readFileSync(threadFile, 'utf8'));
      const payload = { ...(data || {}), conversations: safeArray(data?.conversations) };
      json(res, payload);
    } else {
      json(res, { error: 'Thread not found' }, 404);
    }
  } catch (e) {
    json(res, { error: e.message }, 500);
  }
};

routes['GET /api/threads'] = async (_req, res) => {
  json(res, { threads: loadThreads() });
};

routes['GET /api/stream'] = async (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });
  res.write(': connected\n\n');
  res.write(`event: status\ndata: ${JSON.stringify({ type: 'status', connectedAt: new Date().toISOString(), lastScrapeTime: lastScrapeData?.timestamp || null })}\n\n`);
  const client = {
    res,
    keepalive: setInterval(() => {
      try {
        res.write(`event: keepalive\ndata: ${JSON.stringify({ ts: new Date().toISOString() })}\n\n`);
      } catch (_) {}
    }, 25000)
  };
  sseClients.add(client);
  req.on('close', () => {
    clearInterval(client.keepalive);
    sseClients.delete(client);
  });
};

// Jess queues a reply command
routes['POST /api/navigate-and-reply'] = async (req, res) => {
  if (relayPaused) return json(res, { ok: false, reason: 'jess_paused' });
  const data = await parseBody(req);
  if (!data.threadId || !data.text) {
    return json(res, { error: 'Missing threadId or text' }, 400);
  }
  const cmd = {
    id: commandIdCounter++,
    action: 'navigate-and-reply',
    threadId: data.threadId,
    text: data.text,
    queuedAt: new Date().toISOString()
  };
  queueCommand(cmd, `navigate-and-reply queued for thread ${data.threadId}`);
  json(res, { ok: true, commandId: cmd.id });
};

// Jess queues a verify-and-send command — navigate to thread, read listing ID from DOM,
// then either skip/send based on blastListingId or expectedListingId mode.
routes['POST /api/verify-and-send'] = async (req, res) => {
  if (relayPaused) return json(res, { ok: false, reason: 'jess_paused' });
  const data = await parseBody(req);
  if (!data.threadId || !data.text || (!data.blastListingId && !data.expectedListingId)) {
    return json(res, { error: 'Missing threadId, text, and either blastListingId or expectedListingId' }, 400);
  }
  const cmd = {
    id: commandIdCounter++,
    action: 'verify-and-send',
    threadId: data.threadId,
    conversationUrl: data.conversationUrl || `https://flatmates.com.au/messages/${data.threadId}`,
    blastListingId: data.blastListingId ? String(data.blastListingId) : null,
    expectedListingId: data.expectedListingId ? String(data.expectedListingId) : null,
    text: data.text,
    queuedAt: new Date().toISOString()
  };
  queueCommand(cmd, `verify-and-send queued for thread ${data.threadId} (blastListingId=${cmd.blastListingId || '-'}, expectedListingId=${cmd.expectedListingId || '-'})`);
  json(res, { ok: true, commandId: cmd.id });
};

// Jess queues a listing availability toggle command for the extension.
routes['POST /api/command'] = async (req, res) => {
  if (relayPaused) return json(res, { ok: false, reason: 'jess_paused' });
  const data = await parseBody(req);
  if (!data.type) {
    return json(res, { error: 'Missing type' }, 400);
  }
  if (data.type === 'deactivate-listing') {
    if (!data.listingId || !data.action) {
      return json(res, { error: 'Missing listingId or action' }, 400);
    }
    const cmd = {
      id: commandIdCounter++,
      action: 'deactivate-listing',
      listingId: String(data.listingId).replace(/^P/i, ''),
      requestedAction: String(data.action).toLowerCase(),
      houseCode: data.houseCode ? String(data.houseCode).toUpperCase() : null,
      queuedAt: new Date().toISOString()
    };
    queueCommand(cmd, `deactivate-listing queued for listing ${cmd.listingId} (${cmd.requestedAction})`);
    return json(res, { ok: true, commandId: cmd.id });
  }
  return json(res, { error: `Unknown command type: ${data.type}` }, 400);
};

routes['POST /api/reply'] = async (req, res) => {
  if (relayPaused) return json(res, { ok: false, reason: 'jess_paused' });
  const data = await parseBody(req);
  if (!data.threadId || !data.text) {
    return json(res, { error: 'Missing threadId or text' }, 400);
  }

  const cmd = {
    id: commandIdCounter++,
    action: 'reply',
    threadId: data.threadId,
    text: data.text,
    queuedAt: new Date().toISOString()
  };
  queueCommand(cmd, `Reply queued for thread ${data.threadId}: "${data.text.substring(0, 50)}..."`);
  json(res, { ok: true, commandId: cmd.id });
};

// Jess queues a navigate command
routes['POST /api/navigate'] = async (req, res) => {
  if (relayPaused) return json(res, { ok: false, reason: 'jess_paused' });
  const data = await parseBody(req);
  if (!data.threadId) {
    return json(res, { error: 'Missing threadId' }, 400);
  }

  const cmd = {
    id: commandIdCounter++,
    action: 'navigate',
    threadId: data.threadId,
    queuedAt: new Date().toISOString()
  };
  queueCommand(cmd, `Navigate queued: thread ${data.threadId}`);
  json(res, { ok: true, commandId: cmd.id });
};

// Jess requests a fresh scrape
routes['POST /api/request-scrape'] = async (req, res) => {
  if (relayPaused) return json(res, { ok: false, reason: 'jess_paused' });
  const data = await parseBody(req).catch(() => ({}));
  const cmd = {
    id: commandIdCounter++,
    action: 'scrape',
    queuedAt: new Date().toISOString(),
    ...(data.forceRefresh ? { forceRefresh: true } : {}),
    ...(data.countMode   ? { countMode:    true } : {}),
  };
  queueCommand(cmd);
  json(res, { ok: true, commandId: cmd.id });
};

// ─── Pause / Resume ─────────────────────────────────────────────────────────

// POST /api/pause — pause the relay (rejects incoming commands, drains queue)
routes['POST /api/pause'] = async (req, res) => {
  const data = await parseBody(req);
  const reason = data.reason || 'manual';
  const drained = pendingCommands.length;
  pendingCommands = [];
  relayPaused = true;
  relayPausedAt = new Date().toISOString();
  relayPausedReason = reason;
  log(`Relay PAUSED (reason=${reason}). Drained ${drained} stale commands.`);
  json(res, { ok: true, paused: true, drained, reason });
};

// POST /api/resume — resume the relay (allows commands to queue again)
routes['POST /api/resume'] = async (req, res) => {
  const wasPaused = relayPaused;
  relayPaused = false;
  relayPausedAt = null;
  relayPausedReason = null;
  log(`Relay RESUMED.`);
  json(res, { ok: true, paused: false, wasPaused });
};

// Status endpoint
routes['GET /api/status'] = async (req, res) => {
  const extensionAlive = lastExtensionHeartbeat && (Date.now() - lastExtensionHeartbeat < 120000);
  json(res, {
    relay: 'running',
    paused: relayPaused,
    pausedAt: relayPausedAt,
    pausedReason: relayPausedReason,
    extensionConnected: extensionAlive,
    lastExtensionHeartbeat: lastExtensionHeartbeat ? new Date(lastExtensionHeartbeat).toISOString() : null,
    pendingCommands: pendingCommands.length,
    hasInboxData: fs.existsSync(INBOX_FILE),
    lastScrapeType: lastScrapeData?.type || null,
    lastScrapeTime: lastScrapeData?.timestamp || null
  });
};

// ─── Jess Callback (optional webhook) ───────────────

let jessCallbackUrl = null;

routes['POST /api/register-callback'] = async (req, res) => {
  const data = await parseBody(req);
  jessCallbackUrl = data.url || null;
  log(`Jess callback registered: ${jessCallbackUrl}`);
  json(res, { ok: true });
};

function notifyJess(event, data) {
  if (!jessCallbackUrl) return;
  
  const payload = JSON.stringify({ event, data, timestamp: new Date().toISOString() });
  const url = new URL(jessCallbackUrl);
  
  const options = {
    hostname: url.hostname,
    port: url.port,
    path: url.pathname,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
  };

  const req = http.request(options, () => {});
  req.on('error', (e) => log(`Jess callback error: ${e.message}`));
  req.write(payload);
  req.end();
}

// ─── Server ─────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    return res.end();
  }

  const routeKey = `${req.method} ${req.url.split('?')[0]}`;
  const handler = routes[routeKey];

  if (handler) {
    try {
      await handler(req, res);
    } catch (e) {
      log(`Error: ${routeKey} — ${e.message}`);
      json(res, { error: e.message }, 500);
    }
  } else {
    json(res, { error: 'Not found', routes: Object.keys(routes) }, 404);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  log(`Jess Relay Server listening on http://127.0.0.1:${PORT}`);
  log(`Extension → POST /api/scrape, GET /api/commands`);
  log(`Jess     → GET /api/inbox, POST /api/reply, GET /api/status`);
});
