require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const axios   = require('axios');
const path    = require('path');
const cron    = require('node-cron');

const app = express();
app.use(cors());
app.use(express.json());

const PERISKOPE_BASE = 'https://api.periskope.app/v1';
const ANTHROPIC_BASE = 'https://api.anthropic.com/v1';

// ── In-memory stores ───────────────────────────────────────────────────────
let cache = {
  summaries: {},
  lastRun:   null,
  running:   false,
  date:      null,
};

// Contact map: phone -> { name, isInternal, labels, type }
let contactMap = {};

const periskopeHeaders = () => ({
  'Authorization': `Bearer ${process.env.PERISKOPE_API_KEY}`,
  'x-phone':       process.env.PHONE_NUMBER,
  'Content-Type':  'application/json',
  'Accept':        'application/json',
});

// ── Load all contacts into memory ──────────────────────────────────────────
async function loadContacts() {
  console.log('[CONTACTS] Loading contact directory...');
  let offset = 0;
  const limit = 200;
  let total   = 0;
  contactMap  = {};

  try {
    while (true) {
      const res  = await axios.get(
        `${PERISKOPE_BASE}/contacts?offset=${offset}&limit=${limit}`,
        { headers: periskopeHeaders() }
      );
      const data     = res.data;
      const contacts = data.contacts || data.data || (Array.isArray(data) ? data : []);
      if (!contacts.length) break;

      contacts.forEach(c => {
        // contact_id is like "919876543210@c.us" — strip the @c.us
        const raw   = c.contact_id || '';
        const phone = raw.replace('@c.us', '').replace('@s.whatsapp.net', '');
        if (!phone) return;

        contactMap[phone] = {
          name:       c.contact_name || null,
          isInternal: c.is_internal  || false,
          labels:     c.labels       || [],
          type:       c.contact_type || 'user',
        };
        total++;
      });

      if (contacts.length < limit) break;
      offset += limit;
      await new Promise(r => setTimeout(r, 200));
    }

    console.log(`[CONTACTS] Loaded ${total} contacts`);
  } catch (e) {
    console.error('[CONTACTS] Failed to load:', e.message);
  }
}

// ── Resolve sender name from message ──────────────────────────────────────
function resolveSender(msg) {
  // Try direct name fields first
  const directName = msg.sender_name || msg.sender?.name;
  if (directName && directName !== 'Unknown') return { name: directName, meta: lookupPhone(msg) };

  // Try phone lookup
  const phone = extractPhone(msg);
  if (phone && contactMap[phone]) {
    const c = contactMap[phone];
    return { name: c.name || formatPhone(phone), meta: c };
  }

  // Fallback
  return { name: formatPhone(phone) || 'Member', meta: null };
}

function extractPhone(msg) {
  const raw = msg.sender_phone || msg.sender?.phone || msg.from || msg.org_phone || '';
  return raw.replace(/\D/g, '').replace(/^91/, '') || null;
}

function lookupPhone(msg) {
  const phone = extractPhone(msg);
  return phone && contactMap[phone] ? contactMap[phone] : null;
}

function formatPhone(phone) {
  if (!phone) return 'Member';
  return `+${phone.slice(0, 2)} ****${phone.slice(-4)}`;
}

function senderLabel(name, meta) {
  if (!meta) return name;
  const tags = [];
  if (meta.isInternal) tags.push('Staff');
  if (meta.labels?.length) tags.push(...meta.labels.slice(0, 2));
  return tags.length ? `${name} (${tags.join(', ')})` : name;
}

