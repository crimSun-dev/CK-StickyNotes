'use strict';

/* /v1/live: one same-origin WebSocket per open wall, so letters and ink travel as they happen.
 *
 * Postgres stays the only durable store. Note edits sent here are revision-checked row updates
 * (the same rule as PATCH). In-progress ink lives only in this process's memory until the pen lifts
 * and the stroke POST commits it. REST writes call the hub too, so every open wall hears every change.
 *
 * Frames are JSON text with a `t` field.
 *   client -> server: note { id, body, color?, revision, seq } | ink { id, ink, width, points } | ink:drop { id }
 *                     erase { ids } | clear { ids }   (relays only: REST stays the durable write)
 *   server -> client: hello { notes, hasMore, strokes, strokesHasMore, previews }
 *                     note { note } | note:drop { id } | note:ack / note:conflict { seq, note } | note:gone { seq, id }
 *                     note:error { seq, id, error } | ink { id, ink, width, points } | ink:drop { id }
 *                     stroke { stroke } | erase { ids } | restore { strokes } | clear { ids } | error { error }
 */

const { WebSocketServer } = require('ws');
const { originAllowed } = require('./guards');
const { listNotes, updateNote, MAX_LIMIT } = require('./notes');
const { listStrokes, MAX_POINTS, MAX_LIVE, INKS, MAX_WIDTH } = require('./whiteboard');

const PATH = '/v1/live';
const MAX_MESSAGES_PER_SECOND = 100;
const MAX_PAYLOAD = 128 * 1024;        // a resent 1000-point preview or a 1500-id clear relay fits
const MAX_PREVIEWS_PER_SOCKET = 8;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isId(id) { return typeof id === 'string' && UUID_RE.test(id); }
function isIds(ids, max) { return Array.isArray(ids) && ids.length >= 1 && ids.length <= max && ids.every(isId); }
function isPoint(p) { return Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]); }
function errorFrame(code, message) { return { t: 'error', error: { code, message } }; }

/* The room: every accepted socket in this process, plus the strokes being drawn right now. */
function createHub() {
  const sockets = new Set();
  const previews = new Map();   // stroke id -> { id, ink, width, points, owner }

  function send(ws, msg) {
    if (ws.readyState !== 1) return;
    // Until its hello is out, a socket queues what happens, so the snapshot cannot overwrite it.
    if (ws.backlog) { ws.backlog.push(msg); return; }
    ws.send(JSON.stringify(msg));
  }
  function broadcast(msg, except) {
    for (const ws of sockets) if (ws !== except) send(ws, msg);
  }
  function previewList() {
    return [...previews.values()].map(({ id, ink, width, points }) => ({ id, ink, width, points }));
  }
  function dropPreview(id) {
    const p = previews.get(id);
    if (!p) return false;
    previews.delete(id);
    return true;
  }

  return {
    sockets,
    previews,
    send,
    broadcast,
    previewList,
    join(ws) { sockets.add(ws); },
    leave(ws) {
      sockets.delete(ws);
      // A wall that disconnects mid-stroke leaves no ghost line on the others.
      for (const p of [...previews.values()]) {
        if (p.owner === ws) { previews.delete(p.id); broadcast({ t: 'ink:drop', id: p.id }); }
      }
    },
    /* Appends points to a stroke in progress. Returns the points actually taken (capped at MAX_POINTS). */
    addInk(ws, msg) {
      let p = previews.get(msg.id);
      if (p && p.owner !== ws) return null;
      if (!p) {
        let owned = 0;
        for (const q of previews.values()) if (q.owner === ws) owned++;
        if (owned >= MAX_PREVIEWS_PER_SOCKET) return null;
        p = { id: msg.id, ink: msg.ink, width: msg.width, points: [], owner: ws };
        previews.set(msg.id, p);
      }
      const room = MAX_POINTS - p.points.length;
      const taken = msg.points.slice(0, Math.max(0, room));
      for (const pt of taken) p.points.push(pt);
      return taken;
    },
    dropInk(ws, id) {
      const p = previews.get(id);
      if (!p || p.owner !== ws) return;
      dropPreview(id);
      broadcast({ t: 'ink:drop', id }, ws);
    },

    // Called by the REST routers once a write has committed.
    noteChanged(note) { broadcast({ t: 'note', note }); },
    noteRemoved(id) { broadcast({ t: 'note:drop', id }); },
    strokeCommitted(stroke) { dropPreview(stroke.id); broadcast({ t: 'stroke', stroke }); },
    strokesErased(ids) { ids.forEach(dropPreview); broadcast({ t: 'erase', ids }); },
    strokesRestored(strokes) { broadcast({ t: 'restore', strokes }); },
    cleared(ids) { broadcast({ t: 'clear', ids }); },
  };
}

/* The scheme the browser used, so an https page behind Render's proxy matches its own Origin. */
function upgradeProtocol(req, trustProxy) {
  const fwd = req.headers['x-forwarded-proto'];
  if (trustProxy && typeof fwd === 'string' && fwd) return fwd.split(',')[0].trim();
  return req.socket.encrypted ? 'https' : 'http';
}

