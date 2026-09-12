import React, { useEffect, useMemo, useState } from 'react';
import { Activity, ArrowRight, ChevronDown, CircleAlert, ExternalLink, FileText, FlaskConical, Microscope, Plus, ShieldCheck, Sparkles, Trash2, Upload } from 'lucide-react';
import { api, openPrescriptionFile } from '../api';
import { formatDate, isIsoDate, isoToday, populationLabel, statusLabel } from '../lib';
import { EmptyState, ErrorState, LoadingState, Modal, PageIntro } from '../components/Layout';

const CORE = ['ft3', 'ft4', 'tsh', 'hb'];
const OPTIONAL = ['fsh', 'lh', 'amh', 'estrogen', 'progesterone'];
const emptyValues = Object.fromEntries([...CORE, ...OPTIONAL].map((code) => [code, '']));

export function LabsPage({ user, profile, onNotify }) {
  const [results, setResults] = useState([]);
  const [prediction, setPrediction] = useState(null);
  const [ranges, setRanges] = useState([]);
  const [populations, setPopulations] = useState([]);
  const [prescriptions, setPrescriptions] = useState([]);
  const [form, setForm] = useState({ date: isoToday(), population: profile.population, comments: '', values: { ...emptyValues } });
  const [showOptional, setShowOptional] = useState(false);
  const [trendTest, setTrendTest] = useState('tsh');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState('');
  const [error, setError] = useState('');

  const load = async (population = form.population, { background = false } = {}) => {
    if (!background) setLoading(true);
    setPageError('');
    try {
      const [labData, rangeData, files] = await Promise.all([api('/labs'), api(`/reference-ranges?population=${population}`), api('/prescriptions')]);
      setResults(labData.results);
      setPrediction(labData.prediction);
      setRanges(rangeData.ranges.filter((range) => range.active));
      setPopulations(rangeData.populations);
      setPrescriptions(files.prescriptions);
    } catch (nextError) {
      setPageError(nextError.message);
      throw nextError;
    } finally {
      if (!background) setLoading(false);
    }
  };

  useEffect(() => { load().catch(() => {}); }, []);

  const changePopulation = async (population) => {
    setForm((current) => ({ ...current, population }));
    try {
      const data = await api(`/reference-ranges?population=${population}`);
      setRanges(data.ranges.filter((range) => range.active));
      setPageError('');
    } catch (nextError) {
      setPageError(nextError.message);
    }
  };

  const saveResult = async (event) => {
    event.preventDefault();
    const validationError = validateLabForm(form);
    if (validationError) {
      setError(validationError);
      return;
    }
    setSaving(true);
    setError('');
    try {
      await api('/labs', { method: 'POST', body: JSON.stringify(form) });
      setForm((current) => ({ ...current, comments: '', values: { ...emptyValues } }));
      await load(form.population, { background: true });
      onNotify('Lab panel saved and evaluated against its range version.');
    } catch (nextError) {
      setError(nextError.message);
    } finally {
      setSaving(false);
    }
  };

  const runPrediction = async () => {
    setSaving(true);
    setError('');
    try {
      const next = await api('/predictions', { method: 'POST', body: '{}' });
      setPrediction(next);
      onNotify('A new baseline estimate is ready. It is not a laboratory result.');
    } catch (nextError) {
      setError(nextError.message);
    } finally {
      setSaving(false);
    }
  };

  const deleteResult = async (id) => {
    if (!window.confirm('Delete this lab panel? This cannot be undone.')) return;
    try {
      await api(`/labs/${id}`, { method: 'DELETE' });
      await load();
      onNotify('Lab panel deleted.');
    } catch (nextError) {
      setError(nextError.message);
    }
  };

  const activeTests = useMemo(() => Object.fromEntries(ranges.map((range) => [range.code, range])), [ranges]);
  const canAdmin = ['clinical_admin', 'platform_admin'].includes(user.role);

  if (loading && !populations.length) return <div className="page-wrap"><LoadingState label="Preparing your lab notebook" /></div>;
  if (pageError && !populations.length) return <div className="page-wrap"><ErrorState title="We couldn't open your lab notebook" copy={pageError} action={<button className="secondary-button" onClick={() => load().catch(() => {})}>Try again</button>} /></div>;

  return <div className="page-wrap inner-page labs-page">
    <PageIntro eyebrow="Your health labs" title={<>Numbers tell one part.<br /><em>Context tells the story.</em></>} copy="Save thyroid, blood, and hormone results in one private place. HerHealth records the exact reference-range version used, so a future change never rewrites your history." icon={<Microscope size={31} />} actions={<><button className="secondary-button" onClick={() => setUploadOpen(true)}><Upload size={15} />Upload prescription</button>{canAdmin && <button className="text-button" onClick={() => setAdminOpen(true)}>Manage ranges</button>}</>} />

    {(pageError || error) && <div className="page-error" role="alert"><CircleAlert size={18} />{pageError || error}<button onClick={() => { setPageError(''); setError(''); }}>Dismiss</button></div>}

    <section className="labs-layout">
      <div className="form-card lab-entry-card">
        <div className="panel-title"><div><span className="petal-dot" />Add a laboratory panel</div><span className="required-note">At least one value</span></div>
        <form onSubmit={saveResult}>
          <div className="form-grid"><label>Result date<input type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} required /></label><label>Range population<select value={form.population} onChange={(event) => changePopulation(event.target.value)}>{populations.map((item) => <option key={item} value={item}>{populationLabel(item)}</option>)}</select></label></div>
          <div className="lab-field-grid">{CORE.map((code) => <LabInput code={code} range={activeTests[code]} value={form.values[code]} onChange={(value) => setForm({ ...form, values: { ...form.values, [code]: value } })} key={code} />)}</div>
          <button type="button" className="optional-toggle" onClick={() => setShowOptional((value) => !value)} aria-expanded={showOptional}><span><FlaskConical size={16} />Optional reproductive hormones</span><ChevronDown className={showOptional ? 'rotated' : ''} size={16} /></button>
          {showOptional && <div className="lab-field-grid optional-fields">{OPTIONAL.map((code) => <LabInput code={code} range={activeTests[code]} value={form.values[code]} onChange={(value) => setForm({ ...form, values: { ...form.values, [code]: value } })} key={code} />)}</div>}
          <label className="block-label">Doctor or report comments<textarea value={form.comments} onChange={(event) => setForm({ ...form, comments: event.target.value })} maxLength={1000} placeholder="Optional context, report name, or clinician note" /></label>
          <div className="lab-form-footer"><p><ShieldCheck size={15} />Ranges vary by assay and population. The range printed by your laboratory takes priority.</p><button className="primary-button" disabled={saving}>{saving ? 'Saving...' : 'Save and evaluate'}<ArrowRight size={16} /></button></div>
        </form>
      </div>

      <aside className="range-card">
        <div className="panel-title"><span>Active reference ranges</span><span className="range-version">v{ranges[0]?.version || 1}</span></div>
        <p>{populationLabel(form.population)}</p>
        {ranges.filter((range) => range.core).map((range) => <div className="range-row" key={range.id}><span><b>{range.shortName}</b><small>{range.name}</small></span><strong>{range.low}–{range.high}</strong><small>{range.unit}</small></div>)}
        <div className="range-note"><Sparkles size={17} /><span>Values near a bound are labeled borderline. Values beyond it show the crossed bound and distance.</span></div>
      </aside>
    </section>

    <section className="prediction-card">
      <div className="prediction-copy"><span className="model-mark"><Activity size={19} /></span><div><p className="eyebrow">When a recent lab is unavailable</p><h2>Baseline lab-risk estimate</h2><p>Uses your logged symptoms, cycle data, and past values. This deterministic model is an auditable product-flow placeholder, not clinically validated ML.</p></div></div>
      <button className="secondary-button" onClick={runPrediction} disabled={saving}>{prediction ? 'Refresh estimate' : 'Generate estimate'}<Sparkles size={15} /></button>
      {prediction?.values?.length > 0 && <div className="prediction-results">{prediction.values.map((value) => <LabBadge value={value} predicted key={value.code} />)}<div className="prediction-meta"><b>{Math.round(Math.max(...prediction.values.map((value) => value.confidence)) * 100)}% max confidence</b><span>{prediction.modelVersion} · {new Date(prediction.generatedAt).toLocaleString()}</span></div></div>}
      <p className="medical-disclaimer"><CircleAlert size={15} />This estimate is not a diagnosis and is not a substitute for a laboratory test. Consult a qualified clinician.</p>
    </section>

    <section className="section-heading lower"><div><p className="eyebrow">Patterns over time</p><h2>Lab trend garden</h2></div><div className="trend-tabs">{CORE.map((code) => <button className={trendTest === code ? 'active' : ''} onClick={() => setTrendTest(code)} key={code}>{activeTests[code]?.shortName || code.toUpperCase()}</button>)}</div></section>
    <TrendChart results={results} testCode={trendTest} range={activeTests[trendTest]} />

    <section className="section-heading lower"><div><p className="eyebrow">Your records</p><h2>Saved panels</h2></div><span className="result-count">{results.length} panel{results.length === 1 ? '' : 's'}</span></section>
    <section className="lab-history">{results.length ? results.map((result) => <article className="lab-result-card" key={result.id}><header><div><small>{formatDate(result.date)}</small><h3>{result.comments || 'Laboratory panel'}</h3><span>{populationLabel(result.population)}</span></div><button className="danger-icon" onClick={() => deleteResult(result.id)} aria-label="Delete lab result"><Trash2 size={15} /></button></header><div className="result-badges">{result.values.map((value) => <LabBadge value={value} key={value.code} />)}</div><p className="result-note">Not a diagnosis. Discuss unexpected results with a qualified clinician.</p></article>) : <EmptyState icon="✾" title="A clear starting place" copy="Your saved lab panels and their range evaluations will appear here." />}</section>

    {prescriptions.length > 0 && <section className="prescription-list"><div className="section-heading"><div><p className="eyebrow">Documents</p><h2>Prescriptions and reports</h2></div></div><div>{prescriptions.map((file) => <button type="button" key={file.id} onClick={() => openPrescriptionFile(file.id, file.originalName).catch((nextError) => setError(nextError.message))}><FileText size={18} /><span><b>{file.originalName}</b><small>{Math.ceil(file.sizeBytes / 1024)} KB · {new Date(file.createdAt).toLocaleDateString()}</small></span><ExternalLink size={14} /></button>)}</div></section>}

    {uploadOpen && <UploadModal results={results} onClose={() => setUploadOpen(false)} onSaved={async () => { await load(form.population, { background: true }); setUploadOpen(false); onNotify('Document uploaded to your private health space.'); }} />}
    {adminOpen && <RangeAdmin ranges={ranges} population={form.population} onClose={() => setAdminOpen(false)} onSaved={async () => { await load(form.population, { background: true }); setAdminOpen(false); onNotify('A new reference-range version is active.'); }} />}
  </div>;
}

