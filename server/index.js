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

// ── In-memory cache (cleared each day by cron) ─────────────────────────────
let cache = {
  summaries: {},   // chatId -> { chatName, summary, msgCount, generatedAt }
  lastRun:   null, // ISO timestamp of last cron run
  running:   false,
  date:      null, // YYYY-MM-DD of last run
};

const periskopeHeaders = () => ({
  'Authorization': `Bearer ${process.env.PERISKOPE_API_KEY}`,
  'x-phone':       process.env.PHONE_NUMBER,
  'Content-Type':  'application/json',
  'Accept':        'application/json',
});

// ── Core job logic ─────────────────────────────────────────────────────────
async function runJob(label = 'CRON') {
  if (cache.running) {
    console.log(`[${label}] Already running, skipping`);
    return;
  }
  cache.running = true;
  cache.summaries = {};
  const start = new Date();
  console.log(`\n[${label}] Started at ${start.toISOString()}`);

  // 1. Fetch all chats
  let chats = [];
  try {
    const res = await axios.get(`${PERISKOPE_BASE}/chats?limit=100`, { headers: periskopeHeaders() });
    chats = res.data.chats || res.data.data || res.data.results || (Array.isArray(res.data) ? res.data : []);
    console.log(`[${label}] ${chats.length} chats fetched`);
  } catch (e) {
    console.error(`[${label}] Failed to fetch chats:`, e.message);
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
      // 2. Fetch last 24h messages
      const msgRes  = await axios.get(
        `${PERISKOPE_BASE}/chats/${encodeURIComponent(chatId)}/messages?limit=200`,
        { headers: periskopeHeaders() }
      );
      const all      = msgRes.data.messages || msgRes.data.data || msgRes.data.results || [];
      const messages = all.filter(m => {
        const ts = m.timestamp || m.created_at || '';
        return ts ? new Date(ts).getTime() >= since : true;
      });

      // Skip quiet chats — saves tokens
      if (messages.length < 5) {
        console.log(`[${label}] Skip "${chatName}" — ${messages.length} msgs`);
        skipped++;
        continue;
      }

      // 3. Build transcript
      const transcript = messages.slice(-60).map(m => {
        const sender = m.sender_name || m.sender?.name || 'Unknown';
        const text   = m.body || m.text || m.content || '';
        return text ? `${sender}: ${text}` : null;
      }).filter(Boolean).join('\n');

      if (!transcript.trim()) { skipped++; continue; }

      // 4. Summarise with Claude
      const aiRes = await axios.post(
        `${ANTHROPIC_BASE}/messages`,
        {
          model:      'claude-sonnet-4-20250514',
          max_tokens: 800,
          messages: [{
            role:    'user',
            content: `Summarise this WhatsApp group chat from the last 24 hours in 4-6 clear bullet points. Focus on key topics, decisions, and action items.\n\nGroup: "${chatName}"\n\n${transcript}`
          }]
        },
        {
          headers: {
            'Content-Type':      'application/json',
            'x-api-key':         process.env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
          }
        }
      );

      const summary = aiRes.data.content?.[0]?.text;
      if (!summary) { skipped++; continue; }

      // 5. Store in memory cache
      cache.summaries[chatId] = {
        chatName,
        summary,
        msgCount:    messages.length,
        generatedAt: new Date().toISOString(),
      };

      console.log(`[${label}] ✓ "${chatName}" (${messages.length} msgs)`);
      success++;

      // Small delay between calls to avoid rate limits
      await new Promise(r => setTimeout(r, 300));

    } catch (e) {
      console.error(`[${label}] ✗ "${chatName}":`, e.message);
      failed++;
    }
  }

  cache.lastRun = start.toISOString();
  cache.date    = start.toISOString().split('T')[0];
  cache.running = false;

  const duration = Math.round((Date.now() - start) / 1000);
  console.log(`[${label}] Done in ${duration}s — ✓${success} skipped:${skipped} failed:${failed}\n`);
}

// ── Schedule: 6:30 AM IST = 01:00 UTC ──────────────────────────────────────
cron.schedule('0 1 * * *', () => {
  runJob('CRON').catch(e => console.error('[CRON] Unhandled:', e));
}, { timezone: 'UTC' });

// ── Run immediately on first boot ───────────────────────────────────────────
console.log('[BOOT] Running initial summarisation job...');
setTimeout(() => {
  runJob('BOOT').catch(e => console.error('[BOOT] Unhandled:', e));
}, 5000); // 5s delay so server is fully ready first

// ── API: GET /api/summaries — return cached summaries ──────────────────────
app.get('/api/summaries', (req, res) => {
  res.json({
    summaries:  cache.summaries,
    lastRun:    cache.lastRun,
    date:       cache.date,
    running:    cache.running,
    count:      Object.keys(cache.summaries).length,
  });
});

// ── API: GET /api/chats ────────────────────────────────────────────────────
app.get('/api/chats', async (req, res) => {
  try {
    const response = await axios.get(
      `${PERISKOPE_BASE}/chats?limit=100&offset=0`,
      { headers: periskopeHeaders() }
    );
    const data  = response.data;
    const chats = data.chats || data.data || data.results || (Array.isArray(data) ? data : []);
    res.json({ chats });
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.response?.data?.message || err.message });
  }
});

// ── API: GET /api/chats/:chatId/messages ───────────────────────────────────
app.get('/api/chats/:chatId/messages', async (req, res) => {
  try {
    const { chatId } = req.params;
    const response = await axios.get(
      `${PERISKOPE_BASE}/chats/${encodeURIComponent(chatId)}/messages?limit=200`,
      { headers: periskopeHeaders() }
    );
    const data     = response.data;
    const all      = data.messages || data.data || data.results || (Array.isArray(data) ? data : []);
    const since    = Date.now() - 24 * 60 * 60 * 1000;
    const messages = all.filter(m => {
      const ts = m.timestamp || m.created_at || '';
      return ts ? new Date(ts).getTime() >= since : true;
    });
    res.json({ messages, total: all.length, filtered: messages.length });
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.response?.data?.message || err.message });
  }
});

// ── API: GET /api/job-status ───────────────────────────────────────────────
app.get('/api/job-status', (req, res) => {
  res.json({
    lastRun:    cache.lastRun,
    date:       cache.date,
    running:    cache.running,
    count:      Object.keys(cache.summaries).length,
    nextRun:    '01:00 UTC (6:30 AM IST)',
  });
});

// ── Serve React build ──────────────────────────────────────────────────────
const buildPath = path.join(__dirname, '../client/build');
app.use(express.static(buildPath));
app.get('*', (req, res) => {
  res.sendFile(path.join(buildPath, 'index.html'));
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
