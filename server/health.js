import { randomUUID } from 'node:crypto';
import { db, parseJson } from './database.js';
import { cosineSimilarity, createEmbedding } from './vector.js';

export const CORE_TESTS = ['ft3', 'ft4', 'tsh', 'hb'];
export const POPULATIONS = ['adult_non_pregnant', 'pregnancy_t1', 'pregnancy_t2', 'pregnancy_t3', 'adolescent'];
export const FLOW_LEVELS = ['none', 'spotting', 'light', 'medium', 'heavy'];
export const MOODS = ['Calm', 'Happy', 'Low', 'Anxious', 'Irritable', 'Energized', 'Tender'];
export const SYMPTOMS = ['cramps', 'bloating', 'acne', 'headache', 'fatigue', 'breast tenderness', 'nausea', 'dizziness'];

export function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

export function addDays(date, amount) {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + amount);
  return next.toISOString().slice(0, 10);
}

export function daysBetween(start, end) {
  return Math.round((new Date(`${end}T00:00:00Z`) - new Date(`${start}T00:00:00Z`)) / 86400000);
}

export function getReferenceRange(code, population = 'adult_non_pregnant', unit = null) {
  const params = [code, population];
  let unitClause = '';
  if (unit) {
    unitClause = 'AND rr.unit = ?';
    params.push(unit);
  }
  let range = db.prepare(`
    SELECT rr.*, lt.code, lt.name, lt.short_name, lt.default_unit, lt.is_core
    FROM fn_reference_ranges rr
    JOIN fn_lab_tests lt ON lt.id = rr.test_id
    WHERE lt.code = ? AND rr.population = ? ${unitClause} AND rr.active = 1
    ORDER BY rr.version DESC LIMIT 1
  `).get(...params);
  if (!range && population !== 'adult_non_pregnant') {
    range = getReferenceRange(code, 'adult_non_pregnant', unit);
  }
  return range;
}

export function evaluateValue(value, range) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || !range) return null;
  const lowBorder = range.low + range.borderline_margin;
  const highBorder = range.high - range.borderline_margin;
  if (numeric < range.low) {
    return { status: 'out_of_range', direction: 'low', delta: round(range.low - numeric) };
  }
  if (numeric > range.high) {
    return { status: 'out_of_range', direction: 'high', delta: round(numeric - range.high) };
  }
  if (numeric <= lowBorder) {
    return { status: 'borderline', direction: 'low', delta: round(numeric - range.low) };
  }
  if (numeric >= highBorder) {
    return { status: 'borderline', direction: 'high', delta: round(range.high - numeric) };
  }
  return { status: 'normal', direction: null, delta: 0 };
}

