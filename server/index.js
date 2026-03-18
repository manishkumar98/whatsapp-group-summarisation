require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const axios    = require('axios');
const path     = require('path');
const cron     = require('node-cron');
const { getCommunity, COMMUNITY_COLORS } = require('./community-map');

const app = express();
app.use(cors());
app.use(express.json());

const PERISKOPE_BASE = 'https://api.periskope.app/v1';
const ANTHROPIC_BASE = 'https://api.anthropic.com/v1';

let cache = { summaries: {}, lastRun: null, running: false, date: null };
let contactMap = {};

const periskopeHeaders = () => ({
  'Authorization': `Bearer ${process.env.PERISKOPE_API_KEY}`,
  'x-phone':       process.env.PHONE_NUMBER,
  'Content-Type':  'application/json',
  'Accept':        'application/json',
});

async function loadContacts() {
  console.log('[CONTACTS] Loading...');
  let offset = 0; contactMap = {};
  try {
    while (true) {
      const res = await axios.get(`${PERISKOPE_BASE}/contacts?offset=${offset}&limit=200`, { headers: periskopeHeaders() });
      const contacts = res.data.contacts || res.data.data || (Array.isArray(res.data) ? res.data : []);
      if (!contacts.length) break;
      contacts.forEach(c => {
        const phone = (c.contact_id || '').replace('@c.us','').replace('@s.whatsapp.net','');
        if (phone) contactMap[phone] = { name: c.contact_name || null, isInternal: c.is_internal || false, labels: c.labels || [] };
      });
      if (contacts.length < 200) break;
      offset += 200;
      await new Promise(r => setTimeout(r, 200));
    }
    console.log(`[CONTACTS] ${Object.keys(contactMap).length} loaded`);
  } catch (e) { console.error('[CONTACTS] Failed:', e.message); }
}

function resolveSender(msg) {
  const directName = msg.sender_name || msg.sender?.name;
  if (directName && directName !== 'Unknown') return { name: directName, meta: lookupMeta(msg) };
  const phone = extractPhone(msg);
  if (phone && contactMap[phone]) {
    const c = contactMap[phone];
    return { name: c.name || formatPhone(phone), meta: c };
  }
  return { name: formatPhone(extractPhone(msg)) || 'Member', meta: null };
}

function lookupMeta(msg) {
  const phone = extractPhone(msg);
  return phone && contactMap[phone] ? contactMap[phone] : null;
}

function extractPhone(msg) {
  const raw = msg.sender_phone || msg.sender?.phone || msg.from || '';
  return raw.replace(/\D/g,'').replace(/^91/,'') || null;
}

function formatPhone(p) { return p ? `+91 ****${p.slice(-4)}` : 'Member'; }

function senderLabel(name, meta) {
  if (!meta) return name;
  const tags = [];
  if (meta.isInternal) tags.push('Staff');
  if (meta.labels?.length) tags.push(...meta.labels.slice(0, 1));
  return tags.length ? `${name} (${tags.join(', ')})` : name;
}

function buildPrompt(chatName, community, transcript, msgCount) {
  return `You are an AI assistant for Nia, a workforce housing company in India.
This is a WhatsApp group for a Nia Studio in the ${community} community.
The group is named after the warden/supervisor managing that studio: "${chatName}".
Messages may be in English, Hindi, Tamil, Telugu, Kannada, Bengali, Odia, Marathi or any mix. Respond ONLY in English.

Messages in last 24 hours: ${msgCount}
---
${transcript}
---

Respond ONLY with valid JSON. No markdown, no backticks.

{
  "signals": {
    "urgent": <integer — unresolved safety/water/power/health issues>,
    "pending": <integer — open complaints no response>,
    "resolved": <integer — issues fixed today>,
    "spokeUp": <integer — distinct members>
  },
  "issues": [
    { "title": "<max 8 words>", "detail": "<who raised, status — max 15 words>", "priority": "urgent"|"pending"|"resolved", "raisedBy": "<name or Multiple members>" }
  ],
  "announcements": ["<max 20 words each>"],
  "staffActivity": "<one sentence on staff/warden actions today, or null>",
  "mood": { "stressed": <0-100>, "mixed": <0-100>, "calm": <0-100>, "basis": "<one sentence>" },
  "language": "<primary language detected>",
  "summary": "<2-3 sentence summary in English>"
}

Rules: issues max 6 urgent-first. announcements max 3. mood must sum to 100. Always fill summary.`;
}

