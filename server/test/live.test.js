'use strict';

/* /v1/live against TEST_DATABASE_URL with real sockets: two walls watching each other. Covers the live-sync spec. */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const request = require('supertest');
const WebSocket = require('ws');
const { createApp } = require('../src/app');
const { attachLive } = require('../src/live');
const { TEST_URL, SKIP_DB, setupDb, resetNotes, resetStrokes } = require('./helpers');

/* One wall server on a random port. */
async function startServer(pool, companyId) {
  const app = createApp({ pool, companyId });
  const server = http.createServer(app);
  const wss = attachLive(server, { hub: app.locals.hub, pool, companyId });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  return {
    app, base,
    stop: () => new Promise((r) => { wss.clients.forEach((ws) => ws.terminate()); server.close(r); }),
  };
}

/* A wall's socket. Every frame is kept, so a test can wait for one that already arrived. */
function connect(base, origin = base) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(base.replace('http', 'ws') + '/v1/live', { origin });
    const seen = [];
    const waiters = [];
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      seen.push(msg);
      for (const w of waiters.slice()) {
        if (w.match(msg)) { waiters.splice(waiters.indexOf(w), 1); clearTimeout(w.timer); w.resolve(msg); }
      }
    });
    const client = {
      ws, seen,
      send: (msg) => ws.send(JSON.stringify(msg)),
      /* The first frame of type t (matching pred) not yet taken. */
      next(t, pred = () => true, ms = 4000) {
        const match = (m) => m.t === t && pred(m) && !m.__taken && (m.__taken = true);
        const hit = seen.find(match);
        if (hit) return Promise.resolve(hit);
        return new Promise((res, rej) => {
          const w = { match, resolve: res, timer: setTimeout(() => rej(new Error('no ' + t + ' frame within ' + ms + 'ms')), ms) };
          waiters.push(w);
        });
      },
      /* Resolves true if no frame of type t arrives within ms. */
      async quiet(t, ms = 300) {
        await new Promise((r) => setTimeout(r, ms));
        return !seen.some((m) => m.t === t && !m.__taken);
      },
      closed: new Promise((r) => ws.on('close', (code) => r(code))),
      close: () => ws.close(),
    };
    ws.on('open', () => client.next('hello').then(() => resolve(client), reject));
    ws.on('unexpected-response', (req, res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => { const e = new Error('refused'); e.status = res.statusCode; e.body = body; reject(e); });
    });
    ws.on('error', reject);
  });
}

