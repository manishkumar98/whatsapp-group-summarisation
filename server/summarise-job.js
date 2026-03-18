const axios = require('axios');
const fs    = require('fs');
const path  = require('path');

const PERISKOPE_BASE = 'https://api.periskope.app/v1';
const ANTHROPIC_BASE = 'https://api.anthropic.com/v1';
const SUMMARIES_FILE = path.join(__dirname, '../data/summaries.json');

function periskopeHeaders() {
  return {
    'Authorization': `Bearer ${process.env.PERISKOPE_API_KEY}`,
    'x-phone':       process.env.PHONE_NUMBER,
    'Content-Type':  'application/json',
    'Accept':        'application/json',
  };
}

function loadSummaries() {
  try {
    if (fs.existsSync(SUMMARIES_FILE)) {
      return JSON.parse(fs.readFileSync(SUMMARIES_FILE, 'utf8'));
    }
  } catch (e) { console.error('Load summaries error:', e.message); }
  return {};
}

function saveSummaries(data) {
  try {
    const dir = path.dirname(SUMMARIES_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(SUMMARIES_FILE, JSON.stringify(data, null, 2));
  } catch (e) { console.error('Save summaries error:', e.message); }
}

async function fetchChats() {
  const res = await axios.get(`${PERISKOPE_BASE}/chats?limit=100&offset=0`, {
    headers: periskopeHeaders()
  });
  const data = res.data;
  return data.chats || data.data || data.results || (Array.isArray(data) ? data : []);
}

async function fetchMessages(chatId) {
  const res = await axios.get(
    `${PERISKOPE_BASE}/chats/${encodeURIComponent(chatId)}/messages?limit=200`,
    { headers: periskopeHeaders() }
  );
  const data = res.data;
  const all  = data.messages || data.data || data.results || (Array.isArray(data) ? data : []);
  const since = Date.now() - 24 * 60 * 60 * 1000;
  return all.filter(m => {
    const ts = m.timestamp || m.created_at || '';
    return ts ? new Date(ts).getTime() >= since : true;
  });
}

async function summarise(chatName, messages) {
  const transcript = messages
    .slice(-60)
    .map(m => {
      const sender = m.sender_name || m.sender?.name || 'Unknown';
      const text   = m.body || m.text || m.content || '';
      return text ? `${sender}: ${text}` : null;
    })
    .filter(Boolean)
    .join('\n');

  if (!transcript.trim()) return null;

  const res = await axios.post(
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
  return res.data.content?.[0]?.text || null;
}

async function runDailyJob() {
  const startTime = new Date();
  console.log(`\n[CRON] Daily summarisation started at ${startTime.toISOString()}`);

  let chats = [];
  try {
    chats = await fetchChats();
    console.log(`[CRON] Fetched ${chats.length} chats`);
  } catch (e) {
    console.error('[CRON] Failed to fetch chats:', e.message);
    return;
  }

  const summaries = loadSummaries();
  const today     = new Date().toISOString().split('T')[0];
  let success = 0, skipped = 0, failed = 0;

  for (const chat of chats) {
    const chatId   = chat.chat_id || chat.id || '';
    const chatName = chat.chat_name || chat.name || chatId;
    if (!chatId) { skipped++; continue; }

    try {
      const messages = await fetchMessages(chatId);

      if (messages.length < 5) {
        console.log(`[CRON] Skipping "${chatName}" — only ${messages.length} messages`);
        skipped++;
        continue;
      }

      console.log(`[CRON] Summarising "${chatName}" (${messages.length} msgs)...`);
      const summary = await summarise(chatName, messages);

      if (!summary) { skipped++; continue; }

      if (!summaries[chatId]) summaries[chatId] = { chatName, history: [] };
      summaries[chatId].chatName    = chatName;
      summaries[chatId].lastSummary = summary;
      summaries[chatId].lastRun     = startTime.toISOString();
      summaries[chatId].lastDate    = today;
      summaries[chatId].msgCount    = messages.length;

      // Keep last 7 days of history
      if (!summaries[chatId].history) summaries[chatId].history = [];
      summaries[chatId].history.unshift({ date: today, summary, msgCount: messages.length });
      summaries[chatId].history = summaries[chatId].history.slice(0, 7);

      saveSummaries(summaries);
      success++;

      // Small delay to avoid rate limits
      await new Promise(r => setTimeout(r, 500));
    } catch (e) {
      console.error(`[CRON] Failed "${chatName}":`, e.message);
      failed++;
    }
  }

  const duration = Math.round((Date.now() - startTime) / 1000);
  console.log(`[CRON] Done in ${duration}s — success: ${success}, skipped: ${skipped}, failed: ${failed}\n`);
}

module.exports = { runDailyJob, loadSummaries };
