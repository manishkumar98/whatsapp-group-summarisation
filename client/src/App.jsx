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
  const colors   = ['#2C5880','#2D8659','#E06D1F','#4A7BA8','#C45D1A','#1A3654','#7AA3C8'];
  const color    = colors[(name?.charCodeAt(0) || 0) % colors.length];
  return (
    <div className="avatar" style={{ width: size, height: size, fontSize: size * 0.35, background: color + '18', border: `1.5px solid ${color}44`, color }}>
      {initials}
    </div>
  );
}

function Spinner({ size = 16 }) {
  return <div className="spinner" style={{ width: size, height: size }} />;
}

function JobBar({ status }) {
  if (!status) return null;
  const isRunning = status.running;
  const isToday   = status.date === new Date().toISOString().split('T')[0];
  const hasData   = status.count > 0;

  return (
    <div className={`job-bar ${isRunning ? 'job-bar-running' : hasData && isToday ? 'job-bar-done' : 'job-bar-warn'}`}>
      {isRunning
        ? <><Spinner size={12} /><span>Generating today's digests — processing all groups…</span></>
        : hasData && isToday
          ? <><div className="dot" /><span>{status.count} group digests ready · {timeAgo(status.lastRun)}</span><span className="job-next">Next: 6:30 AM IST</span></>
          : <><div className="dot dot-warn" /><span>Awaiting today's run · next at 6:30 AM IST</span></>
      }
    </div>
  );
}

function SignalPills({ signals }) {
  if (!signals) return null;
  return (
    <div className="signals-bar">
      <div className="signals-bar-pills">
        {signals.urgent   > 0 && <span className="spill spill-urgent">{signals.urgent} urgent</span>}
        {signals.pending  > 0 && <span className="spill spill-pending">{signals.pending} pending</span>}
        {signals.resolved > 0 && <span className="spill spill-resolved">{signals.resolved} resolved</span>}
      </div>
    </div>
  );
}

function ChatItem({ chat, active, cached, onClick }) {
  const name    = chat.chat_name || chat.name || 'Unknown';
  const isGroup = chat.chat_type === 'group' || (chat.chat_id || '').endsWith('@g.us');
  const ts      = chat.updated_at || chat.latest_message?.timestamp || '';
  const sig     = cached?.digest?.signals;

  return (
    <div className={`chat-item ${active ? 'active' : ''}`} onClick={onClick}>
      <Avatar name={name} size={38} />
      <div className="chat-body">
        <div className="chat-top">
          <span className="chat-name">{name}</span>
          <div style={{ display:'flex', alignItems:'center', gap:4 }}>
            {sig?.urgent > 0 && <span className="sdot sdot-urgent" />}
            {sig?.pending > 0 && <span className="sdot sdot-pending" />}
            <span className="chat-time">{timeAgo(ts)}</span>
          </div>
        </div>
        <div className="chat-bottom">
          <span className="chat-preview">
            {cached ? `${cached.digest?.signals?.urgent || 0}U · ${cached.digest?.signals?.pending || 0}P · ${cached.msgCount} msgs` : 'No digest yet'}
          </span>
          {isGroup && <span className="badge badge-group">group</span>}
        </div>
      </div>
    </div>
  );
}

