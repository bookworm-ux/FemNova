# Anymize in FemNova

The trusted application stores and displays private records, prepares minimal
inputs, and associates results with the correct account. Anymize is the only
model service allowed to inspect identifiable input. Downstream analysis receives
only a gateway-issued sanitized payload.

## Setup

This prepared Windows workspace includes `femnova.ps1`: after entering your key,
run `.\femnova.ps1 privacy:check`, then `.\femnova.ps1` to start. It selects the
portable Node 22 runtime in `.local-tools`, or a system Node 22 installation.
The portable runtime and local dependencies are ignored by Git.

1. Install Node.js 22 (22.9 or newer) and run `npm ci` in the project folder.
2. Copy `.env.example` to `.env`, then enter `ANYMIZE_API_KEY` locally. Existing
   `.env` files should be edited, not overwritten. The key is never sent to the browser.
3. Run `npm run privacy:check`. This is an opt-in live test using synthetic data.
4. Run `npm run dev`. Both start scripts load `.env` automatically.

The existing SQLite dependency has a prebuilt Windows binary for Node 22. The
project declares this runtime in `package.json` and `.nvmrc`; verification used
Node 22.23.2. Using Node 24 with the old SQLite dependency requires a native build.

There is no bypass switch, direct-provider fallback, or automatic de-anonymization.
Anymize availability is required even for local analysis. Missing keys, provider
errors, malformed output, failed validation and the 20-second deadline block it.

## What is connected

| Path | Input sent through Anymize | Behavior if blocked |
| --- | --- | --- |
| `/api/chat` | Current question, up to 4,000 characters | HTTP 503; Nova does not process it |
| Lab range checks | Numeric panels and reference ranges; no IDs, dates or comments | Saved values remain visible, flags are unavailable |
| `getCycleContext` / `phaseForDate` | Relative day offsets, counts and configured cycle length | Rejects; no prediction |
| `generatePrediction` | Counts, population category, prior lab values and ranges | Rejects before inference or persistence |
| `rankKnowledge` | Question and approved educational documents | Rejects before query or document embeddings |

The latter three are groundwork in `server/health.js`, not newly exposed API
routes. They now return promises, so future callers must `await` them. The unsafe
startup indexing of database content was removed; knowledge search computes its
vectors only after sanitization. Old stored embeddings are not used by this path.
The dashboard's existing hardcoded cycle forecast is still placeholder UI.

## Gateway contract

`server/privacy.js` follows the [Anymize REST documentation](https://developers.anymize.ai/):
it submits text, polls the matching job, and extracts only the completed
`anonymized_text_raw`. It discards all other response fields, including
`original_text`, job metadata and mapping data. Requests use a fixed HTTPS origin
and refuse redirects. Provider errors are replaced by fixed, non-sensitive errors.

Provider placeholder hashes are replaced by request-local labels such as
`[PRIVATE_1]`. A supplemental check rejects obvious remaining emails, international
phone numbers, ISO dates and UUIDs. This check is not a complete identity detector.
Names and indirect identifiers still depend on Anymize's detection quality.

Returned handles are opaque, frozen objects tracked in a private WeakMap. Plain
strings, copied handles, JSON and `{ anonymized: true }` cannot be passed directly
to analysis entry points. JSON results additionally require a schema validator and
are deeply frozen. Numeric analysis requires the sanitized payload to retain its
exact prepared structure and values; altered or redacted measurements block the
calculation instead of being silently replaced with original values.

Application input/output bodies and Anymize responses must not be included in
logs, tracing, analytics, error reports or development recordings. Configure any
future observability system accordingly. Tests use synthetic fixtures only.

## Adding an LLM or another analysis

Keep preparation in the trusted backend and processing in an analysis module.
Do not import the private database into the analysis module.

```js
// Trusted route: include ALL variable context, history and retrieved text here.
const safe = await privacy.json(
  { question, history, context },
  validateChatInput,
);
const result = await answerWithModel(safe);

// Analysis module: the gateway is the only source of model input.
async function answerWithModel(safe) {
  const { question, history, context } = readPrivateJson(safe);
  return modelClient.answer({ question, history, context });
}
```

`validateChatInput` and `modelClient` above are examples to implement when adding
that feature; neither is a current dependency. Validators must reject unknown
fields and check types, lengths, enums and numeric limits. Use a minimal allowlist
before sending structured records to Anymize. Do not pass whole database rows.
Never append raw context to a sanitized prompt or reuse an old approval after
changing its content. Send newly introduced history, tool results or documents
through the gateway before another processing step.

For a Python worker, serialize only `readPrivateJson(safe)` into its input. Raw
records, identity mappings, upload paths and Anymize job IDs must never be passed.
Any request token needed to attach the result to an account stays in the trusted
backend, outside the analysis input. Python workers and LLM providers have not
been added by this change.

## Enforcement limits and deployment

This is the smallest integration for the current single-process app: an enforced
input contract at existing analysis entry points, not an operating-system sandbox.
It cannot prevent future code with database credentials or filesystem access from
deliberately bypassing the gateway.

Before enabling arbitrary scripts or untrusted tools, put them in separate worker
processes/containers with no private database credentials, private filesystem
mounts, identity mappings or Anymize credentials. Deliver sanitized jobs from the
trusted service, and restrict network access to their required processing service.
Do not run arbitrary Python scripts in this repository with access to its database.

Keep the API key and raw health storage out of the frontend and deployment logs.
Set appropriate retention for originals/mappings in your Anymize account. No
mapping retrieval or re-identification endpoint is used here. Sanitized individual
health records can remain linkable; this implementation does not assert that they
are irreversibly anonymous.

## Verification

`npm test` covers blocked requests, timeouts, provider errors, non-leaking error
messages, invalid/forged handles, schema rejection, preservation of measurements,
and sanitized-only inputs to chat, lab, prediction, cycle and embedding functions.
`npm run privacy:check` separately checks your configured live Anymize account.
Automated fixtures cannot establish Anymize's detection accuracy for real patients.
