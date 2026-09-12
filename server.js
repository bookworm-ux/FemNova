import express from 'express';
import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database(path.join(__dirname, 'femnova.db'));
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
const rag = [
  { topic:'cycle', content:'A menstrual cycle is counted from the first day of bleeding to the day before the next period. Cycle length and symptoms vary between people. Tracking over several months can reveal personal patterns.' },
  { topic:'nutrition', content:'Regular meals with protein, iron-rich foods, fibre, and hydration can support energy. Vitamin C helps the body absorb plant-based iron. Nutrition advice should be adapted for allergies, conditions, and clinician guidance.' },
  { topic:'mood', content:'Hormonal changes across the cycle can coincide with changes in mood, sleep, appetite, and energy, but they do not explain every experience. Persistent or severe mood symptoms deserve professional support.' },
  { topic:'labs', content:'Typical adult non-pregnant reference ranges used by FemNova are Free T3 2.3 to 4.2 pg/mL, Free T4 0.8 to 1.8 ng/dL, TSH 0.4 to 4.0 mIU/L, and haemoglobin 12.0 to 15.5 g/dL. Laboratories may use different ranges; results need clinical context.' },
  { topic:'safety', content:'Seek urgent medical help for severe pain, fainting, chest pain, trouble breathing, very heavy bleeding, or thoughts of self-harm. FemNova is educational and does not diagnose or replace a healthcare professional.' },
  { topic:'pregnancy', content:'A missed period can have many causes. A home pregnancy test and a healthcare professional can help clarify pregnancy status. Contraception choices depend on health history and preferences; a clinician or pharmacist can help.' }
];
const app = express(); app.use(express.json()); app.use(express.static(path.join(__dirname, 'dist')));
const USER = 'local-user';
const classify = (value, range) => value === null || value === undefined || value === '' ? null : Number(value) < range.low ? 'low' : Number(value) > range.high ? 'high' : 'normal';
const getRanges = () => Object.fromEntries(db.prepare('SELECT * FROM reference_ranges').all().map(row => [row.test,row]));
const labsWithFlags = () => { const refs=getRanges(); return db.prepare('SELECT * FROM labs WHERE user_id=? ORDER BY date DESC, id DESC').all(USER).map(lab => ({...lab, flags:{freeT3:classify(lab.free_t3,refs.freeT3),freeT4:classify(lab.free_t4,refs.freeT4),tsh:classify(lab.tsh,refs.tsh),hb:classify(lab.hb,refs.hb)}})); };
app.get('/api/dashboard', (req,res) => { const latest=db.prepare('SELECT * FROM cycle_logs WHERE user_id=? ORDER BY date DESC,id DESC LIMIT 1').get(USER); const labs=labsWithFlags(); const flagged=labs[0] ? Object.values(labs[0].flags).filter(flag => flag && flag !== 'normal').length : 0; const logs=db.prepare('SELECT energy FROM cycle_logs WHERE user_id=? AND energy IS NOT NULL').all(USER); const averageLength=28; res.json({latest, labSummary:{flagged, latest:labs[0] || null}, cycle:{averageLength,nextPeriod:'October 10', loggedDays:logs.length}}); });
app.get('/api/cycle', (req,res) => res.json(db.prepare('SELECT * FROM cycle_logs WHERE user_id=? ORDER BY date DESC').all(USER)));
app.post('/api/cycle', (req,res) => { const {date,flow,mood,energy,symptoms,notes}=req.body; if(!date) return res.status(400).json({error:'date is required'}); const result=db.prepare('INSERT INTO cycle_logs (user_id,date,flow,mood,energy,symptoms,notes) VALUES (?,?,?,?,?,?,?)').run(USER,date,flow,mood,energy,symptoms,notes); res.json({id:result.lastInsertRowid}); });
app.get('/api/labs', (req,res) => res.json(labsWithFlags()));
app.post('/api/labs', (req,res) => { const {date,freeT3,freeT4,tsh,hb,comments}=req.body; if(!date) return res.status(400).json({error:'date is required'}); const result=db.prepare('INSERT INTO labs (user_id,date,free_t3,free_t4,tsh,hb,comments) VALUES (?,?,?,?,?,?,?)').run(USER,date,freeT3||null,freeT4||null,tsh||null,hb||null,comments||''); res.json({id:result.lastInsertRowid,flags:labsWithFlags()[0].flags}); });
app.get('/api/community', (req,res) => res.json(db.prepare("SELECT * FROM community_posts WHERE user_id='demo' OR user_id=? ORDER BY id DESC").all(USER)));
app.post('/api/community', (req,res) => { const {body,topic='General'}=req.body; if(!body?.trim()) return res.status(400).json({error:'body is required'}); const result=db.prepare('INSERT INTO community_posts (user_id,author,topic,body) VALUES (?,?,?,?)').run(USER,'You',topic,body.trim()); res.json({id:result.lastInsertRowid}); });
const tokens = text => text.toLowerCase().split(/[^a-z0-9]+/).filter(word => word.length > 2);
app.post('/api/chat', (req,res) => { const question=String(req.body.question||''); const words=tokens(question); const ranked=rag.map(doc => ({doc,score:words.reduce((score,word)=>score+(doc.content.toLowerCase().includes(word)||doc.topic.includes(word)?1:0),0)})).sort((a,b)=>b.score-a.score); const source=ranked[0].score ? ranked[0].doc : rag[4]; res.json({answer:`${source.content} ${source.topic === 'labs' ? 'Please compare with the range printed on your report and discuss any flagged result with your doctor.' : 'Your experience is personal, so use this as a starting point rather than a verdict.'}`,sources:[source.topic]}); });
app.get(/.*/, (req,res) => res.sendFile(path.join(__dirname,'dist','index.html')));
const port=process.env.PORT||3001; app.listen(port,()=>console.log(`FemNova API running on http://localhost:${port}`));
