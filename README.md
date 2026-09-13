# Ovariety

HerHealth is the app name. `Ovariety` is the team name behind the project.

## Deployment Options

This repo currently runs as:
- a Vite/React frontend
- an Express API server
- a local SQLite database via `better-sqlite3`
- uploaded files stored in `uploads/`

### 1. Single server deployment

This is the simplest option and the best fit for the code as it exists today.

How it works:
- run `npm install`
- build the frontend with `npm run build`
- start the API with `npm start`
- serve the built frontend from a reverse proxy like Nginx or Caddy
- proxy `/api` requests to the Node server on port `3001` or your chosen `PORT`

Why it fits:
- the frontend already calls `/api` on the same origin
- SQLite and uploaded files are easiest to manage on one persistent machine or VM
- good targets include a VPS, Railway with persistent storage, Render, or Fly.io with a volume

### 2. Frontend and backend split deployment

This works well if you want the frontend on Vercel, Netlify, or Cloudflare Pages and the API on Render, Railway, or Fly.io.

This repo is now prepared for that split deployment style.

What was added:
- `VITE_API_BASE_URL` support in the frontend
- `ALLOWED_ORIGINS` support in the backend
- bearer-token auth fallback so login persists even when frontend and backend are on different domains
- file export and prescription downloads now work through authenticated fetches instead of same-origin-only links

Typical setup:
- frontend env: `VITE_API_BASE_URL=https://your-api-host`
- backend env: `ALLOWED_ORIGINS=https://your-frontend-host`

You can start from [.env.example](/workspaces/FemNova/.env.example:1).

### Free demo deployment flow

If you want the lowest-cost demo path:
- deploy the backend service from this repo
- set persistent storage for `femnova.db` and `uploads/` if your host supports it
- set backend env vars from `.env.example`
- deploy the frontend as a static site with `VITE_API_BASE_URL` pointing at the backend

Important limitation:
- if the host does not provide persistent disk, SQLite data and uploaded files may reset between deploys or restarts

### 3. Containerized deployment

You can also package the app with Docker for repeatable environments.

Recommended shape:
- one container for the Express API
- one container or static host for the Vite build
- one persistent volume for the SQLite database and `uploads/`

If you want stronger production scaling, Postgres is the next step, but the running app is still wired to SQLite today. The file [database/postgres.sql](/workspaces/FemNova/database/postgres.sql:1) is a useful starting schema, not the active database adapter.

### Production checklist

- set `NODE_ENV=production`
- set `PORT` for the server if your host requires it
- set `DATABASE_PATH` if you do not want the default local `femnova.db`
- keep `uploads/` on persistent storage
- run the app behind HTTPS so secure cookies work correctly in production
- rebuild the frontend after changes with `npm run build`

## Run the current app

On the prepared Windows workspace, enter your key in `.env`, then run
`.\femnova.ps1 privacy:check` and `.\femnova.ps1`. The launcher uses the portable
Node 22 runtime already downloaded into the ignored `.local-tools` folder.

For a fresh checkout, follow the setup below.

Use Node.js 22 (22.9 or newer) with npm. In this folder:

