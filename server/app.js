import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { audit, db, parseJson } from './database.js';
import {
  CORE_TESTS,
  FLOW_LEVELS,
  MOODS,
  POPULATIONS,
  SYMPTOMS,
  evaluateValue,
  generatePrediction,
  getCycleContext,
  getLabResults,
  getLatestPrediction,
  getReferenceRange,
  isIsoDate,
  isUrgentQuestion,
  rankKnowledge,
  serializeLog
} from './health.js';

const scrypt = promisify(scryptCallback);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const uploadRoot = path.join(root, 'uploads');
const SESSION_COOKIE = 'femnova_session';
const SESSION_DAYS = 30;
const ALLOWED_UPLOADS = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp']);
const rateBuckets = new Map();
const allowedOrigins = new Set(
  String(process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
);

fs.mkdirSync(uploadRoot, { recursive: true });

function jsonError(res, status, code, message, fields) {
  return res.status(status).json({ error: { code, message, fields: fields || undefined } });
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function rateLimit(name, limit, windowMs) {
  return (req, res, next) => {
    const key = `${name}:${req.ip}`;
    const now = Date.now();
    const current = rateBuckets.get(key);
    if (!current || current.resetAt < now) {
      rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    current.count += 1;
    if (current.count > limit) return jsonError(res, 429, 'RATE_LIMITED', 'Please wait a moment before trying again.');
    return next();
  };
}

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((part) => part.trim().split('=').map(decodeURIComponent)).filter((part) => part.length === 2));
}

function tokenHash(token) {
  return createHash('sha256').update(token).digest('hex');
}

async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const derived = await scrypt(password, salt, 64);
  return `${salt}:${Buffer.from(derived).toString('hex')}`;
}

async function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const derived = Buffer.from(await scrypt(password, salt, 64));
  const expected = Buffer.from(hash, 'hex');
  return expected.length === derived.length && timingSafeEqual(expected, derived);
}

function publicUser(row) {
  return { id: row.id, email: row.email, name: row.name, role: row.role, autoProvisioned: Boolean(row.auto_provisioned), createdAt: row.created_at };
}

function localEmailForDevice(deviceId) {
  return `local-${deviceId}@herhealth.local`;
}

function setSession(res, userId) {
  const token = randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000);
  db.prepare(`
    INSERT INTO fn_sessions (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)
  `).run(randomUUID(), userId, tokenHash(token), expires.toISOString());
  const crossOriginCookie = allowedOrigins.size > 0 && process.env.NODE_ENV === 'production';
  const sameSite = crossOriginCookie ? 'None' : 'Strict';
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=${sameSite}; Path=/; Max-Age=${SESSION_DAYS * 86400}${secure}`);
  return { token, expiresAt: expires.toISOString() };
}

function clearSession(res) {
  const crossOriginCookie = allowedOrigins.size > 0 && process.env.NODE_ENV === 'production';
  const sameSite = crossOriginCookie ? 'None' : 'Strict';
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=${sameSite}; Path=/; Max-Age=0${secure}`);
}

function requireAuth(req, res, next) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE] || req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) return jsonError(res, 401, 'AUTH_REQUIRED', 'Please sign in to continue.');
  const session = db.prepare(`
    SELECT s.id AS session_id, s.user_id, s.expires_at, u.*
    FROM fn_sessions s JOIN fn_users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND u.deleted_at IS NULL
  `).get(tokenHash(token));
  if (!session || new Date(session.expires_at) <= new Date()) {
    if (session) db.prepare('DELETE FROM fn_sessions WHERE id = ?').run(session.session_id);
    clearSession(res);
    return jsonError(res, 401, 'SESSION_EXPIRED', 'Your session has expired. Please sign in again.');
  }
  req.user = session;
  req.sessionToken = token;
  db.prepare('UPDATE fn_sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?').run(session.session_id);
  return next();
}

function requireRole(...roles) {
  return (req, res, next) => roles.includes(req.user.role)
    ? next()
    : jsonError(res, 403, 'FORBIDDEN', 'You do not have permission for this action.');
}

function profileFor(userId) {
  const profile = db.prepare('SELECT * FROM fn_profiles WHERE user_id = ?').get(userId);
  if (!profile) {
    return {
      population: 'adult_non_pregnant',
      timezone: 'UTC',
      averageCycleLength: 28,
      animationsEnabled: true,
      chatbotPersonalization: false,
      anonymousByDefault: false,
      lastPredictionAt: null,
      notifications: {
        cycle: true,
        community: true
      }
    };
  }
  return {
    population: profile.population,
    timezone: profile.timezone,
    averageCycleLength: profile.average_cycle_length,
    animationsEnabled: Boolean(profile.animations_enabled),
    chatbotPersonalization: Boolean(profile.chatbot_personalization),
    anonymousByDefault: Boolean(profile.anonymous_by_default),
    lastPredictionAt: profile.last_prediction_at || null,
    notifications: {
      cycle: Boolean(profile.notification_cycle),
      community: Boolean(profile.notification_community)
    }
  };
}

function latestActivityAt(userId) {
  const latestLog = db.prepare('SELECT MAX(updated_at) AS updated_at FROM fn_daily_logs WHERE user_id = ?').get(userId)?.updated_at;
  const latestLab = db.prepare('SELECT MAX(updated_at) AS updated_at FROM fn_lab_results WHERE user_id = ?').get(userId)?.updated_at;
  return [latestLog, latestLab].filter(Boolean).sort().at(-1) || null;
}

