import React, { useState, useEffect, useCallback, useRef } from 'react';
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

function Spinner({ size = 16, color = 'var(--nia500)' }) {
  return <div className="spinner" style={{ width: size, height: size, borderTopColor: color }} />;
}

function JobBar({ status }) {
  if (!status) return null;
  const isRunning = status.running;
  const hasData   = status.count > 0;
  const isToday   = status.date === new Date().toISOString().split('T')[0];

  return (
    <div className={`job-bar ${isRunning ? 'job-bar-running' : hasData && isToday ? 'job-bar-done' : 'job-bar-warn'}`}>
      {isRunning ? (
        <><Spinner size={13} color="var(--nia500)" />
        <span>Generating today's summaries — this takes a few minutes on first load…</span></>
      ) : hasData && isToday ? (
        <><div className="dot" /><span>{status.count} group summaries ready · generated {timeAgo(status.lastRun)}</span>
        <span className="job-next">Next run: 6:30 AM IST</span></>
      ) : (
        <><div className="dot dot-warn" /><span>Summaries not yet generated today · next run 6:30 AM IST</span></>
      )}
    </div>
  );
}

function ChatItem({ chat, active, summary, onClick }) {
  const isGroup = chat.chat_type === 'group' || (chat.chat_id || '').endsWith('@g.us');
  const name    = chat.chat_name || chat.name || 'Unknown';
  const ts      = chat.updated_at || chat.latest_message?.timestamp || '';
  return (
    <div className={`chat-item ${active ? 'active' : ''}`} onClick={onClick}>
      <Avatar name={name} size={40} />
      <div className="chat-body">
        <div className="chat-top">
          <span className="chat-name">{name}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {summary && <span className="summary-dot" title="Summary ready" />}
            <span className="chat-time">{timeAgo(ts)}</span>
          </div>
        </div>
        <div className="chat-bottom">
          <span className="chat-preview">
            {summary ? summary.summary.slice(0, 60) + '…' : 'No summary yet'}
          </span>
          {isGroup && <span className="badge badge-group">group</span>}
        </div>
      </div>
    </div>
  );
}

function SummaryPanel({ chat, summary, messages, loadingMsgs }) {
  if (!chat) {
    return (
      <div className="empty-state">
        <div className="empty-icon">💬</div>
        <div className="empty-title">Select a chat</div>
        <div style={{ fontSize: 13 }}>Summaries are generated daily at 6:30 AM IST</div>
      </div>
    );
  }

  const name    = chat.chat_name || chat.name || 'Unknown';
  const isGroup = chat.chat_type === 'group' || (chat.chat_id || '').endsWith('@g.us');

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
        {summary && (
          <span style={{ fontSize: 12, color: 'var(--gray400)', marginLeft: 'auto' }}>
            {summary.msgCount} msgs · {timeAgo(summary.generatedAt)}
          </span>
        )}
      </div>

      {summary ? (
        <div className="summary-box">
          <div className="summary-box-hdr">
            <span className="summary-label">Today's summary</span>
            <span className="summary-model">claude sonnet 4 · {summary.msgCount} messages</span>
          </div>
          <div className="summary-body">
            {summary.summary.split('\n').filter(l => l.trim()).map((line, i) => (
              <div key={i} className="s-line">
                <span className="s-bullet">▸</span>
                <span>{line.replace(/^[•\-*\d+\.]\s*/, '')}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="no-summary-box">
          No summary for this chat today — either it had fewer than 5 messages in the last 24h, or today's job is still running.
        </div>
      )}

      {loadingMsgs ? (
        <div className="loading-state"><Spinner size={16} /><span>Loading messages…</span></div>
      ) : messages.length > 0 && (
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
  const [loadingChats, setLoadingChats] = useState(true);
  const [error,      setError]      = useState('');
  const [activeChat, setActiveChat] = useState(null);
  const [messages,   setMessages]   = useState([]);
  const [loadingMsgs,setLoadingMsgs]= useState(false);
  const [search,     setSearch]     = useState('');
  const [filter,     setFilter]     = useState('all');
  const pollRef = useRef(null);

  useEffect(() => {
    fetchChats();
    fetchSummaries();
    startPolling();
    return () => stopPolling();
  }, []);

  function startPolling() {
    pollRef.current = setInterval(() => {
      fetchSummaries();
    }, 15000); // poll every 15s while job might be running
  }

  function stopPolling() {
    if (pollRef.current) clearInterval(pollRef.current);
  }

  async function fetchChats() {
    setLoadingChats(true); setError('');
    try {
      const res  = await fetch('/api/chats');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setChats(data.chats || []);
    } catch (e) { setError(e.message); }
    finally { setLoadingChats(false); }
  }

  async function fetchSummaries() {
    try {
      const res  = await fetch('/api/summaries');
      if (!res.ok) return;
      const data = await res.json();
      setSummaries(data.summaries || {});
      setJobStatus({
        running: data.running,
        lastRun: data.lastRun,
        date:    data.date,
        count:   data.count,
      });
      // Stop polling once job finishes
      if (!data.running && data.count > 0) stopPolling();
    } catch {}
  }

  const selectChat = useCallback(async (chat) => {
    setActiveChat(chat);
    setMessages([]);
    setLoadingMsgs(true);
    try {
      const res  = await fetch(`/api/chats/${encodeURIComponent(chat.chat_id)}/messages`);
      if (!res.ok) return;
      const data = await res.json();
      setMessages(data.messages || []);
    } catch {}
    finally { setLoadingMsgs(false); }
  }, []);

  const filtered = chats.filter(c => {
    const name    = (c.chat_name || c.name || '').toLowerCase();
    const isGroup = c.chat_type === 'group' || (c.chat_id || '').endsWith('@g.us');
    return name.includes(search.toLowerCase()) &&
      (filter === 'all' || (filter === 'groups' && isGroup) || (filter === 'direct' && !isGroup));
  });

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
            {jobStatus?.running ? 'Generating summaries…'
              : jobStatus?.count > 0 ? `${jobStatus.count} summaries ready`
              : 'Awaiting daily run'}
          </div>
        </div>

        <div className="search-wrap">
          <div className="search-box">
            <span style={{ color: 'var(--gray400)', fontSize: 16 }}>⌕</span>
            <input type="text" placeholder="Search chats…"
              value={search} onChange={e => setSearch(e.target.value)} />
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
          {loadingChats && <div className="loading-state"><Spinner size={20} /><span>Loading chats…</span></div>}
          {error && <div className="error-state"><span>⚠ {error}</span><button className="retry-btn" onClick={fetchChats}>Retry</button></div>}
          {!loadingChats && !error && filtered.length === 0 && <div className="loading-state">No chats found</div>}
          {filtered.map(chat => (
            <ChatItem key={chat.chat_id} chat={chat}
              active={activeChat?.chat_id === chat.chat_id}
              summary={summaries[chat.chat_id]}
              onClick={() => selectChat(chat)} />
          ))}
        </div>

        <div className="sidebar-footer">
          <div className="dot" />
          <span>{chats.length} chats</span>
          <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--gray400)' }}>
            6:30 AM IST daily
          </span>
        </div>
      </aside>

      <main className="main">
        <JobBar status={jobStatus} />
        <SummaryPanel
          chat={activeChat}
          summary={activeChat ? summaries[activeChat.chat_id] : null}
          messages={messages}
          loadingMsgs={loadingMsgs}
        />
      </main>
    </div>
  );
}
