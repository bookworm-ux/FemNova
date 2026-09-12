import React, { useEffect, useState } from 'react';
import { api } from './api';
import { HomePage } from './pages/HomePage';
import { LabsPage } from './pages/LabsPage';
import { CommunityPage } from './pages/CommunityPage';
import { SettingsPage } from './pages/SettingsPage';
import { Chatbot } from './components/Chatbot';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ErrorState, Layout, LoadingState } from './components/Layout';
import { hrefForPage, navigateToPage, pageFromLocation } from './lib';

const pages = new Set(['home', 'labs', 'community', 'settings']);
const DEVICE_KEY = 'herhealth_device_id';

function ensureDeviceId({ reset = false } = {}) {
  if (typeof window === 'undefined') return 'server-fallback-device';
  if (reset) window.localStorage.removeItem(DEVICE_KEY);
  let deviceId = window.localStorage.getItem(DEVICE_KEY);
  if (!deviceId) {
    deviceId = window.crypto?.randomUUID?.().replace(/-/g, '') || `${Date.now()}${Math.random().toString(16).slice(2)}`;
    window.localStorage.setItem(DEVICE_KEY, deviceId);
  }
  return deviceId;
}

export function App() {
  const [session, setSession] = useState(null);
  const [checking, setChecking] = useState(true);
  const [page, setPage] = useState(() => pageFromLocation(window.location));
  const [chatOpen, setChatOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const [bootError, setBootError] = useState('');

  const notify = (message, type = 'success') => setToast({ message, type });

  const bootstrapSession = async ({ resetDevice = false, replace = false } = {}) => {
    const payload = await api('/auth/bootstrap', {
      method: 'POST',
      body: JSON.stringify({
        deviceId: ensureDeviceId({ reset: resetDevice }),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
      })
    });
    setSession({ user: payload.user, profile: payload.profile });
    setBootError('');
    setChecking(false);
    if (replace) navigateToPage('home', { replace: true });
    if (payload.bootstrapAdmin) notify('Your first local profile can also manage ranges and moderation.');
    return payload;
  };

  useEffect(() => {
    let active = true;
    const openApp = async () => {
      setChecking(true);
      setBootError('');
      try {
        const current = await api('/auth/me');
        if (!active) return;
        setSession(current);
        setChecking(false);
        return;
      } catch (error) {
        if (!active) return;
        if (error.status && error.status !== 401) {
          setBootError(error.message);
          setChecking(false);
          return;
        }
      }

      try {
        await bootstrapSession();
      } catch (error) {
        if (!active) return;
        setBootError(error.message);
        setChecking(false);
      }
    };

    openApp();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const syncLocation = () => {
      const nextPage = pageFromLocation(window.location);
      setPage(nextPage);
      if (window.location.hash || window.location.pathname !== hrefForPage(nextPage)) {
        navigateToPage(nextPage, { replace: true });
      }
    };
    syncLocation();
    const onPopState = () => setPage(pageFromLocation(window.location));
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('animations-disabled', session ? !session.profile.animationsEnabled : false);
  }, [session?.profile.animationsEnabled]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), 4200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const navigate = (nextPage, options = {}) => {
    if (!pages.has(nextPage)) return;
    setPage(nextPage);
    navigateToPage(nextPage, options);
    window.scrollTo({ top: 0, behavior: session?.profile.animationsEnabled ? 'smooth' : 'auto' });
  };

  const startFreshProfile = async () => {
    try { if (session) await api('/auth/logout', { method: 'POST' }); } catch { /* Continue into a fresh local bootstrap. */ }
    setSession(null);
    setChatOpen(false);
    setChecking(true);
    try {
      await bootstrapSession({ resetDevice: true, replace: true });
    } catch (error) {
      setBootError(error.message);
      setChecking(false);
    }
  };

  if (checking) return <div className="app-loading"><LoadingState label="Opening your private HerHealth space" /></div>;
  if (!session) return <div className="page-wrap"><ErrorState title="We couldn't open HerHealth" copy={bootError || 'Please try again to continue.'} action={<button className="primary-button" onClick={() => bootstrapSession({ replace: true }).catch((error) => setBootError(error.message))}>Try again</button>} /></div>;

  const common = { onNotify: notify };
  let content;
  if (page === 'labs') content = <LabsPage user={session.user} profile={session.profile} {...common} />;
  else if (page === 'community') content = <CommunityPage user={session.user} profile={session.profile} {...common} />;
  else if (page === 'settings') content = <SettingsPage user={session.user} profile={session.profile} onProfile={(profile) => setSession((current) => ({ ...current, profile }))} onResetProfile={startFreshProfile} {...common} />;
  else content = <HomePage onOpenLabs={() => navigate('labs')} {...common} />;

  return <ErrorBoundary>
    <Layout page={page} user={session.user} onNavigate={navigate} onOpenChat={() => setChatOpen(true)} toast={toast}>
      {content}
      {chatOpen && <Chatbot onClose={() => setChatOpen(false)} />}
    </Layout>
  </ErrorBoundary>;
}
