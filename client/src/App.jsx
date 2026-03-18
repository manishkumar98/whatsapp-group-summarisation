import React, { useState, useEffect, useCallback, useRef } from 'react';
import './App.css';

const COMMUNITY_COLORS = {
  'Wellington':   { primary: '#2C5880', light: '#EEF4F9', label: 'WLG' },
  'Deccan':       { primary: '#2D8659', light: '#E8F5EE', label: 'DN'  },
  'Coromandel':   { primary: '#E06D1F', light: '#FEF5ED', label: 'CORO'},
  'Rajputana':    { primary: '#C45D1A', light: '#FBE4D1', label: 'RN'  },
  'Uncategorised':{ primary: '#767676', light: '#F5F5F7', label: '—'   },
};
const COMMUNITY_ORDER = ['Wellington','Deccan','Coromandel','Rajputana','Uncategorised'];

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
  const color = COMMUNITY_COLORS[community]?.primary || '#2C5880';
  return (
    <div className="avatar" style={{ width:size, height:size, fontSize:size*0.35, background:color+'18', border:`1.5px solid ${color}44`, color }}>
      {initials}
    </div>
  );
}

function Spinner({ size=16 }) {
  return <div className="spinner" style={{ width:size, height:size }} />;
}

function JobBar({ status, view, setView, onRefresh, refreshing, cooldownMsg }) {
  const isRunning = status?.running || refreshing;
  const isToday   = status?.date === new Date().toISOString().split('T')[0];
  return (
    <div className="topbar">
      <div className={`job-indicator ${isRunning ? 'running' : isToday && status?.count > 0 ? 'done' : 'warn'}`}>
        {isRunning
          ? <><Spinner size={11}/><span>Generating digests…</span></>
          : isToday && status?.count > 0
            ? <><div className="dot"/><span>{status.count} digests ready · {timeAgo(status.lastRun)}</span></>
            : <><div className="dot dot-warn"/><span>Awaiting 6:30 AM IST</span></>
        }
      </div>
      {cooldownMsg && <span className="cooldown-msg">{cooldownMsg}</span>}
      <button className="refresh-job-btn" onClick={onRefresh} disabled={isRunning} title="Refresh all digests (once per 24h)">
        {isRunning ? <Spinner size={11}/> : '↻'} {isRunning ? 'Running…' : 'Refresh'}
      </button>
      <div className="view-toggle">
        <button className={`view-btn ${view==='dashboard' ? 'active' : ''}`} onClick={() => setView('dashboard')}>
          <span className="view-icon">⊞</span> Dashboard
        </button>
        <button className={`view-btn ${view==='chat' ? 'active' : ''}`} onClick={() => setView('chat')}>
          <span className="view-icon">💬</span> Chat view
        </button>
      </div>
    </div>
  );
}

// ── DIGEST MINI CARD (used in dashboard) ─────────────────────────────────
function DigestMini({ cached }) {
  const d = cached?.digest;
  if (!d) return (
    <div className="digest-mini-empty">No digest yet · fewer than 3 messages today</div>
  );
  return (
    <div className="digest-mini">
      {/* Signals row */}
      <div className="mini-signals">
        <span className={`mini-sig ${d.signals?.urgent > 0 ? 'urgent' : 'zero'}`}>
          <span className="mini-sig-num">{d.signals?.urgent ?? 0}</span>
          <span className="mini-sig-lbl">Urgent</span>
        </span>
        <span className={`mini-sig ${d.signals?.pending > 0 ? 'pending' : 'zero'}`}>
          <span className="mini-sig-num">{d.signals?.pending ?? 0}</span>
          <span className="mini-sig-lbl">Pending</span>
        </span>
        <span className="mini-sig resolved">
          <span className="mini-sig-num">{d.signals?.resolved ?? 0}</span>
          <span className="mini-sig-lbl">Resolved</span>
        </span>
        <span className="mini-sig spoke">
          <span className="mini-sig-num">{d.signals?.spokeUp ?? cached?.msgCount ?? 0}</span>
          <span className="mini-sig-lbl">Spoke up</span>
        </span>
      </div>

      {/* Summary */}
      {d.summary && <p className="mini-summary">{d.summary}</p>}

      {/* Issues */}
      {d.issues?.length > 0 && (
        <div className="mini-issues">
          {d.issues.slice(0,3).map((issue, i) => (
            <div key={i} className="mini-issue-row">
              <span className={`mini-dot ${issue.priority}`}/>
              <span className="mini-issue-title">{issue.title}</span>
            </div>
          ))}
          {d.issues.length > 3 && <div className="mini-more">+{d.issues.length-3} more issues</div>}
        </div>
      )}

      {/* Mood bar */}
      {d.mood && (
        <div className="mini-mood">
          <div className="mini-mood-labels">
            <span>Stressed {d.mood.stressed||0}%</span>
            <span>Mixed {d.mood.mixed||0}%</span>
            <span>Calm {d.mood.calm||0}%</span>
          </div>
          <div className="mini-mood-bar">
            <div className="mood-seg stressed" style={{ width:`${d.mood.stressed||0}%` }}/>
            <div className="mood-seg mixed"    style={{ width:`${d.mood.mixed||0}%` }}/>
            <div className="mood-seg calm"     style={{ width:`${d.mood.calm||0}%` }}/>
          </div>
          {d.mood.basis && <span className="mini-mood-label">{d.mood.basis}</span>}
        </div>
      )}

      <div className="mini-footer">{cached.msgCount} msgs · {timeAgo(cached.generatedAt)}{d.language ? ` · ${d.language}` : ''}</div>
    </div>
  );
}

