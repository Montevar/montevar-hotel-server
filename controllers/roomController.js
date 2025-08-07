const Booking = require('../models/booking');
const Room = require('../models/room');

// ✅ Create a room
const createRoom = async (req, res) => {
  try {
    const newRoom = new Room(req.body);
    await newRoom.save();
    res.status(201).json(newRoom);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

// ✅ Get all rooms
const getAllRooms = async (req, res) => {
  try {
    const rooms = await Room.find().lean();
    res.status(200).json(rooms);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


// ✅ Get all rooms with status
const getRoomsWithStatus = async (req, res) => {
  try {
    const rooms = await Room.find().lean();
    const bookings = await Booking.find();

    const now = new Date();

    const updatedRooms = rooms.map((room) => {
      const roomBookings = bookings.filter((b) => b.roomId.toString() === room._id.toString());

      const active = roomBookings.find((b) => {
        return new Date(b.startDate) <= now && now <= new Date(b.endDate);
      });

      let status = null;
      if (active) {
        status = active.type === 'reservation' ? 'Reserved' : 'Booked';
      }

      return {
        ...room,
        status, // null, "Booked", or "Reserved"
        isAvailable: !status,
      };
    });

    res.status(200).json(updatedRooms);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ✅ Get room by ID
const getRoomById = async (req, res) => {
  try {
    const room = await Room.findById(req.params.id);
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }
    res.status(200).json(room);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ✅ Update room
const updateRoom = async (req, res) => {
  try {
    const updatedRoom = await Room.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    );
    if (!updatedRoom) {
      return res.status(404).json({ error: 'Room not found' });
    }
    res.status(200).json(updatedRoom);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

// ✅ Delete room
const deleteRoom = async (req, res) => {
  try {
    const deletedRoom = await Room.findByIdAndDelete(req.params.id);
    if (!deletedRoom) {
      return res.status(404).json({ error: 'Room not found' });
    }
    res.status(200).json({ message: 'Room deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ✅ Check room availability (for public form filters)
const checkAvailability = async (req, res) => {
  const { startDate, endDate, category } = req.query;

  if (!startDate || !endDate || !category) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const overlappingBookings = await Booking.find({
      $or: [
        {
          startDate: { $lt: new Date(endDate) },
          endDate: { $gt: new Date(startDate) },
        },
      ],
    });

    const bookedRoomIds = overlappingBookings.map((b) => b.roomId.toString());

    const availableRooms = await Room.find({
      category,
      _id: { $nin: bookedRoomIds },
    });

    res.status(200).json(availableRooms);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ✅ Export all controller functions
module.exports = {
  createRoom,
  getAllRooms,
  getRoomsWithStatus, // <- NEW
  getRoomById,
  updateRoom,
  deleteRoom,
  checkAvailability,
};
