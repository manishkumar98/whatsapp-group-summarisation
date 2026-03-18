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

// ── In-memory cache ────────────────────────────────────────────────────────
let cache = {
  summaries: {},
  lastRun:   null,
  running:   false,
  date:      null,
};

const periskopeHeaders = () => ({
  'Authorization': `Bearer ${process.env.PERISKOPE_API_KEY}`,
  'x-phone':       process.env.PHONE_NUMBER,
  'Content-Type':  'application/json',
  'Accept':        'application/json',
});

// ── Claude prompt — structured JSON digest ─────────────────────────────────
function buildPrompt(chatName, transcript, msgCount) {
  return `You are an AI assistant for Nia, a workforce housing company in India. You are analysing a WhatsApp group chat from one of Nia's worker hostels or operational groups.

The messages may be in English, Hindi, Tamil, Telugu, Kannada, Bengali, Odia, Marathi, or any mix of Indian languages. Understand all of them and respond ONLY in English.

Group: "${chatName}"
Messages in last 24 hours: ${msgCount}
---
${transcript}
---

Respond ONLY with a valid JSON object. No markdown, no backticks, no preamble. Use this exact structure:

{
  "signals": {
    "urgent": <number of urgent unresolved issues>,
    "pending": <number of pending/open issues>,
    "resolved": <number of resolved issues today>,
    "spokeUp": <number of distinct members who sent messages>
  },
  "issues": [
    {
      "title": "<short issue title in English, max 8 words>",
      "detail": "<who raised it, how many agree, current status — max 12 words>",
      "priority": "urgent" | "pending" | "resolved",
      "isNew": true | false
    }
  ],
  "announcements": [
    "<key announcement or info shared, in English, max 20 words>"
  ],
  "mood": {
    "stressed": <0-100 percentage>,
    "mixed": <0-100 percentage>,
    "calm": <0-100 percentage>,
    "basis": "<one sentence explaining mood assessment>"
  },
  "language": "<primary language detected e.g. Hindi, Tamil, Mixed>"
}

Rules:
- issues array: max 6 items, ordered by priority (urgent first)
- announcements array: max 3 items, only factual info/notices
- mood percentages must sum to 100
- If no issues found, return empty arrays
- Translate all content to English regardless of original language
- urgent = safety/water/power/health issues with no resolution
- pending = complaints open, no response yet
- resolved = issues fixed or acknowledged today`;
}

// ── Run summarisation job ──────────────────────────────────────────────────
async function runJob(label = 'CRON') {
  if (cache.running) { console.log(`[${label}] Already running`); return; }
  cache.running  = true;
  cache.summaries = {};
  const start    = new Date();
  console.log(`\n[${label}] Started at ${start.toISOString()}`);

  let chats = [];
  try {
    const res = await axios.get(`${PERISKOPE_BASE}/chats?limit=100`, { headers: periskopeHeaders() });
    chats = res.data.chats || res.data.data || res.data.results || (Array.isArray(res.data) ? res.data : []);
    console.log(`[${label}] ${chats.length} chats`);
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

      if (messages.length < 5) { skipped++; continue; }

      // Count unique senders
      const senders = new Set(messages.map(m => m.sender_name || m.sender?.name).filter(Boolean));

      const transcript = messages.slice(-80).map(m => {
        const sender = m.sender_name || m.sender?.name || 'Unknown';
        const text   = m.body || m.text || m.content || '';
        const ts     = m.timestamp || m.created_at || '';
        const time   = ts ? new Date(ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '';
        return text ? `[${time}] ${sender}: ${text}` : null;
      }).filter(Boolean).join('\n');

      const aiRes = await axios.post(
        `${ANTHROPIC_BASE}/messages`,
        {
          model:      'claude-sonnet-4-20250514',
          max_tokens: 1000,
          messages: [{ role: 'user', content: buildPrompt(chatName, transcript, messages.length) }]
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': process.env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
          }
        }
      );

      const raw  = aiRes.data.content?.[0]?.text || '{}';
      const clean = raw.replace(/```json|```/g, '').trim();
      let digest;
      try { digest = JSON.parse(clean); }
      catch { console.error(`[${label}] JSON parse failed for "${chatName}"`); skipped++; continue; }

      // Patch spokeUp from actual data if model missed it
      if (!digest.signals) digest.signals = {};
      digest.signals.spokeUp = digest.signals.spokeUp || senders.size;

      cache.summaries[chatId] = {
        chatName,
        chatType:    chat.chat_type || (chatId.endsWith('@g.us') ? 'group' : 'direct'),
        msgCount:    messages.length,
        generatedAt: new Date().toISOString(),
        digest,
      };

      console.log(`[${label}] ✓ "${chatName}" (${messages.length} msgs, lang: ${digest.language || '?'})`);
      success++;
      await new Promise(r => setTimeout(r, 400));

    } catch (e) {
      console.error(`[${label}] ✗ "${chatName}":`, e.message);
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
cron.schedule('0 1 * * *', () => {
  runJob('CRON').catch(e => console.error('[CRON]', e));
}, { timezone: 'UTC' });

// ── Boot job ───────────────────────────────────────────────────────────────
console.log('[BOOT] Scheduling initial job in 5s...');
setTimeout(() => runJob('BOOT').catch(e => console.error('[BOOT]', e)), 5000);

// ── Routes ─────────────────────────────────────────────────────────────────
app.get('/api/summaries', (req, res) => {
  res.json({ summaries: cache.summaries, lastRun: cache.lastRun, date: cache.date, running: cache.running, count: Object.keys(cache.summaries).length });
});

app.get('/api/chats', async (req, res) => {
  try {
    const r = await axios.get(`${PERISKOPE_BASE}/chats?limit=100`, { headers: periskopeHeaders() });
    const chats = r.data.chats || r.data.data || r.data.results || (Array.isArray(r.data) ? r.data : []);
    res.json({ chats });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/chats/:chatId/messages', async (req, res) => {
  try {
    const r    = await axios.get(`${PERISKOPE_BASE}/chats/${encodeURIComponent(req.params.chatId)}/messages?limit=200`, { headers: periskopeHeaders() });
    const all  = r.data.messages || r.data.data || r.data.results || [];
    const since = Date.now() - 24 * 60 * 60 * 1000;
    const messages = all.filter(m => { const ts = m.timestamp || m.created_at || ''; return ts ? new Date(ts).getTime() >= since : true; });
    res.json({ messages });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/job-status', (req, res) => {
  res.json({ lastRun: cache.lastRun, date: cache.date, running: cache.running, count: Object.keys(cache.summaries).length, nextRun: '01:00 UTC (6:30 AM IST)' });
});

// ── Static ─────────────────────────────────────────────────────────────────
const buildPath = path.join(__dirname, '../client/build');
app.use(express.static(buildPath));
app.get('*', (req, res) => res.sendFile(path.join(buildPath, 'index.html')));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server on port ${PORT}`));
