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

function buildPrompt(chatName, transcript, msgCount) {
  return `You are an AI assistant for Nia, a workforce housing company in India. Analyse this WhatsApp group chat.

Messages may be in English, Hindi, Tamil, Telugu, Kannada, Bengali, Odia, Marathi, or any mix. Understand all languages. Respond ONLY in English.

Group: "${chatName}"
Messages in last 24 hours: ${msgCount}
---
${transcript}
---

Respond ONLY with a valid JSON object — no markdown, no backticks, no explanation.

{
  "signals": {
    "urgent": <integer — safety/water/power/health issues with no resolution>,
    "pending": <integer — complaints open with no response>,
    "resolved": <integer — issues fixed or acknowledged today>,
    "spokeUp": <integer — distinct members who sent messages>
  },
  "issues": [
    {
      "title": "<issue title in English, max 8 words>",
      "detail": "<who raised it, status, follow-ups — max 15 words>",
      "priority": "urgent" | "pending" | "resolved"
    }
  ],
  "announcements": [
    "<key announcement or information shared, in English, max 20 words>"
  ],
  "mood": {
    "stressed": <0-100>,
    "mixed": <0-100>,
    "calm": <0-100>,
    "basis": "<one sentence explaining the mood assessment in English>"
  },
  "language": "<primary language detected, e.g. Hindi, Tamil, English, Mixed Hindi-English>",
  "summary": "<2-3 sentence plain English summary of what this group discussed today>"
}

Rules:
- issues: max 6, ordered urgent first. Include even minor complaints.
- announcements: max 3. Only factual notices/info shared.
- mood percentages MUST sum to exactly 100.
- If the chat is mostly casual (greetings, jokes), set mood calm-heavy and note it in basis.
- If truly nothing happened, issues and announcements can be empty arrays [].
- Always fill "summary" — describe what the group talked about even if trivial.
- Translate everything to English.`;
}

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

      // Skip if truly empty
      if (messages.length < 3) {
        console.log(`[${label}] Skip "${chatName}" — only ${messages.length} msgs`);
        skipped++;
        continue;
      }

      // Count unique senders — use phone as fallback for name
      const senderSet = new Set();
      const transcript = messages.slice(-80).map(m => {
        const name   = m.sender_name || m.sender?.name || null;
        const phone  = m.sender_phone || m.sender?.phone || m.org_phone || null;
        const sender = name || (phone ? phone.replace(/\D/g,'').slice(-4).padStart(4,'*') : 'Member');
        senderSet.add(sender);
        const text   = m.body || m.text || m.content || '';
        const ts     = m.timestamp || m.created_at || '';
        const time   = ts ? new Date(ts).toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit' }) : '';
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
      catch (pe) {
        console.error(`[${label}] JSON parse failed for "${chatName}":`, pe.message);
        skipped++; continue;
      }

      // Patch spokeUp from actual data
      if (!digest.signals) digest.signals = {};
      digest.signals.spokeUp = senderSet.size || digest.signals.spokeUp || 0;

      // Ensure mood sums to 100
      if (digest.mood) {
        const sum = (digest.mood.stressed||0) + (digest.mood.mixed||0) + (digest.mood.calm||0);
        if (sum !== 100 && sum > 0) {
          digest.mood.calm = 100 - (digest.mood.stressed||0) - (digest.mood.mixed||0);
        }
      }

      cache.summaries[chatId] = {
        chatName,
        chatType:    chat.chat_type || (chatId.endsWith('@g.us') ? 'group' : 'direct'),
        msgCount:    messages.length,
        generatedAt: new Date().toISOString(),
        digest,
      };

      console.log(`[${label}] ✓ "${chatName}" (${messages.length} msgs, ${digest.language || '?'})`);
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

// Cron: 6:30 AM IST = 01:00 UTC
cron.schedule('0 1 * * *', () => {
  runJob('CRON').catch(e => console.error('[CRON]', e));
}, { timezone: 'UTC' });

// Boot job
console.log('[BOOT] Running initial job in 5s...');
setTimeout(() => runJob('BOOT').catch(e => console.error('[BOOT]', e)), 5000);

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


// ── DEBUG: see raw message structure ──────────────────────────────────────
app.get('/api/debug/:chatId', async (req, res) => {
  try {
    const r   = await axios.get(`${PERISKOPE_BASE}/chats/${encodeURIComponent(req.params.chatId)}/messages?limit=5`, { headers: periskopeHeaders() });
    const all = r.data.messages || r.data.data || r.data.results || [];
    // Return first 3 messages with ALL fields so we can see the structure
    res.json({ 
      raw: all.slice(0, 3),
      keys: all[0] ? Object.keys(all[0]) : [],
      senderKeys: all[0]?.sender ? Object.keys(all[0].sender) : 'no sender object'
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

const buildPath = path.join(__dirname, '../client/build');
app.use(express.static(buildPath));
app.get('*', (req, res) => res.sendFile(path.join(buildPath, 'index.html')));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server on port ${PORT}`));
