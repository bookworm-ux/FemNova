import { setTimeout as delay } from 'node:timers/promises';

// Only this module may handle Anymize responses. Never log request/response bodies.
const API = 'https://app.anymize.ai/api';
const approved = new WeakMap();
const MAX_TEXT = 48_000;

export class PrivacyError extends Error {
  constructor(code = 'PRIVACY_UNAVAILABLE') {
    super('Privacy protection is unavailable. Analysis was not performed.');
    this.name = 'PrivacyError';
    this.code = code;
  }
}

function issue(kind, value) {
  const handle = Object.freeze({});
  approved.set(handle, { kind, value });
  return handle;
}

function inspect(handle) {
  const record = handle && typeof handle === 'object' && approved.get(handle);
  if (!record) throw new PrivacyError('UNSANITIZED_INPUT');
  return record;
}

export function readPrivateText(handle, path = []) {
  const record = inspect(handle);
  let value = record.value;
  for (const key of path) {
    if (!value || !Object.hasOwn(value, key)) throw new PrivacyError('INVALID_PRIVATE_DATA');
    value = value[key];
  }
  if (typeof value !== 'string') throw new PrivacyError('INVALID_PRIVATE_DATA');
  return value;
}

export function readPrivateJson(handle) {
  const record = inspect(handle);
  if (record.kind !== 'json') throw new PrivacyError('INVALID_PRIVATE_DATA');
  return record.value;
}

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function cleanOutput(text) {
  if (typeof text !== 'string' || !text.trim() || text.length > MAX_TEXT) throw new PrivacyError();
  // Provider placeholder hashes must not become stable tracking identifiers.
  const replacements = new Map();
  const cleaned = text.replace(/\[\[[^\[\]\r\n]{1,200}\]\]/g, (placeholder) => {
    if (!replacements.has(placeholder)) replacements.set(placeholder, `[PRIVATE_${replacements.size + 1}]`);
    return replacements.get(placeholder);
  });
  // A supplemental check, not a claim that regex detects every identifying detail.
  const obviousIdentifier = /[\w.+-]+@[\w.-]+\.[a-z]{2,}|(?:\+|00)\d(?:[\s().-]*\d){7,14}\b|\b\d{4}-\d{2}-\d{2}\b|\b[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}\b/i;
  if (obviousIdentifier.test(cleaned)) throw new PrivacyError('PRIVACY_REVIEW_REQUIRED');
  return cleaned;
}

export function createPrivacyGateway({ apiKey, fetchImpl = globalThis.fetch, timeoutMs = 20_000, pollMs = 400 } = {}) {
  async function text(input) {
    if (typeof input !== 'string' || !input.trim() || input.length > MAX_TEXT) throw new PrivacyError('INVALID_PRIVATE_INPUT');
    const key = apiKey ?? process.env.ANYMIZE_API_KEY;
    if (!key?.trim()) throw new PrivacyError('PRIVACY_NOT_CONFIGURED');
    const signal = AbortSignal.timeout(timeoutMs);

    async function request(endpoint, body) {
      const response = await fetchImpl(`${API}${endpoint}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: 'error',
        cache: 'no-store',
        signal,
      });
      if (!response.ok) throw new PrivacyError();
      // The response includes originals too, so bound its size before parsing.
      const reader = response.body?.getReader();
      if (!reader) throw new PrivacyError();
      const chunks = [];
      let length = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > 512_000) {
          await reader.cancel();
          throw new PrivacyError();
        }
        chunks.push(value);
      }
      const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      signal.throwIfAborted();
      return data;
    }

    try {
      const job = await request('/anonymize', { text: input });
      if (job?.status !== 'processing' || !/^[a-z\d-]{1,128}$/i.test(job.job_id || '')) throw new PrivacyError();
      while (true) {
        signal.throwIfAborted();
        const result = await request(`/status/${encodeURIComponent(job.job_id)}`);
        if (result?.job_id !== job.job_id) throw new PrivacyError();
        if (result.status === 'completed') {
          // NEVER forward original_text, metadata, job IDs, or mapping tables.
          return issue('text', cleanOutput(result.anonymized_text_raw));
        }
        if (result.status !== 'processing') throw new PrivacyError();
        await delay(pollMs, undefined, { signal });
      }
    } catch (error) {
      // Provider and transport errors can contain originals or credentials.
      throw error instanceof PrivacyError ? error : new PrivacyError();
    }
  }

  async function json(input, validate) {
    try {
      const result = await text(JSON.stringify(input));
      const data = JSON.parse(readPrivateText(result));
      if (typeof validate !== 'function' || !validate(data)) throw new PrivacyError('INVALID_PRIVATE_DATA');
      return issue('json', freeze(data));
    } catch (error) {
      throw error instanceof PrivacyError ? error : new PrivacyError('INVALID_PRIVATE_DATA');
    }
  }

  return Object.freeze({ text, json });
}

export const privacy = createPrivacyGateway();
