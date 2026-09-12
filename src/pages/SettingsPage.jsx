import React, { useEffect, useState } from 'react';
import { Bell, Bot, Download, Flower2, LockKeyhole, Save, ShieldCheck, Smartphone, Trash2 } from 'lucide-react';
import { api, downloadExport } from '../api';
import { populationLabel } from '../lib';
import { Modal, PageIntro } from '../components/Layout';

const populations = ['adult_non_pregnant', 'pregnancy_t1', 'pregnancy_t2', 'pregnancy_t3', 'adolescent'];

export function SettingsPage({ user, profile, onProfile, onResetProfile, onNotify }) {
  const [form, setForm] = useState(profile);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [installPrompt, setInstallPrompt] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const capture = (event) => { event.preventDefault(); setInstallPrompt(event); };
    window.addEventListener('beforeinstallprompt', capture);
    return () => window.removeEventListener('beforeinstallprompt', capture);
  }, []);

  const save = async (event) => {
    event.preventDefault();
    if (!Number.isInteger(Number(form.averageCycleLength)) || Number(form.averageCycleLength) < 15 || Number(form.averageCycleLength) > 60) {
      setError('Cycle length must be between 15 and 60 days.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const result = await api('/settings', { method: 'PUT', body: JSON.stringify(form) });
      setForm(result.profile);
      onProfile(result.profile);
      onNotify('Your preferences and consent choices are saved.');
    } catch (nextError) {
      setError(nextError.message);
    } finally {
      setSaving(false);
    }
  };

  const install = async () => {
    if (installPrompt) {
      await installPrompt.prompt();
      setInstallPrompt(null);
    } else {
      onNotify('Use your browser menu and choose “Install app” or “Add to Home Screen”.');
    }
  };

  return <div className="page-wrap inner-page settings-page">
    <PageIntro eyebrow="Your settings" title={<>Your space, on<br /><em>your own terms.</em></>} copy="Choose what HerHealth remembers, what Nova may personalize, and how the experience moves. You can export or delete your data whenever you choose." icon={<LockKeyhole size={30} />} />

    <form className="settings-layout" onSubmit={save}>
      <section className="settings-main">
        <SettingsCard icon={<Flower2 />} title="Cycle & display" copy="These choices shape forecasts and the visual atmosphere.">
          <label className="setting-row"><span><b>Reference population</b><small>Used to select the current lab-range set.</small></span><select value={form.population} onChange={(event) => setForm({ ...form, population: event.target.value })}>{populations.map((population) => <option value={population} key={population}>{populationLabel(population)}</option>)}</select></label>
          <label className="setting-row"><span><b>Working cycle length</b><small>Used until your logged cycle history provides an average.</small></span><div className="number-setting"><input type="number" min="15" max="60" value={form.averageCycleLength} onChange={(event) => setForm({ ...form, averageCycleLength: Number(event.target.value) })} /><i>days</i></div></label>
          <Toggle label="Decorative animations" copy="Subtle blooms and phase-reactive celebration. Device reduced-motion is always respected." checked={form.animationsEnabled} onChange={(checked) => setForm({ ...form, animationsEnabled: checked })} />
        </SettingsCard>

        <SettingsCard icon={<Bot />} title="Nova personalization" copy="This is separate, explicit consent for the health guide.">
          <Toggle label="Use my tracked context" copy="Allows Nova to mention your estimated phase and latest lab flags. Your private data is never added to community posts." checked={form.chatbotPersonalization} onChange={(checked) => setForm({ ...form, chatbotPersonalization: checked })} />
          <div className="consent-explainer"><ShieldCheck size={17} /><p>Without this consent, Nova answers only from the approved general knowledge corpus. Turning it off takes effect immediately.</p></div>
        </SettingsCard>

        <SettingsCard icon={<Bell />} title="Community & reminders" copy="Control defaults now; notification delivery can be connected to mobile push later.">
          <Toggle label="Anonymous posting by default" copy="Moderators can still identify the account behind anonymous content for safety." checked={form.anonymousByDefault} onChange={(checked) => setForm({ ...form, anonymousByDefault: checked })} />
          <Toggle label="Cycle reminders" copy="Prepare for upcoming period and daily check-in reminders." checked={form.notifications.cycle} onChange={(checked) => setForm({ ...form, notifications: { ...form.notifications, cycle: checked } })} />
          <Toggle label="Community replies" copy="Receive a notification when someone replies to your post." checked={form.notifications.community} onChange={(checked) => setForm({ ...form, notifications: { ...form.notifications, community: checked } })} />
        </SettingsCard>

        {error && <div className="form-error">{error}</div>}
        <button className="primary-button settings-save" disabled={saving}><Save size={16} />{saving ? 'Saving...' : 'Save preferences'}</button>
      </section>

      <aside className="settings-aside">
        <div className="account-card"><span className="avatar account-avatar">{user.name[0].toUpperCase()}</span><h3>{user.name}</h3><p>{user.email}</p><span className="role-chip">{user.role.replace('_', ' ')}</span><small className="bootstrap-note">HerHealth now opens directly into a local profile on this device. Delete the account below if you want to start fresh.</small>{user.role === 'platform_admin' && <small className="bootstrap-note">The first local account becomes platform admin so reference ranges and moderation can be tested.</small>}</div>
        <div className="mobile-card"><Smartphone size={24} /><h3>Install HerHealth</h3><p>Use the responsive PWA like an app today. The same API and domain contracts are ready for a future Expo client.</p><button type="button" className="secondary-button" onClick={install}>Install on this device</button></div>
        <div className="data-card"><h3>Your data</h3><button type="button" onClick={() => downloadExport().catch((nextError) => setError(nextError.message))}><Download size={16} /><span><b>Export my data</b><small>Download cycle, lab, consent, and community records as JSON.</small></span></button><button type="button" className="danger-row" onClick={() => setDeleteOpen(true)}><Trash2 size={16} /><span><b>Delete account</b><small>De-identify the account and end all active sessions.</small></span></button></div>
      </aside>
    </form>

    {deleteOpen && <DeleteAccountModal user={user} onClose={() => setDeleteOpen(false)} onDeleted={onResetProfile} />}
  </div>;
}