function ensureFreshPrediction(userId) {
  const cycle = getCycleContext(userId);
  if (cycle.trackedDays < 1) return getLatestPrediction(userId);
  const prediction = getLatestPrediction(userId);
  const latestActivity = latestActivityAt(userId);
  if (!prediction) {
    return generatePrediction(userId).prediction;
  }
  if (latestActivity && new Date(prediction.generatedAt) < new Date(latestActivity)) {
    return generatePrediction(userId).prediction;
  }
  return prediction;
}

function listRanges(population, includeInactive = false) {
  return db.prepare(`
    SELECT rr.*, lt.code, lt.name, lt.short_name, lt.default_unit, lt.category, lt.is_core
    FROM fn_reference_ranges rr JOIN fn_lab_tests lt ON lt.id = rr.test_id
    WHERE rr.population = ? ${includeInactive ? '' : 'AND rr.active = 1'}
    ORDER BY lt.is_core DESC, lt.name, rr.version DESC
  `).all(population).map((range) => ({
    id: range.id,
    code: range.code,
    name: range.name,
    shortName: range.short_name,
    category: range.category,
    core: Boolean(range.is_core),
    population: range.population,
    unit: range.unit,
    low: range.low,
    high: range.high,
    borderlineMargin: range.borderline_margin,
    version: range.version,
    sourceNote: range.source_note,
    effectiveFrom: range.effective_from,
    active: Boolean(range.active)
  }));
}

