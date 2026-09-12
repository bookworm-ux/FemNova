import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { db } from '../server/database.js';
import { chunkText, createEmbedding } from '../server/vector.js';

const sourcePath = process.argv[2];
if (!sourcePath) {
  console.error('Usage: npm run rag:ingest -- path/to/approved-corpus.json');
  process.exit(1);
}

const resolved = path.resolve(process.cwd(), sourcePath);
const documents = JSON.parse(fs.readFileSync(resolved, 'utf8'));
if (!Array.isArray(documents)) throw new Error('Corpus must be a JSON array.');

const upsertArticle = db.prepare(`
  INSERT INTO fn_knowledge_articles
    (id, slug, title, topic, summary, content, source_title, source_url, approved, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
  ON CONFLICT(slug) DO UPDATE SET
    title = excluded.title, topic = excluded.topic, summary = excluded.summary,
    content = excluded.content, source_title = excluded.source_title,
    source_url = excluded.source_url, approved = 1, updated_at = CURRENT_TIMESTAMP
`);
const upsertChunk = db.prepare(`
  INSERT INTO fn_knowledge_chunks (id, article_id, chunk_index, content, embedding, indexed_at)
  VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
`);

let chunksIndexed = 0;
db.transaction(() => {
  for (const document of documents) {
    for (const field of ['slug', 'title', 'topic', 'summary', 'content', 'sourceTitle', 'sourceUrl']) {
      if (!document[field]) throw new Error(`Document is missing ${field}.`);
    }
    const existing = db.prepare('SELECT id FROM fn_knowledge_articles WHERE slug = ?').get(document.slug);
    const articleId = existing?.id || randomUUID();
    upsertArticle.run(articleId, document.slug, document.title, document.topic, document.summary, document.content, document.sourceTitle, document.sourceUrl);
    db.prepare('DELETE FROM fn_knowledge_chunks WHERE article_id = ?').run(articleId);
    chunkText(`${document.title}. ${document.summary} ${document.content}`).forEach((content, index) => {
      upsertChunk.run(randomUUID(), articleId, index, content, JSON.stringify(createEmbedding(content)));
      chunksIndexed += 1;
    });
  }
})();

console.log(`Indexed ${documents.length} approved documents into ${chunksIndexed} retrieval chunks.`);
