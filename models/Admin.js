// models/Admin.js
const mongoose = require('mongoose');

const AdminSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  totpSecret: { type: String, required: true },
});

module.exports = mongoose.model('Admin', AdminSchema);
