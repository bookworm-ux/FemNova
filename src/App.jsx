import React, { useEffect, useRef, useState } from 'react';
import { Activity, ArrowUpRight, Baby, Bot, CalendarDays, ChevronLeft, ChevronRight, CircleHelp, Flower2, Heart, Home, Menu, MessageCircle, Microscope, Moon, Plus, Send, Sparkles, Sprout, Sun, Users, X } from 'lucide-react';

const API = '/api';
const defaultLog = { date: new Date().toISOString().slice(0, 10), flow: 'none', mood: 'Calm', energy: 3, symptoms: '', notes: '' };

async function api(path, options) {
  const response = await fetch(`${API}${path}`, { headers: { 'Content-Type': 'application/json' }, ...options });
  if (!response.ok) {
    const details = await response.json().catch(() => ({}));
    const error = new Error('Something went wrong');
    error.code = details.code;
    throw error;
  }
  return response.json();
}

function phaseForDay(day) {
  if (day <= 5) return 'Menstrual';
  if (day <= 13) return 'Follicular';
  if (day === 14) return 'Ovulation';
  return 'Luteal';
}

export function App() {
  const [page, setPage] = useState('home');
  const [dashboard, setDashboard] = useState(null);
  const [labs, setLabs] = useState([]);
  const [posts, setPosts] = useState([]);
  const [chatOpen, setChatOpen] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [toast, setToast] = useState('');

  const refresh = async () => {
    const [nextDashboard, nextLabs, nextPosts] = await Promise.all([api('/dashboard'), api('/labs'), api('/community')]);
    setDashboard(nextDashboard); setLabs(nextLabs); setPosts(nextPosts);
  };
  useEffect(() => { refresh().catch(() => setToast('Start the API with npm run dev to connect your data.')); }, []);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 3500); return () => clearTimeout(timer); }, [toast]);

  const navigate = (nextPage) => { setPage(nextPage); setMobileNav(false); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const homeProps = { dashboard, onSaved: async () => { await refresh(); setToast('Your daily check-in is saved.'); } };
  return <>
    <header className="topbar">
      <button className="brand" onClick={() => navigate('home')} aria-label="Go to home"><span className="brand-mark"><Flower2 size={22} /></span><span>Fem<span>Nova</span></span></button>
      <button className="mobile-menu" onClick={() => setMobileNav(!mobileNav)} aria-label="Toggle navigation">{mobileNav ? <X /> : <Menu />}</button>
      <nav className={mobileNav ? 'nav open' : 'nav'}>
        <NavButton active={page === 'home'} icon={<Home size={16} />} label="My cycle" onClick={() => navigate('home')} />
        <NavButton active={page === 'labs'} icon={<Microscope size={16} />} label="Health labs" onClick={() => navigate('labs')} />
        <NavButton active={page === 'community'} icon={<Users size={16} />} label="Community" onClick={() => navigate('community')} />
      </nav>
      <div className="profile-chip"><span className="avatar">A</span><span>My space</span><ChevronDown /></div>
    </header>
    <main>
      {page === 'home' && <HomePage {...homeProps} />}
      {page === 'labs' && <LabsPage labs={labs} onSaved={async () => { await refresh(); setToast('Lab result saved and your home summary is updated.'); }} />}
      {page === 'community' && <CommunityPage posts={posts} onSaved={async () => { await refresh(); setToast('Posted to your community.'); }} />}
    </main>
    <footer><span>FemNova</span><span>Private by design · Your health data belongs to you</span><span>Made for every phase</span></footer>
    <button className="chat-fab" onClick={() => setChatOpen(true)} aria-label="Open FemNova guide"><Bot size={21} /><span>Ask Nova</span></button>
    {chatOpen && <Chatbot onClose={() => setChatOpen(false)} />}
    {toast && <div className="toast"><Sparkles size={16} />{toast}</div>}
  </>;
}

function NavButton({ active, icon, label, onClick }) { return <button className={active ? 'nav-item active' : 'nav-item'} onClick={onClick}>{icon}{label}</button>; }
function ChevronDown() { return <span className="chevron">⌄</span>; }

