const express = require('express');
const rateLimit = require('express-rate-limit');
const manager = require('../controllers/managerController');
const { requireManager } = require('../middleware/requireManager');

const router = express.Router();

// Sign-in attempts per IP (on top of the per-account password lockout)
const signInLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many attempts. Please try again in 15 minutes.' },
});

router.get('/session', manager.getSession);
router.post('/google', signInLimiter, manager.googleSignIn);
router.post('/password', signInLimiter, manager.passwordSignIn);
router.post('/set-password', signInLimiter, manager.setInitialPassword);
router.post('/change-password', signInLimiter, requireManager, manager.changePassword);
router.post('/logout', manager.logout);
router.get('/audit', requireManager, manager.getAuditLog);

module.exports = router;
