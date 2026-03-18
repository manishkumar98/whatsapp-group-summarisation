require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const axios    = require('axios');
const path     = require('path');
const cron     = require('node-cron');
const { runDailyJob, loadSummaries } = require('./summarise-job');

const app = express();
app.use(cors());
app.use(express.json());

const PERISKOPE_BASE = 'https://api.periskope.app/v1';
const ANTHROPIC_BASE = 'https://api.anthropic.com/v1';

const periskopeHeaders = () => ({
  'Authorization': `Bearer ${process.env.PERISKOPE_API_KEY}`,
  'x-phone':       process.env.PHONE_NUMBER,
  'Content-Type':  'application/json',
  'Accept':        'application/json',
});

// ── Cron: every day at 6:30 AM IST (1:00 AM UTC) ──────────────────────────
cron.schedule('0 1 * * *', () => {
  runDailyJob().catch(e => console.error('[CRON] Unhandled error:', e));
}, { timezone: 'UTC' });

console.log('[CRON] Daily job scheduled for 6:30 AM IST (01:00 UTC) every day');

// ── GET /api/chats ─────────────────────────────────────────────────────────
app.get('/api/chats', async (req, res) => {
  try {
    const limit  = req.query.limit  || 50;
    const offset = req.query.offset || 0;
    const response = await axios.get(
      `${PERISKOPE_BASE}/chats?limit=${limit}&offset=${offset}`,
      { headers: periskopeHeaders() }
    );
    const data  = response.data;
    const chats = data.chats || data.data || data.results || (Array.isArray(data) ? data : []);
    res.json({ chats });
  } catch (err) {
    console.error('Chats error:', err.response?.data || err.message);
    res.status(err.response?.status || 500).json({ error: err.response?.data?.message || err.message });
  }
});

// ── GET /api/chats/:chatId/messages ────────────────────────────────────────
app.get('/api/chats/:chatId/messages', async (req, res) => {
  try {
    const { chatId } = req.params;
    const response = await axios.get(
      `${PERISKOPE_BASE}/chats/${encodeURIComponent(chatId)}/messages?limit=200`,
      { headers: periskopeHeaders() }
    );
    const data = response.data;
    const all  = data.messages || data.data || data.results || (Array.isArray(data) ? data : []);
    const since = Date.now() - 24 * 60 * 60 * 1000;
    const messages = all.filter(m => {
      const ts = m.timestamp || m.created_at || '';
      return ts ? new Date(ts).getTime() >= since : true;
    });
    res.json({ messages, total: all.length, filtered: messages.length });
  } catch (err) {
    console.error('Messages error:', err.response?.data || err.message);
    res.status(err.response?.status || 500).json({ error: err.response?.data?.message || err.message });
  }
});

// ── GET /api/summaries — return today's pre-computed summaries ─────────────
app.get('/api/summaries', (req, res) => {
  try {
    const summaries = loadSummaries();
    res.json({ summaries, lastUpdated: Object.values(summaries)[0]?.lastRun || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/summarise — on-demand summarisation ──────────────────────────
app.post('/api/summarise', async (req, res) => {
  try {
    const { chatName, messages } = req.body;
    if (!messages || !messages.length) return res.status(400).json({ error: 'No messages provided' });

    const transcript = messages
      .slice(-60)
      .map(m => {
        const sender = m.sender_name || m.sender?.name || 'Unknown';
        const text   = m.body || m.text || m.content || '';
        return text ? `${sender}: ${text}` : null;
      })
      .filter(Boolean)
      .join('\n');

    if (!transcript.trim()) return res.json({ summary: 'No text messages found to summarise.' });

    const response = await axios.post(
      `${ANTHROPIC_BASE}/messages`,
      {
        model:      'claude-sonnet-4-20250514',
        max_tokens: 800,
        messages: [{
          role:    'user',
          content: `Summarise this WhatsApp group chat from the last 24 hours in 4-6 clear bullet points. Focus on key topics discussed, decisions made, action items, and important information.\n\nGroup: "${chatName}"\n\n${transcript}`
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

    const summary = response.data.content?.[0]?.text || 'Could not generate summary.';
    res.json({ summary });
  } catch (err) {
    console.error('Summarise error:', err.response?.data || err.message);
    res.status(err.response?.status || 500).json({ error: err.response?.data?.message || err.message });
  }
});

// ── POST /api/run-now — manually trigger the job ───────────────────────────
app.post('/api/run-now', async (req, res) => {
  res.json({ message: 'Daily job started in background' });
  runDailyJob().catch(e => console.error('[MANUAL] Job error:', e));
});

// ── GET /api/job-status — check last run info ──────────────────────────────
app.get('/api/job-status', (req, res) => {
  const summaries = loadSummaries();
  const entries   = Object.values(summaries);
  const lastRun   = entries.length ? entries[0].lastRun : null;
  const total     = entries.length;
  const today     = new Date().toISOString().split('T')[0];
  const todayCount = entries.filter(s => s.lastDate === today).length;
  res.json({ lastRun, total, todayCount, nextRun: '01:00 UTC (6:30 AM IST)' });
});

// ── Serve React build ──────────────────────────────────────────────────────
const buildPath = path.join(__dirname, '../client/build');
app.use(express.static(buildPath));
app.get('*', (req, res) => {
  res.sendFile(path.join(buildPath, 'index.html'));
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
