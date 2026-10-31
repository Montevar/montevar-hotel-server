// controllers/managerController.js
// Manager sign-in is two steps: (1) Google account on the MANAGER_EMAILS list, (2) manager password.
const Manager = require('../models/Manager');
const AuditLog = require('../models/AuditLog');
const verifyGoogleToken = require('../utils/verifyGoogleToken');
const audit = require('../utils/audit');
const { hashPassword, verifyPassword, passwordProblem } = require('../utils/password');
const { allowedManagerEmails, isManagerSession, MANAGER_SESSION_MS } = require('../middleware/requireManager');

const PENDING_MS = 10 * 60 * 1000; // time allowed between the Google step and the password step
const MAX_PASSWORD_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

const regenerate = (req) => new Promise((resolve, reject) => {
  req.session.regenerate((err) => (err ? reject(err) : resolve()));
});

// Google step passed recently and the email is still allowed
const pendingManager = (req) => {
  const pending = req.session && req.session.managerPending;
  if (!pending || Date.now() - pending.at > PENDING_MS) return null;
  if (!allowedManagerEmails().includes(pending.email)) return null;
  return pending;
};

// Fresh session ID, then mark the manager as fully signed in
const completeSignIn = async (req, manager) => {
  await regenerate(req);
  req.session.managerEmail = manager.email;
  req.session.managerName = manager.name;
  req.session.managerAuthAt = Date.now();
};

const signedInResponse = (req) => ({
  stage: 'signed_in',
  email: req.session.managerEmail,
  name: req.session.managerName,
  expiresAt: new Date(req.session.managerAuthAt + MANAGER_SESSION_MS),
});

// GET /api/manager/session
exports.getSession = async (req, res) => {
  if (isManagerSession(req)) return res.json(signedInResponse(req));

  const pending = pendingManager(req);
  if (pending) {
    const manager = await Manager.findOne({ email: pending.email });
    return res.json({
      stage: manager && manager.passwordHash ? 'needs_password' : 'needs_password_setup',
      email: pending.email,
      name: pending.name,
    });
  }

  res.json({ stage: 'signed_out', googleClientId: process.env.GOOGLE_CLIENT_ID || null });
};

// POST /api/manager/google  { credential }
exports.googleSignIn = async (req, res) => {
  try {
    if (!process.env.GOOGLE_CLIENT_ID || allowedManagerEmails().length === 0) {
      return res.status(503).json({ message: 'Manager sign-in is not set up yet.' });
    }

    let google;
    try {
      google = await verifyGoogleToken(req.body && req.body.credential);
    } catch (err) {
      google = null;
    }
    if (!google) {
      await audit(req, 'unknown', 'login.google_invalid');
      return res.status(401).json({ message: 'Google sign-in failed. Please try again.' });
    }

    if (!allowedManagerEmails().includes(google.email)) {
      await audit(req, google.email, 'login.google_not_allowed');
      return res.status(403).json({ message: 'This Google account is not allowed to access management.' });
    }

    const manager = await Manager.findOneAndUpdate(
      { email: google.email },
      { $set: { name: google.name } },
      { upsert: true, new: true }
    );

    await regenerate(req);
    req.session.managerPending = { email: manager.email, name: manager.name, at: Date.now() };
    await audit(req, manager.email, 'login.google_ok');

    res.json({
      stage: manager.passwordHash ? 'needs_password' : 'needs_password_setup',
      email: manager.email,
      name: manager.name,
    });
  } catch (err) {
    console.error('Manager Google sign-in error:', err);
    res.status(500).json({ message: 'Server error' });
  }
};