test('live sync over /v1/live', { skip: SKIP_DB }, async (t) => {
  const { pool, companyId } = await setupDb();
  let srv = await startServer(pool, companyId);
  const open = [];
  t.after(async () => { open.forEach((c) => c.ws.terminate()); await srv.stop(); await pool.end(); });
  const wall = async () => { const c = await connect(srv.base); open.push(c); return c; };
  const api = () => request(srv.base);
  const stroke = (over = {}) => Object.assign({ id: crypto.randomUUID(), ink: 'black', width: 0.0042, points: [[0.1, 0.1], [0.2, 0.2]] }, over);
  t.beforeEach(async () => {
    open.splice(0).forEach((c) => c.ws.terminate());
    await resetNotes(pool);
    await resetStrokes(pool);
  });

  await t.test('a foreign Origin cannot upgrade, and the refusal leaks nothing', async () => {
    const err = await connect(srv.base, 'http://evil.example').then(() => null, (e) => e);
    assert.ok(err, 'the upgrade was refused');
    assert.equal(err.status, 403);
    assert.equal(JSON.parse(err.body).error.code, 'forbidden_origin');
    assert.ok(!err.body.includes(TEST_URL));
    assert.ok(!/at .+\.js:\d+/.test(err.body), 'no stack trace');
    assert.equal(srv.app.locals.hub.sockets.size, 0, 'a refused upgrade never joins the room');
  });

  await t.test('a socket without an Origin header is allowed (same as REST)', async () => {
    const ws = new WebSocket(srv.base.replace('http', 'ws') + '/v1/live');
    await new Promise((r, j) => { ws.on('open', r); ws.on('error', j); });
    ws.terminate();
  });

  await t.test('hello carries notes with revision, committed strokes, and strokes in progress', async () => {
    const note = (await api().post('/v1/notes').send({ body: 'On the wall' }).expect(201)).body;
    const done = stroke();
    await api().post('/v1/whiteboard/strokes').send(done).expect(201);
    const a = await wall();
    const drawing = stroke();
    a.send({ t: 'ink', id: drawing.id, ink: 'blue', width: 0.0042, points: [[0.3, 0.3], [0.31, 0.32]] });
    await new Promise((r) => setTimeout(r, 100));
    const b = await wall();
    const hello = b.seen.find((m) => m.t === 'hello');
    assert.deepEqual(hello.notes.map((n) => [n.id, n.revision]), [[note.id, 0]]);
    assert.deepEqual(hello.strokes.map((s) => s.id), [done.id]);
    assert.deepEqual(hello.previews, [{ id: drawing.id, ink: 'blue', width: 0.0042, points: [[0.3, 0.3], [0.31, 0.32]] }]);
    assert.ok(!JSON.stringify(hello).includes(TEST_URL));
  });

  await t.test('one letter typed on wall A shows up on wall B and is saved', async () => {
    const note = (await api().post('/v1/notes').send({ body: 'Idea' }).expect(201)).body;
    const a = await wall();
    const b = await wall();
    a.send({ t: 'note', id: note.id, body: 'Idea!', revision: 0, seq: 1 });
    const ack = await a.next('note:ack');
    assert.equal(ack.seq, 1);
    assert.equal(ack.note.revision, 1);
    const seenByB = await b.next('note', (m) => m.note.id === note.id);
    assert.equal(seenByB.note.body, 'Idea!');
    assert.equal(seenByB.note.revision, 1);
    assert.ok(await a.quiet('note'), 'the typist gets an ack, not their own words echoed back');
    const { rows } = await pool.query('SELECT body, revision FROM notes WHERE id = $1', [note.id]);
    assert.deepEqual(rows[0], { body: 'Idea!', revision: 1 });
  });

  await t.test('coalesced letters end on the final body and revision everywhere', async () => {
    const note = (await api().post('/v1/notes').send({ body: 'a' }).expect(201)).body;
    const a = await wall();
    const b = await wall();
    // One write in flight at a time; letters typed meanwhile collapse into the next send.
    let rev = 0;
    for (const [seq, body] of [[1, 'ab'], [2, 'abcd'], [3, 'abcde']]) {
      a.send({ t: 'note', id: note.id, body, revision: rev, seq });
      rev = (await a.next('note:ack', (m) => m.seq === seq)).note.revision;
    }
    assert.equal(rev, 3);
    let last;
    for (let i = 0; i < 3; i++) last = await b.next('note', (m) => m.note.id === note.id);
    assert.deepEqual([last.note.body, last.note.revision], ['abcde', 3]);
  });

  await t.test('a trimmed-empty edit is neither stored nor sent to others', async () => {
    const note = (await api().post('/v1/notes').send({ body: 'Keep me' }).expect(201)).body;
    const a = await wall();
    const b = await wall();
    a.send({ t: 'note', id: note.id, body: '   ', revision: 0, seq: 7 });
    const err = await a.next('note:error');
    assert.equal(err.error.code, 'validation_failed');
    assert.ok(await b.quiet('note'));
    const { rows } = await pool.query('SELECT body, revision FROM notes WHERE id = $1', [note.id]);
    assert.deepEqual(rows[0], { body: 'Keep me', revision: 0 });
  });

  await t.test('two walls editing from the same revision: the loser gets the winner\'s note', async () => {
    const note = (await api().post('/v1/notes').send({ body: 'Shared' }).expect(201)).body;
    const a = await wall();
    const b = await wall();
    a.send({ t: 'note', id: note.id, body: 'Shared by A', revision: 0, seq: 1 });
    await a.next('note:ack');
    b.send({ t: 'note', id: note.id, body: 'Shared by B', revision: 0, seq: 1 });
    const conflict = await b.next('note:conflict');
    assert.deepEqual([conflict.note.body, conflict.note.revision], ['Shared by A', 1]);
  });

  await t.test('a live edit of a note that was taken down answers note:gone', async () => {
    const note = (await api().post('/v1/notes').send({ body: 'Soon gone' }).expect(201)).body;
    const a = await wall();
    await api().delete('/v1/notes/' + note.id).expect(204);
    a.send({ t: 'note', id: note.id, body: 'Too late', revision: 0, seq: 4 });
    assert.equal((await a.next('note:gone')).id, note.id);
  });

  await t.test('stick, take down, and undo show up on other walls at once', async () => {
    const b = await wall();
    const made = (await api().post('/v1/notes').send({ body: 'Fresh note', color: 'pink' }).expect(201)).body;
    assert.deepEqual((await b.next('note')).note, made);
    await api().delete('/v1/notes/' + made.id).expect(204);
    assert.equal((await b.next('note:drop')).id, made.id);
    await api().post('/v1/notes/' + made.id + '/restore').expect(200);
    assert.equal((await b.next('note', (m) => m.note.id === made.id)).note.body, 'Fresh note');
    await api().patch('/v1/notes/' + made.id).send({ body: 'Saved over REST', revision: 0 }).expect(200);
    assert.equal((await b.next('note', (m) => m.note.body === 'Saved over REST')).note.revision, 1);
  });

  await t.test('a growing line shows before pointerup, and the stroke lasts after it', async () => {
    const a = await wall();
    const b = await wall();
    const s = stroke({ points: [[0.1, 0.1], [0.2, 0.2], [0.3, 0.25]] });
    a.send({ t: 'ink', id: s.id, ink: s.ink, width: s.width, points: s.points.slice(0, 2) });
    const first = await b.next('ink');
    assert.deepEqual(first.points, [[0.1, 0.1], [0.2, 0.2]]);
    a.send({ t: 'ink', id: s.id, ink: s.ink, width: s.width, points: s.points.slice(2) });
    assert.deepEqual((await b.next('ink')).points, [[0.3, 0.25]]);
    assert.ok(await a.quiet('ink'), 'the drawer does not get their own ink back');

    await api().post('/v1/whiteboard/strokes').send(s).expect(201);
    assert.equal((await b.next('stroke')).stroke.id, s.id);
    assert.equal(srv.app.locals.hub.previews.size, 0, 'the commit ends the preview');
    const listed = await api().get('/v1/whiteboard/strokes').expect(200);
    assert.deepEqual(listed.body.strokes.map((x) => x.id), [s.id]);
  });

  await t.test('a preview never grows past 1000 points', async () => {
    const a = await wall();
    const b = await wall();
    const id = crypto.randomUUID();
    const pts = (n, off) => Array.from({ length: n }, (_, i) => [0.0001 * (i + off), 0.5]);
    a.send({ t: 'ink', id, ink: 'black', width: 0.0042, points: pts(900, 0) });
    a.send({ t: 'ink', id, ink: 'black', width: 0.0042, points: pts(300, 900) });
    await b.next('ink');
    assert.equal((await b.next('ink')).points.length, 100);
    assert.equal(srv.app.locals.hub.previews.get(id).points.length, 1000);
  });

  await t.test('a wall that drops mid-stroke leaves no ghost line', async () => {
    const a = await wall();
    const b = await wall();
    const id = crypto.randomUUID();
    a.send({ t: 'ink', id, ink: 'black', width: 0.0042, points: [[0.1, 0.1]] });
    await b.next('ink');
    a.ws.terminate();
    assert.equal((await b.next('ink:drop')).id, id);
    assert.equal(srv.app.locals.hub.previews.size, 0);
  });

  await t.test('a restart mid-stroke still ends in exactly one stroke', async () => {
    const a = await wall();
    const b = await wall();
    const s = stroke();
    a.send({ t: 'ink', id: s.id, ink: s.ink, width: s.width, points: s.points.slice(0, 1) });
    await b.next('ink');
    await srv.stop();
    srv = await startServer(pool, companyId);
    const b2 = await wall();
    await api().post('/v1/whiteboard/strokes').send(s).expect(201);
    await api().post('/v1/whiteboard/strokes').send(s).expect(200);   // the retry after a lost answer
    assert.equal((await b2.next('stroke')).stroke.id, s.id);
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM whiteboard_strokes WHERE id = $1', [s.id]);
    assert.equal(rows[0].n, 1);
  });

  await t.test('erase and clear reach other walls before and after the REST write', async () => {
    const one = stroke(); const two = stroke();
    await api().post('/v1/whiteboard/strokes').send(one).expect(201);
    await api().post('/v1/whiteboard/strokes').send(two).expect(201);
    const a = await wall();
    const b = await wall();
    a.send({ t: 'erase', ids: [one.id] });
    assert.deepEqual((await b.next('erase')).ids, [one.id]);
    await api().post('/v1/whiteboard/strokes/erase').send({ ids: [one.id] }).expect(200);
    assert.deepEqual((await b.next('erase')).ids, [one.id]);
    await api().post('/v1/whiteboard/strokes/restore').send({ ids: [one.id] }).expect(200);
    assert.deepEqual((await b.next('restore')).strokes.map((x) => x.id), [one.id]);
    a.send({ t: 'clear', ids: [one.id, two.id] });
    assert.deepEqual((await b.next('clear')).ids, [one.id, two.id]);
    await api().post('/v1/whiteboard/clear').send({}).expect(200);
    assert.deepEqual((await b.next('clear')).ids.sort(), [one.id, two.id].sort());
  });

  await t.test('reconnecting gets a fresh hello with what changed meanwhile', async () => {
    const a = await wall();
    a.close();
    await a.closed;
    const note = (await api().post('/v1/notes').send({ body: 'While you were away' }).expect(201)).body;
    const again = await wall();
    const hello = again.seen.find((m) => m.t === 'hello');
    assert.deepEqual(hello.notes.map((n) => n.id), [note.id]);
  });

  await t.test('more than 100 messages in a second closes that socket only', async () => {
    const flooder = await wall();
    const b = await wall();
    const id = crypto.randomUUID();
    for (let i = 0; i < 130; i++) flooder.send({ t: 'ink:drop', id });
    assert.equal(await flooder.closed, 1008);
    const note = (await api().post('/v1/notes').send({ body: 'Still live' }).expect(201)).body;
    assert.equal((await b.next('note')).note.id, note.id);
  });

  await t.test('bad frames get an error shape with no internals', async () => {
    const a = await wall();
    a.ws.send('not json');
    a.send({ t: 'mystery' });
    a.send({ t: 'ink', id: 'nope', ink: 'red', width: 9, points: [] });
    for (const code of ['invalid_message', 'invalid_message', 'validation_failed']) {
      const e = await a.next('error');
      assert.equal(e.error.code, code);
      assert.ok(!JSON.stringify(e).includes(TEST_URL));
    }
  });
});
