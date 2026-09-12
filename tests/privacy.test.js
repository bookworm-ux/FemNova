import test from 'node:test';
import assert from 'node:assert/strict';
import { createPrivacyGateway, readPrivateJson, readPrivateText } from '../server/privacy.js';
import { createChatHandler, answerQuestion } from '../server/chat.js';
import { privateLabFlags } from '../server/lab-privacy.js';
import { classifyLabs, predictLabs, predictCycle, searchKnowledge, isUrgentQuestion, validPredictionInput, validCycleInput, validKnowledgeInput } from '../server/analysis.js';
import { createEmbedding } from '../server/vector.js';

function mockGateway({ output = 'My name is [[Name-abc123]]. I have cramps.', status = 'completed', httpStatus = 200, extra = {}, timeoutMs = 1000 } = {}) {
  const requests = [];
  let submitted;
  const gateway = createPrivacyGateway({ apiKey: 'synthetic-key', timeoutMs, pollMs: 2, fetchImpl: async (url, options) => {
    requests.push({ url, ...options });
    if (url.endsWith('/anonymize')) {
      submitted = JSON.parse(options.body).text;
      return Response.json({ job_id: 'synthetic-job', status: 'processing' }, { status: 202 });
    }
    return Response.json({ job_id: 'synthetic-job', status,
      anonymized_text_raw: typeof output === 'function' ? output(submitted) : output,
      original_text: submitted, metadata: { filename: 'Test Person.pdf' }, ...extra }, { status: httpStatus });
  } });
  return { gateway, requests };
}

function responseCapture() {
  return { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}

test('only sanitized text leaves the gateway; placeholders lose provider hashes', async () => {
  const { gateway, requests } = mockGateway();
  const input = await gateway.text('My name is Test Person. I have cramps.');
  assert.equal(readPrivateText(input), 'My name is [PRIVATE_1]. I have cramps.');
  assert.equal(JSON.stringify(input), '{}');
  assert.ok(Object.isFrozen(input));
  assert.equal(requests.length, 2);
  assert.equal(requests[0].headers.Authorization, 'Bearer synthetic-key');
  assert.ok(requests.every(request => request.url.startsWith('https://app.anymize.ai/api/') && request.redirect === 'error'));
});

test('missing credentials stop all network activity', async () => {
  let calls = 0;
  const gateway = createPrivacyGateway({ apiKey: '', fetchImpl: () => { calls++; } });
  await assert.rejects(gateway.text('A question'), { code: 'PRIVACY_NOT_CONFIGURED' });
  assert.equal(calls, 0);
});

test('network errors never expose original content or credentials', async () => {
  const gateway = createPrivacyGateway({ apiKey: 'synthetic-key', fetchImpl: async () => { throw new Error('secret-key Test Person'); } });
  await assert.rejects(gateway.text('Test Person'), error => !/secret-key|Test Person/.test(String(error)) && !error.cause);
});

for (const scenario of [
  { status: 'failed' }, { status: 'unknown' }, { httpStatus: 401 }, { httpStatus: 429 }, { httpStatus: 500 },
  { output: null }, { output: '' }, { output: 'Test Person at test@example.com' }, { output: 'DOB: 2000-01-01' },
  { extra: { job_id: 'different-job' } }, { output: 'x'.repeat(48_001) },
]) {
  test(`chat blocks analysis for rejected provider result: ${JSON.stringify(scenario).slice(0, 100)}`, async () => {
    const { gateway } = mockGateway(scenario);
    let analysisCalls = 0;
    const handler = createChatHandler({ gateway, answer: () => { analysisCalls++; } });
    const res = responseCapture();
    await handler({ body: { question: 'Test Person has cramps' } }, res);
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.code, 'PRIVACY_UNAVAILABLE');
    assert.equal(analysisCalls, 0);
    assert.doesNotMatch(JSON.stringify(res.body), /Test Person|synthetic-key/);
  });
}

test('unfinished jobs time out without returning partially processed data', async () => {
  const { gateway } = mockGateway({ status: 'processing', timeoutMs: 30 });
  await assert.rejects(gateway.text('Test Person'), { code: 'PRIVACY_UNAVAILABLE' });
});

test('chat sends only the gateway-issued input to its answer function', async () => {
  const { gateway } = mockGateway();
  let observed;
  const handler = createChatHandler({ gateway, answer: input => { observed = readPrivateText(input); return { answer: 'Synthetic answer' }; } });
  const res = responseCapture();
  await handler({ body: { question: 'My name is Test Person. I have cramps.' } }, res);
  assert.equal(res.statusCode, 200);
  assert.doesNotMatch(observed, /Test Person|abc123/);
});

