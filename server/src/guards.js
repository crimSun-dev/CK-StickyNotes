'use strict';

const { rateLimit } = require('express-rate-limit');
const { sendError } = require('./errors');

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function hasBody(req) {
  const len = req.headers['content-length'];
  return req.headers['transfer-encoding'] !== undefined || (len !== undefined && Number(len) > 0);
}

/* Same-origin only: the page and the API share one origin, so any other Origin is a foreign site.
 * Requests without an Origin header (curl, same-origin navigations) are allowed. No cors(). */
function originAllowed(origin, protocol, host) {
  return origin === undefined || origin === protocol + '://' + host;
}
function sameOrigin(req, res, next) {
  if (!originAllowed(req.headers.origin, req.protocol, req.get('host'))) {
    return sendError(res, 403, 'forbidden_origin', 'Cross-origin requests are not allowed');
  }
  next();
}

/* Writes that carry a body must be JSON. Blocks cross-site "simple" form/text POSTs. */
function requireJson(req, res, next) {
  if (WRITE_METHODS.has(req.method) && hasBody(req) && !req.is('application/json')) {
    return sendError(res, 415, 'unsupported_media_type', 'Request body must be application/json');
  }
  next();
}

/* Generous per-IP write limit: the whole office may share one NAT address. Callers pick the budget. */
function writeLimiter({ limit, windowMs = 60_000 }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: (req) => !WRITE_METHODS.has(req.method),
    handler: (req, res) => sendError(res, 429, 'rate_limited', 'Too many changes at once. Try again in a minute.'),
  });
}

module.exports = { originAllowed, sameOrigin, requireJson, writeLimiter };