function communityPost(row, viewer) {
  const canSeeIdentity = !row.anonymous || ['moderator', 'platform_admin'].includes(viewer.role);
  const comments = db.prepare(`
    SELECT c.*, u.name FROM fn_community_comments c JOIN fn_users u ON u.id = c.user_id
    WHERE c.post_id = ? AND c.deleted_at IS NULL AND c.hidden = 0 ORDER BY c.created_at ASC
  `).all(row.id).map((comment) => ({
    id: comment.id,
    body: comment.body,
    author: comment.anonymous ? 'Anonymous member' : comment.name,
    anonymous: Boolean(comment.anonymous),
    createdAt: comment.created_at
  }));
  return {
    id: row.id,
    topic: row.topic,
    body: row.body,
    author: row.anonymous ? 'Anonymous member' : row.name,
    internalAuthor: canSeeIdentity ? row.name : undefined,
    anonymous: Boolean(row.anonymous),
    likes: row.likes,
    liked: Boolean(row.liked),
    comments,
    createdAt: row.created_at
  };
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    const { origin } = req.headers;
    if (origin && allowedOrigins.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
      res.setHeader('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') return res.status(204).end();
    return next();
  });
  app.use(express.json({ limit: '8mb' }));
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
  });

  app.get('/api/health', (req, res) => res.json({ status: 'ok', service: 'herhealth-api' }));

  app.post('/api/auth/register', rateLimit('register', 8, 15 * 60 * 1000), asyncRoute(async (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    const name = String(req.body.name || '').trim();
    const password = String(req.body.password || '');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return jsonError(res, 400, 'INVALID_EMAIL', 'Enter a valid email address.');
    if (name.length < 2 || name.length > 60) return jsonError(res, 400, 'INVALID_NAME', 'Name must be between 2 and 60 characters.');
    if (password.length < 10 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) return jsonError(res, 400, 'WEAK_PASSWORD', 'Use at least 10 characters with a letter and number.');
    if (!req.body.healthDataConsent) return jsonError(res, 400, 'CONSENT_REQUIRED', 'Health-data consent is required to create an account.');
    if (db.prepare('SELECT 1 FROM fn_users WHERE email = ?').get(email)) return jsonError(res, 409, 'EMAIL_EXISTS', 'An account with this email already exists.');
    const userId = randomUUID();
    const existingUsers = db.prepare('SELECT COUNT(*) AS count FROM fn_users WHERE deleted_at IS NULL').get().count;
    const role = existingUsers === 0 ? 'platform_admin' : 'user';
    const passwordHash = await hashPassword(password);
    db.transaction(() => {
        db.prepare('INSERT INTO fn_users (id, email, password_hash, name, role) VALUES (?, ?, ?, ?, ?)').run(userId, email, passwordHash, name, role);
      db.prepare('INSERT INTO fn_profiles (user_id, timezone) VALUES (?, ?)').run(userId, String(req.body.timezone || 'UTC').slice(0, 60));
      db.prepare('INSERT INTO fn_consents (id, user_id, consent_type, granted, policy_version) VALUES (?, ?, ?, 1, ?)').run(randomUUID(), userId, 'health_data_processing', '2026-09');
      audit(userId, 'auth.register', 'user', userId, { role });
    })();
    const session = setSession(res, userId);
    const user = db.prepare('SELECT * FROM fn_users WHERE id = ?').get(userId);
    return res.status(201).json({ user: publicUser(user), profile: profileFor(userId), bootstrapAdmin: role === 'platform_admin', session });
  }));

  app.post('/api/auth/login', rateLimit('login', 15, 15 * 60 * 1000), asyncRoute(async (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    const user = db.prepare('SELECT * FROM fn_users WHERE email = ? AND deleted_at IS NULL').get(email);
    if (!user || !(await verifyPassword(String(req.body.password || ''), user.password_hash))) {
      return jsonError(res, 401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
    }
    const session = setSession(res, user.id);
    audit(user.id, 'auth.login', 'session');
    return res.json({ user: publicUser(user), profile: profileFor(user.id), session });
  }));

  app.post('/api/auth/logout', requireAuth, (req, res) => {
    db.prepare('DELETE FROM fn_sessions WHERE token_hash = ?').run(tokenHash(req.sessionToken));
    clearSession(res);
    audit(req.user.id, 'auth.logout', 'session', req.user.session_id);
    res.status(204).end();
  });

  app.get('/api/auth/me', requireAuth, (req, res) => {
    res.json({ user: publicUser(req.user), profile: profileFor(req.user.id) });
  });

  app.post('/api/auth/bootstrap', rateLimit('bootstrap', 30, 60 * 60 * 1000), asyncRoute(async (req, res) => {
    const deviceId = String(req.body.deviceId || '').trim().toLowerCase();
    if (!/^[a-z0-9_-]{12,80}$/.test(deviceId)) {
      return jsonError(res, 400, 'INVALID_DEVICE_ID', 'A valid local device identifier is required.');
    }
    const timezone = String(req.body.timezone || 'UTC').slice(0, 60) || 'UTC';
    let user = db.prepare('SELECT * FROM fn_users WHERE email = ? AND deleted_at IS NULL').get(localEmailForDevice(deviceId));
    let bootstrapAdmin = false;

    if (!user) {
      const userId = randomUUID();
      const existingUsers = db.prepare('SELECT COUNT(*) AS count FROM fn_users WHERE deleted_at IS NULL').get().count;
      const role = existingUsers === 0 ? 'platform_admin' : 'user';
      const passwordHash = await hashPassword(randomBytes(24).toString('hex'));
      db.transaction(() => {
        db.prepare('INSERT INTO fn_users (id, email, password_hash, name, role) VALUES (?, ?, ?, ?, ?)').run(
          userId,
          localEmailForDevice(deviceId),
          passwordHash,
          'HerHealth Member',
          role
        );
        db.prepare('UPDATE fn_users SET auto_provisioned = 1 WHERE id = ?').run(userId);
        db.prepare('INSERT INTO fn_profiles (user_id, timezone) VALUES (?, ?)').run(userId, timezone);
        db.prepare('INSERT INTO fn_consents (id, user_id, consent_type, granted, policy_version) VALUES (?, ?, ?, 1, ?)').run(
          randomUUID(),
          userId,
          'health_data_processing',
          '2026-09'
        );
        audit(userId, 'auth.bootstrap_create', 'user', userId, { role, deviceId });
      })();
      user = db.prepare('SELECT * FROM fn_users WHERE id = ?').get(userId);
      bootstrapAdmin = role === 'platform_admin';
    } else {
      db.prepare('UPDATE fn_profiles SET timezone = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?').run(timezone, user.id);
      audit(user.id, 'auth.bootstrap_resume', 'user', user.id, { deviceId });
    }

    const session = setSession(res, user.id);
    return res.json({ user: publicUser(user), profile: profileFor(user.id), bootstrapAdmin, autoProvisioned: true, session });
  }));

  app.get('/api/dashboard', requireAuth, (req, res) => {
    const today = isIsoDate(req.query.date) ? req.query.date : new Date().toISOString().slice(0, 10);
    const latest = db.prepare('SELECT * FROM fn_daily_logs WHERE user_id = ? AND date <= ? ORDER BY date DESC LIMIT 1').get(req.user.id, today);
    const cycle = getCycleContext(req.user.id, today);
    const labs = getLabResults(req.user.id);
    const prediction = ensureFreshPrediction(req.user.id);
    const latestValues = labs[0]?.values || prediction?.values || [];
    const source = labs[0] ? 'actual' : prediction ? 'predicted' : null;
    const labSummary = {
      source,
      date: labs[0]?.date || prediction?.generatedAt || null,
      flagged: latestValues.filter((value) => value.status !== 'normal').length,
      values: latestValues.filter((value) => CORE_TESTS.includes(value.code))
    };
    const tips = {
      Menstrual: { nutrition: 'Pair iron-rich foods with vitamin C and keep meals regular.', movement: 'Choose restorative movement or rest based on how you feel.', prompt: 'What would make today feel gentler?' },
      Follicular: { nutrition: 'Build steady energy with fibre, protein, and hydration.', movement: 'Energy may rise; increase intensity only if it feels good.', prompt: 'What feels newly possible this week?' },
      Ovulation: { nutrition: 'Hydration and balanced meals support this higher-energy window.', movement: 'If energy is high, this may be a comfortable time for stronger movement.', prompt: 'Make room for something that helps you bloom.' },
      Luteal: { nutrition: 'Regular snacks and magnesium-rich foods may support steadier energy.', movement: 'Try moderate movement, stretching, or extra recovery.', prompt: 'Lower the bar and choose one caring thing.' },
      Unknown: { nutrition: 'Log a period start to unlock phase-aware guidance.', movement: 'Let comfort and energy guide today’s movement.', prompt: 'Begin with one small check-in.' }
    };
    res.json({ today, latest: serializeLog(latest), cycle, fertility: cycle.fertility, labSummary, prediction, tips: tips[cycle.phase] });
  });

  app.get('/api/cycle', requireAuth, (req, res) => {
    const from = isIsoDate(req.query.from) ? req.query.from : '1900-01-01';
    const to = isIsoDate(req.query.to) ? req.query.to : '2999-12-31';
    const logs = db.prepare(`
      SELECT * FROM fn_daily_logs WHERE user_id = ? AND date BETWEEN ? AND ? ORDER BY date ASC
    `).all(req.user.id, from, to).map(serializeLog);
    res.json({ logs, options: { flow: FLOW_LEVELS, moods: MOODS, symptoms: SYMPTOMS } });
  });

  app.post('/api/cycle', requireAuth, (req, res) => {
    const { date } = req.body;
    if (!isIsoDate(date)) return jsonError(res, 400, 'INVALID_DATE', 'Use a valid date in YYYY-MM-DD format.');
    const flow = FLOW_LEVELS.includes(req.body.flow) ? req.body.flow : 'none';
    const mood = MOODS.includes(req.body.mood) ? req.body.mood : null;
    const symptoms = Array.isArray(req.body.symptoms) ? req.body.symptoms.filter((item) => SYMPTOMS.includes(item)).slice(0, 12) : [];
    const energy = Number(req.body.energy);
    const sleepHours = req.body.sleepHours === '' || req.body.sleepHours == null ? null : Number(req.body.sleepHours);
    const sleepQuality = req.body.sleepQuality === '' || req.body.sleepQuality == null ? null : Number(req.body.sleepQuality);
    const basalTemperature = req.body.basalTemperature === '' || req.body.basalTemperature == null ? null : Number(req.body.basalTemperature);
    if (Number.isFinite(energy) && (energy < 1 || energy > 5)) return jsonError(res, 400, 'INVALID_ENERGY', 'Energy must be from 1 to 5.');
    if (sleepHours !== null && (!Number.isFinite(sleepHours) || sleepHours < 0 || sleepHours > 24)) return jsonError(res, 400, 'INVALID_SLEEP', 'Sleep must be from 0 to 24 hours.');
    if (basalTemperature !== null && (!Number.isFinite(basalTemperature) || basalTemperature < 34 || basalTemperature > 43)) return jsonError(res, 400, 'INVALID_TEMPERATURE', 'Temperature must be from 34°C to 43°C.');
    const existing = db.prepare('SELECT id FROM fn_daily_logs WHERE user_id = ? AND date = ?').get(req.user.id, date);
    const id = existing?.id || randomUUID();
    db.prepare(`
      INSERT INTO fn_daily_logs
        (id, user_id, date, flow, mood, symptoms, sleep_hours, sleep_quality, energy, discharge, basal_temperature, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, date) DO UPDATE SET
        flow = excluded.flow, mood = excluded.mood, symptoms = excluded.symptoms,
        sleep_hours = excluded.sleep_hours, sleep_quality = excluded.sleep_quality,
        energy = excluded.energy, discharge = excluded.discharge,
        basal_temperature = excluded.basal_temperature, notes = excluded.notes,
        updated_at = CURRENT_TIMESTAMP
    `).run(
      id, req.user.id, date, flow, mood, JSON.stringify(symptoms), sleepHours,
      Number.isFinite(sleepQuality) ? sleepQuality : null, Number.isFinite(energy) ? energy : null,
      String(req.body.discharge || '').slice(0, 60) || null, basalTemperature, String(req.body.notes || '').slice(0, 1000) || null
    );
    audit(req.user.id, existing ? 'cycle.update' : 'cycle.create', 'daily_log', id, { date });
    const saved = db.prepare('SELECT * FROM fn_daily_logs WHERE id = ?').get(id);
    const prediction = ensureFreshPrediction(req.user.id);
    return res.status(existing ? 200 : 201).json({ log: serializeLog(saved), cycle: getCycleContext(req.user.id, date), prediction });
  });

  app.delete('/api/cycle/:id', requireAuth, (req, res) => {
    const result = db.prepare('DELETE FROM fn_daily_logs WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
    if (!result.changes) return jsonError(res, 404, 'NOT_FOUND', 'Cycle log not found.');
    audit(req.user.id, 'cycle.delete', 'daily_log', req.params.id);
    res.status(204).end();
  });

  app.get('/api/reference-ranges', requireAuth, (req, res) => {
    const population = POPULATIONS.includes(req.query.population) ? req.query.population : profileFor(req.user.id).population;
    res.json({ population, populations: POPULATIONS, ranges: listRanges(population, ['clinical_admin', 'platform_admin'].includes(req.user.role)) });
  });

  app.post('/api/reference-ranges', requireAuth, requireRole('clinical_admin', 'platform_admin'), (req, res) => {
    const { code, population, unit, sourceNote, effectiveFrom } = req.body;
    const low = Number(req.body.low);
    const high = Number(req.body.high);
    const borderlineMargin = Number(req.body.borderlineMargin);
    if (!POPULATIONS.includes(population)) return jsonError(res, 400, 'INVALID_POPULATION', 'Select a supported population.');
    if (!Number.isFinite(low) || !Number.isFinite(high) || low >= high) return jsonError(res, 400, 'INVALID_RANGE', 'Low must be below high.');
    if (!isIsoDate(effectiveFrom)) return jsonError(res, 400, 'INVALID_DATE', 'Effective date is required.');
    const test = db.prepare('SELECT * FROM fn_lab_tests WHERE code = ?').get(code);
    if (!test) return jsonError(res, 404, 'TEST_NOT_FOUND', 'Lab test not found.');
    const previous = getReferenceRange(code, population, unit || test.default_unit);
    const version = (previous?.version || 0) + 1;
    const id = randomUUID();
    db.transaction(() => {
      if (previous) db.prepare('UPDATE fn_reference_ranges SET active = 0, effective_to = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(effectiveFrom, previous.id);
      db.prepare(`
        INSERT INTO fn_reference_ranges
          (id, test_id, population, unit, low, high, borderline_margin, version, effective_from, source_note, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, test.id, population, String(unit || test.default_unit), low, high, Number.isFinite(borderlineMargin) && borderlineMargin >= 0 ? borderlineMargin : (high - low) * 0.1, version, effectiveFrom, String(sourceNote || 'Configured by clinical administrator').slice(0, 500), req.user.id);
      audit(req.user.id, 'reference_range.create_version', 'reference_range', id, { code, population, version });
    })();
    res.status(201).json({ range: listRanges(population, true).find((item) => item.id === id) });
  });

  app.get('/api/labs', requireAuth, (req, res) => {
    res.json({ results: getLabResults(req.user.id), prediction: ensureFreshPrediction(req.user.id) });
  });

  app.post('/api/labs', requireAuth, (req, res) => {
    if (!isIsoDate(req.body.date)) return jsonError(res, 400, 'INVALID_DATE', 'A valid result date is required.');
    const population = POPULATIONS.includes(req.body.population) ? req.body.population : profileFor(req.user.id).population;
    const supplied = req.body.values && typeof req.body.values === 'object' ? req.body.values : {};
    const values = Object.entries(supplied).filter(([, value]) => value !== '' && value !== null && value !== undefined);
    if (!values.length) return jsonError(res, 400, 'LAB_VALUE_REQUIRED', 'Enter at least one lab value.');
    const resultId = randomUUID();
    try {
      db.transaction(() => {
        db.prepare(`
          INSERT INTO fn_lab_results (id, user_id, date, population, comments) VALUES (?, ?, ?, ?, ?)
        `).run(resultId, req.user.id, req.body.date, population, String(req.body.comments || '').slice(0, 1000) || null);
        const insert = db.prepare(`
          INSERT INTO fn_lab_values
            (id, result_id, test_id, value, unit, status, direction, delta, reference_range_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const [code, raw] of values) {
          const value = Number(raw);
          if (!Number.isFinite(value) || value < 0 || value > 10000) throw new Error(`Invalid value for ${code}`);
          const range = getReferenceRange(code, population);
          if (!range) throw new Error(`No configured reference range for ${code}`);
          const evaluation = evaluateValue(value, range);
          insert.run(randomUUID(), resultId, range.test_id, value, range.unit, evaluation.status, evaluation.direction, evaluation.delta, range.id);
        }
        audit(req.user.id, 'lab.create', 'lab_result', resultId, { date: req.body.date, tests: values.map(([code]) => code) });
      })();
    } catch (error) {
      return jsonError(res, 400, 'INVALID_LAB_RESULT', error.message);
    }
    const prediction = ensureFreshPrediction(req.user.id);
    res.status(201).json({ result: getLabResults(req.user.id).find((item) => item.id === resultId), prediction });
  });

  app.delete('/api/labs/:id', requireAuth, (req, res) => {
    const result = db.prepare('DELETE FROM fn_lab_results WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
    if (!result.changes) return jsonError(res, 404, 'NOT_FOUND', 'Lab result not found.');
    audit(req.user.id, 'lab.delete', 'lab_result', req.params.id);
    res.status(204).end();
  });

  app.post('/api/predictions', requireAuth, rateLimit('prediction', 20, 60 * 60 * 1000), (req, res) => {
    const result = generatePrediction(req.user.id);
    if (!result.prediction) return jsonError(res, 400, 'PREDICTION_UNAVAILABLE', 'Add some cycle or lab data before generating a prediction.');
    audit(req.user.id, 'prediction.generate', 'lab_prediction', result.prediction.id, { modelVersion: result.prediction.modelVersion });
    res.status(201).json(result.prediction);
  });

  app.get('/api/prescriptions', requireAuth, (req, res) => {
    const rows = db.prepare(`SELECT * FROM fn_prescriptions WHERE user_id = ? ORDER BY created_at DESC`).all(req.user.id);
    res.json({ prescriptions: rows.map((row) => ({ id: row.id, resultId: row.result_id, originalName: row.original_name, mimeType: row.mime_type, sizeBytes: row.size_bytes, comments: row.comments, createdAt: row.created_at })) });
  });

  app.post('/api/prescriptions', requireAuth, rateLimit('upload', 20, 60 * 60 * 1000), (req, res) => {
    const { name, mimeType, dataUrl } = req.body;
    if (!ALLOWED_UPLOADS.has(mimeType)) return jsonError(res, 400, 'INVALID_FILE_TYPE', 'Upload a PDF, PNG, JPEG, or WebP file.');
    const match = String(dataUrl || '').match(/^data:[^;]+;base64,(.+)$/);
    if (!match) return jsonError(res, 400, 'INVALID_FILE', 'The uploaded file could not be read.');
    const buffer = Buffer.from(match[1], 'base64');
    if (!buffer.length || buffer.length > 5 * 1024 * 1024) return jsonError(res, 400, 'FILE_SIZE', 'Files must be smaller than 5 MB.');
    const extension = mimeType === 'application/pdf' ? '.pdf' : mimeType === 'image/png' ? '.png' : mimeType === 'image/webp' ? '.webp' : '.jpg';
    const id = randomUUID();
    const storageName = `${id}${extension}`;
    fs.writeFileSync(path.join(uploadRoot, storageName), buffer, { mode: 0o600 });
    db.prepare(`
      INSERT INTO fn_prescriptions (id, user_id, result_id, original_name, mime_type, size_bytes, storage_name, comments)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, req.user.id, req.body.resultId || null, String(name || 'Prescription').slice(0, 160), mimeType, buffer.length, storageName, String(req.body.comments || '').slice(0, 1000) || null);
    audit(req.user.id, 'prescription.upload', 'prescription', id, { mimeType, sizeBytes: buffer.length });
    res.status(201).json({ prescription: { id, originalName: name, mimeType, sizeBytes: buffer.length } });
  });

  app.get('/api/prescriptions/:id/file', requireAuth, (req, res) => {
    const file = db.prepare('SELECT * FROM fn_prescriptions WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!file) return jsonError(res, 404, 'NOT_FOUND', 'Prescription not found.');
    res.type(file.mime_type);
    res.setHeader('Content-Disposition', `inline; filename="${file.original_name.replace(/["\r\n]/g, '')}"`);
    return res.sendFile(path.join(uploadRoot, file.storage_name));
  });

  app.get('/api/community', requireAuth, (req, res) => {
    const topic = String(req.query.topic || 'All');
    const search = String(req.query.search || '').trim();
    const conditions = ['p.deleted_at IS NULL', 'p.hidden = 0'];
    const params = [req.user.id];
    if (topic !== 'All') { conditions.push('p.topic = ?'); params.push(topic); }
    if (search) { conditions.push('(p.body LIKE ? OR p.topic LIKE ?)'); params.push(`%${search}%`, `%${search}%`); }
    const rows = db.prepare(`
      SELECT p.*, u.name,
        (SELECT COUNT(*) FROM fn_community_likes l WHERE l.post_id = p.id) AS likes,
        EXISTS(SELECT 1 FROM fn_community_likes l WHERE l.post_id = p.id AND l.user_id = ?) AS liked
      FROM fn_community_posts p JOIN fn_users u ON u.id = p.user_id
      WHERE ${conditions.join(' AND ')} ORDER BY p.created_at DESC LIMIT 100
    `).all(...params);
    const topics = db.prepare('SELECT DISTINCT topic FROM fn_community_posts WHERE deleted_at IS NULL AND hidden = 0 ORDER BY topic').all().map((row) => row.topic);
    res.json({ posts: rows.map((row) => communityPost(row, req.user)), topics });
  });

  app.post('/api/community', requireAuth, rateLimit('community-post', 20, 60 * 60 * 1000), (req, res) => {
    const body = String(req.body.body || '').trim();
    const topic = String(req.body.topic || 'General').trim().slice(0, 40);
    if (body.length < 3 || body.length > 3000) return jsonError(res, 400, 'INVALID_POST', 'Posts must be between 3 and 3,000 characters.');
    const id = randomUUID();
    db.prepare(`INSERT INTO fn_community_posts (id, user_id, topic, body, anonymous) VALUES (?, ?, ?, ?, ?)`).run(id, req.user.id, topic, body, req.body.anonymous ? 1 : 0);
    audit(req.user.id, 'community.post_create', 'community_post', id, { anonymous: Boolean(req.body.anonymous) });
    const row = db.prepare(`
      SELECT p.*, u.name, 0 AS likes, 0 AS liked FROM fn_community_posts p JOIN fn_users u ON u.id = p.user_id WHERE p.id = ?
    `).get(id);
    res.status(201).json({ post: communityPost(row, req.user) });
  });

  app.post('/api/community/:id/like', requireAuth, rateLimit('community-like', 120, 60 * 60 * 1000), (req, res) => {
    const post = db.prepare('SELECT id FROM fn_community_posts WHERE id = ? AND deleted_at IS NULL AND hidden = 0').get(req.params.id);
    if (!post) return jsonError(res, 404, 'NOT_FOUND', 'Post not found.');
    const existing = db.prepare('SELECT 1 FROM fn_community_likes WHERE post_id = ? AND user_id = ?').get(post.id, req.user.id);
    if (existing) db.prepare('DELETE FROM fn_community_likes WHERE post_id = ? AND user_id = ?').run(post.id, req.user.id);
    else db.prepare('INSERT INTO fn_community_likes (post_id, user_id) VALUES (?, ?)').run(post.id, req.user.id);
    const likes = db.prepare('SELECT COUNT(*) AS count FROM fn_community_likes WHERE post_id = ?').get(post.id).count;
    res.json({ liked: !existing, likes });
  });

  app.post('/api/community/:id/comments', requireAuth, rateLimit('community-comment', 40, 60 * 60 * 1000), (req, res) => {
    const body = String(req.body.body || '').trim();
    if (body.length < 1 || body.length > 1500) return jsonError(res, 400, 'INVALID_COMMENT', 'Comments must be between 1 and 1,500 characters.');
    if (!db.prepare('SELECT 1 FROM fn_community_posts WHERE id = ? AND deleted_at IS NULL AND hidden = 0').get(req.params.id)) return jsonError(res, 404, 'NOT_FOUND', 'Post not found.');
    const id = randomUUID();
    db.prepare('INSERT INTO fn_community_comments (id, post_id, user_id, body, anonymous) VALUES (?, ?, ?, ?, ?)').run(id, req.params.id, req.user.id, body, req.body.anonymous ? 1 : 0);
    audit(req.user.id, 'community.comment_create', 'community_comment', id, { postId: req.params.id });
    res.status(201).json({ comment: { id, body, author: req.body.anonymous ? 'Anonymous member' : req.user.name, anonymous: Boolean(req.body.anonymous), createdAt: new Date().toISOString() } });
  });

  app.post('/api/community/:id/report', requireAuth, rateLimit('community-report', 10, 60 * 60 * 1000), (req, res) => {
    const reason = String(req.body.reason || '').trim();
    if (reason.length < 3 || reason.length > 500) return jsonError(res, 400, 'INVALID_REPORT', 'Please provide a brief reason.');
    if (!db.prepare('SELECT 1 FROM fn_community_posts WHERE id = ?').get(req.params.id)) return jsonError(res, 404, 'NOT_FOUND', 'Post not found.');
    const id = randomUUID();
    db.prepare('INSERT INTO fn_community_reports (id, post_id, reporter_id, reason) VALUES (?, ?, ?, ?)').run(id, req.params.id, req.user.id, reason);
    audit(req.user.id, 'community.report', 'community_report', id, { postId: req.params.id });
    res.status(201).json({ id, status: 'open' });
  });

  app.get('/api/moderation/reports', requireAuth, requireRole('moderator', 'platform_admin'), (req, res) => {
    const reports = db.prepare(`
      SELECT r.*, p.body AS post_body, u.name AS reporter_name
      FROM fn_community_reports r
      LEFT JOIN fn_community_posts p ON p.id = r.post_id
      JOIN fn_users u ON u.id = r.reporter_id
      ORDER BY CASE r.status WHEN 'open' THEN 0 ELSE 1 END, r.created_at DESC
    `).all();
    res.json({ reports });
  });

  app.patch('/api/moderation/reports/:id', requireAuth, requireRole('moderator', 'platform_admin'), (req, res) => {
    const status = ['reviewed', 'dismissed', 'actioned'].includes(req.body.status) ? req.body.status : null;
    if (!status) return jsonError(res, 400, 'INVALID_STATUS', 'Select a valid moderation status.');
    const report = db.prepare('SELECT * FROM fn_community_reports WHERE id = ?').get(req.params.id);
    if (!report) return jsonError(res, 404, 'NOT_FOUND', 'Report not found.');
    db.transaction(() => {
      db.prepare(`UPDATE fn_community_reports SET status = ?, moderator_note = ?, reviewed_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(status, String(req.body.note || '').slice(0, 500), req.user.id, report.id);
      if (status === 'actioned' && report.post_id) db.prepare('UPDATE fn_community_posts SET hidden = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(report.post_id);
      audit(req.user.id, 'moderation.review', 'community_report', report.id, { status });
    })();
    res.json({ id: report.id, status });
  });

  app.get('/api/knowledge', requireAuth, (req, res) => {
    const topic = String(req.query.topic || 'All');
    const search = String(req.query.search || '').trim();
    const clauses = ['approved = 1'];
    const params = [];
    if (topic !== 'All') { clauses.push('topic = ?'); params.push(topic); }
    if (search) { clauses.push('(title LIKE ? OR summary LIKE ? OR content LIKE ?)'); params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
    const articles = db.prepare(`SELECT id, slug, title, topic, summary, content, source_title, source_url, updated_at FROM fn_knowledge_articles WHERE ${clauses.join(' AND ')} ORDER BY topic, title`).all(...params);
    const topics = db.prepare('SELECT DISTINCT topic FROM fn_knowledge_articles WHERE approved = 1 ORDER BY topic').all().map((row) => row.topic);
    res.json({ articles: articles.map((article) => ({ id: article.id, slug: article.slug, title: article.title, topic: article.topic, summary: article.summary, content: article.content, source: { title: article.source_title, url: article.source_url }, updatedAt: article.updated_at })), topics });
  });

  app.post('/api/chat', requireAuth, rateLimit('chat', 60, 60 * 60 * 1000), (req, res) => {
    const question = String(req.body.question || '').trim().slice(0, 1200);
    if (!question) return jsonError(res, 400, 'QUESTION_REQUIRED', 'Enter a question for Nova.');
    let conversationId = req.body.conversationId;
    if (!conversationId || !db.prepare('SELECT 1 FROM fn_chat_conversations WHERE id = ? AND user_id = ?').get(conversationId, req.user.id)) {
      conversationId = randomUUID();
      db.prepare('INSERT INTO fn_chat_conversations (id, user_id) VALUES (?, ?)').run(conversationId, req.user.id);
    }
    db.prepare('INSERT INTO fn_chat_messages (id, conversation_id, role, content) VALUES (?, ?, ?, ?)').run(randomUUID(), conversationId, 'user', question);
    const urgent = isUrgentQuestion(question);
    const documents = urgent ? rankKnowledge('urgent severe bleeding pain safety', 2) : rankKnowledge(question, 3);
    let answer;
    if (urgent) {
      answer = 'Some of what you described can need urgent assessment. Please contact local emergency services or urgent medical care now, especially if symptoms are severe, rapidly worsening, involve fainting, trouble breathing, very heavy bleeding, possible pregnancy with pain or bleeding, or thoughts of self-harm. Do not rely on this chat for an emergency.';
    } else if (!documents.length) {
      answer = 'I do not have a strong enough approved source to answer that safely. I can help with cycle basics, mood and energy, nutrition, contraception, pregnancy basics, PCOS, thyroid labs, or red-flag symptoms. For personal diagnosis or treatment, please ask a qualified healthcare professional.';
    } else {
      answer = documents[0].chunk_content;
      const profile = profileFor(req.user.id);
      if (profile.chatbotPersonalization) {
        const cycle = getCycleContext(req.user.id);
        const latestPrediction = ensureFreshPrediction(req.user.id);
        const flags = latestPrediction?.values.filter((value) => value.status !== 'normal').map((value) => value.shortName).join(', ');
        answer += ` Based on data you consented to share with Nova, your currently estimated phase is ${cycle.phase}${flags ? ` and your latest estimate flags ${flags} for clinician discussion` : ''}. Your fertility estimate is currently ${cycle.fertility.chance.toLowerCase()} with ${Math.round(cycle.fertility.confidence * 100)}% confidence. This is a personal tracking observation, not a diagnosis.`;
      }
      answer += ' Use this as education, and compare lab information with the range printed on your own report.';
    }
    const citations = documents.map((document) => ({ title: document.source_title, url: document.source_url, article: document.title }));
    db.prepare(`INSERT INTO fn_chat_messages (id, conversation_id, role, content, citations) VALUES (?, ?, 'assistant', ?, ?)`).run(randomUUID(), conversationId, answer, JSON.stringify(citations));
    db.prepare('UPDATE fn_chat_conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(conversationId);
    res.json({ conversationId, answer, citations, urgent, grounded: documents.length > 0 });
  });

  app.get('/api/settings', requireAuth, (req, res) => res.json({ profile: profileFor(req.user.id) }));

  app.put('/api/settings', requireAuth, (req, res) => {
    const current = profileFor(req.user.id);
    const population = POPULATIONS.includes(req.body.population) ? req.body.population : current.population;
    const averageCycleLength = Number(req.body.averageCycleLength);
    if (!Number.isInteger(averageCycleLength) || averageCycleLength < 15 || averageCycleLength > 60) return jsonError(res, 400, 'INVALID_CYCLE_LENGTH', 'Cycle length must be between 15 and 60 days.');
    db.transaction(() => {
      db.prepare(`
        UPDATE fn_profiles SET population = ?, timezone = ?, average_cycle_length = ?, animations_enabled = ?,
          chatbot_personalization = ?, anonymous_by_default = ?, notification_cycle = ?, notification_community = ?, updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ?
      `).run(
        population, String(req.body.timezone || current.timezone).slice(0, 60), averageCycleLength,
        req.body.animationsEnabled ? 1 : 0, req.body.chatbotPersonalization ? 1 : 0,
        req.body.anonymousByDefault ? 1 : 0, req.body.notifications?.cycle ? 1 : 0,
        req.body.notifications?.community ? 1 : 0, req.user.id
      );
      db.prepare('INSERT INTO fn_consents (id, user_id, consent_type, granted, policy_version) VALUES (?, ?, ?, ?, ?)').run(randomUUID(), req.user.id, 'chatbot_personalization', req.body.chatbotPersonalization ? 1 : 0, '2026-09');
      audit(req.user.id, 'settings.update', 'profile', req.user.id, { population, chatbotPersonalization: Boolean(req.body.chatbotPersonalization) });
    })();
    res.json({ profile: profileFor(req.user.id) });
  });

  app.get('/api/account/export', requireAuth, (req, res) => {
    const payload = {
      exportedAt: new Date().toISOString(),
      user: publicUser(req.user),
      profile: profileFor(req.user.id),
      consents: db.prepare('SELECT consent_type, granted, policy_version, created_at FROM fn_consents WHERE user_id = ?').all(req.user.id),
      cycleLogs: db.prepare('SELECT * FROM fn_daily_logs WHERE user_id = ? ORDER BY date').all(req.user.id).map(serializeLog),
      labResults: getLabResults(req.user.id),
      labPredictions: db.prepare('SELECT id, generated_at, feature_snapshot, explanation FROM fn_lab_predictions WHERE user_id = ? ORDER BY generated_at').all(req.user.id),
      communityPosts: db.prepare('SELECT id, topic, body, anonymous, created_at FROM fn_community_posts WHERE user_id = ?').all(req.user.id),
      prescriptions: db.prepare('SELECT id, original_name, mime_type, size_bytes, comments, created_at FROM fn_prescriptions WHERE user_id = ?').all(req.user.id)
    };
    audit(req.user.id, 'account.export', 'user', req.user.id);
    res.setHeader('Content-Disposition', `attachment; filename="herhealth-export-${new Date().toISOString().slice(0, 10)}.json"`);
    res.json(payload);
  });

  app.delete('/api/account', requireAuth, asyncRoute(async (req, res) => {
    const canResetLocalProfile = Boolean(req.user.auto_provisioned) && req.body.confirm === 'RESET_LOCAL_PROFILE';
    if (!canResetLocalProfile && !(await verifyPassword(String(req.body.password || ''), req.user.password_hash))) {
      return jsonError(res, 401, 'INVALID_PASSWORD', 'Enter your password to delete the account.');
    }
    const files = db.prepare('SELECT storage_name FROM fn_prescriptions WHERE user_id = ?').all(req.user.id);
    db.transaction(() => {
      audit(req.user.id, 'account.delete', 'user', req.user.id);
      db.prepare('DELETE FROM fn_users WHERE id = ?').run(req.user.id);
    })();
    for (const file of files) fs.rmSync(path.join(uploadRoot, file.storage_name), { force: true });
    clearSession(res);
    res.status(204).end();
  }));

  app.use('/api', (req, res) => jsonError(res, 404, 'NOT_FOUND', 'The requested resource was not found.'));

  app.use(express.static(path.join(root, 'dist')));
  app.get(/^(?!\/api(?:\/|$)).*/, (req, res, next) => {
    const indexPath = path.join(root, 'dist', 'index.html');
    if (!fs.existsSync(indexPath)) return next();
    return res.sendFile(indexPath);
  });

  app.use((req, res) => jsonError(res, 404, 'NOT_FOUND', 'The requested resource was not found.'));
  app.use((error, req, res, next) => {
    console.error(error);
    if (res.headersSent) return next(error);
    return jsonError(res, 500, 'INTERNAL_ERROR', 'HerHealth could not complete that request.');
  });
  return app;
}
