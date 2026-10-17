/* ce-store.js: the Creative Episode data layer, and its only owner.
 *
 * index.html draws the room and handles input; everything that reads or writes notes and
 * whiteboard strokes lives here. window.CE_STORE (set by ce-config.js, which the wall server
 * serves and the GitHub Pages deploy writes) picks one backend for the whole page:
 *   'api'    -> /v1 on the same origin, backed by Neon. Shared with the office.
 *   'neon'   -> the Neon Data API directly (GitHub Pages, no server), after the office signs in.
 *   anything else, e.g. the page opened as a file -> localStorage on this device, with samples.
 * CE.mode is 'api' for both shared backends: the page behaves the same either way.
 * Every write is one delta (create, update, remove, restore, add, erase, clear), never a whole collection.
 * Note updates name the revision they read; a stale one fails with 409 and err.note holds the saved note.
 * CE.live (the 'api' backend only) is the /v1/live socket: letters and ink as they happen. It is null otherwise.
 */
(function () {
  'use strict';

  var BACKEND = window.CE_STORE === 'api' ? 'server' : window.CE_STORE === 'neon' && window.CE_NEON ? 'neon' : 'local';
  var MODE = BACKEND === 'local' ? 'local' : 'api';
  var NOTES_KEY = 'creative-episode.notes.v1';
  var WB_KEY = 'creative-episode.whiteboard.v1';
  var TIMEOUT = 8000;
  var NOTE_COLORS = { blue: 1, pink: 1, green: 1, yellow: 1 };
  /* Ink is stored as a token; the hex values are the headquarters marker colors. */
  var INK = { black: '#16161C', blue: '#2E3A8C' };
  var WB_MAX_POINTS = 1000;
  var WB_CAPACITY = 1500;
  var WB_MAX_ERASE = 500;

  var SAMPLES = [
    { id: 'sample-1', body: 'Pojok baca kecil di Creative Episode. Buku boleh dibawa pulang.', color: 'yellow', createdAt: '2026-10-15T09:00:00+07:00' },
    { id: 'sample-2', body: 'Friday lunch: everyone brings one idea on a note.', color: 'blue', createdAt: '2026-10-15T09:05:00+07:00' },
    { id: 'sample-3', body: '회의 전에 5분, 아이디어만 적기.', color: null, createdAt: '2026-10-15T09:10:00+07:00' }
  ];

  /* ----------------------------------------------------------- shared -- */
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    /* randomUUID needs a secure context; plain http on the office network does not have one. */
    var b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    var h = Array.prototype.map.call(b, function (x) { return (x + 256).toString(16).slice(1); }).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }
  function storeError(status, code) { var e = new Error('store ' + status); e.status = status; e.code = code; return e; }
  function insertByTime(arr, item) {
    var t = Date.parse(item.createdAt), j = arr.length;
    while (j > 0 && Date.parse(arr[j - 1].createdAt) > t) j--;
    arr.splice(j, 0, item);
  }
  function chunk(arr, size) {
    var out = [];
    for (var i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  }

  /* fetch, then read the JSON body, within 8s: a stalled request becomes a visible failure.
     Resolves { res, data }; data is null for 204 or a body that is not JSON. */
  function timed(url, opts) {
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, TIMEOUT);
    opts.signal = ctrl.signal;
    return fetch(url, opts).then(function (res) {
      if (res.status === 204) return { res: res, data: null };
      return res.json().catch(function () { return null; }).then(function (data) { return { res: res, data: data }; });
    }).then(function (out) { clearTimeout(timer); return out; },
            function (err) { clearTimeout(timer); throw err; });
  }

  /* Same-origin JSON call to the wall server. */
  function call(method, path, body) {
    var opts = { method: method, headers: { Accept: 'application/json' }, credentials: 'same-origin', cache: 'no-store' };
    if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    return timed(path, opts).then(function (out) {
      if (!out.res.ok) {
        var err = storeError(out.res.status, out.data && out.data.error && out.data.error.code);
        if (out.data && out.data.note) err.note = out.data.note;
        throw err;
      }
      return out.data;
    });
  }
  function readJSON(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; }
  }

  /* ------------------------------------------------------------ notes -- */
  function validNote(n) {
    return n && typeof n.id === 'string' && typeof n.body === 'string' && n.body.trim() &&
      (n.color === null || Object.prototype.hasOwnProperty.call(NOTE_COLORS, n.color)) &&
      typeof n.createdAt === 'string';
  }

  var localNotes = (function () {
    var trash = {};
    function act(fn) {
      return new Promise(function (resolve, reject) {
        try {
          var arr = readJSON(NOTES_KEY);
          arr = Array.isArray(arr) ? arr.filter(validNote) : [];
          var out = fn(arr);
          localStorage.setItem(NOTES_KEY, JSON.stringify(arr));
          resolve(out);
        } catch (e) { reject(e); }
      });
    }
    function find(arr, id) {
      var i = arr.findIndex(function (n) { return n.id === id; });
      if (i < 0) throw storeError(404);
      return i;
    }
    return {
      load: function () {
        return new Promise(function (resolve) {
          var raw = null;
          try { raw = localStorage.getItem(NOTES_KEY); } catch (e) { resolve({ notes: SAMPLES.slice(), hasMore: false }); return; }
          if (raw === null) {
            try { localStorage.setItem(NOTES_KEY, JSON.stringify(SAMPLES)); } catch (e) { /* shown, not persisted */ }
            resolve({ notes: SAMPLES.slice(), hasMore: false }); return;
          }
          var arr = [];
          try { arr = JSON.parse(raw); arr = Array.isArray(arr) ? arr.filter(validNote) : []; } catch (e) { arr = []; }
          resolve({ notes: arr, hasMore: false });
        });
      },
      create: function (note) {
        return act(function (arr) {
          var n = { id: note.id, body: note.body, color: note.color, createdAt: new Date().toISOString() };
          arr.push(n);
          return n;
        });
      },
      update: function (id, patch) {
        return act(function (arr) {
          var n = arr[find(arr, id)];
          if ('body' in patch) n.body = patch.body;
          if ('color' in patch) n.color = patch.color;
          return n;
        });
      },
      remove: function (id) {
        return act(function (arr) { var i = find(arr, id); trash[id] = arr[i]; arr.splice(i, 1); return null; });
      },
      restore: function (id) {
        return act(function (arr) {
          var n = trash[id];
          if (!n) throw storeError(404);
          delete trash[id];
          insertByTime(arr, n);
          return n;
        });
      }
    };
  })();

  function noteAt(id) { return 'v1/notes/' + encodeURIComponent(id); }
  var apiNotes = {
    load: function () { return call('GET', 'v1/notes'); },
    create: function (note) { return call('POST', 'v1/notes', { id: note.id, body: note.body, color: note.color }); },
    update: function (id, patch) { return call('PATCH', noteAt(id), patch); },
    remove: function (id) { return call('DELETE', noteAt(id)); },
    restore: function (id) { return call('POST', noteAt(id) + '/restore'); }
  };

  /* ------------------------------------------------------- whiteboard -- */
  /* Local mode keeps the original creative-episode.whiteboard.v1 shape:
     { strokes: [{ id, color: '#hex', width, points, createdAt }] }. */
  var localWb = (function () {
    var trash = {};
    function inkOf(color) {
      return String(color).toUpperCase() === INK.blue ? 'blue' : 'black';
    }
    function read() {
      var data = readJSON(WB_KEY);
      var list = data && Array.isArray(data.strokes) ? data.strokes : [];
      var base = Date.UTC(2026, 0, 1);
      return list.filter(function (s) { return s && Array.isArray(s.points) && s.points.length; })
        .map(function (s, i) {
          return {
            id: typeof s.id === 'string' ? s.id : uuid(),
            ink: s.ink || inkOf(s.color),
            width: typeof s.width === 'number' ? s.width : 0.0042,
            points: s.points,
            createdAt: typeof s.createdAt === 'string' ? s.createdAt : new Date(base + i).toISOString()
          };
        });
    }
    function write(list) {
      localStorage.setItem(WB_KEY, JSON.stringify({ strokes: list.map(function (s) {
        return { id: s.id, color: INK[s.ink], width: s.width, points: s.points, createdAt: s.createdAt };
      }) }));
    }
    function act(fn) {
      return new Promise(function (resolve, reject) {
        try { var list = read(); var out = fn(list); write(list); resolve(out); } catch (e) { reject(e); }
      });
    }
    function takeOut(list, ids) {
      var want = new Set(ids), gone = [];
      for (var i = list.length - 1; i >= 0; i--) {
        if (want.has(list[i].id)) { trash[list[i].id] = list[i]; gone.unshift(list[i].id); list.splice(i, 1); }
      }
      return gone;
    }
    return {
      load: function () {
        return new Promise(function (resolve) { resolve({ strokes: read(), hasMore: false }); });
      },
      add: function (s) {
        return act(function (list) {
          if (!list.some(function (x) { return x.id === s.id; })) insertByTime(list, s);
          return s;
        });
      },
      erase: function (ids) { return act(function (list) { return { erased: takeOut(list, ids) }; }); },
      restore: function (ids) {
        return act(function (list) {
          var back = ids.map(function (id) { return trash[id]; }).filter(Boolean);
          back.forEach(function (s) { delete trash[s.id]; insertByTime(list, s); });
          back.sort(function (a, b) { return Date.parse(a.createdAt) - Date.parse(b.createdAt); });
          return { strokes: back };
        });
      },
      clear: function () {
        return act(function (list) { return { cleared: takeOut(list, list.map(function (s) { return s.id; })) }; });
      }
    };
  })();

  var apiWb = {
    load: function () { return call('GET', 'v1/whiteboard/strokes'); },
    add: function (s) { return call('POST', 'v1/whiteboard/strokes', { id: s.id, ink: s.ink, width: s.width, points: s.points }); },
    erase: function (ids) { return call('POST', 'v1/whiteboard/strokes/erase', { ids: ids }); },
    restore: function (ids) { return call('POST', 'v1/whiteboard/strokes/restore', { ids: ids }); },
    clear: function () { return call('POST', 'v1/whiteboard/clear', {}); }
  };

  /* ------------------------------------------------------------- neon -- */
  /* GitHub Pages has no server, so the page calls the wall.* functions on the Neon Data API.
     Neon still wants a JWT. The anonymous token is not a password and not an account. */
  var neon = (function () {
    var cfg = window.CE_NEON || {};
    var jwt = null, jwtExp = 0, pending = null;

    function expiry(t) {
      try {
        var p = t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        return JSON.parse(atob(p)).exp * 1000;
      } catch (e) { return 0; }
    }
    function token() {
      if (jwt && Date.now() < jwtExp - 60000) return Promise.resolve(jwt);
      if (!pending) {
        pending = timed(cfg.auth + '/token/anonymous', { headers: { Accept: 'application/json' }, cache: 'no-store' })
          .then(function (out) {
            pending = null;
            var tok = out.data && out.data.token;
            if (!out.res.ok || !tok) throw storeError(out.res.status || 401, 'signed_out');
            jwt = tok;
            jwtExp = out.data.expires_at ? out.data.expires_at * 1000 : expiry(tok);
            return jwt;
          }, function (err) { pending = null; throw err; });
      }
      return pending;
    }
    function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

    /* Errors from wall.* carry the API's error code as message and PTnnn as code. A 403 is retried
       once the anonymous token is in place. No code at all means the token itself was refused. */
    function rpc(fn, args, attempt) {
      attempt = attempt || 0;
      return token().then(function (t) {
        return timed(cfg.api + '/rpc/' + fn, {
          method: 'POST', cache: 'no-store',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: 'Bearer ' + t },
          body: JSON.stringify(args || {})
        });
      }).then(function (out) {
        var res = out.res, data = out.data;
        if (res.ok) return data;
        if ((res.status === 400 || res.status === 401) && !(data && data.code) && attempt < 1) {
          jwt = null;
          return rpc(fn, args, attempt + 1);
        }
        if (res.status === 403 && attempt < 3) return wait(200 * (attempt + 1)).then(function () { return rpc(fn, args, attempt + 1); });
        var code = data && typeof data.message === 'string' && /^[a-z_]+$/.test(data.message) ? data.message : undefined;
        var err = storeError(res.status, code);
        /* A stale update_note carries the saved note as its detail. */
        if (code === 'revision_conflict') { try { err.note = JSON.parse(data.details); } catch (e) { /* no note to show */ } }
        throw err;
      });
    }

    /* One chain per stroke, so a later, longer save cannot land before an earlier one. */
    var strokeChain = {};
    function saveStroke(s) {
      var run = function () {
        return rpc('save_stroke', { stroke_id: s.id, ink: s.ink, width: s.width, points: s.points });
      };
      var next = (strokeChain[s.id] || Promise.resolve()).then(run, run);
      strokeChain[s.id] = next.then(function (out) { return out; }, function () { return null; });
      return next;
    }

    return {
      notes: {
        load: function () { return rpc('list_notes'); },
        create: function (note) { return rpc('create_note', { note_id: note.id, note_body: note.body, note_color: note.color }); },
        update: function (id, patch) { return rpc('update_note', { note_id: id, patch: patch }); },
        remove: function (id) { return rpc('remove_note', { note_id: id }).then(function () { return null; }); },
        restore: function (id) { return rpc('restore_note', { note_id: id }); }
      },
      whiteboard: {
        load: function () { return rpc('list_strokes'); },
        add: function (s) { return saveStroke(s); },
        erase: function (ids) { return rpc('erase_strokes', { ids: ids }); },
        restore: function (ids) { return rpc('restore_strokes', { ids: ids }); },
        clear: function () { return rpc('clear_strokes'); }
      },
      saveStroke: saveStroke
    };
  })();

  /* Writes go out one at a time, in the order they happened, so an erase can never reach the
     server before the stroke it erases. A failure the server might not repeat (network, 5xx,
     timeout, rate limit) stalls the queue with everything still pending; retry() resumes it.
     A definite answer (400, 404, 409) drops that one write, rejects its promise, and moves on. */
  function writeQueue(adapter) {
    var jobs = [];
    var running = false, stalled = false;
    var listeners = [];
    function emit(state) {
      var st = { state: state, unsaved: unsavedLines(), pending: jobs.length };
      listeners.forEach(function (fn) { try { fn(st); } catch (e) { /* a listener must not stop the queue */ } });
    }
    function unsavedLines() {
      return jobs.reduce(function (n, j) { return n + j.lines; }, 0);
    }
    function pump() {
      if (running || stalled) return;
      if (!jobs.length) { emit('saved'); return; }
      running = true;
      emit('saving');
      var job = jobs[0];
      var p;
      try { p = Promise.resolve(job.run()); } catch (e) { p = Promise.reject(e); }
      p.then(function (out) {
        jobs.shift();
        running = false;
        job.resolve(out);
        pump();
      }, function (err) {
        running = false;
        var definite = err && (err.status === 400 || err.status === 404 || err.status === 409);
        if (definite) { jobs.shift(); job.reject(err); pump(); return; }
        stalled = true;
        emit('failed');
      });
    }
    function push(lines, run) {
      return new Promise(function (resolve, reject) {
        jobs.push({ lines: lines, run: run, resolve: resolve, reject: reject });
        if (stalled) emit('failed'); else pump();
      });
    }
    return {
      push: push,
      retry: function () { if (stalled) { stalled = false; pump(); } },
      busy: function () { return running || jobs.length > 0; },
      onStatus: function (fn) { listeners.push(fn); }
    };
  }

  function whiteboard(adapter) {
    var q = writeQueue(adapter);
    return {
      MAX_POINTS: WB_MAX_POINTS,
      CAPACITY: WB_CAPACITY,
      load: function () { return adapter.load(); },
      /* Retries reuse the stroke's id, so a save whose answer was lost never lands twice. */
      add: function (stroke) {
        if (stroke.points.length > WB_MAX_POINTS) return Promise.reject(storeError(400, 'too_many_points'));
        return q.push(1, function () { return adapter.add(stroke); });
      },
      erase: function (ids) {
        return Promise.all(chunk(ids, WB_MAX_ERASE).map(function (part) {
          return q.push(0, function () { return adapter.erase(part); });
        })).then(function (results) {
          return { erased: results.reduce(function (all, r) { return all.concat(r.erased); }, []) };
        });
      },
      /* ids may be a function, read when the write runs: undoing a clear restores what the clear returned. */
      restore: function (ids) {
        return q.push(0, function () {
          var list = typeof ids === 'function' ? ids() : ids;
          return list.length ? adapter.restore(list) : { strokes: [] };
        });
      },
      clear: function () { return q.push(0, function () { return adapter.clear(); }); },
      retry: q.retry,
      busy: q.busy,
      onStatus: q.onStatus
    };
  }

  /* ------------------------------------------------------------- live -- */
  /* The one /v1/live socket for the page ('api' backend only). index.html never touches it: it tells
     CE.live what the person typed or drew and paints what CE.live reports.
     Notes: the whole body goes out on each input with the revision last accepted. One write per note
     is in flight at a time; letters typed meanwhile collapse into the next send, so the newest words
     always go out. The typist gets an ack (new revision), never their words echoed back.
     Ink: points added since the last send go out at least every 32ms while the pen is down, and once
     more on pointerup, before the stroke POST that makes the line last. */
  function liveChannel() {
    var ws = null, open = false, everOpen = false, retryMs = 500, seq = 0;
    var handlers = {};
    var edits = {};          // note id -> { rev, inflight, sent, queued, ended, waiters }
    var inkActive = null, inkSent = 0, inkTimer = 0;

    function emit(type, data) {
      (handlers[type] || []).forEach(function (fn) { try { fn(data); } catch (e) { /* one painter must not stop the rest */ } });
    }
    function send(msg) {
      if (!open) return false;
      ws.send(JSON.stringify(msg));
      return true;
    }
    function url() {
      var dir = location.pathname.replace(/[^/]*$/, '');
      return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + dir + 'v1/live';
    }
    function connect() {
      try { ws = new WebSocket(url()); } catch (e) { later(); return; }
      ws.onmessage = function (ev) {
        var msg;
        try { msg = JSON.parse(ev.data); } catch (e) { return; }
        receive(msg);
      };
      ws.onclose = function () {
        var was = open;
        open = false; ws = null;
        Object.keys(edits).forEach(settle);
        if (was || !everOpen) emit('state', false);
        later();
      };
    }
    function later() {
      setTimeout(connect, retryMs);
      retryMs = Math.min(retryMs * 2, 8000);
    }

    /* ----- notes */
    /* Answers settle() waiters: 'ok' when nothing is left to send, 'offline' when the socket is down with words unsent. */
    function settle(id) {
      var e = edits[id];
      if (!e) return;
      var idle = !e.inflight && !e.queued;
      if (idle || !open) finish(id, idle ? 'ok' : 'offline');
      if (idle && e.ended) delete edits[id];
    }
    function finish(id, outcome) {
      var e = edits[id];
      if (!e) return;
      var w = e.waiters; e.waiters = [];
      w.forEach(function (fn) { fn(outcome); });
    }
    function pump(id) {
      var e = edits[id];
      if (!e) return;
      if (!e.inflight && e.queued && open) {
        var q = e.queued;
        e.queued = null; e.sent = q; e.inflight = ++seq;
        var msg = { t: 'note', id: id, body: q.body, revision: e.rev, seq: e.inflight };
        if (q.color !== undefined) msg.color = q.color;
        send(msg);
      }
      settle(id);
    }

    function receive(msg) {
      var e;
      switch (msg.t) {
        case 'hello':
          open = true; everOpen = true; retryMs = 500;
          /* Catch-up: open editors take the fresh revision, and words that never got an answer go again. */
          var byId = {};
          msg.notes.forEach(function (n) { byId[n.id] = n; });
          Object.keys(edits).forEach(function (id) {
            var x = edits[id];
            if (!byId[id]) { finish(id, 'gone'); delete edits[id]; return; }
            x.rev = byId[id].revision;
            if (x.inflight) { x.queued = x.queued || x.sent; x.inflight = 0; }
          });
          if (inkActive) inkSent = 0;   // the new socket has none of this line yet
          emit('state', true);
          emit('hello', msg);
          Object.keys(edits).forEach(pump);
          if (inkActive) flushInk();
          return;
        case 'note': emit('note', msg.note); return;
        case 'note:drop': emit('drop', msg.id); return;
        case 'note:ack':
          e = edits[msg.note.id];
          if (e && e.inflight === msg.seq) { e.rev = msg.note.revision; e.inflight = 0; }
          emit('ack', msg.note);
          pump(msg.note.id);
          return;
        case 'note:conflict':
          e = edits[msg.note.id];
          if (e && e.inflight === msg.seq) { e.rev = msg.note.revision; e.inflight = 0; e.queued = null; }
          finish(msg.note.id, 'conflict');
          emit('conflict', msg.note);
          settle(msg.note.id);
          return;
        case 'note:gone':
          finish(msg.id, 'gone');
          delete edits[msg.id];
          emit('drop', msg.id);
          return;
        case 'note:error':
          e = edits[msg.id];
          if (e && e.inflight === msg.seq) e.inflight = 0;
          emit('rejected', msg.id);
          pump(msg.id);
          return;
        case 'ink': emit('ink', msg); return;
        case 'ink:drop': emit('inkDrop', msg.id); return;
        case 'stroke': emit('stroke', msg.stroke); return;
        case 'erase': emit('erase', msg.ids); return;
        case 'restore': emit('restore', msg.strokes); return;
        case 'clear': emit('clear', msg.ids); return;
      }
    }

    /* ----- ink */
    /* A gesture longer than WB_MAX_POINTS becomes consecutive strokes; each part streams under the id it will be saved with. */
    function flushInk() {
      clearTimeout(inkTimer); inkTimer = 0;
      var d = inkActive;
      if (!d) return;
      if (!d.partIds) d.partIds = [d.id];
      while (inkSent < d.points.length) {
        var part = Math.floor(inkSent / WB_MAX_POINTS);
        var end = Math.min(d.points.length, (part + 1) * WB_MAX_POINTS);
        if (!d.partIds[part]) d.partIds[part] = uuid();
        if (!send({ t: 'ink', id: d.partIds[part], ink: d.ink, width: d.width, points: d.points.slice(inkSent, end) })) return;
        inkSent = end;
      }
    }

    connect();

    return api();
    function api() {
    return {
      on: function (type, fn) { (handlers[type] = handlers[type] || []).push(fn); },
      connected: function () { return open; },

      /* An editor opened on a note at this revision. */
      begin: function (id, revision) {
        var e = edits[id];
        if (e) { e.ended = false; return; }
        edits[id] = { rev: revision, inflight: 0, sent: null, queued: null, ended: false, waiters: [] };
      },
      /* Every input in an open editor. Empty or over-long bodies are not sent: others keep the last accepted words.
         color undefined leaves the paper color as it is. */
      input: function (id, body, color) {
        var e = edits[id];
        var b = String(body).trim();
        if (!e || !b || Array.from(b).length > 600) return;
        var c = color !== undefined ? color : e.queued ? e.queued.color : undefined;
        e.queued = { body: b, color: c };
        pump(id);
      },
      revision: function (id) { return edits[id] ? edits[id].rev : undefined; },
      /* Resolves 'ok' once everything typed is accepted, 'conflict' or 'gone' if it never will be,
         or 'offline' if the socket is down with words still unsent. */
      settle: function (id) {
        return new Promise(function (resolve) {
          var e = edits[id];
          if (!e) { resolve('ok'); return; }
          e.waiters.push(resolve);
          settle(id);
        });
      },
      /* The editor closed. Words still on their way finish first. */
      end: function (id) {
        if (!edits[id]) return;
        edits[id].ended = true;
        settle(id);
      },
      /* The REST fallback saved it instead: drop what is queued so a reconnect does not send it again. */
      saved: function (note) {
        var e = edits[note.id];
        if (!e) return;
        e.rev = note.revision; e.queued = null; e.sent = null;
        settle(note.id);
      },

      /* pointermove with the pen down: the drawing object as index.html keeps it. */
      ink: function (d) {
        if (d !== inkActive) { flushInk(); inkActive = d; inkSent = 0; }
        if (!inkTimer) inkTimer = setTimeout(flushInk, 32);
      },
      /* pointerup: the rest of the line goes out before the stroke POST. */
      inkEnd: function (d) {
        if (d !== inkActive) return;
        flushInk();
        inkActive = null;
      },
      /* A line that will never be saved (board full, rejected) comes off the other walls too. */
      inkDrop: function (id) { send({ t: 'ink:drop', id: id }); },
      erased: function (ids) { if (ids.length) send({ t: 'erase', ids: ids.slice(0, WB_CAPACITY) }); },
      cleared: function (ids) { if (ids.length) send({ t: 'clear', ids: ids.slice(0, WB_CAPACITY) }); }
    };
    }
  }

  /* GitHub Pages has no office socket. It writes each change to Neon and reads the wall
     again while the tab is open, so other pages see letters and lines without a refresh. */
  function neonLive() {
    var open = false, seq = 0, timer = 0;
    var handlers = {}, edits = {}, seenNotes = {}, seenStrokes = {}, own = {};
    var inkActive = null, inkSent = 0, inkTimer = 0;

    function emit(type, data) {
      (handlers[type] || []).forEach(function (fn) { try { fn(data); } catch (e) { /* one painter must not stop the rest */ } });
    }
    function settle(id) {
      var e = edits[id];
      if (!e) return;
      var idle = !e.inflight && !e.queued;
      if (idle || !open) finish(id, idle ? 'ok' : 'offline');
      if (idle && e.ended) delete edits[id];
    }
    function finish(id, outcome) {
      var e = edits[id];
      if (!e) return;
      var w = e.waiters; e.waiters = [];
      w.forEach(function (fn) { fn(outcome); });
    }
    function pump(id) {
      var e = edits[id];
      if (!e) return;
      if (e.inflight || !e.queued || !open) { settle(id); return; }
      var q = e.queued;
      e.queued = null; e.sent = q; e.inflight = ++seq;
      var mySeq = e.inflight;
      var patch = { body: q.body, revision: e.rev || 0 };
      if (q.color !== undefined) patch.color = q.color;
      neon.notes.update(id, patch).then(function (note) {
        var cur = edits[id];
        if (!cur || cur.inflight !== mySeq) return;
        cur.rev = note.revision; cur.inflight = 0;
        seenNotes[id] = note;
        emit('ack', note);
        pump(id);
      }, function (err) {
        var cur = edits[id];
        if (!cur || cur.inflight !== mySeq) return;
        cur.inflight = 0;
        if (err && err.status === 409 && err.note) {
          cur.rev = err.note.revision; cur.queued = null;
          seenNotes[id] = err.note;
          finish(id, 'conflict');
          emit('conflict', err.note);
          settle(id);
          return;
        }
        if (err && err.status === 404) {
          finish(id, 'gone');
          delete edits[id];
          emit('drop', id);
          return;
        }
        if (!cur.queued) cur.queued = q;
        setTimeout(function () { pump(id); }, 400);
      });
    }
    function applyNotes(list) {
      var ids = {};
      list.forEach(function (n) {
        ids[n.id] = true;
        var prev = seenNotes[n.id];
        seenNotes[n.id] = n;
        if (prev && prev.body === n.body && prev.color === n.color && prev.revision === n.revision) return;
        var mine = edits[n.id];
        if (mine && (mine.queued || mine.inflight)) {
          var pending = mine.queued || mine.sent;
          if (pending && pending.body !== n.body) {
            mine.rev = n.revision;
            mine.queued = null;
            emit('conflict', n);
            return;
          }
        } else if (mine) mine.rev = n.revision;
        emit('note', n);
      });
      Object.keys(seenNotes).forEach(function (id) {
        if (ids[id]) return;
        delete seenNotes[id];
        emit('drop', id);
      });
    }
    function applyStrokes(list) {
      var ids = {};
      list.forEach(function (s) {
        ids[s.id] = true;
        var prev = seenStrokes[s.id];
        var len = s.points ? s.points.length : 0;
        seenStrokes[s.id] = len;
        if (own[s.id]) return;
        if (prev === undefined || prev !== len) emit('stroke', s);
      });
      Object.keys(seenStrokes).forEach(function (id) {
        if (ids[id]) return;
        delete seenStrokes[id];
        delete own[id];
        emit('erase', [id]);
      });
    }
    function tick() {
      if (document.hidden) { timer = setTimeout(tick, 800); return; }
      Promise.all([neon.notes.load(), neon.whiteboard.load()]).then(function (pair) {
        var notes = pair[0], board = pair[1];
        if (!open) {
          open = true;
          notes.notes.forEach(function (n) { seenNotes[n.id] = n; });
          board.strokes.forEach(function (s) { seenStrokes[s.id] = s.points.length; });
          emit('state', true);
          emit('hello', { notes: notes.notes, hasMore: notes.hasMore, strokes: board.strokes, previews: [] });
          Object.keys(edits).forEach(function (id) {
            var x = edits[id];
            if (!seenNotes[id]) { finish(id, 'gone'); delete edits[id]; return; }
            x.rev = seenNotes[id].revision;
            if (x.inflight) { x.queued = x.queued || x.sent; x.inflight = 0; }
          });
          Object.keys(edits).forEach(pump);
          return;
        }
        applyNotes(notes.notes);
        applyStrokes(board.strokes);
      }, function () {
        if (open) { open = false; emit('state', false); }
      }).then(function () { timer = setTimeout(tick, 400); });
    }
    function flushInk() {
      clearTimeout(inkTimer); inkTimer = 0;
      var d = inkActive;
      if (!d || !d.points.length) return;
      if (!d.partIds) d.partIds = [d.id];
      while (inkSent < d.points.length) {
        var part = Math.floor(inkSent / WB_MAX_POINTS);
        var end = Math.min(d.points.length, (part + 1) * WB_MAX_POINTS);
        if (!d.partIds[part]) d.partIds[part] = uuid();
        var slice = d.points.slice(part * WB_MAX_POINTS, end);
        own[d.partIds[part]] = true;
        neon.saveStroke({ id: d.partIds[part], ink: d.ink, width: d.width, points: slice });
        inkSent = end;
      }
    }

    tick();
    return {
      on: function (type, fn) { (handlers[type] = handlers[type] || []).push(fn); },
      connected: function () { return open; },
      begin: function (id, revision) {
        var e = edits[id];
        if (e) { e.ended = false; return; }
        edits[id] = { rev: revision || 0, inflight: 0, sent: null, queued: null, ended: false, waiters: [] };
      },
      input: function (id, body, color) {
        var e = edits[id];
        var b = String(body).trim();
        if (!e || !b || Array.from(b).length > 600) return;
        var c = color !== undefined ? color : e.queued ? e.queued.color : undefined;
        e.queued = { body: b, color: c };
        pump(id);
      },
      revision: function (id) { return edits[id] ? edits[id].rev : undefined; },
      settle: function (id) {
        return new Promise(function (resolve) {
          var e = edits[id];
          if (!e) { resolve('ok'); return; }
          e.waiters.push(resolve);
          settle(id);
        });
      },
      end: function (id) {
        if (!edits[id]) return;
        edits[id].ended = true;
        settle(id);
      },
      saved: function (note) {
        var e = edits[note.id];
        if (!e) return;
        e.rev = note.revision; e.queued = null; e.sent = null;
        seenNotes[note.id] = note;
        settle(note.id);
      },
      ink: function (d) {
        if (d !== inkActive) { flushInk(); inkActive = d; inkSent = 0; }
        if (!inkTimer) inkTimer = setTimeout(flushInk, 80);
      },
      inkEnd: function (d) {
        if (d !== inkActive && d !== undefined) inkActive = d;
        flushInk();
        inkActive = null;
      },
      inkDrop: function (id) { delete own[id]; },
      erased: function () {},
      cleared: function () {}
    };
  }

  window.CE = {
    mode: MODE,
    backend: BACKEND,
    uuid: uuid,
    INK: INK,
    isSample: function (n) { return n.id.indexOf('sample-') === 0; },
    notes: BACKEND === 'server' ? apiNotes : BACKEND === 'neon' ? neon.notes : localNotes,
    whiteboard: whiteboard(BACKEND === 'server' ? apiWb : BACKEND === 'neon' ? neon.whiteboard : localWb),
    /* The office wall uses its socket. GitHub Pages watches Neon while the tab is open.
       A file opened on this computer has neither, and stays on this device. */
    live: BACKEND === 'server' && window.WebSocket ? liveChannel() : BACKEND === 'neon' ? neonLive() : null
  };
})();