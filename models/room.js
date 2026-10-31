const mongoose = require('mongoose');

const roomSchema = new mongoose.Schema({
  name: { type: String, required: true },
  category: { type: String, required: true },
  price: { type: Number, required: true },
  roomNumber: { type: String }, // stored as text in the database, e.g. "020"
  images: [String],
  amenities: [String],
});

// Use existing model if available, otherwise create new
const Room = mongoose.models.Room || mongoose.model('Room', roomSchema);

module.exports = Room;
