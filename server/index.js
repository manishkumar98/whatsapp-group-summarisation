require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

const PERISKOPE_BASE = 'https://api.periskope.app/v1';
const ANTHROPIC_BASE = 'https://api.anthropic.com/v1';

const periskopeHeaders = () => ({
  'Authorization': `Bearer ${process.env.PERISKOPE_API_KEY}`,
  'x-phone': process.env.PHONE_NUMBER,
  'Content-Type': 'application/json',
  'Accept': 'application/json',
});

// ── GET /api/chats ──────────────────────────────────────────────────────────
app.get('/api/chats', async (req, res) => {
  try {
    const limit = req.query.limit || 50;
    const offset = req.query.offset || 0;
    const response = await axios.get(
      `${PERISKOPE_BASE}/chats?limit=${limit}&offset=${offset}`,
      { headers: periskopeHeaders() }
    );
    const data = response.data;
    const chats = data.chats || data.data || data.results || (Array.isArray(data) ? data : []);
    res.json({ chats });
  } catch (err) {
    console.error('Chats error:', err.response?.data || err.message);
    res.status(err.response?.status || 500).json({
      error: err.response?.data?.message || err.message
    });
  }
});

// ── GET /api/chats/:chatId/messages ─────────────────────────────────────────
app.get('/api/chats/:chatId/messages', async (req, res) => {
  try {
    const { chatId } = req.params;
    const limit = req.query.limit || 50;
    const response = await axios.get(
      `${PERISKOPE_BASE}/chats/${encodeURIComponent(chatId)}/messages?limit=${limit}`,
      { headers: periskopeHeaders() }
    );
    const data = response.data;
    const messages = data.messages || data.data || data.results || (Array.isArray(data) ? data : []);
    res.json({ messages });
  } catch (err) {
    console.error('Messages error:', err.response?.data || err.message);
    res.status(err.response?.status || 500).json({
      error: err.response?.data?.message || err.message
    });
  }
});

// ── POST /api/summarise ──────────────────────────────────────────────────────
app.post('/api/summarise', async (req, res) => {
  try {
    const { chatName, messages } = req.body;
    if (!messages || !messages.length) {
      return res.status(400).json({ error: 'No messages provided' });
    }

    const transcript = messages
      .slice(-60)
      .map(m => {
        const sender = m.sender_name || m.sender?.name || 'Unknown';
        const text = m.body || m.text || m.content || '';
        return text ? `${sender}: ${text}` : null;
      })
      .filter(Boolean)
      .join('\n');

    if (!transcript.trim()) {
      return res.json({ summary: 'No text messages found to summarise.' });
    }

    const response = await axios.post(
      `${ANTHROPIC_BASE}/messages`,
      {
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [{
          role: 'user',
          content: `Summarise this WhatsApp group chat in 4-6 clear bullet points. Focus on key topics discussed, decisions made, action items, and any important information shared.\n\nGroup: "${chatName}"\n\n${transcript}`
        }]
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        }
      }
    );

    const summary = response.data.content?.[0]?.text || 'Could not generate summary.';
    res.json({ summary });
  } catch (err) {
    console.error('Summarise error:', err.response?.data || err.message);
    res.status(err.response?.status || 500).json({
      error: err.response?.data?.message || err.message
    });
  }
});

// ── Serve React in production ────────────────────────────────────────────────
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../client/build')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/build/index.html'));
  });
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
