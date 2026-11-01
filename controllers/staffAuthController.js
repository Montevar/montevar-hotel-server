// controllers/staffAuthController.js
// Managers set up the Google Authenticator that receptionists use to log in to the dashboard.
// A new authenticator only replaces the old one after the manager proves it works with a code
// from the phone, and then every staff session logged in with the old one is signed out.
const speakeasy = require('speakeasy');
const qrcode = require('qrcode');
const Admin = require('../models/Admin');
const audit = require('../utils/audit');

const STAFF_USERNAME = 'admin'; // the single staff login (see routes/auth/totp.js)
const PENDING_SETUP_MS = 15 * 60 * 1000; // time to scan the QR code and confirm
const TOTP_STEP_SECONDS = 30;

const hotelDate = (date) =>
  new Date(date).toLocaleDateString('en-GB', { timeZone: 'Africa/Lagos', day: 'numeric', month: 'short', year: 'numeric' });

const pendingSetup = (admin) =>
  admin && admin.pendingTotpSecret && admin.pendingTotpCreatedAt &&
  Date.now() - admin.pendingTotpCreatedAt.getTime() < PENDING_SETUP_MS
    ? admin
    : null;

// ✅ What the manager page shows: is staff login set up, since when, is it paused
const getStatus = async (req, res) => {
  try {
    const admin = await Admin.findOne({ username: STAFF_USERNAME }).lean();
    const pending = pendingSetup(admin);
    res.json({
      configured: !!admin?.totpSecret,
      setAt: admin?.totpSetAt || null,
      setBy: admin?.totpSetBy || null,
      lockedUntil: admin?.totpLockedUntil > new Date() ? admin.totpLockedUntil : null,
      pendingStartedBy: pending ? pending.pendingTotpBy : null,
    });
  } catch (err) {
    console.error('Staff authenticator status error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
};

// ✅ Step 1: make a new secret and QR code. The old authenticator keeps working until step 2.
const startSetup = async (req, res) => {
  try {
    const label = `Montevar Staff (${hotelDate(new Date())})`;
    const secret = speakeasy.generateSecret({ length: 20, name: label, issuer: 'Montevar Hotel' });
    const qr = await qrcode.toDataURL(secret.otpauth_url);

    await Admin.updateOne(
      { username: STAFF_USERNAME },
      { $set: { pendingTotpSecret: secret.base32, pendingTotpCreatedAt: new Date(), pendingTotpBy: req.session.managerEmail } },
      { upsert: true }
    );

    res.set('Cache-Control', 'no-store');
    res.json({ qr, secret: secret.base32, label, expiresAt: new Date(Date.now() + PENDING_SETUP_MS) });
  } catch (err) {
    console.error('Staff authenticator setup error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
};

// ✅ Step 2: the manager types a code from the newly scanned phone; only then does it replace the old one
const confirmSetup = async (req, res) => {
  try {
    const code = String(req.body?.code || '').replace(/\s/g, '');
    if (!/^\d{6}$/.test(code)) return res.status(400).json({ message: 'Enter the 6-digit code shown in Google Authenticator.' });

    const admin = await Admin.findOne({ username: STAFF_USERNAME });
    if (!pendingSetup(admin)) {
      return res.status(400).json({ message: 'This setup has expired. Please start again and scan the new QR code.' });
    }

    const match = speakeasy.totp.verifyDelta({ secret: admin.pendingTotpSecret, encoding: 'base32', token: code, window: 1 });
    if (!match) {
      return res.status(401).json({ message: "That code doesn't match. Check you scanned the newest QR code and the phone's clock is set automatically." });
    }

    const now = new Date();
    const step = Math.floor(now.getTime() / 1000 / TOTP_STEP_SECONDS) + match.delta;
    const replaced = !!admin.totpSecret;
    // Only if no other manager started a different setup in the meantime
    const result = await Admin.updateOne(
      { _id: admin._id, pendingTotpSecret: admin.pendingTotpSecret },
      {
        $set: {
          totpSecret: admin.pendingTotpSecret,
          totpSetAt: now,
          totpSetBy: req.session.managerEmail,
          lastTotpStep: step, // the code used here can't also be used to log in
          failedTotpAttempts: 0,
        },
        $unset: { pendingTotpSecret: '', pendingTotpCreatedAt: '', pendingTotpBy: '', failedTotpWindowStart: '', totpLockedUntil: '' },
      }
    );
    if (result.modifiedCount !== 1) {
      return res.status(409).json({ message: 'Another setup was started meanwhile. Please start again.' });
    }

    await audit(req, req.session.managerEmail, 'staff_authenticator.replace', {
      note: replaced
        ? 'New staff authenticator activated. The old one stopped working and staff were signed out.'
        : 'Staff authenticator set up.',
    });
    res.json({ success: true, setAt: now });
  } catch (err) {
    console.error('Staff authenticator confirm error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
};

// ✅ Throw away an unfinished setup
const cancelSetup = async (req, res) => {
  try {
    await Admin.updateOne(
      { username: STAFF_USERNAME },
      { $unset: { pendingTotpSecret: '', pendingTotpCreatedAt: '', pendingTotpBy: '' } }
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Staff authenticator cancel error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
};

module.exports = { getStatus, startSetup, confirmSetup, cancelSetup };
