// utils/audit.js
const AuditLog = require('../models/AuditLog');
const { clientIp } = require('./clientIp');

// Never let logging failures break the request. req is null for automatic (timer) actions.
module.exports = async (req, actor, action, details) => {
  try {
    await AuditLog.create({ actor: actor || 'unknown', action, details, ip: req ? clientIp(req) : undefined });
  } catch (err) {
    console.error('Audit log error:', err.message);
  }
};