function HomePage({ dashboard, onSaved }) {
  const [showLog, setShowLog] = useState(false);
  const [log, setLog] = useState(defaultLog);
  const today = new Date().getDate();
  const phase = phaseForDay(today);
  const mood = dashboard?.latest?.mood;
  const cycleDays = Array.from({ length: 35 }, (_, i) => i + 1);
  const saveLog = async (event) => { event.preventDefault(); await api('/cycle', { method: 'POST', body: JSON.stringify(log) }); setShowLog(false); setLog(defaultLog); onSaved(); };
  return <div className="page-wrap home-page">
    <section className={`hero ${phase.toLowerCase()} ${mood === 'Low' ? 'mood-low' : ''}`}>
      <div className="hero-copy"><p className="eyebrow"><span className="eyebrow-dot" /> Saturday, September 12, 2026</p><h1>Your body has a rhythm.<br /><em>Let's listen in.</em></h1><p className="hero-sub">A gentle place to understand your cycle, notice patterns, and feel more at home in your body.</p><button className="primary-button" onClick={() => setShowLog(true)}><Plus size={17} /> Log today</button></div>
      <div className="hero-art" aria-hidden="true"><div className="sun-disc"><Sun size={42} /></div><div className="flower flower-one">✿</div><div className="flower flower-two">❀</div><div className="flower flower-three">✾</div><div className="stem stem-one" /><div className="stem stem-two" /><div className="balloon balloon-one" /><div className="balloon balloon-two" />{phase === 'Ovulation' && <div className="confetti"><i>•</i><i>✦</i><i>•</i><i>✧</i><i>•</i></div>}{mood === 'Low' && <div className="low-bloom">◌</div>}</div>
      <div className="phase-card"><span className="phase-icon">{phase === 'Ovulation' ? '✦' : '◌'}</span><div><small>Current phase</small><strong>{phase}</strong><p>{phase === 'Ovulation' ? 'Your bright, social window' : 'A moment to care inward'}</p></div><ArrowUpRight size={17} /></div>
    </section>
    <section className="section-heading"><div><p className="eyebrow">September 2026</p><h2>Your month at a glance</h2></div><button className="icon-button" aria-label="Previous month"><ChevronLeft size={18} /></button><button className="icon-button" aria-label="Next month"><ChevronRight size={18} /></button></section>
    <section className="tracker-layout"><div className="calendar-panel"><div className="calendar-head"><span>Cycle day {today}</span><span className="legend"><i className="dot rose" /> Period <i className="dot lilac" /> Fertile <i className="dot sage" /> Logged</span></div><div className="weekdays">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => <span key={day}>{day}</span>)}</div><div className="calendar-grid">{Array.from({ length: 5 }, (_, row) => cycleDays.slice(row * 7, row * 7 + 7).map(day => <div key={day} className={`day ${day === today ? 'today' : ''} ${day <= 5 ? 'period' : ''} ${day >= 11 && day <= 15 ? 'fertile' : ''}`}><span>{day}</span>{day === 3 && <i>♥</i>}{day === today && <small>today</small>}{day === 15 && <i>✦</i>}</div>))}</div><button className="text-button" onClick={() => setShowLog(true)}><Plus size={15} /> Add a day note</button></div><div className="insight-panel"><div className="panel-title"><span>Today's check-in</span><Sprout size={20} /></div><p className="insight-quote">“Small notes become powerful patterns.”</p><div className="mini-metrics"><Metric label="Mood" value={dashboard?.latest?.mood || 'Not logged'} icon={<Heart size={16} />} /><Metric label="Energy" value={dashboard?.latest ? `${dashboard.latest.energy}/5` : '—'} icon={<Activity size={16} />} /></div><button className="secondary-button" onClick={() => setShowLog(true)}>How are you feeling?</button></div></section>
    <section className="section-heading lower"><div><p className="eyebrow">A softer health picture</p><h2>Your latest signals</h2></div><button className="text-button">View all insights <ArrowUpRight size={15} /></button></section>
    <section className="signal-grid"><SignalCard icon={<Microscope />} title="Lab watch" value={dashboard?.labSummary?.status === 'unavailable' ? 'Checks unavailable' : dashboard?.labSummary?.flagged ? `${dashboard.labSummary.flagged} needs a look` : 'No lab flags'} detail="Free T3 · Free T4 · TSH · Hb" tone={dashboard?.labSummary?.flagged ? 'peach' : 'mint'} /><SignalCard icon={<Moon />} title="Cycle forecast" value={dashboard?.cycle?.nextPeriod || 'October 10'} detail={`${dashboard?.cycle?.averageLength || 28}-day average cycle`} tone="lilac" /><SignalCard icon={<Baby />} title="Gentle reminder" value="Hydration helps" detail="Especially on lower-energy days" tone="butter" /></section>
    {showLog && <Modal title="How are you feeling today?" onClose={() => setShowLog(false)}><form className="form-grid" onSubmit={saveLog}><label>Date<input type="date" value={log.date} onChange={e => setLog({ ...log, date: e.target.value })} required /></label><label>Flow<select value={log.flow} onChange={e => setLog({ ...log, flow: e.target.value })}><option>none</option><option>spotting</option><option>light</option><option>medium</option><option>heavy</option></select></label><label>Mood<select value={log.mood} onChange={e => setLog({ ...log, mood: e.target.value })}>{['Calm', 'Happy', 'Low', 'Anxious', 'Irritable', 'Energised'].map(m => <option key={m}>{m}</option>)}</select></label><label>Energy <span className="range-value">{log.energy}/5</span><input type="range" min="1" max="5" value={log.energy} onChange={e => setLog({ ...log, energy: e.target.value })} /></label><label className="full">Symptoms<input placeholder="Cramps, bloating, headache..." value={log.symptoms} onChange={e => setLog({ ...log, symptoms: e.target.value })} /></label><label className="full">A note for yourself<textarea placeholder="Anything you want to remember?" value={log.notes} onChange={e => setLog({ ...log, notes: e.target.value })} /></label><button className="primary-button full" type="submit">Save check-in <ArrowUpRight size={16} /></button></form></Modal>}
  </div>;
}
function Metric({ label, value, icon }) { return <div className="metric"><span>{icon}</span><div><small>{label}</small><strong>{value}</strong></div></div>; }
function SignalCard({ icon, title, value, detail, tone }) { return <article className={`signal-card ${tone}`}><div className="signal-icon">{icon}</div><small>{title}</small><strong>{value}</strong><p>{detail}</p><ArrowUpRight className="signal-arrow" size={17} /></article>; }