test('extra fields, attachments, empty or oversized chat input never reach Anymize', async () => {
  const { gateway, requests } = mockGateway();
  for (const body of [null, {}, { question: {} }, { question: '' }, { question: 'q', attachment: 'raw.pdf' }, { question: 'q'.repeat(4001) }]) {
    const res = responseCapture();
    await createChatHandler({ gateway })({ body }, res);
    assert.equal(res.statusCode, 400);
  }
  assert.equal(requests.length, 0);
});

test('all analysis entry points reject raw strings and forged sanitized flags', () => {
  for (const analysis of [answerQuestion, isUrgentQuestion, createEmbedding, classifyLabs, predictLabs, predictCycle, searchKnowledge]) {
    for (const input of ['Test Person', { anonymized: true, text: 'Test Person' }]) {
      assert.throws(() => analysis(input), { code: 'UNSANITIZED_INPUT' });
    }
  }
});

test('JSON processing blocks schema violations and never falls back to original JSON', async () => {
  const { gateway } = mockGateway({ output: '{"email":"[PRIVATE_1]","unexpected":"field"}' });
  await assert.rejects(gateway.json({ safe: 1 }, data => Object.keys(data).length === 1 && data.safe === 1), { code: 'INVALID_PRIVATE_DATA' });
  const malformed = mockGateway({ output: 'not json' }).gateway;
  await assert.rejects(malformed.json({ safe: 1 }, () => true), { code: 'INVALID_PRIVATE_DATA' });
});

const ranges = { freeT3: { low: 2.3, high: 4.2 }, freeT4: { low: 0.8, high: 1.8 }, tsh: { low: 0.4, high: 4 }, hb: { low: 12, high: 15.5 } };
const lab = { id: 123, user_id: 'Test Person', date: '2026-09-12', comments: 'Test Person at test@example.com', free_t3: 3, free_t4: 1, tsh: 5, hb: 11 };

test('lab checks use minimized values and preserve useful high/low flags', async () => {
  const { gateway, requests } = mockGateway({ output: submitted => submitted });
  const assessment = await privateLabFlags([lab], ranges, gateway);
  assert.equal(assessment.status, 'completed');
  assert.deepEqual(assessment.flags, [{ freeT3: 'normal', freeT4: 'normal', tsh: 'high', hb: 'low' }]);
  assert.doesNotMatch(requests[0].body, /Test Person|test@example.com|2026-09-12|user_id|comments/);
});

test('lab checks provide no assessment on outage, missing panels or altered values', async () => {
  for (const output of [null, submitted => submitted.replace('"tsh":5', '"tsh":3'), submitted => JSON.stringify({ ...JSON.parse(submitted), panels: [] })]) {
    const { gateway } = mockGateway({ output });
    const assessment = await privateLabFlags([lab], ranges, gateway);
    assert.deepEqual(assessment, { flags: [null], status: 'unavailable' });
  }
});

test('sanitized prediction features run without identities and cannot be modified', async () => {
  const { gateway } = mockGateway({ output: submitted => submitted });
  const payload = { features: { trackedDays: 1, pastLabPanels: 0, heavyFlowDays: 1, lowEnergyDays: 0, fatigueReports: 0, dizzinessReports: 0, population: 'adult_non_pregnant' },
    latestValues: { ft3: null, ft4: null, tsh: null, hb: null },
    ranges: Object.fromEntries([['ft3', 'freeT3'], ['ft4', 'freeT4'], ['tsh', 'tsh'], ['hb', 'hb']].map(([code, key]) => [code, { ...ranges[key], margin: 0 }])) };
  const safe = await gateway.json(payload, validPredictionInput);
  assert.throws(() => { readPrivateJson(safe).features.population = 'Test Person'; }, TypeError);
  const output = predictLabs(safe);
  assert.equal(output.length, 4);
  assert.equal(output.find(value => value.code === 'hb').predicted, 13.63);
});

test('cycle analysis uses relative days, without calendar dates or account IDs', async () => {
  const { gateway } = mockGateway({ output: submitted => submitted });
  const safe = await gateway.json({ periodOffsets: [-40, -39, -12, -11], trackedDays: 4, averageLength: 28 }, validCycleInput);
  const result = predictCycle(safe);
  assert.equal(result.averageLength, 28);
  assert.equal(result.cycleDay, 13);
  assert.equal(result.lastStartOffset, -12);
});

test('knowledge content is sanitized before both query and document embeddings', async () => {
  const { gateway } = mockGateway({ output: submitted => submitted.replaceAll('Test Person', '[[Name-testhash]]') });
  const safe = await gateway.json({ question: 'Test Person asks about cramps', articles: [{ title: 'Test Person and cramps', topic: 'cycle', summary: 'cramps', content: 'Test Person has cramps', source_title: 'Educational source', source_url: 'https://example.org' }] }, validKnowledgeInput);
  const result = searchKnowledge(safe);
  assert.equal(result.length, 1);
  assert.doesNotMatch(JSON.stringify(result), /Test Person|testhash/);
});
