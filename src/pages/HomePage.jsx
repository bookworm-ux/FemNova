import React, { useEffect, useState } from 'react';
import { Activity, Apple, ArrowRight, CalendarDays, ChevronLeft, ChevronRight, Droplets, Dumbbell, Heart, Microscope, Moon, Plus, Sparkles, Sprout, Sun, Thermometer } from 'lucide-react';
import { api } from '../api';
import { formatDate, formatMonth, isIsoDate, isoToday, monthGrid, phaseForDate, statusLabel } from '../lib';
import { EmptyState, ErrorState, LoadingState, Modal } from '../components/Layout';

const blankLog = (date = isoToday()) => ({ date, flow: 'none', mood: 'Calm', energy: 3, symptoms: [], sleepHours: '', sleepQuality: 3, discharge: '', basalTemperature: '', notes: '' });
const flowLevels = ['none', 'spotting', 'light', 'medium', 'heavy'];

export function HomePage({ onNotify, onOpenLabs }) {
  const [dashboard, setDashboard] = useState(null);
  const [logs, setLogs] = useState([]);
  const [options, setOptions] = useState({ moods: [], symptoms: [] });
  const [anchor, setAnchor] = useState(() => new Date());
  const [editing, setEditing] = useState(null);
  const [quickLog, setQuickLog] = useState(() => blankLog());
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState('');
  const [formError, setFormError] = useState('');

  const load = async ({ background = false } = {}) => {
    if (!background) setLoading(true);
    setPageError('');
    try {
      const [dashboardData, cycleData] = await Promise.all([api('/dashboard'), api('/cycle')]);
      setDashboard(dashboardData);
      setLogs(cycleData.logs);
      setOptions(cycleData.options);
      const todayLog = cycleData.logs.find((log) => log.date === dashboardData.today);
      setQuickLog(todayLog ? {
        ...todayLog,
        sleepHours: todayLog.sleepHours ?? '',
        sleepQuality: todayLog.sleepQuality ?? 3,
        energy: todayLog.energy ?? 3,
        basalTemperature: todayLog.basalTemperature ?? '',
        discharge: todayLog.discharge || '',
        notes: todayLog.notes || ''
      } : blankLog(dashboardData.today));
    } catch (nextError) {
      setPageError(nextError.message);
      throw nextError;
    } finally {
      if (!background) setLoading(false);
    }
  };

  useEffect(() => { load().catch(() => {}); }, []);

  const openDate = (date) => {
    const existing = logs.find((log) => log.date === date);
    setEditing(existing ? { ...existing, sleepHours: existing.sleepHours ?? '', basalTemperature: existing.basalTemperature ?? '' } : blankLog(date));
    setFormError('');
  };

  const save = async (event) => {
    event.preventDefault();
    const validationError = validateDailyLog(editing, options);
    if (validationError) {
      setFormError(validationError);
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      await api('/cycle', { method: 'POST', body: JSON.stringify(editing) });
      await load({ background: true });
      setEditing(null);
      onNotify('Your daily check-in is safely saved.');
    } catch (nextError) {
      setFormError(nextError.message);
    } finally {
      setSaving(false);
    }
  };

  const saveQuickLog = async (event) => {
    event.preventDefault();
    const validationError = validateDailyLog(quickLog, options);
    if (validationError) {
      setFormError(validationError);
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      await api('/cycle', { method: 'POST', body: JSON.stringify(quickLog) });
      await load({ background: true });
      onNotify('Your tracker has been updated.');
    } catch (nextError) {
      setFormError(nextError.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading && !dashboard) return <div className="page-wrap"><LoadingState /></div>;
  if (pageError && !dashboard) return <div className="page-wrap"><ErrorState title="We couldn't open your cycle view" copy={pageError} action={<button className="secondary-button" onClick={() => load().catch(() => {})}>Try again</button>} /></div>;

  const phase = dashboard.cycle.phase;
  const lowMood = ['Low', 'Anxious', 'Irritable', 'Tender'].includes(dashboard.latest?.mood);
  const cells = monthGrid(anchor);
  const byDate = Object.fromEntries(logs.map((log) => [log.date, log]));
  const today = dashboard.today;
  const prettyToday = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date(`${today}T12:00:00`));
  const summary = dashboard.labSummary;
  const fertility = dashboard.fertility || { chance: 'Unknown', confidence: 0, summary: 'Add data to estimate fertility.', prevention: 'Use contraception every time if you want to avoid pregnancy.' };
  const prediction = dashboard.prediction;

  return <div className="page-wrap home-page">
    <section className={`hero phase-${phase.toLowerCase()} ${lowMood ? 'mood-low' : ''}`}>
      <div className="hero-copy">
        <p className="eyebrow"><span className="eyebrow-dot" />{prettyToday}</p>
        <h1>Your body has a rhythm.<br /><em>Let’s listen in.</em></h1>
        <p className="hero-sub">Notice patterns without judgment. Every small check-in helps your health picture become more personal.</p>
        <button className="primary-button" onClick={() => openDate(today)}><Plus size={17} />Log today</button>
      </div>
      <PhaseGarden phase={phase} lowMood={lowMood} />
      <div className="phase-card"><span className="phase-symbol">{phase === 'Ovulation' ? '✦' : phase === 'Menstrual' ? '◐' : '✿'}</span><div><small>Estimated phase</small><strong>{phase}</strong><p>{phaseCopy(phase, lowMood)}</p></div></div>
    </section>

    <section className="section-heading calendar-title">
      <div><p className="eyebrow">{formatMonth(anchor)}</p><h2>Your month at a glance</h2></div>
      <div className="month-controls"><button className="icon-button" onClick={() => setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1))} aria-label="Previous month"><ChevronLeft size={18} /></button><button className="today-button" onClick={() => setAnchor(new Date())}>Today</button><button className="icon-button" onClick={() => setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1))} aria-label="Next month"><ChevronRight size={18} /></button></div>
    </section>

    <section className="tracker-layout">
      <div className="calendar-panel">
        <div className="calendar-head"><span>{dashboard.cycle.cycleDay ? `Cycle day ${dashboard.cycle.cycleDay}` : 'Log a period to begin predictions'}</span><div className="legend"><span><i className="dot period-dot" />Period</span><span><i className="dot fertile-dot" />Fertile estimate</span><span><i className="dot logged-dot" />Logged</span></div></div>
        <div className="weekdays">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => <span key={day}>{day}</span>)}</div>
        <div className="calendar-grid">{cells.map((cell) => {
          const log = byDate[cell.iso];
          const cellPhase = phaseForDate(cell.iso, dashboard.cycle);
          const period = ['light', 'medium', 'heavy', 'spotting'].includes(log?.flow);
          return <button key={cell.iso} onClick={() => openDate(cell.iso)} className={`day ${cell.currentMonth ? '' : 'outside'} ${cell.iso === today ? 'today' : ''} ${period ? 'period' : ''} ${cellPhase === 'Ovulation' ? 'fertile' : ''} ${log ? 'logged' : ''}`} aria-label={`${formatDate(cell.iso)}${log ? ', logged' : ''}`}>
            <span>{cell.date.getDate()}</span>{log?.mood && <small>{moodMark(log.mood)}</small>}{cellPhase === 'Ovulation' && !log && <i>✦</i>}
          </button>;
        })}</div>
        <p className="calendar-note"><Sparkles size={13} />Predicted phases are estimates, not contraception or confirmation of ovulation.</p>
      </div>

      <aside className="insight-panel">
        <div className="panel-title"><span>Today’s check-in</span><Sprout size={20} /></div>
        {dashboard.latest ? <><p className="insight-quote">“Small notes become powerful patterns.”</p><div className="mini-metrics"><Metric label="Mood" value={dashboard.latest.mood || 'Not noted'} icon={<Heart size={16} />} /><Metric label="Energy" value={dashboard.latest.energy ? `${dashboard.latest.energy}/5` : 'Not noted'} icon={<Activity size={16} />} /><Metric label="Sleep" value={dashboard.latest.sleepHours ? `${dashboard.latest.sleepHours} hrs` : 'Not noted'} icon={<Moon size={16} />} /></div><button className="secondary-button" onClick={() => openDate(today)}>Update today</button></> : <EmptyState title="Your first petal" copy="A quick check-in starts your personal pattern." action={<button className="secondary-button" onClick={() => openDate(today)}>Log how you feel</button>} />}
      </aside>
    </section>

    <section className="section-heading lower"><div><p className="eyebrow">Your softer health picture</p><h2>Signals worth noticing</h2></div></section>
    <section className="signal-grid">
      <article className={`signal-card lab-signal ${summary.flagged ? 'attention' : ''}`}>
        <div className="signal-top"><span className="signal-icon"><Microscope /></span><button onClick={onOpenLabs}>Open labs <ArrowRight size={14} /></button></div>
        <small>{summary.source === 'predicted' ? 'Predicted lab watch' : 'Latest lab watch'}</small>
        <strong>{summary.source ? summary.flagged ? `${summary.flagged} signal${summary.flagged === 1 ? '' : 's'} to discuss` : 'All recorded values in range' : 'No lab picture yet'}</strong>
        {summary.values.length > 0 && <div className="lab-summary-list">{summary.values.map((value) => <span key={value.code}><b>{value.shortName}</b><i className={`status-dot ${value.status}`} />{statusLabel(value.status)}</span>)}</div>}
        {!summary.source && <p>Add a lab panel or generate an estimate from your tracked data.</p>}
      </article>
      <article className="signal-card forecast-signal"><span className="signal-icon"><CalendarDays /></span><small>Cycle forecast</small><strong>{dashboard.cycle.nextPeriod ? formatDate(dashboard.cycle.nextPeriod, { month: 'long', day: 'numeric' }) : 'Needs a period start'}</strong><p>{dashboard.cycle.averageLength}-day working average · {Math.round(dashboard.cycle.predictionConfidence * 100)}% data confidence</p></article>
      <article className="signal-card fertility-signal"><span className="signal-icon"><Heart /></span><small>Pregnancy chance</small><strong>{fertility.chance}</strong><p>{fertility.summary} {fertility.fertileWindowStart && fertility.fertileWindowEnd ? `Estimated fertile window: ${formatDate(fertility.fertileWindowStart, { month: 'short', day: 'numeric', year: undefined })} to ${formatDate(fertility.fertileWindowEnd, { month: 'short', day: 'numeric', year: undefined })}.` : ''}</p></article>
      <article className="signal-card care-signal"><span className="signal-icon"><Apple /></span><small>{phase} care</small><strong>{dashboard.tips.prompt}</strong><p>{dashboard.tips.nutrition}</p></article>
    </section>

    <section className="care-grid">
      <div><span><Apple size={18} /></span><div><small>Nutrition thought</small><p>{dashboard.tips.nutrition}</p></div></div>
      <div><span><Dumbbell size={18} /></span><div><small>Movement thought</small><p>{dashboard.tips.movement}</p></div></div>
      <div><span><Heart size={18} /></span><div><small>Prevention note</small><p>{fertility.prevention}</p></div></div>
    </section>

    <section className="tracker-quick-card">
      <div className="section-heading lower">
        <div><p className="eyebrow">Direct tracker input</p><h2>Quick log for today</h2></div>
        <button className="text-button" onClick={() => openDate(today)}>Open full check-in <ArrowRight size={14} /></button>
      </div>
      <form className="quick-log-form" onSubmit={saveQuickLog}>
        <div className="form-grid three">
          <label>Date<input type="date" value={quickLog.date} onChange={(event) => setQuickLog({ ...quickLog, date: event.target.value })} required /></label>
          <label>Flow<select value={quickLog.flow} onChange={(event) => setQuickLog({ ...quickLog, flow: event.target.value })}>{flowLevels.map((flow) => <option key={flow} value={flow}>{flow[0].toUpperCase() + flow.slice(1)}</option>)}</select></label>
          <label>Mood<select value={quickLog.mood || ''} onChange={(event) => setQuickLog({ ...quickLog, mood: event.target.value || null })}><option value="">Not noted</option>{options.moods.map((mood) => <option key={mood} value={mood}>{mood}</option>)}</select></label>
        </div>
        <div className="slider-grid">
          <label><span><Activity size={15} />Energy <b>{quickLog.energy || 3}/5</b></span><input type="range" min="1" max="5" value={quickLog.energy || 3} onChange={(event) => setQuickLog({ ...quickLog, energy: Number(event.target.value) })} /></label>
          <label><span><Moon size={15} />Sleep quality <b>{quickLog.sleepQuality || 3}/5</b></span><input type="range" min="1" max="5" value={quickLog.sleepQuality || 3} onChange={(event) => setQuickLog({ ...quickLog, sleepQuality: Number(event.target.value) })} /></label>
        </div>
        <fieldset className="symptom-field"><legend>Symptoms</legend><div className="chip-checks">{options.symptoms.map((symptom) => <label key={symptom} className={quickLog.symptoms.includes(symptom) ? 'checked' : ''}><input type="checkbox" checked={quickLog.symptoms.includes(symptom)} onChange={() => setQuickLog({ ...quickLog, symptoms: quickLog.symptoms.includes(symptom) ? quickLog.symptoms.filter((item) => item !== symptom) : [...quickLog.symptoms, symptom] })} />{symptom}</label>)}</div></fieldset>
        <div className="form-grid three">
          <label><span className="label-icon"><Moon size={14} />Sleep hours</span><input type="number" min="0" max="24" step="0.25" value={quickLog.sleepHours} onChange={(event) => setQuickLog({ ...quickLog, sleepHours: event.target.value })} placeholder="7.5" /></label>
          <label><span className="label-icon"><Droplets size={14} />Discharge</span><select value={quickLog.discharge || ''} onChange={(event) => setQuickLog({ ...quickLog, discharge: event.target.value })}><option value="">Not noted</option><option>Dry</option><option>Sticky</option><option>Creamy</option><option>Watery</option><option>Egg-white</option></select></label>
          <label><span className="label-icon"><Thermometer size={14} />BBT °C</span><input type="number" min="34" max="43" step="0.01" value={quickLog.basalTemperature} onChange={(event) => setQuickLog({ ...quickLog, basalTemperature: event.target.value })} placeholder="36.50" /></label>
        </div>
        <label className="block-label">A note for yourself<textarea value={quickLog.notes || ''} onChange={(event) => setQuickLog({ ...quickLog, notes: event.target.value })} maxLength={1000} placeholder="Anything you want to remember?" /></label>
        {prediction && <p className="prediction-inline-note">Latest estimate: {prediction.values.filter((value) => value.status !== 'normal').length} flagged value{prediction.values.filter((value) => value.status !== 'normal').length === 1 ? '' : 's'} · {prediction.modelVersion}</p>}
        {formError && <div className="form-error" role="alert">{formError}</div>}
        <div className="modal-actions"><button className="primary-button" disabled={saving}>{saving ? 'Saving...' : 'Save today'}<ArrowRight size={16} /></button></div>
      </form>
    </section>

    {editing && <Modal title={byDate[editing.date] ? `Edit ${formatDate(editing.date, { year: undefined })}` : `Check in for ${formatDate(editing.date, { year: undefined })}`} onClose={() => setEditing(null)} wide>
      <form className="daily-form" onSubmit={save}>
        <div className="form-grid three"><label>Date<input type="date" value={editing.date} onChange={(event) => setEditing({ ...editing, date: event.target.value })} required /></label><label>Flow<select value={editing.flow} onChange={(event) => setEditing({ ...editing, flow: event.target.value })}>{['none', 'spotting', 'light', 'medium', 'heavy'].map((flow) => <option key={flow} value={flow}>{flow[0].toUpperCase() + flow.slice(1)}</option>)}</select></label><label>Mood<select value={editing.mood || ''} onChange={(event) => setEditing({ ...editing, mood: event.target.value })}>{options.moods.map((mood) => <option key={mood}>{mood}</option>)}</select></label></div>
        <div className="slider-grid"><label><span><Activity size={15} />Energy <b>{editing.energy}/5</b></span><input type="range" min="1" max="5" value={editing.energy || 3} onChange={(event) => setEditing({ ...editing, energy: Number(event.target.value) })} /></label><label><span><Moon size={15} />Sleep quality <b>{editing.sleepQuality || 3}/5</b></span><input type="range" min="1" max="5" value={editing.sleepQuality || 3} onChange={(event) => setEditing({ ...editing, sleepQuality: Number(event.target.value) })} /></label></div>
        <fieldset className="symptom-field"><legend>Symptoms</legend><div className="chip-checks">{options.symptoms.map((symptom) => <label key={symptom} className={editing.symptoms.includes(symptom) ? 'checked' : ''}><input type="checkbox" checked={editing.symptoms.includes(symptom)} onChange={() => setEditing({ ...editing, symptoms: editing.symptoms.includes(symptom) ? editing.symptoms.filter((item) => item !== symptom) : [...editing.symptoms, symptom] })} />{symptom}</label>)}</div></fieldset>
        <div className="form-grid three"><label><span className="label-icon"><Moon size={14} />Sleep hours</span><input type="number" min="0" max="24" step="0.25" value={editing.sleepHours} onChange={(event) => setEditing({ ...editing, sleepHours: event.target.value })} placeholder="7.5" /></label><label><span className="label-icon"><Droplets size={14} />Discharge</span><select value={editing.discharge || ''} onChange={(event) => setEditing({ ...editing, discharge: event.target.value })}><option value="">Not noted</option><option>Dry</option><option>Sticky</option><option>Creamy</option><option>Watery</option><option>Egg-white</option></select></label><label><span className="label-icon"><Thermometer size={14} />BBT °C</span><input type="number" min="34" max="43" step="0.01" value={editing.basalTemperature} onChange={(event) => setEditing({ ...editing, basalTemperature: event.target.value })} placeholder="36.50" /></label></div>
        <label className="block-label">A note for yourself<textarea value={editing.notes || ''} onChange={(event) => setEditing({ ...editing, notes: event.target.value })} maxLength={1000} placeholder="Anything you want to remember?" /></label>
        {formError && <div className="form-error" role="alert">{formError}</div>}
        <div className="modal-actions"><button type="button" className="text-button" onClick={() => setEditing(null)}>Cancel</button><button className="primary-button" disabled={saving}>{saving ? 'Saving...' : 'Save check-in'}<ArrowRight size={16} /></button></div>
      </form>
    </Modal>}
  </div>;
}