function refuse(socket, status, reason, code, message) {
  const body = JSON.stringify({ error: { code, message } });
  socket.end('HTTP/1.1 ' + status + ' ' + reason + '\r\n' +
    'Content-Type: application/json\r\nContent-Length: ' + Buffer.byteLength(body) + '\r\nConnection: close\r\n\r\n' + body);
}

/* Attaches /v1/live to an http.Server. hub is the same one createApp handed to the REST routers. */
function attachLive(server, { hub, pool, companyId, trustProxy = 0 }) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD });

  server.on('upgrade', (req, socket, head) => {
    let pathname;
    try { pathname = new URL(req.url, 'http://localhost').pathname; } catch { pathname = ''; }
    if (pathname !== PATH) return refuse(socket, 404, 'Not Found', 'not_found', 'Not found');
    if (!originAllowed(req.headers.origin, upgradeProtocol(req, trustProxy), req.headers.host)) {
      return refuse(socket, 403, 'Forbidden', 'forbidden_origin', 'Cross-origin requests are not allowed');
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', (ws) => {
    ws.backlog = [];
    let windowStart = Date.now();
    let count = 0;
    hub.join(ws);

    Promise.all([listNotes(pool, companyId, MAX_LIMIT), listStrokes(pool, companyId, MAX_LIVE)]).then(([n, s]) => {
      if (ws.readyState !== 1) return;
      const queued = ws.backlog;
      ws.backlog = null;
      ws.send(JSON.stringify({
        t: 'hello', notes: n.notes, hasMore: n.hasMore, strokes: s.strokes, strokesHasMore: s.hasMore,
        previews: hub.previewList(),
      }));
      queued.forEach((msg) => hub.send(ws, msg));
    }, (err) => {
      console.error('live hello failed:', err.message);
      ws.backlog = null;
      hub.send(ws, errorFrame('server_error', 'Internal server error'));
      ws.close(1011);
    });

    ws.on('message', (data, isBinary) => {
      const now = Date.now();
      if (now - windowStart >= 1000) { windowStart = now; count = 0; }
      if (++count > MAX_MESSAGES_PER_SECOND) { ws.close(1008, 'too_many_messages'); return; }
      if (isBinary) return hub.send(ws, errorFrame('invalid_message', 'Send JSON text frames'));
      let msg;
      try { msg = JSON.parse(data.toString('utf8')); } catch { msg = null; }
      if (!msg || typeof msg !== 'object') return hub.send(ws, errorFrame('invalid_message', 'Send JSON text frames'));
      handle(ws, msg).catch((err) => {
        console.error(err.stack || err);
        hub.send(ws, errorFrame('server_error', 'Internal server error'));
      });
    });
    ws.on('close', () => hub.leave(ws));
    ws.on('error', () => {});
  });

  async function handle(ws, msg) {
    switch (msg.t) {
      case 'note': {
        const seq = Number.isInteger(msg.seq) ? msg.seq : null;
        const patch = { body: msg.body, revision: msg.revision };
        if (msg.color !== undefined) patch.color = msg.color;
        const out = await updateNote(pool, companyId, msg.id, patch);
        if (out.status === 200) {
          hub.send(ws, { t: 'note:ack', seq, note: out.note });
          hub.broadcast({ t: 'note', note: out.note }, ws);
        } else if (out.status === 409) {
          hub.send(ws, { t: 'note:conflict', seq, note: out.note });
        } else if (out.status === 404) {
          hub.send(ws, { t: 'note:gone', seq, id: msg.id });
        } else {
          hub.send(ws, { t: 'note:error', seq, id: msg.id, error: { code: 'validation_failed', message: out.message } });
        }
        return;
      }
      case 'ink': {
        const width = msg.width;
        if (!isId(msg.id) || !INKS.has(msg.ink) || typeof width !== 'number' || !Number.isFinite(width) || width <= 0 ||
            Math.fround(width) > Math.fround(MAX_WIDTH) || !Array.isArray(msg.points) || !msg.points.length ||
            msg.points.length > MAX_POINTS || !msg.points.every(isPoint)) {
          return hub.send(ws, errorFrame('validation_failed', 'ink needs id, ink, width and 1 to ' + MAX_POINTS + ' points'));
        }
        const id = msg.id.toLowerCase();
        const taken = hub.addInk(ws, { id, ink: msg.ink, width, points: msg.points });
        if (taken && taken.length) hub.broadcast({ t: 'ink', id, ink: msg.ink, width, points: taken }, ws);
        return;
      }
      case 'ink:drop':
        if (isId(msg.id)) hub.dropInk(ws, msg.id.toLowerCase());
        return;
      case 'erase':
      case 'clear':
        // Shown on the other walls at once; the REST write that follows is what lasts.
        if (!isIds(msg.ids, MAX_LIVE)) return hub.send(ws, errorFrame('validation_failed', 'ids must be stroke ids'));
        hub.broadcast({ t: msg.t, ids: msg.ids.map((id) => id.toLowerCase()) }, ws);
        return;
      default:
        hub.send(ws, errorFrame('invalid_message', 'Unknown message type'));
    }
  }

  return wss;
}

module.exports = { createHub, attachLive, PATH, MAX_MESSAGES_PER_SECOND };