function SettingsCard({ icon, title, copy, children }) {
  return <section className="settings-card"><header><span>{icon}</span><div><h2>{title}</h2><p>{copy}</p></div></header><div className="setting-list">{children}</div></section>;
}

function Toggle({ label, copy, checked, onChange }) {
  return <label className="setting-row toggle-row"><span><b>{label}</b><small>{copy}</small></span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><i aria-hidden="true" /></label>;
}

function DeleteAccountModal({ user, onClose, onDeleted }) {
  const [password, setPassword] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const submit = async (event) => {
    event.preventDefault();
    if (!window.confirm('Permanently delete your HerHealth account and private health records?')) return;
    setDeleting(true);
    try {
      await api('/account', {
        method: 'DELETE',
        body: JSON.stringify(user.autoProvisioned ? { confirm: confirmText } : { password })
      });
      onDeleted();
    } catch (nextError) {
      setError(nextError.message);
      setDeleting(false);
    }
  };
  return <Modal title="Delete your account" onClose={onClose}><form className="stack-form" onSubmit={submit}><p className="delete-warning">This signs you out everywhere and de-identifies your account. Private health records are removed through database cascade rules. Export first if you want a copy.</p>{user.autoProvisioned ? <label>Type `RESET_LOCAL_PROFILE` to confirm<input type="text" value={confirmText} onChange={(event) => setConfirmText(event.target.value)} required autoFocus /></label> : <label>Confirm with your password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required autoFocus /></label>}{error && <div className="form-error">{error}</div>}<button className="danger-button" disabled={deleting || (user.autoProvisioned ? confirmText !== 'RESET_LOCAL_PROFILE' : !password)}><Trash2 size={16} />{deleting ? 'Deleting...' : user.autoProvisioned ? 'Reset local profile' : 'Permanently delete account'}</button></form></Modal>;
}
