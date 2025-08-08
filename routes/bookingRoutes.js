const express = require('express');
const router = express.Router();

const {
  getBookings,
  createBooking,
  createManualBooking,
  cancelBooking,
  verifyPayment,
  initializePayment, // ✅ correctly imported
  checkAvailability,
  clearAllBookings,
} = require("../controllers/bookingController");

// ✅ Public Routes (used by frontend)
router.get('/', getBookings); // Fetch all bookings
router.get('/check', checkAvailability); // Check room availability

router.post('/', createBooking); // Create booking directly (for reserved)
router.post("/initialize-payment", initializePayment); // ✅ use correctly
router.post('/verify-payment', verifyPayment); // Paystack callback verification

// ✅ Admin / Internal Tools
router.post('/manual', createManualBooking); // Manual booking (admin)
router.post('/reserve', createManualBooking); // Reservation via UI

router.patch('/cancel/:id', cancelBooking); // Cancel a booking (admin)
router.delete('/clear-all', clearAllBookings); // Danger zone: clears ALL bookings!

module.exports = router;
