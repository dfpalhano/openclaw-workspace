#!/usr/bin/env node
/**
 * Jess v3 - Relay-based Flatmates auto-reply bot.
 * Browser automation is handled by the extension + relay.
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const http  = require('http');
const https = require('https');
const dns   = require('dns');
dns.setDefaultResultOrder('ipv4first');
const crypto = require('crypto');

// ─── Paths ────────────────────────────────────────────────────────────────────

const BOT_DIR      = __dirname;
const DATA_DIR     = '/home/diegopalhano/projects/mission-control/data';
const LOG_FILE     = path.join(BOT_DIR, 'jess-v3.log');
const TRAINING_PROFILE_FILE = path.join(DATA_DIR, 'jess-training-profile.json');

const DATA = {
  rooms:      path.join(DATA_DIR, 'jess-rooms.json'),
  enquirers:  path.join(DATA_DIR, 'jess-enquirers.json'),
  waitlist:   path.join(DATA_DIR, 'jess-waitlist.json'),
  followup:   path.join(DATA_DIR, 'jess-followup.json'),
  inspections:path.join(DATA_DIR, 'jess-inspections.json'),
  pending:    '/home/diegopalhano/projects/jess-bot/data/jess-pending.json',
  commands:   path.join(DATA_DIR, 'jess-commands.json'),
  filter:     path.join(DATA_DIR, 'jess-filter.json'),
  pendingCampaignSendJob: path.join(DATA_DIR, 'jess-pending-campaign-send.json'),
};

// ─── Filter state helpers ─────────────────────────────────────────────────────
const DEFAULT_FILTER = { period: 'last_3_days', houses: ['all'], step: null, promptMsgId: null };
function loadFilter() { try { return { ...DEFAULT_FILTER, ...JSON.parse(fs.readFileSync(DATA.filter,'utf8')) }; } catch(_) { return { ...DEFAULT_FILTER }; } }
function saveFilter(f) { fs.writeFileSync(DATA.filter, JSON.stringify(f, null, 2)); }

// Parse lastActive text → Date (Flatmates uses "X hours ago", "yesterday", day names)
function parseLastActive(text) {
  if (!text) return null;
  const t = text.toLowerCase().trim();
  const now = new Date();
  if (t.includes('just now') || t.includes('online now') || t.includes('today')) return now;
  const minsMatch = t.match(/(\d+)\s*min/);   if (minsMatch) { const d = new Date(now); d.setMinutes(d.getMinutes() - parseInt(minsMatch[1])); return d; }
  const hrsMatch  = t.match(/(\d+)\s*hour/);  if (hrsMatch)  { const d = new Date(now); d.setHours(d.getHours() - parseInt(hrsMatch[1])); return d; }
  const daysMatch = t.match(/(\d+)\s*day/);   if (daysMatch) { const d = new Date(now); d.setDate(d.getDate() - parseInt(daysMatch[1])); return d; }
  if (t.includes('yesterday')) { const d = new Date(now); d.setDate(d.getDate() - 1); return d; }
  // Day names: "monday", "tuesday", etc.
  const days = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  const dayIdx = days.findIndex(d => t.includes(d));
  if (dayIdx >= 0) {
    const d = new Date(now);
    const diff = (now.getDay() - dayIdx + 7) % 7 || 7;
    d.setDate(d.getDate() - diff);
    return d;
  }
  return null;
}

/**
 * Convert a lastActive string → human-readable label like "active 2 days ago",
 * "active today", "active yesterday". Falls back to the raw string if unparseable.
 */
function formatActiveLabel(lastActiveStr) {
  if (!lastActiveStr || lastActiveStr === '?') return 'active ?';
  const s = String(lastActiveStr).toLowerCase().trim();
  if (s.includes('just now') || s.includes('online now') || s.includes('today') || s.includes('active today')) return 'active today';
  if (s.includes('yesterday') || s.includes('active yesterday')) return 'active yesterday';
  // Already in "X days ago" form — normalize
  const daysMatch = s.match(/(\d+)\s*day/);
  if (daysMatch) return `active ${daysMatch[1]} day${parseInt(daysMatch[1]) === 1 ? '' : 's'} ago`;
  const hrsMatch = s.match(/(\d+)\s*hour/);
  if (hrsMatch) return `active ${hrsMatch[1]}h ago`;
  const minsMatch = s.match(/(\d+)\s*min/);
  if (minsMatch) return `active ${minsMatch[1]}m ago`;
  // Try parsed date → days difference
  const parsed = parseLastActive(lastActiveStr);
  if (parsed) {
    const ageDays = Math.round((Date.now() - parsed.getTime()) / 86400000);
    if (ageDays === 0) return 'active today';
    if (ageDays === 1) return 'active yesterday';
    return `active ${ageDays} days ago`;
  }
  return `active ${lastActiveStr}`;
}

function shouldAutoNav(convo) {
  const lastActive = parseLastActive(convo.lastActive || '');
  if (!lastActive) return true;

  const now = Date.now();
  const messageAgeMs = now - lastActive.getTime();

  const withinMessage7Days = messageAgeMs < 7 * 24 * 3600 * 1000;
  const withinOnline2Days  = messageAgeMs < 2 * 24 * 3600 * 1000;

  // Must have messaged within 7 days AND been online within 2 days
  return withinMessage7Days && withinOnline2Days;
}

// Returns true if conversation passes current filter
function passesFilter(conv, filterState) {
  const { period, houses } = filterState;
  // House filter
  if (!houses.includes('all') && houses.length > 0) {
    const hc = (conv.houseCode || conv.propertyCode || '').toUpperCase();
    const matched = houses.some(h => hc.includes(h.toUpperCase()) || h.toUpperCase() === hc);
    if (!matched) return false;
  }
  // Period filter
  if (period && period !== 'all') {
    const cutoffDays = { last_24h: 1, last_3_days: 3, last_7_days: 7, last_30_days: 30, last_14_days: 14 }[period];
    if (cutoffDays) {
      const lastActive = parseLastActive(conv.lastActive || '');
      if (lastActive) {
        const ageDays = (Date.now() - lastActive.getTime()) / (1000 * 3600 * 24);
        if (ageDays > cutoffDays) return false;
      }
    }
  }
  return true;
}

// ─── Config ───────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 30 * 1000; // 30 seconds - near-real-time monitoring
const POLL_BACKOFF_STEPS = [30000, 60000, 5*60000, 10*60000, 15*60000]; // stepped backoff ladder
const SESSION_HEALTH_TTL_MS = 2 * 60 * 1000; // 2 minutes
const SESSION_ALERT_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes
const RELAY_URL = process.env.JESS_RELAY_URL || 'http://127.0.0.1:3847';
const RELAY_CALLBACK_PORT = Number(process.env.JESS_RELAY_CALLBACK_PORT || 3848);
const RELAY_CALLBACK_PATH = process.env.JESS_RELAY_CALLBACK_PATH || '/relay-callback';
const RELAY_CALLBACK_URL = process.env.JESS_RELAY_CALLBACK_URL || `http://127.0.0.1:${RELAY_CALLBACK_PORT}${RELAY_CALLBACK_PATH}`;

const BRISBANE_TZ      = 'Australia/Brisbane';
const JESS_TG_TOKEN    = '8660019141:AAEa8Oaext8nL7-Rbk505lrlbdxlbn5EmX0'; // @jess_flatmatesbot
const DIEGO_TG_CHAT_ID = '1267601160';
const AUTO_APPROVE_AFTER_MS = Infinity; // DISABLED - all approvals must be manual via Telegram
const LISTING_ROOM_CODES = ['EB2', 'SP9', 'CO1', 'SH1'];
const LISTING_REFRESH_INTERVAL_MS = 60 * 60 * 1000; // refresh every hour

let lastSessionHealthCheckAt = 0;
let callbackServer = null;
let isBrowserBusy = false;  // mutex: true while countLeads or a scrape cycle is running
let cycleInFlight = false;
let cycleRequested = false;
let callbackRegistered = false;
let lastThreadSnapshot = new Map();
let globalCycleRunner = async () => {};
let pollIntervalHandle = null;
let jessBackoffStep = 0;
let tgCommandOffset = 0;
let relayFailureStreak = 0;
let modelFailureStreak = 0;
let lastPollAt = null;
let jessPaused = false;
let jessLastError = '';
let jessLastErrorAt = null;
let jessLastErrorAffectedCount = 0;
let clearAllPending = false;
let clearAllPendingAt = 0;
let lastProcessedBatchId = null; // dedup: prevent double-execution from Telegram duplicate delivery
const sessionHealth = {
  healthy: false,
  reason: 'not-checked',
  lastAlertAt: 0,
  lastHealthyAt: 0,
};

/** Assistants config */
/** Load managers from managers.json - single source of truth */
function loadManagers() {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'managers.json'), 'utf8'));
  } catch(_) { return []; }
}

/** Get active manager for a house (first active manager with that house, else owner) */
function getManagerForHouse(houseCode) {
  const managers = loadManagers();
  const assigned = managers.find(m => m.active && m.houses.includes(houseCode) && m.role !== 'owner');
  return assigned || managers.find(m => m.active && m.role === 'owner') || managers[0];
}

/**
 * Filter an inbox array down to conversations for the given houseCode.
 * Matches by listing URL against jess-rooms.json (same logic as /jess new),
 * with a fallback to checking if the URL contains the houseCode string.
 * @param {Array} inbox - array of conversation objects
 * @param {string} houseCode - e.g. "SH1"
 * @param {Array} [rooms] - pre-loaded rooms array (optional, will load if not provided)
 * @returns {Array} filtered conversations
 */
function getInboxForHouse(inbox, houseCode, rooms) {
  const house = (houseCode || '').toUpperCase();
  if (!house) return inbox;
  const roomList = rooms || loadJSON(path.join(DATA_DIR, 'jess-rooms.json'), []);

  // Build a map of listingId → houseCode for quick lookup
  const listingIdToHouse = {};
  for (const r of roomList) {
    if (r.listingId) listingIdToHouse[String(r.listingId)] = r.houseCode.toUpperCase();
  }

  return inbox.filter(c => {
    // Priority 0: conversation carries a listingId — map it to a house code
    if (c.listingId) {
      const mappedHouse = listingIdToHouse[String(c.listingId)];
      if (mappedHouse) {
        // listingId is known — only include if it maps to the requested house
        return mappedHouse === house;
      }
      // listingId present but not in our map yet — fall through to URL matching
    }

    // Primary: match by listing URL against jess-rooms.json listingId/flatmatesId
    const url = (c.listingUrl || c.href || c.listingHref || '').toLowerCase();
    const urlMatch = roomList.find(r => r.houseCode === house && url.includes(r.listingId || r.flatmatesId || ''));
    if (urlMatch) return true;
    // Fallback 1: URL contains house code string
    if (url && url.includes(house.toLowerCase())) return true;
    // Fallback 2: conversation has a houseCode or propertyCode field
    const convHouse = (c.houseCode || c.propertyCode || '').toUpperCase();
    if (convHouse && convHouse === house) return true;
    return false;
  });
}

/** Legacy ASSISTANTS shim - built dynamically from managers.json */
function getAssistants() {
  const managers = loadManagers();
  const map = {};
  for (const m of managers) {
    map[m.id] = { name: m.name, phone: m.phone, langs: m.languages, wa: !!m.wa_id, wa_id: m.wa_id };
  }
  return map;
}
const ASSISTANTS = getAssistants();

/** Couple-friendly listings (for redirects when singles_only) */
const COUPLE_FRIENDLY_CODES = ['WE1', 'SH1', 'SH2', 'WL3', 'WL4', 'EB1', 'EB2', 'EB3'];

// ─── Logging ──────────────────────────────────────────────────────────────────

function log(msg, level = 'INFO') {
  const ts = new Date().toLocaleString('en-AU', { timeZone: BRISBANE_TZ });
  const line = `[${ts}] [${level}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch (_) {}
}
const logError = (msg) => log(msg, 'ERROR');
const logWarn  = (msg) => log(msg, 'WARN');

function formatAdminTimestamp(value) {
  if (!value) return 'never';
  try {
    return new Date(value).toLocaleString('en-AU', { timeZone: BRISBANE_TZ });
  } catch (_) {
    return String(value);
  }
}

function countQueuedApprovals() {
  return loadPending().filter(p => p.status === 'pending').length;
}

function buildJessStatusMessage() {
  return [
    `Jess status: ${jessPaused ? 'paused' : 'running'}`,
    `Last poll: ${formatAdminTimestamp(lastPollAt)}`,
    `Relay status: ${sessionHealth.healthy ? 'healthy' : `unhealthy (${sessionHealth.reason})`}`,
    `Queued approvals: ${countQueuedApprovals()}`,
    `Last error: ${jessLastError || 'none'}`,
  ].join('\n');
}


const JESS_ADMIN_STATE_FILE = path.join(DATA_DIR, 'jess-admin-state.json');

function loadAdminState() {
  return loadJSON(JESS_ADMIN_STATE_FILE, {
    ignoredThreads: {},
    snoozedThreads: {},
    autoMode: {
      enabled: false,
      startedAt: null,
      processedTonight: 0,
      cursor: 0,
      lastRunAt: null,
      stopAtDate: null,
    },
    blasts: [],
    pendingBlast: null,
  }) || { ignoredThreads: {}, snoozedThreads: {}, autoMode: { enabled: false, startedAt: null, processedTonight: 0, cursor: 0, lastRunAt: null, stopAtDate: null }, blasts: [], pendingBlast: null };
}
function saveAdminState(state) { saveJSON(JESS_ADMIN_STATE_FILE, state); }
function brisbaneNow() { return new Date(new Date().toLocaleString('en-US', { timeZone: BRISBANE_TZ })); }
function brisbaneDateKey(d = brisbaneNow()) { return d.toISOString().slice(0, 10); }
function minutesUntilBrisbane8am() {
  const now = brisbaneNow();
  const stop = new Date(now);
  stop.setHours(8,0,0,0);
  if (now >= stop) return 0;
  return Math.max(0, Math.round((stop.getTime() - now.getTime()) / 60000));
}
function parseDayCount(raw) {
  const m = String(raw || '').trim().match(/^(\d+)d$/i);
  return m ? parseInt(m[1], 10) : null;
}
function parseAdminDate(raw) {
  if (!raw) return null;
  const v = String(raw).trim();
  const lower = v.toLowerCase().replace(/\s+/g, ' ');
  const now = brisbaneNow();

  if (lower === 'today' || lower === 'tonight') return brisbaneDateKey(now);
  if (lower === 'tomorrow') {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    return brisbaneDateKey(d);
  }

  // If the user typed a weekday + date (e.g. "Tuesday 07/04/2026"),
  // resolve using the explicit DD/MM/YYYY portion first so we preserve AU ordering.
  const embeddedDdMm = lower.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
  if (embeddedDdMm) {
    const day = parseInt(embeddedDdMm[1], 10);
    const month = parseInt(embeddedDdMm[2], 10);
    let year = embeddedDdMm[3] ? parseInt(embeddedDdMm[3], 10) : now.getFullYear();
    if (embeddedDdMm[3] && embeddedDdMm[3].length === 2) year += year >= 70 ? 1900 : 2000;
    if (month < 1 || month > 12 || day < 1) return null;

    let candidate = new Date(year, month - 1, day);
    if (candidate.getMonth() !== month - 1 || candidate.getDate() !== day) return null;

    if (!embeddedDdMm[3]) {
      const todayMonth = now.getMonth() + 1;
      const todayDay = now.getDate();
      if (month < todayMonth || (month === todayMonth && day < todayDay)) {
        candidate = new Date(year + 1, month - 1, day);
        if (candidate.getMonth() !== month - 1 || candidate.getDate() !== day) return null;
      }
    }

    return `${candidate.getFullYear()}-${String(candidate.getMonth() + 1).padStart(2,'0')}-${String(candidate.getDate()).padStart(2,'0')}`;
  }

  const nextWeekdayMatch = lower.match(/^next\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/i);
  if (nextWeekdayMatch) {
    const weekdays = {
      sunday: 0,
      monday: 1,
      tuesday: 2,
      wednesday: 3,
      thursday: 4,
      friday: 5,
      saturday: 6,
    };
    const target = weekdays[nextWeekdayMatch[1].toLowerCase()];
    const d = new Date(now);
    const current = d.getDay();
    let delta = (target - current + 7) % 7;
    if (delta === 0) delta = 7;
    d.setDate(d.getDate() + delta);
    return brisbaneDateKey(d);
  }

  const ddMmMatch = lower.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (ddMmMatch) {
    const day = parseInt(ddMmMatch[1], 10);
    const month = parseInt(ddMmMatch[2], 10);
    let year = ddMmMatch[3] ? parseInt(ddMmMatch[3], 10) : now.getFullYear();
    if (ddMmMatch[3] && ddMmMatch[3].length === 2) year += year >= 70 ? 1900 : 2000;
    if (month < 1 || month > 12 || day < 1) return null;

    let candidate = new Date(year, month - 1, day);
    if (candidate.getMonth() !== month - 1 || candidate.getDate() !== day) return null;

    if (!ddMmMatch[3]) {
      const todayMonth = now.getMonth() + 1;
      const todayDay = now.getDate();
      if (month < todayMonth || (month === todayMonth && day < todayDay)) {
        candidate = new Date(year + 1, month - 1, day);
        if (candidate.getMonth() !== month - 1 || candidate.getDate() !== day) return null;
      }
    }

    return `${candidate.getFullYear()}-${String(candidate.getMonth() + 1).padStart(2,'0')}-${String(candidate.getDate()).padStart(2,'0')}`;
  }

  const parsed = new Date(v);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0,10);
}
function parseAdminTime(raw) {
  const v = String(raw || '').trim().toLowerCase().replace(/\s+/g, '');
  const m = v.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)?$/i);
  if (!m) return null;
  let h = parseInt(m[1], 10), mins = parseInt(m[2] || '0', 10);
  const ap = m[3];
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  if (h > 23 || mins > 59) return null;
  return `${String(h).padStart(2,'0')}:${String(mins).padStart(2,'0')}`;
}
function format12hr(time24) {
  const m = String(time24 || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return time24;
  let h = parseInt(m[1], 10), mins = parseInt(m[2], 10);
  const suffix = h >= 12 ? 'pm' : 'am';
  if (h > 12) h -= 12;
  if (h === 0) h = 12;
  return mins === 0 ? `${h}${suffix}` : `${h}:${String(mins).padStart(2,'0')}${suffix}`;
}
function formatDateHuman(dateStr) {
  if (!dateStr) return 'unknown';
  try {
    return new Date(`${dateStr}T00:00:00`).toLocaleDateString('en-AU', { timeZone: BRISBANE_TZ, day: 'numeric', month: 'short', year: 'numeric' });
  } catch (_) { return dateStr; }
}
function formatDateAuNumeric(dateStr) {
  if (!dateStr) return '';
  try {
    return new Date(`${dateStr}T00:00:00`).toLocaleDateString('en-AU', {
      timeZone: BRISBANE_TZ,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).replace(/\//g, '-');
  } catch (_) { return dateStr; }
}
function escapeMarkdown(text) {
  return String(text || '').replace(/([_\*\[\]\(\)~`>#+\-=|{}.!])/g, '\$1');
}
const ASSISTANT_PHONES = {
  'mathis': '+61 411 590 261',
  'emilio': '+61 481 517 377',
  'diego':  '+61 400 000 000'  // update if needed
};
function getAssistantPhone(name) {
  return ASSISTANT_PHONES[(name || '').toLowerCase().trim()] || '';
}

function getHouseAddress(houseCode) {
  const houseDetails = loadJSON(path.join(DATA_DIR, 'house-details.json'), {});
  return (houseDetails.houses || {})[String(houseCode || '').toUpperCase()]?.address || String(houseCode || '').toUpperCase();
}
function getUnreadInbox() {
  return loadJSON(path.join(DATA_DIR, 'jess-relay-inbox.json'), []).filter(c => c && (c.unread || c.isUnread));
}
function isThreadIgnored(threadId) {
  const admin = loadAdminState();
  return !!admin.ignoredThreads[String(threadId || '')];
}
function isThreadSnoozed(threadId) {
  const admin = loadAdminState();
  const snooze = admin.snoozedThreads[String(threadId || '')];
  if (!snooze) return false;
  return Date.now() < new Date(snooze.until).getTime();
}
function resolveConversationMatch(query, inbox = null) {
  const q = String(query || '').trim().toLowerCase();
  const source = Array.isArray(inbox) ? inbox : loadJSON(path.join(DATA_DIR, 'jess-relay-inbox.json'), []);
  if (!q) return null;
  let hit = source.find(c => String(c.threadId || '') === q);
  if (hit) return hit;
  hit = source.find(c => String(c.threadId || '').includes(q));
  if (hit) return hit;
  return source.find(c => String(c.name || c.memberName || '').toLowerCase().includes(q)) || null;
}
function summariseThreadMessages(thread, limit = 5) {
  const msgs = Array.isArray(thread?.messages) ? thread.messages.slice(-limit) : [];
  if (!msgs.length) return 'No messages found.';
  return msgs.map(m => {
    const who = (m.isMine || m.isOwn) ? 'Jess' : (thread?.personName || 'Lead');
    const when = m.timestamp ? formatAdminTimestamp(m.timestamp) : 'unknown time';
    return `• ${who} (${when}): ${m.text || ''}`;
  }).join('\n');
}
function buildJessHelpMessage() {
  return [
    '🤖 *Jess command centre*',
    '',
    '*Queue & status*',
    '`/jess status` — overall Jess health',
    '`/jess status <HOUSE>` — campaign progress (e.g. `/jess status SH1`)',
    '`/jess pause` · `/jess resume`',
    '`/jess stop` · `/jess start` — emergency halt / resume',
    '`/jess pending`',
    '`/jess approve all` · `/jess skip all`',
    '`/jess clear` · `/jess clear all` — remove sent/skipped/expired entries',
    '`/jess status relay` · `/jess debug relay` — show relay queue + send backlog status',
    '`/jess clear relay` · `/jess clear pending` — cancel pending sends, clear relay queue + campaign state',
    '',
    '*Conversations*',
    '`/jess new` · `/jess new <HOUSE>` — unread (optionally by house)',
    '`/jess replied` · `/jess replied <HOUSE>` — today\'s replies (optionally by house)',
    '`/jess unanswered`',
    '`/jess read <threadId or partial name>`',
    '`/jess ignore <threadId>`',
    '`/jess snooze <threadId> <Xd>`',
    '',
    '*Inspections & blasts*',
    '`/jess inspection <house> <natural-date> <time> <slot-interval> <block-length> <assistant> <amount>`',
    '  Examples: `tonight`, `tomorrow`, `next Thursday`, `03/04`',
    '  Example: `/jess inspection EB3 tomorrow 6:30pm 15 60 Emilio 8`',
    '`/jess blast <house> <date> <time> <host> [7d|10]`',
    '`/jess correct <blastHouse>` — DOM-verified correction: navigates each paused thread, skips real blast leads, sends apology to everyone else',
    '  → Shows a draft preview first. Reply ✅ to queue for all unread leads,',
    '    skip to cancel, or edit instructions to regenerate the template.',
    '    Optional: `7d` = active last 7 days only, `10` = top 10 most recent.',
    '  Example: `/jess blast SH1 today 6:45pm Emilio 7d`',
    '',
    '*Campaigns*',
    '`/jess campaign <house> [amount] [batch N] [age <N]` — uses the saved inspection block',
    '  `batch N` sends only the first N of the eligible leads (e.g. send in groups of 10)',
    '  Example: `/jess campaign SP9 8 age <40`',
    '  Example: `/jess campaign SH1 46 batch 10`',
    '`/jess campaign count <campaignId>` — count eligible threads',
    '`/jess campaign preview <campaignId>` — preview eligible threads (no send)',
    '`/jess campaign send <campaignId> [limit]` — send campaign to eligible threads',
    '`/jess campaign debug <campaignId>` — diagnostic breakdown',
    '  During preview: reply *skip* / *skip N* to swap the top N candidate(s) without changing lifecycle state.',
    '`/jess status <HOUSE>` — show live progress for a campaign (e.g. `/jess status SH1`)',
    '',
    '*Houses & assistants*',
    '`/jess houses`',
    '`/jess houses add <code> <address>`',
    '`/jess houses rem <code>`',
    '`/jess assistant`',
    '`/jess assistant add <name> <phone>`',
    '`/jess assistant rem <name>`',
    '',
    '*Auto mode*',
    '`/jess auto on` · `/jess auto off` · `/jess auto status`',
    '',
    '*Reporting*',
    '`/jess stats`',
    '`/jess refresh <house>` — force inbox scan + per-thread refresh for a house, update cached state',
    '`/jess count <house> [age <N] [by reason] [debug]` — lead count by house: lifecycle total / matched / sendable now / blocked / excluded',
    '  Example: `/jess count SP9 age <40` — counts leads with confirmed age < 40',
    '  Example: `/jess count WL4 by reason` — shows per-reason breakdown of why threads are not sendable',
    '  Example: `/jess count WL4 debug` — shows lifecycle vs operational thread IDs and diff',
    '  Age source: selector-based (profile panel) first, falls back to message text.',
    '`/jess debug thread <threadId>` — full direction/freshness debug for one thread',
    '`/jess debug candidate <name>` — search inbox by candidate name and show direction/freshness',
    '`/jess help`',
    '',
    '*Approval flow*',
    'Reply *approve* / ✅ to send, *skip* / ⏭ to discard, or send edit instructions to regenerate.',
  ].join('\n');
}
function buildJessStatusMessage() {
  const relayStatus = loadJSON(path.join(DATA_DIR, 'jess-relay-status.json'), {});
  const admin = loadAdminState();
  const inbox = loadJSON(path.join(DATA_DIR, 'jess-relay-inbox.json'), []);
  const unreadCount = inbox.filter(c => c && (c.unread || c.isUnread)).length;
  return [
    '*Jess status*',
    `Mode: ${jessPaused ? 'paused' : (admin.autoMode?.enabled ? 'auto-night' : 'manual')}`,
    `Poll: ${jessBackoffStep === 0 ? '🟢 30s (active)' : jessBackoffStep === 1 ? '💤 60s (step 1)' : jessBackoffStep === 2 ? '💤 5min (step 2)' : jessBackoffStep === 3 ? '💤 10min (step 3)' : '💤 15min (step 4+)'}`,
    `Queue depth: ${countQueuedApprovals()}`,
    `Last scrape: ${formatAdminTimestamp(relayStatus.lastScrapeTime || lastPollAt)}`,
    `Extension connected: ${relayStatus.extensionConnected === false ? 'no' : 'yes'}`,
    `Unread count: ${unreadCount}`,
    `Last poll: ${formatAdminTimestamp(lastPollAt)}`,
    `Relay health: ${sessionHealth.healthy ? 'healthy' : `unhealthy (${sessionHealth.reason})`}`,
    `Last error: ${jessLastError || 'none'}`,
  ].join('\n');
}
async function regeneratePendingDraft(entry, instruction) {
  const original = entry.originalDraft || entry.draft || entry.finalMessage || '';
  const name = entry.enquirerName || entry.name || 'there';
  const prompt = [
    'You are editing a leasing reply draft for Flatmates.',
    `Lead: ${name}`,
    `House: ${entry.houseCode || 'unknown'}`,
    `Original draft: ${original}`,
    `Lead message/context: ${entry.enquirerMessage || ''}`,
    `Edit instruction from owner: ${instruction}`,
    'Return only the revised reply text. Keep it natural, concise, warm, and ready to send.'
  ].join('\n');
  let revised = '';
  try {
    if (typeof generateGemini === 'function') {
      revised = await generateGemini(prompt);
    }
  } catch (e) {
    logWarn(`Draft regenerate failed via Gemini: ${e.message}`);
  }
  if (!revised || !String(revised).trim()) {
    revised = `${original}

[Owner edit request: ${instruction}]`.trim();
  }
  entry.draft = String(revised).trim();
  entry.originalDraft = entry.originalDraft || original;
  entry.editInstruction = instruction;
  entry.editedAt = new Date().toISOString();
  entry.status = 'pending';
  return entry;
}
async function sendPendingEntryForReview(chatId, entry, prefix = '📋') {
  const msg = `${prefix} *Pending: ${escapeMarkdown(entry.enquirerName || entry.name || 'Unknown')}*
🏠 ${escapeMarkdown(entry.houseCode || '?')} | ${escapeMarkdown(entry.action || entry.source || 'draft')}

${escapeMarkdown(entry.draft || entry.finalMessage || entry.message || '(no draft)')}

ID: \`${escapeMarkdown(entry.id)}\``;
  await sendTelegramMessage(chatId, msg, {
    parse_mode: 'MarkdownV2',
    reply_markup: JSON.stringify({
      inline_keyboard: [[
        { text: '✅ Send', callback_data: `jess_approve:${entry.id}` },
        { text: '❌ Skip', callback_data: `jess_skip:${entry.id}` }
      ]]
    })
  });
}
async function handlePendingReplyInstruction(msg) {
  const chatId = String(msg?.chat?.id || '');
  const text = String(msg?.text || '').trim();
  const replyToText = String(msg?.reply_to_message?.text || '');
  if (chatId !== DIEGO_TG_CHAT_ID || !text || !replyToText.includes('Pending:')) return false;
  const idMatch = replyToText.match(/ID:\s*`?([a-f0-9\-]{8,})`?/i);
  if (!idMatch) return false;
  const pending = loadPending();
  const entry = pending.find(p => p.id === idMatch[1]);
  if (!entry || entry.status !== 'pending') return false;
  const normalised = text.toLowerCase();
  if (normalised === 'approve' || normalised === 'approved' || normalised === '✅') {
    entry.status = 'approved';
    entry.finalMessage = entry.draft || entry.finalMessage;
    entry.approvedAt = new Date().toISOString();
    savePending(pending);
    await sendTelegramMessage(chatId, `✅ Approved: *${escapeMarkdown(entry.enquirerName || entry.name || 'Unknown')}* (${escapeMarkdown(entry.houseCode || '?')})`, { parse_mode: 'MarkdownV2' });
    return true;
  }
  if (normalised === 'skip' || normalised === '⏭' || normalised === '⏭️') {
    entry.status = 'skipped';
    entry.skippedAt = new Date().toISOString();
    savePending(pending);
    await sendTelegramMessage(chatId, `⏭ Skipped: *${escapeMarkdown(entry.enquirerName || entry.name || 'Unknown')}* (${escapeMarkdown(entry.houseCode || '?')})`, { parse_mode: 'MarkdownV2' });
    // ── v4: mark thread as skipped ──────────────────────────────────────────
    try {
      const _v4ts6 = require('./modules/thread-state');
      const _v4tid6 = entry.conversationUrl?.replace('relay://thread/', '') || entry.conversationId || null;
      if (_v4tid6) {
        const _v4st6 = _v4ts6.get(_v4tid6) || {};
        _v4ts6.set(_v4tid6, { ..._v4st6, skippedAt: Date.now(), needsReply: false });
      }
    } catch (_v4e6) { /* non-fatal */ }
    // ── end v4 ────────────────────────────────────────────────────────────
    return true;
  }
  await regeneratePendingDraft(entry, text);
  savePending(pending);
  await sendTelegramMessage(chatId, `✏️ Updated draft for *${escapeMarkdown(entry.enquirerName || entry.name || 'Unknown')}*`, { parse_mode: 'MarkdownV2' });
  await sendPendingEntryForReview(chatId, entry, '✏️');
  return true;
}
// ─── Blast preview / approval helpers ────────────────────────────────────────

/**
 * Build a blast message from template variables.
 * Pass name='[Name]' for the preview placeholder.
 */
function formatBlastTemplate(name, dayLabel, time, addr, host, phone) {
  return `Hi ${name} 😊\n\nThanks for your message about the room. We'd love to invite you to an inspection ${dayLabel} at ${time}.\n\nPlease message ${host} on WhatsApp to confirm if that time works for you, or to arrange another suitable time:\n${phone}\n\nSee you soon 🏠`;
}

function parseJessInspectionCommand(text) {
  const source = String(text || '').trim();
  const match = source.match(/^\/jess\s+inspection\s+(.+)$/i);
  if (!match) return null;

  const parts = match[1].trim().split(/\s+/).filter(Boolean);
  if (parts.length < 7) return null;

  const houseCode = parts[0];
  const amountRaw = parts[parts.length - 1];
  const assistantRaw = parts[parts.length - 2];
  const blockLengthRaw = parts[parts.length - 3];
  const slotIntervalRaw = parts[parts.length - 4];

  const remainder = parts.slice(1, parts.length - 4);
  if (remainder.length < 2) return null;

  let splitIndex = -1;
  for (let i = 1; i < remainder.length; i++) {
    const candidateTime = remainder.slice(i).join(' ');
    if (parseAdminTime(candidateTime)) {
      splitIndex = i;
      break;
    }
  }
  if (splitIndex <= 0) return null;

  const naturalDateParts = remainder.slice(0, splitIndex);
  const timeParts = remainder.slice(splitIndex);
  if (!naturalDateParts.length || !timeParts.length) return null;

  return {
    houseCode,
    naturalDateRaw: naturalDateParts.join(' '),
    timeRaw: timeParts.join(' '),
    slotIntervalRaw,
    blockLengthRaw,
    assistantRaw,
    amountRaw,
  };
}

function getNaturalDateLabel(raw, resolvedDate) {
  const value = String(raw || '').trim();
  if (!value) return resolvedDate || '';
  const lower = value.toLowerCase().replace(/\s+/g, ' ');
  if (lower === 'tonight') return 'tonight';
  if (lower === 'today') return 'today';
  if (lower === 'tomorrow') return 'tomorrow';
  if (/^next\s+/.test(lower)) return value;
  return value;
}

function getInspectionDayLabel(inspection) {
  if (!inspection) return null;
  const wording = String(inspection.naturalDateLabel || inspection.naturalDateRaw || '').trim();
  if (wording) {
    const lower = wording.toLowerCase();
    if (lower === 'tonight') return 'tonight';
    if (lower === 'today') return 'today';
    if (lower === 'tomorrow') return 'tomorrow';
    if (/^next\s+/.test(lower)) return wording;
  }
  return inspection.date || null;
}

function buildInspectionDraftFromSaved(name, inspection) {
  if (!inspection) return '';
  const addr = inspection.address || getHouseAddress(inspection.houseCode);
  const assistant = inspection.assistant || inspection.host || '';
  const assistantPhone = getAssistantPhone(assistant);
  const dayLabel = getInspectionDayLabel(inspection) || inspection.date || 'soon';
  const timeLabel = format12hr(inspection.time || '').replace(/^0/, '') || inspection.time || '';
  return [
    `Hi! We\'re doing inspections on ${dayLabel}${timeLabel ? ` at ${timeLabel}` : ''}.`,
    'Would you like to come?',
    '',
    `📍 ${addr}`,
    `${assistant} will be there to assist you.`,
    assistantPhone ? `Message when you arrive: ${assistantPhone}` : null,
  ].filter(Boolean).join('\n');
}

function buildHouseCampaignConfig(houseCode, inspection, amountOverride) {
  const house = String(houseCode || inspection?.houseCode || '').toUpperCase();
  if (!house || !inspection) return null;

  const amount = amountOverride === 'all'
    ? 'all'
    : (Number.isFinite(Number(amountOverride)) && Number(amountOverride) > 0 ? Number(amountOverride) : Number(inspection.amount || inspection.leadAmount || 0));
  if (!(amount === 'all' || (Number.isFinite(amount) && amount > 0))) return null;

  const addr = inspection.address || getHouseAddress(house) || 'Address unavailable';
  const assistant = inspection.assistant || inspection.host || getManagerForHouse(house)?.name || 'Our team';
  const assistantPhone = getAssistantPhone(assistant) || getManagerForHouse(house)?.phone || '';
  const dayLabel = getInspectionDayLabel(inspection) || inspection.date || 'soon';
  const timeLabel = format12hr(inspection.time || '').replace(/^0/, '') || inspection.time || '';
  const message = [
    'Hi! We\'re doing inspections ' + dayLabel + (timeLabel ? ` at ${timeLabel}` : '') + '.',
    '',
    'Would you like to come?',
    '',
    `📍 ${addr}`,
    `${assistant} will be there to assist you.`,
    assistantPhone ? `Message when you arrive: ${assistantPhone}` : null,
  ].filter(Boolean).join('\n');

  const campaignId = `house-${house}`;
  return {
    id: campaignId,
    houseCode: house,
    name: `${house} Inspection ${dayLabel}${timeLabel ? ` ${timeLabel}` : ''}`,
    maxBatch: amount === 'all' ? 9999 : amount,
    message,
    inspection,
    requestedAmount: amount,
  };
}

function upsertHouseCampaignConfig(config) {
  if (!config?.id) return null;
  const campaignsPath = path.join(DATA_DIR, 'jess-campaigns.json');
  const campaigns = loadJSON(campaignsPath, []);
  const next = Array.isArray(campaigns) ? campaigns.slice() : [];
  const idx = next.findIndex(c => c && c.id === config.id);
  const stored = {
    id: config.id,
    houseCode: config.houseCode,
    name: config.name,
    maxBatch: config.maxBatch,
    message: config.message,
    updatedAt: new Date().toISOString(),
    meta: {
      generatedFromInspection: true,
      inspectionDate: config.inspection?.date || null,
      inspectionTime: config.inspection?.time || null,
      assistant: config.inspection?.assistant || config.inspection?.host || null,
      requestedAmount: config.requestedAmount,
    },
  };
  if (idx >= 0) next[idx] = { ...next[idx], ...stored };
  else next.push(stored);
  saveJSON(campaignsPath, next);
  return stored;
}

function formatInspectionTraceStamp(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BRISBANE_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type) => parts.find(p => p.type === type)?.value || '00';
  return `${get('year')}${get('month')}${get('day')}-${get('hour')}${get('minute')}`;
}

function createInspectionTraceId(houseCode) {
  const safeHouse = String(houseCode || 'UNKNOWN').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '') || 'UNKNOWN';
  return `JESS-INSPECTION-${safeHouse}-${formatInspectionTraceStamp()}`;
}

function sanitiseInspectionTraceDetails(details = {}) {
  const out = {};
  for (const [key, value] of Object.entries(details || {})) {
    if (value === undefined) continue;
    if (value == null) {
      out[key] = value;
      continue;
    }
    if (Array.isArray(value)) {
      out[key] = value.slice(0, 20).map(item => {
        if (item == null) return item;
        if (typeof item === 'object') return JSON.parse(JSON.stringify(item));
        return item;
      });
      continue;
    }
    if (typeof value === 'object') {
      out[key] = JSON.parse(JSON.stringify(value));
      continue;
    }
    out[key] = value;
  }
  return out;
}

function logInspectionStage(traceId, stage, details = {}, level = 'INFO') {
  const payload = sanitiseInspectionTraceDetails(details);
  const suffix = Object.keys(payload).length ? ` ${JSON.stringify(payload)}` : '';
  log(`[inspection-trace:${traceId}] ${stage}${suffix}`, level);
}

async function runInspectionStage(traceId, stage, details, fn) {
  const startDetails = typeof details === 'function' ? details() : details;
  logInspectionStage(traceId, stage, startDetails);
  try {
    return await fn();
  } catch (error) {
    logInspectionStage(traceId, `${stage} failed`, {
      ...(startDetails && typeof startDetails === 'object' ? startDetails : {}),
      error: error?.message || String(error),
    }, 'ERROR');
    throw error;
  }
}

function buildInspectionDebugSummary(houseCode) {
  const house = String(houseCode || '').trim().toUpperCase();
  const inspection = house ? getInspectionForRoom(house) : null;
  const pending = loadPending();
  const candidates = pending.filter(p => (p.status === 'pending') && String(p.houseCode || '').trim().toUpperCase() === house);
  const eligible = candidates.filter(p => !!buildInspectionDraftFromSaved(p.enquirerName || p.name || 'there', inspection));
  const slotInterval = inspection ? (inspection.slot_interval_minutes || inspection.intervalMins || inspection.slotInterval || null) : null;
  const blockLength = inspection ? (inspection.block_length_minutes || inspection.blockLengthMins || inspection.blockLength || inspection.durationMins || inspection.duration_minutes || null) : null;
  const amount = inspection ? (inspection.amount || inspection.leadAmount || null) : null;
  const leadAmount = inspection ? (inspection.leadAmount || inspection.amount || null) : null;
  const campaignFallbackReadable = !!(inspection && inspection.date && inspection.time && slotInterval && blockLength && (inspection.assistant || inspection.host) && (inspection.address || getHouseAddress(house)));
  const legacyCampaignDependencySeemsToBlockExecution = !!(inspection && !inspection.campaignId && campaignFallbackReadable);

  return {
    house,
    savedInspectionExists: !!inspection,
    savedDate: inspection?.date || null,
    savedTime: inspection?.time || null,
    slotInterval,
    blockLength,
    assistant: inspection?.assistant || inspection?.host || null,
    amount,
    leadAmount,
    pendingDraftCount: candidates.length,
    eligibleDraftCount: eligible.length,
    campaignFallbackReadable,
    legacyCampaignDependencySeemsToBlockExecution,
  };
}

function formatInspectionDebugSummaryMessage(summary) {
  return [
    `🔎 *Inspection debug — ${summary.house || '?'}*`,
    `• Saved inspection block: ${summary.savedInspectionExists ? 'yes' : 'no'}`,
    `• Saved date/time: ${summary.savedDate || '—'} ${summary.savedTime || ''}`.trim(),
    `• Slot interval: ${summary.slotInterval || '—'} min`,
    `• Block length: ${summary.blockLength || '—'} min`,
    `• Assistant: ${summary.assistant || '—'}`,
    `• Amount / leadAmount: ${summary.amount || '—'} / ${summary.leadAmount || '—'}`,
    `• Pending draft count: ${summary.pendingDraftCount}`,
    `• Eligible draft count: ${summary.eligibleDraftCount}`,
    `• Campaign fallback can read saved inspection: ${summary.campaignFallbackReadable ? 'yes' : 'no'}`,
    `• Legacy campaign dependency seems to block execution: ${summary.legacyCampaignDependencySeemsToBlockExecution ? 'yes' : 'no'}`,
  ].join('\n');
}


// ─── Campaign confirm handler ─────────────────────────────────────────────────

/**
 * Handle "confirm" reply when a campaign send is awaiting approval.
 * Returns true if the message was consumed.
 */
async function handlePendingCampaignConfirm(msg) {
  const chatId = String(msg?.chat?.id || '');
  const text   = String(msg?.text || '').trim();
  if (chatId !== DIEGO_TG_CHAT_ID || !text) return false;

  const normalised = text.toLowerCase().trim();
  const pendingSendJob = loadPendingCampaignSendJob();
  if (!pendingSendJob) {
    if (normalised === 'confirm') {
      log('[campaign-confirm] early exit: pendingSendJob missing', 'WARN');
      await sendTelegramMessage(chatId, 'No pending campaign to confirm.').catch(()=>{});
      return true;
    }
    return false;
  }

  // Expire after 2 minutes
  if (pendingSendJob.expiresAt && Date.now() > pendingSendJob.expiresAt) {
    clearPendingCampaignSendJob();
    return false;
  }

  if (normalised === 'confirm') {
    const { campaignId, limit, threads, batchId, house, createdBy } = pendingSendJob;
    const threadIds = Array.isArray(threads)
      ? threads.map(t => String(t?.threadId || t || '')).filter(Boolean)
      : [];
    log(`[campaign-confirm] confirm received pendingSendJob=${!!pendingSendJob} campaignId=${campaignId || 'missing'} batchId=${batchId || 'missing'} house=${house || 'missing'} createdBy=${createdBy || 'unknown'} limit=${limit ?? 'missing'} threads=${threadIds.length} sampleThreads=${threadIds.slice(0, 3).join(',') || 'none'}`, 'INFO');

    // Dedup: reject if this batchId was already processed (Telegram duplicate delivery)
    if (batchId && batchId === lastProcessedBatchId) {
      log(`[campaign-confirm] duplicate confirm blocked (batchId=${batchId})`, 'WARN');
      return true;
    }

    if (!campaignId) {
      log('[campaign-confirm] early exit: campaignId missing', 'WARN');
      clearPendingCampaignSendJob();
      return true;
    }

    if (!threadIds.length) {
      log('[campaign-confirm] early exit: threads empty', 'WARN');
      clearPendingCampaignSendJob();
      return true;
    }

    // Clear IMMEDIATELY before any sends to prevent double-execution across restarts/workers
    clearPendingCampaignSendJob();
    lastProcessedBatchId = batchId || null;

    try {
      const campaignRunner = require('./modules/campaign-runner');

      // Fix 1: Check relay paused state BEFORE sending
      try {
        const relayStatus = await relayGet('/api/status').catch(() => null);
        if (relayStatus?.paused) {
          await sendTelegramMessage(chatId, '⚠️ Campaign send aborted: Jess is paused. Resume Jess first with /jess resume.').catch(()=>{});
          return true;
        }
      } catch (_) {}

      // Load campaign config — must reload here as confirm runs in different scope than preview
      const campaign = campaignRunner.loadCampaign(campaignId);
      log(`[campaign-confirm] campaign loaded campaignId=${campaignId} campaignExists=${!!campaign} messageExists=${!!campaign?.message} house=${campaign?.house || 'n/a'}`, 'INFO');
      if (!campaign) {
        log('[campaign-confirm] early exit: campaign not found', 'WARN');
        await sendTelegramMessage(chatId, `❌ Campaign send failed: campaign ${campaignId} not found`).catch(()=>{});
        return true;
      }
      if (!campaign.message) {
        log('[campaign-confirm] early exit: message empty', 'WARN');
        await sendTelegramMessage(chatId, `❌ Campaign send failed: campaign ${campaignId} has no message`).catch(()=>{});
        return true;
      }
      
      log(`[campaign-confirm] sending sequentially campaignId=${campaignId} batchId=${batchId || 'missing'} threads=${threadIds.length}`, 'INFO');
      // Sequential delivery with 15s intervals — extension needs time to navigate+send+return to inbox
      // Sending all at once loses commands when extension page-navigates (SPA reload kills command queue)
      const _campThreads = Array.isArray(threads) ? threads : threadIds;
      const results = { sent: 0, skipped: 0, errors: 0, rejected: 0 };
      const campaignDedup = require('./modules/campaign-dedup');
      const campaignProgress = require('./modules/campaign-progress');
      const CAMPAIGN_INTERVAL_MS = 10000;

      // ── Progress tracking: start ──────────────────────────────────────────
      campaignProgress.startCampaign(campaignId, house || campaign.houseCode || campaignId, _campThreads.length, chatId, batchId);
      campaignProgress.startStuckWatcher(async (_cid, _msg, _cChatId) => {
        const _alertChatId = _cChatId || chatId;
        if (_alertChatId) await sendTelegramMessage(_alertChatId, _msg, { parse_mode: 'Markdown' }).catch(()=>{});
      });
      for (let index = 0; index < _campThreads.length; index++) {
        const _ct = _campThreads[index];
        const _ctId = String(_ct.threadId || _ct || '');
        if (!_ctId) { results.skipped++; continue; }

        // Log the thread we're about to send to — using fields from the FRESH preview object
        // (thread objects stored in pendingSendJob come from fresh inbox, not stale thread-states)
        const _ctName = _ct.name || _ct.memberName || _ctId;
        const _ctLA = _ct.lastActive || 'n/a';
        const _ctUpdatedAt = _ct.updatedAt || _ct.scrapedAt || 'n/a';
        const _ctInbMsgs = Array.isArray(_ct.messages) ? _ct.messages.filter(m => !(m.isMine || m.isOwn)) : [];
        const _ctLastIn = _ctInbMsgs.length ? _ctInbMsgs[_ctInbMsgs.length - 1] : null;
        const _ctInTs = _ctLastIn?.sentAt || _ctLastIn?.timestamp || 'n/a';
        const _ctInText = String(_ctLastIn?.text || _ctLastIn?.body || '').slice(0, 80);
        const _ctOutbMsgs = Array.isArray(_ct.messages) ? _ct.messages.filter(m => (m.isMine || m.isOwn)) : [];
        const _ctLastOut = _ctOutbMsgs.length ? _ctOutbMsgs[_ctOutbMsgs.length - 1] : null;
        const _ctOutTs = _ctLastOut?.sentAt || _ctLastOut?.timestamp || 'n/a';
        log(
          `[campaign-confirm-send] threadId=${_ctId} name=${_ctName.slice(0,30)} ` +
          `houseCode=${_ct.houseCode||'?'} lastActive=${_ctLA} updatedAt=${_ctUpdatedAt} ` +
          `latestInboundTs=${_ctInTs} latestInboundText="${_ctInText}" ` +
          `latestOutboundTs=${_ctOutTs} lastFrom=${_ct.lastFrom||'n/a'} ` +
          `index=${index+1}/${_campThreads.length} batchId=${batchId||'n/a'}`,
          'INFO'
        );

        // Hard guard: exclude thread if person is no longer active on Flatmates
        if (_ct.isThreadInactive === true) {
          results.skipped++;
          campaignProgress.recordSkipped(campaignId);
          const _inactMsg = `⏭ ${_ctName}: skipped — no longer active (inactive thread)`;
          await sendTelegramMessage(chatId, _inactMsg).catch(()=>{});
          log(`[campaign-seq] ${_ctId} skipped_inactive_thread (no longer active)`, 'INFO');
          try { require('./modules/campaign-filter').recordSkip(campaignId, _ctId, 'inactive thread'); } catch(_se){}
          continue;
        }

        // Activity check — use lastActive from the FRESH preview thread object.
        // Do NOT override with stale thread-states (that was the source of wrong-thread sends).
        // Thread objects passed via pendingSendJob already passed the filter; we only re-check
        // for the hard guard: explicitly inactive per the fresh field.
        const _now = Date.now();
        const _threeDaysAgo = _now - 3 * 24 * 60 * 60 * 1000;
        const _freshLA = String(_ct.lastActive || '').toLowerCase().trim();
        let _liveActiveMs;
        if (!_freshLA || _freshLA === 'online now' || _freshLA === 'online today' || _freshLA === 'active today') _liveActiveMs = _now;
        else if (_freshLA === 'active yesterday' || _freshLA === 'online yesterday') _liveActiveMs = _now - 86400000;
        else { const _dm = _freshLA.match(/(\d+)\s+days?\s+ago/); _liveActiveMs = _dm ? _now - parseInt(_dm[1])*86400000 : (Date.parse(_freshLA) || 0); }
        
        if (_liveActiveMs && _liveActiveMs < _threeDaysAgo) {
          results.skipped++;
          campaignProgress.recordSkipped(campaignId);
          const _skipMsg = `⏭ ${_ctName}: skipped_inactive (${_freshLA})`;
          await sendTelegramMessage(chatId, _skipMsg).catch(()=>{});
          log(`[campaign-seq] ${_ctId} skipped_inactive lastActive=${_freshLA}`, 'INFO');
          try { require('./modules/campaign-filter').recordSkip(campaignId, _ctId, 'skipped_inactive'); } catch(_se){}
          continue;
        }
        // Unknown/missing lastActive → skip with review flag
        if (!_liveActiveMs || (_liveActiveMs === 0 && !_freshLA)) {
          results.skipped++;
          campaignProgress.recordSkipped(campaignId);
          await sendTelegramMessage(chatId, `⚠️ ${_ctName}: skipped_unknown_activity`).catch(()=>{});
          log(`[campaign-seq] ${_ctId} skipped_unknown_activity lastActive=${_freshLA}`, 'INFO');
          try { require('./modules/campaign-filter').recordSkip(campaignId, _ctId, 'skipped_unknown_activity'); } catch(_se){}
          continue;
        }
        
        // Dedup + history check
        const _ddCheck = await campaignDedup.checkThread(_ctId, campaignId, campaign.message, { forceSent: false }).catch(() => ({ decision: 'safe_to_send' }));
        if (_ddCheck.decision === 'skip_duplicate') {
          results.skipped++;
          campaignProgress.recordSkipped(campaignId);
          await sendTelegramMessage(chatId, `🚫 ${_ctName}: skipped_duplicate`).catch(()=>{});
          log(`[campaign-seq] ${_ctId} skipped_duplicate`, 'INFO');
          try { require('./modules/campaign-filter').recordSkip(campaignId, _ctId, 'skipped_duplicate'); } catch(_se){}
          continue;
        }
        if (_ddCheck.decision === 'review_manually') {
          results.skipped++;
          campaignProgress.recordSkipped(campaignId);
          await sendTelegramMessage(chatId, `⚠️ ${_ctName}: skipped_recent_outbound`).catch(()=>{});
          log(`[campaign-seq] ${_ctId} skipped_recent_outbound`, 'INFO');
          continue;
        }
        
        log(`[campaign-confirm] relay send threadId=${_ctId} index=${index + 1}/${_campThreads.length} campaignId=${campaignId} batchId=${batchId || 'missing'}`, 'INFO');
        const _relayResp = await relayPost('/api/navigate-and-reply', { threadId: _ctId, text: campaign.message }).catch(e => ({ ok: false, reason: e.message }));
        const _relayPendingOnly = _relayResp && _relayResp.ok !== false && String(_relayResp.method || '').toLowerCase() === 'navigate-pending';
        log(`[campaign-confirm] relay result threadId=${_ctId} outcome=${_relayResp && _relayResp.ok === false ? 'failure' : (_relayPendingOnly ? 'pending_only' : 'success')} status=${_relayResp?.status ?? 'n/a'} method=${_relayResp?.method || 'n/a'} reason=${_relayResp?.reason || 'n/a'}`, (_relayResp && _relayResp.ok === false) || _relayPendingOnly ? 'WARN' : 'INFO');
        if (_relayResp && _relayResp.ok === false) {
          results.rejected++;
          campaignProgress.recordFailed(campaignId);
          log(`[campaign-seq] ${_ctId} relay rejected: ${_relayResp.reason}`, 'WARN');
          continue;
        }
        if (_relayPendingOnly) {
          results.rejected++;
          campaignProgress.recordFailed(campaignId);
          await sendTelegramMessage(chatId, `⚠️ ${_ctName}: relay queued only (navigate-pending). Campaign paused — not marking as sent.`).catch(()=>{});
          log(`[campaign-seq] ${_ctId} relay queued only (navigate-pending) — not marking as sent`, 'WARN');
          break;
        }
        // Mark sent in campaign log
        try {
          const _csFile = path.join(__dirname, '..', 'mission-control', 'data', 'jess-campaign-sent.json');
          const _cs = loadJSON(_csFile, {});
          _cs[campaignId] = _cs[campaignId] || [];
          if (!_cs[campaignId].includes(_ctId)) _cs[campaignId].push(_ctId);
          saveJSON(_csFile, _cs);
        } catch(_e) {}
        // Record in repeat-contact log (used for 24h/48h cooldowns and same-date checks)
        try {
          const _rcInspDate = pendingSendJob?.inspectionDate || null;
          require('./modules/campaign-repeat-contact').recordSent(_ctId, campaignId, _rcInspDate, _ct.houseCode || house || null, 'inspection_invite');
        } catch(_rce) { log(`[campaign-seq] repeat-contact recordSent error: ${_rce.message}`, 'WARN'); }
        results.sent++;
        campaignProgress.recordSent(campaignId);
        log(
          `[campaign-seq] sent threadId=${_ctId} name=${_ctName.slice(0,30)} ` +
          `houseCode=${_ct.houseCode||'?'} latestInboundTs=${_ctInTs} latestInboundText="${_ctInText}" ` +
          `lastActive=${_ctLA} batchId=${batchId||'n/a'} (${results.sent}/${_campThreads.length})`,
          'INFO'
        );
        if (results.sent < _campThreads.length) {
          await sendTelegramMessage(chatId, `✅ ${results.sent}/${_campThreads.length} queued — next in ${Math.round(CAMPAIGN_INTERVAL_MS/1000)}s…`).catch(()=>{});
          await new Promise(r => setTimeout(r, CAMPAIGN_INTERVAL_MS));
        }
      }

      // ── Progress tracking: complete ───────────────────────────────────────
      campaignProgress.completeCampaign(campaignId);
      const _completionMsg = campaignProgress.formatCompletion(campaignId);
      if (_completionMsg) {
        await sendTelegramMessage(chatId, _completionMsg, { parse_mode: 'Markdown' }).catch(()=>{});
      }

      // Fix 3: Honest delivery status — queued ≠ delivered
      const attempted = (results.sent || 0) + (results.rejected || 0) + (results.errors || 0);
      await sendTelegramMessage(chatId,
        `📣 *Campaign queued: ${campaignId}*
📤 Attempted: ${attempted}
🔄 Queued to relay: ${results.sent} _(extension will deliver)_
🚫 Rejected by relay: ${results.rejected || 0}
⏭ Already sent (skipped): ${results.skipped}
❌ Total errors: ${results.errors}

_Note: "Queued" means the relay accepted the command — delivery depends on the extension._`,
        { parse_mode: 'Markdown' }
      ).catch(()=>{});

      // ── Notify assistant/host via WhatsApp ───────────────────────────────
      // Send only when at least one lead was successfully queued to relay.
      if (results.sent > 0) {
        try {
          const _asstName = campaign.meta?.assistant || campaign.assistant || campaign.host || null;
          const _inspDate = campaign.meta?.inspectionDate || null;
          const _inspTime = campaign.meta?.inspectionTime || null;
          const _houseAddr = getHouseAddress(house || campaign.houseCode || campaignId);

          if (_asstName) {
            const _managers = loadManagers();
            const _asstMgr = _managers.find(m =>
              m.active &&
              (m.name.toLowerCase() === _asstName.toLowerCase() || (m.full_name || '').toLowerCase() === _asstName.toLowerCase())
            );
            const _asstWaId = _asstMgr?.wa_id || null;

            if (_asstWaId) {
              const _dateLabel = _inspDate || 'TBD';
              const _timeLabel = _inspTime || 'TBD';
              const _waNotif = `🏠 *Inspection confirmed — ${house || campaign.houseCode}*\n\nHi ${_asstName}! A campaign was just sent for the following inspection:\n\n📍 ${_houseAddr}\n📅 ${_dateLabel} at ${_timeLabel}\n👥 ${results.sent} lead${results.sent === 1 ? '' : 's'} queued\n\nPlease be ready to host. Good luck! 💪`;
              const _waSent = await sendWaMessage(_asstWaId, _waNotif).catch(() => false);
              log(`[campaign-confirm] WhatsApp notification to ${_asstName} (${_asstWaId}): ${_waSent ? 'sent' : 'failed'}`, _waSent ? 'INFO' : 'WARN');
              await sendTelegramMessage(chatId, `📲 WhatsApp notification ${_waSent ? 'sent' : '⚠️ failed'} to ${_asstName}`).catch(()=>{});
            } else {
              log(`[campaign-confirm] assistant ${_asstName} has no wa_id — skipping WA notification`, 'WARN');
              await sendTelegramMessage(chatId, `⚠️ No WhatsApp ID for ${_asstName} — notification not sent`).catch(()=>{});
            }
          } else {
            log(`[campaign-confirm] no assistant/host on campaign ${campaignId} — skipping WA notification`, 'INFO');
          }
        } catch (_waErr) {
          log(`[campaign-confirm] WhatsApp notification error: ${_waErr.message}`, 'WARN');
        }
      }
      // ── End assistant WA notification ────────────────────────────────────
    } catch (err) {
      await sendTelegramMessage(chatId, `❌ Campaign send failed: ${err.message}`).catch(()=>{});
    }
    return true;
  }

  // ── skip [N] — remove current top-N threads, slide in the next candidates ──
  const skipMatch = normalised.match(/^skip(?:\s+(\d+))?$/);
  if (skipMatch) {
    const skipN = Math.max(1, parseInt(skipMatch[1] || '1', 10));
    const {
      campaignId,
      house,
      threads: currentThreads,
      candidatePool,
      skippedInSession,
      batchSize,
      expiresAt,
      message: pendingMessage,
      createdBy,
    } = pendingSendJob;

    // Threads to skip = first skipN entries of the current batch
    const toSkip = (Array.isArray(currentThreads) ? currentThreads : []).slice(0, skipN);
    const toSkipIds = new Set(toSkip.map(t => String(t?.threadId || t || '')).filter(Boolean));
    const updatedSkipped = [...(Array.isArray(skippedInSession) ? skippedInSession : []), ...toSkipIds];
    const skippedSet = new Set(updatedSkipped);

    // Remaining batch (threads after the skipped ones that were already queued)
    const remainingBatch = (Array.isArray(currentThreads) ? currentThreads : []).slice(skipN);

    // Pull next candidates from pool — exclude already-skipped and already-in-remaining-batch
    const remainingBatchIds = new Set(remainingBatch.map(t => String(t?.threadId || t || '')));
    const pool = Array.isArray(candidatePool) ? candidatePool : [];
    const nextCandidates = pool.filter(t => {
      const id = String(t?.threadId || t || '');
      return id && !skippedSet.has(id) && !remainingBatchIds.has(id);
    });

    // Fill up to batchSize (or original effective count)
    const targetSize = typeof batchSize === 'number' ? batchSize : (remainingBatch.length + skipN);
    const needed = Math.max(0, targetSize - remainingBatch.length);
    const newSlots = nextCandidates.slice(0, needed);
    const newBatch = [...remainingBatch, ...newSlots];

    if (!newBatch.length) {
      // No more candidates at all
      clearPendingCampaignSendJob();
      await sendTelegramMessage(chatId, 'No more eligible threads to preview.').catch(()=>{});
      return true;
    }

    // Build preview lines for new batch
    const newPreviewLines = newBatch.map((t, i) => {
      const name = (t.name || t.memberName || 'Unknown').slice(0, 25);
      const threadId = t.threadId;
      const activeLabel = formatActiveLabel(t.lastActive || '?');
      const inboundMsgs = Array.isArray(t.messages) ? t.messages.filter(m => !(m.isMine || m.isOwn)) : [];
      const latestInbound = inboundMsgs.length ? inboundMsgs[inboundMsgs.length - 1] : null;
      const latestInboundTs = latestInbound?.sentAt || latestInbound?.timestamp || null;
      const inboundText = String(latestInbound?.text || latestInbound?.body || t.snippet || t.lastMessage || '').slice(0, 60);
      const snippetLabel = inboundText ? ` | "${inboundText}"` : '';
      const inboundTsLabel = latestInboundTs ? ` | inbound=${latestInboundTs}` : '';
      return `${i + 1}. *${name}* (${threadId}) | ${activeLabel}${inboundTsLabel}${snippetLabel}`;
    });

    // Re-save with updated batch, preserving expiresAt and context
    const updatedJob = {
      ...pendingSendJob,
      threads: newBatch,
      skippedInSession: updatedSkipped,
      batchId: pendingSendJob.batchId, // keep same batchId — skip doesn't start a new session
      expiresAt,                        // preserve original expiry window
    };
    savePendingCampaignSendJob(updatedJob);

    const skippedNames = toSkip.map(t => (t.name || t.memberName || String(t?.threadId || t || 'unknown')).slice(0, 20)).join(', ');
    const campaignRunner = require('./modules/campaign-runner');
    const campaign = campaignRunner.loadCampaign(campaignId);
    const campaignName = campaign?.name || campaignId;

    log(
      `[campaign-skip] campaignId=${campaignId} skippedN=${skipN} skippedIds=${[...toSkipIds].join(',')} ` +
      `newBatchSize=${newBatch.length} remainingPool=${nextCandidates.length - newSlots.length}`,
      'INFO'
    );

    const _skipReplyText = [
      `⏭ Skipped: ${skippedNames}`,
      '',
      `📣 *Campaign send preview: ${campaignName}*`,
      `Will send to *${newBatch.length}* thread(s) — updated batch:`,
      ...newPreviewLines,
      '',
      `*Message:* _${(pendingMessage || '').slice(0, 100)}_`,
      '',
      '⚠️ Reply *confirm* to send, *cancel* to abort, or *skip* / *skip N* to swap again. (Expiry unchanged)',
    ].join('\n');
    log(`[campaign-skip] reply text built (${_skipReplyText.length} chars), sending chunked`, 'INFO');
    await sendTelegramChunked(chatId, _skipReplyText, { parse_mode: 'Markdown' }).catch(e => {
      log(`[campaign-skip] sendTelegramChunked failed: ${e.message}`, 'WARN');
    });
    log(`[campaign-skip] reply sent successfully`, 'INFO');
    return true;
  }

  if (normalised === 'cancel' || normalised === 'no') {
    clearPendingCampaignSendJob();
    await sendTelegramMessage(chatId, '❌ Campaign send cancelled.').catch(()=>{});
    return true;
  }

  // Any other text cancels (safety)
  clearPendingCampaignSendJob();
  return false;
}

/**
 * Handle an incoming Telegram message when a blast is awaiting approval.
 * Returns true if the message was consumed (skip further command processing).
 */
async function handlePendingBlastApproval(msg) {
  const chatId = String(msg?.chat?.id || '');
  const text = String(msg?.text || '').trim();
  if (chatId !== DIEGO_TG_CHAT_ID || !text) return false;

  const admin = loadAdminState();
  if (!admin.pendingBlast || !admin.pendingBlast.awaitingApproval) return false;

  const pb = admin.pendingBlast;
  const normalised = text.toLowerCase().trim();

  // ── Approve ──────────────────────────────────────────────────────────────
  if (normalised === 'approve' || normalised === '✅') {
    const inbox = await fetchInbox().catch(() => loadJSON(path.join(DATA_DIR, 'jess-relay-inbox.json'), []));
    const pending = loadPending();

    // Resolve the listing ID for this blast's house — needed for expectedListingId mode
    const blastRooms = loadRooms();
    const blastRoom = blastRooms.find(r => r.houseCode && r.houseCode.toUpperCase() === (pb.houseCode || '').toUpperCase());
    let blastExpectedListingId = blastRoom?.listingId ? String(blastRoom.listingId) : null;
    if (!blastExpectedListingId && blastRoom?.listing_url) {
      const lm = blastRoom.listing_url.match(/P(\d+)/i);
      if (lm) blastExpectedListingId = lm[1];
    }

    let queued = 0;
    let skipped = 0;
    for (const threadId of (pb.targetThreads || [])) {
      if (isThreadIgnored(threadId) || isThreadSnoozed(threadId)) continue;
      const alreadyActioned = pending.some(p => String(p.conversationId || '') === threadId && ['pending','approved','sent'].includes(p.status));
      if (alreadyActioned) continue;
      // Skip leads already sent a message today
      const alreadySentToday = pending.some(p =>
        String(p.conversationId) === String(threadId) &&
        p.sentAt &&
        new Date(p.sentAt).toDateString() === new Date().toDateString()
      );
      if (alreadySentToday) { skipped++; continue; }
      const conv = inbox.find(c => String(c.threadId || '') === threadId);
      const name = ((conv?.name || conv?.memberName || 'there').split(' ')[0]);
      const personalizedMessage = formatBlastTemplate(name, pb.dayLabel, pb.time, pb.addr, pb.host, pb.phone);
      // Queue verify-and-send relay command — extension will only send if thread matches expectedListingId
      await relayPost('/api/verify-and-send', {
        threadId,
        conversationUrl: 'https://flatmates.com.au/messages/' + threadId,
        expectedListingId: blastExpectedListingId,
        blastListingId: null,
        text: personalizedMessage,
      }).catch(e => logWarn(`relayPost verify-and-send failed for ${threadId}: ${e.message}`));
      queued++;
    }
    // Log blast in history
    admin.blasts = admin.blasts || [];
    admin.blasts.push({
      id: crypto.randomUUID(),
      houseCode: pb.houseCode,
      date: pb.date,
      time: pb.time,
      assistant: pb.host,
      address: pb.addr,
      queued,
      approvedAt: new Date().toISOString(),
    });
    admin.pendingBlast = null;
    saveAdminState(admin);
    const skippedNote = skipped > 0 ? ` (${skipped} already invited today — skipped)` : '';
    const listingNote = blastExpectedListingId ? ` (listing \`${blastExpectedListingId}\`) — extension will skip leads from other listings` : '';
    await sendTelegramMessage(chatId,
      `📣 Queued *${queued}* verify-and-send command${queued !== 1 ? 's' : ''} for *${pb.houseCode}*${listingNote}${skippedNote}`
    ).catch(() => {});
    return true;
  }

  // ── Cancel ────────────────────────────────────────────────────────────────
  if (normalised === 'skip' || normalised === '⏭' || normalised === '⏭️') {
    admin.pendingBlast = null;
    saveAdminState(admin);
    await sendTelegramMessage(chatId, '❌ Blast cancelled').catch(() => {});
    return true;
  }

  // ── Edit: regenerate template with AI and re-show preview ────────────────
  const editInstruction = text;
  const currentTemplate = pb.template || '';
  const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || '';
  let revised = '';
  const editPrompt = [
    'You are editing a blast inspection invite template for a rental property.',
    `Current template:\n${currentTemplate}`,
    `Edit instruction from owner: ${editInstruction}`,
    'Return ONLY the revised template text. Keep [Name] as a literal placeholder. Keep it warm, concise, and ready to send.',
  ].join('\n');

  if (GOOGLE_API_KEY) {
    try {
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GOOGLE_API_KEY}`;
      const resp = await fetch(geminiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: editPrompt }] }],
          generationConfig: { temperature: 0.4, maxOutputTokens: 300 },
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (resp.ok) {
        const data = await resp.json();
        revised = (data.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
      }
    } catch (e) {
      logWarn(`Blast template regenerate (Gemini) failed: ${e.message}`);
    }
  }
  if (!revised) {
    // Ollama fallback
    try {
      const resp = await fetch('http://127.0.0.1:11434/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'minimax-m2.5:cloud', prompt: editPrompt, stream: false }),
        signal: AbortSignal.timeout(20000),
      });
      if (resp.ok) {
        const data = await resp.json();
        revised = (data.response || '').trim();
      }
    } catch (e) {
      logWarn(`Blast template regenerate (Ollama) failed: ${e.message}`);
    }
  }
  if (!revised) revised = currentTemplate; // fallback: keep existing

  // Update stored template
  pb.template = revised;
  admin.pendingBlast = pb;
  saveAdminState(admin);

  // Re-show preview
  const targetCount = (pb.targetThreads || []).length;
  const filterDesc = pb.filter === 'days' ? `last ${pb.filterVal} days` : pb.filter === 'limit' ? `top ${pb.filterVal}` : 'all unread';
  const previewMsg = [
    `📋 *Blast preview — ${pb.houseCode} (${targetCount} unread, ${filterDesc})*`,
    '',
    revised,
    '',
    '---',
    `Reply ✅ or "approve" to queue for all ${targetCount} leads`,
    'Reply "skip" or ⏭ to cancel',
    'Reply anything else to edit the template, Jess will regenerate',
  ].join('\n');
  await sendTelegramMessage(chatId, previewMsg, { parse_mode: 'Markdown' }).catch(() => {});
  return true;
}

async function runJessAutoStep() {
  const admin = loadAdminState();
  if (!admin.autoMode?.enabled || jessPaused) return;
  const minsLeft = minutesUntilBrisbane8am();
  if (minsLeft <= 0) {
    admin.autoMode.enabled = false;
    admin.autoMode.stoppedAt = new Date().toISOString();
    saveAdminState(admin);
    await sendTelegramMessage(DIEGO_TG_CHAT_ID, '🌅 Jess auto mode stopped at 8am Brisbane.');
    return;
  }
  const inbox = await fetchInbox().catch(() => []);
  const eligible = inbox.filter(c => {
    const threadId = String(c.threadId || '');
    return threadId && !isThreadIgnored(threadId) && !isThreadSnoozed(threadId);
  });
  if (!eligible.length) return;
  const useRandomJump = admin.autoMode.processedTonight > 0 && admin.autoMode.processedTonight % 6 === 5;
  let chosen = null;
  if (useRandomJump) chosen = eligible[Math.floor(Math.random() * eligible.length)];
  else {
    const idx = admin.autoMode.cursor % eligible.length;
    chosen = eligible[idx];
    admin.autoMode.cursor = idx + 1;
  }
  if (!chosen?.threadId) return;
  try {
    await processConversation({ threadId: String(chosen.threadId) }, null);
    admin.autoMode.processedTonight = (admin.autoMode.processedTonight || 0) + 1;
    admin.autoMode.lastRunAt = new Date().toISOString();
    saveAdminState(admin);
  } catch (e) {
    logWarn(`[auto-mode] Failed thread ${chosen.threadId}: ${e.message}`);
  }
}

async function pauseJess(reason, affectedCount = 0) {
  if (jessPaused && jessLastError === reason) return;
  jessPaused = true;
  jessLastError = reason;
  jessLastErrorAt = new Date().toISOString();
  jessLastErrorAffectedCount = affectedCount;
  log(`[PAUSED] Jess is paused - waiting for /jess_restart`, 'WARN');
  const alertMessage = [
    `🚨 Jess stopped - ${reason}`,
    '',
    `Last poll: ${formatAdminTimestamp(lastPollAt)}`,
    `Enquirers affected: ${affectedCount}`,
    '',
    'Reply /jess_restart to resume',
    'Reply /jess_status for current state',
  ].join('\n');
  await sendToDiego(alertMessage);
}

// ─── Data file helpers ────────────────────────────────────────────────────────

function loadJSON(filePath, defaultVal = null) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) { logError(`loadJSON ${filePath}: ${e.message}`); }
  return defaultVal;
}

function saveJSON(filePath, data) {
  try { fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8'); }
  catch (e) { logError(`saveJSON ${filePath}: ${e.message}`); }
}

const loadRooms      = () => loadJSON(DATA.rooms,       []);
const loadEnquirers  = () => loadJSON(DATA.enquirers,   []);
const loadWaitlist   = () => loadJSON(DATA.waitlist,    {});
const loadFollowup   = () => loadJSON(DATA.followup,    []);
const loadInspections= () => loadJSON(DATA.inspections, []);
const loadPending    = () => loadJSON(DATA.pending,     []);

const saveRooms      = (d) => saveJSON(DATA.rooms,       d);
const saveEnquirers  = (d) => saveJSON(DATA.enquirers,   d);
const saveWaitlist   = (d) => saveJSON(DATA.waitlist,    d);
const saveFollowup   = (d) => saveJSON(DATA.followup,    d);
const saveInspections= (d) => saveJSON(DATA.inspections, d);

function loadPendingCampaignSendJob() {
  const job = loadJSON(DATA.pendingCampaignSendJob, null);
  return job && typeof job === 'object' ? job : null;
}

function savePendingCampaignSendJob(job) {
  saveJSON(DATA.pendingCampaignSendJob, job);
}

function clearPendingCampaignSendJob() {
  try {
    if (fs.existsSync(DATA.pendingCampaignSendJob)) fs.unlinkSync(DATA.pendingCampaignSendJob);
  } catch (e) {
    logError(`clearPendingCampaignSendJob ${DATA.pendingCampaignSendJob}: ${e.message}`);
  }
}

function loadTrainingProfile() {
  try {
    if (fs.existsSync(TRAINING_PROFILE_FILE)) {
      return JSON.parse(fs.readFileSync(TRAINING_PROFILE_FILE, 'utf8'));
    }
  } catch (_) {}
  return null;
}
/** Safe pending save - never overwrites server-set statuses (approved/skipped/sent) */
function savePending(incoming) {
  const PROTECTED = ['approved', 'skipped', 'sent'];
  try {
    const current = loadPending(); // fresh read from disk
    // Build a map of current statuses
    const statusMap = {};
    for (const e of current) if (e.id) statusMap[e.id] = e.status;
    // Merge: preserve protected statuses
    const merged = incoming.map(e => {
      const serverStatus = statusMap[e.id];
      if (serverStatus && PROTECTED.includes(serverStatus) && !PROTECTED.includes(e.status)) {
        return { ...e, status: serverStatus }; // keep server status
      }
      return e;
    });
    saveJSON(DATA.pending, merged);
  } catch(_) { saveJSON(DATA.pending, incoming); }
}

// ─── Relay helpers ────────────────────────────────────────────────────────────

function httpJsonRequest(url, method = 'GET', body = null, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const isHttps = u.protocol === 'https:';
    const lib = isHttps ? https : http;
    const payload = body ? JSON.stringify(body) : null;
    const req = lib.request({
      hostname: u.hostname,
      port: u.port || (isHttps ? 443 : 80),
      path: `${u.pathname}${u.search}`,
      method,
      family: 4, // force IPv4 - IPv6 not reliably available
      headers: payload ? {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      } : undefined,
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        let parsed = {};
        try { parsed = data ? JSON.parse(data) : {}; } catch (_) {}
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(parsed);
        else reject(new Error(`HTTP ${res.statusCode}: ${parsed.error || data || 'request failed'}`));
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error('Request timeout')));
    if (payload) req.write(payload);
    req.end();
  });
}

async function relayGet(pathname) {
  return httpJsonRequest(`${RELAY_URL}${pathname}`, 'GET');
}

async function relayPost(pathname, body = {}) {
  return httpJsonRequest(`${RELAY_URL}${pathname}`, 'POST', body);
}

async function alertUnhealthySession(reason) {
  const now = Date.now();
  if (now - sessionHealth.lastAlertAt < SESSION_ALERT_COOLDOWN_MS) return;
  sessionHealth.lastAlertAt = now;
  const msg =
    `⚠️ Jess Flatmates session unhealthy.\n` +
    `Reason: ${reason}\n` +
    `Jess is in safe mode and will not trust inbox/listing sync until session is healthy.`;
  await sendToDiego(msg);
}

async function markSessionUnhealthy(reason) {
  const wasHealthy = sessionHealth.healthy;
  sessionHealth.healthy = false;
  sessionHealth.reason = reason || 'unknown';
  if (wasHealthy) logWarn(`Flatmates session became unhealthy: ${sessionHealth.reason}`);
  await alertUnhealthySession(sessionHealth.reason);
}

function markSessionHealthy(note = 'ok') {
  const wasHealthy = sessionHealth.healthy;
  sessionHealth.healthy = true;
  sessionHealth.reason = note;
  sessionHealth.lastHealthyAt = Date.now();
  if (!wasHealthy) log('Flatmates session health restored');
}

let relayJamState = { level: 0, lastAlert: 0 };

async function checkRelayHealth() {
  const status = await relayGet('/api/status');
  const relayOk = status?.relay === 'running';
  const extensionConnected = !!status?.extensionConnected;

  // Anti-jam detection
  if (status && typeof status.pendingCommands === 'number') {
    const pending = status.pendingCommands;
    const now = Date.now();
    const tenMins = 10 * 60 * 1000;

    if (pending > 500) {
      if (relayJamState.level !== 3 || now - relayJamState.lastAlert > tenMins) {
        logWarn(`CRITICAL: Jess relay jammed with ${pending} pending commands`);
        sendToDiego(`🚨 *Jess Relay CRITICAL Jam*\n${pending} commands pending.\n\nRefresh Flatmates tab in Chrome to clear the jam.`);
        relayJamState = { level: 3, lastAlert: now };
      }
    } else if (pending > 200) {
      if (relayJamState.level !== 2 || now - relayJamState.lastAlert > tenMins) {
        logWarn(`Jess relay backlog warning: ${pending} pending commands`);
        sendToDiego(`⚠️ *Jess Relay ALERT Jam*\n${pending} commands pending in queue.`);
        relayJamState = { level: 2, lastAlert: now };
      }
    } else if (pending > 50) {
      if (relayJamState.level !== 1 || now - relayJamState.lastAlert > tenMins) {
        logWarn(`WARNING: Jess relay queue building up (${pending} commands)`);
        relayJamState = { level: 1, lastAlert: now };
      }
    } else if (pending < 20) {
      if (relayJamState.level >= 2) {
        log(`Relay queue cleared (now ${pending})`);
        sendToDiego(`✅ *Jess relay cleared* - queue back to normal (${pending} commands).`);
      }
      relayJamState = { level: 0, lastAlert: 0 };
    }
  }

  // Warn on stale data but never hard-block from here - caller handles streak logic
  if (status?.lastScrapeTime) {
    const staleMins = Math.round((Date.now() - new Date(status.lastScrapeTime).getTime()) / 60000);
    if (staleMins > 60) logWarn(`Relay scrape data is ${staleMins} min old - stale but allowing polls through`);
  }
  // Note: lastScrapeTime === null means relay just restarted - that is NOT unhealthy
  return {
    healthy: relayOk && extensionConnected,
    extensionConnected,
    status,
    reason: !relayOk ? 'relay-not-running'
      : !extensionConnected ? 'Chrome extension not connected'
      : 'ok',
  };
}

async function fetchInbox() {
  const data = await relayGet('/api/inbox');
  return Array.isArray(data?.conversations) ? data.conversations : [];
}

async function fetchThread(threadId) {
  const data = await relayGet(`/api/thread?id=${encodeURIComponent(threadId)}`);
  return data?.thread || null;
}

async function fetchThreads() {
  const data = await relayGet('/api/threads');
  return Array.isArray(data?.threads) ? data.threads : [];
}

async function sendReply(threadId, text) {
  return relayPost('/api/reply', { threadId, text });
}

async function requestNavigate(threadId) {
  return relayPost('/api/navigate', { threadId });
}

async function requestScrape({ forceRefresh = false, countMode = false } = {}) {
  return relayPost('/api/request-scrape', {
    ...(forceRefresh ? { forceRefresh: true } : {}),
    ...(countMode    ? { countMode:    true } : {}),
  });
}

async function registerRelayCallback(url) {
  await relayPost('/api/register-callback', { url });
}

function resolveListingIdForHouse(houseCode) {
  const house = String(houseCode || '').trim().toUpperCase();
  if (!house) return null;
  const rooms = loadRooms();
  const room = rooms.find(r => String(r.houseCode || '').toUpperCase() === house && (r.listingId || r.listing_url));
  if (!room) return null;
  if (room.listingId) return String(room.listingId).replace(/^P/i, '');
  const match = String(room.listing_url || '').match(/P(\d+)/i);
  return match ? match[1] : null;
}

async function requestListingAvailabilityToggle(houseCode, action) {
  const house = String(houseCode || '').trim().toUpperCase();
  const normalizedAction = String(action || '').trim().toLowerCase();
  if (!house) throw new Error('Missing house code');
  if (!['activate', 'deactivate'].includes(normalizedAction)) {
    throw new Error(`Invalid action: ${action}`);
  }
  const listingId = resolveListingIdForHouse(house);
  if (!listingId) {
    throw new Error(`Cannot find listing ID for house ${house}`);
  }
  return relayPost('/api/command', {
    type: 'deactivate-listing',
    houseCode: house,
    listingId,
    action: normalizedAction,
  });
}

function parseThreadIdFromConversationUrl(conversationUrl) {
  if (!conversationUrl) return null;
  const m = String(conversationUrl).match(/\/(?:messages|inbox)\/([^/?#]+)/i);
  return m ? m[1] : null;
}

async function verifyFlatmatesSession(_unused, { force = false } = {}) {
  const now = Date.now();
  if (!force && (now - lastSessionHealthCheckAt) < SESSION_HEALTH_TTL_MS) {
    return sessionHealth.healthy;
  }
  lastSessionHealthCheckAt = now;

  try {
    const health = await checkRelayHealth();
    if (!health.healthy) {
      // Only hard-block if extensionConnected has been false for 3+ consecutive checks
      if (health.extensionConnected === false && relayFailureStreak >= 2) {
        await markSessionUnhealthy(`Relay unhealthy: ${health.reason}`);
        return false;
      }
      // Otherwise warn but allow polls through (race condition / fresh relay start)
      logWarn(`Relay health warning (streak ${relayFailureStreak + 1}): ${health.reason} - allowing poll (hard-block after 3 consecutive failures)`);
      markSessionHealthy('relay-ok-warn');
      return true;
    }
    markSessionHealthy('relay-ok');
    return true;
  } catch (e) {
    await markSessionUnhealthy(`Relay health check error: ${e.message}`);
    return false;
  }
}

async function runCycleNow() {
  cycleRequested = true;
  if (cycleInFlight) return;
  cycleInFlight = true;
  try {
    while (cycleRequested) {
      cycleRequested = false;
      await globalCycleRunner();
    }
  } finally {
    cycleInFlight = false;
  }
}

function startRelayCallbackServer() {
  callbackServer = http.createServer(async (req, res) => {

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
    if (req.method !== 'POST' || req.url !== RELAY_CALLBACK_PATH) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
      try {
        const payload = JSON.parse(body || '{}');
        if (payload?.event === 'scrape' || payload?.event === 'command-result') {
          log(`Relay callback: ${payload.event}`);
          await runCycleNow();
        }
      } catch (_) {}
    });
  });

  callbackServer.on('error', (e) => {
    logWarn(`Relay callback server error: ${e.message}`);
  });

  callbackServer.listen(RELAY_CALLBACK_PORT, '127.0.0.1', () => {
    log(`Relay callback server listening at ${RELAY_CALLBACK_URL}`);
  });
}

// ─── Language detection ───────────────────────────────────────────────────────

/** Simple script/keyword-based language detector. Returns ISO 639-1 code. */
function detectLanguage(text) {
  if (!text || text.trim().length < 3) return 'EN';
  const t = text;

  // Script detection first (most reliable)
  if (/[\u4E00-\u9FFF\u3400-\u4DBF]/.test(t))  return 'ZH'; // Chinese
  if (/[\u3040-\u30FF\u31F0-\u31FF]/.test(t))  return 'JA'; // Japanese
  if (/[\uAC00-\uD7AF\u1100-\u11FF]/.test(t))  return 'KO'; // Korean
  if (/[\u0600-\u06FF]/.test(t))               return 'AR'; // Arabic
  if (/[\u0400-\u04FF]/.test(t))               return 'RU'; // Russian
  if (/[\u0900-\u097F]/.test(t))               return 'HI'; // Hindi

  const lower = t.toLowerCase();

  // French - high-confidence markers
  if (/\b(bonjour|salut|merci|bonsoir|je suis|j'ai|voudrais|cherche|loyer|chambre|disponible|s'il vous|qu'est-ce)\b/.test(lower)) return 'FR';

  // Portuguese - before Spanish (overlap is high)
  if (/\b(olá|ola|obrigado|obrigada|você|voce|estou|procuro|quero|quartos?|disponível|disponivel|aluguel|arrendar|habitação|sou)\b/.test(lower)) return 'PT';

  // Spanish
  if (/\b(hola|gracias|busco|busca|estoy|estamos|habitación|habitacion|disponible|soy|me llamo|precio|cuánto|cuanto|quiero)\b/.test(lower)) return 'ES';

  // German
  if (/\b(hallo|guten|danke|ich suche|zimmer|verfügbar|verfugbar|miete)\b/.test(lower)) return 'DE';

  return 'EN'; // default
}

/** Get reply language label for logging/templates */
function langLabel(code) {
  const map = { EN:'English', FR:'French', ES:'Spanish', PT:'Portuguese',
                ZH:'Chinese', JA:'Japanese', KO:'Korean', AR:'Arabic',
                RU:'Russian', HI:'Hindi', DE:'German' };
  return map[code] || code;
}

// ─── Profile utilities ────────────────────────────────────────────────────────

/**
 * Check if an enquirer profile has enough info to proceed.
 * Needs most of: cultural_background, hobbies, age, work_study.
 * If only one field is missing → proceed. If two+ missing → ask.
 */
function isProfileComplete(enq) {
  const fields = ['cultural_background', 'hobbies', 'age', 'work_study'];
  const missing = fields.filter(f => !enq[f] || String(enq[f]).trim() === '');
  return missing.length <= 1;
}

/** Calculate priority score for sorting (lower = higher priority) */
function priorityScore(enq) {
  if (enq.priority === 'low')  return 100;
  if (enq.priority === 'high') return 0;
  // gender first: female=1, male=3, unknown=2
  let score = enq.gender === 'female' ? 1 : enq.gender === 'male' ? 3 : 2;
  // cultural background bonus: Asian heritage → lower score (higher priority)
  const bg = (enq.cultural_background || '').toLowerCase();
  const asianKeywords = ['chinese','japanese','korean','thai','vietnamese','indonesian','malaysian','filipino','taiwanese','hong kong','singapore','asian'];
  if (asianKeywords.some(k => bg.includes(k))) score += 0;
  else score += 2;
  return score;
}

/** Find an enquirer by conversation ID, Flatmates profile URL, or name+phone */
function findEnquirer(enquirers, { conversationId, name, phone, profileUrl }) {
  // Primary: conversation ID
  if (conversationId) {
    const byConv = enquirers.find(e => e.conversation_id === conversationId);
    if (byConv) return byConv;
  }
  // Secondary: Flatmates profile URL (unique - same name can be different people)
  if (profileUrl) {
    const byProfile = enquirers.find(e => e.flatmates_url === profileUrl);
    if (byProfile) return byProfile;
  }
  // Tertiary: name + phone (fallback)
  if (name && phone) {
    const byMatch = enquirers.find(e =>
      e.name && e.name.toLowerCase() === name.toLowerCase() && e.phone === phone
    );
    if (byMatch) return byMatch;
  }
  return null;
}

/** Create a new enquirer profile with defaults */
function createEnquirer(data) {
  const today = new Date().toISOString().slice(0,10);
  return {
    id: crypto.randomUUID(),
    flatmates_url: data.flatmates_url || null,
    name: data.name || null,
    full_name: data.full_name || data.name || null,
    age: data.age || null,
    gender: data.gender || null,
    nationality: data.nationality || null,
    languages: data.languages || [],
    cultural_background: data.cultural_background || null,
    work_study: data.work_study || null,
    hobbies: data.hobbies || null,
    move_in_date: data.move_in_date || null,
    budget: data.budget || null,
    room_preference: data.room_preference || null,
    property_enquired: data.property_enquired || null,
    couple: data.couple || false,
    profile_complete: false,
    priority: 'normal',
    status: 'new',
    inspection_slot: null,
    notes: '',
    first_contact: today,
    last_message: today,
    photo_url: data.photo_url || null,
    conversation_id: data.conversation_id || null,
  };
}

// ─── Inspection helpers ───────────────────────────────────────────────────────

/** Get the inspection config for a given houseCode, if it exists */
function getInspectionForRoom(houseCode) {
  const inspections = loadInspections();
  return inspections.find(i => i.houseCode === houseCode && i.active !== false) || null;
}

/**
 * Find or allocate an inspection slot for an enquirer.
 * Rules: 3 people per 10-min slot; >6 fills 5-min gaps; >12 spreads further.
 * Returns { date, time, slotTime } or null if no inspection configured.
 */
function allocateInspectionSlot(houseCode, enquirerId) {
  const inspections = loadInspections();
  const insp = inspections.find(i => i.houseCode === houseCode && i.active !== false);
  if (!insp) return null;

  const MAX_PER_SLOT = insp.max_per_slot || 3;
  const SLOT_MINS = Number(insp.slot_interval_minutes || insp.intervalMins || 10);
  const BLOCK_MINS = Number(insp.block_length_minutes || insp.blockLengthMins || SLOT_MINS);

  // Find a slot with space
  for (const slot of (insp.slots || [])) {
    if ((slot.enquirer_ids || []).length < MAX_PER_SLOT) {
      slot.enquirer_ids.push(enquirerId);
      saveInspections(inspections);
      return { date: insp.date, time: insp.time, slotTime: slot.time };
    }
  }

  // Create new slot
  const lastSlot = insp.slots && insp.slots.length > 0
    ? insp.slots[insp.slots.length - 1]
    : null;

  let newSlotTime = insp.time; // default to inspection start
  if (lastSlot) {
    const [h, m] = lastSlot.time.split(':').map(Number);
    const newMins = h * 60 + m + SLOT_MINS;
    newSlotTime = `${String(Math.floor(newMins / 60)).padStart(2,'0')}:${String(newMins % 60).padStart(2,'0')}`;
  }

  const [startHour, startMinute] = insp.time.split(':').map(Number);
  const startMins = startHour * 60 + startMinute;
  const [slotHour, slotMinute] = newSlotTime.split(':').map(Number);
  const slotMins = slotHour * 60 + slotMinute;
  if ((slotMins - startMins) >= BLOCK_MINS) return null;

  if (!insp.slots) insp.slots = [];
  insp.slots.push({ time: newSlotTime, enquirer_ids: [enquirerId] });
  saveInspections(inspections);

  return { date: insp.date, time: insp.time, slotTime: newSlotTime };
}

/** Format a date string (YYYY-MM-DD) to a human day like "Tuesday (10/03)" */
function formatDay(dateStr) {
  const d = new Date(dateStr + 'T00:00:00+10:00');
  const day  = d.toLocaleDateString('en-AU', { weekday: 'long', timeZone: BRISBANE_TZ });
  const date = d.toLocaleDateString('en-AU', { day:'2-digit', month:'2-digit', timeZone: BRISBANE_TZ });
  return `${day} (${date})`;
}

/** Format 24h time "18:00" → "6pm" */
function formatTime(time24) {
  const [h, m] = time24.split(':').map(Number);
  const ampm = h >= 12 ? 'pm' : 'am';
  const hour  = h > 12 ? h - 12 : (h === 0 ? 12 : h);
  return m === 0 ? `${hour}${ampm}` : `${hour}:${String(m).padStart(2,'0')}${ampm}`;
}

/** Days from now to a date string (positive = future) */
function daysFromNow(dateStr) {
  if (!dateStr) return 0;
  const target = new Date(dateStr + 'T00:00:00+10:00');
  const now    = new Date();
  return Math.round((target - now) / (1000 * 60 * 60 * 24));
}

// ─── Reply templates ──────────────────────────────────────────────────────────

/**
 * All template functions return a string.
 * They follow Diego's real style from diego-templates.txt:
 *  - First name always
 *  - Warm, concise, no fluff
 *  - Action-oriented
 */

/** Ask for profile info */
/** Profile complete - notify that we'll book a viewing soon */
function tplViewingPending(name, lang) {
  const templates = {
    EN: `Hi ${name}! Thanks so much for sharing that with us 😊 We'll book a house viewing very soon and keep you informed. Stay tuned!`,
    FR: `Bonjour ${name} ! Merci beaucoup d'avoir partagé ces informations 😊 Nous allons organiser une visite très prochainement et vous tiendrons informé(e). Restez à l'écoute !`,
    ES: `¡Hola ${name}! Muchas gracias por compartir esa información con nosotros 😊 Reservaremos una visita a la casa muy pronto y te mantendremos informado/a. ¡Estén atentos!`,
    PT: `Olá ${name}! Muito obrigado por compartilhar isso conosco 😊 Vamos marcar uma visita à casa em breve e manteremos você informado(a). Fique ligado!`,
  };
  return templates[lang] || templates.EN;
}

/** Answer a specific question with Diego-provided info + invite to viewing */
function tplAnswerQuestion(name, answer, lang) {
  const templates = {
    EN: `Hi ${name}! Great question 😊 ${answer}\n\nWe'd love for you to come see it in person - as soon as you have a date in mind, we'll get you booked in for a viewing!`,
    FR: `Bonjour ${name} ! Bonne question 😊 ${answer}\n\nNous serions ravis que vous veniez voir le logement en personne - dès que vous avez une date, nous vous programmerons une visite !`,
    ES: `¡Hola ${name}! Buena pregunta 😊 ${answer}\n\n¡Nos encantaría que vinieras a verlo en persona - en cuanto tengas una fecha, te agendamos la visita!`,
    PT: `Olá ${name}! Boa pergunta 😊 ${answer}\n\nAmaríamos que você viesse ver pessoalmente - assim que tiver uma data em mente, já agendamos a visita!`,
  };
  return templates[lang] || templates.EN;
}

function tplAskProfile(name, lang) {
  const templates = {
    EN: `Hi ${name} 😊 Thanks for reaching out. Can you please tell me a bit about yourself? Include your cultural background, hobbies, age, and work or academic life if any. Thanks!`,
    FR: `Bonjour ${name} 😊 Merci de nous contacter. Pourriez-vous me parler un peu de vous ? Votre origine culturelle, vos loisirs, votre âge, et votre vie professionnelle ou académique. Merci !`,
    ES: `Hola ${name} 😊 Gracias por contactarnos. ¿Puedes contarme un poco sobre ti? Tu origen cultural, hobbies, edad y vida laboral o académica. ¡Gracias!`,
    PT: `Olá ${name} 😊 Obrigado pelo contato. Pode me contar um pouco sobre você? Origem cultural, hobbies, idade e vida profissional ou acadêmica. Obrigado!`,
  };
  return templates[lang] || templates.EN;
}

/** Ask which room + entry date (for vague messages) */
function tplAskRoomAndDate(name, lang) {
  const templates = {
    EN: `Hi ${name}, thanks for reaching out! Which room are you interested in, and what entry date are you looking for?`,
    FR: `Bonjour ${name}, merci de nous contacter ! Quelle chambre vous intéresse et quelle date d'entrée souhaitez-vous ?`,
    ES: `Hola ${name}, ¡gracias por contactarnos! ¿Qué habitación te interesa y para qué fecha buscas entrar?`,
    PT: `Olá ${name}, obrigado pelo contato! Qual quarto te interessa e qual data de entrada você busca?`,
  };
  return templates[lang] || templates.EN;
}

/** Room available - invite to inspection */
function tplInviteInspection(name, houseCode, room, slotInfo, lang) {
  const asst    = ASSISTANTS[room.assistant] || ASSISTANTS.dee;
  const address = room.listing_address; // Never the real address until confirmed
  const dayStr  = slotInfo ? formatDay(slotInfo.date) : null;
  const timeStr = slotInfo ? formatTime(slotInfo.slotTime) : null;
  const sp9Note = houseCode === 'SP9'
    ? '\nJust beside Mini Market (Watson Esplanade), that\'s the entry of the house.'
    : '';

  const inviteLineEN = dayStr && timeStr
    ? `We'd love to invite you to an inspection on ${dayStr} at ${timeStr}.`
    : `We'd love to invite you to an inspection.`;
  const inviteLineFR = dayStr && timeStr
    ? `Nous serions ravis de vous inviter à une visite ${dayStr} à ${timeStr}.`
    : `Nous serions ravis de vous inviter à une visite.`;
  const inviteLineES = dayStr && timeStr
    ? `Nos encantaría invitarte a una inspección ${dayStr} a las ${timeStr}.`
    : `Nos encantaría invitarte a una inspección.`;
  const inviteLinePT = dayStr && timeStr
    ? `Gostaríamos de convidar você para uma visita ${dayStr} às ${timeStr}.`
    : `Gostaríamos de convidar você para uma visita.`;

  const body_EN = `Hi! We're doing inspections ${slotInfo && slotInfo.date ? slotInfo.date : 'soon'} at ${timeStr || 'a time to be confirmed'}.
Would you like to come?

📍 ${address}
${asst.name} will be there to assist you.
Message when you arrive: ${asst.phone}`;

  const body_FR = `Bonjour ${name} 😊

Merci pour votre message au sujet de la chambre. ${inviteLineFR}

Merci d'envoyer un message à ${asst.name} sur WhatsApp pour confirmer si cet horaire vous convient, ou pour convenir d'un autre horaire :
${asst.phone}

À bientôt 🏠`;

  const body_ES = `Hola ${name} 😊

Gracias por tu mensaje sobre la habitación. ${inviteLineES}

Por favor envía un mensaje a ${asst.name} por WhatsApp para confirmar si ese horario te viene bien, o para organizar otro horario que te convenga:
${asst.phone}

Nos vemos pronto 🏠`;

  const body_PT = `Olá ${name} 😊

Obrigado pela sua mensagem sobre o quarto. ${inviteLinePT}

Por favor, mande uma mensagem para ${asst.name} no WhatsApp para confirmar se esse horário funciona para você, ou para combinar outro horário melhor:
${asst.phone}

Até breve 🏠`;

  const templates = { EN: body_EN, FR: body_FR, ES: body_ES, PT: body_PT };
  return templates[lang] || templates.EN;
}

/** Room not available - warm hold + alternatives */
function tplRoomNotAvailable(name, availableRooms, lang) {
  const links = availableRooms.slice(0, 4)
    .map(r => `${r.listing_url}`)
    .join('\n\n');

  const templates = {
    EN: `Hi ${name}, thanks for the interest! That room has just been filled, but I've added you to the waitlist and will let you know the moment something opens up.\n\nIn the meantime, here are other rooms that might suit you:\n\n${links || 'Check our other listings in the bio.'}`,
    FR: `Bonjour ${name}, merci de votre intérêt ! Cette chambre vient d'être louée, mais je vous ai ajouté à la liste d'attente et vous contacterai dès qu'une place se libère.\n\nEn attendant, voici d'autres chambres qui pourraient vous convenir :\n\n${links || 'Consultez nos autres annonces dans la bio.'}`,
    ES: `Hola ${name}, ¡gracias por tu interés! Esa habitación acaba de ocuparse, pero te he añadido a la lista de espera y te avisaré en cuanto haya algo disponible.\n\nMientras tanto, aquí tienes otras habitaciones:\n\n${links || 'Consulta nuestros otros anuncios en la bio.'}`,
    PT: `Olá ${name}, obrigado pelo interesse! Esse quarto acaba de ser alugado, mas te adicionei à lista de espera e vou te avisar assim que abrir algo.\n\nEnquanto isso, aqui estão outros quartos disponíveis:\n\n${links || 'Veja nossos outros anúncios na bio.'}`,
  };
  return templates[lang] || templates.EN;
}

/** Future move-in - park nicely */
function tplFutureMoveIn(name, moveDate, lang) {
  const dayStr = formatDay(moveDate);
  const templates = {
    EN: `Hi ${name}, thanks for reaching out! These rooms are ready to go now. If you're looking to move in around ${dayStr}, drop me a message about a week before and I'll let you know what's available at that time 😊`,
    FR: `Bonjour ${name}, merci de nous contacter ! Ces chambres sont disponibles maintenant. Si vous souhaitez emménager autour du ${dayStr}, contactez-moi environ une semaine avant et je vous dirai ce qui est disponible à ce moment-là 😊`,
    ES: `Hola ${name}, ¡gracias por contactarnos! Estas habitaciones están disponibles ahora. Si quieres mudarte alrededor del ${dayStr}, mándame un mensaje una semana antes y te digo qué hay disponible 😊`,
    PT: `Olá ${name}, obrigado pelo contato! Esses quartos estão disponíveis agora. Se você quer se mudar por volta de ${dayStr}, me mande uma mensagem uma semana antes e te digo o que está disponível 😊`,
  };
  return templates[lang] || templates.EN;
}

/** Redirect couples to couple-friendly listings */
function tplCoupleRedirect(name, coupleRooms, lang) {
  const links = coupleRooms.slice(0, 4)
    .map(r => `${r.listing_url}`)
    .join('\n\n');

  const templates = {
    EN: `Hi ${name}, thanks for reaching out! Unfortunately that specific room is for singles only. But I have other rooms that are much better and welcome couples - have a look:\n\n${links}`,
    FR: `Bonjour ${name}, merci de nous contacter ! Malheureusement cette chambre est pour célibataires uniquement. Mais j'ai d'autres chambres bien meilleures qui acceptent les couples :\n\n${links}`,
    ES: `Hola ${name}, ¡gracias por contactarnos! Desafortunadamente esa habitación es solo para personas solas. Pero tengo otras habitaciones mucho mejores para parejas :\n\n${links}`,
    PT: `Olá ${name}, obrigado pelo contato! Infelizmente esse quarto é apenas para solteiros. Mas tenho outros quartos muito melhores que aceitam casais :\n\n${links}`,
  };
  return templates[lang] || templates.EN;
}

/** Bond & licence explanation */
function tplBondInfo(name, weeklyPrice, lang) {
  const bond = (weeklyPrice * 2.5).toFixed(0);
  const templates = {
    EN: `Hi ${name} - the bond is ${bond} (2.5 weeks rent). There's no formal lease - we use a Licence of Occupancy, similar to Airbnb. Minimum stay is 4 months. Let me know if you have any other questions!`,
    FR: `Bonjour ${name} - la caution est de ${bond} (2,5 semaines de loyer). Il n'y a pas de bail formel - nous utilisons un Contrat d'Occupation, similaire à Airbnb. Durée minimale : 4 mois.`,
    ES: `Hola ${name} - la fianza es de ${bond} (2,5 semanas de alquiler). No hay contrato formal - usamos una Licencia de Ocupación, similar a Airbnb. Estadía mínima: 4 meses.`,
    PT: `Olá ${name} - a caução é de ${bond} (2,5 semanas de aluguel). Não há contrato formal - usamos uma Licença de Ocupação, similar ao Airbnb. Estadia mínima: 4 meses.`,
  };
  return templates[lang] || templates.EN;
}

/** Minimum stay explanation */
function tplMinStay(name, isCouple, lang) {
  const exception = isCouple
    ? ' For couples or females, there may be flexibility - we can help find a replacement with approval from the manager.'
    : '';
  const templates = {
    EN: `Hi ${name}, all our rooms have a minimum stay of 4 months.${exception} If you need to leave earlier, you can find someone to take over - same gender and similar age, approved by the house manager 😊`,
    FR: `Bonjour ${name}, toutes nos chambres ont une durée minimale de 4 mois.${exception}`,
    ES: `Hola ${name}, todas nuestras habitaciones tienen una estadía mínima de 4 meses.${exception}`,
    PT: `Olá ${name}, todos os nossos quartos têm estadia mínima de 4 meses.${exception}`,
  };
  return templates[lang] || templates.EN;
}

/** Standard decline message (DO NOT translate - consistent) */
const DECLINE_MSG = `Thanks for the interest in the house. At this stage, we are full with requests but we'll let you know if the room is vacant still. Good luck on your search.`;

/** No-show prevention - day-before confirmation */
function tplConfirmInspection(name, address, dayStr, timeStr, lang) {
  const templates = {
    EN: `Hi ${name}, just confirming your inspection tomorrow (${dayStr}) at ${timeStr}. Please confirm you're still coming 😊`,
    FR: `Bonjour ${name}, je confirme votre visite demain (${dayStr}) à ${timeStr}. Pouvez-vous confirmer votre venue ?`,
    ES: `Hola ${name}, confirmando tu visita mañana (${dayStr}) a las ${timeStr}. ¿Confirmas que vas a venir?`,
    PT: `Olá ${name}, confirmando sua visita amanhã (${dayStr}) às ${timeStr}. Confirma que vai aparecer?`,
  };
  return templates[lang] || templates.EN;
}

/** No-show prevention - 2h before address reminder */
function tplAddressReminder(name, address, timeStr, lang) {
  const templates = {
    EN: `Hi ${name}, your inspection is in 2 hours at ${timeStr}! Here's the address:\n${address}`,
    FR: `Bonjour ${name}, votre visite est dans 2 heures à ${timeStr} ! Voici l'adresse :\n${address}`,
    ES: `Hola ${name}, ¡tu visita es en 2 horas a las ${timeStr}! Aquí está la dirección:\n${address}`,
    PT: `Olá ${name}, sua visita é em 2 horas às ${timeStr}! Aqui está o endereço:\n${address}`,
  };
  return templates[lang] || templates.EN;
}

/** Humour deflect: "how do you speak X" */
function tplHumourDeflect(lang) {
  const punchlines = {
    EN: `I'm very smart 😄 Now, how can I help you with the room?`,
    FR: `Je suis très intelligent 😄 Maintenant, puis-je vous aider avec la chambre ?`,
    ES: `Soy muy inteligente 😄 Ahora, ¿en qué te puedo ayudar con la habitación?`,
    PT: `Sou muito inteligente 😄 Agora, como posso te ajudar com o quarto?`,
  };
  return punchlines[lang] || punchlines.EN;
}

// ─── Telegram / WA bridge ─────────────────────────────────────────────────────

/**
 * Send a message to Diego via the local WhatsApp/Telegram bridge.
 * POST http://127.0.0.1:8890/send { to: CHAT_ID, message }
 */
/** Send a WhatsApp message to any WA ID via the bridge */
function sendWaMessage(waId, text) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ to: waId, message: text });
    const opts = {
      hostname: '127.0.0.1', port: 8890,
      path: '/send', method: 'POST', family: 4,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    };
    const req = http.request(opts, (res) => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { log(`WA send to ${waId}: ${res.statusCode}`); resolve(res.statusCode === 200); });
    });
    req.on('error', e => { logWarn(`WA send error: ${e.message}`); resolve(false); });
    req.setTimeout(8000, () => { req.destroy(new Error('Telegram send timeout')); });
    req.write(body); req.end();
  });
}

/** Send a Telegram message to any chat ID */
function sendTelegramMessage(chatId, text, extra = {}) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ chat_id: chatId, text, ...extra });
    const opts = {
      hostname: 'api.telegram.org', port: 443,
      path: `/bot${JESS_TG_TOKEN}/sendMessage`, method: 'POST', family: 4,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    };
    const req = https.request(opts, (res) => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', async () => {
        if (res.statusCode === 401) {
          await pauseJess('Telegram token rejected (401)', 0);
        }
        if (res.statusCode === 200) resolve(true);
        else reject(new Error(`Telegram send failed (${res.statusCode}): ${d.slice(0, 200)}`));
      });
    });
    req.on('error', e => { logWarn(`TG send error: ${e.message}`); reject(e); });
    req.setTimeout(8000, () => { req.destroy(new Error('Telegram send timeout')); });
    req.write(body); req.end();
  });
}

// ─── Telegram chunked send (avoids 4096-char limit silently swallowing messages) ───
async function sendTelegramChunked(chatId, text, extra = {}) {
  const MAX = 4000; // leave some margin below 4096
  if (Buffer.byteLength(text, 'utf8') <= MAX) {
    return sendTelegramMessage(chatId, text, extra);
  }
  // Split on newline boundaries
  const lines = text.split('\n');
  const chunks = [];
  let current = '';
  for (const line of lines) {
    const candidate = current ? current + '\n' + line : line;
    if (Buffer.byteLength(candidate, 'utf8') > MAX) {
      if (current) chunks.push(current);
      current = line;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  for (let i = 0; i < chunks.length; i++) {
    await sendTelegramMessage(chatId, chunks[i], extra).catch(e => {
      log(`[sendTelegramChunked] chunk ${i+1}/${chunks.length} failed: ${e.message}`, 'WARN');
    });
    if (i < chunks.length - 1) await new Promise(r => setTimeout(r, 300));
  }
}

// ─── Atlas Status Check ───────────────────────────────────────────────────────
let _atlasLastCheck = 0;
let _atlasStatus = 'unknown'; // 'ok' | 'degraded' | 'offline'
let _atlasCoolOffUntil = 0;
let _atlasOfflineCount = 0;

async function checkAtlasStatus() {
  if (Date.now() - _atlasLastCheck < 5 * 60 * 1000) return _atlasStatus; // cache 5 min
  try {
    const resp = await fetch('http://127.0.0.1:8899/health', { signal: AbortSignal.timeout(4000) });
    const data = await resp.json();
    _atlasStatus = (resp.ok && data.status !== 'offline') ? 'ok' : 'degraded';
    if (_atlasStatus === 'ok') {
      _atlasCoolOffUntil = 0;
      _atlasOfflineCount = 0;
    }
  } catch (e) {
    _atlasStatus = 'offline';
    _atlasOfflineCount += 1;
    logWarn(`Atlas status check failed: ${e.message}`);
  }
  _atlasLastCheck = Date.now();
  log(`Atlas status: ${_atlasStatus}`);
  return _atlasStatus;
}

function atlasInCoolOff() {
  return Date.now() < _atlasCoolOffUntil;
}

function setAtlasCoolOff(ms = 2 * 60 * 1000) {
  _atlasCoolOffUntil = Date.now() + ms;
  logWarn(`Atlas cool-off set for ${Math.round(ms/60000)} min`);
}

function sendToDiego(message) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      chat_id: DIEGO_TG_CHAT_ID,
      text: message
    });
    const opts = {
      hostname: 'api.telegram.org',
      port: 443,
      path: `/bot${JESS_TG_TOKEN}/sendMessage`,
      method: 'POST',
      family: 4,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { log(`Telegram response: ${res.statusCode} ${res.statusCode !== 200 ? data.substring(0,120) : ''}`); resolve(res.statusCode === 200); });
    });
    req.on('error', (e) => { logWarn(`Telegram error: ${e.message}`); resolve(false); });
    req.setTimeout(8000, () => { req.destroy(new Error('Telegram send timeout')); });
    req.write(body);
    req.end();
  });
}

/**
 * Queue a reply for Diego's approval.
 * Saves to jess-pending.json and pings Diego via WA bridge.
 */
async function queueForApproval({ conversationId, conversationUrl, enquirerId, draft, houseCode, enquirerName, action, enquirerMessage }) {
  // Check Atlas / MC status before queuing - cool off if offline
  if (atlasInCoolOff()) {
    logWarn(`Atlas cool-off active - skipping queue for ${enquirerName}`);
    return null;
  }
  const atlasStatus = await checkAtlasStatus();
  if (atlasStatus === 'offline') {
    if (_atlasOfflineCount >= 2) {
      setAtlasCoolOff(2 * 60 * 1000); // 2 min cool-off after consecutive offline checks
      logWarn(`Atlas offline twice consecutively - 2 min cool-off started, skipping ${enquirerName}`);
      return null;
    }
    logWarn(`Atlas offline once - ignoring transient blip for ${enquirerName}`);
  }
  if (atlasStatus === 'degraded') {
    logWarn(`Atlas degraded - queuing ${enquirerName} but expect slow approvals`);
  }

  const pending = loadPending();
  // Skip if already actioned (pending, approved, sent, or skipped)
  const SKIP_STATUSES = ['pending', 'approved', 'sent', 'skipped'];
  if (conversationId && pending.some(p => p.conversationId == conversationId && SKIP_STATUSES.includes(p.status))) {
    return null;
  }
  const id = crypto.randomUUID();
  const entry = {
    id,
    conversationId,
    conversationUrl,
    enquirerId,
    enquirerName,
    houseCode,
    action,
    draft,
    originalDraft: draft,
    enquirerMessage: enquirerMessage || null,
    status: 'pending',   // pending | approved | edited | skipped
    createdAt: new Date().toISOString(),
    respondedAt: null,
    finalMessage: null,
  };
  pending.push(entry);
  savePending(pending);

  // Notify Diego of new draft
  const preview = (draft || '').slice(0, 120);
  await sendTelegramMessage(DIEGO_TG_CHAT_ID,
    `📝 *New draft — ${escapeMarkdown(enquirerName || 'Unknown')} (${houseCode || '?'})*\n\n${escapeMarkdown(preview)}${(draft || '').length > 120 ? '…' : ''}\n\nReply *approve* ✅ or *skip* ⏭ or edit instructions.`,
    { parse_mode: 'MarkdownV2' }
  ).catch(() => {});

  log(`Queued pending approval ${id} for ${enquirerName} (${houseCode})`);
  return id;
}

/**
 * Process any pending replies that have been auto-approved (time-based)
 * or that Diego has manually approved via file edit.
 * Returns list of approved entries ready to send.
 */
function processPendingApprovals() {
  const pending = loadPending();
  const now = Date.now();
  const toSend = [];

  pending.forEach(entry => {
    if (entry.status !== 'pending') return;
    const age = now - new Date(entry.createdAt).getTime();
    if (age > AUTO_APPROVE_AFTER_MS) {
      // Auto-approve after timeout
      entry.status = 'approved';
      entry.finalMessage = entry.draft;
      entry.respondedAt = new Date().toISOString();
      entry.autoApproved = true;
      toSend.push(entry);
      log(`Auto-approved pending ${entry.id} (${entry.enquirerName}) after timeout`);
    }
  });

  savePending(pending);
  return toSend;
}

// ─── Flatmates scraper ────────────────────────────────────────────────────────

/** Read inbox conversations from relay and keep recent active items. */
async function getConversationLinks(_unused, maxConvos = 80) {
  const conversations = await fetchInbox();
  const filterState = loadFilter();
  const { period, houses } = filterState;

  // Period → cutoff ms
  const periodMs = { last_24h: 1, last_3_days: 3, last_7_days: 7 }[period];
  const cutoff = periodMs
    ? Date.now() - (periodMs * 24 * 60 * 60 * 1000)
    : 0; // 'all' = include everything

  const links = [];
  let skippedHouse = 0, skippedPeriod = 0;

  for (const c of conversations) {
    // House filter
    if (!houses.includes('all') && houses.length > 0) {
      const hc = (c.houseCode || c.propertyCode || '').toUpperCase();
      const matched = houses.some(h => hc === h.toUpperCase() || hc.includes(h.toUpperCase()));
      if (!matched) { skippedHouse++; continue; }
    }

    // Period filter (use lastActive text → approximate date, fallback to include if unread)
    if (cutoff > 0 && !c.unread) {
      const parsed = parseLastActive(c.lastActive || '');
      if (parsed && parsed.getTime() < cutoff) { skippedPeriod++; continue; }
    }

    links.push(`relay://thread/${c.threadId}`);
    if (links.length >= maxConvos) break;
  }

  const filterDesc = `${period} · houses:${houses.join(',')}`;
  log(`Relay inbox: ${conversations.length} total - ${links.length} selected [${filterDesc}] (skipped: ${skippedHouse} house, ${skippedPeriod} period)`);
  return links;
}

/** Relay mode has no profile scraper access. */
async function scrapeProfile(_unused, _profileUrl) {
  return {};
}

/** Detect if enquiry is from a couple based on message text (standalone helper) */
function detectCoupleFromMessages(messages) {
  const text = (messages||[]).filter(m => !m.isOwn && !m.isSystem).map(m => m.text||'').join(' ').toLowerCase();
  const coupleWords = ['we are', "we're", 'both of us', 'my partner', 'my boyfriend', 'my girlfriend',
    'my husband', 'my wife', 'the two of us', 'together', 'we would', 'we will', 'we want',
    'us two', 'couple', 'somos', 'nosotros', 'nous sommes', 'mon copain', 'ma copine',
    'mon partenaire', 'nós somos', 'meu namorado', 'minha namorada', 'meu parceiro'];
  return coupleWords.some(w => text.includes(w));
}

/** Fetch a single conversation thread from relay and map to v2 shape.
 *  First tries cached thread data. If not available, uses inbox preview.
 *  Does NOT navigate the browser - that would spam the user's session. */
async function scrapeConversation(_unused, url) {
  const threadId = url.replace('relay://thread/', '');

  // Try cached thread data first (no navigation)
  const thread = await fetchThread(threadId).catch(() => null);
  if (thread && thread.messages && thread.messages.length > 0) {
    const messages = thread.messages.map((m) => ({
      isOwn: !!m.isMine,
      isFromEnquirer: !m.isMine,
      isSystem: false,
      text: m.text || '',
      time: m.timestamp || null,
    })).filter(m => m.text);
    return {
      memberName: thread.personName || null,
      profileUrl: null, phone: null, photoUrl: null,
      listing: null, listingUrl: thread.listingUrl || null, features: {},
      genderAge: null, description: null, tags: [],
      messages, listingRemoved: false,
      convId: thread.threadId || threadId,
      listingId: thread.listingId || null,
    };
  }

  // Fallback: use inbox preview data (no navigation needed)
  const conversations = await fetchInbox().catch(() => []);
  const conv = conversations.find(c => String(c.threadId) === String(threadId));
  const convText = conv && (conv.snippet || conv.preview || conv.lastMessagePreview || null);
  if (conv && convText) {
    return {
      memberName: conv.name || conv.memberName || null,
      profileUrl: null, phone: null, photoUrl: null,
      listing: null, listingUrl: conv.listingUrl || conv.href || null, features: {},
      genderAge: null, description: null, tags: [],
      messages: [{
        isOwn: false,
        isFromEnquirer: true,
        isSystem: false,
        text: convText,
        time: conv.lastActive || null,
      }],
      listingRemoved: false,
      convId: threadId,
      fromSnippet: true,
    };
  }

  return { convId: threadId, messages: [] };
}

/** Send a message via relay queue.
 *  Navigate first (extension needs to be on the thread to type a reply),
 *  then queue the reply text. */
async function sendReplyToConversation(convUrl, message) {
  try {
    const threadId = parseThreadIdFromConversationUrl(convUrl) || convUrl.replace('relay://thread/', '');
    if (!threadId) {
      logError(`Cannot resolve thread id from ${convUrl}`);
      return false;
    }
    // Use atomic navigate-and-reply command to avoid poll-batch race condition
    await relayPost('/api/navigate-and-reply', { threadId, text: message }).catch(() => {});
    log(`navigate-and-reply queued for ${convUrl}: "${message.slice(0,60)}..."`);
    return true;
  } catch (e) {
    logError(`relay sendReply error for ${convUrl}: ${e.message}`);
    return false;
  }
}

// ─── Decision engine ──────────────────────────────────────────────────────────

/**
 * Identify which property code a conversation is about.
 * Uses listing URL, listing text, or message content.
 */
function identifyHouseCode(convo) {
  const rooms = loadRooms();

  // ── 0. Match by listingId field (most reliable — direct from DOM) ───────────
  if (convo.listingId) {
    const lid = String(convo.listingId).replace(/^P/i, '');
    // Check r.listingId first, then fall back to P-number in r.listing_url
    const byListingId = rooms.find(r =>
      (r.listingId && String(r.listingId) === lid) ||
      (r.listing_url && r.listing_url.includes(`-P${lid}`))
    );
    if (byListingId) { convo._matchedRoom = byListingId; return byListingId.houseCode; }
  }

  // ── 1. Match by listing URL P-number (most reliable) ───────────────────────
  const listingHrefs = [
    convo.listing?.href,
    convo.listing?.url,
    convo.listingUrl,
    // Also scan all message links for a Flatmates listing URL
    ...(convo.messages || []).map(m => m.text || '').join(' ').match(/flatmates\.com\.au\/[^\s"')]+/g) || [],
  ].filter(Boolean);

  for (const href of listingHrefs) {
    // Match by full path
    const pathMatch = rooms.find(r => {
      const rPath = r.listing_url ? r.listing_url.split('flatmates.com.au')[1] : null;
      return rPath && href.includes(rPath);
    });
    if (pathMatch) { convo._matchedRoom = pathMatch; return pathMatch.houseCode; }

    // Match by P-number (most reliable - unique per listing)
    const pidMatch = href.match(/P(\d{5,})/);
    if (pidMatch) {
      const pid = pidMatch[0];
      const byPid = rooms.find(r => r.listing_url.includes(pid));
      if (byPid) { convo._matchedRoom = byPid; return byPid.houseCode; }
    }
  }

  // ── 2. Match by house code mentioned in messages ────────────────────────────
  const allText = (convo.messages || []).map(m => m.text || '').join(' ');
  for (const r of rooms) {
    // Exact house code match (case-insensitive word boundary)
    const codeRegex = new RegExp(`\\b${r.houseCode}\\b`, 'i');
    if (codeRegex.test(allText)) { convo._matchedRoom = r; return r.houseCode; }
  }

  // ── 3. Match by street address (avoid generic suburb names) ─────────────────
  for (const r of rooms) {
    const addr = r.listing_address || '';
    // Only match on specific street addresses, not generic suburb descriptions
    const streetMatch = addr.match(/\d+\s+\w+\s+(St|Street|Ave|Avenue|Rd|Road|Dr|Drive|Esplanade|Blvd)/i);
    if (streetMatch && allText.toLowerCase().includes(streetMatch[0].toLowerCase())) {
      convo._matchedRoom = r;
      return r.houseCode;
    }
  }

  return null;
}

async function scrapeListingRooms(url) {
  logWarn(`Listing scrape disabled in relay mode for ${url}`);
  return [];
}

let lastListingRefresh = 0;
let listingRefreshInFlight = false;
async function refreshListingPrices(force = false) {
  // Relay mode does not scrape listing pages directly.
  // Keep timestamps and existing room configs untouched.
  if (!force && Date.now() - lastListingRefresh < LISTING_REFRESH_INTERVAL_MS) return;
  if (listingRefreshInFlight) return;
  listingRefreshInFlight = true;
  lastListingRefresh = Date.now();
  listingRefreshInFlight = false;
}

/**
 * Detect if the enquiry is from a couple.
 * Checks features["Lifestyle"], description, and message text.
 */
function detectCouple(convo, enq) {

  if (enq.couple) return true;

  const text = [
    convo.description || '',
    (convo.messages || []).map(m => m.text || '').join(' '),
    convo.features?.Lifestyle || '',
    convo.genderAge || '',
  ].join(' ').toLowerCase();

  const coupleWords = ['couple', 'partner', 'girlfriend', 'boyfriend', 'wife', 'husband',
    'pareja', 'coppia', 'deux personnes', 'deux personne', 'mon copain', 'ma copine',
    'minha namorada', 'meu namorado', 'somos dos', 'nous sommes deux'];
  return coupleWords.some(w => text.includes(w));
}

/**
 * Detect if a message is asking about bond, deposit, or lease.
 */
/**
 * Extract profile info directly from their message text.
 * Saves Diego from having to ask questions already answered in the intro.
 */
function extractProfileFromMessage(text) {
  const t = text || '';
  const info = {};

  // Age
  const ageM = t.match(/\b(I(?:'m| am)|I'm)\s+(\d{2})\b/i) || t.match(/\b(\d{2})\s*(?:year[s]?\s*old|yo\b|yrs?\b)/i);
  if (ageM) info.age = parseInt(ageM[ageM.length - 1]);

  // Gender clues
  if (/\b(she|her|woman|girl|female|lady)\b/i.test(t)) info.gender = 'female';
  else if (/\b(he|him|man|guy|male)\b/i.test(t)) info.gender = 'male';

  // Nationality / country
  const natM = t.match(/from\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/);
  if (natM) info.nationality = natM[1];

  // Move-in date
  const moveM = t.match(/(?:moving|move|arrive[sd]?|available)\s+(?:on\s+)?([A-Z][a-z]+\s+\d{1,2}(?:st|nd|rd|th)?(?:\s+\d{4})?|\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?|March\s+\d+|April\s+\d+|May\s+\d+|June\s+\d+)/i);
  if (moveM) info.move_in_mention = moveM[1];

  // Work / study status
  const workM = t.match(/(?:I(?:'m| am) (?:a |an )?)?(student|working|work(?:ing)? (?:as|in)|studying|looking for work|job hunting|employed|freelan)/i);
  if (workM) info.work_study = workM[0].trim();

  // Budget mentioned
  const budgetM = t.match(/\$(\d{2,4})\s*(?:per\s*week|\/week|pw|wk)/i);
  if (budgetM) info.budget_mentioned = parseInt(budgetM[1]);

  // Clean / tidy claim
  if (/\b(tidy|clean|neat|organised|organized)\b/i.test(t)) info.self_described_tidy = true;

  // Non-smoker
  if (/non.?smok/i.test(t)) info.non_smoker = true;

  // Pet mention
  const petM = t.match(/\b(dog|cat|pet|animal)\b/i);
  if (petM) info.pet_mention = petM[1];

  return info;
}

/**
 * Detect if the enquirer is asking a specific question we might not have data for.
 * Returns { question, topic } or null.
 */
function detectQuestion(messages) {
  const last = messages?.filter(m => !m.isSystem && !m.isOwn).pop();
  if (!last?.text) return null;
  const t = last.text;

  const topics = [
    { re: /\b(furnish|furniture|bed|desk|wardrobe|mattress|what(?:'s| is) in the room|room (?:include|come with|have))\b/i, topic: 'room_furnishings' },
    { re: /\b(wifi|internet|speed|connected)\b/i, topic: 'wifi' },
    { re: /\b(park|parking|car|garage|vehicle|bike)\b/i, topic: 'parking' },
    { re: /\b(bill|bills|utility|utilities|electric|water|gas|included)\b/i, topic: 'bills_included' },
    { re: /\b(laundry|washing machine|dryer|wash)\b/i, topic: 'laundry' },
    { re: /\b(pet|dog|cat|animal)\b/i, topic: 'pets' },
    { re: /\b(how many|housemate|people|resident|flatmate|living)\b/i, topic: 'housemates' },
    { re: /\b(location|suburb|transport|bus|train|close to|near|distance|how far)\b/i, topic: 'location' },
    { re: /\b(tell me more|more about|more information|more info|could you|can you)\b/i, topic: 'general_info' },
    { re: /\b(still available|is the room|room available|vacancy)\b/i, topic: 'availability' },
    { re: /\b(price|cost|rent|weekly|how much)\b/i, topic: 'price' },
  ];

  for (const { re, topic } of topics) {
    if (re.test(t)) return { question: t.slice(0, 200), topic };
  }
  return null;
}

/**
 * Check if we can answer a question from room data.
 * Returns answer string or null.
 */
function answerFromRoomData(room, topic) {
  if (!room) return null;
  switch (topic) {
    case 'price':
      return room.price ? `$${room.price}/week` : null;
    case 'bills_included':
      return room.bills_included != null ? (room.bills_included ? 'Bills are included in the rent.' : 'Bills are not included in the rent.') : null;
    case 'wifi':
      return room.wifi != null ? (room.wifi ? 'WiFi is included.' : 'WiFi is not included.') : null;
    case 'parking':
      return room.parking != null ? (room.parking ? 'Parking is available.' : 'No parking available.') : null;
    case 'pets':
      return room.pets != null ? (room.pets ? 'Pets are allowed.' : 'Sorry, no pets allowed.') : null;
    case 'laundry':
      return room.laundry ? `Laundry: ${room.laundry}` : null;
    case 'room_furnishings':
      return room.furnishings ? room.furnishings : null;
    case 'availability':
      return room.available ? `The room is available from ${room.available}.` : null;
    default:
      return null;
  }
}

/** Flag an unanswered question to Diego via Telegram */
async function flagQuestionToDiego(enq, question, topic, conversationId) {
  const shortId = conversationId?.toString().slice(-6) || '??????';
  const msg = `❓ *Jess needs info - ${enq.name||'Unknown'} (#${shortId})*\n\n` +
    `They asked about *${topic.replace(/_/g,' ')}*:\n"${question}"\n\n` +
    `Reply with:\n\`${shortId}: your answer here\`\n\n` +
    `(Jess will turn it into a message for them)`;
  await sendToDiego(msg);
  log(`Flagged unanswered question (${topic}) for ${enq.name} to Diego`);
}

function isBondOrLeaseQuestion(messages) {
  const last = messages?.filter(m => !m.isSystem).pop();
  if (!last || !last.text || last.isOwn) return null;
  const t = last.text.toLowerCase();
  if (/\b(bond|deposit|caution|fianza|caução|caução)\b/.test(t)) return 'bond';
  if (/\b(lease|contract|agreement|bail|contrato|contrat|licen[cs]e|minimum stay|min.?stay)\b/.test(t)) return 'lease';
  return null;
}

/**
 * Detect if asking about minimum stay
 */
function isMinStayQuestion(messages) {
  const last = messages?.filter(m => !m.isSystem).pop();
  if (!last || !last.text || last.isOwn) return false;
  const t = last.text.toLowerCase();
  return /\b(minimum|min stay|how long|short.?term|short term|3 month|2 month|1 month)\b/.test(t);
}

/**
 * Detect humour deflect: asking how Jess speaks their language
 */
function isHumourQuestion(messages) {
  const last = messages?.filter(m => !m.isSystem).pop();
  if (!last || !last.text || last.isOwn) return false;
  const t = last.text.toLowerCase();
  return /\b(how do you|how can you|why do you|speak|language|español|française|português|google translate)\b/.test(t);
}

/**
 * Detect move-in date from features or message text.
 * Returns ISO date string or null.
 */
function extractMoveInDate(convo) {
  // From Flatmates features
  const raw = convo.features?.['Move date'] || convo.features?.['Available from'] || '';
  if (raw) {
    const d = parseFlatmatesDate(raw);
    if (d) return d;
  }

  // From last message text (crude extraction)
  const lastMsg = (convo.messages || []).filter(m => !m.isSystem && !m.isOwn).pop()?.text || '';
  const patterns = [
    /(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{2,4})/,           // dd/mm/yyyy
    /(\d{4})-(\d{2})-(\d{2})/,                                 // yyyy-mm-dd
    /(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s*(\d{4})?/i,
  ];

  for (const p of patterns) {
    const m = lastMsg.match(p);
    if (m) {
      const d = parseFlatmatesDate(m[0]);
      if (d) return d;
    }
  }

  return null;
}

/** Try to parse a date string into YYYY-MM-DD */
function parseFlatmatesDate(str) {
  try {
    const d = new Date(str);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0,10);
    // dd/mm/yyyy
    const dm = str.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (dm) {
      const year = dm[3].length === 2 ? '20' + dm[3] : dm[3];
      const d2 = new Date(`${year}-${dm[2].padStart(2,'0')}-${dm[1].padStart(2,'0')}`);
      if (!isNaN(d2.getTime())) return d2.toISOString().slice(0,10);
    }
  } catch (_) {}
  return null;
}

function classifyEnquirer(name, snippet, messages) {
  const text = `${snippet || ''} ${(messages || '')}`.toLowerCase();

  if (/couple|partner|girlfriend|boyfriend|wife|husband|\bwe are\b|both of us|my partner/.test(text)) {
    return { type: 'couple', template: 2 };
  }

  if (/\b[123]\s*month|\bshort.?term\b|less than 4|minimum stay|how flexible/.test(text)) {
    return { type: 'minstay', template: 5 };
  }

  if (/requirement|what.*(looking for|look for)|specific.*housemate/.test(text)) {
    return { type: 'requirements', template: 3 };
  }

  if (/exact location|where is|what.*address|tell me more|features of|important features/.test(text)) {
    return { type: 'info', template: 4 };
  }

  return { type: 'inspection', template: 1 };
}

function extractPhoneFromText(text) {
  const match = String(text || '').match(/(?:\+?61|0)4\d{8}/);
  if (!match) return null;
  let num = match[0].replace(/\s+/g, '');
  if (num.startsWith('0')) num = '61' + num.slice(1);
  if (num.startsWith('+')) num = num.slice(1);
  return num;
}

function scorePriority(enquirer) {
  let score = 5;
  if (enquirer.hasFollowUp) score += 3;
  if (enquirer.isIdVerified) score += 1;
  if (enquirer.lastMessageAt) {
    const age = Date.now() - new Date(enquirer.lastMessageAt).getTime();
    if (age < 24 * 3600000) score += 2;
    else if (age > 72 * 3600000) score -= 2;
  }
  if (enquirer.type === 'couple') score -= 1;
  return Math.min(10, Math.max(1, score));
}

function getBaseTemplateDraft(enq, houseCode) {
  const name = enq.name || 'there';
  switch (enq.template) {
    case 2:
      return `Hey ${name}! Thanks for your message 😊 We do consider couples on a case-by-case basis - it really depends on the room and the current house dynamic. Best way to find out is to come for an inspection so we can have a proper chat. When works for you both?`;
    case 3:
      return `Hey ${name}! We look for someone who's clean, respectful of shared spaces, and able to commit to at least 4 months. Happy to chat more at an inspection - when works for you? 😊`;
    case 4:
      return `Hey ${name}! Happy to share all the details in person. The property is in ${houseCode || 'the area'} - would you like to book a quick inspection this week so you can see it for yourself and ask any questions? 😊`;
    case 5:
      return `Hey ${name}! Thanks for reaching out 😊 Our minimum stay is 4 months - that's firm, sorry. If you can commit to that, we'd love to have you come for an inspection. Let us know!`;
    case 1:
    default:
      return `Hey ${name}! Thanks for reaching out 😊 The room is still available. When are you free for a quick inspection this week?`;
  }
}

/**
 * Main decision engine for a single conversation.
 * Returns { action, draft } or null if no reply needed.
 */
async function decideReply(convo, enq, houseCode) {
  const rooms = loadRooms();
  const messages = convo.messages || [];

  // --- Guard: no message or we replied last ---
  const lastMsg = messages[messages.length - 1];
  if (!lastMsg) return null;
  lastMsg.isFromEnquirer = !lastMsg.isOwn;
  if (!lastMsg.isFromEnquirer) {
    convo.status = 'replied';
    return null;
  }

  const msgText = lastMsg.text || '';
  const allEnquirerMessages = messages.filter(m => !m.isSystem && !m.isOwn).map(m => m.text || '').join(' ');
  const classification = classifyEnquirer(enq.name, msgText, allEnquirerMessages);
  enq.type = classification.type;
  enq.template = classification.template;
  enq.isStudent = /student|university|uni|studying|diploma|masters|qut|griffith|uq/.test(allEnquirerMessages.toLowerCase());
  enq.isWHV = /working holiday|whv/.test(allEnquirerMessages.toLowerCase());
  enq.isIdVerified = convo.isIdVerified ?? enq.isIdVerified ?? false;
  const lang = detectLanguage(convo.description || msgText);

  // --- Extract profile info from their message text (save on asking) ---
  const extracted = extractProfileFromMessage(msgText);
  if (extracted.age && !enq.age) enq.age = extracted.age;
  if (extracted.gender && !enq.gender) enq.gender = extracted.gender;
  if (extracted.nationality && !enq.cultural_background) enq.cultural_background = extracted.nationality;
  if (extracted.work_study && !enq.work_study) enq.work_study = extracted.work_study;
  if (extracted.move_in_mention && !enq.move_in_date) enq.move_in_date = extracted.move_in_mention;
  if (extracted.non_smoker) enq.non_smoker = true;
  if (extracted.self_described_tidy) enq.tidy = true;

  // --- 16. Humour deflect ---
  if (isHumourQuestion(messages)) {
    return { action: 'humour_deflect', draft: tplHumourDeflect(lang) };
  }

  if ([1, 2, 3, 4, 5].includes(enq.template)) {
    return { action: `template_${enq.template}`, draft: getBaseTemplateDraft(enq, houseCode) };
  }

  // --- 12. Bond / lease Q&A ---
  const bondOrLease = isBondOrLeaseQuestion(messages);
  if (bondOrLease) {
    const room = rooms.find(r => r.houseCode === houseCode);
    const price = room?.price || 300;
    return { action: 'bond_info', draft: tplBondInfo(enq.name || 'there', price, lang) };
  }

  // --- 13. Min stay question ---
  if (isMinStayQuestion(messages)) {
    const isCouple = detectCouple(convo, enq);
    return { action: 'min_stay', draft: tplMinStay(enq.name || 'there', isCouple, lang) };
  }

  // --- 7. Vague message - no house code identified ---
  if (!houseCode) {
    return { action: 'ask_room_and_date', draft: tplAskRoomAndDate(enq.name || 'there', lang) };
  }

  // --- Find the room ---
  const room = rooms.find(r => r.houseCode === houseCode);
  if (!room) return null;

  // --- Question detector - check if they're asking something specific ---
  const detected = detectQuestion(messages);
  if (detected) {
    const roomAnswer = answerFromRoomData(room, detected.topic);
    if (roomAnswer) {
      // We have the answer - include it in the response
      enq.pending_question_answer = roomAnswer;
    } else if (!enq[`flagged_${detected.topic}`]) {
      // We don't have the answer - flag to Diego and wait
      enq[`flagged_${detected.topic}`] = true;
      enq.awaiting_info = detected.topic;
      await flagQuestionToDiego(enq, detected.question, detected.topic, convo.convId);
      return { action: 'waiting_for_info', draft: null }; // don't reply until Diego answers
    }
  }

  // --- 3. Couple detection ---
  const isCouple = detectCouple(convo, enq);
  if (isCouple) {
    enq.couple = true;
    if (room.singles_only) {
      // Redirect to couple-friendly listings
      const coupleRooms = rooms.filter(r =>
        !r.singles_only && r.available && COUPLE_FRIENDLY_CODES.includes(r.houseCode)
      );
      return { action: 'couple_redirect', draft: tplCoupleRedirect(enq.name || 'there', coupleRooms, lang) };
    }
  }

  // --- 4/5. Room availability ---
  if (!room.available) {
    // Add to waitlist
    const waitlist = loadWaitlist();
    if (!waitlist[houseCode]) waitlist[houseCode] = [];
    if (!waitlist[houseCode].find(e => e.enquirerId === enq.id)) {
      waitlist[houseCode].push({ enquirerId: enq.id, name: enq.name, addedAt: new Date().toISOString() });
      saveWaitlist(waitlist);
    }
    enq.status = 'waitlisted';

    const otherAvailable = rooms.filter(r => r.available && r.houseCode !== houseCode);
    return { action: 'not_available_waitlist', draft: tplRoomNotAvailable(enq.name || 'there', otherAvailable, lang) };
  }

  // --- 6. Future move-in (>14 days away) ---
  const moveDate = extractMoveInDate(convo) || enq.move_in_date;
  if (moveDate && daysFromNow(moveDate) > 14) {
    // Park and add to followup
    const followup = loadFollowup();
    if (!followup.find(f => f.enquirerId === enq.id && f.houseCode === houseCode)) {
      followup.push({
        id: crypto.randomUUID(),
        enquirerId: enq.id,
        name: enq.name,
        houseCode,
        move_date: moveDate,
        followup_date: (() => {
          const d = new Date(moveDate + 'T00:00:00+10:00');
          d.setDate(d.getDate() - 10);
          return d.toISOString().slice(0,10);
        })(),
        notified: false,
        addedAt: new Date().toISOString(),
      });
      saveFollowup(followup);
      log(`Added ${enq.name} to followup (move-in: ${moveDate})`);
    }
    enq.status = 'future';
    enq.move_in_date = moveDate;
    return { action: 'future_move_in', draft: tplFutureMoveIn(enq.name || 'there', moveDate, lang) };
  }

  // --- 9. Priority: low priority + first contact → ignore ---
  if (enq.priority === 'low' && enq.status === 'new') {
    enq.status = 'declined'; // internally marked, no reply
    log(`Skipping low-priority enquirer ${enq.name} on first contact`);
    return null;
  }

  // --- 9. Priority: low priority + follow-up → decline ---
  if (enq.priority === 'low' && enq.status !== 'new') {
    return { action: 'decline', draft: DECLINE_MSG };
  }

  // --- Diego answered a flagged question - send it ---
  if (enq.diegoAnswer) {
    const answer = enq.diegoAnswer;
    enq.diegoAnswer = null;
    return { action: 'answer_question', draft: tplAnswerQuestion(enq.name || 'there', answer, lang) };
  }

  // --- 2. Profile check (new enquirer) ---
  if (enq.status === 'new') {
    enq.status = 'profile_requested';
    return { action: 'ask_profile', draft: tplAskProfile(enq.name || 'there', lang) };
  }

  // --- 2b. Profile requested - check if they replied ---
  if (enq.status === 'profile_requested') {
    const lastMsg = [...(convo.messages || [])].reverse().find(m => !m.isOwn && !m.isSystem);
    if (lastMsg) {
      // They replied - parse profile fields from their message
      const txt = lastMsg.text || '';
      if (!enq.work_study && txt.length > 5) enq.work_study = txt.slice(0, 150);
      if (!enq.cultural_background && txt.length > 5) enq.cultural_background = txt.slice(0, 200);
    }

    if (isProfileComplete(enq)) {
      // Profile complete → notify viewing pending
      enq.status = 'viewing_pending';
      return { action: 'viewing_pending', draft: tplViewingPending(enq.name || 'there', lang) };
    } else {
      // Partially answered - ask for missing field only (max 2 follow-ups)
      const followups = (enq.notes || '').match(/\[profile_followup\]/g)?.length || 0;
      if (followups < 2) {
        const fields = ['cultural_background', 'work_study', 'age', 'hobbies'];
        const missingLabel = { cultural_background: 'background', work_study: 'work or study situation', age: 'age', hobbies: 'hobbies or interests' };
        const missing = fields.find(f => !enq[f] || String(enq[f]).trim() === '');
        if (missing) {
          enq.notes = (enq.notes || '') + '[profile_followup]';
          const followupDraft = {
            EN: `Hi ${enq.name||'there'}! Just one more thing - could you share your ${missingLabel[missing]}? Thanks 😊`,
            FR: `Bonjour ${enq.name||'there'} ! Encore une chose - pourriez-vous nous parler de votre ${missingLabel[missing]} ? Merci 😊`,
            ES: `¡Hola ${enq.name||'there'}! Solo una cosa más - ¿podrías contarme tu ${missingLabel[missing]}? Gracias 😊`,
            PT: `Olá ${enq.name||'there'}! Só mais uma coisa - você pode me contar sobre ${missingLabel[missing]}? Obrigado 😊`,
          };
          return { action: 'ask_profile_partial', draft: followupDraft[lang] || followupDraft.EN };
        }
      }
      // 2+ follow-ups with no complete profile → hold
      enq.status = 'viewing_pending';
      return { action: 'viewing_pending', draft: tplViewingPending(enq.name || 'there', lang) };
    }
  }

  // --- 2c. Viewing pending - wait for inspection slot ---
  if (enq.status === 'viewing_pending') {
    // Inspection slot now available → send invite
    const slotInfo = allocateInspectionSlot(houseCode, enq.id);
    if (slotInfo) {
      enq.inspection_slot = slotInfo;
      enq.status = 'invited';
      return { action: 'invite_inspection', draft: tplInviteInspection(enq.name || 'there', houseCode, room, slotInfo, lang) };
    }
    return null; // Still waiting - no action
  }

  // --- 8. Inspection slot (for other statuses) ---
  const slotInfo = allocateInspectionSlot(houseCode, enq.id);
  if (slotInfo) {
    enq.inspection_slot = slotInfo;
    enq.status = 'invited';
    return { action: 'invite_inspection', draft: tplInviteInspection(enq.name || 'there', houseCode, room, slotInfo, lang) };
  }

  // No inspection slot configured - hold
  if (enq.status === 'new') {
    enq.status = 'profile_requested';
    return { action: 'ask_profile', draft: tplAskProfile(enq.name || 'there', lang) };
  }
  return null; // Already in progress, wait
}

// ─── No-show prevention ───────────────────────────────────────────────────────

/**
 * Use Ollama to refine a template draft based on full conversation context.
 * Reads what was already said → avoids doubling questions → sounds human.
 * Falls back to original template draft if Ollama fails or times out.
 */
async function ollamaRefineDraft(draft, convo, enq, room) {
  let modelFailure = false;
  try {
    const messages = (convo.messages || []).filter(m => !m.isSystem).slice(-12); // last 12 messages

    // Build history - use full messages if available, else fall back to snippet
    let history;
    if (messages.length > 0) {
      history = messages.map(m => `${m.isOwn ? 'Jess' : (enq.name || 'Enquirer')}: ${m.text}`).join('\n');
    } else {
      const snippet = convo.snippet || convo.lastMessagePreview || convo.rawText || '';
      if (!snippet || snippet.length < 10) return draft; // truly nothing to work with
      history = `${enq.name || 'Enquirer'}: ${snippet}`;
    }

    const roomInfo = room ? [
      `House: ${room.houseCode}`,
      `Price: $${room.price}/week${room.couplePrice ? ` (couple: $${room.couplePrice})` : ''}`,
      `Available: ${room.available || 'now'}`,
      room.features ? `Features: ${room.features}` : '',
    ].filter(Boolean).join(', ') : '';
    const profile = loadTrainingProfile();
    let trainingProfileBlock = '';
    if (profile?.styleProfile) {
      trainingProfileBlock += `\n\n## Diego's Communication Style (learned from training):\n${profile.styleProfile}`;
    }
    if (profile?.examples?.length) {
      const samples = profile.examples.slice(-5);
      trainingProfileBlock += `\n\n## Example responses Diego uses:\n`;
      samples.forEach(ex => {
        trainingProfileBlock += `Lead: "${ex.enquirerMessage}"\nDiego: "${ex.diegoResponse}"\n\n`;
      });
    }

    const prompt = `You are Jess - the warm, sharp, and welcoming face of a premium co-living company in Brisbane, Australia. You represent beautiful, well-managed shared homes where people don't just rent a room - they find community.

Your job: turn this enquiry into excitement. Make them feel like this is the right place, the right vibe, the right moment.

CONVERSATION HISTORY:
${history}

ROOM INFO: ${roomInfo || 'not specified'}
ENQUIRER PROFILE: name=${enq.name || '?'}, age=${enq.age || '?'}, gender=${enq.gender || '?'}, work/study=${enq.work_study || '?'}, move-in=${enq.move_in_date || '?'}

TEMPLATE DRAFT (use as a base, make it better):
${draft}

YOUR WRITING STYLE:
- Warm, genuine, human - not corporate, not robotic
- Confident but never pushy - you're offering something great, not begging
- Short and punchy - 2-4 sentences max unless detail is needed
- Use their first name naturally
- Light positive energy - like a cool housemate, not a real estate agent
- Match their language exactly (EN/FR/ES/PT)

STRICT RULES:
- Read the full conversation. NEVER ask something they already answered.
- NEVER repeat a question Jess already asked in this chat.
- NEVER invent facts, prices, or dates not in the room info.
- NEVER use hollow filler phrases like "I hope this message finds you well" or "Don't hesitate to reach out".
- NEVER say things like "I'll see you tomorrow", "Can't wait to meet you", "I'll be there", "See you soon", or any phrase implying Jess will physically show up - she won't. Viewings are conducted by our team, not Jess.
- Before a viewing is booked: stay warm but non-committal - "I'll keep you posted", "we'll be in touch to lock something in", "we'll reach out soon to confirm the details".
- After a viewing is booked: refer to "someone from our team" meeting them - never "I".
- If draft already covers what's needed cleanly, refine tone only - don't rewrite unnecessarily.
- Return ONLY the final message text. No labels, no explanations, no quotes around it.${trainingProfileBlock}`;

    // Fallback chain: Gemini 2.5 Flash → minimax → kimi → qwen3 → template
    const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || '';

    // Try Gemini Flash first (native API)
    if (GOOGLE_API_KEY) {
      try {
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GOOGLE_API_KEY}`;
        const resp = await fetch(geminiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.4, maxOutputTokens: 300 },
          }),
          signal: AbortSignal.timeout(15000),
        });
        if (resp.ok) {
          const data = await resp.json();
          const refined = (data.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
          if (refined.length > 10 && refined.length < 1500) {
            log(`Gemini Flash refined draft for ${enq.name || '?'} (${refined.length} chars)`);
            return refined;
          }
          modelFailure = true;
          log('Gemini Flash returned bad output - trying Ollama fallback');
        } else {
          modelFailure = true;
          log(`Gemini Flash failed (${resp.status}) - trying Ollama fallback`);
        }
      } catch (e) {
        modelFailure = true;
        log(`Gemini Flash error: ${e.message} - trying Ollama fallback`);
      }
    }

    // Ollama fallback chain: minimax-m2.5:cloud → kimi-k2.5:cloud → qwen3:8b
    const models = ['minimax-m2.5:cloud', 'kimi-k2.5:cloud', 'qwen3:8b'];

    for (const model of models) {
      try {
        const resp = await fetch('http://127.0.0.1:11434/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            prompt,
            stream: false,
            options: { temperature: 0.4, num_predict: 300 }
          }),
          signal: AbortSignal.timeout(model === 'qwen3:8b' ? 25000 : 12000),
        });

        if (!resp.ok) { modelFailure = true; log(`Ollama ${model} failed (${resp.status}) - trying next`); continue; }
        const data = await resp.json();
        let refined = (data.response || '').trim();
        // Strip Kimi/Ollama multi-option format ("Or:" separators) - take first option only
        if (refined.includes('\n\nOr:') || refined.includes('\nOr:')) {
          refined = refined.split(/\n\nOr:|\nOr:/)[0].trim();
        }
        // Strip unfilled placeholders
        refined = refined.replace(/\$\[[\w\s]+\]/g, '').trim();

        if (refined.length > 10 && refined.length < 1500) {
          log(`Ollama [${model}] refined draft for ${enq.name || '?'} (${refined.length} chars)`);
          return refined;
        }
        modelFailure = true;
        log(`Ollama ${model} returned bad output - trying next`);
      } catch (e) {
        modelFailure = true;
        log(`Ollama ${model} error: ${e.message} - trying next`);
      }
    }
    if (modelFailure) return draft; // all models failed - use original template
    return draft;
  } catch (e) {
    log(`Ollama refine skipped: ${e.message}`);
    return draft; // fallback to template
  }
}

/**
 * Check all confirmed inspections and send reminders as needed.
 * Called on every poll cycle.
 */
async function handleNoShowPrevention(_unused) {
  const inspections = loadInspections();
  const enquirers   = loadEnquirers();
  const now = Date.now();

  for (const insp of inspections) {
    if (!insp.active) continue;

    const inspDateTime = new Date(`${insp.date}T${insp.time}:00+10:00`).getTime();
    const msUntil = inspDateTime - now;
    const hoursUntil = msUntil / (1000 * 60 * 60);
    const dayBefore  = msUntil > 20 * 3600 * 1000 && msUntil < 30 * 3600 * 1000;
    const twoHourBefore = hoursUntil > 1.5 && hoursUntil < 2.5;
    const oneHourBefore = hoursUntil > 0.5 && hoursUntil < 1.5;

    for (const slot of (insp.slots || [])) {
      for (const enqId of (slot.enquirer_ids || [])) {
        const enq = enquirers.find(e => e.id === enqId);
        if (!enq || enq.status === 'declined') continue;

        const lang = detectLanguage(enq.notes || '');
        const dayStr  = formatDay(insp.date);
        const timeStr = formatTime(slot.time);

        // Day-before confirmation
        if (dayBefore && !slot[`confirmed_sent_${enqId}`]) {
          const draft = tplConfirmInspection(enq.name, insp.houseCode, dayStr, timeStr, lang);
          await queueForApproval({
            conversationId: enq.conversation_id,
            conversationUrl: `https://flatmates.com.au/messages/${enq.conversation_id}`,
            enquirerId: enq.id,
            enquirerName: enq.name,
            houseCode: insp.houseCode,
            action: 'confirm_inspection',
            draft,
          });
          slot[`confirmed_sent_${enqId}`] = true;
          saveInspections(inspections);
        }

        // 2h before - address reminder
        if (twoHourBefore && !slot[`address_sent_${enqId}`] && enq.status === 'confirmed') {
          const room = loadRooms().find(r => r.houseCode === insp.houseCode);
          const address = room?.real_address || room?.listing_address || insp.houseCode;
          const draft = tplAddressReminder(enq.name, address, timeStr, lang);
          await queueForApproval({
            conversationId: enq.conversation_id,
            conversationUrl: `https://flatmates.com.au/messages/${enq.conversation_id}`,
            enquirerId: enq.id,
            enquirerName: enq.name,
            houseCode: insp.houseCode,
            action: 'address_reminder',
            draft,
          });
          slot[`address_sent_${enqId}`] = true;
          saveInspections(inspections);
        }

        // Morning of inspection (2-4h before) - send attendee list to house manager via WA bridge
        const morningWindow = hoursUntil > 2 && hoursUntil < 4;
        if (morningWindow && !insp[`attendee_list_sent_${insp.date}`]) {
          const confirmedEnquirers = (insp.slots || []).flatMap(s =>
            (s.enquirer_ids || []).map(id => enquirers.find(e => e.id === id)).filter(Boolean)
          ).filter(e => e.status === 'confirmed' || e.status === 'invited');

          if (confirmedEnquirers.length > 0) {
            const manager = getManagerForHouse(insp.houseCode);
            const lines = confirmedEnquirers.map((e, i) =>
              `${i+1}. ${e.name} - 📱 ${e.phone||'no phone'} - ${e.couple?'👫 Couple':'👤 Single'} - Move in: ${e.move_in_date||'?'}`
            ).join('\n');

            // WhatsApp to manager (personal chat)
            if (manager.wa_id) {
              const waMsg = `📋 *${insp.houseCode} Inspection - ${insp.date}*\n\nHi ${manager.name}, here are the people confirmed for today:\n\n${lines}\n\nGood luck! 💪`;
              await sendWaMessage(manager.wa_id, waMsg);
              log(`Attendee list sent via WA to ${manager.name} for ${insp.houseCode}`);
            }

            // Telegram to Diego (always)
            const owners = loadManagers().filter(m => m.telegram_chat_id && m.role === 'owner');
            for (const owner of owners) {
              const tgMsg = `📋 ${insp.houseCode} Inspection - ${insp.date}\n\nManager: ${manager.name}\n\nAttendees:\n${lines}`;
              await sendTelegramMessage(owner.telegram_chat_id, tgMsg);
            }

            insp[`attendee_list_sent_${insp.date}`] = true;
            saveInspections(inspections);
            log(`Attendee list sent for ${insp.houseCode} inspection on ${insp.date}`);
          }
        }

        // 1h before - no reply → release slot, notify Diego
        if (oneHourBefore && enq.status !== 'confirmed' && !slot[`slot_released_${enqId}`]) {
          logWarn(`Releasing slot for no-reply enquirer ${enq.name} at ${insp.houseCode} ${timeStr}`);
          slot.enquirer_ids = slot.enquirer_ids.filter(id => id !== enqId);
          slot[`slot_released_${enqId}`] = true;
          saveInspections(inspections);

          await sendToDiego(
            `⚠️ Jess: Slot released - ${enq.name} did not confirm for ${insp.houseCode} inspection ` +
            `(${dayStr} at ${timeStr}). Slot is now free.`
          );
        }
      }
    }
  }
}

// ─── Follow-up checker ────────────────────────────────────────────────────────

/**
 * Check follow-up list - notify Diego 10 days before a future move-in date
 */
async function handleFollowups() {
  const followups = loadFollowup();
  const today = new Date().toISOString().slice(0,10);
  let changed = false;

  for (const fu of followups) {
    if (fu.notified) continue;
    if (fu.followup_date <= today) {
      // Time to follow up
      await sendToDiego(
        `📅 Jess follow-up: ${fu.name} is looking to move into ${fu.houseCode} around ${fu.move_date}.\n` +
        `It's now ~10 days before - check if a room is available and re-engage them.`
      );
      fu.notified = true;
      changed = true;
      log(`Sent followup reminder for ${fu.name} (${fu.houseCode}, move: ${fu.move_date})`);
    }
  }

  if (changed) saveFollowup(followups);
}


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
      await sendTelegramAlert(`🚨 *Jess CRITICAL jam* - ${q} commands queued!\n\nRefresh the Flatmates tab in Chrome to clear it.`);
      lastJamAlertLevel = 'critical'; lastJamAlertTime = now;
    } else if (q > 200 && lastJamAlertLevel !== 'warning' && lastJamAlertLevel !== 'critical' && (now - lastJamAlertTime > alertCooldown)) {
      await sendTelegramAlert(`⚠️ *Jess relay jam* - ${q} commands queued. Refresh Flatmates tab if messages stop sending.`);
      lastJamAlertLevel = 'warning'; lastJamAlertTime = now;
    } else if (q < 20 && lastJamAlertLevel) {
      await sendTelegramAlert(`✅ *Jess relay cleared* - queue back to normal (${q} commands)`);
      lastJamAlertLevel = null; lastJamAlertTime = 0;
    }
    if (q > 50) log(`WARN relay queue depth: ${q} commands`);
  } catch(e) { /* relay may be starting */ }
}

async function sendTelegramAlert(msg) {
  return sendToDiego(msg);
}

// ─── Main poll loop ───────────────────────────────────────────────────────────

async function runPollCycle() {
  if (jessPaused) return;
  if (isBrowserBusy) {
    log('⏳ [poll] Browser busy (countLeads running) — skipping poll cycle, will retry next interval');
    return;
  }
  lastPollAt = new Date().toISOString();
  log('─── Starting poll cycle ───');
  await checkRelayJam();

  const healthy = await verifyFlatmatesSession(null);
  if (!healthy) {
    relayFailureStreak += 1;
    logWarn(`Skipping poll cycle due to unhealthy Flatmates session: ${sessionHealth.reason} (streak ${relayFailureStreak})`);
    if (relayFailureStreak >= 3) {
      await pauseJess(`Relay unreachable for ${relayFailureStreak} consecutive poll cycles`, 0);
    }
    return;
  }
  relayFailureStreak = 0;

  // ─── Jess v4 thread-state detection + priority queue feed ────────────────────
  let _v4SortScores = []; // scores for dispatch-queue sort
  try {
    const _v4threadState = require('./modules/thread-state');
    const _v4priority    = require('./modules/priority-engine');
    const _v4dispatch    = require('./modules/dispatch-queue');
    const _v4houseMatcher = require('./modules/house-matcher');
    const _v4inbox       = await fetchInbox().catch(() => []);

    // ── Enrich conversations without houseCode ──────────────────────────────
    try {
      const _v4rooms = loadRooms();
      const _v4tsRaw = _v4houseMatcher.loadThreadStates();
      let _v4enriched = 0;
      for (const _v4c of _v4inbox) {
        if (!_v4c.houseCode || _v4c.houseCode === '?') {
          const _v4matched = _v4houseMatcher.matchHouseCode(_v4c, _v4rooms, _v4tsRaw);
          if (_v4matched) {
            _v4c.houseCode = _v4matched;
            _v4enriched++;
            // Persist to thread-state so future polls resolve faster
            const _v4etid = String(_v4c.threadId || _v4c.id || '');
            if (_v4etid) {
              const _v4existing = _v4threadState.get(_v4etid) || {};
              _v4threadState.set(_v4etid, { ..._v4existing, houseCode: _v4matched });
            }
          }
        }
      }
      if (_v4enriched > 0) log(`[house-matcher] Enriched ${_v4enriched}/${_v4inbox.length} conversations with houseCode`);
    } catch (_v4hmErr) {
      log('[house-matcher] enrichment error (non-fatal): ' + _v4hmErr.message);
    }
    // ── End house-matcher enrichment ────────────────────────────────────────

    // ── Queue threads still without houseCode for background deep-fetch ─────
    try {
      const _eq = require('./modules/enrichment-queue');
      const _needsEnrich = _v4inbox.filter(c =>
        !c.houseCode || c.houseCode === '?' || c.houseCode === 'UNKNOWN'
      );
      for (const _c of _needsEnrich) {
        _eq.enqueue(String(_c.threadId || _c.id || ''));
      }
      if (_needsEnrich.length > 0) {
        log(`[bg-enrich] Queued ${_needsEnrich.length} threads without houseCode for enrichment`);
      }
    } catch (_eqErr) {
      log('[bg-enrich] enqueue error (non-fatal): ' + _eqErr.message);
    }
    // ── End enrichment-queue step ─────────────────────────────────────────────

    const _v4needsReplyIds = [];

    for (const _v4conv of _v4inbox) {
      try {
        const _v4id  = String(_v4conv.threadId || _v4conv.id || '');
        if (!_v4id) continue;

        // Current message metrics from relay
        const _v4currentMsgCount = typeof _v4conv.messageCount === 'number'
          ? _v4conv.messageCount
          : (Array.isArray(_v4conv.messages) ? _v4conv.messages.length : 0);
        const _v4lastMsgTs = (() => {
          if (Array.isArray(_v4conv.messages)) {
            const _msgs = [..._v4conv.messages].reverse().filter(m => !m.isOwn && !m.isSystem);
            for (const _m of _msgs) {
              const _t = _m.time || _m.timestamp || _m.ts;
              if (_t) { const _n = typeof _t === 'number' ? _t : Date.parse(_t); if (_n > 0) return _n; }
            }
          }
          const _raw = _v4conv.lastMessageAt || _v4conv.updatedAt || _v4conv.lastActive || 0;
          if (!_raw) return 0;
          return typeof _raw === 'number' ? _raw : Date.parse(_raw) || 0;
        })();
        const _v4lastMsgFromLead = (() => {
          if (Array.isArray(_v4conv.messages) && _v4conv.messages.length > 0) {
            const _last = [..._v4conv.messages].reverse().find(m => !m.isSystem);
            return _last ? (!_last.isOwn && !_last.isMine) : false;
          }
          return false; // can't determine from snippet alone
        })();

        // Get or create thread state
        const _v4state = _v4threadState.get(_v4id) || {
          threadId: _v4id,
          houseCode: null,
          lastSeenMessageCount: 0,
          lastSeenTimestamp: 0,
          stage: 'new',
          priorityScore: 0,
          needsReply: false,
          processedAt: null,
          skippedAt: null,
        };

        // Detect new inbound messages
        const _v4hasNewInbound =
          (_v4currentMsgCount > _v4state.lastSeenMessageCount) ||
          (_v4lastMsgFromLead && _v4lastMsgTs > _v4state.lastSeenTimestamp);

        if (_v4hasNewInbound) {
          const _v4newCount = Math.max(0, _v4currentMsgCount - _v4state.lastSeenMessageCount);
          const _v4newStage = (!_v4state.processedAt && _v4state.stage === 'new') ? 'new' : _v4state.stage;
          const _v4updated = _v4threadState.set(_v4id, {
            ..._v4state,
            needsReply:           true,
            stage:                _v4newStage,
            lastSeenMessageCount: _v4currentMsgCount,
            lastSeenTimestamp:    _v4lastMsgTs,
          });
          // Score for logging
          const _v4scored1 = _v4priority.score([_v4id], _v4inbox);
          const _v4sc = _v4scored1[0] ? _v4scored1[0].score : 0;
          const _v4house = _v4updated.houseCode || _v4conv.houseCode || '?';
          log(`[v4-delta] Thread ${_v4id} (${_v4house}): +${_v4newCount} new inbound, score ${_v4sc}`);
          _v4needsReplyIds.push(_v4id);
        } else {
          // Always update counters even if no new inbound
          if (_v4currentMsgCount !== _v4state.lastSeenMessageCount || _v4lastMsgTs !== _v4state.lastSeenTimestamp) {
            _v4threadState.set(_v4id, {
              ..._v4state,
              lastSeenMessageCount: _v4currentMsgCount,
              lastSeenTimestamp:    _v4lastMsgTs,
            });
          }
          // Also collect already-flagged needsReply threads for queue
          if (_v4state.needsReply) _v4needsReplyIds.push(_v4id);
        }
      } catch (_v4convErr) {
        // never break v3 on single-thread error
      }
    }

    // Feed to priority queue
    if (_v4needsReplyIds.length > 0) {
      const _v4scored = _v4priority.score(_v4needsReplyIds, _v4inbox);
      _v4dispatch.update(_v4scored);
      _v4SortScores = _v4scored; // expose for dispatch-queue sort below
      const _v4top = _v4scored[0];
      log(`[v4-queue] ${_v4needsReplyIds.length} threads queued, top: ${_v4top ? _v4top.threadId + ' score=' + _v4top.score : 'none'}`);
    } else {
      log(`[v4] ${_v4inbox.length} threads checked, 0 need reply`);
    }
  } catch (_v4err) {
    log('[v4] thread-state hook error (non-fatal): ' + _v4err.message);
  }
  // ─── End Jess v4 hook ────────────────────────────────────────────────────────

  // ── Enrich relay inbox houseCodes (async, fire-and-forget) ─────────────────
  relayPost('/api/enrich-housecodes', {}).then(r => {
    if (r && r.matched > 0) log(`[house-matcher] relay enriched ${r.matched}/${r.total} inbox houseCodes`);
  }).catch(() => {}); // non-fatal

  // 0. Auto-navigate: for unread threads without full message data, click them now (max 8/cycle)
  try {
    const inbox = await fetchInbox().catch(() => []);
    const today = new Date().toISOString().slice(0, 10);
    // Thread IDs with due promise follow-ups - always navigate regardless of age
    const duePromiseThreadIds = new Set(
      loadFollowup()
        .filter(f => f.type === 'promise' && !f.dismissed && !f.drafted && f.followupDate <= today)
        .map(f => f.threadId)
        .filter(Boolean)
    );
    const WALL_SIZE = 8;
    const MAX_AUTO_NAV = 8;
    const unreadNoThread = [];
    let consecutiveFails = 0;
    for (const c of inbox) {
      if (!c.threadId) continue;
      if (duePromiseThreadIds.has(c.threadId)) {
        unreadNoThread.push(c); // promise due - always include, bypass wall
        consecutiveFails = 0;
        if (unreadNoThread.length >= MAX_AUTO_NAV) break;
        continue;
      }
      if (!c.unread && !c.isUnread) continue;
      if (shouldAutoNav(c)) {
        unreadNoThread.push(c);
        consecutiveFails = 0;
        if (unreadNoThread.length >= MAX_AUTO_NAV) break;
      } else {
        consecutiveFails++;
        if (consecutiveFails >= WALL_SIZE) {
          log(`[auto-nav] Wall detected after ${unreadNoThread.length} candidates - stopping scan`);
          break;
        }
      }
    }
    let navigated = 0;
    for (const c of unreadNoThread) {
      if (!c.threadId) continue;
      const existing = await fetchThread(c.threadId).catch(() => null);
      if (existing && existing.messages && existing.messages.length > 0) continue; // already have data
      await requestNavigate(c.threadId).catch(() => {});
      navigated++;
      await new Promise(r => setTimeout(r, 3500)); // wait for extension to click + scrape
    }
    if (navigated > 0) log(`[auto-nav] Clicked ${navigated} unread threads for message scraping`);
  } catch (navErr) {
    logWarn(`[auto-nav] Failed: ${navErr.message}`);
  }

  // 1. Get all conversation links
  let links = await getConversationLinks(null, 80);
  if (links.length === 0) {
    logWarn('No conversation links found in healthy session; skipping this cycle.');
    return;
  }

  // ── v4-sort: re-order links by priority score (descending) before v3 loop ──
  try {
    if (_v4SortScores.length > 0) {
      const _v4ScoreMap = new Map(_v4SortScores.map(s => [s.threadId, s.score]));
      links.sort((a, b) => {
        const _ida = a.replace('relay://thread/', '');
        const _idb = b.replace('relay://thread/', '');
        const _sa = _v4ScoreMap.get(_ida) ?? -1;
        const _sb = _v4ScoreMap.get(_idb) ?? -1;
        return _sb - _sa;
      });
      const _v4sortSummary = _v4SortScores
        .slice(0, 10)
        .map(s => `${s.threadId}(${s.score})`)
        .join(', ');
      log(`[v4-sort] Processing ${links.length} threads in priority order: [${_v4sortSummary}]`);
    }
  } catch (_v4sortErr) {
    logWarn('[v4-sort] Sort error (non-fatal): ' + _v4sortErr.message);
  }
  // ── end v4-sort ───────────────────────────────────────────────────────────

  let enquirers = loadEnquirers();
  let replied = 0;

  const conversationMeta = [];
  for (const url of links) {
    try {
      const convo = await scrapeConversation(null, url);
      const lastMessageAt = [...(convo.messages || [])].reverse().find(m => !m.isOwn && !m.isSystem)?.time || null;
      const text = (convo.messages || []).filter(m => !m.isOwn && !m.isSystem).map(m => m.text || '').join(' ');
      const snippet = [...(convo.messages || [])].reverse().find(m => !m.isOwn && !m.isSystem)?.text || '';
      const cls = classifyEnquirer(convo.memberName, snippet, text);
      const hasFollowUp = /\b(hello\?|hi\?|just following up|follow up|following up|any update|still available\?|keen to inspect)\b/i.test(text);
      const priority = scorePriority({ type: cls.type, hasFollowUp, isIdVerified: convo.isIdVerified ?? false, lastMessageAt });
      conversationMeta.push({ url, priority, lastMessageAt });
    } catch (_) {
      conversationMeta.push({ url, priority: 1, lastMessageAt: null });
    }
  }
  links = conversationMeta.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return new Date(b.lastMessageAt || 0).getTime() - new Date(a.lastMessageAt || 0).getTime();
  }).map(item => item.url);

  // 2. Process each conversation
  for (let i = 0; i < links.length; i++) {
    const url = links[i];
    try {
      const convo = await scrapeConversation(null, url);
      if (!convo.memberName) continue;

      const convId = convo.convId || url.split('/').pop();
      const houseCode = identifyHouseCode(convo);

      // --- 17. Same-person dedup (name + phone) ---
      let enq = findEnquirer(enquirers, {
        conversationId: convId,
        name: convo.memberName,
        phone: convo.phone,
      });

      if (!enq) {
        // New enquirer - extract what we can from the profile
        enq = createEnquirer({
          flatmates_url: convo.profileUrl,
          name: convo.memberName,
          full_name: convo.memberName,
          cultural_background: null,  // Will be extracted from description
          hobbies: null,
          age: null,
          work_study: null,
          property_enquired: houseCode,
          conversation_id: convId,
          photo_url: convo.photoUrl || null,
        });

        // Try to extract profile info from description/tags
        if (convo.description) {
          enq.cultural_background = convo.description.slice(0, 200) || null;
        }

        // Gender from genderAge blurb (fallback)
        const ga = (convo.genderAge || '').toLowerCase();
        if (ga.includes('female') || ga.includes('woman') || ga.includes('girl')) enq.gender = 'female';
        else if (ga.includes('male') || ga.includes('man') || ga.includes('boy')) enq.gender = 'male';

        // Scrape profile page for age, gender, phone
        if (convo.profileUrl) {
          const profileData = await scrapeProfile(null, convo.profileUrl);
          if (profileData.age) {
            enq.age = profileData.age;
            if (profileData.age > 40) {
              enq.priority = 'low';
              log(`Age ${profileData.age} > 40 - auto-set priority low for ${enq.name}`);
            }
          }
          if (profileData.gender && !enq.gender) enq.gender = profileData.gender;
          if (profileData.phone) enq.phone = profileData.phone;
          if (profileData.occupation && !enq.work_study) enq.work_study = profileData.occupation;
          if (profileData.aboutMe) {
            enq.about_me = profileData.aboutMe.slice(0, 500);
            // Extract extra profile info from About Me
            const fromAbout = extractProfileFromMessage(profileData.aboutMe);
            if (fromAbout.nationality && !enq.cultural_background) enq.cultural_background = fromAbout.nationality;
            if (fromAbout.work_study && !enq.work_study) enq.work_study = fromAbout.work_study;
            if (fromAbout.non_smoker) enq.non_smoker = true;
          }
        }

        // Couple detection from messages
        if (detectCoupleFromMessages(convo.messages)) {
          enq.couple = true;
          log(`Couple detected for ${enq.name}`);
        }

        // Move-in date
        enq.move_in_date = extractMoveInDate(convo);
        const bodyPhone = extractPhoneFromText((convo.messages || []).filter(m => !m.isOwn && !m.isSystem).map(m => m.text || '').join(' '));
        if (bodyPhone && !enq.phone && !enq.waNumber) enq.extractedPhone = bodyPhone;

        // Budget
        const budget = convo.features?.Budget || convo.features?.['Weekly budget'] || null;
        enq.budget = budget ? parseInt(budget.replace(/[^0-9]/g, '')) || null : null;

        if (convo._matchedRoom?.room) enq.room_preference = convo._matchedRoom.room;
        if (convo.photoUrl) enq.photo_url = convo.photoUrl;
        if (convo.lastActive) enq.lastActive = convo.lastActive;
        enquirers.push(enq);
        log(`New enquirer: ${enq.name} | convId: ${convId} | houseCode: ${houseCode || '?'} | room: ${enq.room_preference||'?'} | age:${enq.age} gender:${enq.gender} couple:${enq.couple}`);
      } else {
        // Update last seen + conv
        enq.last_message = new Date().toISOString().slice(0,10);
        if (convo.lastActive) enq.lastActive = convo.lastActive;
        enq.conversation_id = convId;
        if (houseCode && !enq.property_enquired) enq.property_enquired = houseCode;
        if (convo._matchedRoom?.room && !enq.room_preference) enq.room_preference = convo._matchedRoom.room;
        if (convo.photoUrl && !enq.photo_url) enq.photo_url = convo.photoUrl;
        // Backfill missing profile data
        if ((!enq.age || !enq.gender || !enq.phone) && convo.profileUrl) {
          const profileData = await scrapeProfile(null, convo.profileUrl);
          if (profileData.age && !enq.age) {
            enq.age = profileData.age;
            if (profileData.age > 40 && enq.priority !== 'low') {
              enq.priority = 'low';
              log(`Backfill: age ${profileData.age} > 40 - auto-set priority low for ${enq.name}`);
            }
          }
          if (profileData.gender && !enq.gender) enq.gender = profileData.gender;
          if (profileData.phone && !enq.phone) enq.phone = profileData.phone;
          if (profileData.occupation && !enq.work_study) enq.work_study = profileData.occupation;
        }
        // Couple detection on existing enquirers
        if (!enq.couple) {
          enq.couple = detectCoupleFromMessages(convo.messages);
        }
        const bodyPhone = extractPhoneFromText((convo.messages || []).filter(m => !m.isOwn && !m.isSystem).map(m => m.text || '').join(' '));
        if (bodyPhone && !enq.phone && !enq.waNumber) enq.extractedPhone = bodyPhone;
      }

      enq.lastMessageAt = (messages => { const last = [...messages].reverse().find(m => !m.isOwn && !m.isSystem); return last?.time || null; })(convo.messages || []);
      enq.hasFollowUp = /\b(hello\?|hi\?|just following up|follow up|following up|any update|still available\?|keen to inspect)\b/i.test((convo.messages || []).filter(m => !m.isOwn && !m.isSystem).map(m => m.text || '').join(' '));

      // Update profile completeness
      enq.profile_complete = isProfileComplete(enq);
      // Priority scoring (sort later)
      enq.priority = scorePriority(enq);

      // 3. Decide reply
      const decision = await decideReply(convo, enq, houseCode);

      if (decision) {
        // 3b. Refine draft with Ollama - reads full context, removes doubled questions
        const rooms = loadRooms();
        const room = rooms.find(r => r.houseCode === houseCode);
        if (decision.draft) {
          const originalDraft = decision.draft;
          decision.draft = await ollamaRefineDraft(decision.draft, convo, enq, room);
          if (decision.draft === originalDraft && decision.action !== 'waiting_for_info') {
            modelFailureStreak += 1;
            if (modelFailureStreak >= 3) {
              await pauseJess(`Gemini Flash and all Ollama fallbacks failed for ${modelFailureStreak} consecutive enquirers`, modelFailureStreak);
              break;
            }
          } else {
            modelFailureStreak = 0;
          }
        }

        // ─── Jess v4: reply gate + idempotency ──────────────────────────────────
        let _v4msgHash = null;
        try {
          const _v4gateDispatch = require('./modules/dispatch-queue');
          const _v4gateMetrics  = require('./modules/metrics');
          const _v4gateThreadId = String(convId || '');

          // Gate check
          try {
            const _v4gateResult = _v4gateDispatch.gate(_v4gateThreadId, convo);
            if (_v4gateResult === 'skip') {
              _v4gateMetrics.increment('gatedSkip');
              log(`[v4] Thread ${_v4gateThreadId} gated: skip — skipping draft`, 'DEBUG');
              continue; // skip to next thread
            }
            if (_v4gateResult === 'defer') {
              _v4gateMetrics.increment('gatedDefer');
              log(`[v4] Thread ${_v4gateThreadId} gated: defer — will retry next cycle`, 'DEBUG');
              continue; // skip to next thread
            }
            // gateResult === 'draft_now' — proceed normally
            _v4gateMetrics.increment('draftsCreated');
          } catch(_v4gateErr) {
            // v4 gating error — FALL BACK TO V3 behaviour (do not skip)
            log(`[v4] Gate check failed: ${_v4gateErr.message} — falling back to v3`, 'WARN');
          }

          // Idempotency check
          try {
            const _v4idState    = require('./modules/thread-state');
            const _v4idThreadSt = _v4idState.get(_v4gateThreadId);
            const _v4lastMsg    = [...(convo.messages || [])].reverse().find(m => !m.isOwn && !m.isSystem);
            _v4msgHash = require('crypto').createHash('md5')
              .update(String(_v4lastMsg?.text || '')).digest('hex').slice(0, 8);
            if (_v4idThreadSt && _v4idThreadSt.lastDraftedMessageHash === _v4msgHash) {
              _v4gateMetrics.increment('duplicatesBlocked');
              log(`[v4] Thread ${_v4gateThreadId} — duplicate draft blocked (hash ${_v4msgHash})`, 'DEBUG');
              continue;
            }
          } catch(_v4idErr) {
            log(`[v4] Idempotency check failed: ${_v4idErr.message}`, 'WARN');
          }
        } catch(_v4outerErr) {
          // entire v4 block failed — fall through to v3 behaviour
          log(`[v4] Activation block error: ${_v4outerErr.message} — falling back to v3`, 'WARN');
        }
        // ─── End Jess v4 gate ────────────────────────────────────────────────────

        // 18. Queue for approval
        // Get the last message FROM the enquirer (not own, not system)
        const lastEnquirerMsg = [...(convo.messages || [])].reverse().find(m => !m.isOwn && !m.isSystem);
        const queued = await queueForApproval({
          conversationId: convId,
          conversationUrl: url,
          enquirerId: enq.id,
          enquirerName: enq.name,
          houseCode,
          action: decision.action,
          draft: decision.draft,
          enquirerMessage: lastEnquirerMsg?.text || null,
        });
        if (queued) {
          replied++;
          // v4: update idempotency hash after successful draft creation
          try {
            if (_v4msgHash) {
              const _v4tsPost  = require('./modules/thread-state');
              const _v4convKey = String(convId || '');
              _v4tsPost.set(_v4convKey, { ..._v4tsPost.get(_v4convKey), lastDraftedMessageHash: _v4msgHash });
            }
          } catch {}
        }
      }

      // Save after each conversation (resilient)
      saveEnquirers(enquirers);

    } catch (e) {
      logError(`Error processing ${url}: ${e.message}`);
    }

    await new Promise(r => setTimeout(r, 1200));
  }

  log(`Poll cycle complete - ${replied} replies queued`);

  // ── Completion ping: summarise active leads per house and notify Diego ─────
  try {
    const allEnq   = loadEnquirers();
    const yesterday = new Date(Date.now() - 24*3600*1000);
    const activeEnq = allEnq.filter(e => {
      if (!e.houseCode) return false;
      if (e.status === 'rejected' || e.status === 'closed') return false;
      // Online at least yesterday
      const la = parseLastActive(e.lastActive || '');
      if (la) return la >= yesterday;
      // fallback: last_message date
      if (e.last_message) return new Date(e.last_message) >= yesterday;
      return false;
    });
    const byHouse = {};
    for (const e of activeEnq) byHouse[e.houseCode] = (byHouse[e.houseCode] || 0) + 1;
    const vacantHouses = ['CO1','EB2','EB3','SH1','SH2','SH3','SP9','WL4'];
    const lines = vacantHouses.map(h => `${h}: ${byHouse[h] || 0} active lead${(byHouse[h]||0)===1?'':'s'}`);
    if (Object.keys(byHouse).length > 0) {
      const msg = `🏠 *Jess scrape done*\nActive leads (online ≥ yesterday):\n${lines.join('\n')}`;
      httpJsonRequest(`https://api.telegram.org/bot${JESS_TG_TOKEN}/sendMessage`, 'POST', {
        chat_id: DIEGO_TG_CHAT_ID, text: msg, parse_mode: 'Markdown', disable_notification: true
      }, 8000).catch(() => {});
    }
  } catch(e) { logError(`Completion ping failed: ${e.message}`); }
}

/**
 * Process approved pending replies and actually send them.
 */
/** Check if we already sent a recent own message in this conversation (anti-spam guard) */
async function checkAlreadySent(_unused, convUrl, draft) {
  try {
    const threadId = parseThreadIdFromConversationUrl(convUrl) || convUrl.replace('relay://thread/', '');
    if (!threadId) return false;
    const thread = await fetchThread(threadId);
    const msgs = (thread?.messages || []).filter(m => m.isMine && m.text);
    if (!msgs.length) return false;
    const lastText = msgs[msgs.length - 1].text.toLowerCase();
    const preview = (draft || '').slice(0, 30).toLowerCase();
    return preview.length > 0 && lastText.includes(preview);
  } catch(e) {
    log(`checkAlreadySent failed for ${convUrl} - assuming not sent`);
    return false;
  }
}

// ─── Promise follow-up tracker ────────────────────────────────────────────────

/**
 * Parse a time promise from message text → return days until follow-up.
 * Returns null if no promise detected.
 */
function parsePromiseDays(text) {
  const t = (text || '').toLowerCase();
  if (/couple.{0,10}weeks?|2.{0,5}weeks?|fortnight/.test(t))  return 14;
  if (/few.{0,10}weeks?|3.{0,5}weeks?/.test(t))               return 21;
  if (/next.{0,5}week|1.{0,5}week/.test(t))                    return 7;
  if (/couple.{0,10}days?|2.{0,5}days?/.test(t))              return 2;
  if (/few.{0,10}days?/.test(t))                               return 4;
  if (/\bsoon\b|\bbe in touch\b|\bkeep.{0,10}posted\b|\breach out\b/.test(t)) return 7;
  if (/month/.test(t))                                          return 30;
  return null;
}

/**
 * After sending, check if the message contains a time promise.
 * If so, record a follow-up in jess-followup.json.
 */
function detectAndSchedulePromise(entry) {
  const text = entry.finalMessage || entry.draft || '';
  const days = parsePromiseDays(text);
  if (!days) return;

  const followups = loadFollowup();
  const threadId = entry.conversationUrl?.replace('relay://thread/', '') || entry.conversationId;
  // Avoid duplicates
  if (followups.find(f => f.type === 'promise' && f.threadId === threadId && !f.dismissed)) return;

  const followupDate = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  followups.push({
    type: 'promise',
    threadId,
    name: entry.enquirerName || '?',
    houseCode: entry.houseCode || '?',
    conversationUrl: entry.conversationUrl,
    promiseSentText: text.slice(0, 200),
    promiseDays: days,
    followupDate,
    scheduledAt: new Date().toISOString(),
    drafted: false,
    dismissed: false,
  });
  saveFollowup(followups);
  log(`[promise] Scheduled follow-up for ${entry.enquirerName} in ${days} days (${followupDate})`);
}

/**
 * Check promise follow-ups - when due, draft a re-engagement message for approval.
 */
async function handlePromiseFollowups() {
  const followups = loadFollowup();
  const today = new Date().toISOString().slice(0, 10);
  let changed = false;

  for (const fu of followups) {
    if (fu.type !== 'promise') continue;
    if (fu.dismissed || fu.drafted) continue;
    if (fu.followupDate > today) continue;

    // Time to follow up - draft a re-engagement
    const name = fu.name || 'there';
    const draft = `Hey ${name}! Just circling back as promised 😊 We may have something coming up that could be a great fit. Are you still looking for a room?`;

    try {
      await queueForApproval({
        conversationId: fu.threadId,
        conversationUrl: fu.conversationUrl,
        enquirerId: `promise_${fu.threadId}`,
        draft,
        houseCode: fu.houseCode,
        enquirerName: fu.name,
        action: 'promise_followup',
        enquirerMessage: `[Promise follow-up - sent ${fu.promiseDays}d ago: "${fu.promiseSentText?.slice(0, 100)}"]`,
      });
      fu.drafted = true;
      changed = true;
      log(`[promise] Drafted follow-up for ${fu.name} (${fu.houseCode})`);
    } catch (e) {
      logWarn(`[promise] Failed to draft for ${fu.name}: ${e.message}`);
    }
  }

  if (changed) saveFollowup(followups);
}

async function checkRelayHealthForSend() {
  try {
    const res = await fetch(`${RELAY_URL}/api/status`);
    const s = await res.json();
    // Only hard-block on extension disconnect after 3+ consecutive failures
    if (!s.extensionConnected && relayFailureStreak >= 2) {
      return { ok: false, reason: 'Chrome extension not connected' };
    }
    if (!s.extensionConnected) {
      log(`⚠️ checkRelayHealthForSend: extension not connected (streak ${relayFailureStreak + 1}) - allowing send (hard-block after 3 consecutive failures)`);
    }
    // null lastScrapeTime = relay freshly started, not a problem - allow through
    if (s.lastScrapeTime) {
      const staleMins = Math.round((Date.now() - new Date(s.lastScrapeTime).getTime()) / 60000);
      if (staleMins > 60) log(`⚠️ checkRelayHealthForSend: scrape data ${staleMins} min old - proceeding anyway`);
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: `Relay unreachable: ${e.message}` };
  }
}

async function sendApprovedReplies() {
  // ── Emergency stop gate ────────────────────────────────────────────────────
  const adminStateCheck = loadAdminState();
  if (adminStateCheck.emergencyStop) {
    log('[EMERGENCY STOP] sendApprovedReplies blocked — emergency stop is active');
    return;
  }

  const pending = loadPending();
  const toSend = pending.filter(p => (p.status === 'approved' && !p.sentAt) || p.status === 'send_failed');
  log(`[debug] sendApprovedReplies triggered, pending=${pending.length}, toSend=${toSend.length}`);
  if (toSend.length === 0) return;

  // ── Relay health gate - never send when relay is stale ─────────────────────
  const health = await checkRelayHealthForSend();
  if (!health.ok) {
    log(`🚫 SEND BLOCKED - relay unhealthy: ${health.reason}`);
    // Alert Diego if not alerted in last 30 min
    const alertKey = 'jess_relay_stale_alert';
    const lastAlert = global[alertKey] || 0;
    if (Date.now() - lastAlert > 30 * 60 * 1000) {
      global[alertKey] = Date.now();
      await sendTelegramMessage(DIEGO_TG_CHAT_ID,
        `⚠️ *Jess send blocked* - ${toSend.length} message(s) approved but NOT sent.\n\nReason: ${health.reason}\n\nAction needed: Open Flatmates in Chrome with the extension active, then messages will send automatically.`
      ).catch(() => {});
    }
    return;
  }

  // Gate sending during quiet hours (11:30pm-7:30am Brisbane)
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Australia/Brisbane' }));
  const mins = now.getHours() * 60 + now.getMinutes();
  const quietSend = mins >= (23 * 60 + 30) || mins < (7 * 60 + 30);
  if (quietSend) {
    log(`Quiet hours - ${toSend.length} approved replies held until 7:30am`);
    return;
  }

  log(`Sending ${toSend.length} approved replies...`);

  for (const entry of toSend) {
    try {
      // Normalise field names from atlas_inspection_blast format
      if (!entry.conversationUrl && entry.convUrl) entry.conversationUrl = entry.convUrl;
      if (!entry.finalMessage && !entry.draft && entry.message) entry.finalMessage = entry.message;
      if (!entry.enquirerName && entry.name) entry.enquirerName = entry.name;
      if (!entry.conversationUrl) continue;

      // Before sending, check if we already sent something recently (anti-spam guard)
      const alreadySent = await checkAlreadySent(null, entry.conversationUrl, entry.finalMessage || entry.draft);
      if (alreadySent) {
        log(`⚠️ Already sent to ${entry.enquirerName} - marking sent without resending`);
        entry.sentAt = new Date().toISOString();
        entry.status = 'sent';
        entry.notes = (entry.notes||'') + ' [auto-marked: message detected in thread]';
        continue;
      }

      const ok = await sendReplyToConversation(entry.conversationUrl, entry.finalMessage || entry.draft);
      if (ok) {
        // Post-send verification: wait 8s then re-check thread for our message
        await new Promise(r => setTimeout(r, 25000)); // 25s: extension poll (15s) + navigate + type + scrape
        const verified = await checkAlreadySent(null, entry.conversationUrl, entry.finalMessage || entry.draft);
        if (verified) {
          entry.sentAt = new Date().toISOString();
          entry.status = 'sent';
          log(`✅ Verified sent to ${entry.enquirerName}: [${entry.action}]`);
          detectAndSchedulePromise(entry);
          // ── v4: mark thread as replied ────────────────────────────────────
          try {
            const _v4ts4 = require('./modules/thread-state');
            const _v4tid = entry.conversationUrl?.replace('relay://thread/', '') || entry.conversationId || null;
            if (_v4tid) {
              const _v4st = _v4ts4.get(_v4tid) || {};
              _v4ts4.set(_v4tid, { ..._v4st, stage: 'replied', processedAt: Date.now(), needsReply: false });
            }
          } catch (_v4e) { /* non-fatal */ }
          // ── end v4 ──────────────────────────────────────────────────────
        } else {
          entry.status = 'send_failed';
          entry.sendFailedAt = new Date().toISOString();
          entry.sendFailReason = 'relay accepted but message not found in thread after 8s';
          logError(`❌ Send NOT confirmed for ${entry.enquirerName} - relay accepted but message absent from thread`);
          await sendTelegramMessage(DIEGO_TG_CHAT_ID,
            `⚠️ *Jess send unconfirmed* - message to *${entry.enquirerName}* (${entry.house || '?'}) was queued but NOT verified in Flatmates thread.\n\nStatus set to \`send_failed\` - will retry next cycle if Flatmates tab is open.`
          ).catch(() => {});
        }
      }
    } catch (e) {
      logError(`Failed to send reply for ${entry.enquirerName}: ${e.message}`);
    }
  }

  savePending(pending);
}

// ─── Live Listing Sync ────────────────────────────────────────────────────────

/**
 * Address → house code lookup table.
 * Keys are lowercase fragments; values are house codes.
 * Covers suburb names, street names, and known alternate addresses.
 * Used for fuzzy-matching Flatmates listing addresses to internal codes.
 */
const ADDRESS_TO_HOUSE_CODE = {
  // CO1 - 37 Marian St / 226 Old Cleveland Rd, Coorparoo
  'marian':      'CO1',
  'coorparoo':   'CO1',
  'old cleveland': 'CO1',
  // EB2 - 606 Vulture St / 450 Vulture St, Kangaroo Point
  'vulture':     'EB2',
  'kangaroo point': 'EB2',
  // SP9 - 50 Peninsular Dr / 6 Orchid Ave / 4/44 Watson Esplanade, Surfers Paradise
  'peninsular':  'SP9',
  'orchid':      'SP9',
  'watson':      'SP9',
  'surfers paradise': 'SP9',
  // BRIS1 - 79 Albert St / 600 Edward St, Brisbane City / CBD
  'albert st':   'BRIS1',
  'edward st':   'BRIS1',
  'brisbane city': 'BRIS1',
  'brisbane cbd': 'BRIS1',
};

/** House code → listing ID (for boost checks and direct listing access). */
const HOUSE_CODE_TO_LISTING_ID = {
  'CO1':   '1575743',
  'EB2':   '1549189',
  'SP9':   '1773878',
  'BRIS1': '1362277',
};

/** Known listing ID → house code overrides (ground truth from confirmed scrape). */
const LISTING_ID_TO_HOUSE_CODE = {
  '1575743': 'CO1',
  '1549189': 'EB2',
  '1773878': 'SP9',
  '1362277': 'BRIS1',
};

/**
 * Fuzzy-match a Flatmates address string to an internal house code.
 * Returns the code or null if no match found.
 */
function addressToHouseCode(addressText) {
  if (!addressText) return null;
  const lower = addressText.toLowerCase();
  for (const [fragment, code] of Object.entries(ADDRESS_TO_HOUSE_CODE)) {
    if (lower.includes(fragment)) return code;
  }
  return null;
}

/**
 * Extract listing ID from a Flatmates listing URL or card href.
 * e.g. "P1575743" or "/share-house-...-P1575743" → "1575743"
 */
function extractListingId(urlOrText) {
  if (!urlOrText) return null;
  const m = urlOrText.match(/P(\d{5,8})/i);
  return m ? m[1] : null;
}

async function scrapeMyAccountListings() {
  logWarn('[sync] scrapeMyAccountListings disabled in relay mode');
  return [];
}

/**
 * syncLiveListings() - Main entry point.
 *
 * 1. Scrapes /my-account for all listings + live/inactive status.
 * 2. For each LIVE listing, re-scrapes the listing page for current room prices.
 * 3. Updates jess-rooms.json: available flag, listingId, price.
 * 4. Logs a clear summary of what changed.
 *
 * Non-fatal: any error is logged as a warning, Jess continues normally.
 * Returns a summary object { live, inactive, changes } for logging.
 */

// ─── Boost Availability Checker ───────────────────────────────────────────────

/**
 * Check whether the Flatmates boost feature is available for a listing.
 * Navigates to the listing edit page and scrapes the boost panel.
 * Returns: { available: bool, statusText: string, availableFrom: string|null }
 */
async function checkBoostAvailability(houseCode) {
  const listingId = HOUSE_CODE_TO_LISTING_ID[houseCode.toUpperCase()];
  if (!listingId) return { available: false, statusText: `Unknown house code: ${houseCode}`, availableFrom: null };
  return {
    available: false,
    statusText: 'Boost check requires extension-side support (not exposed by relay yet)',
    availableFrom: null,
  };
}

// ─── Command Queue Processor ──────────────────────────────────────────────────

/**
 * Process commands written to data/jess-commands.json by MC or Atlas.
 * Commands: { id, cmd, args, status: 'pending'|'done'|'error', result, ts }
 * Supported: boost <HOUSE>
 */
async function processCommands() {
  if (!fs.existsSync(DATA.commands)) return;
  let cmds;
  try { cmds = JSON.parse(fs.readFileSync(DATA.commands, 'utf8')); } catch(_) { return; }
  if (!Array.isArray(cmds)) return;

  const pending = cmds.filter(c => c.status === 'pending');
  if (!pending.length) return;

  for (const cmd of pending) {
    log(`[cmd] Processing: ${cmd.cmd} ${JSON.stringify(cmd.args)}`);
    try {
      if (cmd.cmd === 'boost') {
        const house = (cmd.args?.house || '').toUpperCase();
        const result = await checkBoostAvailability(house);

        let msg;
        if (result.available) {
          msg = `✅ *Boost available now for ${house}!*\nGo boost it: https://flatmates.com.au/listing/${HOUSE_CODE_TO_LISTING_ID[house] || '?'}/boost`;
        } else {
          const fromStr = result.availableFrom ? `\n🗓 ${result.availableFrom}` : '';
          msg = `❌ *Boost unavailable for ${house}*\n${result.statusText}${fromStr}`;
        }

        sendTelegramMessage('1267601160', msg);
        cmd.status = 'done';
        cmd.result = result;
      } else {
        cmd.status = 'error';
        cmd.result = { error: `Unknown command: ${cmd.cmd}` };
      }
    } catch (e) {
      cmd.status = 'error';
      cmd.result = { error: e.message };
    }
    cmd.completedAt = new Date().toISOString();
  }

  try { fs.writeFileSync(DATA.commands, JSON.stringify(cmds, null, 2)); } catch(_) {}
}

// ─── Age filter utilities ─────────────────────────────────────────────────────

/**
 * Extract a numeric age from a lead's message text.
 * Looks for patterns like "I'm 25", "I am 30 years old", "25yo", "25 yo",
 * "25 y/o", "25 years", standalone "25" near "old" etc.
 * Returns a number or null if not found.
 */
function extractLeadAge(text) {
  if (!text || typeof text !== 'string') return null;
  const s = text.slice(0, 800); // only look at first ~800 chars

  const patterns = [
    /\bI(?:'m| am)\s+(\d{1,2})\s*(?:years?\s*old|yo|y\/o|yrs?\.?\s*old|yrs?)\b/i,
    /\b(\d{1,2})\s*(?:years?\s*old|yo|y\/o|yrs?\.?\s*old|yrs?)\b/i,
    /\baged?\s+(\d{1,2})\b/i,
    /\b(\d{1,2})\s*[-–]\s*year[-–]\s*old\b/i,
    /\bI(?:'m| am)\s+(\d{1,2})\s*,/i,   // e.g. "I'm 22," or "I am 30,"
    /\b(\d{1,2})\s*(?:year|yr)\b/i,
  ];

  for (const re of patterns) {
    const m = s.match(re);
    if (m) {
      const age = parseInt(m[1], 10);
      if (age >= 16 && age <= 99) return age;
    }
  }
  return null;
}

/**
 * Apply an age filter to an array of thread objects.
 * Only includes threads where age can be determined AND age < maxAge.
 * @param {Array} threads
 * @param {number} maxAge  - e.g. 40 for "age <40"
 * @returns {Array}
 */
function applyAgeFilter(threads, maxAge) {
  return threads.filter(t => {
    // Primary: selector-derived structured age from Flatmates profile keyFeatures panel.
    // This is a clean integer scraped directly from the DOM — no parsing ambiguity.
    if (t.profileAge != null) {
      return t.profileAge < maxAge;
    }

    // Fallback: parse age from inbound message text (less reliable — use only if
    // selector age unavailable, e.g. profile panel not visible during scrape).
    const text = [
      t.lastMessagePreview,
      t.snippet,
      t.lastMessage,
      ...(Array.isArray(t.messages)
        ? t.messages.filter(m => !(m.isMine || m.isOwn)).map(m => m.text || m.body || '')
        : []),
    ].filter(Boolean).join('\n');

    const age = extractLeadAge(text);
    if (age === null) return false; // unknown age → exclude
    return age < maxAge;
  });
}

// ─── /jess count — read-only lead counting scrape ────────────────────────────

/**
 * Classify each relay-inbox conversation thread as:
 *   new      = they messaged us, zero outbound messages from us
 *   pending  = last message is FROM them (ball is in our court)
 *   active   = last message is FROM us (we replied, waiting on them)
 *   dead     = no activity in 30+ days
 *
 * Uses jess-inbox.json (read-only) for message-direction data, and relay
 * inbox for last-active timing. Does NOT call processConversation.
 */
async function countLeads(chatId) {
  const COUNT_WINDOW_DAYS = 3;
  const DEAD_DAYS = 30;
  const RATE_LIMIT_MS = 3500;   // 3.5 s between thread fetches
  const MAX_RUNTIME_MS = 2 * 60 * 60 * 1000; // 2 hours
  const MUTEX_MAX_WAIT_MS = 5 * 60 * 1000;   // 5 minutes max wait
  const PROGRESS_EVERY = 20;

  // ── Mutex: wait if browser is busy ────────────────────────────────────────
  if (isBrowserBusy) {
    await sendTelegramMessage(chatId, '⏳ Jess is currently busy — count queued, will start when free').catch(() => {});
    const waitStart = Date.now();
    while (isBrowserBusy) {
      if (Date.now() - waitStart > MUTEX_MAX_WAIT_MS) {
        await sendTelegramMessage(chatId, '❌ Timed out waiting for Jess to become free (5 min). Count cancelled.').catch(() => {});
        return;
      }
      await new Promise(r => setTimeout(r, 5000));
    }
  }

  isBrowserBusy = true;
  const startedAt = Date.now();

  try {
  await sendTelegramMessage(chatId, '📊 Starting lead count (last 3 days)… this may take a while.').catch(() => {});

  // Load jess-inbox (read-only) for message-direction data
  const JESS_INBOX_FILE = path.join(DATA_DIR, 'jess-inbox.json');
  const jessInboxRaw = loadJSON(JESS_INBOX_FILE, []);
  const jessInbox = Array.isArray(jessInboxRaw) ? jessInboxRaw : (jessInboxRaw.conversations || []);

  // Build threadId → jess-inbox entry lookup (extract tid from convUrl)
  const tidToJessEntry = {};
  for (const je of jessInbox) {
    const m = String(je.convUrl || '').match(/\/messages\/(\d+)/);
    const tid = m ? m[1] : null;
    if (tid) tidToJessEntry[tid] = je;
  }

  // Trigger a fresh scrape before reading the inbox (bypasses extension hash-change detection)
  await requestScrape({ forceRefresh: true }).catch(() => {});
  await new Promise(r => setTimeout(r, 3500)); // allow extension time to scrape + POST to relay

  // Fetch relay inbox (live, no writes)
  let relayConvs;
  try {
    relayConvs = await fetchInbox();
  } catch (e) {
    await sendTelegramMessage(chatId, `❌ Could not fetch inbox: ${e.message}`).catch(() => {});
    return;
  }

  // Enrich conversations without houseCode before counting
  try {
    const _cntHM = require('./modules/house-matcher');
    const _cntRooms = loadRooms();
    const _cntTS = _cntHM.loadThreadStates();
    let _cntEnriched = 0;
    for (const _cntC of relayConvs) {
      if (!_cntC.houseCode || _cntC.houseCode === '?') {
        const _cntCode = _cntHM.matchHouseCode(_cntC, _cntRooms, _cntTS);
        if (_cntCode) { _cntC.houseCode = _cntCode; _cntEnriched++; }
      }
    }
    log(`[count/house-matcher] Enriched ${_cntEnriched}/${relayConvs.length} conversations`);
  } catch (_cntHMErr) {
    log('[count/house-matcher] non-fatal: ' + _cntHMErr.message);
  }

  // Filter to last 3 days
  const cutoffMs = Date.now() - COUNT_WINDOW_DAYS * 24 * 3600 * 1000;
  const threads = relayConvs.filter(c => {
    const la = parseLastActive(c.lastActive || '');
    return la ? la.getTime() >= cutoffMs : (c.unread || c.isUnread);
  });

  const total = threads.length;
  await sendTelegramMessage(chatId, `📋 Found ${total} threads in the last 3 days. Counting…`).catch(() => {});

  const rooms = loadRooms();

  // Per-house tallies:  { new, pending, active, dead } + thread id tracking for debug
  const houseTally = {};
  let hotCount = 0; // pending threads active online today/now
  function tally(houseCode, status, threadId) {
    const k = (houseCode || 'UNKNOWN').toUpperCase();
    if (!houseTally[k]) houseTally[k] = { new: 0, pending: 0, active: 0, dead: 0, _ids: { new: [], pending: [], active: [], dead: [] } };
    if (houseTally[k][status] !== undefined) {
      houseTally[k][status]++;
      if (threadId) houseTally[k]._ids[status].push(threadId);
    }
  }

  for (let i = 0; i < threads.length; i++) {
    if (Date.now() - startedAt > MAX_RUNTIME_MS) {
      await sendTelegramMessage(chatId, `⏱ Count stopped after 2 hours (processed ${i}/${total}).`).catch(() => {});
      break;
    }

    const c = threads[i];
    const threadId = String(c.threadId || '');

    // ── Classify dead: 30+ days inactive ────────────────────────────────────
    const la = parseLastActive(c.lastActive || '');
    const ageDays = la ? (Date.now() - la.getTime()) / (1000 * 3600 * 24) : null;
    if (ageDays !== null && ageDays >= DEAD_DAYS) {
      // Determine house from jess-inbox then classify as dead
      const je = tidToJessEntry[threadId];
      const houseCode = je?.houseCode || identifyHouseCodeFromConv(c, rooms);
      tally(houseCode, 'dead', threadId);
      if ((i + 1) % PROGRESS_EVERY === 0) {
        await sendTelegramMessage(chatId, `Counted ${i + 1}/${total} threads…`).catch(() => {});
      }
      continue;
    }

    // ── Determine house ──────────────────────────────────────────────────────
    const je = tidToJessEntry[threadId];
    let houseCode = je?.houseCode || null;
    if (!houseCode) {
      houseCode = identifyHouseCodeFromConv(c, rooms);
    }
    // Persist houseCode + fresh lastActive to thread-states so campaign path can reuse it
    // Always update lastActive/updatedAt so stale cached values don't persist
    if (houseCode && threadId) {
      try {
        const _cntTSPath = path.join(__dirname, 'data', 'jess-thread-states.json');
        const _cntTS = loadJSON(_cntTSPath, {});
        const _existing = _cntTS[threadId] || {};
        _cntTS[threadId] = {
          ..._existing,
          houseCode,
          updatedAt: c.updatedAt || _existing.updatedAt,
          lastActive: c.lastActive || _existing.lastActive,
          snippet: (c.snippet||'').slice(0,100),
        };
        saveJSON(_cntTSPath, _cntTS);
      } catch (_tsErr) { /* non-fatal */ }
    }

    // ── Determine message direction ──────────────────────────────────────────
    // Priority: jess-inbox messageHistory → relay snippet/unread heuristic
    let lastFrom = null; // 'lead' | 'jess' | null
    let outboundCount = 0;

    if (je && Array.isArray(je.messageHistory) && je.messageHistory.length > 0) {
      const msgs = je.messageHistory;
      lastFrom = msgs[msgs.length - 1].from || null; // 'lead' or 'jess'
      outboundCount = msgs.filter(m => m.from === 'jess').length;
    } else {
      // Fallback: try fetchThread (rate-limited); otherwise use inbox unread flag
      try {
        const thread = await fetchThread(threadId);
        if (thread && Array.isArray(thread.messages) && thread.messages.length > 0) {
          const msgs = thread.messages;
          const last = msgs[msgs.length - 1];
          lastFrom = last.isMine ? 'jess' : 'lead';
          outboundCount = msgs.filter(m => m.isMine).length;
        }
        await new Promise(r => setTimeout(r, RATE_LIMIT_MS));
      } catch (_) {
        // Can't determine direction — treat as pending (conservative)
        lastFrom = c.unread || c.isUnread ? 'lead' : null;
        outboundCount = 0;
      }
    }

    // ── Classify ─────────────────────────────────────────────────────────────
    let status;
    if (lastFrom === 'jess') {
      status = 'active';
    } else if (lastFrom === 'lead' && outboundCount === 0) {
      status = 'new';
    } else if (lastFrom === 'lead') {
      status = 'pending';
    } else {
      // Unknown direction: if unread treat as new, else pending
      status = (c.unread || c.isUnread) ? 'new' : 'pending';
    }

    tally(houseCode, status, threadId);

    // Track hot leads: pending + online today/now
    if (status === 'pending') {
      const laStr = (c.lastActive || '').toLowerCase();
      if (laStr.includes('online today') || laStr.includes('active today') || laStr.includes('online now')) {
        hotCount++;
      }
    }

    // Progress ping every N threads
    if ((i + 1) % PROGRESS_EVERY === 0) {
      await sendTelegramMessage(chatId, `Counted ${i + 1}/${total} threads…`).catch(() => {});
    }
  }

  // ── Build report ──────────────────────────────────────────────────────────
  let grandNew = 0, grandPending = 0, grandActive = 0, grandDead = 0;

  // ── Debug: log per-house thread id breakdown to identify any reconciliation gaps ──
  // Total = New + Unanswered + Answered + Dead (all from the same 3-day window)
  for (const [house, t] of Object.entries(houseTally)) {
    const ids = t._ids || {};
    const allBucketIds = [
      ...(ids.new || []),
      ...(ids.pending || []),
      ...(ids.active || []),
      ...(ids.dead || []),
    ];
    const uniqueBucketIds = [...new Set(allBucketIds)];
    const duplicates = allBucketIds.length !== uniqueBucketIds.length
      ? allBucketIds.filter((id, i) => allBucketIds.indexOf(id) !== i)
      : [];
    const tot = t.new + t.pending + t.active + t.dead;
    log(`[count/debug] ${house}: New=${t.new}[${(ids.new||[]).join(',')}] Unanswered=${t.pending}[${(ids.pending||[]).join(',')}] Answered=${t.active}[${(ids.active||[]).join(',')}] Dead=${t.dead}[${(ids.dead||[]).join(',')}] Total=${tot} duplicates=${duplicates.length > 0 ? duplicates.join(',') : 'none'}`);
  }

  // Compute totals and filter/sort houses
  // RECONCILIATION RULE: Total = New + Unanswered + Answered + Dead (same 3-day dataset, no hidden sources)
  const houseEntries = Object.entries(houseTally)
    .map(([house, t]) => {
      const tot = t.new + t.pending + t.active + t.dead;  // Total reconciles exactly with buckets
      const active = t.new + t.pending + t.active;
      return { house, t, tot, active };
    })
    .filter(e => e.active > 0) // skip fully dead/empty houses
    .sort((a, b) => b.tot - a.tot); // busiest first by total

  // Accumulate grand totals (all houses including dead-only)
  for (const t of Object.values(houseTally)) {
    grandNew += t.new;
    grandPending += t.pending;
    grandActive += t.active;
    grandDead += t.dead;
  }

  // Format date: DD Mon YYYY
  const now = new Date();
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const dateStr = `${String(now.getDate()).padStart(2,'0')} ${MONTHS[now.getMonth()]} ${now.getFullYear()}`;

  const lines = [`📊 *Lead Count — ${dateStr}*`, ''];
  for (const { house, t, tot } of houseEntries) {
    lines.push(`🏠 *${house}*`);
    lines.push(`  🆕 New: ${t.new}  🔄 Unanswered: ${t.pending}  💬 Answered: ${t.active}  💀 Dead: ${t.dead}  📊 Total: ${tot}`);
    lines.push('');
  }
  lines.push(`📊 *TOTAL*`);
  lines.push(`  🆕 New: ${grandNew}  🔄 Unanswered: ${grandPending}  💬 Answered: ${grandActive}  💀 Dead: ${grandDead}`);
  lines.push(`  🔥 Hot (unanswered + online today): ${hotCount}`);

  await sendTelegramMessage(chatId, lines.join('\n'), { parse_mode: 'Markdown' }).catch(() => {});
  } finally {
    isBrowserBusy = false;
  }
}

/**
 * Lightweight house-code resolver for inbox-only data (no full conversation object).
 * Tries listing URL match first, then falls back to houseCode/propertyCode fields.
 */
function identifyHouseCodeFromConv(c, rooms) {
  if (!rooms) rooms = loadRooms();
  // Check direct houseCode / propertyCode field
  const hc = (c.houseCode || c.propertyCode || '').toUpperCase();
  if (hc) {
    const match = rooms.find(r => r.houseCode && r.houseCode.toUpperCase() === hc);
    if (match) return match.houseCode;
  }
  // ── Priority: match by listingId field (most reliable — set when thread is deep-scraped) ──
  // Handles the case where inbox conv objects carry no listing URL but thread files do.
  if (c.listingId) {
    const lid = String(c.listingId).replace(/^P/i, '').trim();
    const byListingId = rooms.find(r =>
      (r.listingId && String(r.listingId).trim() === lid) ||
      (r.listing_url && r.listing_url.includes(`-P${lid}`))
    );
    if (byListingId) return byListingId.houseCode;
  }
  // Try listing URL match
  const url = c.href || c.threadUrl || c.listingUrl || '';
  for (const r of rooms) {
    if (!r.listing_url) continue;
    const rPath = r.listing_url.split('flatmates.com.au')[1];
    if (rPath && url.includes(rPath)) return r.houseCode;
    const pidM = r.listing_url.match(/P(\d{5,})/);
    if (pidM && url.includes(pidM[0])) return r.houseCode;
  }
  return null;
}

function mergeThreadIntoConversation(conv = {}, thread = null) {
  if (!thread || typeof thread !== 'object') return { ...(conv || {}) };
  const merged = { ...(conv || {}) };
  const messages = Array.isArray(thread.messages) ? thread.messages : [];
  const lastMsg = messages.length ? messages[messages.length - 1] : null;
  // Prefer the NEWER updatedAt — never let a stale thread-file timestamp clobber a fresh inbox timestamp
  const convUpdatedMs   = Date.parse(merged.updatedAt  || 0) || 0;
  const threadUpdatedMs = Date.parse(thread.updatedAt  || 0) || 0;
  if (threadUpdatedMs > convUpdatedMs) merged.updatedAt = thread.updatedAt;
  // Prefer thread's lastActive when it is actually populated — but never erase a non-empty value
  // with an empty/? one. If the thread has '?' or empty, keep conv's value.
  const threadLA = String(thread.lastActive || '').trim();
  const convLA   = String(merged.lastActive  || '').trim();
  if (threadLA && threadLA !== '?') merged.lastActive = threadLA;
  else if (convLA) {} // keep existing
  if (thread.listingId && !merged.listingId) merged.listingId = thread.listingId;
  if (thread.listingUrl && !merged.listingUrl) merged.listingUrl = thread.listingUrl;
  if (thread.subjectHref && !merged.subjectHref) merged.subjectHref = thread.subjectHref;
  if (thread.subjectText && !merged.subjectText) merged.subjectText = thread.subjectText;
  if (thread.name && !merged.name) merged.name = thread.name;
  // Selector-based structured age — prefer most-recently-seen non-null value
  if (thread.profileAge != null) merged.profileAge = thread.profileAge;
  // Propagate inactive flag — once true, stays true (person left platform)
  if (thread.isThreadInactive === true) merged.isThreadInactive = true;
  // Persist raw messages for latest-message timestamp ordering
  if (messages.length) merged.messages = messages;
  if (lastMsg) {
    const preview = String(lastMsg.text || lastMsg.body || lastMsg.message || '').trim();
    if (preview) merged.snippet = preview;
    merged.lastFrom = (lastMsg.isMine || lastMsg.isOwn) ? 'jess' : 'lead';
  }
  return merged;
}

async function buildCampaignInboxForHouse(houseCode, { fresh = false } = {}) {
  const campaignHouse = String(houseCode || '').toUpperCase().trim();
  const rooms = loadRooms();
  log(`[buildCampaignInboxForHouse] house=${campaignHouse} fresh=${fresh}`);

  if (fresh) {
    log(`[buildCampaignInboxForHouse/${campaignHouse}] requesting scrape (forceRefresh+countMode)`);
    try {
      await requestScrape({ forceRefresh: true, countMode: true });
    } catch (scrapeErr) {
      logWarn(`[buildCampaignInboxForHouse/${campaignHouse}] requestScrape failed (non-fatal): ${scrapeErr.message}`);
    }
    log(`[buildCampaignInboxForHouse/${campaignHouse}] waiting 3.5s for extension to scrape`);
    await new Promise(r => setTimeout(r, 3500));
  }

  log(`[buildCampaignInboxForHouse/${campaignHouse}] calling fetchInbox`);
  let campInbox = await fetchInbox();
  log(`[buildCampaignInboxForHouse/${campaignHouse}] fetchInbox returned ${campInbox.length} conversations`);
  const source = fresh ? 'fresh-fetch' : 'cache';

  const threadStatesPath = path.join(__dirname, 'data', 'jess-thread-states.json');
  const threadStates = loadJSON(threadStatesPath, {});
  const byThreadId = new Map();
  for (const conv of campInbox) {
    const threadId = String(conv.threadId || '');
    if (!threadId) continue;
    byThreadId.set(threadId, conv);
  }

  for (const conv of campInbox) {
    const threadId = String(conv.threadId || '');
    const state = threadId ? threadStates[threadId] : null;
    if (state?.houseCode) {
      conv.houseCode = state.houseCode;
      if (state.lastActive && (!conv.lastActive || conv.lastActive === '')) conv.lastActive = state.lastActive;
      if (state.updatedAt && !conv.updatedAt) conv.updatedAt = state.updatedAt;
    }
    if (!conv.houseCode || conv.houseCode === '?' || conv.houseCode === 'UNKNOWN') {
      const inferred = identifyHouseCodeFromConv(conv, rooms);
      if (inferred) conv.houseCode = inferred;
    }
  }

  const filteredInbox = campaignHouse
    ? campInbox.filter(conv => String(conv.houseCode || '').toUpperCase().trim() === campaignHouse)
    : campInbox.slice();

  log(`[buildCampaignInboxForHouse/${campaignHouse}] filteredInbox (house match): ${filteredInbox.length} of ${campInbox.length} conversations match house=${campaignHouse}`);

  if (!fresh) return { inbox: filteredInbox, source, totalThreadsFound: filteredInbox.length, newlyActiveThreads: 0, lifecycleThreadIds: null, allLifecycleThreadIds: null };

  let pool = [];
  try {
    log(`[buildCampaignInboxForHouse/${campaignHouse}] calling fetchThreads`);
    pool = await fetchThreads();
    log(`[buildCampaignInboxForHouse/${campaignHouse}] fetchThreads returned ${pool.length} threads`);
  } catch (fetchThreadsErr) {
    logWarn(`[buildCampaignInboxForHouse/${campaignHouse}] fetchThreads failed (non-fatal): ${fetchThreadsErr.message}`);
    pool = [];
  }

  const freshHouseThreads = [];
  const seen = new Set();
  let _poolListingMatchCount = 0;
  let _poolTotalForHouse = 0;
  for (const thread of pool) {
    const threadId = String(thread.threadId || '');
    if (!threadId || seen.has(threadId)) continue;
    let conv = mergeThreadIntoConversation(byThreadId.get(threadId), thread);
    const state = threadStates[threadId] || null;
    if (state?.houseCode && !conv.houseCode) conv.houseCode = state.houseCode;
    const _beforeInfer = conv.houseCode;
    if (!conv.houseCode || conv.houseCode === '?' || conv.houseCode === 'UNKNOWN') {
      const inferred = identifyHouseCodeFromConv(conv, rooms);
      if (inferred) { conv.houseCode = inferred; if (thread.listingId) _poolListingMatchCount++; }
    }
    const _matchedHouse = String(conv.houseCode || '').toUpperCase().trim();
    if (campaignHouse && _matchedHouse === campaignHouse) _poolTotalForHouse++;
    if (!campaignHouse || _matchedHouse === campaignHouse) {
      freshHouseThreads.push(conv);
      seen.add(threadId);
    }
  }
  log(`[buildCampaignInboxForHouse/${campaignHouse}] pool scan: ${pool.length} threads checked, ${_poolTotalForHouse} matched house=${campaignHouse} (listingId-matched: ${_poolListingMatchCount})`);

  for (const conv of filteredInbox) {
    const threadId = String(conv.threadId || '');
    if (!threadId || seen.has(threadId)) continue;
    freshHouseThreads.push(conv);
    seen.add(threadId);
  }

  let newlyActiveThreads = 0;
  for (const conv of freshHouseThreads) {
    const threadId = String(conv.threadId || '');
    if (!threadId) continue;
    const before = byThreadId.get(threadId) || {};
    const beforeUpdated = Date.parse(before.updatedAt || 0) || 0;
    const afterUpdated = Date.parse(conv.updatedAt || conv.lastActive || 0) || 0;
    const beforeLastFrom = String(before.lastFrom || '').toLowerCase();
    const afterLastFrom = String(conv.lastFrom || '').toLowerCase();
    if (afterUpdated > beforeUpdated || (afterLastFrom === 'lead' && beforeLastFrom !== 'lead')) {
      newlyActiveThreads += 1;
    }
  }

  const refreshTargets = freshHouseThreads.filter(conv => conv.threadId).sort((a, b) => {
    const aMs = Date.parse(a.updatedAt || a.lastActive || 0) || 0;
    const bMs = Date.parse(b.updatedAt || b.lastActive || 0) || 0;
    return bMs - aMs;
  });

  for (const conv of refreshTargets) {
    const threadId = String(conv.threadId || '');
    if (!threadId) continue;
    try {
      const thread = await fetchThread(threadId);
      const refreshed = mergeThreadIntoConversation(conv, thread);
      if (!refreshed.houseCode || refreshed.houseCode === '?' || refreshed.houseCode === 'UNKNOWN') {
        const inferred = identifyHouseCodeFromConv(refreshed, rooms);
        if (inferred) refreshed.houseCode = inferred;
      }
      Object.assign(conv, refreshed);
    } catch (err) {
      logWarn(`[count/${campaignHouse || 'all'}] fetchThread ${threadId} failed: ${err.message}`);
    }

    // ── Thread-state fallback: inject latestInboundTimestamp when messages are absent ──
    // If relay returned no messages for this thread, freshInboundAfterOutbound would be
    // computed as false even if /jess refresh stored a fresh latestInboundTimestamp.
    // Inject it as a synthetic inbound marker so classification reflects refresh reality.
    const _tsFallback = threadStates[String(conv.threadId || '')] || {};
    if (!Array.isArray(conv.messages) || conv.messages.length === 0) {
      const _latestIn = _tsFallback.latestInboundTimestamp || null;
      const _latestOut = _tsFallback.latestOutboundTimestamp || null;
      if (_latestIn) {
        // Synthesize minimal message array so freshInboundAfterOutbound can be computed
        conv._syntheticMessages = true;
        conv.messages = [
          ...(_latestOut ? [{ isMine: true, sentAt: _latestOut, text: '', _synthetic: true }] : []),
          { isMine: false, sentAt: _latestIn, text: _tsFallback.latestInboundSnippet || '', _synthetic: true },
        ];
        log(`[buildCampaignInboxForHouse/${campaignHouse}] thread ${conv.threadId}: no relay messages — injected synthetic msgs from thread-state (latestInbound=${_latestIn})`);
      }
    }
  }

  // ── Fresh-inbound re-evaluation pass ─────────────────────────────────────
  // After all thread refreshes, run the inbound-relevance layer.
  // This computes lifecycleHouse / currentInboundRelevance / latestInboundTimestamp
  // WITHOUT touching the lifecycle count base (houseCode field is left unchanged).
  try {
    const inboundRelevance = require('./modules/inbound-relevance');
    inboundRelevance.enrichThreadsWithInboundRelevance(freshHouseThreads, threadStates, rooms);
    const crossHouseCount = freshHouseThreads.filter(t => t.crossHouseFresh).length;
    if (crossHouseCount > 0) {
      log(`[buildCampaignInboxForHouse/${campaignHouse}] inbound-relevance: ${crossHouseCount} thread(s) have cross-house fresh inbound`, 'INFO');
      for (const t of freshHouseThreads.filter(t => t.crossHouseFresh)) {
        log(
          `[inbound-relevance/cross-house] threadId=${t.threadId} name="${(t.name||'?').slice(0,25)}"` +
          ` lifecycleHouse=${t.lifecycleHouse} currentInboundRelevance=${t.currentInboundRelevance}` +
          ` source=${t.relevanceSource}` +
          ` snippet="${(t.latestInboundSnippet||'').slice(0,80)}"`,
          'INFO'
        );
      }
    }

    // ── Cross-house sweep: find other-house leads whose fresh snippet points HERE ──────
    // A lead may be lifecycle-assigned to GS1 but their latest message mentions Coorparoo.
    // If that snippet match is strong (suburb/street/listingId), surface them for the CO1 campaign.
    // We scan the full inbox (all houses) using just conv.snippet (no extra fetchThread calls).
    // Threads already in freshHouseThreads are skipped.
    if (campaignHouse && fresh) {
      const _matchers = inboundRelevance.buildSnippetMatchers(rooms);
      const _seenInFresh = new Set(freshHouseThreads.map(t => String(t.threadId || '')));
      const _STRONG_MATCH_TYPES = new Set(['suburb', 'streetAddress', 'listingId', 'houseCode']);
      const _crossCandidates = [];

      for (const _xConv of campInbox) {
        const _xTid = String(_xConv.threadId || '');
        if (!_xTid || _seenInFresh.has(_xTid)) continue;
        // Only consider threads from other lifecycle houses with a fresh snippet signal
        const _xSnippet = String(_xConv.snippet || _xConv.lastMessagePreview || '');
        if (!_xSnippet) continue;
        const _xMatch = inboundRelevance.matchSnippetToHouse(_xSnippet, _matchers);
        if (_xMatch && _xMatch.houseCode === campaignHouse && _STRONG_MATCH_TYPES.has(_xMatch.matchType)) {
          _crossCandidates.push({ conv: _xConv, match: _xMatch });
        }
      }

      if (_crossCandidates.length > 0) {
        log(`[buildCampaignInboxForHouse/${campaignHouse}] cross-house snippet sweep: ${_crossCandidates.length} candidate(s) found`, 'INFO');
        for (const { conv: _xConv, match: _xMatch } of _crossCandidates) {
          const _xTid = String(_xConv.threadId || '');
          try {
            // Fetch full thread to get messages + timestamps
            const _xThread = await fetchThread(_xTid).catch(() => null);
            const _xMerged = _xThread ? mergeThreadIntoConversation(_xConv, _xThread) : { ..._xConv };
            const _xLifecycle = String(threadStates[_xTid]?.houseCode || _xConv.houseCode || '?').toUpperCase().trim();
            // Do not overwrite houseCode — lifecycle integrity
            const _xIRFields = inboundRelevance.computeInboundRelevance(_xMerged, _xLifecycle, rooms, _matchers);

            // Only include if snippet match is authoritative (snippet > href fallback)
            // and fresh inbound after outbound confirms this is a real new signal
            const _xIsSnippetMatch = _xIRFields.relevanceSource.startsWith('inbound-snippet') || _xIRFields.relevanceSource.startsWith('snippet_match');
            if (
              _xIRFields.currentInboundRelevance === campaignHouse &&
              _xIsSnippetMatch &&
              _xIRFields.freshInboundAfterOutbound
            ) {
              Object.assign(_xMerged, _xIRFields);
              _xMerged._crossHouseSweep = true;
              _xMerged._crossHouseSweepFor = campaignHouse;
              freshHouseThreads.push(_xMerged);
              _seenInFresh.add(_xTid);
              log(
                `[inbound-relevance/cross-sweep] ADDED threadId=${_xTid} name="${(_xMerged.name||'?').slice(0,25)}"` +
                ` lifecycle=${_xLifecycle} → inbound→${campaignHouse}` +
                ` source=${_xIRFields.relevanceSource} snippet="${(_xIRFields.latestInboundSnippet||'').slice(0,80)}"`,
                'INFO'
              );
            } else {
              log(
                `[inbound-relevance/cross-sweep] SKIPPED threadId=${_xTid} name="${(_xMerged.name||'?').slice(0,25)}"` +
                ` cir=${_xIRFields.currentInboundRelevance} source=${_xIRFields.relevanceSource} fresh=${_xIRFields.freshInboundAfterOutbound}`,
                'INFO'
              );
            }
          } catch (_xErr) {
            logWarn(`[inbound-relevance/cross-sweep] fetchThread ${_xTid} failed: ${_xErr.message}`);
          }
        }
      }
    }
  } catch (_irErr) {
    logWarn(`[buildCampaignInboxForHouse/${campaignHouse}] inbound-relevance enrichment failed (non-fatal): ${_irErr.message}`);
  }

  // ── Consistency enforcement: operational pool must be a SUBSET of lifecycle house threads ──
  // The lifecycle source of truth is jess-thread-states.json — a thread is assigned to a house
  // if and only if threadStates[threadId].houseCode === campaignHouse.
  // Threads inferred via fresh href/listingId matching but not yet persisted in thread-states
  // must NOT enter the operational pool, as this would create a superset of lifecycle.
  let lifecycleThreadIds = null;
  // leadCountThreadIds: threads from the relay inbox (3-day window) that match this house.
  // This EXACTLY mirrors what Lead Count (/jess count) shows for this house — so that
  // the lifecycle total in /jess count <house> matches Lead Count's total.
  let leadCountThreadIds = null;
  if (campaignHouse) {
    const _allLifecycleIds = new Set(
      Object.entries(threadStates)
        .filter(([, s]) => String(s.houseCode || '').toUpperCase().trim() === campaignHouse)
        .map(([id]) => id)
    );
    lifecycleThreadIds = _allLifecycleIds;

    // Compute leadCountThreadIds: relay inbox threads that match this house,
    // using the same 3-day window filter that Lead Count uses.
    // This ensures /jess count <house> lifecycle total == Lead Count total for this house.
    const _leadCountCutoffMs = Date.now() - 3 * 24 * 60 * 60 * 1000;
    const _inboxForLeadCount = campInbox; // same fetchInbox() result already in scope
    const _leadCountMatchIds = new Set();
    for (const _c of _inboxForLeadCount) {
      const _tid = String(_c.threadId || '');
      if (!_tid) continue;
      // Apply the same 3-day window filter Lead Count uses
      const _la = parseLastActive(_c.lastActive || '');
      const _inWindow = _la ? _la.getTime() >= _leadCountCutoffMs : (_c.unread || _c.isUnread);
      if (!_inWindow) continue;
      // House must match (already enriched from threadStates above)
      const _hc = String(_c.houseCode || '').toUpperCase().trim();
      if (_hc === campaignHouse) _leadCountMatchIds.add(_tid);
    }
    leadCountThreadIds = _leadCountMatchIds;

    // Debug: log threads in lifecycle but not in lead-count window (stale/outside 3-day window)
    const _staleLcIds = [..._allLifecycleIds].filter(id => !_leadCountMatchIds.has(id));
    if (_staleLcIds.length > 0) {
      log(
        `[buildCampaignInboxForHouse/${campaignHouse}] LEAD-COUNT-MISMATCH: ${_staleLcIds.length} lifecycle thread(s) NOT in 3-day relay window ` +
        `(lifecycle=${_allLifecycleIds.size} leadCount=${_leadCountMatchIds.size}): ` +
        _staleLcIds.map(id => {
          const _c = _inboxForLeadCount.find(c => String(c.threadId) === id);
          return `${id}(${(_c?.name || '?').slice(0, 20)},lastActive=${_c?.lastActive || 'N/A'})`;
        }).join(', ')
      );
    }
    log(
      `[buildCampaignInboxForHouse/${campaignHouse}] lifecycle-vs-leadCount: ` +
      `allLifecycle=${_allLifecycleIds.size} leadCountWindow=${_leadCountMatchIds.size} ` +
      `(these should match Lead Count total for ${campaignHouse})`
    );

    const beforeCount = freshHouseThreads.length;
    const extraInOperational = freshHouseThreads.filter(c => {
      const tid = String(c.threadId || '');
      return tid && !lifecycleThreadIds.has(tid);
    });
    if (extraInOperational.length > 0) {
      logWarn(
        `[buildCampaignInboxForHouse/${campaignHouse}] CONSISTENCY: dropping ${extraInOperational.length} thread(s) not in lifecycle — ` +
        extraInOperational.map(c => `${c.threadId}(${(c.name || '?').slice(0, 20)})`).join(', ')
      );
      // Remove extra threads — keep only threads present in lifecycle assignment
      const toRemove = new Set(extraInOperational.map(c => String(c.threadId || '')));
      for (let i = freshHouseThreads.length - 1; i >= 0; i--) {
        const tid = String(freshHouseThreads[i].threadId || '');
        if (tid && toRemove.has(tid)) freshHouseThreads.splice(i, 1);
      }
    }
    log(`[buildCampaignInboxForHouse/${campaignHouse}] lifecycle gate: before=${beforeCount} after=${freshHouseThreads.length} lifecycleSize=${lifecycleThreadIds.size}`);
  }

  log(`[buildCampaignInboxForHouse/${campaignHouse}] returning freshHouseThreads=${freshHouseThreads.length} newlyActive=${newlyActiveThreads}`);
  return {
    inbox: freshHouseThreads,
    source,
    totalThreadsFound: freshHouseThreads.length,
    newlyActiveThreads,
    // leadCountThreadIds: threads visible in the 3-day relay window for this house.
    // This MATCHES Lead Count's total — use this as the lifecycle total in /jess count <house>.
    lifecycleThreadIds: leadCountThreadIds ? [...leadCountThreadIds] : (lifecycleThreadIds ? [...lifecycleThreadIds] : null),
    // allLifecycleThreadIds: all jess-thread-states entries for this house (includes stale/old)
    allLifecycleThreadIds: lifecycleThreadIds ? [...lifecycleThreadIds] : null,
  };
}

async function getCampaignEligibilitySummary(houseCode, campaignId, options = {}) {
  const { classifyThreads } = require('./modules/thread-classifier');
  const house = String(houseCode || '').toUpperCase().trim();
  const forceOverride = !!options.forceOverride;
  log(`[getCampaignEligibilitySummary] house=${house} campaignId=${campaignId} forceOverride=${forceOverride}`);

  const freshOptions = { ...options, fresh: true };
  const { inbox, source, totalThreadsFound, newlyActiveThreads, lifecycleThreadIds, allLifecycleThreadIds } = await buildCampaignInboxForHouse(house, freshOptions);
  const report = await classifyThreads({ houseCode: house, inbox, campaignId, forceOverride, lifecycleThreadIds });

  return {
    house,
    inbox,
    eligible: report.classified.map(c => c.thread),
    safeThreads: report.sendable.map(c => c.thread),
    eligibleCount: report.classified.length,
    safeCount: report.sendableCount,
    matchedThreads: report.matchedThreads,
    blockedCount: report.blockedCount,
    excludedCount: report.excludedCount,
    reasonCounts: report.reasonCounts,
    totalThreadsFound,
    newlyActiveThreads,
    source,
    rcBuckets: {},
    rcReasons: Object.fromEntries(report.classified.map(c => [c.threadId, c.finalReason])),
    inspectionDate: report.campaignContext?.inspectionDate || null,
    forceOverride,
    lifecycleThreadIds: lifecycleThreadIds || report.lifecycle.threadIds,
    allLifecycleThreadIds: allLifecycleThreadIds || report.lifecycle.threadIds,
    operationalThreadIds: report.classified.map(c => c.threadId),
    classifiedReport: report,
  };
}

async function pollTelegramCommands() {
  try {
    log('[tg] pollTelegramCommands tick');
    const updates = await httpJsonRequest(`https://api.telegram.org/bot${JESS_TG_TOKEN}/getUpdates?timeout=0&offset=${tgCommandOffset}&allowed_updates=${encodeURIComponent(JSON.stringify(['message','callback_query']))}`, 'GET', null, 10000);
    log(`[tg] updates fetched: ${Array.isArray(updates?.result) ? updates.result.length : 0}`);
    const results = Array.isArray(updates?.result) ? updates.result : [];
    for (const update of results) {
      tgCommandOffset = Math.max(tgCommandOffset, (update.update_id || 0) + 1);

      if (update.callback_query) {
        const cq = update.callback_query;
        const cqChatId = String(cq.message?.chat?.id || '');
        const cqData = cq.data || '';
        if (cqChatId !== DIEGO_TG_CHAT_ID) continue;
        httpJsonRequest(`https://api.telegram.org/bot${JESS_TG_TOKEN}/answerCallbackQuery`, 'POST', { callback_query_id: cq.id }, 5000).catch(()=>{});

        if (cqData.startsWith('jess_approve:')) {
          const entryId = cqData.replace('jess_approve:', '');
          const pending = loadPending();
          const entry = pending.find(p => p.id === entryId);
          if (entry && entry.status === 'pending') {
            entry.status = 'approved';
            entry.finalMessage = entry.draft || entry.finalMessage;
            entry.approvedAt = new Date().toISOString();
            savePending(pending);
            try {
              await sendTelegramMessage(cqChatId, `✅ Approved: *${escapeMarkdown(entry.enquirerName || entry.name || 'Unknown')}* (${escapeMarkdown(entry.houseCode || '?')})`, { parse_mode: 'MarkdownV2' });
            } catch (e) { logWarn(`jess approve notify failed: ${e.message}`); }
          }
          continue;
        }

        if (cqData.startsWith('jess_skip:')) {
          const entryId = cqData.replace('jess_skip:', '');
          const pending = loadPending();
          const entry = pending.find(p => p.id === entryId);
          if (entry && entry.status === 'pending') {
            entry.status = 'skipped';
            entry.skippedAt = new Date().toISOString();
            savePending(pending);
            try {
              await sendTelegramMessage(cqChatId, `❌ Skipped: *${escapeMarkdown(entry.enquirerName || entry.name || 'Unknown')}* (${escapeMarkdown(entry.houseCode || '?')})`, { parse_mode: 'MarkdownV2' });
            } catch (e) { logWarn(`jess skip notify failed: ${e.message}`); }
            // ── v4: mark thread as skipped ──────────────────────────────────
            try {
              const _v4ts5 = require('./modules/thread-state');
              const _v4tid5 = entry.conversationUrl?.replace('relay://thread/', '') || entry.conversationId || null;
              if (_v4tid5) {
                const _v4st5 = _v4ts5.get(_v4tid5) || {};
                _v4ts5.set(_v4tid5, { ..._v4st5, skippedAt: Date.now(), needsReply: false });
              }
            } catch (_v4e5) { /* non-fatal */ }
            // ── end v4 ────────────────────────────────────────────────────
          }
          continue;
        }

        const f = loadFilter();
        if (cqData.startsWith('jf_house:')) {
          const house = cqData.replace('jf_house:', '');
          const newHouses = house === 'all' ? ['all'] : [house];
          const houseLabel = newHouses.includes('all') ? 'All active listings' : newHouses.join(', ').toUpperCase();
          saveFilter({ ...f, period: 'last_3_days', houses: newHouses, step: null });
          try {
            await sendTelegramMessage(cqChatId,
              `✅ *Processing:* ${houseLabel} · Last 3 days\n\n🔄 Scanning inbox and drafting inspection invites...\nI'll alert you when there are replies ready for approval.`,
              { parse_mode: 'Markdown' }
            );
          } catch(e) { logWarn(`jf_house confirm failed: ${e.message}`); }
          log(`[filter] Set: period=last_3_days houses=${newHouses.join(',')}`);
          runCycleNow().catch(e => logError(`Filter-triggered cycle failed: ${e.message}`));
        }
        continue;
      }

      const msg = update.message;
      const chatId = String(msg?.chat?.id || '');
      const textMsg = (msg?.text || '').trim();
      if (chatId !== DIEGO_TG_CHAT_ID || !textMsg) continue;

      if (await handlePendingCampaignConfirm(msg)) continue;
      if (await handlePendingBlastApproval(msg)) continue;
      if (await handlePendingReplyInstruction(msg)) continue;

      const textLower = textMsg.toLowerCase();

      // ── cancel pending clear-all if user sends anything other than confirmation
      if (clearAllPending && textLower !== 'confirm clear all') {
        clearAllPending = false;
        clearAllPendingAt = 0;
        await sendTelegramMessage(chatId, '❌ Clear all cancelled.').catch(()=>{});
      }

      const inbox = await fetchInbox().catch(() => loadJSON(path.join(DATA_DIR, 'jess-relay-inbox.json'), []));
      const pending = loadPending();
      const activePending = pending.filter(p => p.status === 'pending' && !p.sentAt);

      if (textLower === '/jess_help' || textLower === '/jess help' || textLower === '/help') {
        await sendTelegramMessage(chatId, buildJessHelpMessage(), { parse_mode: 'Markdown' }).catch(e => logWarn(`Failed to send /jess help: ${e.message}`));
        continue;
      }

      if (textLower === '/jess_status' || textLower === '/jess status') {
        await sendTelegramMessage(chatId, buildJessStatusMessage(), { parse_mode: 'Markdown' }).catch(e => logWarn(`Failed to send /jess status: ${e.message}`));
        continue;
      }

      // ── /jess status <HOUSE> — campaign progress for a specific house ──────
      const _campStatusMatch = textMsg.match(/^\/jess\s+status\s+(\w+)$/i);
      if (_campStatusMatch) {
        const _csHouse = _campStatusMatch[1].toUpperCase();
        const _csCampaignId = `house-${_csHouse}`;
        try {
          const _csProgress = require('./modules/campaign-progress');
          // Try by exact house campaignId first, then scan all
          let _csStatus = _csProgress.getStatus(_csCampaignId);
          if (!_csStatus) {
            // Also check other campaign ids that might match the house
            const _csAll = Object.values(require('fs').existsSync(path.join(DATA_DIR, 'jess-campaign-progress.json'))
              ? JSON.parse(require('fs').readFileSync(path.join(DATA_DIR, 'jess-campaign-progress.json'), 'utf8'))
              : {});
            const _csMatch = _csAll.find(s => String(s.house || '').toUpperCase() === _csHouse);
            if (_csMatch) _csStatus = _csProgress.getStatus(_csMatch.campaignId);
          }
          if (_csStatus) {
            await sendTelegramMessage(chatId, _csProgress.formatStatus(_csStatus.campaignId), { parse_mode: 'Markdown' }).catch(()=>{});
          } else {
            await sendTelegramMessage(chatId, `No campaign progress found for *${_csHouse}*.\nStart one with \`/jess campaign ${_csHouse}\`.`, { parse_mode: 'Markdown' }).catch(()=>{});
          }
        } catch(_cse) {
          await sendTelegramMessage(chatId, `❌ Status error: ${_cse.message}`).catch(()=>{});
        }
        continue;
      }

      if (textLower === '/jess_pause' || textLower === '/jess pause') {
        jessPaused = true;
        jessLastError = 'Paused by Telegram command';
        jessLastErrorAt = new Date().toISOString();
        await sendTelegramMessage(chatId, '⏸ Jess paused.').catch(()=>{});
        continue;
      }

      if (textLower === '/jess_resume' || textLower === '/jess resume' || textLower === '/jess_restart' || textLower === '/jess restart') {
        jessPaused = false;
        jessLastError = '';
        jessLastErrorAt = null;
        jessLastErrorAffectedCount = 0;
        relayFailureStreak = 0;
        modelFailureStreak = 0;
        await sendTelegramMessage(chatId, '✅ Jess resumed.').catch(()=>{});
        runCycleNow().catch(e => logError(`Immediate resume cycle failed: ${e.message}`));
        continue;
      }

      // ── /jess stop — emergency halt ─────────────────────────────────────────
      if (textLower === '/jess stop') {
        const adminStop = loadAdminState();
        adminStop.emergencyStop = true;
        saveAdminState(adminStop);
        // Clear all approved (not yet sent) entries back to paused
        const pendingStop = loadPending();
        let clearedCount = 0;
        for (const entry of pendingStop) {
          if (entry.status === 'approved' && !entry.sentAt) {
            entry.status = 'paused';
            entry.pausedAt = new Date().toISOString();
            clearedCount++;
          }
        }
        savePending(pendingStop);
        log(`[EMERGENCY STOP] Jess stopped by Telegram command. ${clearedCount} approved entries set to paused.`);
        await sendTelegramMessage(chatId, '🛑 Jess stopped. No more sends. Use /jess start to resume.').catch(()=>{});
        continue;
      }

      // ── /jess start — clear emergency stop ──────────────────────────────────
      if (textLower === '/jess start') {
        const adminStart = loadAdminState();
        adminStart.emergencyStop = false;
        saveAdminState(adminStart);
        log('[EMERGENCY START] Jess resumed via /jess start.');
        await sendTelegramMessage(chatId, '✅ Jess resumed.').catch(()=>{});
        continue;
      }

      // ── /jess clear — remove sent/skipped/expired entries ───────────────────
      if (textLower === '/jess clear') {
        const allEntries = loadPending();
        const toRemove = ['sent', 'skipped', 'expired'];
        const kept = allEntries.filter(e => !toRemove.includes(e.status));
        const removedCount = allEntries.length - kept.length;
        if (removedCount === 0) {
          await sendTelegramMessage(chatId, '✅ Queue already clean — nothing to remove.').catch(()=>{});
        } else {
          savePending(kept);
          log(`[CLEAR] Removed ${removedCount} entries (sent/skipped/expired). ${kept.length} kept.`);
          await sendTelegramMessage(chatId, `🧹 Cleared ${removedCount} entries (sent/skipped/expired). ${kept.length} pending entries kept.`).catch(()=>{});
        }
        continue;
      }

      // ── /jess clear all — wipe entire queue (with confirmation) ─────────────
      if (textLower === '/jess clear all') {
        const allEntries = loadPending();
        clearAllPending = true;
        clearAllPendingAt = Date.now();
        await sendTelegramMessage(chatId, `⚠️ This will delete ALL ${allEntries.length} queue entries including any pending. Reply *confirm clear all* to proceed.`, { parse_mode: 'Markdown' }).catch(()=>{});
        continue;
      }

      // ── confirm clear all ────────────────────────────────────────────────────
      if (textLower === 'confirm clear all') {
        const expired = Date.now() - clearAllPendingAt > 60000;
        if (clearAllPending && !expired) {
          clearAllPending = false;
          clearAllPendingAt = 0;
          savePending([]);
          log('[CLEAR ALL] Queue wiped via confirm clear all.');
          await sendTelegramMessage(chatId, '🧹 Queue wiped — 0 entries.').catch(()=>{});
        } else {
          clearAllPending = false;
          clearAllPendingAt = 0;
          await sendTelegramMessage(chatId, '❌ Clear all cancelled.').catch(()=>{});
        }
        continue;
      }

      // ── /jess status relay — show relay + send-queue backlog status ─────────
      if (textLower === '/jess status relay' || textLower === '/jess debug relay') {
        try {
          const _sqFile = require('path').join(__dirname, '..', 'mission-control', 'data', 'send-queue.json');
          const _cpFile = require('path').join(__dirname, '..', 'mission-control', 'data', 'jess-campaign-progress.json');
          const _cFile  = require('path').join(__dirname, '..', 'mission-control', 'data', 'jess-campaigns.json');
          const _sq = loadJSON(_sqFile, []);
          const _cp = loadJSON(_cpFile, {});
          const _cList = loadJSON(_cFile, []);

          const _sqPending  = Array.isArray(_sq) ? _sq.filter(e => e.status === 'pending') : [];
          const _sqRejected = Array.isArray(_sq) ? _sq.filter(e => e.status === 'rejected') : [];
          const _cpEntries  = Object.values(_cp);
          const _cpActive   = _cpEntries.filter(e => e.state && e.state !== 'completed');
          const _pendingJob = fs.existsSync(DATA.pendingCampaignSendJob)
            ? (loadJSON(DATA.pendingCampaignSendJob, null) ? 'YES — campaign send in progress' : 'none')
            : 'none';

          const _jPending = loadPending();
          const _jPendingActive = _jPending.filter(e => !['sent','skipped','ignored','archived','expired','rejected'].includes(e.status));

          const _relayStatus = loadJSON(require('path').join(DATA_DIR, 'jess-relay-status.json'), {});
          const _relayConnected = _relayStatus.extensionConnected !== false;
          const _relayLastScrape = _relayStatus.lastScrapeTime ? formatAdminTimestamp(_relayStatus.lastScrapeTime) : 'unknown';

          const lines = [
            '*📊 Jess Relay & Send Status*',
            '',
            `🔌 Extension: ${_relayConnected ? '✅ connected' : '❌ disconnected'}`,
            `📡 Last scrape: ${_relayLastScrape}`,
            '',
            `📬 Send queue (MC):`,
            `  • Pending (may send): ${_sqPending.length}`,
            `  • Rejected (cleared): ${_sqRejected.length}`,
            `  • Total entries: ${Array.isArray(_sq) ? _sq.length : 0}`,
            '',
            `📦 Campaign progress entries: ${_cpEntries.length}`,
            `  • Active/incomplete: ${_cpActive.length}`,
            `  • Active campaign definitions: ${Array.isArray(_cList) ? _cList.length : 0}`,
            '',
            `⏳ Pending campaign send job: ${_pendingJob}`,
            `📋 Jess pending queue: ${_jPendingActive.length} actionable`,
            '',
            _sqPending.length > 0 ? `⚠️ *${_sqPending.length} PENDING items in send-queue — use /jess clear relay to remove*` : '✅ Send queue is clean',
            _cpActive.length > 0 ? `⚠️ *${_cpActive.length} ACTIVE campaign(s) in progress*` : '',
          ].filter(l => l !== null).join('\n');

          await sendTelegramMessage(chatId, lines, { parse_mode: 'Markdown' }).catch(()=>{});
        } catch (_sre) {
          await sendTelegramMessage(chatId, `❌ Relay status error: ${_sre.message}`).catch(()=>{});
        }
        continue;
      }

      // ── /jess clear relay — clear pending send-queue items + campaign state ─
      if (textLower === '/jess clear relay' || textLower === '/jess clear pending') {
        try {
          let _cleared = 0;
          let _report = [];

          // 1. Clear pending items from send-queue.json (mark as rejected)
          const _sqFile = require('path').join(__dirname, '..', 'mission-control', 'data', 'send-queue.json');
          const _sq = loadJSON(_sqFile, []);
          if (Array.isArray(_sq)) {
            const _pendingItems = _sq.filter(e => e.status === 'pending');
            if (_pendingItems.length > 0) {
              _pendingItems.forEach(e => {
                e.status = 'rejected';
                e.clearedAt = new Date().toISOString();
                e.clearedReason = 'operator-clear via /jess clear relay';
              });
              saveJSON(_sqFile, _sq);
              _cleared += _pendingItems.length;
              _report.push(`• Rejected ${_pendingItems.length} pending send-queue items`);
            } else {
              _report.push('• Send queue: already clean (0 pending)');
            }
          }

          // 2. Clear campaign progress map
          const _cpFile = require('path').join(__dirname, '..', 'mission-control', 'data', 'jess-campaign-progress.json');
          const _cp = loadJSON(_cpFile, {});
          const _cpCount = Object.keys(_cp).length;
          if (_cpCount > 0) {
            saveJSON(_cpFile, {});
            _report.push(`• Cleared ${_cpCount} campaign progress entries`);
            _cleared += _cpCount;
          } else {
            _report.push('• Campaign progress: already empty');
          }

          // 3. Clear pending campaign send job if exists
          try {
            if (fs.existsSync(DATA.pendingCampaignSendJob)) {
              fs.unlinkSync(DATA.pendingCampaignSendJob);
              _report.push('• Removed pending campaign send job file');
              _cleared++;
            } else {
              _report.push('• No pending campaign send job to clear');
            }
          } catch (_pce) { _report.push(`• Could not clear pending campaign job: ${_pce.message}`); }

          // 4. Remove today's inspection campaigns from jess-campaigns.json
          const _cFile = require('path').join(__dirname, '..', 'mission-control', 'data', 'jess-campaigns.json');
          const _cList = loadJSON(_cFile, []);
          if (Array.isArray(_cList)) {
            const _today = new Date().toISOString().slice(0, 10);
            const _todayCamps = _cList.filter(c => c.meta?.inspectionDate === _today);
            if (_todayCamps.length > 0) {
              const _keptCamps = _cList.filter(c => c.meta?.inspectionDate !== _today);
              saveJSON(_cFile, _keptCamps);
              _report.push(`• Removed ${_todayCamps.length} today's inspection campaign(s)`);
              _cleared += _todayCamps.length;
            } else {
              _report.push('• No today-dated campaigns to clear');
            }
          }

          const _summary = _cleared === 0
            ? '✅ Nothing to clear — system already clean.'
            : `🧹 Cleared ${_cleared} item(s):\n${_report.join('\n')}`;

          log(`[CLEAR RELAY] ${_summary.replace(/\n/g, ' | ')}`);
          await sendTelegramMessage(chatId, _summary).catch(()=>{});
        } catch (_cre) {
          await sendTelegramMessage(chatId, `❌ Clear relay error: ${_cre.message}`).catch(()=>{});
        }
        continue;
      }

      if (textLower === '/jess_pending' || textLower === '/jess pending' || textLower === '/pending') {
        if (!activePending.length) {
          await sendTelegramMessage(chatId, '✅ No pending drafts.');
          continue;
        }
        for (const entry of activePending.slice(0, 10)) {
          await sendPendingEntryForReview(chatId, entry);
        }
        if (activePending.length > 10) {
          await sendTelegramMessage(chatId, `_Showing 10 of ${activePending.length} pending drafts._`, { parse_mode: 'Markdown' });
        }
        continue;
      }

      if (textLower === '/jess approve all') {
        let count = 0;
        for (const entry of pending) {
          if (entry.status !== 'pending' || entry.sentAt) continue;
          entry.status = 'approved';
          entry.finalMessage = entry.draft || entry.finalMessage;
          entry.approvedAt = new Date().toISOString();
          count++;
        }
        savePending(pending);
        await sendTelegramMessage(chatId, count ? `✅ Approved ${count} pending draft(s). Sending now.` : 'Nothing to approve.').catch(()=>{});
        if (count) sendApprovedReplies().catch(e => logWarn(`approve all send failed: ${e.message}`));
        continue;
      }

      if (textLower === '/jess skip all') {
        let count = 0;
        for (const entry of pending) {
          if (entry.status !== 'pending' || entry.sentAt) continue;
          entry.status = 'skipped';
          entry.skippedAt = new Date().toISOString();
          count++;
        }
        savePending(pending);
        await sendTelegramMessage(chatId, count ? `⏭ Skipped ${count} pending draft(s).` : 'Nothing to skip.').catch(()=>{});
        continue;
      }

      if (textLower.startsWith('/jess new')) {
        const houseFilter = textLower.split(/\s+/)[2]?.toUpperCase() || null;
        let unread = inbox.filter(c => c && (c.unread || c.isUnread));
        if (houseFilter) {
          unread = getInboxForHouse(unread, houseFilter);
        }
        unread = unread.slice(0, 10);
        if (!unread.length) {
          const noResultMsg = houseFilter
            ? `No unread conversations found for ${houseFilter}. (Listing URL not set in jess-rooms.json — add flatmatesId to enable house filtering)`
            : '✅ No unread conversations.';
          await sendTelegramMessage(chatId, noResultMsg).catch(()=>{});
          continue;
        }
        const lines = unread.map(c => `• ${c.threadId} - ${(c.name || c.memberName || 'Unknown').slice(0, 30)} - ${(c.snippet || c.preview || '').slice(0, 60)}`);
        const header = houseFilter ? `*Unread - ${houseFilter}*` : `*Unread conversations*`;
        await sendTelegramMessage(chatId, [header, ...lines].join('\n'), { parse_mode: 'Markdown' }).catch(()=>{});
        continue;
      }

      if (textLower === '/jess replied' || textLower.startsWith('/jess replied ')) {
        const repliedHouseFilter = textLower.split(/\s+/)[2]?.toUpperCase() || null;
        const today = brisbaneDateKey();
        let replied = pending.filter(p => p.sentAt && String(p.sentAt).slice(0,10) === today);
        if (repliedHouseFilter) {
          replied = replied.filter(p => (p.houseCode || '').toUpperCase() === repliedHouseFilter);
        }
        if (!replied.length) {
          const noRepliedMsg = repliedHouseFilter
            ? `No Jess replies sent today for ${repliedHouseFilter}.`
            : 'No Jess replies sent today yet.';
          await sendTelegramMessage(chatId, noRepliedMsg).catch(()=>{});
          continue;
        }
        const header = repliedHouseFilter ? `*Jess replied today — ${repliedHouseFilter}*` : `*Jess replied today*`;
        const lines = replied.slice(0, 20).map(p => `• ${p.conversationId || p.id} - ${p.enquirerName || 'Unknown'} (${p.houseCode || '?'})`);
        await sendTelegramMessage(chatId, [header, ...lines].join('\n'), { parse_mode: 'Markdown' }).catch(()=>{});
        continue;
      }

      if (textLower === '/jess unanswered') {
        const unanswered = [];
        for (const c of inbox.filter(c => c && (c.unread || c.isUnread)).slice(0, 20)) {
          const threadId = String(c.threadId || '');
          const hasPending = pending.some(p => String(p.conversationId || '') === threadId && ['pending','approved','sent'].includes(p.status));
          if (!hasPending) unanswered.push(c);
        }
        if (!unanswered.length) {
          await sendTelegramMessage(chatId, '✅ No unanswered unread conversations found.').catch(()=>{});
          continue;
        }
        const lines = unanswered.slice(0,10).map(c => `• ${c.threadId} - ${c.name || c.memberName || 'Unknown'} - ${(c.preview || '').slice(0, 70)}`);
        await sendTelegramMessage(chatId, ['*Unread with no Jess reply yet*', ...lines].join('\n'), { parse_mode: 'Markdown' }).catch(()=>{});
        continue;
      }

      const readMatch = textMsg.match(/^\/jess\s+read\s+(.+)$/i);
      if (readMatch) {
        const conv = resolveConversationMatch(readMatch[1], inbox);
        if (!conv?.threadId) {
          await sendTelegramMessage(chatId, 'Could not find that conversation.').catch(()=>{});
          continue;
        }
        const thread = await fetchThread(String(conv.threadId)).catch(() => null);
        const body = summariseThreadMessages(thread || { personName: conv.name || conv.memberName, messages: [] }, 5);
        await sendTelegramMessage(chatId, `*${conv.name || conv.memberName || conv.threadId}*\nThread: \`${conv.threadId}\`\n\n${body}`, { parse_mode: 'Markdown' }).catch(()=>{});
        continue;
      }

      const ignoreMatch = textMsg.match(/^\/jess\s+ignore\s+(\S+)$/i);
      if (ignoreMatch) {
        const threadId = String(ignoreMatch[1]);
        const admin = loadAdminState();
        admin.ignoredThreads[threadId] = { ignoredAt: new Date().toISOString() };
        delete admin.snoozedThreads[threadId];
        saveAdminState(admin);
        await sendTelegramMessage(chatId, `🚫 Ignoring thread ${threadId} from now on.`).catch(()=>{});
        continue;
      }

      const snoozeMatch = textMsg.match(/^\/jess\s+snooze\s+(\S+)\s+(\d+d)$/i);
      if (snoozeMatch) {
        const [, threadId, rawDays] = snoozeMatch;
        const days = parseDayCount(rawDays);
        if (!days) {
          await sendTelegramMessage(chatId, 'Use `/jess snooze <threadId> <Xd>` e.g. `/jess snooze 123456 3d`', { parse_mode: 'Markdown' }).catch(()=>{});
          continue;
        }
        const until = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
        const admin = loadAdminState();
        admin.snoozedThreads[String(threadId)] = { until, days, snoozedAt: new Date().toISOString() };
        saveAdminState(admin);
        await sendTelegramMessage(chatId, `😴 Snoozed thread ${threadId} for ${days} day(s), until ${formatAdminTimestamp(until)}.`).catch(()=>{});
        continue;
      }

      const inspectionCommand = parseJessInspectionCommand(textMsg);
      if (inspectionCommand) {
        const house = String(inspectionCommand.houseCode || '').trim().toUpperCase();
        const traceId = createInspectionTraceId(house);
        let finalReply = '';
        try {
          logInspectionStage(traceId, 'command received', {
            house,
            rawText: textMsg,
            chatId,
          });
          logInspectionStage(traceId, 'route matched', {
            command: '/jess inspection',
            house,
          });

          const parsedCommand = await runInspectionStage(traceId, 'parser entered', {
            rawText: textMsg,
          }, async () => inspectionCommand);
          logInspectionStage(traceId, 'parser output', parsedCommand);

          const naturalDateRaw = parsedCommand.naturalDateRaw;
          const inspDate = await runInspectionStage(traceId, 'natural date resolved', {
            naturalDateRaw,
          }, async () => parseAdminDate(naturalDateRaw));
          const inspTime = parseAdminTime(parsedCommand.timeRaw);
          const assistant = parsedCommand.assistantRaw.trim();
          const slotIntervalMins = parseInt(parsedCommand.slotIntervalRaw, 10);
          const blockLengthMins = parseInt(parsedCommand.blockLengthRaw, 10);
          const amount = parseInt(parsedCommand.amountRaw, 10);

          if (!house || !inspDate || !inspTime || !assistant || !Number.isFinite(slotIntervalMins) || slotIntervalMins <= 0 || !Number.isFinite(blockLengthMins) || blockLengthMins <= 0 || !Number.isFinite(amount) || amount <= 0) {
            const guardDetails = {
              house,
              inspDate,
              inspTime,
              assistant,
              slotIntervalMins,
              blockLengthMins,
              amount,
              reason: 'invalid parsed inspection details',
            };
            logInspectionStage(traceId, 'guard condition', guardDetails, 'WARN');
            logInspectionStage(traceId, 'early return', guardDetails, 'WARN');
            finalReply = 'Could not parse the inspection details. Use `/jess inspection <house> <natural-date> <time> <slot-interval> <block-length> <assistant> <amount>` e.g. `/jess inspection EB3 tomorrow 6:30pm 15 60 Emilio 8`';
            await sendTelegramMessage(chatId, finalReply, { parse_mode: 'Markdown' }).catch(()=>{});
            logInspectionStage(traceId, 'handler completed', { outcome: 'guard-return' });
            continue;
          }

          const addr = getHouseAddress(house);
          const inspections = loadInspections();
          const existIdx = inspections.findIndex(i => i.houseCode === house);
          const existingInspection = existIdx >= 0 ? inspections[existIdx] : null;
          const naturalDateLabel = getNaturalDateLabel(naturalDateRaw, inspDate);
          const inspEntry = await runInspectionStage(traceId, 'inspection block built', {
            existingInspectionFound: existIdx >= 0,
            house,
            address: addr,
          }, async () => ({
            ...(existingInspection || {}),
            houseCode: house,
            date: inspDate,
            resolvedDate: inspDate,
            naturalDateRaw,
            naturalDateLabel,
            time: inspTime,
            slot_interval_minutes: slotIntervalMins,
            block_length_minutes: blockLengthMins,
            intervalMins: slotIntervalMins,
            blockLengthMins: blockLengthMins,
            durationMins: blockLengthMins,
            duration_minutes: blockLengthMins,
            slotInterval: slotIntervalMins,
            blockLength: blockLengthMins,
            assistant,
            host: assistant,
            amount,
            leadAmount: amount,
            address: addr,
            active: true,
            setAt: new Date().toISOString(),
            slots: Array.isArray(existingInspection?.slots) ? existingInspection.slots : []
          }));

          await runInspectionStage(traceId, 'inspection block saved', {
            house,
            existIdx,
          }, async () => {
            if (existIdx >= 0) inspections[existIdx] = inspEntry;
            else inspections.push(inspEntry);
            saveInspections(inspections);
          });

          const savedInspection = await runInspectionStage(traceId, 'saved inspection block reloaded', {
            house,
          }, async () => getInspectionForRoom(house));
          if (!savedInspection) {
            const guardDetails = { house, reason: 'saved inspection missing after save' };
            logInspectionStage(traceId, 'guard condition', guardDetails, 'WARN');
            logInspectionStage(traceId, 'early return', guardDetails, 'WARN');
            finalReply = `❌ Saved inspection for ${house} could not be reloaded after saving.`;
            await sendTelegramMessage(chatId, finalReply).catch(()=>{});
            logInspectionStage(traceId, 'handler completed', { outcome: 'reload-missing' });
            continue;
          }

          let updated = 0;
          let candidates = [];
          await runInspectionStage(traceId, 'pending draft update started', {
            house,
            pendingCount: pending.length,
          }, async () => {});
          candidates = await runInspectionStage(traceId, 'pending draft candidates found', {
            house,
          }, async () => pending.filter(p => p.status === 'pending' && (p.houseCode || '').toUpperCase() === house));
          const eligibleDrafts = await runInspectionStage(traceId, 'eligible draft count', {
            house,
          }, async () => candidates.filter(p => !!buildInspectionDraftFromSaved(p.enquirerName || p.name || 'there', savedInspection)));

          await runInspectionStage(traceId, 'pending drafts updated', {
            house,
            eligibleDraftCount: eligibleDrafts.length,
          }, async () => {
            for (const p of pending) {
              if (p.status !== 'pending') continue;
              if ((p.houseCode || '').toUpperCase() !== house) continue;
              p.draft = buildInspectionDraftFromSaved(p.enquirerName || p.name || 'there', savedInspection);
              p.inspectionScheduled = true;
              p.inspectionAmount = savedInspection.amount || savedInspection.leadAmount || amount;
              p.inspectionDate = savedInspection.date;
              p.inspectionTime = savedInspection.time;
              p.inspectionAssistant = savedInspection.assistant || savedInspection.host || assistant;
              p.updatedAt = new Date().toISOString();
              updated++;
            }
            savePending(pending);
          });

          await runInspectionStage(traceId, 'campaign fallback state prepared', {
            house,
            campaignId: savedInspection.campaignId || null,
            canReadSavedInspection: !!(savedInspection.date && savedInspection.time && (savedInspection.slot_interval_minutes || savedInspection.intervalMins || savedInspection.slotInterval) && (savedInspection.block_length_minutes || savedInspection.blockLengthMins || savedInspection.blockLength || savedInspection.durationMins)),
          }, async () => ({
            amount: savedInspection.amount || savedInspection.leadAmount || amount,
            assistant: savedInspection.assistant || savedInspection.host || assistant,
          }));

          const displayDate = savedInspection.naturalDateLabel || savedInspection.naturalDateRaw || savedInspection.date;
          const resolvedDateDisplay = formatDateAuNumeric(savedInspection.date || '') || savedInspection.date;
          const displayTime = format12hr(savedInspection.time || '').replace(/^0/, '') || savedInspection.time;
          finalReply = await runInspectionStage(traceId, 'final reply built', {
            house,
            updated,
          }, async () => `✅ *Inspection set - ${house}*\n📍 ${addr}\n🗓 Input date: ${displayDate}\n📅 Resolved date: ${resolvedDateDisplay}\n🕒 Time: ${displayTime}\n⏱ Slot interval: ${slotIntervalMins} min\n🧱 Block length: ${blockLengthMins} min\n👤 Assistant / host: ${assistant}\n👥 Saved amount: ${amount}\n\n♻️ Updated *${updated} pending draft(s)* from the saved inspection block.\n💡 Campaign shortcut: \`/jess campaign ${house}\` will use this saved amount, or override with \`/jess campaign ${house} <amount>\`.`);

          await sendTelegramMessage(chatId, finalReply, { parse_mode: 'Markdown' }).catch(()=>{});
          logInspectionStage(traceId, 'handler completed', { outcome: 'success', updated });
        } catch (error) {
          logInspectionStage(traceId, 'handler completed', {
            outcome: 'error',
            error: error?.message || String(error),
          }, 'ERROR');
          await sendTelegramMessage(chatId, `❌ Inspection setup failed for ${house || 'unknown'}: ${error?.message || error}` ).catch(()=>{});
        }
        continue;
      }

      const blastMatch = textMsg.match(/^\/jess\s+blast\s+(\w+)\s+(.+?)\s+(\d{1,2}(?::\d{2})?(?:am|pm)?)\s+(\S+)(?:\s+(\S+))?$/i);
      if (blastMatch) {
        const [, houseCode, dateRaw, timeRaw, hostRaw, filterRaw] = blastMatch;
        const house = houseCode.toUpperCase();
        const blastDate = parseAdminDate(dateRaw);
        const blastTime = parseAdminTime(timeRaw);
        const host = hostRaw.trim();
        if (!blastDate || !blastTime) {
          await sendTelegramMessage(chatId, 'Could not parse blast date/time. Example: `/jess blast EB3 tomorrow 6:00pm Mathis`', { parse_mode: 'Markdown' }).catch(()=>{});
          continue;
        }

        // Parse optional 5th token: "\d+d" = days filter, "\d+" = limit filter
        let blastDaysFilter = null;  // number of days
        let blastLimitFilter = null; // max count
        if (filterRaw) {
          const daysMatch = filterRaw.match(/^(\d+)d$/i);
          const limitMatch = filterRaw.match(/^(\d+)$/);
          if (daysMatch) blastDaysFilter = parseInt(daysMatch[1], 10);
          else if (limitMatch) blastLimitFilter = parseInt(limitMatch[1], 10);
        }

        // Parse a "lastActive" string like "2 days ago", "3 hours ago", "1 week ago" → days (float)
        function parseLastActiveToDays(lastActive) {
          if (!lastActive) return null;
          if (/^\d{4}-\d{2}-\d{2}T/.test(lastActive)) {
            const ms = Date.now() - new Date(lastActive).getTime();
            return ms / (1000 * 60 * 60 * 24);
          }
          const s = String(lastActive).toLowerCase().trim();
          const m = s.match(/^(\d+)\s*(second|minute|hour|day|week|month|year)s?\s*ago$/);
          if (!m) return null;
          const n = parseInt(m[1], 10);
          switch (m[2]) {
            case 'second': return n / 86400;
            case 'minute': return n / 1440;
            case 'hour':   return n / 24;
            case 'day':    return n;
            case 'week':   return n * 7;
            case 'month':  return n * 30;
            case 'year':   return n * 365;
          }
          return null;
        }

        const addr = getHouseAddress(house);
        const allHouseThreads = getInboxForHouse(inbox, house);
        let targetThreads = allHouseThreads.filter(c => c.unread || c.isUnread);

        // Apply days filter
        if (blastDaysFilter !== null) {
          targetThreads = targetThreads.filter(c => {
            const days = parseLastActiveToDays(c.lastActive);
            if (days === null) return true;
            return days <= blastDaysFilter;
          });
        }

        // Apply limit filter
        if (blastLimitFilter !== null) {
          targetThreads = targetThreads.slice(0, blastLimitFilter);
        }

        // Determine day label (tonight vs date string)
        const todayKey = new Date().toLocaleDateString('en-AU', { timeZone: 'Australia/Brisbane', year: 'numeric', month: '2-digit', day: '2-digit' }).split('/').reverse().join('-');
        const blastDayLabel = blastDate === todayKey ? 'tonight' : blastDate;
        const hostPhone = getAssistantPhone(host);

        // Build filter description for preview footer
        let filterDesc = 'all unread';
        if (blastDaysFilter !== null) filterDesc = `last ${blastDaysFilter} days`;
        else if (blastLimitFilter !== null) filterDesc = `top ${blastLimitFilter}`;

        const targetCount = targetThreads.filter(c => {
          const tid = String(c.threadId || '');
          return tid && !isThreadIgnored(tid) && !isThreadSnoozed(tid);
        }).length;

        // Build preview template (with [Name] placeholder)
        const previewTemplate = formatBlastTemplate('[Name]', blastDayLabel, format12hr(blastTime), addr, host, hostPhone);

        // Store pendingBlast in admin state
        const admin = loadAdminState();
        admin.pendingBlast = {
          houseCode: house,
          date: blastDate,
          dayLabel: blastDayLabel,
          time: blastTime,
          host,
          addr,
          phone: hostPhone,
          filter: blastDaysFilter !== null ? 'days' : blastLimitFilter !== null ? 'limit' : null,
          filterVal: blastDaysFilter !== null ? blastDaysFilter : blastLimitFilter !== null ? blastLimitFilter : null,
          targetThreads: targetThreads.map(c => String(c.threadId || '')).filter(Boolean),
          template: previewTemplate,
          awaitingApproval: true,
          createdAt: new Date().toISOString(),
        };
        saveAdminState(admin);

        // Send preview to Telegram
        const previewMsg = [
          `📋 *Blast preview — ${house} (${targetCount} unread, ${filterDesc})*`,
          '',
          previewTemplate,
          '',
          '---',
          `Reply ✅ or "approve" to queue for all ${targetCount} leads`,
          'Reply "skip" or ⏭ to cancel',
          'Reply anything else to edit the template, Jess will regenerate',
        ].join('\n');
        await sendTelegramMessage(chatId, previewMsg, { parse_mode: 'Markdown' }).catch(() => {});
        continue;
      }

      // ── /jess correct <blastHouse> — DOM-verified correction blast ──────────
      // Does NOT trust stored houseCode (may be wrong from a blast bug).
      // Instead, the extension navigates to each thread, reads the listing ID
      // from the DOM, and only sends the correction if it does NOT match the
      // blast listing (i.e. it's a lead for a different property).
      const listingToggleMatch = textMsg.match(/^\/jess\s+(deactivate|activate)\s+(\w+)$/i);
      if (listingToggleMatch) {
        const [, actionRaw, houseRaw] = listingToggleMatch;
        const action = actionRaw.toLowerCase();
        const house = houseRaw.toUpperCase();
        try {
          const relayResp = await requestListingAvailabilityToggle(house, action);
          const ack = relayResp?.ack || relayResp?.result || relayResp;
          const toggled = Number(ack?.toggledCount ?? ack?.toggled ?? 0);
          const requestedLabel = action === 'deactivate' ? 'unavailable' : 'available';
          const actionPast = action === 'deactivate' ? 'deactivated' : 'activated';
          if (ack?.success === false) {
            throw new Error(ack?.error || 'Unknown extension error');
          }
          if (toggled > 0) {
            await sendTelegramMessage(chatId,
              `✅ ${house} ${actionPast} — ${toggled} room${toggled === 1 ? '' : 's'} set as ${requestedLabel}`
            ).catch(()=>{});
          } else {
            await sendTelegramMessage(chatId,
              `⚠️ ${house} — no rooms found to toggle (check if already in correct state)`
            ).catch(()=>{});
          }
        } catch (e) {
          await sendTelegramMessage(chatId,
            `❌ ${house} ${action} failed: ${e.message}`
          ).catch(()=>{});
        }
        continue;
      }

      const correctMatch = textMsg.match(/^\/jess\s+correct\s+(\w+)$/i);
      if (correctMatch) {
        const [, blastHouseRaw] = correctMatch;
        const blastHouse = blastHouseRaw.toUpperCase();

        // Resolve blast listing ID from rooms file
        const allRoomsForCorrect = loadRooms();
        // Support both listingId field AND listing_url field (MC format uses listing_url with P-number)
        const blastRoom = allRoomsForCorrect.find(r => r.houseCode && r.houseCode.toUpperCase() === blastHouse && (r.listingId || r.listing_url));
        if (blastRoom && !blastRoom.listingId && blastRoom.listing_url) {
          const m = blastRoom.listing_url.match(/P(\d+)/i);
          if (m) blastRoom.listingId = m[1];
        }
        if (!blastRoom || !blastRoom.listingId) {
          await sendTelegramMessage(chatId,
            `❌ Cannot find a listing ID for house *${blastHouse}* in jess-rooms.json.\nCannot safely run correction without knowing which listing to skip.`,
            { parse_mode: 'Markdown' }
          ).catch(()=>{});
          continue;
        }
        const blastListingId = String(blastRoom.listingId);

        // Find all paused entries (ignore stored houseCode — it may be wrong from the blast bug)
        const pendingArr = loadPending();
        const targets = pendingArr.filter(p => p.status === 'paused_needs_listing_ids');
        if (!targets.length) {
          await sendTelegramMessage(chatId,
            `No entries with status \`paused_needs_listing_ids\` found.\nCheck /jess pending for current statuses.`
          ).catch(()=>{});
          continue;
        }

        // Generic correction message — safe for all houses, no address specifics needed
        // (We don't know actual house until DOM confirms it, and generic works fine)
        let queued = 0;
        for (const entry of targets) {
          const threadId = (entry.conversationUrl || '').match(/\/messages\/(\d+)/)?.[1]
            || entry.conversationId
            || entry.id?.replace(/^[a-z0-9]+_/, '');
          if (!threadId) {
            log(`[correct] Skipping entry ${entry.id} — cannot resolve threadId`);
            continue;
          }
          const name = (entry.enquirerName || entry.name || 'there').split(' ')[0];
          const correctionMsg = `Hi ${name}, apologies for the confusion earlier — we sent you incorrect details by mistake. We'll be in touch shortly with the correct inspection information. Sorry about that!`;

          // Queue verify-and-send relay command:
          // Extension will navigate to thread, read listing ID from DOM,
          // skip if it matches blastListingId (real blast lead), otherwise send.
          await relayPost('/api/verify-and-send', {
            threadId,
            conversationUrl: entry.conversationUrl || `https://flatmates.com.au/messages/${threadId}`,
            blastListingId,
            text: correctionMsg
          }).catch(e => log(`[correct] relay queue failed for ${threadId}: ${e.message}`));

          // Mark as correction_queued so we don't double-process on next cycle
          entry.status = 'correction_queued';
          entry.correctionFor = blastHouse;
          entry.blastListingId = blastListingId;
          entry.correctionQueuedAt = new Date().toISOString();
          queued++;
        }
        savePending(pendingArr);
        log(`[correct] Queued ${queued} verify-and-send command(s) for blast house ${blastHouse} (listingId=${blastListingId}). Extension will skip real ${blastHouse} leads.`);
        await sendTelegramMessage(chatId,
          `✅ Queued *${queued}* correction check(s) for blast house *${blastHouse}* (listing \`${blastListingId}\`).\n` +
          `Extension will navigate each thread, read the listing from the DOM, and:\n` +
          `• Skip if listing = ${blastHouse} (real lead — no correction needed)\n` +
          `• Send generic apology if listing ≠ ${blastHouse} (wrong blast target)\n\n` +
          `_Commands dispatched to relay. Extension processes them next poll cycle._`,
          { parse_mode: 'Markdown' }
        ).catch(()=>{});
        continue;
      }


      // ── /jess campaign — outbound campaign system ────────────────────────────
      const inspectionDebugMatch = textMsg.match(/^\/jess\s+debug\s+inspection\s+(\w+)$/i);
      if (inspectionDebugMatch) {
        const [, houseRaw] = inspectionDebugMatch;
        const summary = buildInspectionDebugSummary(houseRaw);
        await sendTelegramMessage(chatId, formatInspectionDebugSummaryMessage(summary), { parse_mode: 'Markdown' }).catch(()=>{});
        continue;
      }

      // ── /jess refresh <house> — force inbox + per-thread refresh for a house ──
      const refreshHouseMatch = textMsg.match(/^\/jess\s+refresh\s+(\w+)$/i);
      if (refreshHouseMatch) {
        const _rfHouse = refreshHouseMatch[1].toUpperCase();
        const _rfStarted = Date.now();
        try {
          await sendTelegramMessage(chatId, `🔄 Refreshing *${_rfHouse}* — forcing inbox scan…`, { parse_mode: 'Markdown' }).catch(() => {});

          // 1. Force inbox scan
          try {
            await requestScrape({ forceRefresh: true, countMode: true });
          } catch (_rfScrapeErr) {
            log(`[refresh/${_rfHouse}] requestScrape error (non-fatal): ${_rfScrapeErr.message}`);
          }
          await new Promise(r => setTimeout(r, 3500));

          // 2. Fetch fresh inbox
          const _rfInbox = await fetchInbox().catch(() => []);
          log(`[refresh/${_rfHouse}] inbox fetched: ${_rfInbox.length} conversations`);

          // 3. Find threads for this house using thread-states + house-matcher
          const _rfTsPath = path.join(__dirname, 'data', 'jess-thread-states.json');
          const _rfTS = loadJSON(_rfTsPath, {});
          const _rfRooms = loadRooms();

          // Gather all threadIds for this house from thread-states + inbox
          const _rfHouseThreadIds = new Set();
          for (const [tid, state] of Object.entries(_rfTS)) {
            if (String(state.houseCode || '').toUpperCase() === _rfHouse) {
              _rfHouseThreadIds.add(tid);
            }
          }
          // Also check inbox conversations
          for (const conv of _rfInbox) {
            const tid = String(conv.threadId || '');
            if (!tid) continue;
            let hc = String(conv.houseCode || '').toUpperCase().trim();
            if (!hc || hc === '?' || hc === 'UNKNOWN') {
              const state = _rfTS[tid];
              if (state?.houseCode) hc = String(state.houseCode).toUpperCase();
            }
            if (!hc || hc === '?' || hc === 'UNKNOWN') {
              const inferred = identifyHouseCodeFromConv(conv, _rfRooms);
              if (inferred) hc = inferred.toUpperCase();
            }
            if (hc === _rfHouse) _rfHouseThreadIds.add(tid);
          }

          const _rfTotalScanned = _rfHouseThreadIds.size;
          log(`[refresh/${_rfHouse}] ${_rfTotalScanned} house thread(s) found for refresh`);

          if (_rfTotalScanned === 0) {
            await sendTelegramMessage(chatId,
              `⚠️ No threads found for *${_rfHouse}*. Check house code or run /jess count to initialise.`,
              { parse_mode: 'Markdown' }
            ).catch(() => {});
            continue;
          }

          // 4. Per-thread refresh — fetch each thread and update thread-states
          let _rfRefreshed = 0;
          let _rfUpdated = 0;
          const _rfInboundRelevance = require('./modules/inbound-relevance');
          const _rfMatchers = _rfInboundRelevance.buildSnippetMatchers(_rfRooms);

          for (const tid of _rfHouseThreadIds) {
            try {
              const _rfThread = await fetchThread(tid);
              if (!_rfThread) continue;
              _rfRefreshed++;

              // Merge with conv
              const _rfConv = _rfInbox.find(c => String(c.threadId || '') === tid) || {};
              const _rfMerged = mergeThreadIntoConversation(_rfConv, _rfThread);

              // Inject state snippet as fallback
              const _rfState = _rfTS[tid] || {};
              if (_rfState.snippet && !_rfMerged._stateSnippet) _rfMerged._stateSnippet = _rfState.snippet;

              // Compute inbound relevance
              const _rfLifecycleHouse = String(_rfState.houseCode || _rfMerged.houseCode || '').toUpperCase() || null;
              const _rfIR = _rfInboundRelevance.computeInboundRelevance(_rfMerged, _rfLifecycleHouse, _rfRooms, _rfMatchers);

              // Update thread-states with fresh snippet + inbound relevance
              const _rfExisting = _rfTS[tid] || {};
              const _rfNewSnippet = (_rfIR.latestInboundSnippet || _rfMerged.snippet || '').slice(0, 200);
              const _rfChanged = (
                _rfExisting.latestInboundSnippet !== _rfNewSnippet ||
                _rfExisting.lastActive !== (_rfMerged.lastActive || _rfExisting.lastActive) ||
                _rfExisting.isUnread !== (_rfMerged.isUnread || _rfMerged.unread || false)
              );

              _rfTS[tid] = {
                ..._rfExisting,
                houseCode: _rfLifecycleHouse || _rfExisting.houseCode,
                updatedAt: new Date().toISOString(),
                lastActive: _rfMerged.lastActive || _rfExisting.lastActive,
                snippet: (_rfMerged.snippet || _rfExisting.snippet || '').slice(0, 200),
                latestInboundSnippet: _rfNewSnippet,
                latestInboundTimestamp: _rfIR.latestInboundTimestamp || _rfExisting.latestInboundTimestamp,
                currentInboundRelevance: _rfIR.currentInboundRelevance,
                relevanceSource: _rfIR.relevanceSource,
                crossHouseFresh: _rfIR.crossHouseFresh,
                isUnread: _rfMerged.isUnread || _rfMerged.unread || false,
              };
              if (_rfChanged) _rfUpdated++;

              // Small rate-limit delay between thread fetches
              await new Promise(r => setTimeout(r, 400));
            } catch (_rfTErr) {
              log(`[refresh/${_rfHouse}] thread ${tid} fetch error (non-fatal): ${_rfTErr.message}`);
            }
          }

          // 5. Persist updated thread-states (with house-level refresh timestamp)
          try {
            // Store a house-level refresh timestamp so /jess count can report it
            _rfTS[`__houseRefresh_${_rfHouse}`] = {
              lastRefreshedAt: new Date().toISOString(),
              threadsScanned: _rfTotalScanned,
              threadsUpdated: _rfUpdated,
              threadsFetched: _rfRefreshed,
            };
            saveJSON(_rfTsPath, _rfTS);
          } catch (_rfSaveErr) {
            log(`[refresh/${_rfHouse}] saveJSON error: ${_rfSaveErr.message}`);
          }

          const _rfElapsed = Math.round((Date.now() - _rfStarted) / 1000);
          const _rfTs = new Date().toISOString();
          const _rfReply = [
            `✅ *${_rfHouse}* refresh complete`,
            ``,
            `📊 House threads scanned: ${_rfTotalScanned}`,
            `🔄 Threads fetched: ${_rfRefreshed}`,
            `📝 Threads updated: ${_rfUpdated}`,
            `⏱ Duration: ${_rfElapsed}s`,
            `🕐 Timestamp: ${_rfTs}`,
          ].join('\n');
          await sendTelegramMessage(chatId, _rfReply, { parse_mode: 'Markdown' }).catch(() => {});
          log(`[refresh/${_rfHouse}] done: scanned=${_rfTotalScanned} refreshed=${_rfRefreshed} updated=${_rfUpdated} elapsed=${_rfElapsed}s`);
        } catch (_rfErr) {
          const _rfErrMsg = `❌ Refresh error for *${_rfHouse}*: ${_rfErr.message}`;
          log(`[refresh/${_rfHouse}] error: ${_rfErr.message}`, 'ERROR');
          await sendTelegramMessage(chatId, _rfErrMsg, { parse_mode: 'Markdown' }).catch(() => {});
        }
        continue;
      }

      // /jess count <house> [age <N] [by state|by reason] [debug]
      const houseCountMatch = textMsg.match(/^\/jess\s+count\s+(\w+)(?:\s+age\s*<\s*(\d+))?(?:\s+(by\s+(state|reason)))?(?:\s+(debug))?$/i);
      if (houseCountMatch) {
        const [, houseRaw, ageMaxRaw, byModeFlag, byModeValue, debugFlag] = houseCountMatch;
        const house      = houseRaw.toUpperCase();
        const ageMax     = ageMaxRaw ? parseInt(ageMaxRaw, 10) : null;
        const byState    = String(byModeValue || '').toLowerCase() === 'state';
        const byReason   = String(byModeValue || '').toLowerCase() === 'reason';
        const debugMode  = !!debugFlag;
        const campaignId = `house-${house}`;
        log(`[count/${house}] command parsed: house=${house} campaignId=${campaignId} ageMax=${ageMax ?? 'none'} byReason=${byReason} chatId=${chatId}`);
        let houseCountReplyText = null;
        try {
          log(`[count/${house}] calling getCampaignEligibilitySummary`);
          const summary = await getCampaignEligibilitySummary(house, campaignId, { fresh: true });
          log(`[count/${house}] result — matched=${summary.matchedThreads} sendable=${summary.safeCount} blocked=${summary.blockedCount} excluded=${summary.excludedCount} source=${summary.source}`);
          const stateCounts = (() => {
            try {
              const { buildStateCounts } = require('./modules/thread-classifier');
              return buildStateCounts(summary.classifiedReport?.classified || []);
            } catch (_) {
              return null;
            }
          })();

          // Apply age filter post-eligibility if requested
          let safeCount = summary.safeCount;
          if (ageMax !== null) {
            const filtered = applyAgeFilter(summary.safeThreads, ageMax);
            safeCount = filtered.length;
            log(`[count/${house}] age filter applied: age<${ageMax} — ${safeCount} of ${summary.safeCount} sendable remain`);
          }

          // ── Human-readable reason labels ──────────────────────────────────
          const REASON_LABELS = {
            sendable_now:                'sendable now',
            already_sent_exact_campaign: 'already sent this exact campaign',
            recently_invited:            'recently invited',
            cooldown:                    'cooldown',
            jess_replied_last:           'Jess replied last',
            opted_out:                   'opted out',
            archived_dead:               'archived/dead',
            inactive_platform:           'inactive / left platform',
            inactive_gt_3d:              'inactive >3 days',
            invalid_threadId:            'invalid threadId',
            duplicate_active_batch:      'duplicate send in active batch',
          };

          // ── Summary line ──────────────────────────────────────────────────
          const ageLabel = ageMax !== null ? ` (age <${ageMax})` : '';
          const lifecycleTotal = summary.lifecycleThreadIds ? summary.lifecycleThreadIds.length : '?';
          houseCountReplyText = `${house} lifecycle total: ${lifecycleTotal} / matched threads: ${summary.matchedThreads} / sendable now: ${safeCount}${ageLabel} / blocked: ${summary.blockedCount} / excluded: ${summary.excludedCount}`;

          // ── by reason breakdown ───────────────────────────────────────────
          if (byState && stateCounts) {
            const lines = [
              'By state:',
              `  • unread: ${stateCounts.unread}`,
              `  • read: ${stateCounts.read}`,
              `  • responded before: ${stateCounts.respondedBefore}`,
              `  • invited before: ${stateCounts.invitedBefore}`,
              `  • fresh inbound after Jess: ${stateCounts.freshInboundAfterJess}`,
              `  • duplicate in active batch: ${stateCounts.duplicateInActiveBatch}`,
              `  • opted out: ${stateCounts.optedOut}`,
              `  • inactive: ${stateCounts.inactive}`,
              `  • cross-house fresh relevant: ${stateCounts.crossHouseFresh}`,
            ];
            houseCountReplyText += '\n' + lines.join('\n');
          }

          if (byReason) {
            const rc = summary.reasonCounts || {};
            const lines = [];
            // blocked reasons first
            const BLOCKED_REASONS = ['opted_out', 'archived_dead', 'inactive_platform', 'inactive_gt_3d', 'invalid_threadId', 'duplicate_active_batch'];
            const EXCLUDED_REASONS = ['already_sent_exact_campaign', 'recently_invited', 'cooldown', 'jess_replied_last'];

            const blockedLines = BLOCKED_REASONS.filter(r => rc[r] > 0)
              .map(r => `  • ${REASON_LABELS[r] || r}: ${rc[r]}`);
            const excludedLines = EXCLUDED_REASONS.filter(r => rc[r] > 0)
              .map(r => `  • ${REASON_LABELS[r] || r}: ${rc[r]}`);
            // Catch any unknown reasons not in our lists
            const knownReasons = new Set([...BLOCKED_REASONS, ...EXCLUDED_REASONS]);
            const otherLines = Object.entries(rc)
              .filter(([r, n]) => !knownReasons.has(r) && n > 0)
              .map(([r, n]) => `  • ${r}: ${n}`);

            if (blockedLines.length)  { lines.push('Blocked:');  lines.push(...blockedLines); }
            if (excludedLines.length) { lines.push('Excluded:'); lines.push(...excludedLines); }
            if (otherLines.length)    { lines.push('Other:');    lines.push(...otherLines); }

            if (lines.length > 0) {
              houseCountReplyText += '\n' + lines.join('\n');
            } else {
              houseCountReplyText += '\n(no reasons to show — all threads sendable or unclassified)';
            }

            // ── Refresh + active-batch debug info ────────────────────────────
            try {
              const _tsPath = path.join(__dirname, 'data', 'jess-thread-states.json');
              const _tsData = loadJSON(_tsPath, {});
              const _houseRefreshMeta = _tsData[`__houseRefresh_${house}`] || null;
              const _houseTs = Object.entries(_tsData).filter(([k, s]) => !k.startsWith('__') && String(s.houseCode || '').toUpperCase() === house);
              const _lastRefresh = _houseRefreshMeta?.lastRefreshedAt
                || (_houseTs.filter(([, s]) => s.updatedAt).map(([, s]) => new Date(s.updatedAt).getTime()).filter(Boolean).length
                    ? new Date(Math.max(..._houseTs.filter(([, s]) => s.updatedAt).map(([, s]) => new Date(s.updatedAt).getTime()))).toISOString()
                    : 'never');
              const _refreshedInLast30m = _houseTs.filter(([, s]) => {
                const ua = s.updatedAt ? new Date(s.updatedAt).getTime() : 0;
                return (Date.now() - ua) < 30 * 60 * 1000;
              }).length;

              // Active batch state: check jess-campaign-progress.json for any running/stuck batches
              const _campProgress = loadJSON(path.join('/home/diegopalhano/projects/mission-control/data', 'jess-campaign-progress.json'), {});
              const _houseProgEntries = Object.values(_campProgress).filter(p => {
                return String(p.house || p.campaignId || '').toUpperCase().includes(house) ||
                       String(p.campaignId || '').includes(house);
              });
              const _activeBatches = _houseProgEntries.filter(p => p.state === 'running' || p.state === 'stuck');
              const _staleBatches = _houseProgEntries.filter(p => p.state === 'completed' || p.state === 'stuck');

              // Fresh-inbound override stats from classifier
              const _freshOverride = summary.classifiedReport?.debugFreshInboundOverrides || {};
              const _dedupBypassCount = _freshOverride.threadsSkippingDedup || 0;
              const _alreadySentBypassCount = _freshOverride.threadsSkippingAlreadySent || 0;

              const debugInfoLines = [
                `\n📊 Refresh + Batch Debug:`,
                `  • Last /jess refresh ${house}: ${_lastRefresh}` + (_houseRefreshMeta ? ` (scanned=${_houseRefreshMeta.threadsScanned} fetched=${_houseRefreshMeta.threadsFetched} updated=${_houseRefreshMeta.threadsUpdated})` : ''),
                `  • Threads refreshed in last 30m: ${_refreshedInLast30m} / ${_houseTs.length} in thread-states`,
                `  • Fresh-inbound overrides: ${_dedupBypassCount} threads bypassed dedup (replied after invite — now sendable)`,
                `  • Already-sent bypassed by fresh inbound: ${_alreadySentBypassCount} (correctly re-admitted)`,
              ];

              if (_activeBatches.length === 0 && _houseProgEntries.length === 0) {
                debugInfoLines.push(`  • Active batches: none (no campaign-progress entries for ${house})`);
                if (rc['duplicate_active_batch'] > 0) {
                  debugInfoLines.push(`  ⚠️  ${rc['duplicate_active_batch']} threads blocked as duplicate_active_batch but NO live batch exists — stale sent-log suppression`);
                }
              } else if (_activeBatches.length === 0) {
                debugInfoLines.push(`  • Active batches: none currently running (all completed/stuck)`);
                _staleBatches.forEach(p => {
                  const staleAge = p.completedAt ? `completed ${Math.round((Date.now() - new Date(p.completedAt).getTime()) / 60000)}m ago` : 'stuck';
                  debugInfoLines.push(`    - ${p.campaignId}: ${p.state} (${staleAge})`);
                });
              } else {
                _activeBatches.forEach(p => {
                  debugInfoLines.push(`  • Active batch: ${p.campaignId} state=${p.state} delivered=${p.delivered}/${p.total} startedAt=${p.startedAt}`);
                });
              }

              houseCountReplyText += debugInfoLines.join('\n');
            } catch (_byReasonDbgErr) {
              log(`[count/${house}] byReason debug info error (non-fatal): ${_byReasonDbgErr.message}`);
            }
          }

          // ── Debug diff section ─────────────────────────────────────────────
          if (debugMode) {
            // lifecycleThreadIds = 3-day window relay inbox threads for this house (matches Lead Count)
            // allLifecycleThreadIds = ALL jess-thread-states entries for this house (historical)
            const leadCountSet    = new Set(summary.lifecycleThreadIds || []);
            const allLifecycleSet = new Set(summary.allLifecycleThreadIds || summary.lifecycleThreadIds || []);
            const operationalSet  = new Set(summary.operationalThreadIds || []);
            const extraInOp       = [...operationalSet].filter(id => !leadCountSet.has(id));
            const missingFromOp   = [...leadCountSet].filter(id => !operationalSet.has(id));

            // Threads in jess-thread-states but outside 3-day relay window (old/stale)
            const staleLifecycle  = [...allLifecycleSet].filter(id => !leadCountSet.has(id));
            const extraInAllLC    = [...allLifecycleSet].filter(id => !leadCountSet.has(id));

            const debugLines = [
              `\n🔍 Debug: ${house} thread consistency`,
              `Source: Lead Count = 3-day relay window ∩ ${house} threads | Lifecycle (all) = jess-thread-states.json | Operational = buildCampaignInboxForHouse`,
              `Lead Count threadIds (${leadCountSet.size}): ${[...leadCountSet].join(', ') || '(none)'}`,
              `All Lifecycle threadIds (${allLifecycleSet.size}): ${[...allLifecycleSet].join(', ') || '(none)'}`,
              `Operational threadIds (${operationalSet.size}): ${[...operationalSet].join(', ') || '(none)'}`,
            ];

            if (staleLifecycle.length > 0) {
              debugLines.push(`\n⚠️ ${staleLifecycle.length} lifecycle thread(s) OUTSIDE 3-day relay window (explains Lead Count vs lifecycle discrepancy):`);
              // Try to enrich with detail from inbox (already fetched in buildCampaignInboxForHouse)
              // Use summary.inbox which is the operational inbox returned from buildCampaignInboxForHouse
              const _inboxById = {};
              for (const _t of (summary.inbox || [])) {
                const _tid = String(_t.threadId || '');
                if (_tid) _inboxById[_tid] = _t;
              }
              for (const _staleId of staleLifecycle) {
                const _st = _inboxById[_staleId];
                const _name = (_st?.name || _st?.memberName || '?').slice(0, 30);
                const _lastActive = _st?.lastActive || '(not in relay)';
                const _msgs = Array.isArray(_st?.messages) ? _st.messages : [];
                const _inboundMsgs = _msgs.filter(m => !(m.isMine || m.isOwn));
                const _outboundMsgs = _msgs.filter(m => (m.isMine || m.isOwn));
                const _latestInTs = (_inboundMsgs.length ? _inboundMsgs[_inboundMsgs.length - 1].sentAt : null) || '(no inbound ts)';
                const _latestOutTs = (_outboundMsgs.length ? _outboundMsgs[_outboundMsgs.length - 1].sentAt : null) || '(no outbound ts)';
                // Determine exclusion reason
                let _excReason = 'outside 3-day relay window';
                if (!_st) _excReason = 'not in relay inbox at all';
                debugLines.push(
                  `  • threadId=${_staleId} name="${_name}" lastActive=${_lastActive} ` +
                  `latestInbound=${_latestInTs} latestOutbound=${_latestOutTs} reason=${_excReason}`
                );
              }
            } else {
              debugLines.push(`✅ All lifecycle threads in 3-day relay window — Lead Count matches lifecycle`);
            }

            if (extraInOp.length > 0) {
              debugLines.push(`❌ Extra in operational (NOT in Lead Count window): ${extraInOp.join(', ')}`);
            } else {
              debugLines.push(`✅ No extra in operational — operational ⊆ lead-count window`);
            }
            if (missingFromOp.length > 0) {
              debugLines.push(`⚠️ Missing from operational (in Lead Count window but not fetched): ${missingFromOp.join(', ')}`);
            } else {
              debugLines.push(`✅ All Lead Count threads present in operational`);
            }

            // Summary: Lead Count total vs lifecycle total
            debugLines.push(
              `\n📊 Reconciliation: Lead Count total (3-day window)=${leadCountSet.size} | ` +
              `All Lifecycle total (jess-thread-states)=${allLifecycleSet.size} | ` +
              `Discrepancy=${allLifecycleSet.size - leadCountSet.size} (threads outside 3-day window)`
            );
            debugLines.push(
              `✅ /jess count ${house} lifecycle total now matches Lead Count: ${leadCountSet.size}`
            );

            houseCountReplyText += debugLines.join('\n');
          }

          log(`[count/${house}] reply text built: "${houseCountReplyText.slice(0, 120)}"`);
          try {
            await sendTelegramMessage(chatId, houseCountReplyText);
            log(`[count/${house}] reply sent OK`);
          } catch (sendErr) {
            logWarn(`[count/${house}] sendTelegramMessage failed (success path): ${sendErr.message}`);
            try {
              await sendTelegramMessage(chatId, houseCountReplyText);
              log(`[count/${house}] reply sent OK (retry)`);
            } catch (retryErr) {
              logWarn(`[count/${house}] sendTelegramMessage retry also failed: ${retryErr.message}`);
            }
          }
        } catch (countErr) {
          log(`[count/${house}] getCampaignEligibilitySummary threw: ${countErr.message}`, 'ERROR');
          houseCountReplyText = `❌ Count error for ${house}: ${countErr.message}`;
          log(`[count/${house}] reply text built (error path): "${houseCountReplyText}"`);
          try {
            await sendTelegramMessage(chatId, houseCountReplyText);
            log(`[count/${house}] error reply sent OK`);
          } catch (sendErr) {
            logWarn(`[count/${house}] sendTelegramMessage failed (error path): ${sendErr.message}`);
            try {
              await sendTelegramMessage(chatId, houseCountReplyText);
              log(`[count/${house}] error reply sent OK (retry)`);
            } catch (retryErr) {
              logWarn(`[count/${house}] sendTelegramMessage retry also failed (error path): ${retryErr.message}`);
            }
          }
        }
        log(`[count/${house}] handler complete — reply was: ${houseCountReplyText ? JSON.stringify(houseCountReplyText.slice(0, 80)) : 'null (no reply built)'}`);
        continue;
      }

      // Extended regex: /jess campaign SH1 46 batch 10 [age <40] [force]
      // Groups: 1=house, 2=amount (all|N), 3=batchSize (from "batch N"), 4=ageMax, 5=force flag
      const campaignHouseMatch = textMsg.match(/^\/jess\s+campaign\s+(\w+)(?:\s+(all|\d+))?(?:\s+batch\s+(\d+))?(?:\s+age\s*<\s*(\d+))?(?:\s+(force))?$/i);
      if (campaignHouseMatch) {
        const [, houseCodeRaw, amountRaw, batchSizeRaw, ageMaxRaw, forceFlag] = campaignHouseMatch;
        const forceOverride = String(forceFlag || '').toLowerCase() === 'force';
        const house = houseCodeRaw.toUpperCase();
        const ageMax = ageMaxRaw ? parseInt(ageMaxRaw, 10) : null;
        const requestedBatchSize = batchSizeRaw ? parseInt(batchSizeRaw, 10) : null;
        const amountToken = amountRaw != null ? String(amountRaw).toLowerCase() : '(none)';
        log(`[campaign-parse] house=${house} amountToken=${amountToken} batchSize=${requestedBatchSize ?? 'none'} ageMax=${ageMax ?? 'none'} force=${forceOverride}`, 'INFO');
        const inspection = getInspectionForRoom(house);
        log(`[campaign-parse] inspectionLoaded=${!!inspection} house=${house}`, 'INFO');
        if (!inspection) {
          await sendTelegramMessage(chatId, `❌ No saved inspection found for ${house}. Set one first with \`/jess inspection ${house} <natural-date> <time> <slot-interval> <block-length> <assistant> <amount>\`.`, { parse_mode: 'Markdown' }).catch(()=>{});
          continue;
        }
        const savedAmount = Number(inspection.amount || inspection.leadAmount || 0);
        const requestedAmount = amountRaw == null ? (savedAmount > 0 ? savedAmount : null) : (String(amountRaw).toLowerCase() === 'all' ? 'all' : parseInt(amountRaw, 10));
        log(`[campaign-parse] savedAmount=${savedAmount} requestedAmount=${requestedAmount} (resolvedFrom=${amountToken})`, 'INFO');
        if (!(requestedAmount === 'all' || (Number.isFinite(requestedAmount) && requestedAmount > 0))) {
          await sendTelegramMessage(chatId, `❌ No valid amount for ${house}. Save one with \`/jess inspection ${house} <natural-date> <time> <slot-interval> <block-length> <assistant> <amount>\`, or run \`/jess campaign ${house} <amount>\`.`, { parse_mode: 'Markdown' }).catch(()=>{});
          continue;
        }

        const houseCampaign = buildHouseCampaignConfig(house, inspection, requestedAmount);
        if (!houseCampaign) {
          await sendTelegramMessage(chatId, `❌ Could not build a campaign message for ${house} from the saved inspection block.`, { parse_mode: 'Markdown' }).catch(()=>{});
          continue;
        }
        const storedCampaign = upsertHouseCampaignConfig(houseCampaign);
        const campaignId = storedCampaign?.id || houseCampaign.id;

        try {
          const campaignRunner = require('./modules/campaign-runner');
          const campaign = campaignRunner.loadCampaign(campaignId) || storedCampaign || houseCampaign;
          // Always build candidate pool from fresh thread data
          log(`[campaign-preview] house=${house} campaignId=${campaignId} building eligibility summary (fresh=true force=${forceOverride})`, 'INFO');
          const summary = await getCampaignEligibilitySummary(house, campaignId, { fresh: true, forceOverride });
          // safeThreads are full thread objects from the fresh inbox — identity preserved
          let threads = summary.safeThreads;
          log(`[campaign-preview] house=${house} candidatePoolSize=${summary.eligibleCount} sendableSize=${threads.length} blockedCount=${summary.blockedCount} excludedCount=${summary.excludedCount ?? '?'}`, 'INFO');

          // Apply age filter post-eligibility if requested (current run only, no state change)
          if (ageMax !== null) {
            const beforeAgeFilter = threads.length;
            threads = applyAgeFilter(threads, ageMax);
            log(`[campaign-preview] age filter applied: age<${ageMax} — ${threads.length} of ${beforeAgeFilter} safe threads remain`, 'INFO');
          }

          // Resolve 'all' to the actual sendable count — never leave it symbolic
          const resolvedAmount = requestedAmount === 'all' ? threads.length : requestedAmount;
          if (requestedAmount === 'all') {
            log(`[campaign-preview] Resolved amount: all -> ${resolvedAmount} (sendable threads)`, 'INFO');
          }

          let effectiveCount = resolvedAmount === 0 ? 0 : Math.min(threads.length, resolvedAmount);

          // Apply batch size cap if "batch N" was specified
          if (requestedBatchSize && requestedBatchSize > 0) {
            effectiveCount = Math.min(effectiveCount, requestedBatchSize);
            log(`[campaign-preview] batch size cap applied: batch=${requestedBatchSize} → effectiveCount=${effectiveCount}`, 'INFO');
          }

          if (!threads.length || effectiveCount <= 0) {
            log(`[campaign-preview] house=${house} no eligible threads (sendable=${threads.length} effectiveCount=${effectiveCount}) — sending empty-pool message`, 'INFO');
            await sendTelegramMessage(chatId,
              [
                `📌 *Saved inspection block: ${house}*`,
                `🗓 Input date: ${inspection.naturalDateLabel || inspection.naturalDateRaw || inspection.date}`,
                `📅 Resolved date: ${formatDateAuNumeric(inspection.date || '') || inspection.date}`,
                `🕒 Time: ${format12hr(inspection.time || '').replace(/^0/, '') || inspection.time}`,
                `👥 Requested amount: ${amountToken === 'all' ? `all eligible (resolved → ${resolvedAmount})` : resolvedAmount}${requestedBatchSize ? ` (batch ${requestedBatchSize})` : ''}`,
                `📊 Eligible leads: ${summary.eligibleCount} / Safe to send: ${threads.length}${ageMax !== null ? ` (age <${ageMax})` : ''} / Blocked: ${summary.blockedCount}`,
                ageMax !== null ? `Filter: age <${ageMax}` : null,
                '',
                `📋 No eligible threads found for *${house}* right now.`
              ].filter(l => l !== null).join('\n'),
              { parse_mode: 'Markdown' }
            ).catch(e => log(`[campaign-preview] sendTelegramMessage (empty pool) failed: ${e.message}`, 'WARN'));
            continue;
          }

          const batchThreads = threads.slice(0, effectiveCount);

          // Build preview lines with full thread identity for transparency
          const previewLines = batchThreads.map((t, i) => {
            const name = (t.name || t.memberName || 'Unknown').slice(0, 25);
            const threadId = t.threadId;
            const activeLabel = formatActiveLabel(t.lastActive || '?');
            // Prefer latest inbound message text for snippet
            const inboundMsgs = Array.isArray(t.messages) ? t.messages.filter(m => !(m.isMine || m.isOwn)) : [];
            const latestInbound = inboundMsgs.length ? inboundMsgs[inboundMsgs.length - 1] : null;
            const latestInboundTs = latestInbound?.sentAt || latestInbound?.timestamp || null;
            const inboundText = String(latestInbound?.text || latestInbound?.body || t.snippet || t.lastMessage || '').slice(0, 60);
            const snippetLabel = inboundText ? ` | "${inboundText}"` : '';
            const inboundTsLabel = latestInboundTs ? ` | inbound=${latestInboundTs}` : '';
            return `${i + 1}. *${name}* (${threadId}) | ${activeLabel}${inboundTsLabel}${snippetLabel}`;
          });

          // Build repeat-contact skipped lines for transparency in the preview (up to 10 shown)
          const rcSkipped = summary.rcBuckets ? (summary.rcBuckets.skipped_recent_invite || 0) +
            (summary.rcBuckets.skipped_same_date || 0) + (summary.rcBuckets.skipped_replied || 0) +
            (summary.rcBuckets.skipped_unanswered_48h || 0) : 0;
          const rcSkippedLines = [];
          if (rcSkipped > 0 && summary.rcBuckets) {
            rcSkippedLines.push('');
            rcSkippedLines.push(`🚫 *Repeat-contact skips (${rcSkipped}):*`);
            if (summary.rcBuckets.skipped_recent_invite)  rcSkippedLines.push(`  • Invited <24h ago: ${summary.rcBuckets.skipped_recent_invite}`);
            if (summary.rcBuckets.skipped_unanswered_48h) rcSkippedLines.push(`  • Unanswered 24–48h: ${summary.rcBuckets.skipped_unanswered_48h}`);
            if (summary.rcBuckets.skipped_same_date)      rcSkippedLines.push(`  • Same inspection date: ${summary.rcBuckets.skipped_same_date}`);
            if (summary.rcBuckets.skipped_replied)        rcSkippedLines.push(`  • Replied after invite: ${summary.rcBuckets.skipped_replied}`);
            if (forceOverride) rcSkippedLines.push(`  _(force flag set — cooldowns ignored)_`);
          }

          // Persist full thread objects so confirm uses the exact same resolved threads
          const pendingCampaignSendJob = {
            campaignId,
            batchId: Date.now().toString(36) + Math.random().toString(36).slice(2),
            house,
            inspectionDate: summary.inspectionDate || inspection.date || null,
            forceOverride: forceOverride || false,
            threads: batchThreads,   // full thread objects from fresh inbox (age-filtered if applicable)
            candidatePool: threads,  // full candidate pool for skip rotation
            skippedInSession: [],    // threadIds skipped during this preview session
            batchSize: effectiveCount,
            limit: effectiveCount,   // always numeric — 'all' was resolved above
            requestedBatchSize: requestedBatchSize || null,
            message: campaign.message,
            createdAt: new Date().toISOString(),
            createdBy: String(msg?.from?.username || msg?.from?.id || chatId || 'telegram'),
            expiresAt: Date.now() + 2 * 60 * 1000,
          };
          savePendingCampaignSendJob(pendingCampaignSendJob);

          log(
            `[campaign-preview] house=${house} campaignId=${campaignId} batchId=${pendingCampaignSendJob.batchId} ` +
            `amountToken=${amountToken} resolvedAmount=${resolvedAmount} ` +
            `ageMax=${ageMax ?? 'none'} requestedBatchSize=${requestedBatchSize ?? 'none'} effectiveCount=${effectiveCount} ` +
            `previewBuilt=yes threadIds=${batchThreads.map(t=>t.threadId).join(',')}`,
            'INFO'
          );

          const resolvedAmountLabel = amountToken === 'all'
            ? `all eligible (resolved → ${resolvedAmount})`
            : String(resolvedAmount);

          const previewHeaderLines = [
            `📌 *Saved inspection block: ${house}*`,
            `🗓 Input date: ${inspection.naturalDateLabel || inspection.naturalDateRaw || inspection.date}`,
            `📅 Resolved date: ${formatDateAuNumeric(inspection.date || '') || inspection.date}`,
            `🕒 Time: ${format12hr(inspection.time || '').replace(/^0/, '') || inspection.time}`,
            `⏱ Slot interval: ${inspection.slot_interval_minutes || inspection.intervalMins || inspection.slotInterval || '?'} min`,
            `🧱 Block length: ${inspection.block_length_minutes || inspection.blockLengthMins || inspection.blockLength || inspection.durationMins || '?'} min`,
            `👤 Assistant: ${inspection.assistant || inspection.host || '—'}`,
            `👥 Requested amount: ${resolvedAmountLabel}${requestedBatchSize ? ` (batch size: ${requestedBatchSize})` : ''}`,
            `📊 Eligible leads: ${summary.eligibleCount} / Safe to send: ${threads.length}${ageMax !== null ? ` (age <${ageMax})` : ''} / Blocked: ${summary.blockedCount}`,
            `🔄 Source: ${summary.source || 'fresh'}`,
            forceOverride ? `⚡ *Force override active* — repeat-contact cooldowns ignored` : null,
            ageMax !== null ? `Filter: age <${ageMax}` : null,
            requestedBatchSize ? `📦 Batch: sending ${effectiveCount} of ${threads.length} eligible (batch size ${requestedBatchSize})` : null,
            '',
            `📣 *Campaign send preview: ${campaign.name}*`,
            `Will send to *${effectiveCount}* thread(s) — these are the exact threads confirm will use:`,
          ].filter(l => l !== null);

          const previewFooterLines = [
            ...rcSkippedLines,
            '',
            '*Message:*',
            '```',
            String(campaign.message || '').trim(),
            '```',
            '',
            '⚠️ Reply *confirm* to send, *cancel* to abort, or *skip* / *skip N* to swap the top N candidate(s). (Expires in 2 minutes)',
          ];

          // Use chunked send to avoid hitting the 4096-char Telegram limit silently
          await sendTelegramChunked(chatId,
            [...previewHeaderLines, ...previewLines, ...previewFooterLines].join('\n'),
            { parse_mode: 'Markdown' }
          );
          log(`[campaign-preview] house=${house} preview message sent successfully`, 'INFO');
        } catch (campErr) {
          log(`[campaign-preview] house=${house} error: ${campErr.message}`, 'WARN');
          await sendTelegramMessage(chatId, `❌ Campaign error: ${campErr.message}`).catch(()=>{});
        }
        continue;
      }

      const campaignMatch = textMsg.match(/^\/jess\s+campaign\s+(count|preview|send|debug)\s+(\S+)(?:\s+(\S+))?$/i);
      if (campaignMatch) {
        const [, subCmd, campaignId, sendLimitRaw] = campaignMatch;
        const sub = subCmd.toLowerCase();
        try {
          const campaignRunner = require('./modules/campaign-runner');
          const campaignDedup    = require('./modules/campaign-dedup');
          const campaign = campaignRunner.loadCampaign(campaignId);
          if (!campaign) {
            await sendTelegramMessage(chatId, `❌ Campaign not found: \`${campaignId}\``, { parse_mode: 'Markdown' }).catch(()=>{});
            continue;
          }
          // Always rebuild candidate pool from a fresh scrape — never use stale persisted state
          log(`[v4-campaign] rebuilding candidate pool from fresh inbox for campaignId=${campaignId} house=${campaign.houseCode}`, 'INFO');
          const _freshResult = await buildCampaignInboxForHouse(campaign.houseCode, { fresh: true })
            .catch(err => { log('[v4-campaign] fresh build failed: ' + err.message, 'WARN'); return { inbox: [], source: 'error' }; });
          let campInbox = _freshResult.inbox || [];
          log(`[v4-campaign] fresh inbox built: total=${campInbox.length} source=${_freshResult.source}`, 'INFO');

          if (sub === 'debug') {
            try {
              const rawCount = campInbox.length;
              const _dbgCF = require('./modules/campaign-filter');
              const sentFile = '/home/diegopalhano/projects/mission-control/data/jess-campaign-sent.json';
              let sentSet = new Set();
              try { sentSet = new Set((JSON.parse(require('fs').readFileSync(sentFile,'utf8'))[campaignId]||[])); } catch(_){}
              
              const sp9threads = campInbox.filter(c => c.houseCode === campaign.houseCode);
              // Use the same campaign filter as count — single source of truth
              const eligibleThreads = await _dbgCF.filterEligible(campaign.houseCode, campInbox, campaignId);
              const eligibleSet = new Set(eligibleThreads.map(c => String(c.threadId)));
              const freshEligible = eligibleThreads.filter(c => !sentSet.has(String(c.threadId)));
              
              let tooOld=0, inactive=0, alreadySent=0, wrongStage=0, missingFields=0;
              const eligible = freshEligible.length;
              const details = [];
              
              // Per-thread diagnosis
              const now = Date.now();
              const sevenDaysAgo = now - 7*24*60*60*1000;
              const twoDaysAgo = now - 2*24*60*60*1000;
              for (const c of sp9threads) {
                const reasons = [];
                const updMs = Date.parse(c.updatedAt||0)||0;
                const laStr = String(c.lastActive||'').toLowerCase().trim();
                let actMs;
                if (!laStr||laStr==='online now'||laStr==='online today'||laStr==='active today') actMs=now;
                else if (laStr==='active yesterday'||laStr==='online yesterday') actMs=now-86400000;
                else { const dm=laStr.match(/(\d+)\s+days?\s+ago/); actMs=dm?now-parseInt(dm[1])*86400000:(Date.parse(c.lastActive)||Date.parse(c.updatedAt||0)||0); }
                
                if (!updMs){reasons.push('missing_updatedAt');missingFields++;}
                else if(updMs<sevenDaysAgo){reasons.push('too_old');tooOld++;}
                if(!actMs){reasons.push('missing_lastActive');missingFields++;}
                else if(actMs<twoDaysAgo){reasons.push('inactive');inactive++;}
                if(c.stage==='dead'){reasons.push('wrong_stage');wrongStage++;}
                if(sentSet.has(String(c.threadId))){reasons.push('already_sent');alreadySent++;}
                
                const isElig = eligibleSet.has(String(c.threadId)) && !sentSet.has(String(c.threadId));
                const _reactivatedTag = c._reactivated ? '|reactivated=yes' : '';
                // Include latest inbound text in debug output
                const _inbMsgs = Array.isArray(c.messages) ? c.messages.filter(m => !(m.isMine || m.isOwn)) : [];
                const _lastIn = _inbMsgs.length ? _inbMsgs[_inbMsgs.length - 1] : null;
                const _inText = String(_lastIn?.text || _lastIn?.body || '').slice(0, 50);
                const _inTs = _lastIn?.sentAt || _lastIn?.timestamp || '';
                details.push(`${c.threadId}|${(c.name||'?').slice(0,20)}|act=${c.lastActive||'?'}|inTs=${_inTs}|in="${_inText}"${_reactivatedTag}|${isElig?'✅':reasons.join(',')||'❌'}`);
              }
              
              const { execSync } = require('child_process');
              const commit = execSync('git -C /home/diegopalhano/projects/jess-bot rev-parse --short HEAD 2>/dev/null').toString().trim();
              
              const summary = [
                `🔍 Debug: ${campaignId} (${campaign.houseCode}) [fresh inbox]`,
                `Commit: ${commit}`,
                `Fresh inbox: total=${rawCount} | ${campaign.houseCode}=${sp9threads.length}`,
                `too_old: ${tooOld} | inactive: ${inactive} | already_sent: ${alreadySent} | wrong_stage: ${wrongStage} | missing: ${missingFields}`,
                `Final eligible: ${eligible}`,
                '',
                ...details.slice(0,15)
              ].join('\n');
              
              // Send in chunks if too long
              const chunks = [];
              let cur = '';
              for (const line of summary.split('\n')) {
                if ((cur+line).length > 3800) { chunks.push(cur); cur = ''; }
                cur += line + '\n';
              }
              if (cur) chunks.push(cur);
              for (const chunk of chunks) {
                await sendTelegramMessage(chatId, chunk).catch(()=>{});
              }
            } catch(_de){ await sendTelegramMessage(chatId,'debug err: '+_de.message).catch(()=>{}); }
            continue;
          }

          // For count/preview/send: use filterEligible directly on fresh inbox (full thread objects preserved)
          const _campFilter = require('./modules/campaign-filter');
          const _campEligible = await _campFilter.filterEligible(campaign.houseCode, campInbox, campaignId);
          let _campSentSet = new Set();
          try {
            const _campSentPath = require('path').join(__dirname, '..', 'mission-control', 'data', 'jess-campaign-sent.json');
            const _campSentData = loadJSON(_campSentPath, {});
            _campSentSet = new Set(_campSentData[campaignId] || []);
          } catch (_) {}
          // Full thread objects, not yet sent — identity preserved from fresh inbox
          const _campFreshThreads = _campEligible.filter(t => !_campSentSet.has(String(t.threadId || '')));

          if (sub === 'count') {
            await sendTelegramMessage(chatId,
              `📊 *Campaign: ${campaign.name}*\n🏠 House: ${campaign.houseCode}\n👥 Eligible (not yet sent): *${_campFreshThreads.length}*\nMax batch: ${campaign.maxBatch}\n🔄 Source: fresh`,
              { parse_mode: 'Markdown' }
            ).catch(()=>{});
            continue;
          }

          if (sub === 'preview') {
            if (!_campFreshThreads.length) {
              await sendTelegramMessage(chatId, `📋 *${campaign.name}* — no eligible threads found.`, { parse_mode: 'Markdown' }).catch(()=>{});
              continue;
            }
            const lines = _campFreshThreads.slice(0, 20).map((t, i) => {
              const name = (t.name || t.memberName || 'Unknown').slice(0, 25);
              const activeLabel = formatActiveLabel(t.lastActive || '?');
              const inboundMsgs = Array.isArray(t.messages) ? t.messages.filter(m => !(m.isMine || m.isOwn)) : [];
              const latestInbound = inboundMsgs.length ? inboundMsgs[inboundMsgs.length - 1] : null;
              const latestInboundTs = latestInbound?.sentAt || latestInbound?.timestamp || t.latestInboundTimestamp || null;
              const inboundText = String(latestInbound?.text || latestInbound?.body || t.latestInboundSnippet || t.snippet || '').slice(0, 60);
              const tsPart = latestInboundTs ? ` | inbound=${latestInboundTs}` : '';
              const snippetPart = inboundText ? ` | "${inboundText}"` : '';
              // Flag cross-house surfaced threads
              const crossTag = t._crossHouseSurfaced
                ? ` 🔀 lifecycle=${t.lifecycleHouse}→${t.currentInboundRelevance}`
                : (t.crossHouseFresh ? ` 🔀 cross=${t.currentInboundRelevance}` : '');
              const freshTag = t.freshInboundAfterOutbound ? ' ⚡' : '';
              return `${i + 1}. *${name}* (${t.threadId}) | ${activeLabel}${freshTag}${crossTag}${tsPart}${snippetPart}`;
            });
            await sendTelegramMessage(chatId,
              [`📋 *Preview: ${campaign.name}* (${_campFreshThreads.length} eligible, fresh inbox)`, ...lines].join('\n'),
              { parse_mode: 'Markdown' }
            ).catch(()=>{});
            continue;
          }

          if (sub === 'send') {
            const limit = sendLimitRaw === 'all' ? 'all' : (parseInt(sendLimitRaw, 10) || campaign.maxBatch || 5);
            const effectiveCount = limit === 'all' ? Math.min(_campFreshThreads.length, campaign.maxBatch || _campFreshThreads.length) : Math.min(_campFreshThreads.length, typeof limit === 'number' ? limit : _campFreshThreads.length);

            if (!_campFreshThreads.length) {
              await sendTelegramMessage(chatId, `📋 *${campaign.name}* — no eligible threads to send to.`, { parse_mode: 'Markdown' }).catch(()=>{});
              continue;
            }

            const batchThreads = _campFreshThreads.slice(0, effectiveCount);

            // Run dedup checks for all batch threads in parallel
            const dedupResults = await Promise.all(
              batchThreads.map(t =>
                campaignDedup.checkThread(String(t.threadId), campaignId, campaign.message, { forceSent: false, relayGet: null })
                  .catch(() => ({ decision: 'safe_to_retry', reason: 'check_error' }))
              )
            );

            const previewLines = batchThreads.map((t, i) => {
              const name      = (t.name || t.memberName || 'Unknown').slice(0, 25);
              const threadId  = t.threadId;
              const activeLabel = formatActiveLabel(t.lastActive || '?');
              const inboundMsgs = Array.isArray(t.messages) ? t.messages.filter(m => !(m.isMine || m.isOwn)) : [];
              const latestInbound = inboundMsgs.length ? inboundMsgs[inboundMsgs.length - 1] : null;
              const latestInboundTs = latestInbound?.sentAt || latestInbound?.timestamp || null;
              const inboundText = String(latestInbound?.text || latestInbound?.body || t.snippet || '').slice(0, 60);
              const isUnanswered = t.lastFrom === 'lead' || (t.lastFrom == null && (t.isUnread || t.unread));
              const unansweredLabel = isUnanswered ? ' | unanswered' : '';
              const tsPart = latestInboundTs ? ` | inbound=${latestInboundTs}` : '';
              const snippetLabel = inboundText ? ` | "${inboundText}"` : '';
              const dedup = dedupResults[i] || {};
              const dedupDecision = dedup.decision || 'safe_to_send';
              const dedupFlag = dedupDecision === 'skip_duplicate' ? ' 🚫' : dedupDecision === 'review_manually' ? ' ⚠️' : '';
              return `${i + 1}. *${name}* (${threadId}) | ${activeLabel}${unansweredLabel}${tsPart} | ${dedupDecision}${dedupFlag}${snippetLabel}`;
            });

            // Log per-thread selection details
            for (let _si = 0; _si < batchThreads.length; _si++) {
              const _st = batchThreads[_si];
              const _sd = dedupResults[_si] || {};
              const _inbMsgs = Array.isArray(_st.messages) ? _st.messages.filter(m => !(m.isMine || m.isOwn)) : [];
              const _lastIn = _inbMsgs.length ? _inbMsgs[_inbMsgs.length - 1] : null;
              const _outbMsgs = Array.isArray(_st.messages) ? _st.messages.filter(m => (m.isMine || m.isOwn)) : [];
              const _lastOut = _outbMsgs.length ? _outbMsgs[_outbMsgs.length - 1] : null;
              log(
                `[campaign-select/send] threadId=${_st.threadId} name=${(_st.name||'?').slice(0,30)} ` +
                `houseCode=${_st.houseCode||'?'} lastActive=${_st.lastActive||'n/a'} lastFrom=${_st.lastFrom||'n/a'} ` +
                `latestInboundTs=${_lastIn?.sentAt||_lastIn?.timestamp||'n/a'} latestInboundText="${String(_lastIn?.text||_lastIn?.body||'').slice(0,80)}" ` +
                `latestOutboundTs=${_lastOut?.sentAt||_lastOut?.timestamp||'n/a'} ` +
                `scrapeFreshness=${_st.updatedAt||_st.scrapedAt||'n/a'} ` +
                `dedupDecision=${_sd.decision||'safe_to_send'} selectedForSend=true`,
                'INFO'
              );
            }

            const pendingCampaignSendJob = {
              campaignId,
              batchId: Date.now().toString(36) + Math.random().toString(36).slice(2),
              house: campaign.houseCode || campaign.house || null,
              threads: batchThreads,   // full thread objects from fresh inbox
              candidatePool: _campFreshThreads, // full candidate pool for skip rotation
              skippedInSession: [],             // threadIds skipped during this preview session
              batchSize: effectiveCount,
              limit,
              message: campaign.message,
              createdAt: new Date().toISOString(),
              createdBy: String(msg?.from?.username || msg?.from?.id || chatId || 'telegram'),
              expiresAt: Date.now() + 2 * 60 * 1000,
            };
            savePendingCampaignSendJob(pendingCampaignSendJob);

            log(
              `[campaign-preview/send] campaignId=${campaignId} batchId=${pendingCampaignSendJob.batchId} ` +
              `effectiveCount=${effectiveCount} threadIds=${batchThreads.map(t=>t.threadId).join(',')}`,
              'INFO'
            );

            await sendTelegramMessage(chatId,
              [
                `📣 *Campaign send preview: ${campaign.name}*`,
                `🔄 Source: fresh inbox`,
                `Will send to *${effectiveCount}* thread(s) — these are the exact threads confirm will use:`,
                ...previewLines,
                '',
                '*Message:*',
                '```',
                String(campaign.message || '').trim(),
                '```',
                '',
                '⚠️ Reply *confirm* to send, *cancel* to abort, or *skip* / *skip N* to swap the top N candidate(s). (Expires in 2 minutes)',
              ].join('\n'),
              { parse_mode: 'Markdown' }
            ).catch(()=>{});
            continue;
          }
        } catch (campErr) {
          await sendTelegramMessage(chatId, `❌ Campaign error: ${campErr.message}`).catch(()=>{});
          continue;
        }
      }
      // ── end campaign commands ─────────────────────────────────────────────

      if (textLower === '/jess houses') {
        const rooms = loadRooms();
        const grouped = [...new Set(rooms.map(r => `${(r.houseCode || '').toUpperCase()}|${r.real_address || r.listing_address || getHouseAddress(r.houseCode)}`))].sort();
        const lines = grouped.map(v => {
          const [code, addr] = v.split('|');
          return `• ${code} - ${addr}`;
        });
        await sendTelegramMessage(chatId, lines.length ? ['*Configured houses*', ...lines].join('\n') : 'No houses configured.', { parse_mode: 'Markdown' }).catch(()=>{});
        continue;
      }

      const houseAddMatch = textMsg.match(/^\/jess\s+houses\s+add\s+(\w+)\s+(.+)$/i);
      if (houseAddMatch) {
        const [, codeRaw, address] = houseAddMatch;
        const code = codeRaw.toUpperCase();
        const rooms = loadRooms();
        if (rooms.some(r => String(r.houseCode || '').toUpperCase() === code)) {
          await sendTelegramMessage(chatId, `${code} already exists in rooms.`).catch(()=>{});
          continue;
        }
        rooms.push({ id: `${code.toLowerCase()}-r1`, houseCode: code, room: 'R1', price: null, couple_price: null, singles_only: false, available: false, available_date: null, listing_url: null, listing_address: address, real_address: address, assistant: null, notes: 'Added via /jess houses add' });
        saveRooms(rooms);
        await sendTelegramMessage(chatId, `🏠 Added house ${code} - ${address}`).catch(()=>{});
        continue;
      }

      const houseRemMatch = textMsg.match(/^\/jess\s+houses\s+rem\s+(\w+)$/i);
      if (houseRemMatch) {
        const code = houseRemMatch[1].toUpperCase();
        const rooms = loadRooms();
        const next = rooms.filter(r => String(r.houseCode || '').toUpperCase() !== code);
        saveRooms(next);
        await sendTelegramMessage(chatId, `🗑 Removed house ${code} (${rooms.length - next.length} room entry/entries).`).catch(()=>{});
        continue;
      }

      if (textLower === '/jess assistant' || textLower === '/jess assistants') {
        const managers = loadManagers().filter(m => m.active);
        const lines = managers.map(m => `• ${m.name} - ${m.phone || 'no phone'}${m.role ? ` (${m.role})` : ''}`);
        await sendTelegramMessage(chatId, ['*Assistants*', ...lines].join('\n'), { parse_mode: 'Markdown' }).catch(()=>{});
        continue;
      }

      const assistantAddMatch = textMsg.match(/^\/jess\s+assistant\s+add\s+([^\d]+?)\s+(\+?\d[\d\s]+)$/i);
      if (assistantAddMatch) {
        const [, nameRaw, phoneRaw] = assistantAddMatch;
        const name = nameRaw.trim();
        const phone = phoneRaw.replace(/\s+/g, '');
        const managers = loadManagers();
        const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        const existing = managers.find(m => String(m.id) === id || String(m.name).toLowerCase() === name.toLowerCase());
        if (existing) {
          existing.phone = phone;
          existing.active = true;
        } else {
          managers.push({ id, name, full_name: name, phone, wa_id: null, telegram_chat_id: null, role: 'manager', active: true, houses: [], languages: ['EN'] });
        }
        saveJSON(path.join(DATA_DIR, 'managers.json'), managers);
        await sendTelegramMessage(chatId, `👤 Assistant saved: ${name} - ${phone}`).catch(()=>{});
        continue;
      }

      const assistantRemMatch = textMsg.match(/^\/jess\s+assistant\s+rem\s+(.+)$/i);
      if (assistantRemMatch) {
        const target = assistantRemMatch[1].trim().toLowerCase();
        const managers = loadManagers();
        const next = managers.filter(m => String(m.name || '').toLowerCase() !== target && String(m.id || '').toLowerCase() !== target);
        saveJSON(path.join(DATA_DIR, 'managers.json'), next);
        await sendTelegramMessage(chatId, `🗑 Removed assistant ${assistantRemMatch[1].trim()}.`).catch(()=>{});
        continue;
      }

      if (textLower === '/jess auto on') {
        const admin = loadAdminState();
        admin.autoMode = {
          enabled: true,
          startedAt: new Date().toISOString(),
          processedTonight: 0,
          cursor: admin.autoMode?.cursor || 0,
          lastRunAt: null,
          stopAtDate: brisbaneDateKey(),
        };
        saveAdminState(admin);
        await sendTelegramMessage(chatId, `🌙 Jess auto mode on. Running until 8am Brisbane with human-like pacing.`).catch(()=>{});
        continue;
      }

      if (textLower === '/jess auto off') {
        const admin = loadAdminState();
        admin.autoMode.enabled = false;
        admin.autoMode.stoppedAt = new Date().toISOString();
        saveAdminState(admin);
        await sendTelegramMessage(chatId, '🛑 Jess auto mode off.').catch(()=>{});
        continue;
      }

      if (textLower === '/jess auto status') {
        const admin = loadAdminState();
        const auto = admin.autoMode || {};
        const msg = [
          '*Jess auto mode*',
          `Enabled: ${auto.enabled ? 'yes' : 'no'}`,
          `Processed tonight: ${auto.processedTonight || 0}`,
          `Cursor: ${auto.cursor || 0}`,
          `Last run: ${formatAdminTimestamp(auto.lastRunAt)}`,
          `Stops at: 8:00am Brisbane`,
        ].join('\n');
        await sendTelegramMessage(chatId, msg, { parse_mode: 'Markdown' }).catch(()=>{});
        continue;
      }

      if (textLower === '/jess stats') {
        const today = brisbaneDateKey();
        const sentToday = pending.filter(p => p.sentAt && String(p.sentAt).slice(0,10) === today).length;
        const repliedToday = sentToday;
        const invitedToday = pending.filter(p => p.sentAt && String(p.sentAt).slice(0,10) === today && /viewing|inspection/i.test(String(p.action || ''))).length;
        const activeToday = new Set(pending.filter(p => (p.createdAt && String(p.createdAt).slice(0,10) === today) || (p.sentAt && String(p.sentAt).slice(0,10) === today)).map(p => p.conversationId || p.id)).size;
        const msg = [
          '*Jess today*',
          `Messages sent: ${sentToday}`,
          `Replied: ${repliedToday}`,
          `Viewings invited: ${invitedToday}`,
          `Conversations active: ${activeToday}`,
        ].join('\n');
        await sendTelegramMessage(chatId, msg, { parse_mode: 'Markdown' }).catch(()=>{});
        continue;
      }

      // -- /jess v4 stats --------------------------------------------------
      if (textLower === '/jess v4 stats') {
        try {
          const _v4sm = require('./modules/metrics');
          const _v4sd = require('./modules/dispatch-queue');
          const _v4snap = _v4sm.snapshot();
          const _v4qs   = _v4sd.snapshot ? _v4sd.snapshot() : [];
          const _v4top3 = _v4qs.slice(0, 3).map(function(t) {
            return '  - ' + t.threadId + ' (score ' + t.score + ')';
          }).join('\n');
          var _v4lines = [
            '*Jess v4 Stats*',
            'Queue depth: ' + _v4snap.queueDepth,
            'Drafts created: ' + _v4snap.draftsCreated,
            'Sent total: ' + _v4snap.sentTotal,
            'Gated skip: ' + _v4snap.gatedSkip,
            'Gated defer: ' + _v4snap.gatedDefer,
            'Duplicates blocked: ' + _v4snap.duplicatesBlocked,
            'Locks acquired: ' + _v4snap.locksAcquired,
            'Scrape healthy: ' + (_v4snap.scrapeHealthy ? 'yes' : 'no'),
          ];
          if (_v4top3) _v4lines.push('Top queue:\n' + _v4top3);
          await sendTelegramMessage(chatId, _v4lines.join('\n'), { parse_mode: 'Markdown' }).catch(function(){});
        } catch (_v4statsErr) {
          await sendTelegramMessage(chatId, 'v4 stats error: ' + _v4statsErr.message).catch(function(){});
        }
        continue;
      }

      // ── /jess campaign delivery debug ──────────────────────────────────────────
      const deliveryDebugMatch = textMsg.match(/^\/jess\s+campaign\s+delivery\s+debug\s+(\S+)$/i);
      if (deliveryDebugMatch) {
        const _ddThreadId = deliveryDebugMatch[1];
        try {
          const _ddStatus = await relayGet('/api/status').catch(() => null);
          const _ddCmds = await relayGet('/api/commands').catch(() => ({ commands: [] }));
          const _ddCmdList = Array.isArray(_ddCmds) ? _ddCmds : (_ddCmds.commands || _ddCmds.pending || []);
          const _ddReplyCmds = _ddCmdList.filter(c => c.action === 'reply' && String(c.threadId) === String(_ddThreadId));
          const _ddAllReplyCmds = _ddCmdList.filter(c => c.action === 'reply');
          const _ddHbAge = _ddStatus?.lastExtensionHeartbeat ? Math.floor((Date.now() - new Date(_ddStatus.lastExtensionHeartbeat).getTime()) / 1000) : 999999;
          const dbgMsg = [
            `🔍 Campaign Delivery Debug: ${_ddThreadId}`,
            `Relay running: ${_ddStatus?.relay === 'running' ? '✅' : '❌'}`,
            `Relay paused: ${_ddStatus?.paused ? '⚠️ YES' : '✅ no'}`,
            `Extension connected: ${_ddStatus?.extensionConnected ? '✅' : '❌'}`,
            `Last heartbeat: ${_ddStatus?.lastExtensionHeartbeat || 'never'} (${_ddHbAge}s ago)`,
            `Extension active (hb <60s): ${_ddHbAge < 60 ? '✅' : '❌ STALE'}`,
            `Pending reply cmds for thread: ${_ddReplyCmds.length}`,
            `All pending reply cmds: ${_ddAllReplyCmds.length}`,
            `Total pending cmds: ${_ddCmdList.length}`,
            '',
            _ddHbAge > 300 ? '⚠️ Extension heartbeat is stale — open flatmates.com.au/messages in browser' : '✅ Extension appears active',
          ].join('\n');
          await sendTelegramMessage(chatId, dbgMsg).catch(()=>{});
        } catch(_dde) { await sendTelegramMessage(chatId, 'delivery debug err: '+_dde.message).catch(()=>{}); }
        continue;
      }

      // ── /jess scrape debug unread ──────────────────────────────────────────────
      if (textLower === '/jess scrape debug unread') {
        try {
          const inbox = await fetchInbox().catch(() => []);
          const unread = inbox.filter(c => c.isUnread || c.unread);
          const withSubject = unread.filter(c => c.subjectText || c.listingId);
          const top10 = unread.slice(0, 10).map((c, i) =>
            `${i+1}. ${c.threadId} | unread=${c.isUnread} | sub=${c.subjectText||'null'} | lid=${c.listingId||'null'} | house=${c.houseCode||'null'} | act=${c.lastActive||'?'} | snip=${(c.snippet||'').slice(0,40)}`
          ).join('\n');
          const msg = [
            '🔍 *Scrape Debug: Unread Rows*',
            `Total relay conversations: ${inbox.length}`,
            `Unread in relay: ${unread.length}`,
            `Unread with subjectText/listingId: ${withSubject.length}`,
            `Unread with houseCode: ${unread.filter(c=>c.houseCode&&c.houseCode!=='?').length}`,
            '',
            'First 10 unread:',
            top10 || '(none)'
          ].join('\n');
          const chunks = [];
          let cur = '';
          for (const line of msg.split('\n')) {
            if ((cur+line).length > 3800) { chunks.push(cur); cur=''; }
            cur += line + '\n';
          }
          if (cur) chunks.push(cur);
          for (const chunk of chunks) await sendTelegramMessage(chatId, chunk, {parse_mode:'Markdown'}).catch(()=>{});
        } catch(_sde) { await sendTelegramMessage(chatId, 'scrape debug err: '+_sde.message).catch(()=>{}); }
        continue;
      }

      // ── /jess debug thread <threadId> ───────────────────────────────────────
      const _debugThreadMatch = textMsg.match(/^\/jess\s+debug\s+thread\s+(\d+)$/i);
      if (_debugThreadMatch) {
        const _dtId = _debugThreadMatch[1];
        try {
          const _dtCF = require('./modules/campaign-filter');
          const _dtIR = require('./modules/inbound-relevance');
          const _dtTC = require('./modules/thread-classifier');

          // Fetch the live thread from relay
          let _dtThread = null;
          try { _dtThread = await fetchThread(_dtId); } catch (_) {}

          // Also check inbox for metadata
          const _dtInbox = await fetchInbox().catch(() => []);
          const _dtConv  = _dtInbox.find(c => String(c.threadId || '') === _dtId) || {};

          // Merge
          const _dtMerged = _dtThread ? mergeThreadIntoConversation(_dtConv, _dtThread) : { ..._dtConv };

          const _now = Date.now();
          const dir  = _dtCF.buildThreadDirectionSummary(_dtMerged, _now);

          // House info — thread-states is canonical lifecycle source
          const _dtTsPath = path.join(__dirname, 'data', 'jess-thread-states.json');
          const _dtTS     = loadJSON(_dtTsPath, {});
          const _dtState  = _dtTS[_dtId] || null;
          const _dtLifecycleHouse = String(
            _dtState?.houseCode || _dtMerged.houseCode || _dtMerged.savedHouseCode || '?'
          ).toUpperCase().trim();

          // ── Inbound relevance enrichment ────────────────────────────────────
          // This is what campaign-filter uses; we must compute it here too.
          const _dtRooms    = loadRooms();
          const _dtMatchers = _dtIR.buildSnippetMatchers(_dtRooms);
          const _dtIRFields = _dtIR.computeInboundRelevance(_dtMerged, _dtLifecycleHouse, _dtRooms, _dtMatchers);

          // Snippet and href match diagnostics
          const _dtSnippetText = _dtIRFields.latestInboundSnippet || dir.latestInboundSnippet || _dtConv.snippet || '';
          const _dtSnippetMatch = _dtSnippetText ? _dtIR.matchSnippetToHouse(_dtSnippetText, _dtMatchers) : null;
          const _dtHrefMatch    = _dtIR.matchHrefToHouse(_dtMerged, _dtRooms);

          const _dtCIR   = _dtIRFields.currentInboundRelevance || '?';
          const _dtCross = _dtIRFields.crossHouseFresh;
          const _dtFresh = dir.freshInboundAfterOutbound;
          const _dtThreadState = await _dtTC.enrichThreadState(_dtMerged, {
            now: _now,
            houseCode: _dtLifecycleHouse,
            campaignId: _dtLifecycleHouse && _dtLifecycleHouse !== '?' ? `house-${_dtLifecycleHouse}` : null,
            forceOverride: false,
            rooms: _dtRooms,
            threadStates: _dtTS,
          });

          // Determine which campaign(s) this thread surfaces in
          let _dtSurfaces = 'none';
          if (_dtCross) {
            _dtSurfaces = `✅ WILL surface for *${_dtCIR}* campaign (cross-house fresh inbound)`;
          } else if (_dtFresh) {
            _dtSurfaces = `for *${_dtLifecycleHouse}* campaign (lifecycle house, fresh inbound)`;
          } else if (_dtLifecycleHouse && _dtLifecycleHouse !== '?') {
            _dtSurfaces = `for *${_dtLifecycleHouse}* campaign only (lifecycle)`;
          }

          // Classification
          const _dt3dAgo = _now - 3 * 24 * 60 * 60 * 1000;
          let _dtClassification = 'unknown';
          let _dtExclusionReason = null;

          if (_dtMerged.isThreadInactive) {
            _dtClassification = 'blocked'; _dtExclusionReason = 'inactive (left platform)';
          } else if (_dtCross) {
            _dtClassification = `eligible (cross-house fresh inbound → ${_dtCIR})`;
          } else if (_dtFresh) {
            _dtClassification = 'eligible (fresh inbound reactivated)';
          } else if (!dir.freshestActivityMs || dir.freshestActivityMs < _dt3dAgo) {
            _dtClassification = 'excluded'; _dtExclusionReason = 'inactive >3 days';
          } else if (_dtMerged.stage === 'dead') {
            _dtClassification = 'blocked'; _dtExclusionReason = 'dead stage, no reactivation';
          } else if (dir.effectiveLastFrom === 'jess') {
            _dtClassification = 'excluded'; _dtExclusionReason = 'stale (Jess replied last)';
          } else {
            _dtClassification = 'eligible';
          }

          const _dtMsgCount = Array.isArray(_dtMerged.messages) ? _dtMerged.messages.length : '?';
          const _dtUnread   = _dtMerged.isUnread || _dtMerged.unread || false;
          const _dtBool = v => v ? 'yes' : 'no';

          // Last scrape time from relay inbox file
          const _dtInboxFile = loadJSON('/home/diegopalhano/projects/jess-bot/relay-data/inbox.json', null);
          const _dtLastScrape = _dtInboxFile?.updatedAt || _dtThread?.scrapedAt || 'unknown';

          const _dtLines = [
            `🔍 *Debug: Thread ${_dtId}*`,
            `👤 Name: ${_dtMerged.name || _dtMerged.memberName || '?'}`,
            ``,
            `── House & Relevance ──`,
            `🏠 Lifecycle house: *${_dtLifecycleHouse}* (persisted, drives /jess count)`,
            `🔀 Current inbound relevance: *${_dtCIR}*`,
            `📌 Relevance source: ${_dtIRFields.relevanceSource || 'n/a'}`,
            `🔎 Snippet match: ${_dtSnippetMatch ? `✅ *${_dtSnippetMatch.houseCode}* via ${_dtSnippetMatch.matchType} (keyword: "${_dtSnippetMatch.keyword}")` : '❌ no match'}`,
            `🔗 Href match: ${_dtHrefMatch ? `${_dtHrefMatch.houseCode} via ${_dtHrefMatch.matchType}` : 'none'}`,
            `🔀 Cross-house fresh: ${_dtCross ? `✅ YES — lifecycle=${_dtLifecycleHouse} → inbound→${_dtCIR}` : 'no'}`,
            `📣 Surfaces in campaign: ${_dtSurfaces}`,
            ``,
            `── Message visibility/state ──`,
            `isUnread: ${_dtBool(_dtThreadState.isUnread)}`,
            `isRead: ${_dtBool(_dtThreadState.isRead)}`,
            `hasNewInbound: ${_dtBool(_dtThreadState.hasNewInbound)}`,
            `latestInboundTimestamp: ${_dtThreadState.latestInboundTimestamp || 'none'}`,
            `latestInboundSnippet: "${String(_dtThreadState.latestInboundSnippet || 'n/a').slice(0, 100)}"`,
            `latestOutboundTimestamp: ${_dtThreadState.latestOutboundTimestamp || 'none'}`,
            `freshInboundAfterOutbound: ${_dtBool(_dtThreadState.freshInboundAfterOutbound)}`,
            ``,
            `── Conversation ownership/state ──`,
            `lastFromRaw: ${_dtThreadState.lastFromRaw || 'n/a'}`,
            `effectiveLastFrom: ${_dtThreadState.effectiveLastFrom || 'n/a'}`,
            `jessRepliedLast: ${_dtBool(_dtThreadState.jessRepliedLast)}`,
            `leadRepliedLast: ${_dtBool(_dtThreadState.leadRepliedLast)}`,
            `respondedBefore: ${_dtBool(_dtThreadState.respondedBefore)}`,
            ``,
            `── Campaign/contact history ──`,
            `wasInvitedBefore: ${_dtBool(_dtThreadState.wasInvitedBefore)}`,
            `lastInviteTimestamp: ${_dtThreadState.lastInviteTimestamp || 'none'}`,
            `lastInviteHouse: ${_dtThreadState.lastInviteHouse || 'none'}`,
            `lastInviteInspectionDate: ${_dtThreadState.lastInviteInspectionDate || 'none'}`,
            `lastInviteCampaignId: ${_dtThreadState.lastInviteCampaignId || 'none'}`,
            `alreadySentThisExactCampaign: ${_dtBool(_dtThreadState.alreadySentThisExactCampaign)}`,
            `recentlyInvited: ${_dtBool(_dtThreadState.recentlyInvited)}`,
            `cooldownActive: ${_dtBool(_dtThreadState.cooldownActive)}`,
            ``,
            `── Operational flags ──`,
            `safeToSend: ${_dtBool(_dtThreadState.safeToSend)}`,
            `isInactive: ${_dtBool(_dtThreadState.isInactive)}`,
            `isOptedOut: ${_dtBool(_dtThreadState.isOptedOut)}`,
            `isArchived: ${_dtBool(_dtThreadState.isArchived)}`,
            `duplicateInActiveBatch: ${_dtBool(_dtThreadState.duplicateInActiveBatch)}`,
            `finalReason: ${_dtThreadState.finalReason || 'sendable_now'}`,
            ``,
            `── Activity ──`,
            `📩 Latest inbound ts: ${_dtIRFields.latestInboundTimestamp || dir.latestInboundTs || 'none'}`,
            `📩 Latest inbound snippet: "${(_dtSnippetText || 'n/a').slice(0, 100)}"`,
            `📤 Latest outbound ts: ${dir.latestOutboundTs || 'none'}`,
            `🔄 Fresh inbound after outbound: ${_dtFresh ? '✅ YES' : '❌ no'}`,
            `👁 lastFrom (raw): ${_dtMerged.lastFrom || 'n/a'}`,
            `👁 effectiveLastFrom: ${dir.effectiveLastFrom || 'n/a'}`,
            `📊 freshestActivity: ${dir.freshestActivityMs ? new Date(dir.freshestActivityMs).toISOString() : 'none'} (${dir.freshestActivitySource})`,
            `📅 lastActive: ${_dtMerged.lastActive || 'n/a'}`,
            `🔔 unread/new: ${_dtUnread ? '✅ YES' : 'no'}`,
            `💬 messages in thread: ${_dtMsgCount}`,
            `⏱ Last scraper refresh: ${_dtLastScrape}`,
            ``,
            `── Classification ──`,
            `🏷 Stage: ${_dtMerged.stage || 'n/a'}`,
            `📋 Classification: *${_dtClassification}*`,
            _dtExclusionReason ? `❌ Exclusion reason: ${_dtExclusionReason}` : null,
            _dtCross ? `✅ Cross-house: thread will appear in ${_dtCIR} campaign (not just ${_dtLifecycleHouse})` : null,
            _dtFresh && !_dtCross ? `✅ Fresh inbound detected — thread eligible regardless of lastFrom` : null,
          ].filter(Boolean).join('\n');

          await sendTelegramMessage(chatId, _dtLines, { parse_mode: 'Markdown' }).catch(() => {});
        } catch (_dte) {
          await sendTelegramMessage(chatId, `❌ debug thread error: ${_dte.message}`).catch(() => {});
        }
        continue;
      }

      // ── /jess audit counts ───────────────────────────────────────────────────
      if (/^\/jess\s+audit\s+counts$/i.test(textMsg)) {
        try {
          const { classifyThreads, auditReports } = require('./modules/thread-classifier');
          const rooms = loadRooms();
          const houses = [...new Set((rooms || []).map(r => String(r.houseCode || '').toUpperCase().trim()).filter(Boolean))].sort();
          const inbox = await fetchInbox();
          const reports = [];
          for (const house of houses) reports.push(await classifyThreads({ houseCode: house, inbox, campaignId: `house-${house}`, forceOverride: false }));
          const audit = auditReports(reports);
          const lines = [
            `🧪 *Jess audit counts*`,
            `Houses checked: ${reports.length}`,
            audit.ok ? `✅ No invariant violations found` : `❌ Violations: ${audit.violations.length}`,
            ...(!audit.ok ? audit.violations.slice(0, 50).map(v => `• ${v}`) : []),
          ];
          await sendTelegramMessage(chatId, lines.join('\n'), { parse_mode: 'Markdown' }).catch(() => {});
        } catch (e) {
          await sendTelegramMessage(chatId, `❌ audit counts failed: ${e.message}`).catch(() => {});
        }
        continue;
      }

      // ── /jess debug house <house> ────────────────────────────────────────────
      const _debugHouseMatch = textMsg.match(/^\/jess\s+debug\s+house\s+(\w+)$/i);
      if (_debugHouseMatch) {
        try {
          const { classifyThreads } = require('./modules/thread-classifier');
          const house = String(_debugHouseMatch[1] || '').toUpperCase();
          const inbox = await fetchInbox();
          const report = await classifyThreads({ houseCode: house, inbox, campaignId: `house-${house}`, forceOverride: false });
          const reasonSample = Object.entries(report.reasonCounts || {}).sort((a,b) => b[1]-a[1]).slice(0, 10).map(([r,n]) => `• ${r}: ${n}`);
          const lines = [
            `🔎 *Jess debug house ${house}*`,
            `lifecycle threadIds count: ${report.lifecycle.total}`,
            `matched threadIds count: ${report.matchedThreads}`,
            `sendable count: ${report.sendableCount}`,
            `blocked count: ${report.blockedCount}`,
            `excluded count: ${report.excludedCount}`,
            `duplicate threadIds count: ${report.duplicateThreadIds.length}`,
            `extra matched threadIds not in lifecycle: ${report.extraMatchedThreadIds.length}`,
            `sample reason breakdown:`,
            ...(reasonSample.length ? reasonSample : ['• (none)']),
          ];
          await sendTelegramMessage(chatId, lines.join('\n'), { parse_mode: 'Markdown' }).catch(() => {});
        } catch (e) {
          await sendTelegramMessage(chatId, `❌ debug house failed: ${e.message}`).catch(() => {});
        }
        continue;
      }

      // ── /jess debug candidate <name> ─────────────────────────────────────────
      const _debugCandidateMatch = textMsg.match(/^\/jess\s+debug\s+candidate\s+(.+)$/i);
      if (_debugCandidateMatch) {
        const _dcNameQuery = _debugCandidateMatch[1].trim().toLowerCase();
        try {
          const _dcCF = require('./modules/campaign-filter');
          const _dcIR = require('./modules/inbound-relevance');

          // Search inbox for matching candidates
          const _dcInbox = await fetchInbox().catch(() => []);
          const _dcMatches = _dcInbox.filter(c => {
            const cname = String(c.name || c.memberName || '').toLowerCase();
            return cname.includes(_dcNameQuery);
          });

          if (!_dcMatches.length) {
            await sendTelegramMessage(chatId, `❌ No threads found matching candidate name: "${_dcNameQuery}"`).catch(() => {});
            continue;
          }

          const _dcTsPath = path.join(__dirname, 'data', 'jess-thread-states.json');
          const _dcTS     = loadJSON(_dcTsPath, {});
          const _dcRooms  = loadRooms();
          const _now      = Date.now();

          const _dcLines = [`🔍 *Debug: Candidate "${_dcNameQuery}" (${_dcMatches.length} match(es))*`, ''];

          for (const _dcConv of _dcMatches.slice(0, 5)) {
            const _dcId = String(_dcConv.threadId || '');
            let _dcThread = null;
            try { _dcThread = await fetchThread(_dcId); } catch (_) {}
            const _dcMerged = _dcThread ? mergeThreadIntoConversation(_dcConv, _dcThread) : { ..._dcConv };
            const dir = _dcCF.buildThreadDirectionSummary(_dcMerged, _now);
            const _dcState = _dcTS[_dcId] || null;

            // Compute fresh-inbound relevance fields
            const _dcLifecycleHouse = String(
              _dcState?.houseCode || _dcMerged.houseCode || _dcMerged.savedHouseCode || '?'
            ).toUpperCase().trim();
            const _dcMatchers = _dcIR.buildSnippetMatchers(_dcRooms);
            const _dcIRFields = _dcIR.computeInboundRelevance(_dcMerged, _dcLifecycleHouse, _dcRooms, _dcMatchers);

            // ── Snippet match diagnostics ────────────────────────────────────
            const _dcSnippetText = _dcIRFields.latestInboundSnippet || dir.latestInboundSnippet || _dcConv.snippet || '';
            const _dcSnippetMatch = _dcSnippetText ? _dcIR.matchSnippetToHouse(_dcSnippetText, _dcMatchers) : null;
            const _dcHrefMatch = _dcIR.matchHrefToHouse(_dcMerged, _dcRooms);
            // Compute candidate scores (all possible resolution paths)
            const _dcCandidates = [];
            if (_dcSnippetMatch) _dcCandidates.push({ source: `snippet:${_dcSnippetMatch.matchType}`, house: _dcSnippetMatch.houseCode, keyword: _dcSnippetMatch.keyword, priority: 1 });
            if (_dcHrefMatch)    _dcCandidates.push({ source: `href:${_dcHrefMatch.matchType}`, house: _dcHrefMatch.houseCode, priority: 2 });
            if (_dcMerged.listingId) {
              const _dcLidRoom = _dcRooms.find(r => String(r.listingId || '').trim() === String(_dcMerged.listingId).replace(/^P/i, '').trim());
              if (_dcLidRoom?.houseCode) _dcCandidates.push({ source: 'listingId', house: _dcLidRoom.houseCode, priority: 3 });
            }
            _dcCandidates.push({ source: 'historical_fallback', house: _dcLifecycleHouse, priority: 4 });

            const _dc3dAgo = _now - 3 * 24 * 60 * 60 * 1000;
            const _dcFresh = dir.freshInboundAfterOutbound;
            const _dcCross = _dcIRFields.crossHouseFresh;
            let _dcClass = 'unknown';
            let _dcExcl = null;
            if (_dcMerged.isThreadInactive) { _dcClass = 'blocked'; _dcExcl = 'inactive'; }
            else if (_dcCross) { _dcClass = 'eligible (cross-house fresh inbound)'; }
            else if (_dcFresh) { _dcClass = 'eligible (fresh inbound)'; }
            else if (!dir.freshestActivityMs || dir.freshestActivityMs < _dc3dAgo) { _dcClass = 'excluded'; _dcExcl = 'inactive >3d'; }
            else if (_dcMerged.stage === 'dead') { _dcClass = 'blocked'; _dcExcl = 'dead stage'; }
            else if (dir.effectiveLastFrom === 'jess') { _dcClass = 'excluded'; _dcExcl = 'Jess replied last'; }
            else { _dcClass = 'eligible'; }

            // Determine if cross-house relevance will surface in campaign selection
            const _dcSurfaces = _dcCross
              ? `✅ WILL surface for ${_dcIRFields.currentInboundRelevance} campaign (cross-house sweep)`
              : (_dcFresh ? `for ${_dcLifecycleHouse} campaign only` : 'no');

            _dcLines.push(`👤 *${_dcMerged.name || '?'}* — threadId: ${_dcId}`);
            _dcLines.push(`  🏠 Lifecycle house: ${_dcLifecycleHouse} (persisted, drives /jess count)`);
            _dcLines.push(`  🔀 Current inbound relevance: *${_dcIRFields.currentInboundRelevance || '?'}*`);
            _dcLines.push(`  📌 Relevance source: ${_dcIRFields.relevanceSource || 'n/a'}`);
            _dcLines.push(`  📩 Latest inbound: ${_dcIRFields.latestInboundTimestamp || dir.latestInboundTs || 'none'}`);
            _dcLines.push(`  📩 Snippet: "${_dcSnippetText.slice(0, 100) || 'n/a'}"`);
            _dcLines.push(`  📤 Latest outbound: ${dir.latestOutboundTs || 'none'}`);
            _dcLines.push(`  🔄 Fresh inbound after outbound: ${_dcFresh ? '✅ YES' : 'no'}`);
            _dcLines.push(`  🔀 Cross-house fresh: ${_dcCross ? `✅ YES — lifecycle=${_dcLifecycleHouse} → inbound→${_dcIRFields.currentInboundRelevance}` : 'no'}`);
            _dcLines.push(`  📣 Surfaces in campaign: ${_dcSurfaces}`);
            _dcLines.push(`  👁 lastFrom(raw)=${_dcMerged.lastFrom || 'n/a'} effectiveLastFrom=${dir.effectiveLastFrom || 'n/a'}`);
            _dcLines.push(`  📊 freshestActivity: ${dir.freshestActivityMs ? new Date(dir.freshestActivityMs).toISOString() : 'none'}`);
            _dcLines.push(`  📋 Classification: *${_dcClass}*${_dcExcl ? ` — ${_dcExcl}` : ''}`);
            // ── Snippet match diagnostics ────────────────────────────────────
            _dcLines.push(`  🔎 Snippet match: ${_dcSnippetMatch ? `✅ ${_dcSnippetMatch.houseCode} via ${_dcSnippetMatch.matchType} (keyword: "${_dcSnippetMatch.keyword}")` : '❌ no match'}`);
            _dcLines.push(`  🔗 Href match: ${_dcHrefMatch ? `${_dcHrefMatch.houseCode} via ${_dcHrefMatch.matchType}` : 'none'}`);
            _dcLines.push(`  🏆 Relevance candidates (priority order):`);
            for (const _cand of _dcCandidates) {
              const _winner = _cand.priority === 1 && _dcSnippetMatch ? '← WINNER' : (_dcCandidates[0].source === `href:${_dcHrefMatch?.matchType}` && _cand.source.startsWith('href') ? '← (would win without snippet)' : '');
              _dcLines.push(`     P${_cand.priority} ${_cand.source}: ${_cand.house}${_cand.keyword ? ` ("${_cand.keyword}")` : ''} ${_winner}`);
            }
            _dcLines.push(`  💬 messages in thread: ${Array.isArray(_dcMerged.messages) ? _dcMerged.messages.length : '(no thread fetched)'}`);
            _dcLines.push('');
          }

          await sendTelegramMessage(chatId, _dcLines.join('\n'), { parse_mode: 'Markdown' }).catch(() => {});
        } catch (_dce) {
          await sendTelegramMessage(chatId, `❌ debug candidate error: ${_dce.message}`).catch(() => {});
        }
        continue;
      }

      // ── /jess debug listing <house> ─────────────────────────────────────────
      const _debugListingMatch = textMsg.match(/^\/jess\s+debug\s+listing\s+(\w+)$/i);
      if (_debugListingMatch) {
        const _dlHouse = _debugListingMatch[1].toUpperCase();
        try {
          const _dlRooms = loadRooms();
          // Build listing-id → houseCode map (same as retroactive-housecode-fix)
          const _dlListingMap = {};
          for (const r of _dlRooms) {
            if (r.listingId) _dlListingMap[String(r.listingId)] = r.houseCode;
            if (r.listing_url) {
              const _dlPM = r.listing_url.match(/P(\d+)/i);
              if (_dlPM) _dlListingMap[_dlPM[1]] = r.houseCode;
            }
          }
          // Also check listing-ids-reference.json
          try {
            const _dlRefPath = path.join(__dirname, 'data', 'listing-ids-reference.json');
            const _dlRef = loadJSON(_dlRefPath, {});
            for (const l of (_dlRef.listings || [])) {
              if (l.listingId && l.houseCode) _dlListingMap[String(l.listingId)] = l.houseCode;
            }
          } catch (_) {}

          // Find the room for this house
          const _dlRoom = _dlRooms.find(r => r.houseCode && r.houseCode.toUpperCase() === _dlHouse);
          const _dlListingId = _dlRoom?.listingId || (() => {
            if (_dlRoom?.listing_url) {
              const m = _dlRoom.listing_url.match(/P(\d+)/i);
              return m ? m[1] : null;
            }
            // Check listing-ids-reference.json
            try {
              const _ref = loadJSON(path.join(__dirname, 'data', 'listing-ids-reference.json'), {});
              const _refEntry = (_ref.listings || []).find(l => l.houseCode && l.houseCode.toUpperCase() === _dlHouse);
              return _refEntry?.listingId || null;
            } catch (_) { return null; }
          })();
          const _dlListingFound = !!_dlRoom;
          const _dlListingUrl = _dlRoom?.listing_url || null;

          // Read relay inbox
          const _dlInbox = await fetchInbox().catch(() => []);
          const _dlTsPath = path.join(__dirname, 'data', 'jess-thread-states.json');
          const _dlTS = loadJSON(_dlTsPath, {});

          // Find threads for this house via:
          // 1. Exact houseCode match on inbox conv
          // 2. thread-state lookup
          // 3. listingId match from thread files
          const _dlHouseThreads = [];
          const _dlSeen = new Set();

          // Pass 1: thread-states already resolved
          for (const conv of _dlInbox) {
            const tid = String(conv.threadId || '');
            if (!tid) continue;
            const state = _dlTS[tid];
            const hc = String(conv.houseCode || state?.houseCode || '').toUpperCase();
            if (hc === _dlHouse) {
              _dlHouseThreads.push({ threadId: tid, source: 'thread-state', lastActive: conv.lastActive || state?.lastActive, updatedAt: conv.updatedAt || state?.updatedAt });
              _dlSeen.add(tid);
            }
          }

          // Pass 2: scan thread files for this listing's threads
          if (_dlListingId) {
            const _dlThreadsData = await fetchThreads().catch(() => []);
            for (const t of _dlThreadsData) {
              const tid = String(t.threadId || '');
              if (!tid || _dlSeen.has(tid)) continue;
              const tLid = String(t.listingId || '').replace(/^P/i, '');
              const mappedHouse = tLid ? (_dlListingMap[tLid] || null) : null;
              if (mappedHouse && mappedHouse.toUpperCase() === _dlHouse) {
                _dlHouseThreads.push({ threadId: tid, source: 'thread-file-listingId', lastActive: t.lastActive, updatedAt: t.updatedAt });
                _dlSeen.add(tid);
              }
            }
          }

          // Inbox timestamp
          const _dlInboxData = loadJSON(path.join(__dirname, '..', 'mission-control', 'data') + '/jess-relay-inbox.json', null)
            || loadJSON('/home/diegopalhano/projects/jess-bot/relay-data/inbox.json', null);
          const _dlLastScrape = (_dlInboxData?.updatedAt || _dlInboxData?.timestamp) || 'unknown';

          // Sample thread IDs
          const _dlSample = _dlHouseThreads.slice(0, 5).map(t =>
            `• ${t.threadId} [${t.source}] lastActive=${t.lastActive || '?'} updatedAt=${(t.updatedAt||'?').slice(0,16)}`
          ).join('\n');

          const _dlMsg = [
            `🔍 *Debug: Listing ${_dlHouse}*`,
            '',
            `Listing found in rooms.json: ${_dlListingFound ? '✅ yes' : '❌ no'}`,
            `Listing ID: ${_dlListingId || 'not found'}`,
            `Listing URL: ${_dlListingUrl || 'not found'}`,
            `Last scrape: ${_dlLastScrape}`,
            `Inbox threads matched to ${_dlHouse}: ${_dlHouseThreads.length}`,
            '',
            _dlHouseThreads.length > 0 ? `Sample threads:\n${_dlSample}` : '(no threads found for this house)',
            '',
            _dlListingId
              ? `Tip: threads will match if listingId=${_dlListingId} is scraped from DOM`
              : `⚠️ No listing ID found — add listingId to jess-rooms.json or listing-ids-reference.json`,
          ].join('\n');
          await sendTelegramMessage(chatId, _dlMsg, { parse_mode: 'Markdown' }).catch(() => {});
        } catch (_dle) {
          await sendTelegramMessage(chatId, `❌ debug listing error: ${_dle.message}`).catch(() => {});
        }
        continue;
      }

      // ── /jess count — read-only lead counting scrape ────────────────────────
      if (textLower === '/jess count') {
        countLeads(chatId).catch(e => {
          logWarn(`/jess count error: ${e.message}`);
          sendTelegramMessage(chatId, `❌ /jess count failed: ${e.message}`).catch(() => {});
        });
        continue;
      }

      if (textLower === '/jess_start' || textLower === '/jess_filter' || textLower === '/filter') {
        const rooms = loadRooms();
        const activeHouses = [...new Set(rooms.filter(r => r.available).map(r => r.houseCode).filter(Boolean))].sort();
        const f = loadFilter();
        saveFilter({ ...f, period: 'last_3_days', step: 'house' });
        const houseButtons = [];
        let row = [];
        for (const h of activeHouses) {
          row.push({ text: h, callback_data: `jf_house:${h}` });
          if (row.length === 4) { houseButtons.push(row); row = []; }
        }
        if (row.length) houseButtons.push(row);
        houseButtons.push([{ text: '🏠 All Active Listings', callback_data: 'jf_house:all' }]);
        const houseLabels = activeHouses.join(' · ');
        await sendTelegramMessage(chatId,
          `🤖 *Jess - Start Processing*\n\nActive listings: *${houseLabels}*\nPeriod: *Last 3 days*\n\nWhich houses to process?`,
          { parse_mode: 'Markdown', reply_markup: JSON.stringify({ inline_keyboard: houseButtons }) }
        ).catch(e => logWarn(`/jess_start house prompt failed: ${e.message}`));
        continue;
      }
    }
  } catch (e) {
    logWarn(`Telegram command poll failed: ${e.message}`);
    if (/HTTP 401|401/.test(e.message)) {
      await pauseJess('Telegram token rejected (401)', 0);
    }
  }
}

async function syncLiveListings() {
  log('[sync] ═══ syncLiveListings start ═══');
  const summary = { live: [], inactive: [], changes: [] };
  log('[sync] Relay mode: live listing page sync disabled');
  log('[sync] ═══ syncLiveListings done ═══');
  return summary;
}

// ─── Bootstrap / main ─────────────────────────────────────────────────────────

async function main() {
  // Disabled flag - if .jess-disabled exists, exit cleanly (stays off until manually turned on)
  const DISABLED_FLAG = path.join(__dirname, '.jess-disabled');
  if (fs.existsSync(DISABLED_FLAG)) {
    log('Jess is disabled (.jess-disabled flag present). Start via dashboard or: rm ' + DISABLED_FLAG);
    process.exit(0);  // Clean exit - systemd Restart=on-failure won't re-trigger
  }

  // PID lock - prevent duplicate instances
  const PID_FILE = path.join(__dirname, 'jess-v3.pid');
  if (fs.existsSync(PID_FILE)) {
    const oldPid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim());
    try { process.kill(oldPid, 0); log(`Stopping previous instance PID ${oldPid}...`); process.kill(oldPid, 'SIGTERM'); await new Promise(r => setTimeout(r, 2000)); } catch(_) {}
  }
  fs.writeFileSync(PID_FILE, String(process.pid));
  process.on('exit', () => { try { fs.unlinkSync(PID_FILE); } catch(_) {} });
  process.on('SIGTERM', () => { try { fs.unlinkSync(PID_FILE); } catch(_) {} process.exit(0); });

  log('═══════════════════════════════════════');
  log('  Jess v3 - Relay mode starting');
  log('═══════════════════════════════════════');

  startRelayCallbackServer();

  try {
    await registerRelayCallback(RELAY_CALLBACK_URL);
    callbackRegistered = true;
    log(`Registered relay callback: ${RELAY_CALLBACK_URL}`);
  } catch (e) {
    logWarn(`Relay callback registration failed: ${e.message}`);
  }

  // ── Process a single thread from the relay (thread-sync) ────────────────────
  async function processConversation(thread, _unused) {
    const threadId = String(thread.threadId || '');
    if (!threadId) return;
    const url = `relay://thread/${threadId}`;
    const convo = await scrapeConversation(null, url);
    // If scrape returned no memberName but we have snippet context, populate from thread
    if (!convo.memberName && thread.fromSnippet) {
      convo.memberName = thread.memberName || null;
      convo.convId = convo.convId || threadId;
      if (thread.snippet && convo.messages?.length === 0) {
        convo.messages = [{
          isOwn: false, isFromEnquirer: true, isSystem: false,
          text: thread.snippet, time: thread.lastActive || null,
        }];
      }
    }
    if (!convo.memberName) return;
    const enquirers = loadEnquirers();
    const convId = convo.convId || threadId;
    const houseCode = identifyHouseCode(convo);
    let enq = findEnquirer(enquirers, { conversationId: convId, name: convo.memberName, phone: convo.phone });
    if (!enq) {
      enq = createEnquirer({
        flatmates_url: convo.profileUrl,
        name: convo.memberName,
        full_name: convo.memberName,
        property_enquired: houseCode,
        conversation_id: convId,
      });
      enquirers.push(enq);
      log(`[thread-sync] New enquirer: ${enq.name} | thread: ${threadId} | house: ${houseCode || '?'}`);
    }
    await decideReply(convo, enq, houseCode);
  }

  // ── New cycle runner: just push new convos into MC inbox ────────────────────
  globalCycleRunner = async () => {
    let cycleUnreadCount = -1; // -1 = not determined (error); 0+ = actual count
    try {
      if (jessPaused) return;
      lastPollAt = new Date().toISOString();
      log('─── Poll cycle: pushing convos to MC inbox ───');
      // jam check runs in runPollCycle only (removed duplicate)

      const healthy = await verifyFlatmatesSession(null).catch(() => false);
      if (!healthy) {
        relayFailureStreak += 1;
        logWarn(`Skipping poll - unhealthy relay/session: ${sessionHealth.reason} (streak ${relayFailureStreak})`);
        if (relayFailureStreak >= 5) {
          await pauseJess(`Relay unreachable for ${relayFailureStreak} consecutive cycles`, 0);
        }
        return;
      }
      relayFailureStreak = 0;

      // Call MC jess/fetch to pull relay data into the inbox
      try {
        const resp = await fetch('http://127.0.0.1:8899/mc/jess/fetch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(20000),
        });
        if (resp.ok) {
          const data = await resp.json();
          log(`Pushed ${data.newCount || 0} new convos to MC inbox (${data.total || 0} total)`);
        } else {
          logWarn(`MC jess/fetch returned ${resp.status}`);
        }
      } catch (e) {
        logWarn(`MC jess/fetch error: ${e.message}`);
      }

      try {
        const threads = await fetchThreads();
        let newThreads = 0;
        for (const thread of threads) {
          const key = String(thread.threadId || '');
          if (!key) continue;
          const fingerprint = JSON.stringify({ updatedAt: thread.updatedAt || thread.receivedAt || null, messages: thread.messages?.length || 0, lastMessageAt: thread.lastMessageAt || null });
          if (lastThreadSnapshot.get(key) === fingerprint) continue;
          lastThreadSnapshot.set(key, fingerprint);
          newThreads += 1;
          try {
            await processConversation(thread, null);
          } catch (threadErr) {
            logWarn(`[thread-sync] Failed to process ${key}: ${threadErr.message}`);
          }
        }
        if (newThreads > 0) log(`[thread-sync] Processed ${newThreads} new/updated thread(s)`);
      } catch (e) {
        logWarn(`Relay /api/threads sync error: ${e.message}`);
      }

      // ── Unread processor: chase unread convos not yet replied to by Jess ────
      try {
        const UNREAD_PROCESSED_FILE = path.join(BOT_DIR, 'data', 'jess-unread-processed.json');
        const UNREAD_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes
        const JESS_REPLY_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours
        const MAX_UNREAD_PER_CYCLE = 5;

        // Load last-processed timestamps
        let unreadProcessedState = {};
        try { unreadProcessedState = JSON.parse(fs.readFileSync(UNREAD_PROCESSED_FILE, 'utf8')); } catch (_) {}

        const inbox = await fetchInbox().catch(() => []);
        const unreadConvos = inbox.filter(c => c.isUnread || c.unread);
        cycleUnreadCount = unreadConvos.length;
        log(`[unread-processor] Found ${unreadConvos.length} unread conversation(s) in relay inbox`);

        let processedCount = 0;
        const now = Date.now();

        for (const c of unreadConvos) {
          if (processedCount >= MAX_UNREAD_PER_CYCLE) break;
          const threadId = String(c.threadId || '');
          if (!threadId) continue;

          // Cooldown check - skip if processed within last 30 min
          const lastProcessedAt = unreadProcessedState[threadId] || 0;
          if (now - lastProcessedAt < UNREAD_COOLDOWN_MS) continue;

          // Check if Jess already replied within 24h
          let jessRepliedRecently = false;
          try {
            const thread = await fetchThread(threadId).catch(() => null);
            if (thread && thread.messages) {
              const cutoff = now - JESS_REPLY_WINDOW_MS;
              jessRepliedRecently = thread.messages.some(m => {
                if (!m.isMine && !m.isOwn) return false;
                const t = m.time ? new Date(m.time).getTime() : 0;
                return t >= cutoff;
              });
            }
          } catch (_) {}

          if (jessRepliedRecently) {
            // Already replied - just update cooldown to avoid re-checking every cycle
            unreadProcessedState[threadId] = now;
            continue;
          }

          // Process this unread conversation through the pipeline
          try {
            log(`[unread-processor] Processing unread thread ${threadId} (${c.name || c.memberName || 'unknown'})`);
            let thread = await fetchThread(threadId).catch(() => null);
            if (!thread) {
              // Build minimal thread from inbox snippet - relay only has full thread data
              // when the extension has navigated there, so fall back to what we know.
              thread = {
                threadId,
                threadUrl: `https://flatmates.com.au/messages/${threadId}`,
                memberName: c.name || c.memberName || 'Unknown',
                snippet: c.snippet || c.lastMessagePreview || '',
                isUnread: true,
                messages: (c.snippet || c.lastMessagePreview) ? [{
                  text: c.snippet || c.lastMessagePreview,
                  isMine: false,
                  isOwn: false,
                  time: new Date().toISOString(),
                }] : [],
                listingUrl: c.listingUrl || c.href || null,
                lastActive: c.lastActive || null,
                fromSnippet: true,
              };
            }
            if (thread && (thread.messages?.length > 0 || thread.snippet)) {
              await processConversation(thread, null);
            }
            unreadProcessedState[threadId] = now;
            processedCount++;
          } catch (unreadErr) {
            logWarn(`[unread-processor] Failed thread ${threadId}: ${unreadErr.message}`);
          }

          await new Promise(r => setTimeout(r, 1500));
        }

        if (processedCount > 0) log(`[unread-processor] Processed ${processedCount} unread conversation(s) this cycle`);

        // Prune old entries (> 48h) from state file
        for (const [id, ts] of Object.entries(unreadProcessedState)) {
          if (now - ts > 48 * 60 * 60 * 1000) delete unreadProcessedState[id];
        }
        try {
          fs.mkdirSync(path.join(BOT_DIR, 'data'), { recursive: true });
          fs.writeFileSync(UNREAD_PROCESSED_FILE, JSON.stringify(unreadProcessedState, null, 2));
        } catch (_) {}
      } catch (e) {
        logWarn(`[unread-processor] Error: ${e.message}`);
      }

      // ── Send approved pending replies ──────────────────────────────────────
      try {
        await sendApprovedReplies();
      } catch (e) {
        logWarn(`sendApprovedReplies error: ${e.message}`);
      }

      // ── Adaptive poll backoff: stepped ladder based on unread activity ──────
      if (cycleUnreadCount > 0) {
        jessBackoffStep = 0; // unread found → reset to fastest polling
      } else if (cycleUnreadCount === 0) {
        jessBackoffStep = Math.min(jessBackoffStep + 1, POLL_BACKOFF_STEPS.length - 1); // advance step
      }
      // if cycleUnreadCount === -1 (unread block errored), keep current step

    } catch (e) {
      logError(`Cycle error: ${e.message}`);
      // On error, do NOT advance step — retry at same delay
    }
  };

  // Quiet hours: no Flatmates polling between 11:30pm and 7:30am (Brisbane time)
  // Quiet hours only gates SENDING - drafting/reading runs 24/7
  const isQuietHoursForSend = () => {
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Australia/Brisbane' }));
    const mins = now.getHours() * 60 + now.getMinutes();
    return mins >= (23 * 60 + 30) || mins < (7 * 60 + 30); // 23:30-07:30
  };

  // Track whether we've sent the morning summary today
  let morningSummarySentDate = '';

  const sendMorningSummary = async () => {
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Australia/Brisbane' }));
    const today = now.toISOString().slice(0, 10);
    if (morningSummarySentDate === today) return; // already sent today
    const pending = loadPending().filter(p => p.status === 'pending');
    if (pending.length === 0) return;
    morningSummarySentDate = today;
    const byHouse = {};
    for (const p of pending) {
      const h = p.houseCode || '?';
      if (!byHouse[h]) byHouse[h] = [];
      byHouse[h].push(p.enquirerName || '?');
    }
    const lines = Object.entries(byHouse).map(([h, names]) => `  *${h}:* ${names.join(', ')}`).join('\n');
    try {
      await sendTelegramMessage(DIEGO_TG_CHAT_ID,
        `☀️ *Good morning - Jess overnight summary*\n\n*${pending.length} draft(s) ready for review:*\n${lines}\n\nSend \`/jess inspection <house> today <time> <slot-interval> <block-length> <host> <amount>\` to set today's schedule and update all drafts.\nReview & approve at: https://mc.inspectionsxraytesting.com.au`,
        { parse_mode: 'Markdown' }
      );
      log('[morning] Sent overnight summary');
    } catch(e) { logWarn(`Morning summary failed: ${e.message}`); }
  };

  const cycleWithQuietHours = async () => {
    if (jessPaused) return;
    // Quiet hours: no relay polling between 11:30pm and 7:30am (Brisbane time)
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Australia/Brisbane' }));
    const mins = now.getHours() * 60 + now.getMinutes();
    if (mins >= (23 * 60 + 30) || mins < (7 * 60 + 30)) {
      log('Quiet hours - skipping poll cycle');
      return;
    }
    await runCycleNow();
  };

  async function scheduleNextPoll() {
    await cycleWithQuietHours().catch(e => logError(`Poll cycle error (uncaught): ${e.message}`));
    const delay = POLL_BACKOFF_STEPS[jessBackoffStep];
    log(`[poll] Next poll in ${delay/1000}s (step ${jessBackoffStep})`);
    pollIntervalHandle = setTimeout(scheduleNextPoll, delay);
  }
  await scheduleNextPoll();
  log(`Relay polling started (adaptive stepped backoff: 30s → 60s → 5min → 10min → 15min)`);

  // ── Telegram command polling - every 3 seconds ──────────────────────────────
  await pollTelegramCommands();
  setInterval(() => pollTelegramCommands().catch(e => logError(`TG poll error: ${e.message}`)), 3000);
  setInterval(() => {
    const admin = loadAdminState();
    if (!admin.autoMode?.enabled) return;
    const delayMs = (2 + Math.floor(Math.random() * 7)) * 1000;
    setTimeout(() => runJessAutoStep().catch(e => logWarn(`[auto-mode] ${e.message}`)), delayMs);
  }, 30000);
  log(`@jess_flatmatesbot polling started (every 3s)`);

  // ── Boost availability monitor - checks every hour, alerts on change ────────
  const BOOST_STATE_FILE = path.join(DATA_DIR, 'jess-boost-state.json');
  const BOOST_CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
  // Priority suburbs - alert immediately when available
  const BOOST_WATCH = ['SP9', 'BRIS1', 'CO1', 'EB2'];

  const loadBoostState = () => {
    try { return JSON.parse(fs.readFileSync(BOOST_STATE_FILE, 'utf8')); } catch(_) { return {}; }
  };

  const runBoostMonitor = async () => {
    log('[boost-monitor] Checking boost availability for all listings...');
    const state = loadBoostState();
    const updates = {};

    for (const house of BOOST_WATCH) {
      try {
        const result = await checkBoostAvailability(house);
        const wasAvailable = state[house]?.available;
        const isAvailable  = result.available;
        updates[house] = {
          available: isAvailable,
          statusText: result.statusText,
          availableFrom: result.availableFrom,
          checkedAt: new Date().toISOString(),
          // Carry forward lastBecameAvailable timestamp
          lastBecameAvailable: isAvailable && !wasAvailable
            ? new Date().toISOString()
            : (state[house]?.lastBecameAvailable || null),
        };

        // Alert only when state changes: unavailable → available
        if (isAvailable && wasAvailable === false) {
          const listingId = HOUSE_CODE_TO_LISTING_ID[house];
          const boostUrl = `https://flatmates.com.au/listing/${listingId}/boost`;
          const msg = `🚀 *Boost spot opened for ${house}!*\n\nA spot just became available in that suburb. First in, best dressed - only 8 per area.\n\n👉 [Boost now](${boostUrl})`;
          sendTelegramMessage('1267601160', msg);
          log(`[boost-monitor] 🚀 ${house} boost just became AVAILABLE - alert sent`);
        } else if (!isAvailable && wasAvailable === true) {
          log(`[boost-monitor] ${house} boost became unavailable (taken by someone else)`);
        } else {
          log(`[boost-monitor] ${house}: ${isAvailable ? '✅ available' : '❌ unavailable'} (no change)`);
        }

        // Small gap between checks to avoid hammering Flatmates
        await new Promise(r => setTimeout(r, 3000));
      } catch (e) {
        logWarn(`[boost-monitor] ${house} check error: ${e.message}`);
      }
    }

    try { fs.writeFileSync(BOOST_STATE_FILE, JSON.stringify(updates, null, 2)); } catch(_) {}
  };

  // Run once at startup (after a short delay), then every hour
  setTimeout(() => runBoostMonitor().catch(e => logWarn(`[boost-monitor] startup error: ${e.message}`)), 2 * 60 * 1000);
  setInterval(() => runBoostMonitor().catch(e => logWarn(`[boost-monitor] interval error: ${e.message}`)), BOOST_CHECK_INTERVAL_MS);
  log('[boost-monitor] Hourly boost monitor scheduled (SP9, BRIS1, CO1, EB2)');
  // ────────────────────────────────────────────────────────────────────────────

  // ── Background thread enrichment worker (every 2 minutes) ──────────────────
  async function runBackgroundEnrichment() {
    if (isBrowserBusy) return; // don't interrupt active browser operations
    const eq = require('./modules/enrichment-queue');
    const batch = eq.dequeue(2); // process 2 at a time
    if (!batch.length) return;

    log(`[bg-enrich] Processing ${batch.length} threads needing enrichment`);

    for (const { threadId } of batch) {
      try {
        // Fetch thread data from relay (may already have listingId from extension)
        const threadData = await fetchThread(threadId).catch(() => null);

        if (threadData?.listingId || threadData?.subjectHref) {
          // Extract houseCode from listingId — check both r.listingId and P-number in listing_url
          const rooms = loadRooms();
          const lid = String(threadData.listingId || '').replace(/^P/i, '');
          const room = rooms.find(r =>
            (r.listingId && String(r.listingId).trim() === lid) ||
            (r.listing_url && r.listing_url.includes(`-P${lid}`))
          );
          if (room) {
            // Persist to thread-state
            const tsPath = path.join(__dirname, 'data', 'jess-thread-states.json');
            const ts = loadJSON(tsPath, {});
            ts[threadId] = {
              ...(ts[threadId] || {}),
              houseCode:  room.houseCode,
              enrichedAt: new Date().toISOString(),
              source:     'bg_enrich',
            };
            saveJSON(tsPath, ts);
            eq.markEnriched(threadId);
            log(`[bg-enrich] Thread ${threadId} enriched → ${room.houseCode}`);
            continue;
          }
        }

        // Thread not matched yet — request navigate to pick up listingId
        // Only if extension is available and browser is free
        const relayStatus = await relayGet('/api/status').catch(() => null);
        if (relayStatus?.extensionConnected && !isBrowserBusy) {
          await requestNavigate(threadId).catch(() => {});
          log(`[bg-enrich] Requested navigate for thread ${threadId}`);
        }
        // Will retry on next cycle (attempts already incremented by dequeue)
      } catch (err) {
        eq.markFailed(threadId, err.message);
        log(`[bg-enrich] Failed to enrich thread ${threadId}: ${err.message}`, 'WARN');
      }
    }
  }

  setInterval(() => runBackgroundEnrichment().catch(e => logWarn(`[bg-enrich] interval error: ${e.message}`)), 2 * 60 * 1000);
  log('[bg-enrich] Background thread enrichment scheduled (every 2 min)');
  // ────────────────────────────────────────────────────────────────────────────

  // ── Staleness watchdog (every 10 minutes) ────────────────────────────────────
  async function runStalenessWatchdog() {
    try {
      const status = await relayGet('/api/status').catch(() => null);
      if (!status) return;

      const hbAge = status.lastExtensionHeartbeat
        ? (Date.now() - new Date(status.lastExtensionHeartbeat).getTime()) / 1000
        : 999999;

      const inbox = await relayGet('/api/inbox').catch(() => null);
      const inboxEmpty = Array.isArray(inbox) && inbox.length === 0;
      const inboxLooksBroken = inbox === null || inboxEmpty;

      if (hbAge > 300) { // >5 minutes
        if (inboxLooksBroken) {
          log(`[watchdog] Heartbeat stale ${Math.round(hbAge / 60)}min but inbox load is empty/broken, backing off`);
          return;
        }
        await sendTelegramMessage(
          DIEGO_TG_CHAT_ID,
          `⚠️ Jess watchdog: extension heartbeat stale (${Math.round(hbAge / 60)}min). Open flatmates.com.au/messages.`
        ).catch(() => {});
        log(`[watchdog] Extension heartbeat stale ${Math.round(hbAge / 60)}min — alert sent`);
      }
    } catch (_) {}
  }

  setInterval(() => runStalenessWatchdog().catch(e => logWarn(`[watchdog] interval error: ${e.message}`)), 10 * 60 * 1000);
  log('[watchdog] Staleness watchdog scheduled (every 10 min)');
  // ────────────────────────────────────────────────────────────────────────────

  // Graceful shutdown
  process.on('SIGINT', () => {
    log('Received SIGINT - shutting down');
    if (pollIntervalHandle) clearTimeout(pollIntervalHandle);
    if (callbackServer) callbackServer.close();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    log('Received SIGTERM - shutting down');
    if (pollIntervalHandle) clearTimeout(pollIntervalHandle);
    if (callbackServer) callbackServer.close();
    process.exit(0);
  });

  log(`Polling every ${POLL_INTERVAL_MS / 60000} minutes. Press Ctrl+C to stop.`);
}

main().catch(async e => {
  log(`FATAL: ${e.message}`, 'ERROR');
  if (e?.code !== 'ERR_HTTP_HEADERS_SENT') {
    try { await pauseJess(`Unhandled exception: ${e.message}`, 0); } catch (_) {}
  }
  process.exit(1);
});

process.on('uncaughtException', async (err) => {
  log(`UNCAUGHT: ${err.message}`, 'ERROR');
  if (err?.code === 'ERR_HTTP_HEADERS_SENT') return;
  try { await pauseJess(`Unhandled exception: ${err.message}`, 0); } catch (_) {}
});

process.on('unhandledRejection', async (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  log(`UNHANDLED REJECTION: ${msg}`, 'ERROR');
  if (reason?.code === 'ERR_HTTP_HEADERS_SENT') return;
  try { await pauseJess(`Unhandled exception: ${msg}`, 0); } catch (_) {}
});
