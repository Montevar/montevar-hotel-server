const express = require('express');
const router = express.Router();
const isAuthenticated = require('../middleware/isAuthenticated');
const rateLimit = require('express-rate-limit');
const { requireManager } = require('../middleware/requireManager');
const { limiterKey } = require('../utils/clientIp');

// Public booking endpoints: stop one visitor flooding the hotel with fake reservations or room holds
const publicBookingLimit = (max) => rateLimit({
  windowMs: 60 * 60 * 1000,
  max,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: limiterKey,
  message: { message: 'Too many booking attempts. Please try again later or call the hotel.' },
});

const {
  getBookings,
  createBooking,
  createManualBooking,
  cancelBooking,
  markBookingPaid,
  verifyPayment,
  initializePayment,
  checkAvailability,
  clearAllBookings,
  managerUpdateBooking,
  decideDiscount,
  managerDeleteBooking,
} = require("../controllers/bookingController");

// ✅ Public Routes (used by frontend)
router.get('/check', checkAvailability); // Check room availability

router.post('/', publicBookingLimit(5), createBooking); // Create booking directly (for reserved)
router.post("/initialize-payment", publicBookingLimit(10), initializePayment); // Hold room + start Paystack payment
router.post('/verify-payment', verifyPayment); // Paystack callback verification

// ✅ Admin only (require a logged-in admin session)
router.get('/', isAuthenticated, getBookings); // Fetch all bookings (contains guest details)
router.post('/manual', isAuthenticated, createManualBooking); // Manual booking (admin)
router.post('/reserve', isAuthenticated, createManualBooking); // Reservation via admin UI

router.patch('/cancel/:id', isAuthenticated, cancelBooking); // Cancel a booking (admin)
router.patch('/:id/mark-paid', isAuthenticated, markBookingPaid); // Record cash/transfer payment (admin)
router.delete('/clear-all', requireManager, clearAllBookings); // Danger zone: clears ALL bookings! (managers only, typed confirmation)

// ✅ Upper management only (audited, reason required)
router.put('/:id', requireManager, managerUpdateBooking); // Edit any booking
router.patch('/:id/discount', requireManager, decideDiscount); // Approve or reject a front-desk discount
router.delete('/:id', requireManager, managerDeleteBooking); // Delete any booking

module.exports = router;
