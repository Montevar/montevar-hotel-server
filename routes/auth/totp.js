const express = require('express');
const speakeasy = require('speakeasy');
const qrcode = require('qrcode');
const cookie = require('cookie');
const Admin = require('../../models/Admin'); // adjust path as needed

const router = express.Router();

// Generate TOTP secret and QR
router.get('/generate-totp', async (req, res) => {
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
// Verify TOTP
router.post('/verify-totp', express.json(), async (req, res) => {
  const { code } = req.body;

  if (!code) return res.status(400).json({ message: 'Missing code' });

  try {
    const admin = await Admin.findOne({ username: 'admin' });
    if (!admin) return res.status(401).json({ message: 'Admin not found' });

    const verified = speakeasy.totp.verify({
      secret: admin.totpSecret,
      encoding: 'base32',
      token: code,
      window: 1,
    });

    if (verified) {
      req.session.adminId = admin._id; // ✅ Store admin session
      req.session.isAuthenticated = true; // ✅ THIS IS WHAT YOU'RE MISSING
      return res.json({ success: true });
    }

    return res.status(401).json({ message: 'Invalid code' });
  } catch (err) {
    console.error('TOTP verification error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Logout route
// Logout route
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid'); // Important if you're using the default session cookie
    res.json({ success: true });
  });
});


router.get('/check-session', (req, res) => {
  if (req.session && req.session.adminId) {
    return res.json({ authenticated: true });
  }
  res.json({ authenticated: false });
});


module.exports = router;