function validateLabForm(form) {
  if (!isIsoDate(form.date)) return 'A valid result date is required.';
  const entries = Object.entries(form.values || {}).filter(([, value]) => value !== '' && value !== null && value !== undefined);
  if (!entries.length) return 'Enter at least one lab value.';
  for (const [code, value] of entries) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0 || numeric > 10000) return `Enter a valid value for ${code.toUpperCase()}.`;
  }
  if (String(form.comments || '').length > 1000) return 'Comments must be 1,000 characters or fewer.';
  return '';
}

function LabInput({ code, range, value, onChange }) {
  return <label className="lab-input"><span>{range?.name || code}<small>{range ? `${range.low}–${range.high}` : 'No range'}</small></span><div><input type="number" min="0" max="10000" step="any" value={value} onChange={(event) => onChange(event.target.value)} placeholder="—" /><i>{range?.unit}</i></div></label>;
}

function LabBadge({ value, predicted = false }) {
  const detail = value.status === 'normal'
    ? `Within ${value.range.low}–${value.range.high}`
    : value.status === 'borderline'
      ? `${value.direction === 'low' ? 'Near lower' : 'Near upper'} limit by ${value.delta} ${value.unit}`
      : `${value.delta} ${value.unit} ${value.direction === 'low' ? 'below' : 'above'} the ${value.direction === 'low' ? 'lower' : 'upper'} limit`;
  return <div className={`lab-badge ${value.status}`}><div><span>{value.shortName}</span>{predicted && <small>estimate</small>}</div><strong>{value.value}<i>{value.unit}</i></strong><b>{statusLabel(value.status)}{value.direction ? ` · ${value.direction}` : ''}</b><p>{detail} · range v{value.range.version}</p>{predicted && <em>{Math.round(value.confidence * 100)}% confidence</em>}</div>;
}

