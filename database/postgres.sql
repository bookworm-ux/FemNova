-- Production PostgreSQL 16+ schema for FemNova.
-- The zero-configuration local runtime uses equivalent SQLite tables prefixed with fn_.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TYPE user_role AS ENUM ('user', 'moderator', 'clinical_admin', 'platform_admin');
CREATE TYPE lab_status AS ENUM ('normal', 'borderline', 'out_of_range');
CREATE TYPE moderation_status AS ENUM ('open', 'reviewed', 'dismissed', 'actioned');

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email citext NOT NULL UNIQUE,
  password_hash text NOT NULL,
  name text NOT NULL,
  role user_role NOT NULL DEFAULT 'user',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE user_profiles (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  population text NOT NULL DEFAULT 'adult_non_pregnant',
  timezone text NOT NULL DEFAULT 'UTC',
  average_cycle_length smallint NOT NULL DEFAULT 28 CHECK (average_cycle_length BETWEEN 15 AND 60),
  animations_enabled boolean NOT NULL DEFAULT true,
  chatbot_personalization boolean NOT NULL DEFAULT false,
  anonymous_by_default boolean NOT NULL DEFAULT false,
  notification_cycle boolean NOT NULL DEFAULT true,
  notification_community boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE consent_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  consent_type text NOT NULL,
  granted boolean NOT NULL,
  policy_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE auth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE daily_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date date NOT NULL,
  flow text NOT NULL DEFAULT 'none' CHECK (flow IN ('none', 'spotting', 'light', 'medium', 'heavy')),
  mood text,
  symptoms jsonb NOT NULL DEFAULT '[]',
  sleep_hours numeric(4,2) CHECK (sleep_hours BETWEEN 0 AND 24),
  sleep_quality smallint CHECK (sleep_quality BETWEEN 1 AND 5),
  energy smallint CHECK (energy BETWEEN 1 AND 5),
  discharge text,
  basal_temperature numeric(4,2) CHECK (basal_temperature BETWEEN 34 AND 43),
  notes text,
  source text NOT NULL DEFAULT 'user_entered',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, date)
);

CREATE TABLE lab_tests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  short_name text NOT NULL,
  default_unit text NOT NULL,
  category text NOT NULL,
  is_core boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE reference_ranges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id uuid NOT NULL REFERENCES lab_tests(id),
  population text NOT NULL,
  unit text NOT NULL,
  low numeric NOT NULL,
  high numeric NOT NULL,
  borderline_margin numeric NOT NULL DEFAULT 0,
  version integer NOT NULL,
  effective_from date NOT NULL,
  effective_to date,
  source_note text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (low < high),
  UNIQUE (test_id, population, unit, version)
);

CREATE TABLE lab_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date date NOT NULL,
  population text NOT NULL,
  comments text,
  source text NOT NULL DEFAULT 'user_entered',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE lab_values (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  result_id uuid NOT NULL REFERENCES lab_results(id) ON DELETE CASCADE,
  test_id uuid NOT NULL REFERENCES lab_tests(id),
  value numeric NOT NULL,
  unit text NOT NULL,
  status lab_status NOT NULL,
  direction text CHECK (direction IS NULL OR direction IN ('low', 'high')),
  delta numeric NOT NULL DEFAULT 0,
  reference_range_id uuid NOT NULL REFERENCES reference_ranges(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (result_id, test_id)
);

CREATE TABLE model_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  version text NOT NULL UNIQUE,
  description text NOT NULL,
  artifact_uri text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE lab_predictions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  model_version_id uuid NOT NULL REFERENCES model_versions(id),
  generated_at timestamptz NOT NULL DEFAULT now(),
  feature_snapshot jsonb NOT NULL,
  explanation text NOT NULL
);