function validateDailyLog(log, options) {
  if (!log || !isIsoDate(log.date)) return 'Use a valid date in YYYY-MM-DD format.';
  if (!flowLevels.includes(log.flow)) return 'Choose a supported flow value.';
  if (log.mood && options.moods.length > 0 && !options.moods.includes(log.mood)) return 'Choose a supported mood value.';
  if (!Array.isArray(log.symptoms) || (options.symptoms.length > 0 && log.symptoms.some((symptom) => !options.symptoms.includes(symptom)))) return 'Choose symptoms from the provided list.';
  if (log.symptoms.length > 12) return 'Please keep symptoms to 12 selections or fewer.';
  const energy = Number(log.energy);
  if (!Number.isFinite(energy) || energy < 1 || energy > 5) return 'Energy must be from 1 to 5.';
  const sleepQuality = Number(log.sleepQuality);
  if (!Number.isFinite(sleepQuality) || sleepQuality < 1 || sleepQuality > 5) return 'Sleep quality must be from 1 to 5.';
  if (log.sleepHours !== '' && (!Number.isFinite(Number(log.sleepHours)) || Number(log.sleepHours) < 0 || Number(log.sleepHours) > 24)) return 'Sleep must be from 0 to 24 hours.';
  if (log.basalTemperature !== '' && (!Number.isFinite(Number(log.basalTemperature)) || Number(log.basalTemperature) < 34 || Number(log.basalTemperature) > 43)) return 'Temperature must be from 34°C to 43°C.';
  if (String(log.notes || '').length > 1000) return 'Notes must be 1,000 characters or fewer.';
  return '';
}

