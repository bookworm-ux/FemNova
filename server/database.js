import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const databasePath = process.env.DATABASE_PATH || path.join(root, 'femnova.db');

export const db = new Database(databasePath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS fn_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'moderator', 'clinical_admin', 'platform_admin')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS fn_profiles (
  user_id TEXT PRIMARY KEY REFERENCES fn_users(id) ON DELETE CASCADE,
  population TEXT NOT NULL DEFAULT 'adult_non_pregnant',
  timezone TEXT NOT NULL DEFAULT 'UTC',
  average_cycle_length INTEGER NOT NULL DEFAULT 28,
  animations_enabled INTEGER NOT NULL DEFAULT 1,
  chatbot_personalization INTEGER NOT NULL DEFAULT 0,
  anonymous_by_default INTEGER NOT NULL DEFAULT 0,
  notification_cycle INTEGER NOT NULL DEFAULT 1,
  notification_community INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS fn_consents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES fn_users(id) ON DELETE CASCADE,
  consent_type TEXT NOT NULL,
  granted INTEGER NOT NULL,
  policy_version TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS fn_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES fn_users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS fn_daily_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES fn_users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  flow TEXT NOT NULL DEFAULT 'none' CHECK (flow IN ('none', 'spotting', 'light', 'medium', 'heavy')),
  mood TEXT,
  symptoms TEXT NOT NULL DEFAULT '[]',
  sleep_hours REAL,
  sleep_quality INTEGER,
  energy INTEGER CHECK (energy BETWEEN 1 AND 5),
  discharge TEXT,
  basal_temperature REAL,
  notes TEXT,
  source TEXT NOT NULL DEFAULT 'user_entered',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, date)
);

