// models/Admin.js
const mongoose = require('mongoose');

const AdminSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  totpSecret: { type: String }, // the staff authenticator; set up by a manager on the manager page
  totpSetAt: { type: Date }, // staff who logged in before this are signed out
  totpSetBy: { type: String }, // manager email
  pendingTotpSecret: { type: String }, // a new authenticator waiting for the manager to confirm a code
  pendingTotpCreatedAt: { type: Date },
  pendingTotpBy: { type: String },
  lastTotpStep: { type: Number }, // 30-second step of the last code used (each code works once)
  failedTotpAttempts: { type: Number, default: 0 }, // wrong codes from all visitors in the current window
  failedTotpWindowStart: { type: Date },
  totpLockedUntil: { type: Date },
});

module.exports = mongoose.model('Admin', AdminSchema);
