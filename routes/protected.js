// server/routes/protected.js
const express = require('express');
const isAuthenticated = require('../middleware/isAuthenticated');

const router = express.Router();

// This is your existing protected route
router.get('/protected', isAuthenticated, (req, res) => {
  res.json({ message: 'Secure content: Only logged-in admins can see this.' });
});

// ✅ Add this new route for session check
// NEW
router.get('/auth/check-session', (req, res) => {
  if (req.session && req.session.isAuthenticated) {
    return res.status(200).json({ authenticated: true });
  } else {
    return res.status(401).json({ authenticated: false });
  }
});

module.exports = router;