function Metric({ label, value, icon }) {
  return <div className="metric"><span>{icon}</span><div><small>{label}</small><strong>{value}</strong></div></div>;
}

function PhaseGarden({ phase, lowMood }) {
  return <div className="hero-art" aria-hidden="true">
    <div className="sun-disc"><Sun size={42} /></div><div className="garden-hill" />
    <div className="flower flower-one">✿</div><div className="flower flower-two">❀</div><div className="flower flower-three">✾</div>
    <div className="stem stem-one" /><div className="stem stem-two" /><div className="leaf leaf-one" /><div className="leaf leaf-two" />
    {phase === 'Ovulation' && !lowMood && <><div className="balloon balloon-one" /><div className="balloon balloon-two" /><div className="confetti">{Array.from({ length: 9 }, (_, index) => <i key={index}>✦</i>)}</div></>}
    {lowMood && <div className="closed-bud">◉</div>}
  </div>;
}

function phaseCopy(phase, lowMood) {
  if (lowMood) return 'A softer pace is still progress';
  return { Menstrual: 'Rest and respond to your body', Follicular: 'Energy may begin to rise', Ovulation: 'Your brighter, social window', Luteal: 'Turn gently toward yourself', Unknown: 'Log a period to learn your rhythm' }[phase];
}

function moodMark(mood) {
  return { Happy: '☀', Energized: '✦', Low: '◡', Anxious: '≈', Irritable: '!', Calm: '•', Tender: '♡' }[mood] || '•';
}
