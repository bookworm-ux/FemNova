# FemNova privacy requirement

Anymize is the only model service allowed to inspect identifiable inputs. The
trusted backend may store/display records and prepare minimal inputs; analysis
must consume only outputs issued by `server/privacy.js`.

- Apply this to LLMs, embeddings, prediction rules, Python scripts, analytics,
  retrieval documents, chat history, tool results and future training exports.
- Use the existing gateway and guarded analysis entry points. Never bypass it
  during an outage or missing configuration; never fall back to original input.
- Do not log original data, provider responses, identity mappings or credentials.
- Keep raw database access in trusted preparation/persistence code. Future script
  workers need process/container isolation without private filesystem access or
  database credentials; the current single-process contract is not a sandbox.
- Use synthetic test data. Do not send real records to providers during testing.
- Read `docs/privacy.md` before extending processing paths. Use Node.js 22 and run
  the relevant privacy tests and frontend build after changes.