// ── Claude prompt ─────────────────────────────────────────────────────────
function buildPrompt(chatName, transcript, msgCount, hasContacts) {
  return `You are an AI assistant for Nia, a workforce housing company in India. Analyse this WhatsApp group chat from one of Nia's worker hostels or operational groups.

Messages may be in English, Hindi, Tamil, Telugu, Kannada, Bengali, Odia, Marathi, or any mix. Understand all. Respond ONLY in English.
${hasContacts ? 'Sender labels: names marked (Staff) are Nia employees. Others are members/workers. Labels like warden, supervisor indicate roles.' : ''}

Group: "${chatName}"
Messages in last 24 hours: ${msgCount}
---
${transcript}
---

Respond ONLY with a valid JSON object. No markdown, no backticks.

{
  "signals": {
    "urgent": <integer — unresolved safety/water/power/health/harassment issues>,
    "pending": <integer — complaints open, no staff response yet>,
    "resolved": <integer — issues acknowledged or fixed today>,
    "spokeUp": <integer — distinct members who sent messages>
  },
  "issues": [
    {
      "title": "<issue title in English, max 8 words>",
      "detail": "<who raised it, role if known, status — max 15 words>",
      "priority": "urgent" | "pending" | "resolved",
      "raisedBy": "<name of person who raised it, or 'Multiple members'>"
    }
  ],
  "announcements": [
    "<key announcement or notice in English, max 20 words>"
  ],
  "staffActivity": "<one sentence on what staff/wardens did or said today, or null if no staff active>",
  "mood": {
    "stressed": <0-100>,
    "mixed": <0-100>,
    "calm": <0-100>,
    "basis": "<one sentence explaining mood in English>"
  },
  "language": "<primary language, e.g. Hindi, Tamil, English, Mixed Hindi-English>",
  "summary": "<2-3 sentence plain English summary of what this group discussed today>"
}

Rules:
- issues: max 6, urgent first. Include even minor complaints if raised seriously.
- announcements: max 3. Only factual notices/info.
- mood must sum to exactly 100.
- Always fill summary — even for casual chats.
- Translate everything to English.
- If staff responded to a complaint, mark it resolved.`;
}

// ── Run summarisation job ─────────────────────────────────────────────────
async function runJob(label = 'CRON') {
  if (cache.running) { console.log(`[${label}] Already running`); return; }
  cache.running   = true;
  cache.summaries = {};
  const start     = new Date();
  console.log(`\n[${label}] Started at ${start.toISOString()}`);

  let chats = [];
  try {
    const res = await axios.get(`${PERISKOPE_BASE}/chats?limit=100`, { headers: periskopeHeaders() });
    chats = res.data.chats || res.data.data || res.data.results || (Array.isArray(res.data) ? res.data : []);
    console.log(`[${label}] ${chats.length} chats, ${Object.keys(contactMap).length} contacts loaded`);
  } catch (e) {
    console.error(`[${label}] Fetch chats failed:`, e.message);
    cache.running = false;
    return;
  }

  const since = Date.now() - 24 * 60 * 60 * 1000;
  let success = 0, skipped = 0, failed = 0;

  for (const chat of chats) {
    const chatId   = chat.chat_id || chat.id || '';
    const chatName = chat.chat_name || chat.name || chatId;
    if (!chatId) { skipped++; continue; }

    try {
      const msgRes   = await axios.get(
        `${PERISKOPE_BASE}/chats/${encodeURIComponent(chatId)}/messages?limit=200`,
        { headers: periskopeHeaders() }
      );
      const all      = msgRes.data.messages || msgRes.data.data || msgRes.data.results || [];
      const messages = all.filter(m => {
        const ts = m.timestamp || m.created_at || '';
        return ts ? new Date(ts).getTime() >= since : true;
      });

      // Skip direct chats — groups only
      const isGroup = chatId.endsWith('@g.us') || chat.chat_type === 'group';
      if (!isGroup) { skipped++; continue; }

      if (messages.length < 3) { skipped++; continue; }

      // Build sender set with resolved names
      const senderSet  = new Set();
      const staffActive = new Set();

      const transcript = messages.slice(-80).map(m => {
        const { name, meta } = resolveSender(m);
        const label  = senderLabel(name, meta);
        senderSet.add(name);
        if (meta?.isInternal) staffActive.add(name);
        const text = m.body || m.text || m.content || '';
        const ts   = m.timestamp || m.created_at || '';
        const time = ts ? new Date(ts).toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit' }) : '';
        return text ? `[${time}] ${label}: ${text}` : null;
      }).filter(Boolean).join('\n');

      const hasContacts = Object.keys(contactMap).length > 0;

      const aiRes = await axios.post(
        `${ANTHROPIC_BASE}/messages`,
        {
          model:      'claude-sonnet-4-20250514',
          max_tokens: 1000,
          messages:   [{ role: 'user', content: buildPrompt(chatName, transcript, messages.length, hasContacts) }]
        },
        {
          headers: {
            'Content-Type':      'application/json',
            'x-api-key':         process.env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
          }
        }
      );

      const raw   = aiRes.data.content?.[0]?.text || '{}';
      const clean = raw.replace(/```json|```/g, '').trim();
      let digest;
      try { digest = JSON.parse(clean); }
      catch { console.error(`[${label}] JSON parse failed for "${chatName}"`); skipped++; continue; }

      // Patch from real data
      if (!digest.signals) digest.signals = {};
      digest.signals.spokeUp = senderSet.size || digest.signals.spokeUp || 0;

      // Fix mood sum
      if (digest.mood) {
        const s = (digest.mood.stressed||0) + (digest.mood.mixed||0) + (digest.mood.calm||0);
        if (s !== 100 && s > 0) digest.mood.calm = Math.max(0, 100 - (digest.mood.stressed||0) - (digest.mood.mixed||0));
      }

      cache.summaries[chatId] = {
        chatName,
        chatType:    chat.chat_type || (chatId.endsWith('@g.us') ? 'group' : 'direct'),
        msgCount:    messages.length,
        staffCount:  staffActive.size,
        generatedAt: new Date().toISOString(),
        digest,
      };

      console.log(`[${label}] ✓ "${chatName}" (${messages.length} msgs, staff:${staffActive.size}, lang:${digest.language||'?'})`);
      success++;
      await new Promise(r => setTimeout(r, 400));

    } catch (e) {
      console.error(`[${label}] ✗ "${chatName}":`, e.response?.data || e.message);
      failed++;
    }
  }

  cache.lastRun = start.toISOString();
  cache.date    = start.toISOString().split('T')[0];
  cache.running = false;

  const dur = Math.round((Date.now() - start) / 1000);
  console.log(`[${label}] Done in ${dur}s — ✓${success} skip:${skipped} fail:${failed}\n`);
}

