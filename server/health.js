import { randomUUID } from 'node:crypto';
import { db, parseJson } from './database.js';
import { privacy, readPrivateJson } from './privacy.js';
import { predictLabs, predictCycle, searchKnowledge, validPredictionInput, validCycleInput, validKnowledgeInput } from './analysis.js';
export { isUrgentQuestion } from './analysis.js';

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

export async function getCycleContext(userId, today = new Date().toISOString().slice(0, 10)) {
  // Trusted preparation removes identity and absolute dates before analysis.
  const rows = db.prepare('SELECT date, flow FROM fn_daily_logs WHERE user_id = ? AND date <= ? ORDER BY date ASC').all(userId, today);
  const profile = db.prepare('SELECT average_cycle_length FROM fn_profiles WHERE user_id = ?').get(userId);
  const payload = {
    periodOffsets: rows.filter(row => ['light', 'medium', 'heavy'].includes(row.flow)).map(row => daysBetween(today, row.date)),
    trackedDays: rows.length,
    averageLength: profile?.average_cycle_length || 28,
  };
  const input = await privacy.json(payload, data => validCycleInput(data) && JSON.stringify(data) === JSON.stringify(payload));
  const { lastStartOffset, periodStartOffsets, ...context } = predictCycle(input);
  // Associate results with calendar dates only after analysis, inside the app.
  return { ...context,
    lastPeriodStart: lastStartOffset === null ? null : addDays(today, lastStartOffset),
    nextPeriod: lastStartOffset === null ? null : addDays(today, lastStartOffset + context.averageLength),
    periodStarts: periodStartOffsets.map(offset => addDays(today, offset)),
  };
}

export async function phaseForDate(userId, date) {
  return (await getCycleContext(userId, date)).phase;
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

export async function generatePrediction(userId) {
  // This is trusted input preparation and result persistence, not model code.
  const profile = db.prepare('SELECT population FROM fn_profiles WHERE user_id = ?').get(userId);
  const logs = db.prepare('SELECT flow, energy, symptoms FROM fn_daily_logs WHERE user_id = ? ORDER BY date DESC LIMIT 90').all(userId);
  const recentLabs = getLabResults(userId).slice(0, 5);
  const symptoms = logs.flatMap(row => {
    const parsed = parseJson(row.symptoms, []);
    return Array.isArray(parsed) ? parsed.filter(item => SYMPTOMS.includes(item)) : [];
  });
  const features = {
    trackedDays: logs.length,
    pastLabPanels: recentLabs.length,
    heavyFlowDays: logs.filter(row => row.flow === 'heavy').length,
    lowEnergyDays: logs.filter(row => row.energy && row.energy <= 2).length,
    fatigueReports: symptoms.filter(item => item === 'fatigue').length,
    dizzinessReports: symptoms.filter(item => item === 'dizziness').length,
    population: profile?.population || 'adult_non_pregnant',
  };
  const latestValues = Object.fromEntries(CORE_TESTS.map(code => [code, null]));
  for (const result of recentLabs) {
    for (const value of result.values) {
      if (CORE_TESTS.includes(value.code) && latestValues[value.code] === null) latestValues[value.code] = value.value;
    }
  }
  const references = Object.fromEntries(CORE_TESTS.map(code => [code, getReferenceRange(code, features.population)]));
  const ranges = Object.fromEntries(CORE_TESTS.map(code => [code, {
    low: references[code].low, high: references[code].high, margin: references[code].borderline_margin,
  }]));
  const payload = { features, latestValues, ranges };
  const input = await privacy.json(payload, data => validPredictionInput(data) && JSON.stringify(data) === JSON.stringify(payload));
  const output = predictLabs(input);
  const safeFeatures = readPrivateJson(input).features;
  const model = db.prepare("SELECT * FROM fn_model_versions WHERE version = 'baseline-1.0.0'").get();
  const predictionId = randomUUID();
  const explanation = 'A deterministic baseline combined recent tracked patterns with prior values when available. It is a product-flow placeholder, not a clinically validated model.';
  // Nothing is persisted as an inference until sanitization and analysis succeed.
  db.transaction(() => {
    db.prepare('INSERT INTO fn_lab_predictions (id, user_id, model_version_id, feature_snapshot, explanation) VALUES (?, ?, ?, ?, ?)').run(predictionId, userId, model.id, JSON.stringify(safeFeatures), explanation);
    const insert = db.prepare('INSERT INTO fn_prediction_values (id, prediction_id, test_id, predicted_value, unit, confidence, status, direction, delta, reference_range_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const { code, predicted, confidence, evaluation } of output) {
      const reference = references[code];
      insert.run(randomUUID(), predictionId, reference.test_id, predicted, reference.unit, confidence, evaluation.status, evaluation.direction, evaluation.delta, reference.id);
    }
    // Audit metadata excludes original records, user notes, and Anymize responses.
    db.prepare('INSERT INTO fn_inference_audit_logs (id, user_id, prediction_id, model_version, input_summary) VALUES (?, ?, ?, ?, ?)').run(randomUUID(), userId, predictionId, model.version, JSON.stringify({ privacyPolicy: 'anymize-v1', status: 'completed' }));
  })();
  return { prediction: getLatestPrediction(userId), output };
}

export async function rankKnowledge(question, limit = 3) {
  const articles = db.prepare('SELECT title, topic, summary, content, source_title, source_url FROM fn_knowledge_articles WHERE approved = 1').all();
  const input = await privacy.json({ question, articles }, validKnowledgeInput);
  return searchKnowledge(input, limit);
}

export function round(value, places = 2) {
  const multiplier = 10 ** places;
  return Math.round((value + Number.EPSILON) * multiplier) / multiplier;
}
