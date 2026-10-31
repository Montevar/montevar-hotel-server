// middleware/requireManager.js
const MANAGER_SESSION_MS = 2 * 60 * 60 * 1000; // managers re-authenticate every 2 hours

const allowedManagerEmails = () =>
  (process.env.MANAGER_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

// A manager session is valid only if Google + password both passed recently and
// the email is still on the allow list (removing it from MANAGER_EMAILS revokes access).
const isManagerSession = (req) => {
  const s = req.session;
  if (!s || !s.managerEmail || !s.managerAuthAt) return false;
  if (Date.now() - s.managerAuthAt > MANAGER_SESSION_MS) return false;
  return allowedManagerEmails().includes(s.managerEmail);
};

const requireManager = (req, res, next) => {
  if (isManagerSession(req)) return next();
  return res.status(401).json({ message: 'Manager sign-in required' });
};

module.exports = { requireManager, isManagerSession, allowedManagerEmails, MANAGER_SESSION_MS };
