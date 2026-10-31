// Clears a manager's password and lockout so they can create a new one at next sign-in.
// Usage (with MONGO_URI set):  node scripts/reset-manager-password.js manager@example.com
require('dotenv').config();
const mongoose = require('mongoose');
const Manager = require('../models/Manager');

(async () => {
  const email = String(process.argv[2] || '').trim().toLowerCase();
  if (!email) {
    console.error('Usage: node scripts/reset-manager-password.js manager@example.com');
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGO_URI);
  const result = await Manager.updateOne(
    { email },
    { $unset: { passwordHash: 1, passwordSetAt: 1, lockedUntil: 1 }, $set: { failedPasswordAttempts: 0 } }
  );
  console.log(result.matchedCount ? `Password reset for ${email}.` : `No manager found for ${email}.`);
  await mongoose.disconnect();
})();
