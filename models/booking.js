const mongoose = require("mongoose");

const bookingSchema = new mongoose.Schema({
  fullName: {
    type: String,
    required: true,
  },
  phone: {
    type: String,
    required: true,
  },
  email: {
    type: String,
    required: true,
  },
  roomName: {
    type: String,
    required: true,
  },
  roomNumber: {
    type: Number,
    required: true,
  },
  roomPrice: {
    type: Number,
    required: true,
  },
  nights: {
    type: Number,
  },
  totalAmount: {
    type: Number, // roomPrice × nights, in naira
  },
  amountPaid: {
    type: Number, // what Paystack actually charged, in naira
  },
  startDate: {
    type: Date,
    required: true,
  },
  endDate: {
    type: Date,
    required: true,
  },
  isPaid: {
    type: Boolean,
    default: false,
  },
  source: {
  type: String,
  enum: ["admin", "online", "dashboard", "user"],
  required: true,
},
paymentMethod: {
  type: String,
  enum: ["paystack", "manual", "none", "settled"], // optional clarity
  default: "none",
},

  paymentStatus: {
  type: String,
  enum: ["pending", "paid", "settled"],
  default: "pending",
},


  isCancelled: {
    type: Boolean,
    default: false,
  },

   reference: {
    type: String,
    index: true,
  },

  // While set and in the future, an unpaid Paystack checkout is holding the room
  holdExpiresAt: {
    type: Date,
  },

  // Set when a paid booking needs the admin to step in (e.g. room clash, short payment)
  needsAttention: {
    type: String,
  },

  room: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Room",
  },
}, { timestamps: true });

// ✅ Prevent OverwriteModelError in dev environments or when hot reloading
const Booking = mongoose.models.Booking || mongoose.model("Booking", bookingSchema);

module.exports = Booking;