async function runJob(label = 'CRON') {
  if (cache.running) return;
  cache.running = true; cache.summaries = {};
  const start = new Date();
  console.log(`\n[${label}] Started ${start.toISOString()}`);

  let chats = [];
  try {
    const res = await axios.get(`${PERISKOPE_BASE}/chats?limit=100`, { headers: periskopeHeaders() });
    const all = res.data.chats || res.data.data || res.data.results || [];
    // Groups only, skip announcement/community groups
    chats = all.filter(c => {
      const id   = c.chat_id || c.id || '';
      const name = (c.chat_name || c.name || '').toLowerCase();
      const isGroup = id.endsWith('@g.us') || c.chat_type === 'group';
      const isAnnouncement = name.includes('announcement') || name.includes('nia wellington community') || name.includes('nia deccan community') || name.includes('nia rajputana community') || name.includes('nia coromandel community');
      return isGroup && !isAnnouncement;
    });
    console.log(`[${label}] ${chats.length} studio groups`);
  } catch (e) { console.error(`[${label}] Chats failed:`, e.message); cache.running = false; return; }

  const since = Date.now() - 24 * 60 * 60 * 1000;
  let success = 0, skipped = 0, failed = 0;

  for (const chat of chats) {
    const chatId   = chat.chat_id || chat.id || '';
    const chatName = chat.chat_name || chat.name || chatId;
    const community = getCommunity(chatName) || 'Uncategorised';
    if (!chatId) { skipped++; continue; }

    try {
      const msgRes = await axios.get(`${PERISKOPE_BASE}/chats/${encodeURIComponent(chatId)}/messages?limit=200`, { headers: periskopeHeaders() });
      const all    = msgRes.data.messages || msgRes.data.data || msgRes.data.results || [];
      const msgs   = all.filter(m => { const ts = m.timestamp || m.created_at || ''; return ts ? new Date(ts).getTime() >= since : true; });

      if (msgs.length < 3) { skipped++; continue; }

      const senderSet = new Set(); const staffSet = new Set();
      const transcript = msgs.slice(-80).map(m => {
        const { name, meta } = resolveSender(m);
        const label = senderLabel(name, meta);
        senderSet.add(name);
        if (meta?.isInternal) staffSet.add(name);
        const text = m.body || m.text || m.content || '';
        const ts   = m.timestamp || m.created_at || '';
        const time = ts ? new Date(ts).toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit' }) : '';
        return text ? `[${time}] ${label}: ${text}` : null;
      }).filter(Boolean).join('\n');

      const aiRes = await axios.post(`${ANTHROPIC_BASE}/messages`, {
        model: 'claude-sonnet-4-20250514', max_tokens: 1000,
        messages: [{ role: 'user', content: buildPrompt(chatName, community, transcript, msgs.length) }]
      }, { headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' } });

      const raw = aiRes.data.content?.[0]?.text || '{}';
      let digest;
      try { digest = JSON.parse(raw.replace(/```json|```/g,'').trim()); }
      catch { skipped++; continue; }

      if (!digest.signals) digest.signals = {};
      digest.signals.spokeUp = senderSet.size;
      if (digest.mood) {
        const s = (digest.mood.stressed||0)+(digest.mood.mixed||0)+(digest.mood.calm||0);
        if (s !== 100 && s > 0) digest.mood.calm = Math.max(0, 100-(digest.mood.stressed||0)-(digest.mood.mixed||0));
      }

      cache.summaries[chatId] = { chatName, community, chatType: 'group', msgCount: msgs.length, staffCount: staffSet.size, generatedAt: new Date().toISOString(), digest };
      console.log(`[${label}] ✓ [${community}] "${chatName}" (${msgs.length} msgs)`);
      success++;
      await new Promise(r => setTimeout(r, 400));
    } catch (e) { console.error(`[${label}] ✗ "${chatName}":`, e.message); failed++; }
  }

  cache.lastRun = start.toISOString();
  cache.date    = start.toISOString().split('T')[0];
  cache.running = false;
  console.log(`[${label}] Done — ✓${success} skip:${skipped} fail:${failed}\n`);
}

cron.schedule('0 1 * * *', async () => { await loadContacts(); runJob('CRON').catch(console.error); }, { timezone: 'UTC' });
console.log('[BOOT] Starting in 5s...');
setTimeout(async () => { await loadContacts(); runJob('BOOT').catch(console.error); }, 5000);

app.get('/api/summaries', (req, res) => {
  // Group summaries by community
  const byCommunity = {};
  Object.entries(cache.summaries).forEach(([chatId, s]) => {
    const c = s.community || 'Uncategorised';
    if (!byCommunity[c]) byCommunity[c] = { color: COMMUNITY_COLORS[c] || COMMUNITY_COLORS['Uncategorised'], groups: [] };
    byCommunity[c].groups.push({ chatId, ...s });
  });
  res.json({ summaries: cache.summaries, byCommunity, lastRun: cache.lastRun, date: cache.date, running: cache.running, count: Object.keys(cache.summaries).length });
});

app.get('/api/chats', async (req, res) => {
  try {
    const r = await axios.get(`${PERISKOPE_BASE}/chats?limit=100`, { headers: periskopeHeaders() });
    const all = r.data.chats || r.data.data || r.data.results || [];
    const groups = all.filter(c => {
      const id = c.chat_id || c.id || '';
      const name = (c.chat_name || c.name || '').toLowerCase();
      return (id.endsWith('@g.us') || c.chat_type === 'group') &&
        !name.includes('announcement') && !name.includes('nia wellington community') &&
        !name.includes('nia deccan community') && !name.includes('nia rajputana community') &&
        !name.includes('nia coromandel community');
    });
    // Add community to each chat
    const enriched = groups.map(c => ({ ...c, community: getCommunity(c.chat_name || c.name) }));
    res.json({ chats: enriched });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/chats/:chatId/messages', async (req, res) => {
  try {
    const r    = await axios.get(`${PERISKOPE_BASE}/chats/${encodeURIComponent(req.params.chatId)}/messages?limit=200`, { headers: periskopeHeaders() });
    const all  = r.data.messages || r.data.data || r.data.results || [];
    const since = Date.now() - 24 * 60 * 60 * 1000;
    const msgs  = all.filter(m => { const ts = m.timestamp || m.created_at || ''; return ts ? new Date(ts).getTime() >= since : true; });
    const enriched = msgs.map(m => { const { name, meta } = resolveSender(m); return { ...m, resolved_name: senderLabel(name, meta), is_staff: meta?.isInternal || false }; });
    res.json({ messages: enriched });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/job-status', (req, res) => {
  res.json({ lastRun: cache.lastRun, date: cache.date, running: cache.running, count: Object.keys(cache.summaries).length, nextRun: '01:00 UTC (6:30 AM IST)' });
});

const buildPath = path.join(__dirname, '../client/build');
app.use(express.static(buildPath));
app.get('*', (req, res) => res.sendFile(path.join(buildPath, 'index.html')));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server on port ${PORT}`));