// ── Cron: 6:30 AM IST = 01:00 UTC ─────────────────────────────────────────
cron.schedule('0 1 * * *', async () => {
  await loadContacts();
  runJob('CRON').catch(e => console.error('[CRON]', e));
}, { timezone: 'UTC' });

// ── Boot: load contacts first, then run job ────────────────────────────────
console.log('[BOOT] Starting in 5s...');
setTimeout(async () => {
  await loadContacts();
  runJob('BOOT').catch(e => console.error('[BOOT]', e));
}, 5000);

// ── Routes ─────────────────────────────────────────────────────────────────
app.get('/api/summaries', (req, res) => {
  res.json({
    summaries:    cache.summaries,
    lastRun:      cache.lastRun,
    date:         cache.date,
    running:      cache.running,
    count:        Object.keys(cache.summaries).length,
    contactCount: Object.keys(contactMap).length,
  });
});

app.get('/api/chats', async (req, res) => {
  try {
    const r = await axios.get(`${PERISKOPE_BASE}/chats?limit=100`, { headers: periskopeHeaders() });
    const chats = r.data.chats || r.data.data || r.data.results || (Array.isArray(r.data) ? r.data : []);
    const groups = chats.filter(c => (c.chat_id || c.id || '').endsWith('@g.us') || c.chat_type === 'group');
    res.json({ chats: groups });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/chats/:chatId/messages', async (req, res) => {
  try {
    const r    = await axios.get(
      `${PERISKOPE_BASE}/chats/${encodeURIComponent(req.params.chatId)}/messages?limit=200`,
      { headers: periskopeHeaders() }
    );
    const all   = r.data.messages || r.data.data || r.data.results || [];
    const since = Date.now() - 24 * 60 * 60 * 1000;
    const msgs  = all.filter(m => { const ts = m.timestamp || m.created_at || ''; return ts ? new Date(ts).getTime() >= since : true; });

    // Enrich messages with resolved sender names
    const enriched = msgs.map(m => {
      const { name, meta } = resolveSender(m);
      return { ...m, resolved_name: senderLabel(name, meta), is_staff: meta?.isInternal || false };
    });

    res.json({ messages: enriched });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/job-status', (req, res) => {
  res.json({
    lastRun:      cache.lastRun,
    date:         cache.date,
    running:      cache.running,
    count:        Object.keys(cache.summaries).length,
    contactCount: Object.keys(contactMap).length,
    nextRun:      '01:00 UTC (6:30 AM IST)',
  });
});

app.get('/api/contacts/stats', (req, res) => {
  const contacts = Object.values(contactMap);
  res.json({
    total:    contacts.length,
    internal: contacts.filter(c => c.isInternal).length,
    labeled:  contacts.filter(c => c.labels?.length > 0).length,
    labels:   [...new Set(contacts.flatMap(c => c.labels))].sort(),
  });
});

const buildPath = path.join(__dirname, '../client/build');
app.use(express.static(buildPath));
app.get('*', (req, res) => res.sendFile(path.join(buildPath, 'index.html')));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server on port ${PORT}`));
