import React, { useState, useEffect, useCallback } from 'react';
import './App.css';

function timeAgo(ts) {
  if (!ts) return '';
  const diff = (Date.now() - new Date(ts)) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function Avatar({ name, size = 40 }) {
  const initials = (name || '?').split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
  const colors   = ['#2C5880','#2D8659','#E06D1F','#4A7BA8','#C45D1A','#1A3654'];
  const color    = colors[(name?.charCodeAt(0) || 0) % colors.length];
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: color + '18', border: `1.5px solid ${color}44`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.36, fontWeight: 600, color, flexShrink: 0,
    }}>{initials}</div>
  );
}

function Spinner({ size = 16 }) {
  return <div className="spinner" style={{ width: size, height: size }} />;
}

function JobStatusBar({ status, onRunNow, running }) {
  if (!status) return null;
  const today = new Date().toISOString().split('T')[0];
  const isToday = status.lastRun?.startsWith(today);
  return (
    <div className="job-bar">
      <div className="job-bar-left">
        <div className={`dot ${isToday ? '' : 'dot-warn'}`} />
        <span>
          {isToday
            ? `Today's summaries ready · ${status.todayCount} groups`
            : `Last run: ${status.lastRun ? timeAgo(status.lastRun) : 'never'}`}
        </span>
        <span className="job-next">Next: 6:30 AM IST</span>
      </div>
      <button className="run-now-btn" onClick={onRunNow} disabled={running}>
        {running ? <><Spinner size={12} /> Running…</> : '▶ Run now'}
      </button>
    </div>
  );
}

function ChatItem({ chat, active, onClick, hasSummary }) {
  const isGroup = chat.chat_type === 'group' || (chat.chat_id || '').endsWith('@g.us');
  const name    = chat.chat_name || chat.name || 'Unknown';
  const lastMsg = chat.latest_message?.body || chat.last_message?.body || '';
  const ts      = chat.updated_at || chat.latest_message?.timestamp || '';
  return (
    <div className={`chat-item ${active ? 'active' : ''}`} onClick={onClick}>
      <Avatar name={name} size={40} />
      <div className="chat-body">
        <div className="chat-top">
          <span className="chat-name">{name}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {hasSummary && <span className="summary-dot" title="Summary ready" />}
            <span className="chat-time">{timeAgo(ts)}</span>
          </div>
        </div>
        <div className="chat-bottom">
          <span className="chat-preview">{lastMsg || 'No messages yet'}</span>
          {isGroup && <span className="badge badge-group">group</span>}
        </div>
      </div>
    </div>
  );
}