function TrendChart({ results, testCode, range }) {
  const points = results.slice().reverse().flatMap((result) => {
    const value = result.values.find((item) => item.code === testCode);
    return value ? [{ date: result.date, ...value }] : [];
  });
  if (!points.length || !range) return <EmptyState icon="❀" title="No trend yet" copy={`Add a ${range?.shortName || testCode.toUpperCase()} result to begin this chart.`} />;
  const values = points.map((point) => point.value);
  const min = Math.min(range.low - (range.high - range.low) * 0.3, ...values);
  const max = Math.max(range.high + (range.high - range.low) * 0.3, ...values);
  const x = (index) => points.length === 1 ? 50 : 8 + (index / (points.length - 1)) * 84;
  const y = (value) => 88 - ((value - min) / (max - min || 1)) * 76;
  const path = points.map((point, index) => `${index ? 'L' : 'M'} ${x(index)} ${y(point.value)}`).join(' ');
  return <div className="trend-card"><div className="chart-labels"><span>{max.toFixed(1)} {range.unit}</span><span>{min.toFixed(1)} {range.unit}</span></div><svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label={`${range.shortName} trend with reference range from ${range.low} to ${range.high} ${range.unit}`}><rect x="0" y={y(range.high)} width="100" height={Math.max(1, y(range.low) - y(range.high))} className="range-band" /><line x1="0" x2="100" y1={y(range.high)} y2={y(range.high)} /><line x1="0" x2="100" y1={y(range.low)} y2={y(range.low)} /><path d={path} className="trend-line" />{points.map((point, index) => <circle key={`${point.date}-${index}`} cx={x(index)} cy={y(point.value)} r="1.8" className={point.status} />)}</svg><div className="chart-dates"><span>{formatDate(points[0].date, { year: undefined })}</span><b>Reference band {range.low}–{range.high} {range.unit}</b><span>{formatDate(points.at(-1).date, { year: undefined })}</span></div></div>;
}

