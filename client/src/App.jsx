import React, { useState, useEffect, useCallback } from 'react';
import './App.css';

const API = '';

function timeAgo(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const diff = (Date.now() - d) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function Avatar({ name, size = 40 }) {
  const initials = (name || '?').split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
  const colors = ['#25d366','#128c7e','#34b7f1','#075e54','#25d366','#dcf8c6'];
  const color = colors[name?.charCodeAt(0) % colors.length] || '#25d366';
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: color + '22', border: `1.5px solid ${color}44`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.36, fontWeight: 600, color, flexShrink: 0,
      letterSpacing: '-0.5px'
    }}>
      {initials}
    </div>
  );
}

function Spinner({ size = 16 }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      border: `2px solid var(--border2)`,
      borderTopColor: 'var(--accent)',
      animation: 'spin 0.7s linear infinite', flexShrink: 0
    }} />
  );
}

function ChatItem({ chat, active, onClick }) {
  const isGroup = chat.chat_type === 'group' || (chat.chat_id || '').endsWith('@g.us');
  const name = chat.chat_name || chat.name || 'Unknown';
  const lastMsg = chat.latest_message?.body || chat.last_message?.body || '';
  const ts = chat.updated_at || chat.latest_message?.timestamp || '';

  return (
    <div className={`chat-item ${active ? 'active' : ''}`} onClick={onClick}>
      <Avatar name={name} size={42} />
      <div className="chat-item-body">
        <div className="chat-item-top">
          <span className="chat-item-name">{name}</span>
          <span className="chat-item-time">{timeAgo(ts)}</span>
        </div>
        <div className="chat-item-bottom">
          <span className="chat-item-preview">{lastMsg || 'No messages yet'}</span>
          {isGroup && <span className="badge-group">group</span>}
        </div>
      </div>
    </div>
  );
}

function SummaryPanel({ chat, onSummarise, summary, loading, messages }) {
  if (!chat) {
    return (
      <div className="empty-state">
        <div className="empty-icon">💬</div>
        <p>Select a chat to summarise</p>
        <span>Click any conversation on the left</span>
      </div>
    );
  }

  const name = chat.chat_name || chat.name || 'Unknown';
  const isGroup = chat.chat_type === 'group' || (chat.chat_id || '').endsWith('@g.us');

  return (
    <div className="summary-panel">
      <div className="summary-header">
        <Avatar name={name} size={48} />
        <div>
          <h2 className="summary-title">{name}</h2>
          <span className={`type-badge ${isGroup ? 'group' : 'direct'}`}>
            {isGroup ? 'Group chat' : 'Direct message'}
          </span>
        </div>
        <button
          className="summarise-btn"
          onClick={onSummarise}
          disabled={loading}
        >
          {loading ? <><Spinner size={14} /> Summarising…</> : '✦ Summarise last 24h'}
        </button>
      </div>

      {summary && (
        <div className="summary-box">
          <div className="summary-box-header">
            <span className="summary-label">AI Summary</span>
            <span className="summary-model">claude sonnet</span>
          </div>
          <div className="summary-content">
            {summary.split('\n').filter(l => l.trim()).map((line, i) => (
              <div key={i} className="summary-line">
                {line.startsWith('•') || line.startsWith('-') || line.match(/^\d+\./)
                  ? <><span className="bullet">▸</span><span>{line.replace(/^[•\-\d+\.]\s*/, '')}</span></>
                  : <span>{line}</span>
                }
              </div>
            ))}
          </div>
        </div>
      )}

      {messages.length > 0 && (
        <div className="messages-section">
          <div className="messages-header">Recent messages ({messages.length})</div>
          <div className="messages-list">
            {messages.slice(-30).reverse().map((msg, i) => {
              const sender = msg.sender_name || msg.sender?.name || 'Unknown';
              const text = msg.body || msg.text || msg.content || '';
              const ts = msg.timestamp || msg.created_at || '';
              if (!text) return null;
              return (
                <div key={i} className="message-item">
                  <div className="message-meta">
                    <span className="message-sender">{sender}</span>
                    <span className="message-time">{timeAgo(ts)}</span>
                  </div>
                  <div className="message-text">{text}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [chats, setChats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeChat, setActiveChat] = useState(null);
  const [messages, setMessages] = useState([]);
  const [summary, setSummary] = useState('');
  const [summarising, setSummarising] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    fetchChats();
  }, []);

  async function fetchChats() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API}/api/chats?limit=50`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setChats(data.chats || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  const selectChat = useCallback(async (chat) => {
    setActiveChat(chat);
    setSummary('');
    setMessages([]);
    try {
      const res = await fetch(`${API}/api/chats/${encodeURIComponent(chat.chat_id)}/messages?limit=50`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setMessages(data.messages || []);
    } catch (e) {
      console.error('Messages error:', e);
    }
  }, []);

  const summarise = useCallback(async () => {
    if (!activeChat || !messages.length) return;
    setSummarising(true);
    setSummary('');
    try {
      const res = await fetch(`${API}/api/summarise`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chatName: activeChat.chat_name || activeChat.name,
          messages
        })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setSummary(data.summary || '');
    } catch (e) {
      setSummary(`Error: ${e.message}`);
    } finally {
      setSummarising(false);
    }
  }, [activeChat, messages]);

  const filtered = chats.filter(c => {
    const name = (c.chat_name || c.name || '').toLowerCase();
    const matchSearch = name.includes(search.toLowerCase());
    const isGroup = c.chat_type === 'group' || (c.chat_id || '').endsWith('@g.us');
    const matchFilter = filter === 'all' || (filter === 'groups' && isGroup) || (filter === 'direct' && !isGroup);
    return matchSearch && matchFilter;
  });

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="logo">
            <span className="logo-icon">◈</span>
            <span className="logo-text">Periskope</span>
          </div>
          <div className="logo-sub">AI Chat Summariser</div>
        </div>

        <div className="search-bar">
          <span className="search-icon">⌕</span>
          <input
            type="text"
            placeholder="Search chats…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        <div className="filter-tabs">
          {['all', 'groups', 'direct'].map(f => (
            <button
              key={f}
              className={`filter-tab ${filter === f ? 'active' : ''}`}
              onClick={() => setFilter(f)}
            >
              {f}
            </button>
          ))}
        </div>

        <div className="chats-list">
          {loading && (
            <div className="loading-state">
              <Spinner size={20} />
              <span>Loading chats…</span>
            </div>
          )}
          {error && (
            <div className="error-state">
              <span>⚠ {error}</span>
              <button onClick={fetchChats}>Retry</button>
            </div>
          )}
          {!loading && !error && filtered.length === 0 && (
            <div className="empty-chats">No chats found</div>
          )}
          {filtered.map(chat => (
            <ChatItem
              key={chat.chat_id}
              chat={chat}
              active={activeChat?.chat_id === chat.chat_id}
              onClick={() => selectChat(chat)}
            />
          ))}
        </div>

        <div className="sidebar-footer">
          <div className="status-dot" />
          <span>{chats.length} chats loaded</span>
        </div>
      </aside>

      <main className="main">
        <SummaryPanel
          chat={activeChat}
          messages={messages}
          summary={summary}
          loading={summarising}
          onSummarise={summarise}
        />
      </main>
    </div>
  );
}