function SummaryPanel({ chat, storedSummary, onSummarise, summary, loading, messages }) {
  if (!chat) {
    return (
      <div className="empty-state">
        <div className="empty-icon">💬</div>
        <div className="empty-title">Select a chat to view summary</div>
        <div style={{ fontSize: 13 }}>Daily summaries run at 6:30 AM IST</div>
      </div>
    );
  }

  const name    = chat.chat_name || chat.name || 'Unknown';
  const isGroup = chat.chat_type === 'group' || (chat.chat_id || '').endsWith('@g.us');
  const displaySummary = summary || storedSummary?.lastSummary;
  const summaryDate    = storedSummary?.lastDate;
  const isStoredToday  = summaryDate === new Date().toISOString().split('T')[0];

  return (
    <div className="panel">
      <div className="panel-header">
        <Avatar name={name} size={46} />
        <div className="panel-info">
          <div className="panel-name">{name}</div>
          <span className={`type-pill ${isGroup ? 'group' : 'direct'}`}>
            {isGroup ? 'Group chat' : 'Direct message'}
          </span>
        </div>
        <button className="summarise-btn" onClick={onSummarise} disabled={loading}>
          {loading ? <><Spinner size={14} /> Summarising…</> : '↻ Refresh summary'}
        </button>
      </div>

      {displaySummary && (
        <div className="summary-box">
          <div className="summary-box-hdr">
            <span className="summary-label">
              {summary ? 'Live summary' : isStoredToday ? "Today's summary" : `Summary · ${summaryDate}`}
            </span>
            <span className="summary-model">claude sonnet 4</span>
          </div>
          <div className="summary-body">
            {displaySummary.split('\n').filter(l => l.trim()).map((line, i) => (
              <div key={i} className="s-line">
                <span className="s-bullet">▸</span>
                <span>{line.replace(/^[•\-*\d+\.]\s*/, '')}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {!displaySummary && !loading && (
        <div className="no-summary-box">
          No summary yet for this chat. Click <strong>Refresh summary</strong> to generate one, or wait for the 6:30 AM IST daily run.
        </div>
      )}

      {storedSummary?.history?.length > 1 && (
        <div className="history-section">
          <div className="msgs-hdr">Summary history (last 7 days)</div>
          {storedSummary.history.slice(1).map((h, i) => (
            <div key={i} className="history-item">
              <div className="history-date">{h.date} · {h.msgCount} messages</div>
              <div className="history-summary">{h.summary.slice(0, 200)}…</div>
            </div>
          ))}
        </div>
      )}

      {messages.length > 0 && (
        <div className="msgs-box">
          <div className="msgs-hdr">Messages today ({messages.length})</div>
          <div className="msgs-list">
            {messages.slice(-30).reverse().map((msg, i) => {
              const sender = msg.sender_name || msg.sender?.name || 'Unknown';
              const text   = msg.body || msg.text || msg.content || '';
              const ts     = msg.timestamp || msg.created_at || '';
              if (!text) return null;
              return (
                <div key={i} className="msg-item">
                  <div className="msg-meta">
                    <span className="msg-sender">{sender}</span>
                    <span className="msg-time">{timeAgo(ts)}</span>
                  </div>
                  <div className="msg-text">{text}</div>
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
  const [chats,      setChats]      = useState([]);
  const [summaries,  setSummaries]  = useState({});
  const [jobStatus,  setJobStatus]  = useState(null);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState('');
  const [activeChat, setActiveChat] = useState(null);
  const [messages,   setMessages]   = useState([]);
  const [summary,    setSummary]    = useState('');
  const [summarising,setSummarising]= useState(false);
  const [jobRunning, setJobRunning] = useState(false);
  const [search,     setSearch]     = useState('');
  const [filter,     setFilter]     = useState('all');

  useEffect(() => {
    fetchChats();
    fetchSummaries();
    fetchJobStatus();
    const interval = setInterval(fetchJobStatus, 60000);
    return () => clearInterval(interval);
  }, []);

  async function fetchChats() {
    setLoading(true); setError('');
    try {
      const res  = await fetch('/api/chats?limit=100');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setChats(data.chats || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  async function fetchSummaries() {
    try {
      const res  = await fetch('/api/summaries');
      if (!res.ok) return;
      const data = await res.json();
      setSummaries(data.summaries || {});
    } catch {}
  }

  async function fetchJobStatus() {
    try {
      const res  = await fetch('/api/job-status');
      if (!res.ok) return;
      const data = await res.json();
      setJobStatus(data);
    } catch {}
  }

  const selectChat = useCallback(async (chat) => {
    setActiveChat(chat);
    setSummary('');
    setMessages([]);
    try {
      const res  = await fetch(`/api/chats/${encodeURIComponent(chat.chat_id)}/messages`);
      if (!res.ok) return;
      const data = await res.json();
      setMessages(data.messages || []);
    } catch {}
  }, []);

  const summarise = useCallback(async () => {
    if (!activeChat) return;
    setSummarising(true); setSummary('');
    try {
      const res  = await fetch('/api/summarise', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatName: activeChat.chat_name || activeChat.name, messages })
      });
      const data = await res.json();
      setSummary(data.summary || '');
      fetchSummaries();
    } catch (e) { setSummary(`Error: ${e.message}`); }
    finally { setSummarising(false); }
  }, [activeChat, messages]);

  const runNow = useCallback(async () => {
    setJobRunning(true);
    try {
      await fetch('/api/run-now', { method: 'POST' });
      setTimeout(() => { fetchSummaries(); fetchJobStatus(); setJobRunning(false); }, 5000);
    } catch { setJobRunning(false); }
  }, []);

  const filtered = chats.filter(c => {
    const name    = (c.chat_name || c.name || '').toLowerCase();
    const isGroup = c.chat_type === 'group' || (c.chat_id || '').endsWith('@g.us');
    return name.includes(search.toLowerCase()) &&
      (filter === 'all' || (filter === 'groups' && isGroup) || (filter === 'direct' && !isGroup));
  });

  const todayCount    = Object.values(summaries).filter(s =>
    s.lastDate === new Date().toISOString().split('T')[0]).length;

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="s-logo">
            <span className="s-logo-icon">N</span>
            <span className="s-logo-text">Nia.One</span>
          </div>
          <div className="s-logo-sub">WhatsApp Summariser</div>
          <div className="today-badge">
            {todayCount > 0 ? `${todayCount} summaries ready today` : 'Awaiting daily run'}
          </div>
        </div>

        <div className="search-wrap">
          <div className="search-box">
            <span style={{ color: 'var(--gray400)', fontSize: 16 }}>⌕</span>
            <input type="text" placeholder="Search chats…" value={search}
              onChange={e => setSearch(e.target.value)} />
          </div>
          <button className="refresh-btn" onClick={fetchChats} title="Refresh">↻</button>
        </div>

        <div className="filter-row">
          {['all','groups','direct'].map(f => (
            <button key={f} className={`f-btn ${filter === f ? 'active' : ''}`}
              onClick={() => setFilter(f)}>{f}</button>
          ))}
        </div>

        <div className="chats-list">
          {loading && <div className="loading-state"><Spinner size={20} /><span>Loading…</span></div>}
          {error   && <div className="error-state"><span>⚠ {error}</span><button className="retry-btn" onClick={fetchChats}>Retry</button></div>}
          {!loading && !error && filtered.length === 0 && <div className="loading-state">No chats found</div>}
          {filtered.map((chat, i) => (
            <ChatItem key={chat.chat_id} chat={chat}
              active={activeChat?.chat_id === chat.chat_id}
              hasSummary={!!summaries[chat.chat_id]}
              onClick={() => selectChat(chat)} />
          ))}
        </div>

        <div className="sidebar-footer">
          <div className="dot" />
          <span>{chats.length} chats loaded</span>
          <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--gray400)' }}>
            Next run 6:30 AM IST
          </span>
        </div>
      </aside>

      <main className="main">
        <JobStatusBar status={jobStatus} onRunNow={runNow} running={jobRunning} />
        <SummaryPanel
          chat={activeChat}
          storedSummary={activeChat ? summaries[activeChat.chat_id] : null}
          messages={messages}
          summary={summary}
          loading={summarising}
          onSummarise={summarise}
        />
      </main>
    </div>
  );
}
