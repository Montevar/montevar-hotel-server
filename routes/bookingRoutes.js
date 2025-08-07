const express = require('express');
const router = express.Router();

const {
  getBookings,
  createBooking,
  createManualBooking,
  cancelBooking,
  verifyPayment,
  checkAvailability,
  clearAllBookings,
} = require("../controllers/bookingController");

// ✅ Public Routes (used by frontend)
router.get('/', getBookings); // Fetch all bookings (consider protecting this in future)
router.get('/check', checkAvailability); // Check room availability

router.post('/', createBooking); // Create online booking via Paystack
router.post('/verify-payment', verifyPayment); // Paystack callback verification

// ✅ Admin / Internal Tools (consider protecting these with auth middleware)
router.post('/manual', createManualBooking); // Manual booking (admin)
router.post('/reserve', createManualBooking); // Reservation via UI

router.patch('/cancel/:id', cancelBooking); // Cancel a booking (admin)
router.delete('/clear-all', clearAllBookings); // ⚠️ Danger zone: clears ALL bookings!

module.exports = router;
