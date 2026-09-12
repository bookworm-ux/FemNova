const PAGE_PATHS = {
  home: '/',
  labs: '/labs',
  community: '/community',
  settings: '/settings'
};

function normalizePath(pathname = '/') {
  const trimmed = String(pathname || '/').replace(/\/+$/, '');
  return trimmed || '/';
}

export function isoToday() {
  const date = new Date();
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

export function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

export function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

export function isStrongPassword(value) {
  const password = String(value || '');
  return password.length >= 10 && /[A-Za-z]/.test(password) && /\d/.test(password);
}

export function pageFromLocation(locationLike) {
  const location = locationLike || (typeof window !== 'undefined' ? window.location : { pathname: '/', hash: '' });
  const legacyHash = String(location.hash || '').replace(/^#/, '');
  if (PAGE_PATHS[legacyHash]) return legacyHash;
  const pathname = normalizePath(location.pathname);
  return Object.entries(PAGE_PATHS).find(([, href]) => normalizePath(href) === pathname)?.[0] || 'home';
}

export function hrefForPage(page) {
  return PAGE_PATHS[page] || PAGE_PATHS.home;
}

export function navigateToPage(page, { replace = false } = {}) {
  if (typeof window === 'undefined') return;
  const href = hrefForPage(page);
  const currentPath = normalizePath(window.location.pathname);
  const nextPath = normalizePath(href);
  const nextUrl = nextPath === '/' ? '/' : nextPath;
  const method = replace ? 'replaceState' : 'pushState';
  if (currentPath === nextPath && !window.location.hash) return;
  window.history[method](null, '', nextUrl);
}

export function formatDate(value, options = {}) {
  if (!value) return 'Not enough data';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC', ...options }).format(new Date(`${value.slice(0, 10)}T00:00:00Z`));
}

export function formatMonth(date) {
  return new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(date);
}

export function monthGrid(anchor) {
  const year = anchor.getFullYear();
  const month = anchor.getMonth();
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7;
  const cells = [];
  for (let index = 0; index < 42; index += 1) {
    const date = new Date(year, month, index - offset + 1);
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    cells.push({ date, iso: local.toISOString().slice(0, 10), currentMonth: date.getMonth() === month });
  }
  return cells;
}

export function addDays(date, count) {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + count);
  return next.toISOString().slice(0, 10);
}

export function daysBetween(start, end) {
  return Math.round((new Date(`${end}T00:00:00Z`) - new Date(`${start}T00:00:00Z`)) / 86400000);
}

export function phaseForDate(date, cycle) {
  if (!cycle?.lastPeriodStart) return 'Unknown';
  const day = ((daysBetween(cycle.lastPeriodStart, date) % cycle.averageLength) + cycle.averageLength) % cycle.averageLength + 1;
  if (day <= 5) return 'Menstrual';
  if (day < cycle.ovulationDay - 2) return 'Follicular';
  if (day <= cycle.ovulationDay + 1) return 'Ovulation';
  return 'Luteal';
}

export function statusLabel(status) {
  return status === 'out_of_range' ? 'Out of range' : status === 'borderline' ? 'Borderline' : 'Normal';
}

export function populationLabel(value) {
  return {
    adult_non_pregnant: 'Adult, non-pregnant',
    pregnancy_t1: 'Pregnancy, trimester 1',
    pregnancy_t2: 'Pregnancy, trimester 2',
    pregnancy_t3: 'Pregnancy, trimester 3',
    adolescent: 'Adolescent'
  }[value] || value;
}
