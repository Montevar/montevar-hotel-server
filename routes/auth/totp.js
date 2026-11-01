const express = require('express');
const speakeasy = require('speakeasy');
const rateLimit = require('express-rate-limit');
const Admin = require('../../models/Admin'); // adjust path as needed
const { isStaffSession } = require('../../middleware/isAuthenticated');
const audit = require('../../utils/audit');
const { limiterKey } = require('../../utils/clientIp');
const { isManagerSession } = require('../../middleware/requireManager');

const router = express.Router();

// Slow down guessing of 6-digit codes: per visitor...
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: limiterKey,
  message: { message: 'Too many attempts. Please try again in 15 minutes.' },
});

// The staff authenticator (TOTP secret) is set up and replaced by managers only,
// on the manager page (see controllers/staffAuthController.js).

// Verify TOTP
// ...and for the account as a whole, so many visitors (a botnet) can't share out the guessing
const MAX_FAILED_TOTP = 20;
const TOTP_WINDOW_MS = 15 * 60 * 1000;
const TOTP_STEP_SECONDS = 30;

router.post('/verify-totp', loginLimiter, express.json(), async (req, res) => {
  const { code } = req.body;

  if (!code) return res.status(400).json({ message: 'Missing code' });

  try {
    const admin = await Admin.findOne({ username: 'admin' });
    if (!admin || !admin.totpSecret) {
      return res.status(401).json({ message: 'Staff login is not set up yet. Ask a manager to set it up.' });
    }

    if (admin.totpLockedUntil && admin.totpLockedUntil > new Date()) {
      const minutes = Math.ceil((admin.totpLockedUntil - Date.now()) / 60000);
      return res.status(423).json({ message: `Too many wrong codes. Staff login is paused for ${minutes} minute(s).` });
    }

    const match = speakeasy.totp.verifyDelta({
      secret: admin.totpSecret,
      encoding: 'base32',
      token: String(code),
      window: 1,
    });

    if (!match) {
      const now = new Date();
      const freshWindow = !admin.failedTotpWindowStart || now - admin.failedTotpWindowStart > TOTP_WINDOW_MS;
      admin.failedTotpAttempts = freshWindow ? 1 : (admin.failedTotpAttempts || 0) + 1;
      if (freshWindow) admin.failedTotpWindowStart = now;
      if (admin.failedTotpAttempts >= MAX_FAILED_TOTP) {
        admin.totpLockedUntil = new Date(now.getTime() + TOTP_WINDOW_MS);
        admin.failedTotpAttempts = 0;
        admin.failedTotpWindowStart = undefined;
        await audit(req, 'Receptionist (staff login)', 'staff_login.locked', { failedCodes: MAX_FAILED_TOTP });
      }
      await admin.save();
      return res.status(401).json({ message: 'Invalid code' });
    }

    // Each code works only once: refuse a code from the same (or an earlier) 30-second step
    const step = Math.floor(Date.now() / 1000 / TOTP_STEP_SECONDS) + match.delta;
    const claimed = await Admin.findOneAndUpdate(
      { _id: admin._id, $or: [{ lastTotpStep: { $exists: false } }, { lastTotpStep: null }, { lastTotpStep: { $lt: step } }] },
      { $set: { lastTotpStep: step, failedTotpAttempts: 0 }, $unset: { failedTotpWindowStart: '', totpLockedUntil: '' } }
    );
    if (!claimed) {
      return res.status(401).json({ message: 'This code was already used. Please wait for the next code.' });
    }

    // New session ID on login, so an old/planted session cookie can't be reused
    req.session.regenerate((err) => {
      if (err) {
        console.error('Session regenerate error:', err);
        return res.status(500).json({ message: 'Server error' });
      }
      req.session.adminId = admin._id; // ✅ Store admin session
      req.session.isAuthenticated = true;
      req.session.staffLoginAt = Date.now(); // a newer staff authenticator signs this session out
      audit(req, 'Receptionist (staff login)', 'staff_login.success');
      res.json({ success: true });
    });
  } catch (err) {
    console.error('TOTP verification error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Logout route
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    const insecure = process.env.COOKIE_INSECURE === 'true'; // same options as the session cookie in server.js
    res.clearCookie('connect.sid', { httpOnly: true, sameSite: insecure ? 'Lax' : 'None', secure: !insecure });
    res.json({ success: true });
  });
});


router.get('/check-session', async (req, res) => {
  try {
    if (await isStaffSession(req)) return res.json({ authenticated: true });
    if (isManagerSession(req)) return res.json({ authenticated: true, manager: true });
    res.json({ authenticated: false });
  } catch (err) {
    console.error('Session check error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});


module.exports = router;
