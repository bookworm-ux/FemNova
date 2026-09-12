import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

test('HTTP routes block unconfigured analysis while records remain usable', { timeout: 20_000 }, async () => {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, ANYMIZE_API_KEY: '', DATABASE_PATH: ':memory:', PORT: '0' },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    const port = await new Promise((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(new Error('Test API did not start')), 10_000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', () => { clearTimeout(timer); reject(new Error('Test API exited before startup')); });
      child.stdout.on('data', chunk => {
        output += chunk;
        const match = output.match(/localhost:(\d+)/);
        if (match) { clearTimeout(timer); resolve(Number(match[1])); }
      });
    });
    const request = (path, body) => fetch(`http://localhost:${port}/api/${path}`, body === undefined ? {} : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const chat = await request('chat', { question: 'Test Person has cramps.' });
    assert.equal(chat.status, 503);
    assert.equal((await chat.json()).code, 'PRIVACY_UNAVAILABLE');
    const save = await request('labs', { date: '2026-09-12', freeT3: 3, freeT4: 1, tsh: 5, hb: 11, comments: 'Synthetic record' });
    assert.equal(save.status, 200);
    const labs = await (await request('labs')).json();
    assert.equal(labs[0].freeT3, 3);
    assert.equal(labs[0].flagStatus, 'unavailable');
    assert.equal(labs[0].flags, null);
    const dashboard = await (await request('dashboard')).json();
    assert.equal(dashboard.labSummary.flagged, null);
    assert.equal(dashboard.labSummary.status, 'unavailable');
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }
  }
});

test('unfinished health services reject analysis before creating inferences or embeddings', async () => {
  process.env.DATABASE_PATH = ':memory:';
  process.env.ANYMIZE_API_KEY = '';
  const { getCycleContext, generatePrediction, rankKnowledge } = await import('../server/health.js');
  const { db, closeDatabase } = await import('../server/database.js');
  try {
    for (const operation of [() => getCycleContext('synthetic-user'), () => generatePrediction('synthetic-user'), () => rankKnowledge('Synthetic question')]) {
      await assert.rejects(operation(), { code: 'PRIVACY_NOT_CONFIGURED' });
    }
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM fn_lab_predictions').get().count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM fn_knowledge_chunks').get().count, 0);
  } finally {
    closeDatabase();
  }
});