export function serializeLog(row) {
  if (!row) return null;
  return {
    id: row.id,
    date: row.date,
    flow: row.flow,
    mood: row.mood,
    symptoms: parseJson(row.symptoms, []),
    sleepHours: row.sleep_hours,
    sleepQuality: row.sleep_quality,
    energy: row.energy,
    discharge: row.discharge,
    basalTemperature: row.basal_temperature,
    notes: row.notes,
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function getCycleContext(userId, today = new Date().toISOString().slice(0, 10)) {
  const rows = db.prepare(`
    SELECT * FROM fn_daily_logs WHERE user_id = ? AND date <= ? ORDER BY date ASC
  `).all(userId, today);
  const periodDates = rows.filter((row) => ['light', 'medium', 'heavy'].includes(row.flow)).map((row) => row.date);
  const starts = periodDates.filter((date, index) => index === 0 || daysBetween(periodDates[index - 1], date) > 1);
  const lengths = starts.slice(1).map((date, index) => daysBetween(starts[index], date)).filter((length) => length >= 15 && length <= 60);
  const profile = db.prepare('SELECT average_cycle_length FROM fn_profiles WHERE user_id = ?').get(userId);
  const configured = profile?.average_cycle_length || 28;
  const averageLength = lengths.length
    ? Math.round(lengths.slice(-6).reduce((sum, length) => sum + length, 0) / Math.min(lengths.length, 6))
    : configured;
  const lastPeriodStart = starts.at(-1) || null;
  const cycleDay = lastPeriodStart ? Math.max(1, daysBetween(lastPeriodStart, today) + 1) : null;
  const normalizedDay = cycleDay ? ((cycleDay - 1) % averageLength) + 1 : null;
  const ovulationDay = Math.max(10, averageLength - 14);
  let phase = 'Unknown';
  if (normalizedDay) {
    if (normalizedDay <= 5) phase = 'Menstrual';
    else if (normalizedDay < ovulationDay - 2) phase = 'Follicular';
    else if (normalizedDay <= ovulationDay + 1) phase = 'Ovulation';
    else phase = 'Luteal';
  }
  const nextPeriod = lastPeriodStart ? addDays(lastPeriodStart, averageLength) : null;
  return {
    averageLength,
    variability: lengths.length > 1 ? Math.max(...lengths.slice(-6)) - Math.min(...lengths.slice(-6)) : null,
    lastPeriodStart,
    nextPeriod,
    cycleDay,
    phase,
    ovulationDay,
    predictionConfidence: starts.length >= 3 ? 0.82 : starts.length ? 0.58 : 0.25,
    periodStarts: starts,
    trackedDays: rows.length
  };
}

export function phaseForDate(userId, date) {
  const context = getCycleContext(userId, date);
  return context.phase;
}

export function getLabResults(userId) {
  const results = db.prepare(`
    SELECT * FROM fn_lab_results WHERE user_id = ? ORDER BY date DESC, created_at DESC
  `).all(userId);
  const valuesQuery = db.prepare(`
    SELECT lv.*, lt.code, lt.name, lt.short_name, rr.low, rr.high, rr.version AS range_version, rr.source_note
    FROM fn_lab_values lv
    JOIN fn_lab_tests lt ON lt.id = lv.test_id
    JOIN fn_reference_ranges rr ON rr.id = lv.reference_range_id
    WHERE lv.result_id = ? ORDER BY lt.is_core DESC, lt.name ASC
  `);
  return results.map((result) => ({
    id: result.id,
    date: result.date,
    population: result.population,
    comments: result.comments,
    source: result.source,
    createdAt: result.created_at,
    values: valuesQuery.all(result.id).map(serializeLabValue)
  }));
}

export function serializeLabValue(value) {
  return {
    id: value.id,
    code: value.code,
    name: value.name,
    shortName: value.short_name,
    value: value.value ?? value.predicted_value,
    unit: value.unit,
    status: value.status,
    direction: value.direction,
    delta: value.delta,
    range: {
      id: value.reference_range_id,
      low: value.low,
      high: value.high,
      version: value.range_version,
      sourceNote: value.source_note
    }
  };
}

export function getLatestPrediction(userId) {
  const prediction = db.prepare(`
    SELECT lp.*, mv.version AS model_version
    FROM fn_lab_predictions lp
    JOIN fn_model_versions mv ON mv.id = lp.model_version_id
    WHERE lp.user_id = ? ORDER BY lp.generated_at DESC LIMIT 1
  `).get(userId);
  if (!prediction) return null;
  const values = db.prepare(`
    SELECT pv.*, lt.code, lt.name, lt.short_name, rr.low, rr.high, rr.version AS range_version, rr.source_note
    FROM fn_prediction_values pv
    JOIN fn_lab_tests lt ON lt.id = pv.test_id
    JOIN fn_reference_ranges rr ON rr.id = pv.reference_range_id
    WHERE pv.prediction_id = ? ORDER BY lt.name
  `).all(prediction.id).map((value) => ({ ...serializeLabValue(value), confidence: value.confidence }));
  return {
    id: prediction.id,
    generatedAt: prediction.generated_at,
    modelVersion: prediction.model_version,
    explanation: prediction.explanation,
    values,
    disclaimer: 'This estimate is not a diagnosis and is not a substitute for a laboratory test. Consult a qualified clinician.'
  };
}

export function generatePrediction(userId) {
  const profile = db.prepare('SELECT * FROM fn_profiles WHERE user_id = ?').get(userId);
  const logs = db.prepare(`SELECT * FROM fn_daily_logs WHERE user_id = ? ORDER BY date DESC LIMIT 90`).all(userId);
  const recentLabs = getLabResults(userId).slice(0, 5);
  const symptoms = logs.flatMap((row) => parseJson(row.symptoms, []));
  const heavyDays = logs.filter((row) => row.flow === 'heavy').length;
  const lowEnergyDays = logs.filter((row) => row.energy && row.energy <= 2).length;
  const fatigueCount = symptoms.filter((item) => item === 'fatigue').length;
  const dizzinessCount = symptoms.filter((item) => item === 'dizziness').length;
  const featureSnapshot = {
    trackedDays: logs.length,
    pastLabPanels: recentLabs.length,
    heavyFlowDays: heavyDays,
    lowEnergyDays,
    fatigueReports: fatigueCount,
    dizzinessReports: dizzinessCount,
    population: profile.population
  };
  const model = db.prepare("SELECT * FROM fn_model_versions WHERE version = 'baseline-1.0.0'").get();
  const predictionId = randomUUID();
  const explanation = 'A deterministic baseline combined recent tracked patterns with prior values when available. It is a product-flow placeholder, not a clinically validated model.';
  db.prepare(`
    INSERT INTO fn_lab_predictions (id, user_id, model_version_id, feature_snapshot, explanation)
    VALUES (?, ?, ?, ?, ?)
  `).run(predictionId, userId, model.id, JSON.stringify(featureSnapshot), explanation);

  const latestByCode = {};
  for (const result of recentLabs) {
    for (const value of result.values) {
      if (latestByCode[value.code] === undefined) latestByCode[value.code] = value.value;
    }
  }
  const modifiers = {
    ft3: -(fatigueCount * 0.025 + lowEnergyDays * 0.015),
    ft4: -(fatigueCount * 0.012 + lowEnergyDays * 0.006),
    tsh: fatigueCount * 0.08 + lowEnergyDays * 0.04,
    hb: -(heavyDays * 0.12 + dizzinessCount * 0.08 + fatigueCount * 0.035)
  };
  const output = [];
  const insert = db.prepare(`
    INSERT INTO fn_prediction_values
      (id, prediction_id, test_id, predicted_value, unit, confidence, status, direction, delta, reference_range_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const code of CORE_TESTS) {
    const range = getReferenceRange(code, profile.population);
    const baseline = latestByCode[code] ?? (range.low + range.high) / 2;
    const predicted = round(Math.max(0, baseline + modifiers[code]));
    const evaluation = evaluateValue(predicted, range);
    const evidence = Math.min(0.78, 0.38 + logs.length * 0.006 + recentLabs.length * 0.06);
    const confidence = round(evidence, 2);
    insert.run(randomUUID(), predictionId, range.test_id, predicted, range.unit, confidence, evaluation.status, evaluation.direction, evaluation.delta, range.id);
    output.push({ code, predicted, confidence, evaluation });
  }
  db.prepare(`
    INSERT INTO fn_inference_audit_logs (id, user_id, prediction_id, model_version, input_summary)
    VALUES (?, ?, ?, ?, ?)
  `).run(randomUUID(), userId, predictionId, model.version, JSON.stringify(featureSnapshot));
  return { prediction: getLatestPrediction(userId), output };
}

export function rankKnowledge(question, limit = 3) {
  const queryEmbedding = createEmbedding(question);
  return db.prepare(`
    SELECT kc.content AS chunk_content, kc.embedding, ka.*
    FROM fn_knowledge_chunks kc
    JOIN fn_knowledge_articles ka ON ka.id = kc.article_id
    WHERE ka.approved = 1
  `).all()
    .map((article) => ({ ...article, score: cosineSimilarity(queryEmbedding, parseJson(article.embedding, [])) }))
    .filter((article) => article.score > 0.08)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function isUrgentQuestion(question) {
  const urgent = ['fainting', 'fainted', 'chest pain', 'cannot breathe', "can't breathe", 'trouble breathing', 'suicide', 'self harm', 'kill myself', 'severe bleeding', 'soaking a pad', 'pregnant and bleeding', 'unbearable pain'];
  return urgent.some((phrase) => String(question).toLowerCase().includes(phrase));
}

export function round(value, places = 2) {
  const multiplier = 10 ** places;
  return Math.round((value + Number.EPSILON) * multiplier) / multiplier;
}
