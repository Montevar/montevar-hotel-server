const express = require('express');
const router = express.Router();
const roomController = require('../controllers/roomController');
const bookingController = require('../controllers/bookingController');
const { requireManager } = require('../middleware/requireManager');

// ✅ Route to check availability (use bookingController only)
router.get('/availability', bookingController.checkAvailability);

// ✅ Get all rooms
router.get('/', roomController.getAllRooms);

// ✅ Upper management only: add, edit, delete rooms
router.post('/', requireManager, roomController.createRoom);
router.put('/:id', requireManager, roomController.updateRoom);
router.delete('/:id', requireManager, roomController.deleteRoom);

module.exports = router;