```powershell
npm ci
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

Put your Anymize API key in `.env` as `ANYMIZE_API_KEY=...`. Keep it on the server;
do not paste it into chat, frontend code, or a variable beginning with `VITE_`.
Then run:

```powershell
npm run privacy:check
npm run dev
```

The privacy check sends only a synthetic name and email to Anymize and prints a
pass/fail result. Open the Vite URL shown in the terminal. `npm test` runs mocked
privacy tests without an API key or network access; `npm run build` builds the UI.

All user-data analysis must pass through the Anymize gateway. Without a working
key, chat and analysis stop; saved records can still be entered and viewed.
An unavailable lab check is displayed as unavailable, never as a normal result.
See [the privacy implementation and extension guide](docs/privacy.md).

The sections below are the wider product brief. They include planned features;
the current chatbot still uses educational text matching, not a generative LLM.

## Assessment

The concept is strong and absolutely buildable, but the current prompt is still closer to a product vision than an implementation-ready application spec.

What is already strong:
- Clear core product surfaces: cycle tracking, lab panel, community, chatbot.
- Good visual direction: pastel, floral, phase-reactive UI.
- Thoughtful health features: configurable lab ranges, history, trend views, prediction model, consent.
- Sensible target stack: React + API backend + Postgres + ML service + vector search.

What is missing for a fully functional build:
- Exact user roles and permissions: member, anonymous community poster, moderator, clinician admin, platform admin.
- Data contracts: concrete entities, required fields, validation rules, units, enums, file upload limits.
- Prediction scope: whether the ML service predicts exact values, risk classes, or both, and how confidence is computed.
- Safety boundaries: chatbot refusal/escalation rules for emergencies, self-harm, pregnancy complications, and diagnosis requests.
- Mobile strategy: responsive web alone is not enough; the app should be designed as a PWA or with a shared API/domain layer that can later power React Native or Expo.
- Operational requirements: audit logs, background jobs, notifications, analytics, backups, rate limits, moderation tooling, observability.
- Clinical range governance: versioning rules, effective dates, population segments, unit conversion behavior, approval workflow for changed ranges.
- Accessibility and localization requirements: reduced motion, screen reader labels, color contrast checks, timezone handling, unit preferences, language readiness.

## Recommended Direction

To make this build-ready and future-proof for mobile:
- Build web-first with a shared design system and API-first backend.
- Treat the frontend as a PWA from day one so installability, offline caching, and push notifications are possible.
- Keep all business logic in backend services and shared schema definitions so a future React Native/Expo app can reuse the same APIs.
- Start the ML layer as a rules-plus-baseline model service with clear audit logs and clinician disclaimers, then evolve to a stronger model once real data exists.
- Scope the chatbot as retrieval-grounded educational support, not diagnosis.

## Rewritten Build Prompt

Use the following prompt as the implementation brief for the app.

---

Build a production-minded full-stack menstrual health platform called **HerHealth**. Do not generate a demo-only prototype. Build a real, extensible application with a responsive web experience first and architecture that can later power a mobile app with minimal rework.

### Product Goal

HerHealth helps users track menstrual cycles, symptoms, mood, labs, and hormone-related patterns in one place. It also provides a moderated community and a grounded educational chatbot. The system must surface clinically relevant lab-range flags without claiming to diagnose disease.

### Platform Strategy

- Primary target: responsive web app.
- Secondary target: mobile app readiness.
- The web app must be implemented as a **PWA** with installability, app icons, splash support, offline-safe shell caching, and mobile-friendly navigation.
- Architecture must be **API-first** so the same backend can support a future **React Native / Expo** mobile client.
- Keep domain models, validation schemas, permissions, and API contracts cleanly separated from UI code.

### Core Tech Stack

- Frontend: React + TypeScript.
- App framework: Next.js preferred for routing and SSR-friendly public content, or Vite + React if SSR is intentionally excluded.
- Styling: component-driven design system using CSS variables or Tailwind with theme tokens.
- Backend API: Node.js + Express or NestJS with TypeScript preferred.
- Database: PostgreSQL.
- ORM: Prisma preferred.
- Auth: secure email/password auth with hashed passwords, JWT or secure session cookies, refresh-token flow, optional OAuth provider hooks.
- File storage: S3-compatible storage for prescription uploads.
- Background jobs: queue for ingestion, embeddings, notifications, moderation checks, and analytics tasks.
- Vector search: pgvector preferred for simpler deployment, unless a dedicated vector DB is justified.
- AI chatbot: RAG pipeline using embeddings + retrieval + LLM generation with citations.
- ML service: separate service endpoint or internal service module with versioned models, inference logs, and fallback rules engine.

### Non-Functional Requirements

- Mobile-first responsive layout.
- WCAG AA contrast compliance even within the pastel palette.
- Respect `prefers-reduced-motion`.
- Global animation toggle in settings.
- Encrypt sensitive data in transit and at rest where applicable.
- Per-user data isolation across all private resources.
- Audit logging for auth events, lab edits, reference-range changes, admin actions, and model inferences.
- Rate limiting and abuse protection on auth, community posting, comments, likes, and chatbot endpoints.
- Consent management for health-data processing and chatbot access to user data.
- Data export and account deletion flows.
- Timezone-aware date storage.
- Unit-aware lab entry and display.

### Visual Design System

Use a pastel, soft, feminine visual language without sacrificing contrast.

- Primary color: blush pink `#FFD9E8`.
- Accent colors: lavender-pink, rose, muted berry, warm cream, soft sage for success/normal states.
- UI style: rounded cards, soft shadows, layered panels, elegant typography, gentle gradients.
- Decorative system: illustrated flowers, petals, and subtle botanical borders used intentionally in headers, empty states, onboarding, loading states, and celebratory moments.
- Avoid generic dashboard styling. The app should feel branded and emotionally supportive.

### Animation Rules

- All motion must be subtle, lightweight, and optional.
- Respect `prefers-reduced-motion`.
- Include a user setting to disable decorative animations.
- Phase-reactive animation behavior:
  - Ovulation / high-hormone state: soft confetti, floating balloons, blooming flowers, brighter accents.
  - PMS / low-mood state: muted palette, closed-bud or wilted floral motifs, calmer transitions, supportive self-care copy instead of celebration.