function DigestCard({ chat, cached, messages, loadingMsgs }) {
  if (!chat) {
    return (
      <div className="empty-state">
        <div className="empty-icon">📋</div>
        <div className="empty-title">Select a group to view digest</div>
        <div style={{ fontSize:13 }}>Daily digests run at 6:30 AM IST</div>
      </div>
    );
  }

  const name    = chat.chat_name || chat.name || 'Unknown';
  const isGroup = chat.chat_type === 'group' || (chat.chat_id || '').endsWith('@g.us');
  const d       = cached?.digest;

  const now = new Date();
  const timeStr = now.toLocaleString('en-IN', { weekday:'long', day:'numeric', month:'long', hour:'2-digit', minute:'2-digit' });

  return (
    <div className="digest-wrap">
      <div className="digest-header">
        <div>
          <div className="digest-chat-name">
            {name}
            {d?.language && <span className="lang-pill">🌐 {d.language}</span>}
          </div>
          <div className="digest-meta">
            {cached ? `${cached.msgCount} members active · ${timeStr}` : timeStr}
          </div>
        </div>
        <span className="digest-badge">AI Summary</span>
      </div>

      <div className="digest-body">
        {d ? <>
          {/* Signals */}
          <div className="signals-section">
            <div className="signals-label">Today's signals</div>
            <div className="signals-grid">
              <div className="signal-card">
                <div className={`signal-num ${d.signals?.urgent > 0 ? 'urgent' : 'resolved'}`}>{d.signals?.urgent ?? 0}</div>
                <div className="signal-lbl">Urgent</div>
              </div>
              <div className="signal-card">
                <div className={`signal-num ${d.signals?.pending > 0 ? 'pending' : 'resolved'}`}>{d.signals?.pending ?? 0}</div>
                <div className="signal-lbl">Pending</div>
              </div>
              <div className="signal-card">
                <div className="signal-num resolved">{d.signals?.resolved ?? 0}</div>
                <div className="signal-lbl">Resolved</div>
              </div>
              <div className="signal-card">
                <div className="signal-num spoke">{d.signals?.spokeUp ?? cached?.msgCount ?? 0}</div>
                <div className="signal-lbl">Spoke up</div>
              </div>
            </div>
            <SignalPills signals={d.signals} />
          </div>

          
          {d.issues?.length > 0 && (
            <div className="issues-section">
              <div className="section-title">Issues raised</div>
              {d.issues.map((issue, i) => (
                <div key={i} className="issue-item">
                  <div className={`issue-dot ${issue.priority}`} />
                  <div>
                    <div className="issue-title">{issue.title}</div>
                    <div className="issue-detail">{issue.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="no-issues">No issues or complaints raised in the last 24 hours.</div>
          )}

          {/* Announcements */}
          {d.announcements?.length > 0 && (
            <div className="announce-section">
              <div className="section-title">Announcements</div>
              {d.announcements.map((a, i) => (
                <div key={i} className="announce-item">
                  <div className="announce-text">{a}</div>
                </div>
              ))}
            </div>
          )}

          {/* Staff activity */}
          {d.staffActivity && (
            <div className="staff-activity-section">
              <div className="section-title">Staff activity today</div>
              <div className="staff-activity-text">{d.staffActivity}</div>
            </div>
          )}

          {/* Mood */}
          {d.mood && (
            <div className="mood-section">
              <div className="section-title">Group mood · based on message tone today</div>
              <div className="mood-bar-wrap">
                <div className="mood-seg stressed" style={{ width: `${d.mood.stressed || 0}%` }} />
                <div className="mood-seg mixed"    style={{ width: `${d.mood.mixed || 0}%` }} />
                <div className="mood-seg calm"     style={{ width: `${d.mood.calm || 0}%` }} />
              </div>
              <div className="mood-labels">
                <span>Stressed {d.mood.stressed || 0}%</span>
                <span>Mixed {d.mood.mixed || 0}%</span>
                <span>Calm {d.mood.calm || 0}%</span>
              </div>
              {d.mood.basis && <div className="mood-basis">{d.mood.basis}</div>}
            </div>
          )}

          <div className="digest-footer">
            Generated by AI · Covers last 24hrs · {cached?.msgCount} messages scanned · {timeAgo(cached?.generatedAt)}
          </div>
        </> : (
          <div className="no-digest" style={{ margin:16 }}>
            No digest for this chat — fewer than 5 messages in the last 24h, or today's job is still running.
          </div>
        )}
      </div>

      {/* Raw messages */}
      {loadingMsgs ? (
        <div className="loading-state" style={{ padding:'20px 0' }}><Spinner size={16} /><span>Loading messages…</span></div>
      ) : messages.length > 0 && (
        <div className="msgs-box">
          <div className="msgs-hdr">Raw messages today ({messages.length})</div>
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
                    {msg.is_staff && <span className="staff-badge">Staff</span>}
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
  const [chats,       setChats]       = useState([]);
  const [summaries,   setSummaries]   = useState({});
  const [jobStatus,   setJobStatus]   = useState(null);
  const [loadingChats,setLoadingChats]= useState(true);
  const [error,       setError]       = useState('');
  const [activeChat,  setActiveChat]  = useState(null);
  const [messages,    setMessages]    = useState([]);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [search,      setSearch]      = useState('');
  const [filter,      setFilter]      = useState('all');
  const pollRef = useRef(null);

  useEffect(() => {
    fetchChats();
    fetchSummaries();
    pollRef.current = setInterval(fetchSummaries, 15000);
    return () => clearInterval(pollRef.current);
  }, []);

  async function fetchChats() {
    setLoadingChats(true); setError('');
    try {
      const r = await fetch('/api/chats');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      setChats(d.chats || []);
    } catch (e) { setError(e.message); }
    finally { setLoadingChats(false); }
  }

  async function fetchSummaries() {
    try {
      const r = await fetch('/api/summaries');
      if (!r.ok) return;
      const d = await r.json();
      setSummaries(d.summaries || {});
      setJobStatus({ running: d.running, lastRun: d.lastRun, date: d.date, count: d.count });
      if (!d.running && d.count > 0) clearInterval(pollRef.current);
    } catch {}
  }

  const selectChat = useCallback(async (chat) => {
    setActiveChat(chat);
    setMessages([]);
    setLoadingMsgs(true);
    try {
      const r = await fetch(`/api/chats/${encodeURIComponent(chat.chat_id)}/messages`);
      if (!r.ok) return;
      const d = await r.json();
      setMessages(d.messages || []);
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
          <div className="s-logo-sub">Daily Group Digest</div>
          <div className="today-badge">
            {jobStatus?.running ? 'Generating digests…'
              : jobStatus?.count > 0 ? `${jobStatus.count} digests ready`
              : 'Awaiting 6:30 AM IST'}
          </div>
        </div>
        <div className="search-wrap">
          <div className="search-box">
            <span style={{ color:'var(--gray400)', fontSize:15 }}>⌕</span>
            <input type="text" placeholder="Search groups…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <button className="refresh-btn" onClick={fetchChats}>↻</button>
        </div>
        <div className="filter-row">
          {['all','groups','direct'].map(f => (
            <button key={f} className={`f-btn ${filter===f?'active':''}`} onClick={() => setFilter(f)}>{f}</button>
          ))}
        </div>
        <div className="chats-list">
          {loadingChats && <div className="loading-state"><Spinner size={18} /><span>Loading…</span></div>}
          {error && <div className="error-state">⚠ {error}<button className="retry-btn" onClick={fetchChats}>Retry</button></div>}
          {!loadingChats && !error && filtered.length === 0 && <div className="loading-state">No chats found</div>}
          {filtered.map(chat => (
            <ChatItem key={chat.chat_id} chat={chat}
              active={activeChat?.chat_id === chat.chat_id}
              cached={summaries[chat.chat_id]}
              onClick={() => selectChat(chat)} />
          ))}
        </div>
        <div className="sidebar-footer">
          <div className="dot" />
          <span>{chats.length} groups</span>
          <span style={{ marginLeft:'auto', fontSize:10 }}>6:30 AM IST daily</span>
        </div>
      </aside>
      <main className="main">
        <JobBar status={jobStatus} />
        <DigestCard
          chat={activeChat}
          cached={activeChat ? summaries[activeChat.chat_id] : null}
          messages={messages}
          loadingMsgs={loadingMsgs}
        />
      </main>
    </div>
  );
}