CREATE TABLE prediction_values (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prediction_id uuid NOT NULL REFERENCES lab_predictions(id) ON DELETE CASCADE,
  test_id uuid NOT NULL REFERENCES lab_tests(id),
  predicted_value numeric NOT NULL,
  unit text NOT NULL,
  confidence numeric(4,3) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  status lab_status NOT NULL,
  direction text CHECK (direction IS NULL OR direction IN ('low', 'high')),
  delta numeric NOT NULL DEFAULT 0,
  reference_range_id uuid NOT NULL REFERENCES reference_ranges(id)
);

CREATE TABLE inference_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  prediction_id uuid NOT NULL REFERENCES lab_predictions(id) ON DELETE CASCADE,
  model_version text NOT NULL,
  input_summary jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE prescription_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  result_id uuid REFERENCES lab_results(id) ON DELETE SET NULL,
  original_name text NOT NULL,
  mime_type text NOT NULL,
  size_bytes integer NOT NULL CHECK (size_bytes > 0),
  storage_key text NOT NULL UNIQUE,
  comments text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE community_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic text NOT NULL,
  body text NOT NULL,
  anonymous boolean NOT NULL DEFAULT false,
  hidden boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE community_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body text NOT NULL,
  anonymous boolean NOT NULL DEFAULT false,
  hidden boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE community_likes (
  post_id uuid NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE community_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid REFERENCES community_posts(id) ON DELETE CASCADE,
  comment_id uuid REFERENCES community_comments(id) ON DELETE CASCADE,
  reporter_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason text NOT NULL,
  status moderation_status NOT NULL DEFAULT 'open',
  moderator_note text,
  reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (post_id IS NOT NULL OR comment_id IS NOT NULL)
);

CREATE TABLE knowledge_articles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  topic text NOT NULL,
  summary text NOT NULL,
  content text NOT NULL,
  source_title text NOT NULL,
  source_url text NOT NULL,
  approved boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE knowledge_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id uuid NOT NULL REFERENCES knowledge_articles(id) ON DELETE CASCADE,
  chunk_index integer NOT NULL,
  content text NOT NULL,
  embedding vector(1536) NOT NULL,
  indexed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (article_id, chunk_index)
);

CREATE INDEX knowledge_chunks_embedding_hnsw ON knowledge_chunks USING hnsw (embedding vector_cosine_ops);

CREATE TABLE chatbot_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE chatbot_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES chatbot_conversations(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL,
  citations jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX daily_logs_owner_date ON daily_logs(user_id, date DESC);
CREATE INDEX lab_results_owner_date ON lab_results(user_id, date DESC);
CREATE INDEX posts_feed ON community_posts(created_at DESC) WHERE deleted_at IS NULL AND hidden = false;
CREATE INDEX reports_queue ON community_reports(status, created_at DESC);
CREATE INDEX sessions_expiry ON auth_sessions(expires_at);

-- A production API should SET LOCAL app.user_id after authenticating a request.
ALTER TABLE daily_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE lab_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE lab_predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE prescription_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE chatbot_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY daily_logs_owner ON daily_logs USING (user_id = current_setting('app.user_id', true)::uuid) WITH CHECK (user_id = current_setting('app.user_id', true)::uuid);
CREATE POLICY lab_results_owner ON lab_results USING (user_id = current_setting('app.user_id', true)::uuid) WITH CHECK (user_id = current_setting('app.user_id', true)::uuid);
CREATE POLICY lab_predictions_owner ON lab_predictions USING (user_id = current_setting('app.user_id', true)::uuid) WITH CHECK (user_id = current_setting('app.user_id', true)::uuid);
CREATE POLICY prescription_uploads_owner ON prescription_uploads USING (user_id = current_setting('app.user_id', true)::uuid) WITH CHECK (user_id = current_setting('app.user_id', true)::uuid);
CREATE POLICY chatbot_conversations_owner ON chatbot_conversations USING (user_id = current_setting('app.user_id', true)::uuid) WITH CHECK (user_id = current_setting('app.user_id', true)::uuid);
