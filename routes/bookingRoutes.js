const express = require('express');
const router = express.Router();
const isAuthenticated = require('../middleware/isAuthenticated');

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
} = require("../controllers/bookingController");

// ✅ Public Routes (used by frontend)
router.get('/check', checkAvailability); // Check room availability

router.post('/', createBooking); // Create booking directly (for reserved)
router.post("/initialize-payment", initializePayment); // Hold room + start Paystack payment
router.post('/verify-payment', verifyPayment); // Paystack callback verification

// ✅ Admin only (require a logged-in admin session)
router.get('/', isAuthenticated, getBookings); // Fetch all bookings (contains guest details)
router.post('/manual', isAuthenticated, createManualBooking); // Manual booking (admin)
router.post('/reserve', isAuthenticated, createManualBooking); // Reservation via admin UI

router.patch('/cancel/:id', isAuthenticated, cancelBooking); // Cancel a booking (admin)
router.patch('/:id/mark-paid', isAuthenticated, markBookingPaid); // Record cash/transfer payment (admin)
router.delete('/clear-all', isAuthenticated, clearAllBookings); // Danger zone: clears ALL bookings!

module.exports = router;
