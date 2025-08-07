const express = require('express');
const router = express.Router();
const roomController = require('../controllers/roomController');
const bookingController = require('../controllers/bookingController'); // ✅ ADD THIS

// ✅ Route to check availability (use bookingController only)
router.get('/availability', bookingController.checkAvailability);

// ✅ Get all rooms
router.get('/', roomController.getAllRooms);

// ✅ Create a new room
router.post('/', roomController.createRoom);

module.exports = router;