CREATE TABLE IF NOT EXISTS fn_lab_tests (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  short_name TEXT NOT NULL,
  default_unit TEXT NOT NULL,
  category TEXT NOT NULL,
  is_core INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS fn_reference_ranges (
  id TEXT PRIMARY KEY,
  test_id TEXT NOT NULL REFERENCES fn_lab_tests(id),
  population TEXT NOT NULL,
  unit TEXT NOT NULL,
  low REAL NOT NULL,
  high REAL NOT NULL,
  borderline_margin REAL NOT NULL DEFAULT 0.1,
  version INTEGER NOT NULL,
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  source_note TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT REFERENCES fn_users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (test_id, population, unit, version)
);

CREATE TABLE IF NOT EXISTS fn_lab_results (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES fn_users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  population TEXT NOT NULL,
  comments TEXT,
  source TEXT NOT NULL DEFAULT 'user_entered',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS fn_lab_values (
  id TEXT PRIMARY KEY,
  result_id TEXT NOT NULL REFERENCES fn_lab_results(id) ON DELETE CASCADE,
  test_id TEXT NOT NULL REFERENCES fn_lab_tests(id),
  value REAL NOT NULL,
  unit TEXT NOT NULL,
  status TEXT NOT NULL,
  direction TEXT,
  delta REAL NOT NULL DEFAULT 0,
  reference_range_id TEXT NOT NULL REFERENCES fn_reference_ranges(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (result_id, test_id)
);

CREATE TABLE IF NOT EXISTS fn_model_versions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS fn_lab_predictions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES fn_users(id) ON DELETE CASCADE,
  model_version_id TEXT NOT NULL REFERENCES fn_model_versions(id),
  generated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  feature_snapshot TEXT NOT NULL,
  explanation TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fn_prediction_values (
  id TEXT PRIMARY KEY,
  prediction_id TEXT NOT NULL REFERENCES fn_lab_predictions(id) ON DELETE CASCADE,
  test_id TEXT NOT NULL REFERENCES fn_lab_tests(id),
  predicted_value REAL NOT NULL,
  unit TEXT NOT NULL,
  confidence REAL NOT NULL,
  status TEXT NOT NULL,
  direction TEXT,
  delta REAL NOT NULL DEFAULT 0,
  reference_range_id TEXT NOT NULL REFERENCES fn_reference_ranges(id)
);

CREATE TABLE IF NOT EXISTS fn_inference_audit_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES fn_users(id) ON DELETE CASCADE,
  prediction_id TEXT NOT NULL REFERENCES fn_lab_predictions(id) ON DELETE CASCADE,
  model_version TEXT NOT NULL,
  input_summary TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS fn_prescriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES fn_users(id) ON DELETE CASCADE,
  result_id TEXT REFERENCES fn_lab_results(id) ON DELETE SET NULL,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  storage_name TEXT NOT NULL,
  comments TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS fn_community_posts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES fn_users(id) ON DELETE CASCADE,
  topic TEXT NOT NULL,
  body TEXT NOT NULL,
  anonymous INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS fn_community_comments (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES fn_community_posts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES fn_users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  anonymous INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS fn_community_likes (
  post_id TEXT NOT NULL REFERENCES fn_community_posts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES fn_users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS fn_community_reports (
  id TEXT PRIMARY KEY,
  post_id TEXT REFERENCES fn_community_posts(id) ON DELETE CASCADE,
  comment_id TEXT REFERENCES fn_community_comments(id) ON DELETE CASCADE,
  reporter_id TEXT NOT NULL REFERENCES fn_users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewed', 'dismissed', 'actioned')),
  moderator_note TEXT,
  reviewed_by TEXT REFERENCES fn_users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS fn_knowledge_articles (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  topic TEXT NOT NULL,
  summary TEXT NOT NULL,
  content TEXT NOT NULL,
  source_title TEXT NOT NULL,
  source_url TEXT NOT NULL,
  approved INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS fn_knowledge_chunks (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL REFERENCES fn_knowledge_articles(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  embedding TEXT NOT NULL,
  indexed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (article_id, chunk_index)
);

CREATE TABLE IF NOT EXISTS fn_chat_conversations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES fn_users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS fn_chat_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES fn_chat_conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  citations TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS fn_audit_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES fn_users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_fn_daily_logs_user_date ON fn_daily_logs(user_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_fn_lab_results_user_date ON fn_lab_results(user_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_fn_sessions_user_expires ON fn_sessions(user_id, expires_at DESC);
CREATE INDEX IF NOT EXISTS idx_fn_predictions_user_generated ON fn_lab_predictions(user_id, generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_fn_posts_created ON fn_community_posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fn_reports_status ON fn_community_reports(status, created_at DESC);
`);

const userColumns = db.prepare('PRAGMA table_info(fn_users)').all().map((column) => column.name);
if (!userColumns.includes('auto_provisioned')) {
  db.exec(`ALTER TABLE fn_users ADD COLUMN auto_provisioned INTEGER NOT NULL DEFAULT 0`);
}

const profileColumns = db.prepare('PRAGMA table_info(fn_profiles)').all().map((column) => column.name);
if (!profileColumns.includes('last_prediction_at')) {
  db.exec(`ALTER TABLE fn_profiles ADD COLUMN last_prediction_at TEXT`);
}

const labTests = [
  ['ft3', 'Free T3', 'FT3', 'pg/mL', 'thyroid', 1],
  ['ft4', 'Free T4', 'FT4', 'ng/dL', 'thyroid', 1],
  ['tsh', 'Thyroid stimulating hormone', 'TSH', 'mIU/L', 'thyroid', 1],
  ['hb', 'Hemoglobin', 'Hb', 'g/dL', 'blood', 1],
  ['fsh', 'Follicle-stimulating hormone', 'FSH', 'mIU/mL', 'hormone', 0],
  ['lh', 'Luteinizing hormone', 'LH', 'mIU/mL', 'hormone', 0],
  ['amh', 'Anti-Mullerian hormone', 'AMH', 'ng/mL', 'hormone', 0],
  ['estrogen', 'Estradiol', 'E2', 'pg/mL', 'hormone', 0],
  ['progesterone', 'Progesterone', 'P4', 'ng/mL', 'hormone', 0]
];

const insertTest = db.prepare(`
  INSERT OR IGNORE INTO fn_lab_tests (id, code, name, short_name, default_unit, category, is_core)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);
for (const test of labTests) insertTest.run(randomUUID(), ...test);

const defaultRanges = {
  ft3: [2.3, 4.2, 'pg/mL'],
  ft4: [0.8, 1.8, 'ng/dL'],
  tsh: [0.4, 4.0, 'mIU/L'],
  hb: [12.0, 15.5, 'g/dL'],
  fsh: [3.0, 10.0, 'mIU/mL'],
  lh: [2.0, 12.0, 'mIU/mL'],
  amh: [1.0, 4.0, 'ng/mL'],
  estrogen: [30.0, 400.0, 'pg/mL'],
  progesterone: [0.1, 25.0, 'ng/mL']
};
const CORE_RANGE_CODES = new Set(['ft3', 'ft4', 'tsh', 'hb']);
const populations = ['adult_non_pregnant', 'pregnancy_t1', 'pregnancy_t2', 'pregnancy_t3', 'adolescent'];
const insertRange = db.prepare(`
  INSERT OR IGNORE INTO fn_reference_ranges
    (id, test_id, population, unit, low, high, borderline_margin, version, effective_from, source_note)
  VALUES (?, ?, ?, ?, ?, ?, ?, 1, '2026-01-01', ?)
`);
for (const [code, [low, high, unit]] of Object.entries(defaultRanges)) {
  const test = db.prepare('SELECT id FROM fn_lab_tests WHERE code = ?').get(code);
  for (const population of populations) {
    insertRange.run(
      randomUUID(),
      test.id,
      population,
      unit,
      low,
      high,
      Math.max((high - low) * 0.1, 0.05),
      CORE_RANGE_CODES.has(code)
        ? 'HerHealth example range. Replace with the reporting laboratory range; assay and population ranges vary.'
        : 'Broad illustrative tracking band only. Hormone interpretation varies substantially by cycle phase, assay, age, and clinical context.'
    );
  }
}

db.prepare(`
  INSERT OR IGNORE INTO fn_model_versions (id, name, version, description)
  VALUES (?, 'HerHealth deterministic baseline', 'baseline-1.0.0', 'Auditable rules-based placeholder; not a clinically validated ML model.')
`).run(randomUUID());

const articles = [
  {
    slug: 'understanding-cycle', title: 'Understanding your menstrual cycle', topic: 'Cycle basics',
    summary: 'How cycle days, phases, and personal variation fit together.',
    content: 'A menstrual cycle is counted from the first day of bleeding to the day before the next period. The follicular phase starts with menstruation, ovulation often occurs later, and the luteal phase follows. Timing varies between people and between cycles. Tracking several months can help reveal your own pattern.',
    sourceTitle: 'Office on Women’s Health: Menstrual cycle', sourceUrl: 'https://womenshealth.gov/menstrual-cycle/your-menstrual-cycle'
  },
  {
    slug: 'phase-nutrition', title: 'Food, iron, and steady energy', topic: 'Nutrition',
    summary: 'Practical, non-restrictive nutrition support across the cycle.',
    content: 'Regular meals containing protein, fibre, and carbohydrates can support steady energy. Iron-rich foods may be especially relevant for people who menstruate, and vitamin C can improve absorption of iron from plant foods. Individual needs vary, particularly with allergies or medical conditions.',
    sourceTitle: 'NIH Office of Dietary Supplements: Iron', sourceUrl: 'https://ods.od.nih.gov/factsheets/Iron-Consumer/'
  },
  {
    slug: 'mood-and-cycle', title: 'Mood changes and the cycle', topic: 'Mood & energy',
    summary: 'Hormonal shifts may overlap with mood, sleep, and energy changes.',
    content: 'Some people notice mood, sleep, appetite, or energy changes before a period. Symptoms that are severe, persistent, or disruptive deserve support from a qualified healthcare professional. Hormones can be one factor and should not be assumed to explain every mental health symptom.',
    sourceTitle: 'ACOG: Premenstrual syndrome', sourceUrl: 'https://www.acog.org/womens-health/faqs/premenstrual-syndrome-pms'
  },
  {
    slug: 'thyroid-labs', title: 'Thyroid labs and menstrual health', topic: 'Thyroid & labs',
    summary: 'What FT3, FT4, and TSH measure and why context matters.',
    content: 'TSH and thyroid hormone tests are interpreted together with symptoms, medical history, medicines, pregnancy status, and the laboratory reference interval. A result outside a range is not by itself a diagnosis. Thyroid conditions can coincide with menstrual changes, but only a clinician can assess the cause.',
    sourceTitle: 'NIDDK: Thyroid tests', sourceUrl: 'https://www.niddk.nih.gov/health-information/diagnostic-tests/thyroid'
  },
  {
    slug: 'contraception-basics', title: 'Contraception basics', topic: 'Contraception',
    summary: 'A starting point for comparing contraception options.',
    content: 'Contraception options include barrier methods, short-acting hormonal methods, long-acting reversible methods, and permanent methods. Effectiveness, side effects, health history, access, and personal preference all matter. A clinician or pharmacist can help compare safe options.',
    sourceTitle: 'CDC: Contraception and birth control methods', sourceUrl: 'https://www.cdc.gov/contraception/about/'
  },
  {
    slug: 'pcos-basics', title: 'PCOS basics', topic: 'PCOS',
    summary: 'Common features of PCOS and when to seek assessment.',
    content: 'Polycystic ovary syndrome can involve irregular periods, signs of excess androgens, and changes seen on ultrasound, but experiences vary. Similar symptoms can have other causes. Assessment and treatment should be individualized by a qualified healthcare professional.',
    sourceTitle: 'WHO: Polycystic ovary syndrome', sourceUrl: 'https://www.who.int/news-room/fact-sheets/detail/polycystic-ovary-syndrome'
  },
  {
    slug: 'pregnancy-fertility', title: 'Pregnancy and fertility basics', topic: 'Pregnancy',
    summary: 'Testing, timing, and why cycle predictions are estimates.',
    content: 'A missed period can have several causes. A pregnancy test is more reliable than a cycle prediction for checking pregnancy. Fertile-window estimates are not guaranteed contraception and do not confirm ovulation. Seek clinical advice for pregnancy concerns or persistent difficulty conceiving.',
    sourceTitle: 'NHS: Doing a pregnancy test', sourceUrl: 'https://www.nhs.uk/pregnancy/trying-for-a-baby/doing-a-pregnancy-test/'
  },
  {
    slug: 'preventing-pregnancy', title: 'Preventing pregnancy and using contraception', topic: 'Pregnancy',
    summary: 'Why fertile-window apps are estimates and contraception should be used consistently when avoiding pregnancy.',
    content: 'Fertility awareness apps can estimate when pregnancy is more likely, but they cannot confirm ovulation on their own. If you want to avoid pregnancy, use a reliable contraceptive method every time you have penis-in-vagina sex. Condoms also reduce the risk of many sexually transmitted infections. A clinician or pharmacist can help compare options that fit your health history and preferences.',
    sourceTitle: 'CDC: Contraception and birth control methods', sourceUrl: 'https://www.cdc.gov/contraception/about/'
  },
  {
    slug: 'red-flags', title: 'When symptoms need urgent care', topic: 'Safety',
    summary: 'Warning signs that should not wait for an app response.',
    content: 'Seek urgent medical help for fainting, chest pain, trouble breathing, severe or rapidly worsening pelvic pain, possible pregnancy with severe pain or bleeding, bleeding that soaks through pads or tampons very rapidly, or thoughts of self-harm. Local emergency services can assess immediate risk.',
    sourceTitle: 'NHS: Heavy periods', sourceUrl: 'https://www.nhs.uk/conditions/heavy-periods/'
  }
];
const insertArticle = db.prepare(`
  INSERT OR IGNORE INTO fn_knowledge_articles
    (id, slug, title, topic, summary, content, source_title, source_url)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);
for (const article of articles) {
  insertArticle.run(randomUUID(), article.slug, article.title, article.topic, article.summary, article.content, article.sourceTitle, article.sourceUrl);
}

// Indexing raw database content at startup would bypass the privacy gateway.
// rankKnowledge now sanitizes approved content before computing any embeddings.

export function audit(userId, action, entityType, entityId = null, metadata = {}) {
  db.prepare(`
    INSERT INTO fn_audit_logs (id, user_id, action, entity_type, entity_id, metadata)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(randomUUID(), userId || null, action, entityType, entityId, JSON.stringify(metadata));
}

export function parseJson(value, fallback = null) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

export function closeDatabase() {
  db.close();
}
