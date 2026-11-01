// server/middleware/isAuthenticated.js
const Admin = require('../models/Admin');
const { isManagerSession } = require('./requireManager');

// A staff (receptionist) session from the TOTP login (see routes/auth/totp.js). It stops working
// when a manager sets up a new staff authenticator after the staff member logged in.
const isStaffSession = async (req) => {
  const s = req.session;
  if (!s || !s.isAuthenticated || !s.adminId) return false;
  const admin = await Admin.findById(s.adminId, 'totpSetAt').lean();
  if (!admin) return false;
  if (admin.totpSetAt && !(s.staffLoginAt >= admin.totpSetAt.getTime())) return false;
  return true;
};

// Lets the request through for logged-in staff and for signed-in managers.
const isAuthenticated = async (req, res, next) => {
  try {
    if (await isStaffSession(req)) return next();
    if (isManagerSession(req)) return next();
    return res.status(401).json({ message: 'Unauthorized' });
  } catch (err) {
    console.error('Session check error:', err.message);
    return res.status(500).json({ message: 'Server error' });
  }
};

module.exports = isAuthenticated;
module.exports.isStaffSession = isStaffSession;