- Do not use flashing or high-frequency motion.

### User Roles

Implement role-based access control with at least these roles:

- `user`: normal app user with private health records.
- `moderator`: reviews reported community content.
- `clinical_admin`: manages lab reference ranges and educational content.
- `platform_admin`: full system administration.

Community posts must support:
- identified posting
- anonymous-within-community posting

Anonymous posts must still remain internally tied to the account for moderation and abuse handling.

### Main Features

## 1. Personal Cycle Tracker

Build a home dashboard focused on cycle awareness and daily logging.

Required capabilities:
- Monthly calendar view with cycle overlays:
  - period days
  - fertile window
  - predicted ovulation
  - luteal / PMS phase
- Daily logging form for:
  - flow intensity
  - mood
  - symptoms: cramps, bloating, acne, headache
  - sleep
  - energy
  - discharge
  - optional basal body temperature
  - notes
- Dashboard cards for:
  - predicted next period
  - cycle length trends
  - phase summary
  - phase-based nutrition and exercise tips
  - latest lab-risk summary synced from the lab page / prediction service
- Empty states and loading states must use themed floral illustrations.

Cycle intelligence rules:
- Support irregular cycles.
- Distinguish logged vs predicted data clearly.
- Allow users to edit past entries.
- Store prediction confidence where applicable.

## 2. Lab & Hormone Panel

Build a clinically cautious lab management page.

Required lab inputs:
- Free T3
- Free T4
- TSH
- Hemoglobin

Optional hormone inputs:
- FSH
- LH
- AMH
- estrogen
- progesterone

Prescription support:
- PDF/image upload
- doctor comments text field

Reference range requirements:
- Store ranges in data tables, never hardcode them in UI logic.
- Support population segments such as:
  - adult non-pregnant
  - pregnancy trimester 1
  - pregnancy trimester 2
  - pregnancy trimester 3
  - adolescent
- Support multiple units per test where relevant.
- Support versioning, effective dates, last-updated metadata, and editor audit trail.
- Clinical admins must be able to update ranges.

Default example ranges:
- FT3: `2.3-4.2 pg/mL`
- FT4: `0.8-1.8 ng/dL`
- TSH: `0.4-4.0 mIU/L`
- Hb: `12.0-15.5 g/dL`

Range-evaluation behavior:
- Show status as `Normal`, `Borderline`, or `Out of range`.
- State whether the value is low or high.
- Show the amount outside the bound.
- Preserve the exact range version used when the evaluation was made.
- Always display: `This is not a diagnosis. Consult a qualified clinician.`

Trend visualization:
- History charts by test over time.
- Shaded reference-range bands.
- Clearly marked out-of-range points.
- Filter by date range and test type.

Prediction service behavior:
- When actual labs are missing, estimate likely FT3, FT4, TSH, and Hb values or risk bands from:
  - symptoms
  - cycle data
  - past labs
- Output:
  - predicted value or risk class
  - confidence score
  - low/high/normal interpretation
  - crossed bound and delta from bound
  - model version
  - explanation summary
- Push latest prediction summary to the home dashboard.

Important safety rule:
- Predictions are assistive signals only and must never be framed as diagnosis.

## 3. Community & Knowledge

Build a moderated community space plus a curated knowledge base.

Community capabilities:
- posts
- comments
- likes
- topic tags
- reporting
- moderation queue
- anonymous posting option

Knowledge base capabilities:
- FAQ articles
- curated Q&A entries
- topics including:
  - menstrual cycle physiology
  - contraception
  - pregnancy and fertility basics
  - PCOS
  - thyroid-cycle interactions
  - red-flag symptoms
- search and filtering by topic

Moderation requirements:
- reported-content workflow
- soft delete / hide states
- moderator notes
- basic abuse rate limits

## 4. Chatbot on Every Page

Build a retrieval-grounded chatbot available globally in the UI.

Knowledge sources:
- curated clinical and educational corpus
- internal FAQ / knowledge base content
- admin-approved menstrual health resources
- thyroid and menstrual interaction resources

RAG requirements:
- embeddings generation pipeline
- chunking and metadata strategy
- vector retrieval
- grounded generation with source citations
- fallback when retrieval confidence is low

Personalization rules:
- With explicit consent, the chatbot may access:
  - recent cycle logs
  - current phase
  - latest lab flags
  - recent prediction summaries
- Without consent, it must answer only from the general knowledge corpus.

Safety behavior:
- Never diagnose.
- For emergency or high-risk symptom questions, instruct the user to seek professional or urgent care.
- For medication, pregnancy complication, or severe abnormal bleeding questions, provide cautious escalation language.
- Clearly separate educational content from personal inference.

