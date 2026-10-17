'use strict';

const path = require('node:path');
const express = require('express');
const { sameOrigin, requireJson, writeLimiter } = require('./guards');
const { notesRouter } = require('./notes');
const { whiteboardRouter } = require('./whiteboard');
const { sendError } = require('./errors');
const { createHub } = require('./live');

const SITE_DIR = path.join(__dirname, '..', '..', 'scrollcraft', 'builds', 'creative-episode');
const CE_CONFIG = "window.CE_STORE = 'api';\n";

/* rateLimit: { notes: { limit, windowMs }, whiteboard: { limit, windowMs } } overrides, mainly for tests.
 * trustProxy: proxy hops in front (Render: 1). Without it, HTTPS behind a proxy looks like http and every write fails the Origin check.
 * hub: the /v1/live room (src/live.js). REST writes are told to it; app.locals.hub hands it to attachLive. */
function createApp({ pool, companyId, rateLimit = {}, siteDir = SITE_DIR, trustProxy = 0, hub = createHub() }) {
  const app = express();
  app.locals.hub = hub;
  app.disable('x-powered-by');
  if (trustProxy) app.set('trust proxy', trustProxy);

  // Tells index.html it is being served by this server, so it uses the API store.
  app.get('/ce-config.js', (req, res) => {
    res.type('application/javascript').set('Cache-Control', 'no-store').send(CE_CONFIG);
  });

  const v1 = express.Router();
  v1.use(sameOrigin, requireJson);
  // Each surface gets its own body cap and its own per-IP write budget: drawing writes far more often than typing.
  v1.use('/notes',
    writeLimiter(Object.assign({ limit: 300 }, rateLimit.notes)),
    express.json({ limit: '16kb' }),
    notesRouter({ pool, companyId, hub }));
  v1.use('/whiteboard',
    writeLimiter(Object.assign({ limit: 1200 }, rateLimit.whiteboard)),
    express.json({ limit: '96kb' }),
    whiteboardRouter({ pool, companyId, hub }));
  v1.use((req, res) => sendError(res, 404, 'not_found', 'Not found'));
  app.use('/v1', v1);

  app.use(express.static(siteDir));

  // Last: never leak SQL, stack traces, or connection details to the client.
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err.type === 'entity.parse.failed') return sendError(res, 400, 'invalid_json', 'Request body is not valid JSON');
    if (err.type === 'entity.too.large') return sendError(res, 413, 'payload_too_large', 'Request body is too large');
    if (err.code === '23514') return sendError(res, 400, 'validation_failed', 'Note failed validation');
    console.error(err.stack || err);
    sendError(res, 500, 'server_error', 'Internal server error');
  });

  return app;
}

module.exports = { createApp, SITE_DIR };
