import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const databasePath = path.join(os.tmpdir(), `femnova-test-${process.pid}.db`);
process.env.DATABASE_PATH = databasePath;
process.env.NODE_ENV = 'test';

const { createApp } = await import('../server/app.js');
const { closeDatabase } = await import('../server/database.js');

let server;
let baseUrl;
let adminCookie;
let memberCookie;
let memberToken;
let bootstrappedCookie;

async function request(route, { cookie, bearer, method = 'GET', body } = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const payload = response.status === 204 ? null : await response.json();
  return { response, payload, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}

before(async () => {
  server = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.closeIdleConnections?.();
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  closeDatabase();
  for (const suffix of ['', '-shm', '-wal']) fs.rmSync(`${databasePath}${suffix}`, { force: true });
});

test('health endpoint is public', async () => {
  const { response, payload } = await request('/api/health');
  assert.equal(response.status, 200);
  assert.equal(payload.status, 'ok');
});

test('unknown api routes return a JSON 404 instead of the SPA shell', async () => {
  const { response, payload } = await request('/api/not-a-real-route');
  assert.equal(response.status, 404);
  assert.equal(payload.error.code, 'NOT_FOUND');
});

test('bootstrap creates or resumes a local session without showing a login screen', async () => {
  const first = await request('/api/auth/bootstrap', {
    method: 'POST',
    body: { deviceId: 'devicealpha001', timezone: 'UTC' }
  });
  assert.equal(first.response.status, 200);
  assert.equal(first.payload.autoProvisioned, true);
  assert.equal(first.payload.user.email, 'local-devicealpha001@herhealth.local');
  assert.equal(first.payload.user.role, 'platform_admin');
  bootstrappedCookie = first.cookie;
  adminCookie = first.cookie;

  const second = await request('/api/auth/bootstrap', {
    method: 'POST',
    body: { deviceId: 'devicealpha001', timezone: 'UTC' }
  });
  assert.equal(second.response.status, 200);
  assert.equal(second.payload.user.id, first.payload.user.id);
});

test('registration creates isolated accounts after the local bootstrap admin exists', async () => {
  const first = await request('/api/auth/register', {
    method: 'POST',
    body: { name: 'Ada', email: 'ada@example.test', password: 'SecurePass123', healthDataConsent: true, timezone: 'UTC' }
  });
  assert.equal(first.response.status, 201);
  assert.equal(first.payload.user.role, 'user');

  const second = await request('/api/auth/register', {
    method: 'POST',
    body: { name: 'Bea', email: 'bea@example.test', password: 'SecurePass456', healthDataConsent: true, timezone: 'UTC' }
  });
  assert.equal(second.response.status, 201);
  assert.equal(second.payload.user.role, 'user');
  memberCookie = second.cookie;
  memberToken = second.payload.session.token;
});

test('bearer auth supports split deployments', async () => {
  const session = await request('/api/auth/me', { bearer: memberToken });
  assert.equal(session.response.status, 200);
  assert.equal(session.payload.user.email, 'bea@example.test');
});

test('cycle logs calculate phase and remain private to their owner', async () => {
  const saved = await request('/api/cycle', {
    cookie: adminCookie,
    method: 'POST',
    body: { date: '2026-09-01', flow: 'heavy', mood: 'Tender', symptoms: ['cramps', 'fatigue'], sleepHours: 7.25, sleepQuality: 3, energy: 2, discharge: 'Dry', basalTemperature: 36.45, notes: 'Test log' }
  });
  assert.equal(saved.response.status, 201);
  assert.equal(saved.payload.log.symptoms[0], 'cramps');
  assert.equal(saved.payload.prediction.values.length, 4);

  const owner = await request('/api/cycle', { cookie: adminCookie });
  const other = await request('/api/cycle', { cookie: memberCookie });
  assert.equal(owner.payload.logs.length, 1);
  assert.equal(other.payload.logs.length, 0);
});

test('lab results preserve exact range evaluation and crossed-bound delta', async () => {
  const saved = await request('/api/labs', {
    cookie: adminCookie,
    method: 'POST',
    body: { date: '2026-09-10', population: 'adult_non_pregnant', comments: 'Routine panel', values: { ft3: 3.2, tsh: 4.5, hb: 10 } }
  });
  assert.equal(saved.response.status, 201);
  const hb = saved.payload.result.values.find((value) => value.code === 'hb');
  const tsh = saved.payload.result.values.find((value) => value.code === 'tsh');
  assert.equal(hb.status, 'out_of_range');
  assert.equal(hb.direction, 'low');
  assert.equal(hb.delta, 2);
  assert.equal(tsh.direction, 'high');
  assert.equal(typeof hb.range.version, 'number');

  const other = await request('/api/labs', { cookie: memberCookie });
  assert.equal(other.payload.results.length, 0);
});

test('prediction service creates versioned, confidence-scored estimates', async () => {
  const result = await request('/api/predictions', { cookie: adminCookie, method: 'POST', body: {} });
  assert.equal(result.response.status, 201);
  assert.equal(result.payload.modelVersion, 'baseline-1.0.0');
  assert.equal(result.payload.values.length, 4);
  assert.ok(result.payload.values.every((value) => value.confidence > 0 && value.confidence <= 1));
  assert.match(result.payload.disclaimer, /not a diagnosis/i);
});

test('community supports anonymous posting, comments, likes, and moderation reports', async () => {
  const created = await request('/api/community', {
    cookie: adminCookie,
    method: 'POST',
    body: { topic: 'Cycle care', body: 'A private test conversation', anonymous: true }
  });
  assert.equal(created.response.status, 201);
  const postId = created.payload.post.id;

  const feed = await request('/api/community', { cookie: memberCookie });
  const post = feed.payload.posts.find((item) => item.id === postId);
  assert.equal(post.author, 'Anonymous member');
  assert.equal(post.internalAuthor, undefined);

  const liked = await request(`/api/community/${postId}/like`, { cookie: memberCookie, method: 'POST', body: {} });
  assert.equal(liked.payload.likes, 1);
  const commented = await request(`/api/community/${postId}/comments`, { cookie: memberCookie, method: 'POST', body: { body: 'A supportive reply', anonymous: false } });
  assert.equal(commented.response.status, 201);
  const reported = await request(`/api/community/${postId}/report`, { cookie: memberCookie, method: 'POST', body: { reason: 'Testing moderator review' } });
  assert.equal(reported.payload.status, 'open');

  const queue = await request('/api/moderation/reports', { cookie: adminCookie });
  assert.equal(queue.payload.reports.length, 1);
});

test('chatbot grounds health answers in approved citations and escalates urgent text', async () => {
  const grounded = await request('/api/chat', { cookie: memberCookie, method: 'POST', body: { question: 'How does TSH relate to thyroid labs?' } });
  assert.equal(grounded.response.status, 200);
  assert.equal(grounded.payload.grounded, true);
  assert.ok(grounded.payload.citations.length > 0);

  const fertility = await request('/api/chat', { cookie: memberCookie, method: 'POST', body: { question: 'How can I avoid pregnancy around ovulation?' } });
  assert.equal(fertility.response.status, 200);
  assert.ok(fertility.payload.citations.length > 0);

  const urgent = await request('/api/chat', { cookie: memberCookie, method: 'POST', body: { question: 'I am fainting and have severe bleeding' } });
  assert.equal(urgent.payload.urgent, true);
  assert.match(urgent.payload.answer, /urgent medical care/i);
});

test('settings require explicit personalization choice and dashboard receives lab flags', async () => {
  const updated = await request('/api/settings', {
    cookie: adminCookie,
    method: 'PUT',
    body: { population: 'adult_non_pregnant', timezone: 'UTC', averageCycleLength: 29, animationsEnabled: false, chatbotPersonalization: true, anonymousByDefault: true, notifications: { cycle: true, community: false } }
  });
  assert.equal(updated.payload.profile.animationsEnabled, false);
  assert.equal(updated.payload.profile.chatbotPersonalization, true);

  const dashboard = await request('/api/dashboard?date=2026-09-12', { cookie: adminCookie });
  assert.equal(dashboard.payload.labSummary.source, 'actual');
  assert.equal(dashboard.payload.labSummary.flagged, 2);
  assert.equal(dashboard.payload.cycle.averageLength, 29);
  assert.match(dashboard.payload.fertility.prevention, /contraception/i);
  assert.ok(['Low', 'Lower', 'Moderate', 'Higher', 'Unknown'].includes(dashboard.payload.fertility.chance));
  assert.ok(dashboard.payload.prediction?.values?.length >= 0);
});

test('auto-provisioned local profiles can be reset without a password', async () => {
  const local = await request('/api/auth/bootstrap', {
    method: 'POST',
    body: { deviceId: 'resetdevice001', timezone: 'UTC' }
  });
  assert.equal(local.response.status, 200);

  const deleted = await request('/api/account', {
    cookie: local.cookie,
    method: 'DELETE',
    body: { confirm: 'RESET_LOCAL_PROFILE' }
  });
  assert.equal(deleted.response.status, 204);
});
