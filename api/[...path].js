'use strict';
/* Vercel serverless entry point for every /api/* request (catch-all route).

   Requests reach this file directly, without a rewrite, so req.url is the exact path the browser sent —
   encoded ids such as a job number "5502%2FWA" arrive intact. (Vercel hands a REWRITTEN request the
   destination path instead; see the __p handling in server.js.) Same shared handler as api/index.js. */
module.exports = require('../server.js');
