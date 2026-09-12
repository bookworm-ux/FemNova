import React, { useState } from 'react';
import { Bot, Flower2, Home, Menu, Microscope, Settings, Users, X } from 'lucide-react';

const navItems = [
  { id: 'home', label: 'My cycle', icon: Home },
  { id: 'labs', label: 'Health labs', icon: Microscope },
  { id: 'community', label: 'Community', icon: Users },
  { id: 'settings', label: 'Settings', icon: Settings }
];

export function Layout({ children, page, user, onNavigate, onOpenChat, toast }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const navigate = (next) => {
    setMobileOpen(false);
    onNavigate(next);
  };
  return <div className="app-shell">
    <header className="topbar">
      <button className="brand" onClick={() => navigate('home')} aria-label="HerHealth home">
        <span className="brand-mark"><Flower2 size={21} /></span>
        <span>HerHealth</span>
      </button>
      <button className="mobile-menu" onClick={() => setMobileOpen((value) => !value)} aria-label="Toggle navigation" aria-expanded={mobileOpen}>
        {mobileOpen ? <X /> : <Menu />}
      </button>
      <nav className={mobileOpen ? 'nav open' : 'nav'} aria-label="Primary navigation">
        {navItems.map(({ id, label, icon: Icon }) => <button key={id} className={page === id ? 'nav-item active' : 'nav-item'} onClick={() => navigate(id)} aria-current={page === id ? 'page' : undefined}><Icon size={16} />{label}</button>)}
      </nav>
      <div className="profile-menu">
        <span className="avatar">{user.name.slice(0, 1).toUpperCase()}</span>
        <span className="profile-name">{user.name}</span>
      </div>
    </header>
    <main>{children}</main>
    <footer>
      <span className="footer-brand">HerHealth</span>
      <span>Private by design. Your health data belongs to you.</span>
      <span>Educational support, not a diagnosis.</span>
    </footer>
    <button className="chat-fab" onClick={onOpenChat} aria-label="Open Nova health guide"><Bot size={20} /><span>Ask Nova</span></button>
    {toast && <div className={`toast ${toast.type || ''}`} role="status">{toast.message}</div>}
  </div>;
}

export function PageIntro({ eyebrow, title, copy, icon, actions }) {
  return <section className="page-intro">
    <div className="page-intro-copy"><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{copy}</p>{actions && <div className="intro-actions">{actions}</div>}</div>
    <div className="intro-bloom" aria-hidden="true"><span>{icon}</span><i>✿</i><i>❀</i></div>
  </section>;
}

export function Modal({ title, onClose, children, wide = false }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <header className="modal-header"><div><span className="petal-dot" /><h2 id="modal-title">{title}</h2></div><button className="icon-button" onClick={onClose} aria-label="Close dialog"><X size={18} /></button></header>
      {children}
    </section>
  </div>;
}

export function EmptyState({ icon, title, copy, action }) {
  return <div className="empty-state">
    <div className="empty-flower" aria-hidden="true">{icon || '❀'}</div>
    <h3>{title}</h3><p>{copy}</p>{action}
  </div>;
}

export function ErrorState({ title = 'Something needs another try', copy, action }) {
  return <div className="empty-state error-state" role="alert">
    <div className="empty-flower" aria-hidden="true">!</div>
    <h3>{title}</h3><p>{copy}</p>{action}
  </div>;
}

export function LoadingState({ label = 'Gathering your garden' }) {
  return <div className="loading-state" role="status"><span className="loading-bloom">✿</span><span>{label}...</span></div>;
}