function LabsPage({ labs, onSaved }) {
  const [form, setForm] = useState({ freeT3: '', freeT4: '', tsh: '', hb: '', date: new Date().toISOString().slice(0, 10), comments: '' });
  const save = async e => { e.preventDefault(); await api('/labs', { method: 'POST', body: JSON.stringify(form) }); setForm({ ...form, freeT3: '', freeT4: '', tsh: '', hb: '', comments: '' }); onSaved(); };
  const latest = labs[0];
  return <div className="page-wrap inner-page"><PageIntro eyebrow="Your health labs" title={<>Numbers can tell a story.<br /><em>We help you read it.</em></>} copy="Keep your thyroid and blood health notes in one calm, private place. Your home view will surface anything worth discussing with your doctor." icon={<Microscope size={32} />} /><section className="labs-layout"><div className="form-card"><div className="panel-title"><span>Add a result</span><span className="required-note">All fields optional</span></div><form className="form-grid" onSubmit={save}><label>Date<input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} required /></label><label>Report / doctor note<input placeholder="Optional label" value={form.comments} onChange={e => setForm({ ...form, comments: e.target.value })} /></label>{[['freeT3','Free T3','pg/mL'],['freeT4','Free T4','ng/dL'],['tsh','TSH','mIU/L'],['hb','Haemoglobin','g/dL']].map(([key,label,unit]) => <label key={key}>{label}<span className="unit">{unit}</span><input type="number" step="any" placeholder="Enter value" value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value })} /></label>)}<button className="primary-button full" type="submit">Save lab result <ArrowUpRight size={16} /></button></form><p className="form-footnote">Ranges are typical adult, non-pregnant reference ranges. Your laboratory's range should always take priority.</p></div><div className="range-card"><div className="panel-title"><span>Reference ranges</span><CircleHelp size={18} /></div><p>We use these starting ranges to spot values you may want to discuss.</p>{[['Free T3','2.3–4.2','pg/mL'],['Free T4','0.8–1.8','ng/dL'],['TSH','0.4–4.0','mIU/L'],['Hb','12.0–15.5','g/dL']].map(row => <div className="range-row" key={row[0]}><span>{row[0]}</span><strong>{row[1]}</strong><small>{row[2]}</small></div>)}<div className="range-note"><Sparkles size={17} /><span>Results are informational, never a diagnosis.</span></div></div></section><section className="section-heading lower"><div><p className="eyebrow">Your history</p><h2>Recent results</h2></div></section><section className="lab-history">{latest ? <LabResult result={latest} /> : <div className="empty-state"><Microscope size={25} /><p>Your saved lab results will appear here.</p></div>}{labs.slice(1).map(lab => <LabResult result={lab} key={lab.id} />)}</section></div>;
}
function LabResult({ result }) { return <article className="lab-result"><div><small>{result.date}</small><strong>{result.comments || 'Lab report'}</strong>{result.flagStatus === 'unavailable' && <small>Saved · range checks unavailable</small>}</div><LabPill label="FT3" value={result.freeT3} status={result.flags?.freeT3} /><LabPill label="FT4" value={result.freeT4} status={result.flags?.freeT4} /><LabPill label="TSH" value={result.tsh} status={result.flags?.tsh} /><LabPill label="Hb" value={result.hb} status={result.flags?.hb} /></article>; }
function LabPill({ label, value, status }) { return <span className={`lab-pill ${status && status !== 'normal' ? 'warn' : ''}`}><small>{label}</small><strong>{value || '—'}</strong>{status && status !== 'normal' && <i>{status}</i>}</span>; }

