// models/AuditLog.js
const mongoose = require('mongoose');

// Record of manager sign-ins, room changes and booking changes (kept for one year)
const AuditLogSchema = new mongoose.Schema({
  actor: { type: String, required: true }, // manager email, "Receptionist (staff login)", or "unknown"
  action: { type: String, required: true }, // e.g. "room.update", "login.password_failed"
  details: { type: mongoose.Schema.Types.Mixed },
  ip: { type: String },
  at: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 365 },
});

module.exports = mongoose.models.AuditLog || mongoose.model('AuditLog', AuditLogSchema);
