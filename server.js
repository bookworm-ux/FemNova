import express from 'express';
import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createChatHandler } from './server/chat.js';
import { privateLabFlags } from './server/lab-privacy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database(process.env.DATABASE_PATH || path.join(__dirname, 'femnova.db'));
db.pragma('journal_mode = WAL');
db.exec(`CREATE TABLE IF NOT EXISTS cycle_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, date TEXT NOT NULL, flow TEXT, mood TEXT, energy INTEGER, symptoms TEXT, notes TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS labs (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, date TEXT NOT NULL, free_t3 REAL, free_t4 REAL, tsh REAL, hb REAL, comments TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS community_posts (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, author TEXT, topic TEXT, body TEXT NOT NULL, likes INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS reference_ranges (test TEXT PRIMARY KEY, low REAL NOT NULL, high REAL NOT NULL, unit TEXT NOT NULL, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS rag_documents (id INTEGER PRIMARY KEY AUTOINCREMENT, topic TEXT, content TEXT NOT NULL);`);
const ranges = [['freeT3',2.3,4.2,'pg/mL'],['freeT4',0.8,1.8,'ng/dL'],['tsh',0.4,4.0,'mIU/L'],['hb',12.0,15.5,'g/dL']];
const rangeInsert = db.prepare('INSERT OR IGNORE INTO reference_ranges (test, low, high, unit) VALUES (?, ?, ?, ?)'); ranges.forEach(range => rangeInsert.run(...range));
const seedPosts = db.prepare('SELECT COUNT(*) as count FROM community_posts').get();
if (!seedPosts.count) { const insert = db.prepare('INSERT INTO community_posts (user_id, author, topic, body, likes) VALUES (?, ?, ?, ?, ?)'); insert.run('demo','Maya','Cycle care','I started writing down my energy instead of judging it. The pattern was kinder than I expected.',3); insert.run('demo','Anika','Mood & energy','What helps you feel supported during the first few days of your cycle?',5); }
const app = express(); app.use(express.json()); app.use(express.static(path.join(__dirname, 'dist')));
const USER = 'local-user';
const getRanges = () => Object.fromEntries(db.prepare('SELECT * FROM reference_ranges').all().map(row => [row.test,row]));
const labsWithFlags = async () => {
  const labs = db.prepare('SELECT * FROM labs WHERE user_id=? ORDER BY date DESC, id DESC').all(USER);
  const assessment = await privateLabFlags(labs, getRanges());
  return labs.map((lab, index) => ({ ...lab, freeT3: lab.free_t3, freeT4: lab.free_t4, flags: assessment.flags[index], flagStatus: assessment.status }));
};
app.get('/api/dashboard', async (req,res) => { const latest=db.prepare('SELECT * FROM cycle_logs WHERE user_id=? ORDER BY date DESC,id DESC LIMIT 1').get(USER); const labs=await labsWithFlags(); const unavailable=labs[0]?.flagStatus === 'unavailable'; const flagged=unavailable ? null : labs[0] ? Object.values(labs[0].flags).filter(flag => flag && flag !== 'normal').length : 0; const logs=db.prepare('SELECT energy FROM cycle_logs WHERE user_id=? AND energy IS NOT NULL').all(USER); const averageLength=28; res.json({latest, labSummary:{flagged, status: unavailable ? 'unavailable' : 'completed', latest:labs[0] || null}, cycle:{averageLength,nextPeriod:'October 10', loggedDays:logs.length}}); });
app.get('/api/cycle', (req,res) => res.json(db.prepare('SELECT * FROM cycle_logs WHERE user_id=? ORDER BY date DESC').all(USER)));
app.post('/api/cycle', (req,res) => { const {date,flow,mood,energy,symptoms,notes}=req.body; if(!date) return res.status(400).json({error:'date is required'}); const result=db.prepare('INSERT INTO cycle_logs (user_id,date,flow,mood,energy,symptoms,notes) VALUES (?,?,?,?,?,?,?)').run(USER,date,flow,mood,energy,symptoms,notes); res.json({id:result.lastInsertRowid}); });
app.get('/api/labs', async (req,res) => res.json(await labsWithFlags()));
app.post('/api/labs', (req,res) => { const {date,freeT3,freeT4,tsh,hb,comments}=req.body; if(!date) return res.status(400).json({error:'date is required'}); const result=db.prepare('INSERT INTO labs (user_id,date,free_t3,free_t4,tsh,hb,comments) VALUES (?,?,?,?,?,?,?)').run(USER,date,freeT3||null,freeT4||null,tsh||null,hb||null,comments||''); res.json({id:result.lastInsertRowid}); });
app.get('/api/community', (req,res) => res.json(db.prepare("SELECT * FROM community_posts WHERE user_id='demo' OR user_id=? ORDER BY id DESC").all(USER)));
app.post('/api/community', (req,res) => { const {body,topic='General'}=req.body; if(!body?.trim()) return res.status(400).json({error:'body is required'}); const result=db.prepare('INSERT INTO community_posts (user_id,author,topic,body) VALUES (?,?,?,?)').run(USER,'You',topic,body.trim()); res.json({id:result.lastInsertRowid}); });
app.post('/api/chat', createChatHandler());
app.get(/.*/, (req,res) => res.sendFile(path.join(__dirname,'dist','index.html')));
const port=process.env.PORT||3001; const server=app.listen(port,()=>console.log(`FemNova API running on http://localhost:${server.address().port}`));
