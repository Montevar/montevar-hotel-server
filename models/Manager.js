// models/Manager.js
const mongoose = require('mongoose');

// Upper management accounts. Who may sign in is decided by MANAGER_EMAILS;
// this record only holds the manager's password and lockout state.
const ManagerSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  name: { type: String },
  passwordHash: { type: String },
  passwordSetAt: { type: Date },
  failedPasswordAttempts: { type: Number, default: 0 },
  lockedUntil: { type: Date },
  lastLoginAt: { type: Date },
}, { timestamps: true });

module.exports = mongoose.models.Manager || mongoose.model('Manager', ManagerSchema);
