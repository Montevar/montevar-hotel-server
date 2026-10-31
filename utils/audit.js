// utils/audit.js
const AuditLog = require('../models/AuditLog');

// Never let logging failures break the request
module.exports = async (req, actor, action, details) => {
  try {
    await AuditLog.create({ actor: actor || 'unknown', action, details, ip: req.ip });
  } catch (err) {
    console.error('Audit log error:', err.message);
  }
};
