const express = require('express');
const speakeasy = require('speakeasy');
const qrcode = require('qrcode');
const rateLimit = require('express-rate-limit');
const Admin = require('../../models/Admin'); // adjust path as needed
const isAuthenticated = require('../../middleware/isAuthenticated');
const { isManagerSession } = require('../../middleware/requireManager');

const router = express.Router();

// Slow down guessing of 6-digit codes
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many attempts. Please try again in 15 minutes.' },
});

// Generate TOTP secret and QR
// Allowed only for first-time setup (no admin yet) or by an admin who is already logged in,
// otherwise anyone could replace the secret and take over the dashboard.
router.post('/generate-totp', async (req, res, next) => {
  try {
    const existing = await Admin.exists({ username: 'admin' });
    if (!existing) return next();
    return isAuthenticated(req, res, next);
  } catch (err) {
    console.error('Error checking admin:', err);
    res.status(500).json({ message: 'Server error' });
  }
}, async (req, res) => {
  try {
    const username = 'admin'; // this can be made dynamic if needed
    const secret = speakeasy.generateSecret({ name: 'Montevar Admin' });

    const otpauthUrl = secret.otpauth_url;
    const qr = await qrcode.toDataURL(otpauthUrl);

    // Upsert admin record
    await Admin.findOneAndUpdate(
      { username },
      { totpSecret: secret.base32 },
      { upsert: true, new: true }
    );

    res.json({ qr, secret: secret.base32 });
  } catch (err) {
    console.error('Error generating TOTP:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Verify TOTP
router.post('/verify-totp', loginLimiter, express.json(), async (req, res) => {
  const { code } = req.body;

  if (!code) return res.status(400).json({ message: 'Missing code' });

  try {
    const admin = await Admin.findOne({ username: 'admin' });
    if (!admin) return res.status(401).json({ message: 'Admin not found' });

    const verified = speakeasy.totp.verify({
      secret: admin.totpSecret,
      encoding: 'base32',
      token: String(code),
      window: 1,
    });

    if (!verified) return res.status(401).json({ message: 'Invalid code' });

    // New session ID on login, so an old/planted session cookie can't be reused
    req.session.regenerate((err) => {
      if (err) {
        console.error('Session regenerate error:', err);
        return res.status(500).json({ message: 'Server error' });
      }
      req.session.adminId = admin._id; // ✅ Store admin session
      req.session.isAuthenticated = true;
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


router.get('/check-session', (req, res) => {
  if (req.session && req.session.isAuthenticated && req.session.adminId) {
    return res.json({ authenticated: true });
  }
  if (isManagerSession(req)) return res.json({ authenticated: true, manager: true });
  res.json({ authenticated: false });
});


module.exports = router;
