'use strict';
/* Vercel serverless entry point for the paths vercel.json rewrites here: /metrics, /uploads/* and the
   app's page paths. Vercel passes the rewrite destination (/api/index) as req.url, so the original path
   rides along as ?__p= and server.js restores it. /api/* is served by api/[...path].js instead.

   Both delegate to the shared request handler exported by ../server.js — the very same handler the
   long-running on-prem server uses behind http.createServer, so there is one code path for both. */
module.exports = require('../server.js');
