// server/middleware/isAuthenticated.js
const { isManagerSession } = require('./requireManager');

// Lets the request through for staff who logged in via TOTP (see routes/auth/totp.js)
// and for signed-in managers.
module.exports = (req, res, next) => {
  if (req.session && req.session.isAuthenticated && req.session.adminId) {
    return next();
  }
  if (isManagerSession(req)) return next();
  return res.status(401).json({ message: 'Unauthorized' });
};