function UploadModal({ results, onClose, onSaved }) {
  const [form, setForm] = useState({ file: null, comments: '', resultId: '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const submit = async (event) => {
    event.preventDefault();
    if (!form.file) return setError('Choose a PDF or image first.');
    if (!['application/pdf', 'image/png', 'image/jpeg', 'image/webp'].includes(form.file.type)) return setError('Choose a PDF, PNG, JPG, or WebP file.');
    if (form.file.size > 5 * 1024 * 1024) return setError('Files must be smaller than 5 MB.');
    setSaving(true);
    setError('');
    try {
      const dataUrl = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(form.file); });
      await api('/prescriptions', { method: 'POST', body: JSON.stringify({ name: form.file.name, mimeType: form.file.type, dataUrl, comments: form.comments, resultId: form.resultId || null }) });
      onSaved();
    } catch (nextError) {
      setError(nextError.message);
      setSaving(false);
    }
  };
  return <Modal title="Upload a prescription or report" onClose={onClose}><form className="stack-form" onSubmit={submit}><label className="file-drop"><Upload size={23} /><span>{form.file ? form.file.name : 'Choose a PDF or image'}</span><small>PDF, PNG, JPG, or WebP · up to 5 MB</small><input type="file" accept="application/pdf,image/png,image/jpeg,image/webp" onChange={(event) => setForm({ ...form, file: event.target.files[0] || null })} /></label><label>Link to lab panel<select value={form.resultId} onChange={(event) => setForm({ ...form, resultId: event.target.value })}><option value="">No linked panel</option>{results.map((result) => <option key={result.id} value={result.id}>{formatDate(result.date)} · {result.comments || 'Lab panel'}</option>)}</select></label><label>Doctor comments<textarea value={form.comments} onChange={(event) => setForm({ ...form, comments: event.target.value })} maxLength={1000} /></label>{error && <div className="form-error">{error}</div>}<button className="primary-button" disabled={saving}>{saving ? 'Uploading...' : 'Upload privately'}<ArrowRight size={16} /></button></form></Modal>;
}