// ── DASHBOARD VIEW ────────────────────────────────────────────────────────
function DashboardView({ chats, summaries, search }) {
  const [onlyUpdated, setOnlyUpdated] = React.useState(false);
  const visibleChats = onlyUpdated ? chats.filter(c => !!summaries[c.chat_id]) : chats;
  const groups = {};
  visibleChats.filter(c => (c.chat_name||c.name||'').toLowerCase().includes(search.toLowerCase()))
    .forEach(c => {
      const comm = c.community || 'Uncategorised';
      if (!groups[comm]) groups[comm] = [];
      groups[comm].push(c);
    });

  const totalUrgent  = Object.values(summaries).reduce((n,s) => n+(s.digest?.signals?.urgent||0),  0);
  const totalPending = Object.values(summaries).reduce((n,s) => n+(s.digest?.signals?.pending||0), 0);
  const totalResolved= Object.values(summaries).reduce((n,s) => n+(s.digest?.signals?.resolved||0),0);

  return (
    <div className="dashboard-view">
      {/* Top summary bar */}
      <div className="dashboard-summary-bar">
        <div className="dsb-card urgent">
          <div className="dsb-num">{totalUrgent}</div>
          <div className="dsb-lbl">Total urgent</div>
        </div>
        <div className="dsb-card pending">
          <div className="dsb-num">{totalPending}</div>
          <div className="dsb-lbl">Total pending</div>
        </div>
        <div className="dsb-card resolved">
          <div className="dsb-num">{totalResolved}</div>
          <div className="dsb-lbl">Resolved today</div>
        </div>
        <div className="dsb-card spoke">
          <div className="dsb-num">{Object.values(summaries).reduce((n,s) => n+(s.digest?.signals?.spokeUp||0),0)}</div>
          <div className="dsb-lbl">Members active</div>
        </div>
      </div>

      {/* Filter bar */}
      <div className="dash-filter-bar">
        <span className="dash-filter-label">Show:</span>
        <button className={`dash-filter-btn ${!onlyUpdated ? 'active' : ''}`} onClick={() => setOnlyUpdated(false)}>
          All studios ({chats.length})
        </button>
        <button className={`dash-filter-btn ${onlyUpdated ? 'active' : ''}`} onClick={() => setOnlyUpdated(true)}>
          With digest today ({Object.keys(summaries).length})
        </button>
      </div>

      {/* Community sections */}
      {COMMUNITY_ORDER.filter(c => groups[c]?.length > 0).map(comm => {
        const color    = COMMUNITY_COLORS[comm];
        const commChats = groups[comm];
        const commUrgent  = commChats.reduce((n,c) => n+(summaries[c.chat_id]?.digest?.signals?.urgent||0),  0);
        const commPending = commChats.reduce((n,c) => n+(summaries[c.chat_id]?.digest?.signals?.pending||0), 0);

        return (
          <div key={comm} className="dash-community">
            <div className="dash-comm-header" style={{ borderLeftColor: color.primary }}>
              <div className="dash-comm-title-row">
                <span className="dash-comm-name" style={{ color: color.primary }}>{comm} Community</span>
                <span className="dash-comm-badge" style={{ background: color.light, color: color.primary, border:`1px solid ${color.primary}33` }}>
                  {color.label} · {commChats.length} studios
                </span>
              </div>
              <div className="dash-comm-signals">
                {commUrgent  > 0 && <span className="spill spill-urgent">{commUrgent} urgent</span>}
                {commPending > 0 && <span className="spill spill-pending">{commPending} pending</span>}
                {commUrgent === 0 && commPending === 0 && <span className="spill spill-resolved">All clear</span>}
              </div>
            </div>

            <div className="dash-studios-grid">
              {commChats.map(chat => {
                const cached = summaries[chat.chat_id];
                const name   = chat.chat_name || chat.name || 'Unknown';
                const urgent = cached?.digest?.signals?.urgent || 0;
                const pending= cached?.digest?.signals?.pending|| 0;
                return (
                  <div key={chat.chat_id} className={`studio-card ${urgent > 0 ? 'has-urgent' : pending > 0 ? 'has-pending' : ''}`}
                    style={{ borderTopColor: urgent > 0 ? 'var(--urgent)' : pending > 0 ? 'var(--pending)' : color.primary }}>
                    <div className="studio-card-header">
                      <Avatar name={name} size={34} community={comm}/>
                      <div className="studio-card-meta">
                        <div className="studio-name">{name}</div>
                        <div className="studio-sub">{cached ? `${cached.msgCount} msgs today` : 'No activity'}</div>
                      </div>
                      {urgent > 0  && <span className="sc-badge urgent">{urgent}U</span>}
                      {pending > 0 && <span className="sc-badge pending">{pending}P</span>}
                    </div>
                    <DigestMini cached={cached}/>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── CHAT VIEW (deep dive) ─────────────────────────────────────────────────
function ChatView({ chats, summaries, activeChat, onSelect, search, messages, loadingMsgs }) {
  const [collapsed, setCollapsed] = useState({});

  const groups = {};
  chats.filter(c => (c.chat_name||c.name||'').toLowerCase().includes(search.toLowerCase()))
    .forEach(c => {
      const comm = c.community || 'Uncategorised';
      if (!groups[comm]) groups[comm] = [];
      groups[comm].push(c);
    });

  const d     = activeChat ? summaries[activeChat.chat_id]?.digest : null;
  const comm  = activeChat?.community || summaries[activeChat?.chat_id]?.community || 'Uncategorised';
  const color = COMMUNITY_COLORS[comm];

  return (
    <div className="chat-view">
      {/* Sidebar */}
      <aside className="chat-sidebar">
        <div className="chats-list">
          {COMMUNITY_ORDER.filter(c => groups[c]?.length > 0).map(comm => {
            const c      = COMMUNITY_COLORS[comm];
            const isOpen = !collapsed[comm];
            const urgent = groups[comm].reduce((n,ch) => n+(summaries[ch.chat_id]?.digest?.signals?.urgent||0),0);
            const ready  = groups[comm].filter(ch => summaries[ch.chat_id]).length;
            return (
              <div key={comm} className="community-section">
                <div className="community-header" onClick={() => setCollapsed(p => ({...p,[comm]:!p[comm]}))}>
                  <div className="comm-label-row">
                    <span className="comm-dot" style={{ background: c.primary }}/>
                    <span className="comm-name">{comm}</span>
                    <span className="comm-count">{groups[comm].length}</span>
                  </div>
                  <div className="comm-signals">
                    {urgent > 0 && <span className="spill spill-urgent">{urgent}U</span>}
                    {ready  > 0 && <span className="comm-ready">{ready}✓</span>}
                    <span className="comm-chevron">{isOpen ? '▾' : '▸'}</span>
                  </div>
                </div>
                {isOpen && groups[comm].map(chat => {
                  const sig = summaries[chat.chat_id]?.digest?.signals;
                  const name = chat.chat_name || chat.name || '';
                  return (
                    <div key={chat.chat_id} className={`chat-item ${activeChat?.chat_id===chat.chat_id?'active':''}`} onClick={() => onSelect(chat)}>
                      <Avatar name={name} size={36} community={comm}/>
                      <div className="chat-body">
                        <div className="chat-top">
                          <span className="chat-name">{name}</span>
                          <div style={{ display:'flex', gap:3 }}>
                            {sig?.urgent  > 0 && <span className="sdot sdot-urgent"/>}
                            {sig?.pending > 0 && <span className="sdot sdot-pending"/>}
                            {summaries[chat.chat_id] && <span className="sdot sdot-resolved"/>}
                          </div>
                        </div>
                        <div className="chat-bottom">
                          <span className="chat-preview">
                            {summaries[chat.chat_id] ? `${sig?.urgent||0}U · ${sig?.pending||0}P · ${summaries[chat.chat_id].msgCount} msgs` : 'No digest'}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
        <div className="sidebar-footer">
          <div className="dot"/>
          <span>{chats.length} studios · 4 communities</span>
        </div>
      </aside>

      {/* Detail panel */}
      <div className="chat-detail">
        {!activeChat ? (
          <div className="empty-state">
            <div className="empty-icon">📋</div>
            <div className="empty-title">Select a studio for deep dive</div>
            <div style={{ fontSize:13 }}>Full digest + raw messages</div>
          </div>
        ) : (
          <div className="digest-wrap">
            <div className="digest-header" style={{ background: color.primary }}>
              <div>
                <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4 }}>
                  <span className="comm-badge-lg" style={{ background:'rgba(255,255,255,0.2)', color:'#fff', border:'1px solid rgba(255,255,255,0.3)' }}>
                    {color.label} · {comm}
                  </span>
                  {d?.language && <span className="lang-pill">{d.language}</span>}
                </div>
                <div className="digest-chat-name">{activeChat.chat_name || activeChat.name}</div>
                <div className="digest-meta">{summaries[activeChat.chat_id]?.msgCount || 0} messages today</div>
              </div>
              <span className="digest-badge">AI Digest</span>
            </div>

            <div className="digest-body">
              {d ? <>
                <div className="signals-section">
                  <div className="signals-label">Today's signals</div>
                  <div className="signals-grid">
                    {[['urgent','Urgent','urgent'],['pending','Pending','pending'],['resolved','Resolved','resolved'],['spokeUp','Spoke up','spoke']].map(([k,l,c]) => (
                      <div key={k} className="signal-card">
                        <div className={`signal-num ${c}`}>{d.signals?.[k]??0}</div>
                        <div className="signal-lbl">{l}</div>
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
                    {d.issues.map((issue,i) => (
                      <div key={i} className="issue-item">
                        <div className={`issue-dot ${issue.priority}`}/>
                        <div>
                          <div className="issue-title">{issue.title}</div>
                          <div className="issue-detail">{issue.detail}{issue.raisedBy?` — ${issue.raisedBy}`:''}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : <div className="no-issues">No issues raised in the last 24 hours.</div>}
                {d.announcements?.length > 0 && (
                  <div className="announce-section">
                    <div className="section-title">Announcements</div>
                    {d.announcements.map((a,i) => <div key={i} className="announce-item"><div className="announce-text">{a}</div></div>)}
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
                    <div className="section-title">Group mood</div>
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
                <div className="digest-footer">Generated by AI · Covers last 24hrs · {summaries[activeChat.chat_id]?.msgCount} messages scanned · {timeAgo(summaries[activeChat.chat_id]?.generatedAt)}</div>
              </> : <div className="no-digest" style={{ margin:16 }}>No digest for this studio today.</div>}
            </div>

            {loadingMsgs ? (
              <div className="loading-state" style={{ padding:'16px 0' }}><Spinner size={16}/><span>Loading messages…</span></div>
            ) : messages.length > 0 && (
              <div className="msgs-box">
                <div className="msgs-hdr">Raw messages today ({messages.length})</div>
                <div className="msgs-list">
                  {messages.slice(-30).reverse().map((msg,i) => {
                    const sender = msg.resolved_name || msg.sender_name || 'Member';
                    const text   = msg.body || msg.text || msg.content || '';
                    if (!text) return null;
                    return (
                      <div key={i} className="msg-item">
                        <div className="msg-meta">
                          <span className="msg-sender">{sender}</span>
                          {msg.is_staff && <span className="staff-badge">Staff</span>}
                          <span className="msg-time">{timeAgo(msg.timestamp || msg.created_at)}</span>
                        </div>
                        <div className="msg-text">{text}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── ROOT ──────────────────────────────────────────────────────────────────
export default function App() {
  const [view,        setView]        = useState('dashboard');
  const [chats,       setChats]       = useState([]);
  const [summaries,   setSummaries]   = useState({});
  const [jobStatus,   setJobStatus]   = useState(null);
  const [loadingChats,setLoadingChats]= useState(true);
  const [error,       setError]       = useState('');
  const [activeChat,  setActiveChat]  = useState(null);
  const [messages,    setMessages]    = useState([]);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [search,      setSearch]      = useState('');
  const [refreshing,  setRefreshing]  = useState(false);
  const [cooldownMsg, setCooldownMsg] = useState('');
  const pollRef = useRef(null);

  useEffect(() => {
    fetchChats(); fetchSummaries();
    // Poll every 8s only while job is running, stop when done
    pollRef.current = setInterval(async () => {
      const r = await fetch('/api/job-status').catch(() => null);
      if (!r) return;
      const d = await r.json().catch(() => null);
      if (!d) return;
      if (d.running) {
        fetchSummaries();
      } else {
        clearInterval(pollRef.current);
        fetchSummaries();
      }
    }, 8000);
    return () => clearInterval(pollRef.current);
  }, []);

  async function fetchChats() {
    setLoadingChats(true); setError('');
    try {
      const r = await fetch('/api/chats');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setChats((await r.json()).chats || []);
    } catch(e) { setError(e.message); }
    finally { setLoadingChats(false); }
  }

  async function fetchSummaries() {
    try {
      const r = await fetch('/api/summaries');
      if (!r.ok) return;
      const d = await r.json();
      setSummaries(d.summaries || {});
      setJobStatus({ running: d.running, lastRun: d.lastRun, date: d.date, count: d.count });
      // polling managed by useEffect
    } catch {}
  }

  const selectChat = useCallback(async (chat) => {
    setActiveChat(chat); setMessages([]); setLoadingMsgs(true);
    if (view === 'dashboard') setView('chat');
    try {
      const r = await fetch(`/api/chats/${encodeURIComponent(chat.chat_id)}/messages`);
      if (!r.ok) return;
      setMessages((await r.json()).messages || []);
    } catch {}
    finally { setLoadingMsgs(false); }
  }, [view]);

  async function handleRefresh() {
    setRefreshing(true); setCooldownMsg('');
    try {
      const r = await fetch('/api/refresh', { method: 'POST' });
      const d = await r.json();
      if (!d.ok) {
        setCooldownMsg(d.reason);
        setRefreshing(false);
        setTimeout(() => setCooldownMsg(''), 6000);
      } else {
        // Poll until job finishes
        const poll = setInterval(async () => {
          const s = await fetch('/api/job-status').then(r => r.json()).catch(() => null);
          if (!s?.running) {
            clearInterval(poll);
            setRefreshing(false);
            fetchSummaries();
          }
        }, 4000);
      }
    } catch(e) { setRefreshing(false); }
  }

  return (
    <div className="app">
      {/* Top nav */}
      <header className="app-header">
        <div className="app-logo">
          <span className="s-logo-icon">N</span>
          <div>
            <div className="s-logo-text">Nia.One</div>
            <div className="s-logo-sub">Daily Studio Digest</div>
          </div>
        </div>
        <div className="header-center">
          <div className="search-box header-search">
            <span style={{ color:'var(--gray400)', fontSize:15 }}>⌕</span>
            <input type="text" placeholder="Search studios or communities…" value={search} onChange={e => setSearch(e.target.value)}/>
          </div>
        </div>
        <JobBar status={jobStatus} view={view} setView={setView} onRefresh={handleRefresh} refreshing={refreshing} cooldownMsg={cooldownMsg}/>
      </header>

      {/* Content */}
      <div className="app-body">
        {loadingChats ? (
          <div className="loading-state" style={{ height:'100%' }}><Spinner size={24}/><span>Loading studios…</span></div>
        ) : error ? (
          <div className="error-state" style={{ height:'100%' }}>⚠ {error}<button className="retry-btn" onClick={fetchChats}>Retry</button></div>
        ) : view === 'dashboard' ? (
          <DashboardView chats={chats} summaries={summaries} search={search}/>
        ) : (
          <ChatView chats={chats} summaries={summaries} activeChat={activeChat} onSelect={selectChat} search={search} messages={messages} loadingMsgs={loadingMsgs}/>
        )}
      </div>
    </div>
  );
}