function CommunityPage({ posts, onSaved }) {
  const [text, setText] = useState('');
  const submit = async e => { e.preventDefault(); if (!text.trim()) return; await api('/community', { method: 'POST', body: JSON.stringify({ body: text, topic: 'Cycle care' }) }); setText(''); onSaved(); };
  return <div className="page-wrap inner-page"><PageIntro eyebrow="The FemNova circle" title={<>You are not alone<br /><em>in any phase.</em></>} copy="A kind, moderated corner for questions, lived experience, and the tiny things that make a difference." icon={<Users size={32} />} /><section className="community-layout"><div><form className="composer" onSubmit={submit}><div className="avatar large">A</div><textarea placeholder="Share a question or a gentle win..." value={text} onChange={e => setText(e.target.value)} /><button className="icon-button filled" type="submit" aria-label="Post"><Send size={17} /></button></form><div className="topic-row"><button className="topic active">All conversations</button><button className="topic">Cycle care</button><button className="topic">Mood & energy</button><button className="topic">Thyroid & Hb</button></div>{posts.map(post => <article className="post" key={post.id}><div className="post-head"><div className="avatar">{post.author?.[0] || 'A'}</div><div><strong>{post.author || 'FemNova member'}</strong><small>{post.topic} · {post.created_at}</small></div><button className="more">•••</button></div><p>{post.body}</p><div className="post-actions"><button><Heart size={15} /> {post.likes || 0}</button><button><MessageCircle size={15} /> Reply</button></div></article>)}</div><aside className="community-aside"><div className="aside-card peach-bg"><Flower2 size={25} /><h3>Today's gentle question</h3><p>What is one thing your body is asking for this week?</p><button className="text-button">See responses <ArrowUpRight size={15} /></button></div><div className="aside-card"><div className="panel-title"><span>Quick answers</span><CircleHelp size={18} /></div><a>What is a normal cycle length? <ArrowUpRight size={14} /></a><a>How can I support my energy? <ArrowUpRight size={14} /></a><a>When should I ask a doctor? <ArrowUpRight size={14} /></a></div></aside></section></div>;
}
function PageIntro({ eyebrow, title, copy, icon }) { return <section className="page-intro"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{copy}</p></div><div className="intro-icon">{icon}</div></section>; }

function Modal({ title, onClose, children }) { return <div className="modal-backdrop"><div className="modal"><div className="modal-header"><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label="Close"><X size={18} /></button></div>{children}</div></div>; }
function Chatbot({ onClose }) {
  const [messages, setMessages] = useState([{ role: 'assistant', text: 'Hi, I am Nova. Ask me about your cycle, energy, nutrition, or a lab result.' }]);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState(false);
  const sending = useRef(false);
  const send = async e => {
    e.preventDefault();
    if (!input.trim() || sending.current) return;
    sending.current = true;
    setPending(true);
    const question = input;
    setInput('');
    setMessages(prev => [...prev, { role: 'user', text: question }]);
    try {
      const result = await api('/chat', { method: 'POST', body: JSON.stringify({ question }) });
      setMessages(prev => [...prev, { role: 'assistant', text: result.answer }]);
    } catch (error) {
      const text = error.code === 'PRIVACY_UNAVAILABLE'
        ? 'Privacy protection is unavailable. Nova could not process your message. Please try again later.'
        : 'Your message could not be completed. Please try again.';
      setMessages(prev => [...prev, { role: 'assistant', text }]);
      setInput(question);
    } finally {
      sending.current = false;
      setPending(false);
    }
  };
  return <div className="chat-window">
    <div className="chat-header"><span className="bot-avatar"><Bot size={18} /></span><div><strong>Nova guide</strong><small>Here to help you understand</small></div><button onClick={onClose} aria-label="Close chat"><X size={18} /></button></div>
    <div className="chat-messages" role="log" aria-live="polite">{messages.map((message, index) => <div className={`bubble ${message.role}`} key={index}>{message.text}</div>)}{pending && <div className="bubble assistant" role="status">Preparing your message privately…</div>}</div>
    <form className="chat-form" onSubmit={send}><input value={input} onChange={e => setInput(e.target.value)} placeholder="Ask a question..." aria-label="Your question" maxLength={4000} disabled={pending} /><button aria-label="Send" disabled={pending || !input.trim()}><Send size={16} /></button></form>
    <small className="chat-disclaimer">Messages are anonymized before Nova processes them.</small>
    <small className="chat-disclaimer">Nova is educational, not medical advice.</small>
  </div>;
}