function RangeAdmin({ ranges, population, onClose, onSaved }) {
  const first = ranges.find((range) => range.core) || ranges[0];
  const [form, setForm] = useState({ code: first.code, population, unit: first.unit, low: first.low, high: first.high, borderlineMargin: first.borderlineMargin, effectiveFrom: isoToday(), sourceNote: first.sourceNote });
  const [error, setError] = useState('');
  const selectTest = (code) => { const range = ranges.find((item) => item.code === code); setForm({ ...form, code, unit: range.unit, low: range.low, high: range.high, borderlineMargin: range.borderlineMargin, sourceNote: range.sourceNote }); };
  const submit = async (event) => {
    event.preventDefault();
    const low = Number(form.low);
    const high = Number(form.high);
    const borderlineMargin = Number(form.borderlineMargin);
    if (!Number.isFinite(low) || !Number.isFinite(high) || low >= high) return setError('Low must be below high.');
    if (!Number.isFinite(borderlineMargin) || borderlineMargin < 0) return setError('Borderline margin must be zero or greater.');
    if (!isIsoDate(form.effectiveFrom)) return setError('Effective date is required.');
    if (!String(form.sourceNote || '').trim()) return setError('Source and assay note is required.');
    try {
      await api('/reference-ranges', { method: 'POST', body: JSON.stringify(form) });
      onSaved();
    } catch (nextError) {
      setError(nextError.message);
    }
  };
  return <Modal title="Create a reference-range version" onClose={onClose}><form className="stack-form" onSubmit={submit}><p className="admin-warning"><CircleAlert size={16} />New versions affect future evaluations only. Existing results retain their original range.</p><label>Test<select value={form.code} onChange={(event) => selectTest(event.target.value)}>{ranges.map((range) => <option value={range.code} key={range.code}>{range.name}</option>)}</select></label><div className="form-grid"><label>Lower limit<input type="number" step="any" value={form.low} onChange={(event) => setForm({ ...form, low: event.target.value })} /></label><label>Upper limit<input type="number" step="any" value={form.high} onChange={(event) => setForm({ ...form, high: event.target.value })} /></label><label>Borderline margin<input type="number" step="any" min="0" value={form.borderlineMargin} onChange={(event) => setForm({ ...form, borderlineMargin: event.target.value })} /></label><label>Effective date<input type="date" value={form.effectiveFrom} onChange={(event) => setForm({ ...form, effectiveFrom: event.target.value })} /></label></div><label>Source and assay note<textarea value={form.sourceNote} onChange={(event) => setForm({ ...form, sourceNote: event.target.value })} required /></label>{error && <div className="form-error">{error}</div>}<button className="primary-button">Publish new version<Plus size={16} /></button></form></Modal>;
}
