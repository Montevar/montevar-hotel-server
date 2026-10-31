const mongoose = require('mongoose');
const Room = require('../models/room');
const Booking = require('../models/booking');
const audit = require('../utils/audit');

const CATEGORIES = ['Standard', 'Executive', 'Classic Executive', 'Super Executive', 'Royal Suite'];

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Only these fields can be set, each type-checked; returns { values } or { error }
const validateRoom = (body, { partial }) => {
  const values = {};
  const has = (k) => body[k] !== undefined;

  if (!partial || has('name')) {
    if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 60) {
      return { error: 'Room name is required (max 60 characters).' };
    }
    values.name = body.name.trim();
  }
  if (!partial || has('category')) {
    if (!CATEGORIES.includes(body.category)) {
      return { error: `Category must be one of: ${CATEGORIES.join(', ')}.` };
    }
    values.category = body.category;
  }
  if (!partial || has('price')) {
    const price = Number(body.price);
    if (!Number.isInteger(price) || price < 1000 || price > 10000000) {
      return { error: 'Price must be a whole number of naira between 1,000 and 10,000,000.' };
    }
    values.price = price;
  }
  if (has('roomNumber')) {
    if (typeof body.roomNumber !== 'string' || !/^[A-Za-z0-9-]{0,10}$/.test(body.roomNumber.trim())) {
      return { error: 'Room number can only have letters, numbers and dashes (max 10).' };
    }
    values.roomNumber = body.roomNumber.trim();
  }
  if (has('amenities')) {
    const list = body.amenities;
    if (!Array.isArray(list) || list.length > 30 || !list.every((a) => typeof a === 'string' && a.trim() && a.length <= 60)) {
      return { error: 'Amenities must be a list of up to 30 short items.' };
    }
    values.amenities = list.map((a) => a.trim());
  }
  if (has('images')) {
    const list = body.images;
    const validImage = (i) => typeof i === 'string' && i.length <= 500
      && (/^\/images\/[A-Za-z0-9._-]+$/.test(i) || /^https:\/\/[^\s"'<>]+$/.test(i));
    if (!Array.isArray(list) || list.length > 20 || !list.every(validImage)) {
      return { error: 'Images must be up to 20 items, each "/images/file.jpg" or an https:// link.' };
    }
    values.images = list;
  }
  return { values };
};

const nameTaken = (name, exceptId) => Room.exists({
  name: { $regex: `^${escapeRegex(name)}$`, $options: 'i' },
  ...(exceptId ? { _id: { $ne: exceptId } } : {}),
});

// Bookings that still need this room (not cancelled, not yet checked out, not an abandoned checkout)
const upcomingBookingsFilter = (roomName) => ({
  roomName,
  isCancelled: { $ne: true },
  endDate: { $gt: new Date() },
  $nor: [{ isPaid: false, holdExpiresAt: { $lte: new Date() } }],
});

// ✅ Create a room (managers)
const createRoom = async (req, res) => {
  try {
    const { values, error } = validateRoom(req.body || {}, { partial: false });
    if (error) return res.status(400).json({ message: error });
    if (await nameTaken(values.name)) return res.status(409).json({ message: 'A room with this name already exists.' });

    const newRoom = await Room.create(values);
    await audit(req, req.session.managerEmail, 'room.create', { roomId: newRoom._id, name: newRoom.name });
    res.status(201).json(newRoom);
  } catch (err) {
    res.status(500).json({ message: 'Could not create room' });
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

// ✅ Edit a room (managers). Renaming also renames it on its bookings,
// because bookings refer to rooms by name.
const updateRoom = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'Room not found' });
    const room = await Room.findById(req.params.id);
    if (!room) return res.status(404).json({ message: 'Room not found' });

    const { values, error } = validateRoom(req.body || {}, { partial: true });
    if (error) return res.status(400).json({ message: error });
    if (Object.keys(values).length === 0) return res.status(400).json({ message: 'Nothing to update.' });

    const oldName = room.name;
    const renamed = values.name !== undefined && values.name !== oldName;
    if (renamed && await nameTaken(values.name, room._id)) {
      return res.status(409).json({ message: 'A room with this name already exists.' });
    }

    // Keep only the fields that actually change, for the activity log
    const before = {};
    const after = {};
    for (const k of Object.keys(values)) {
      const old = room[k] && room[k].toObject ? room[k].toObject() : room[k];
      if (JSON.stringify(old) !== JSON.stringify(values[k])) {
        before[k] = old;
        after[k] = values[k];
      }
    }

    room.set(values);
    await room.save();
    if (renamed) await Booking.updateMany({ roomName: oldName }, { $set: { roomName: room.name } });

    if (Object.keys(after).length > 0) {
      await audit(req, req.session.managerEmail, 'room.update', { roomId: room._id, name: room.name, before, after });
    }
    res.json(room);
  } catch (err) {
    res.status(500).json({ message: 'Could not update room' });
  }
};

// ✅ Delete a room (managers). Refused while guests still have bookings for it.
const deleteRoom = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'Room not found' });
    const room = await Room.findById(req.params.id);
    if (!room) return res.status(404).json({ message: 'Room not found' });

    // Must type the room name to confirm
    if (typeof req.body?.confirmName !== 'string' || req.body.confirmName.trim() !== room.name) {
      return res.status(400).json({ message: 'Type the room name exactly to confirm deletion.' });
    }

    const upcoming = await Booking.countDocuments(upcomingBookingsFilter(room.name));
    if (upcoming > 0) {
      return res.status(409).json({
        message: `This room has ${upcoming} upcoming booking(s). Cancel or move them before deleting.`,
      });
    }

    await room.deleteOne();
    await audit(req, req.session.managerEmail, 'room.delete', {
      roomId: room._id, name: room.name, category: room.category, price: room.price,
    });
    res.json({ message: 'Room deleted' });
  } catch (err) {
    res.status(500).json({ message: 'Could not delete room' });
  }
};

// ✅ Export all controller functions
module.exports = {
  createRoom,
  getAllRooms,
  updateRoom,
  deleteRoom,
  CATEGORIES,
};
