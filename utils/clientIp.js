// utils/clientIp.js
const { ipKeyGenerator } = require('express-rate-limit');

// The visitor's real IP address. On Render every request passes through Cloudflare, which always
// sets CF-Connecting-IP to the real client address (visitors can't fake it). req.ip there is a
// shared proxy address, so rate limits keyed on it would lump every visitor together.
// Locally (no Cloudflare) this falls back to req.ip.
const clientIp = (req) => req.headers['cf-connecting-ip'] || req.ip;

// Rate-limit key: one bucket per visitor (IPv6 grouped by /56 so one machine can't rotate addresses)
const limiterKey = (req) => ipKeyGenerator(clientIp(req));

module.exports = { clientIp, limiterKey };
