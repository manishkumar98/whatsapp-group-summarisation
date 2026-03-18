import React, { useState, useEffect, useCallback, useRef } from 'react';
import './App.css';

const COMMUNITY_COLORS = {
  'Wellington':   { primary: '#2C5880', light: '#EEF4F9', label: 'WLG' },
  'Deccan':       { primary: '#2D8659', light: '#E8F5EE', label: 'DN'  },
  'Coromandel':   { primary: '#E06D1F', light: '#FEF5ED', label: 'CORO'},
  'Rajputana':    { primary: '#C45D1A', light: '#FBE4D1', label: 'RN'  },
  'Uncategorised':{ primary: '#767676', light: '#F5F5F7', label: '—'   },
};

function timeAgo(ts) {
  if (!ts) return '';
  const diff = (Date.now() - new Date(ts)) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff/60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff/3600)}h ago`;
  return new Date(ts).toLocaleDateString('en-IN', { day:'numeric', month:'short' });
}

function Avatar({ name, size=40, community }) {
  const initials = (name||'?').split(' ').slice(0,2).map(w=>w[0]).join('').toUpperCase();
  const color = community ? COMMUNITY_COLORS[community]?.primary || '#2C5880' : '#2C5880';
  return (
    <div className="avatar" style={{ width:size, height:size, fontSize:size*0.35, background:color+'18', border:`1.5px solid ${color}44`, color }}>
      {initials}
    </div>
  );
}

function Spinner({ size=16 }) {
  return <div className="spinner" style={{ width:size, height:size }} />;
}

function CommunityBadge({ community }) {
  const c = COMMUNITY_COLORS[community] || COMMUNITY_COLORS['Uncategorised'];
  return (
    <span className="comm-badge" style={{ background: c.light, color: c.primary, border: `1px solid ${c.primary}33` }}>
      {c.label}
    </span>
  );
}

function JobBar({ status }) {
  if (!status) return null;
  const isRunning = status.running;
  const isToday   = status.date === new Date().toISOString().split('T')[0];
  return (
    <div className={`job-bar ${isRunning ? 'job-bar-running' : isToday && status.count > 0 ? 'job-bar-done' : 'job-bar-warn'}`}>
      {isRunning
        ? <><Spinner size={12}/><span>Generating today's digests…</span></>
        : isToday && status.count > 0
          ? <><div className="dot"/><span>{status.count} studio digests ready · {timeAgo(status.lastRun)}</span><span className="job-next">Next: 6:30 AM IST</span></>
          : <><div className="dot dot-warn"/><span>Awaiting today's digest run · 6:30 AM IST</span></>
      }
    </div>
  );
}

function ChatItem({ chat, active, cached, onClick }) {
  const name = chat.chat_name || chat.name || 'Unknown';
  const sig  = cached?.digest?.signals;
  const comm = chat.community || cached?.community || 'Uncategorised';
  return (
    <div className={`chat-item ${active ? 'active' : ''}`} onClick={onClick}>
      <Avatar name={name} size={36} community={comm} />
      <div className="chat-body">
        <div className="chat-top">
          <span className="chat-name">{name}</span>
          <div style={{ display:'flex', alignItems:'center', gap:3 }}>
            {sig?.urgent > 0  && <span className="sdot sdot-urgent"/>}
            {sig?.pending > 0 && <span className="sdot sdot-pending"/>}
            {cached && <span className="sdot sdot-resolved" title="Digest ready"/>}
          </div>
        </div>
        <div className="chat-bottom">
          <span className="chat-preview">
            {cached ? `${sig?.urgent||0}U · ${sig?.pending||0}P · ${cached.msgCount} msgs` : 'No digest yet'}
          </span>
        </div>
      </div>
    </div>
  );
}

function CommunitySidebar({ chats, summaries, activeChat, onSelect, search }) {
  const [collapsed, setCollapsed] = useState({});

  // Group chats by community
  const groups = {};
  chats.filter(c => (c.chat_name||c.name||'').toLowerCase().includes(search.toLowerCase()))
    .forEach(c => {
      const comm = c.community || 'Uncategorised';
      if (!groups[comm]) groups[comm] = [];
      groups[comm].push(c);
    });

  const order = ['Wellington','Deccan','Coromandel','Rajputana','Uncategorised'];

  return (
    <div className="chats-list">
      {order.filter(c => groups[c]?.length > 0).map(comm => {
        const color   = COMMUNITY_COLORS[comm] || COMMUNITY_COLORS['Uncategorised'];
        const isOpen  = !collapsed[comm];
        const urgent  = groups[comm].reduce((n,c) => n + (summaries[c.chat_id]?.digest?.signals?.urgent||0), 0);
        const pending = groups[comm].reduce((n,c) => n + (summaries[c.chat_id]?.digest?.signals?.pending||0), 0);
        const ready   = groups[comm].filter(c => summaries[c.chat_id]).length;

        return (
          <div key={comm} className="community-section">
            <div className="community-header" onClick={() => setCollapsed(p => ({ ...p, [comm]: !p[comm] }))}>
              <div className="comm-label-row">
                <span className="comm-dot" style={{ background: color.primary }}/>
                <span className="comm-name">{comm}</span>
                <span className="comm-count">{groups[comm].length}</span>
              </div>
              <div className="comm-signals">
                {urgent  > 0 && <span className="spill spill-urgent">{urgent}U</span>}
                {pending > 0 && <span className="spill spill-pending">{pending}P</span>}
                {ready   > 0 && <span className="comm-ready">{ready} ready</span>}
                <span className="comm-chevron">{isOpen ? '▾' : '▸'}</span>
              </div>
            </div>
            {isOpen && groups[comm].map(chat => (
              <ChatItem key={chat.chat_id} chat={chat}
                active={activeChat?.chat_id === chat.chat_id}
                cached={summaries[chat.chat_id]}
                onClick={() => onSelect(chat)} />
            ))}
          </div>
        );
      })}
    </div>
  );
}

function DigestCard({ chat, cached, messages, loadingMsgs }) {
  if (!chat) return (
    <div className="empty-state">
      <div className="empty-icon">📋</div>
      <div className="empty-title">Select a studio to view digest</div>
      <div style={{ fontSize:13 }}>Groups organised by community · Digests run at 6:30 AM IST</div>
    </div>
  );

  const name    = chat.chat_name || chat.name || 'Unknown';
  const comm    = chat.community || cached?.community || 'Uncategorised';
  const color   = COMMUNITY_COLORS[comm] || COMMUNITY_COLORS['Uncategorised'];
  const d       = cached?.digest;
  const now     = new Date();
  const timeStr = now.toLocaleString('en-IN', { weekday:'long', day:'numeric', month:'long', hour:'2-digit', minute:'2-digit' });

  return (
    <div className="digest-wrap">
      <div className="digest-header" style={{ background: color.primary }}>
        <div>
          <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4 }}>
            <span className="comm-badge-lg" style={{ background:'rgba(255,255,255,0.2)', color:'#fff', border:'1px solid rgba(255,255,255,0.3)' }}>
              {color.label} · {comm}
            </span>
            {d?.language && <span className="lang-pill">{d.language}</span>}
          </div>
          <div className="digest-chat-name">{name}</div>
          <div className="digest-meta">{cached ? `${cached.msgCount} messages · ` : ''}{timeStr}</div>
        </div>
        <span className="digest-badge">AI Digest</span>
      </div>

      <div className="digest-body">
        {d ? <>
          <div className="signals-section">
            <div className="signals-label">Today's signals</div>
            <div className="signals-grid">
              {[
                { key:'urgent',   label:'Urgent',   cls:'urgent'  },
                { key:'pending',  label:'Pending',  cls:'pending' },
                { key:'resolved', label:'Resolved', cls:'resolved'},
                { key:'spokeUp',  label:'Spoke up', cls:'spoke'  },
              ].map(({ key, label, cls }) => (
                <div key={key} className="signal-card">
                  <div className={`signal-num ${cls}`}>{d.signals?.[key] ?? 0}</div>
                  <div className="signal-lbl">{label}</div>
                </div>
              ))}
            </div>
            <div className="signals-bar-pills">
              {d.signals?.urgent   > 0 && <span className="spill spill-urgent">{d.signals.urgent} urgent</span>}
              {d.signals?.pending  > 0 && <span className="spill spill-pending">{d.signals.pending} pending</span>}
              {d.signals?.resolved > 0 && <span className="spill spill-resolved">{d.signals.resolved} resolved</span>}
            </div>
          </div>

          {d.summary && <div className="summary-text-box">{d.summary}</div>}

          {d.issues?.length > 0 ? (
            <div className="issues-section">
              <div className="section-title">Issues raised</div>
              {d.issues.map((issue, i) => (
                <div key={i} className="issue-item">
                  <div className={`issue-dot ${issue.priority}`}/>
                  <div>
                    <div className="issue-title">{issue.title}</div>
                    <div className="issue-detail">{issue.detail}{issue.raisedBy ? ` — ${issue.raisedBy}` : ''}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="no-issues">No issues or complaints raised in the last 24 hours.</div>
          )}

          {d.announcements?.length > 0 && (
            <div className="announce-section">
              <div className="section-title">Announcements</div>
              {d.announcements.map((a, i) => (
                <div key={i} className="announce-item"><div className="announce-text">{a}</div></div>
              ))}
            </div>
          )}

          {d.staffActivity && (
            <div className="staff-activity-section">
              <div className="section-title">Staff activity today</div>
              <div className="staff-activity-text">{d.staffActivity}</div>
            </div>
          )}

          {d.mood && (
            <div className="mood-section">
              <div className="section-title">Group mood · based on message tone today</div>
              <div className="mood-bar-wrap">
                <div className="mood-seg stressed" style={{ width:`${d.mood.stressed||0}%` }}/>
                <div className="mood-seg mixed"    style={{ width:`${d.mood.mixed||0}%` }}/>
                <div className="mood-seg calm"     style={{ width:`${d.mood.calm||0}%` }}/>
              </div>
              <div className="mood-labels">
                <span>Stressed {d.mood.stressed||0}%</span>
                <span>Mixed {d.mood.mixed||0}%</span>
                <span>Calm {d.mood.calm||0}%</span>
              </div>
              {d.mood.basis && <div className="mood-basis">{d.mood.basis}</div>}
            </div>
          )}

          <div className="digest-footer">
            Generated by AI · Covers last 24hrs · {cached?.msgCount} messages scanned · {timeAgo(cached?.generatedAt)}
          </div>
        </> : (
          <div className="no-digest" style={{ margin:16 }}>
            No digest yet — fewer than 3 messages in the last 24h, or today's job is still running.
          </div>
        )}
      </div>

      {loadingMsgs ? (
        <div className="loading-state" style={{ padding:'16px 0' }}><Spinner size={16}/><span>Loading messages…</span></div>
      ) : messages.length > 0 && (
        <div className="msgs-box">
          <div className="msgs-hdr">Raw messages today ({messages.length})</div>
          <div className="msgs-list">
            {messages.slice(-30).reverse().map((msg, i) => {
              const sender = msg.resolved_name || msg.sender_name || 'Member';
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
  const pollRef = useRef(null);

  useEffect(() => {
    fetchChats(); fetchSummaries();
    pollRef.current = setInterval(fetchSummaries, 15000);
    return () => clearInterval(pollRef.current);
  }, []);

  async function fetchChats() {
    setLoadingChats(true); setError('');
    try {
      const r = await fetch('/api/chats');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setChats((await r.json()).chats || []);
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
    setActiveChat(chat); setMessages([]); setLoadingMsgs(true);
    try {
      const r = await fetch(`/api/chats/${encodeURIComponent(chat.chat_id)}/messages`);
      if (!r.ok) return;
      setMessages((await r.json()).messages || []);
    } catch {}
    finally { setLoadingMsgs(false); }
  }, []);

  const totalUrgent  = Object.values(summaries).reduce((n,s) => n+(s.digest?.signals?.urgent||0), 0);
  const totalPending = Object.values(summaries).reduce((n,s) => n+(s.digest?.signals?.pending||0), 0);

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="s-logo">
            <span className="s-logo-icon">N</span>
            <span className="s-logo-text">Nia.One</span>
          </div>
          <div className="s-logo-sub">Daily Studio Digest</div>
          <div className="header-signals">
            {totalUrgent  > 0 && <span className="spill spill-urgent">{totalUrgent} urgent</span>}
            {totalPending > 0 && <span className="spill spill-pending">{totalPending} pending</span>}
            {jobStatus?.count > 0 && totalUrgent === 0 && totalPending === 0 && (
              <span className="today-badge">{jobStatus.count} digests ready</span>
            )}
          </div>
        </div>
        <div className="search-wrap">
          <div className="search-box">
            <span style={{ color:'var(--gray400)', fontSize:15 }}>⌕</span>
            <input type="text" placeholder="Search studios…" value={search} onChange={e => setSearch(e.target.value)}/>
          </div>
          <button className="refresh-btn" onClick={fetchChats}>↻</button>
        </div>
        {loadingChats && <div className="loading-state"><Spinner size={18}/><span>Loading…</span></div>}
        {error && <div className="error-state">⚠ {error}<button className="retry-btn" onClick={fetchChats}>Retry</button></div>}
        {!loadingChats && !error && (
          <CommunitySidebar chats={chats} summaries={summaries} activeChat={activeChat} onSelect={selectChat} search={search}/>
        )}
        <div className="sidebar-footer">
          <div className="dot"/>
          <span>{chats.length} studios · 4 communities</span>
          <span style={{ marginLeft:'auto', fontSize:10 }}>6:30 AM IST</span>
        </div>
      </aside>
      <main className="main">
        <JobBar status={jobStatus}/>
        <DigestCard chat={activeChat} cached={activeChat ? summaries[activeChat.chat_id] : null} messages={messages} loadingMsgs={loadingMsgs}/>
      </main>
    </div>
  );
}
