// Analysis code accepts gateway-issued handles only. No database or file access.
import { readPrivateJson, readPrivateText } from './privacy.js';
import { createEmbedding, cosineSimilarity } from './vector.js';

const TESTS = ['ft3', 'ft4', 'tsh', 'hb'];
const POPULATIONS = ['adult_non_pregnant', 'pregnancy_t1', 'pregnancy_t2', 'pregnancy_t3', 'adolescent'];
const finite = value => typeof value === 'number' && Number.isFinite(value);
const count = value => Number.isInteger(value) && value >= 0 && value <= 100_000;
const keys = (value, expected) => value && !Array.isArray(value) && typeof value === 'object'
  && Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key));
const round = (value, places = 2) => Math.round((value + Number.EPSILON) * 10 ** places) / 10 ** places;
const rangeValid = range => keys(range, ['low', 'high', 'margin']) && finite(range.low) && finite(range.high)
  && finite(range.margin) && range.high > range.low && range.margin >= 0 && range.margin <= (range.high - range.low) / 2;

export function validLabInput(data) {
  return keys(data, ['panels', 'ranges']) && Array.isArray(data.panels) && keys(data.ranges, TESTS)
    && TESTS.every(code => rangeValid(data.ranges[code]))
    && data.panels.every(panel => keys(panel, TESTS) && TESTS.every(code => panel[code] === null || finite(panel[code])));
}

export function classifyLabs(input) {
  const { panels, ranges } = readPrivateJson(input);
  return panels.map(panel => Object.fromEntries(TESTS.map(code => [code,
    panel[code] === null ? null : panel[code] < ranges[code].low ? 'low' : panel[code] > ranges[code].high ? 'high' : 'normal',
  ])));
}

const FEATURE_KEYS = ['trackedDays', 'pastLabPanels', 'heavyFlowDays', 'lowEnergyDays', 'fatigueReports', 'dizzinessReports', 'population'];
export function validPredictionInput(data) {
  return keys(data, ['features', 'latestValues', 'ranges']) && keys(data.features, FEATURE_KEYS)
    && FEATURE_KEYS.slice(0, -1).every(key => count(data.features[key])) && POPULATIONS.includes(data.features.population)
    && keys(data.latestValues, TESTS) && TESTS.every(code => data.latestValues[code] === null || finite(data.latestValues[code]))
    && keys(data.ranges, TESTS) && TESTS.every(code => rangeValid(data.ranges[code]));
}

export function predictLabs(input) {
  const { features, latestValues, ranges } = readPrivateJson(input);
  const modifiers = {
    ft3: -(features.fatigueReports * 0.025 + features.lowEnergyDays * 0.015),
    ft4: -(features.fatigueReports * 0.012 + features.lowEnergyDays * 0.006),
    tsh: features.fatigueReports * 0.08 + features.lowEnergyDays * 0.04,
    hb: -(features.heavyFlowDays * 0.12 + features.dizzinessReports * 0.08 + features.fatigueReports * 0.035),
  };
  return TESTS.map(code => {
    const range = ranges[code];
    const predicted = round(Math.max(0, (latestValues[code] ?? (range.low + range.high) / 2) + modifiers[code]));
    const evaluation = predicted < range.low
      ? { status: 'out_of_range', direction: 'low', delta: round(range.low - predicted) }
      : predicted > range.high
        ? { status: 'out_of_range', direction: 'high', delta: round(predicted - range.high) }
        : predicted <= range.low + range.margin
          ? { status: 'borderline', direction: 'low', delta: round(predicted - range.low) }
          : predicted >= range.high - range.margin
            ? { status: 'borderline', direction: 'high', delta: round(range.high - predicted) }
            : { status: 'normal', direction: null, delta: 0 };
    return { code, predicted, confidence: round(Math.min(0.78, 0.38 + features.trackedDays * 0.006 + features.pastLabPanels * 0.06)), evaluation };
  });
}

export function validCycleInput(data) {
  return keys(data, ['periodOffsets', 'trackedDays', 'averageLength']) && count(data.trackedDays)
    && Array.isArray(data.periodOffsets) && data.periodOffsets.every(day => Number.isInteger(day) && day <= 0 && day >= -100_000)
    && Number.isInteger(data.averageLength) && data.averageLength >= 15 && data.averageLength <= 60;
}

export function predictCycle(input) {
  const { periodOffsets, trackedDays, averageLength: configured } = readPrivateJson(input);
  const dates = [...new Set(periodOffsets)].sort((a, b) => a - b);
  const starts = dates.filter((day, index) => index === 0 || day - dates[index - 1] > 1);
  const lengths = starts.slice(1).map((day, index) => day - starts[index]).filter(length => length >= 15 && length <= 60);
  const averageLength = lengths.length ? Math.round(lengths.slice(-6).reduce((sum, length) => sum + length, 0) / Math.min(lengths.length, 6)) : configured;
  const lastStartOffset = starts.at(-1) ?? null;
  const cycleDay = lastStartOffset === null ? null : 1 - lastStartOffset;
  const day = cycleDay === null ? null : ((cycleDay - 1) % averageLength) + 1;
  const ovulationDay = Math.max(10, averageLength - 14);
  const phase = day === null ? 'Unknown' : day <= 5 ? 'Menstrual' : day < ovulationDay - 2 ? 'Follicular' : day <= ovulationDay + 1 ? 'Ovulation' : 'Luteal';
  return { averageLength, variability: lengths.length > 1 ? Math.max(...lengths.slice(-6)) - Math.min(...lengths.slice(-6)) : null,
    cycleDay, phase, ovulationDay, lastStartOffset, periodStartOffsets: starts, trackedDays,
    predictionConfidence: starts.length >= 3 ? 0.82 : starts.length ? 0.58 : 0.25 };
}

export function validKnowledgeInput(data) {
  const articleKeys = ['title', 'topic', 'summary', 'content', 'source_title', 'source_url'];
  return keys(data, ['question', 'articles']) && typeof data.question === 'string' && Array.isArray(data.articles)
    && data.articles.every(article => keys(article, articleKeys) && articleKeys.every(key => typeof article[key] === 'string'));
}

export function searchKnowledge(input, limit = 3) {
  const { articles } = readPrivateJson(input);
  const query = createEmbedding(input, ['question']);
  return articles.map((article, index) => ({ ...article, chunk_content: article.content,
    score: cosineSimilarity(query, createEmbedding(input, ['articles', index, 'content'])) }))
    .filter(article => article.score > 0.08).sort((a, b) => b.score - a.score).slice(0, limit);
}

export function isUrgentQuestion(input) {
  const question = readPrivateText(input).toLowerCase();
  return ['fainting', 'fainted', 'chest pain', 'cannot breathe', "can't breathe", 'trouble breathing', 'suicide', 'self harm', 'kill myself', 'severe bleeding', 'soaking a pad', 'pregnant and bleeding', 'unbearable pain'].some(phrase => question.includes(phrase));
}