// POST /api/manager/password  { password }
exports.passwordSignIn = async (req, res) => {
  try {
    const pending = pendingManager(req);
    if (!pending) return res.status(401).json({ message: 'Please sign in with Google first.' });

    const manager = await Manager.findOne({ email: pending.email });
    if (!manager || !manager.passwordHash) {
      return res.status(400).json({ message: 'Please create your manager password first.' });
    }

    if (manager.lockedUntil && manager.lockedUntil > new Date()) {
      const minutes = Math.ceil((manager.lockedUntil - Date.now()) / 60000);
      return res.status(423).json({ message: `Too many wrong passwords. Try again in ${minutes} minute(s).` });
    }

    const ok = typeof req.body?.password === 'string' && await verifyPassword(req.body.password, manager.passwordHash);
    if (!ok) {
      manager.failedPasswordAttempts = (manager.failedPasswordAttempts || 0) + 1;
      if (manager.failedPasswordAttempts >= MAX_PASSWORD_ATTEMPTS) {
        manager.lockedUntil = new Date(Date.now() + LOCKOUT_MS);
        manager.failedPasswordAttempts = 0;
        await manager.save();
        await audit(req, manager.email, 'login.locked');
        return res.status(423).json({ message: 'Too many wrong passwords. Try again in 15 minute(s).' });
      }
      await manager.save();
      await audit(req, manager.email, 'login.password_failed');
      return res.status(401).json({ message: 'Wrong password.' });
    }

    manager.failedPasswordAttempts = 0;
    manager.lockedUntil = undefined;
    manager.lastLoginAt = new Date();
    await manager.save();

    await completeSignIn(req, manager);
    await audit(req, manager.email, 'login.success');
    res.json(signedInResponse(req));
  } catch (err) {
    console.error('Manager password sign-in error:', err);
    res.status(500).json({ message: 'Server error' });
  }
};

// POST /api/manager/set-password  { password }  (first sign-in only)
exports.setInitialPassword = async (req, res) => {
  try {
    const pending = pendingManager(req);
    if (!pending) return res.status(401).json({ message: 'Please sign in with Google first.' });

    const problem = passwordProblem(req.body?.password, pending.email);
    if (problem) return res.status(400).json({ message: problem });

    // Only succeeds if no password exists yet (no overwriting an existing one)
    const manager = await Manager.findOneAndUpdate(
      { email: pending.email, $or: [{ passwordHash: { $exists: false } }, { passwordHash: null }] },
      { $set: { passwordHash: await hashPassword(req.body.password), passwordSetAt: new Date(), lastLoginAt: new Date() } },
      { new: true }
    );
    if (!manager) return res.status(409).json({ message: 'A password already exists. Please sign in with it.' });

    await completeSignIn(req, manager);
    await audit(req, manager.email, 'password.created');
    res.json(signedInResponse(req));
  } catch (err) {
    console.error('Manager set-password error:', err);
    res.status(500).json({ message: 'Server error' });
  }
};

// POST /api/manager/change-password  { currentPassword, newPassword }  (signed-in managers)
exports.changePassword = async (req, res) => {
  try {
    const manager = await Manager.findOne({ email: req.session.managerEmail });
    if (!manager) return res.status(401).json({ message: 'Manager sign-in required' });

    const ok = typeof req.body?.currentPassword === 'string'
      && await verifyPassword(req.body.currentPassword, manager.passwordHash);
    if (!ok) {
      await audit(req, manager.email, 'password.change_failed');
      return res.status(401).json({ message: 'Current password is wrong.' });
    }

    const problem = passwordProblem(req.body?.newPassword, manager.email);
    if (problem) return res.status(400).json({ message: problem });
    if (req.body.newPassword === req.body.currentPassword) {
      return res.status(400).json({ message: 'New password must be different.' });
    }

    manager.passwordHash = await hashPassword(req.body.newPassword);
    manager.passwordSetAt = new Date();
    await manager.save();

    await completeSignIn(req, manager); // new session ID after a credential change
    await audit(req, manager.email, 'password.changed');
    res.json({ message: 'Password changed.' });
  } catch (err) {
    console.error('Manager change-password error:', err);
    res.status(500).json({ message: 'Server error' });
  }
};

// POST /api/manager/logout
exports.logout = async (req, res) => {
  const email = req.session && (req.session.managerEmail || req.session.managerPending?.email);
  if (email) await audit(req, email, 'logout');
  req.session.destroy(() => {
    const insecure = process.env.COOKIE_INSECURE === 'true'; // same options as the session cookie in server.js
    res.clearCookie('connect.sid', { httpOnly: true, sameSite: insecure ? 'Lax' : 'None', secure: !insecure });
    res.json({ success: true });
  });
};

// GET /api/manager/audit  (signed-in managers)
exports.getAuditLog = async (req, res) => {
  const entries = await AuditLog.find().sort({ at: -1 }).limit(100).lean();
  res.json(entries.map(({ _id, __v, ...e }) => e));
};
