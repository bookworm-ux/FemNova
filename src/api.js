const TOKEN_KEY = 'herhealth_session_token';
const configuredBase = String(import.meta.env.VITE_API_BASE_URL || '').trim().replace(/\/$/, '');
const API_ROOT = configuredBase
  ? `${configuredBase.endsWith('/api') ? configuredBase : `${configuredBase}/api`}`
  : '/api';

export class ApiError extends Error {
  constructor(message, status, code, fields) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

function loadSessionToken() {
  try {
    return window.localStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

function storeSessionToken(token) {
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* Ignore storage failures and let cookie auth continue if available. */
  }
}

function authHeaders() {
  const token = typeof window === 'undefined' ? '' : loadSessionToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function parseResponse(response) {
  if (response.status === 204) return null;
  const contentType = response.headers.get('content-type') || '';
  return contentType.includes('application/json') ? response.json() : response.text();
}

async function performRequest(path, options = {}) {
  const headers = {
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...authHeaders(),
    ...options.headers
  };
  try {
    return await fetch(`${API_ROOT}${path}`, {
      credentials: 'include',
      ...options,
      headers
    });
  } catch (error) {
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    throw new ApiError(
      offline
        ? 'You appear to be offline. Reconnect and try again.'
        : 'HerHealth could not reach the server. Please try again.',
      0,
      offline ? 'OFFLINE' : 'NETWORK_ERROR'
    );
  }
}

export async function api(path, options = {}) {
  const response = await performRequest(path, options);
  const payload = await parseResponse(response);
  if (!response.ok) {
    const error = payload?.error;
    if (response.status === 401) storeSessionToken('');
    throw new ApiError(error?.message || 'HerHealth could not complete that request.', response.status, error?.code, error?.fields);
  }
  if ((path === '/auth/login' || path === '/auth/register' || path === '/auth/bootstrap') && payload?.session?.token) storeSessionToken(payload.session.token);
  if (path === '/auth/logout') storeSessionToken('');
  return payload;
}

export async function downloadExport() {
  const response = await performRequest('/account/export');
  if (!response.ok) {
    const payload = await parseResponse(response);
    const error = payload?.error;
    if (response.status === 401) storeSessionToken('');
    throw new ApiError(error?.message || 'HerHealth could not export your data.', response.status, error?.code, error?.fields);
  }
  const blob = await response.blob();
  const suggested = response.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1] || 'herhealth-export.json';
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = suggested;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => window.URL.revokeObjectURL(url), 1000);
}

export async function openPrescriptionFile(id, originalName = 'document') {
  const response = await performRequest(`/prescriptions/${id}/file`);
  if (!response.ok) {
    const payload = await parseResponse(response);
    const error = payload?.error;
    if (response.status === 401) storeSessionToken('');
    throw new ApiError(error?.message || 'HerHealth could not open that file.', response.status, error?.code, error?.fields);
  }
  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = originalName;
  link.target = '_blank';
  link.rel = 'noreferrer';
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => window.URL.revokeObjectURL(url), 60000);
}