### Database Design Requirements

Design a normalized PostgreSQL schema that includes at minimum:

- users
- user_profiles
- consent_records
- auth_sessions or refresh_tokens
- cycle_entries
- symptom_logs
- daily_logs
- mood_logs
- lab_results
- lab_tests
- reference_ranges
- reference_range_versions
- prescription_uploads
- lab_predictions
- model_versions
- inference_audit_logs
- community_posts
- community_comments
- community_likes
- community_reports
- moderation_actions
- knowledge_articles
- faq_entries
- chatbot_conversations
- chatbot_messages
- embeddings_index_metadata
- notification_preferences
- audit_logs

Schema expectations:
- use UUID primary keys
- include `created_at` and `updated_at`
- soft-delete where appropriate
- track source of data: user-entered, clinician-entered, imported, predicted
- maintain foreign key integrity
- support row-level access patterns by user ownership

### API Requirements

Expose a clean REST or GraphQL API with versioning.

Minimum route groups:
- auth
- profile
- cycle tracking
- daily logs
- lab results
- reference ranges
- prescriptions
- predictions
- community
- moderation
- knowledge base
- chatbot
- settings
- consent
- export/delete account

API expectations:
- input validation on every write endpoint
- typed request/response contracts
- role-based authorization
- pagination for feed/history endpoints
- structured error format

### Prediction Service Requirements

Do not present the ML layer as magically accurate.

Phase 1 implementation strategy:
- Create a versioned prediction service that supports:
  - training stub
  - inference stub
  - feature extraction
  - range-crossing logic
  - confidence scoring
  - audit logging
- If real training data is unavailable, start with:
  - deterministic clinical-style heuristics
  - baseline statistical model placeholders
  - clearly labeled simulated confidence
- Make the service replaceable so a stronger model can be deployed later without rewriting product flows.

### RAG Ingestion Requirements

Build an ingestion pipeline that:
- imports approved documents
- normalizes and chunks text
- stores metadata including title, topic, source type, publish date, approval status
- generates embeddings
- upserts vectors
- supports re-indexing when content changes

Citation behavior:
- chatbot answers must cite retrieved sources
- if no adequate source is found, the bot must say it is unsure and avoid fabricated claims

### Settings and Compliance

Include settings screens or data models for:
- animation toggle
- reduced-motion preference override
- notification preferences
- privacy and consent controls
- data export
- account deletion
- anonymous posting preference
- unit preferences where relevant

Compliance-minded requirements:
- minimal retention where possible
- explicit consent capture
- encrypted transport
- sensitive-file handling
- action audit trails

### Mobile App Readiness

Design the project so it can become a mobile app later.

Requirements:
- keep UI logic separate from domain logic
- avoid browser-only assumptions in shared code
- use token/session flows compatible with mobile clients
- define reusable API SDK layer
- use a component and theme system that can be ported to React Native
- prefer file-upload and auth flows that can later support native device capabilities

Optional but recommended:
- organize repo as a monorepo with:
  - `apps/web`
  - `apps/api`
  - `apps/ml` or `services/ml`
  - `packages/ui`
  - `packages/types`
  - `packages/config`
  - `packages/sdk`

### Deliverables

Scaffold the project with:
- frontend app
- backend app
- database schema
- auth flow
- API routes
- reference-range admin model
- lab upload support
- RAG ingestion pipeline
- chatbot integration
- prediction service stub
- community features
- three primary pages wired end-to-end
- PWA setup
- seed data
- environment configuration examples
- README with local setup and architecture notes

### Definition of Done

The application is only considered complete when:
- a user can sign up, log in, and manage private health data
- cycle logs save and render on the dashboard/calendar
- lab results can be entered, flagged against configurable ranges, and charted over time
- missing labs can generate clearly labeled prediction outputs
- the home page displays the latest lab-risk summary
- community posting, commenting, and moderation basics work
- the chatbot answers from curated sources with citations and safe fallback behavior
- the app is responsive, accessible, animation-toggleable, and installable as a PWA
- the backend structure is reusable for a future mobile app

### Guardrails

- Do not hardcode clinical ranges inside UI components.
- Do not claim medical diagnosis.
- Do not leak one user's health data to another user or to the community.
- Do not make the chatbot answer without retrieval grounding for clinical-style questions.
- Do not treat anonymous posting as truly untraceable to moderators/admins.

---

## Notes for the Next Build Phase

If we move from planning into implementation, the next best step is to turn this into:
- a concrete monorepo structure
- Prisma schema
- API contract map
- page-by-page wireframes
- seed/reference data definitions
- phased delivery plan for MVP vs v2
