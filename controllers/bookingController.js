const Booking = require("../models/booking");
const Room = require("../models/room");
const axios = require("axios");

const PAYSTACK_BASE_URL = process.env.PAYSTACK_BASE_URL || "https://api.paystack.co";
const FRONTEND_URL = process.env.FRONTEND_URL || "https://www.montevarhotel.com";

const DAY_MS = 24 * 60 * 60 * 1000;
const CHECK_IN_HOUR = 14; // 2:00 PM (hotel time, see TZ in server.js)
const CHECK_OUT_HOUR = 12; // 12:00 noon
const PAYMENT_HOLD_MINUTES = 30; // room is held this long while the guest pays on Paystack

const paystackHeaders = () => ({
  Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
  "Content-Type": "application/json",
});

// Utility: read the calendar day from "YYYY-MM-DD" (or an ISO string) as local midnight
const dayOf = (value) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ""));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return isNaN(d.getTime()) ? null : d;
};

// Utility: turn check-in/check-out dates into exact times and a night count
const parseStay = (startDate, endDate) => {
  const startDay = dayOf(startDate);
  const endDay = dayOf(endDate);
  if (!startDay || !endDay) {
    return { error: "Please provide valid check-in and check-out dates." };
  }

  const nights = Math.round((endDay - startDay) / DAY_MS);
  if (nights < 1) {
    return { error: "Check-out must be at least one day after check-in." };
  }

  const start = new Date(startDay);
  start.setHours(CHECK_IN_HOUR, 0, 0, 0);
  const end = new Date(endDay);
  end.setHours(CHECK_OUT_HOUR, 0, 0, 0);

  return { start, end, nights };
};

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

const isStartDateValid = (startDate) => {
  const minStart = new Date(Date.now() + DAY_MS); // now + 24 hours
  return startDate >= minStart;
};

// Query for bookings that block a room between start and end.
// Unpaid Paystack holds stop blocking the room once they expire.
const blockingBookingsQuery = (roomNames, start, end, excludeId) => {
  const query = {
    roomName: Array.isArray(roomNames) ? { $in: roomNames } : roomNames,
    isCancelled: { $ne: true },
    startDate: { $lt: end },
    endDate: { $gt: start },
    $or: [{ holdExpiresAt: null }, { holdExpiresAt: { $gt: new Date() } }, { isPaid: true }],
  };
  if (excludeId) query._id = { $ne: excludeId };
  return query;
};

// Helper to check if a room is available between two dates
const isRoomAvailable = async (roomName, start, end, excludeId) => {
  const clash = await Booking.exists(blockingBookingsQuery(roomName, start, end, excludeId));
  return !clash;
};

const missingGuestDetails = ({ fullName, phone, email }) => !fullName || !phone || !email;

// Utility: Determine booking status
const getBookingStatus = (booking) => {
  const now = new Date();
  const end = new Date(booking.endDate);

  if (booking.isCancelled) return "Canceled Booking";
  if (now > end) return "Expired Booking";

  const isAdmin = booking.source === "dashboard";
  const isPaid = booking.isPaid;

  if (isAdmin) {
    return isPaid ? "Admin · Booked · Paid" : "Admin · Reserved";
  }

  if (isPaid) {
    return booking.paymentMethod === "paystack"
      ? "Online User · Via Paystack · Paid"
      : "Online User · Settled · Paid";
  }

  if (booking.holdExpiresAt) return "Online User · Awaiting Paystack Payment";
  return "Online User · Reserved · Unpaid";
};



// ✅ GET all bookings (admin)
const getBookings = async (req, res) => {
  try {
    // Hide abandoned Paystack checkouts (hold expired, never paid)
    const bookings = await Booking.find({
      $nor: [{ isPaid: false, holdExpiresAt: { $lte: new Date() } }],
    }).sort({ _id: -1 });

    res.json(bookings.map((b) => ({ ...b.toObject(), status: getBookingStatus(b) })));
  } catch (error) {
    res.status(500).json({ message: "Error fetching bookings" });
  }
};



// ✅ POST: Create booking (without payment — online reservation)
const createBooking = async (req, res) => {
  try {
    const { fullName, phone, email, roomName, startDate, endDate } = req.body;

    if (missingGuestDetails(req.body) || !roomName) {
      return res.status(400).json({ message: "Please fill in your name, email, phone and room." });
    }

    const stay = parseStay(startDate, endDate);
    if (stay.error) return res.status(400).json({ message: stay.error });

    // Check if startDate is at least 24 hours in the future
    if (!isStartDateValid(stay.start)) {
      return res.status(400).json({
        message: "Reservations must be made at least 24 hours in advance.",
      });
    }

    const room = await Room.findOne({ name: String(roomName) });
    if (!room) return res.status(404).json({ message: "Room not found." });

    const available = await isRoomAvailable(room.name, stay.start, stay.end);
    if (!available) {
      return res.status(400).json({
        message: "This room is already booked or reserved for the selected dates. Please check other rooms.",
      });
    }

    const booking = new Booking({
      fullName,
      phone,
      email,
      roomName: room.name,
      roomNumber: Number(room.roomNumber) || 0,
      roomPrice: room.price, // always use the price from the database, not the browser
      nights: stay.nights,
      totalAmount: room.price * stay.nights,
      startDate: stay.start,
      endDate: stay.end,
      isPaid: false,
      source: "online",
    });

    await booking.save();

    res.status(201).json({ message: "Booking created (without payment)", booking });
  } catch (error) {
    console.error("❌ Booking creation error:", error);
    res.status(500).json({ message: "Booking failed" });
  }
};




// ✅ POST: Hold the room and start a Paystack payment
const initializePayment = async (req, res) => {
  let hold;
  try {
    const { fullName, phone, email, roomName, startDate, endDate } = req.body;

    if (missingGuestDetails(req.body) || !roomName) {
      return res.status(400).json({ message: "Please fill in your name, email, phone and room." });
    }

    const stay = parseStay(startDate, endDate);
    if (stay.error) return res.status(400).json({ message: stay.error });
    if (stay.start < startOfToday()) {
      return res.status(400).json({ message: "Check-in date can't be in the past." });
    }

    const room = await Room.findOne({ name: String(roomName) });
    if (!room) return res.status(404).json({ message: "Room not found." });

    const available = await isRoomAvailable(room.name, stay.start, stay.end);
    if (!available) {
      return res.status(400).json({ message: "Room not available for selected dates" });
    }

    // ✅ Price comes from the database: price per night × nights
    const totalAmount = room.price * stay.nights;
    const reference = `MV-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Hold the room while the guest pays, so nobody else can take it meanwhile
    hold = await Booking.create({
      fullName,
      phone,
      email,
      roomName: room.name,
      roomNumber: Number(room.roomNumber) || 0,
      roomPrice: room.price,
      nights: stay.nights,
      totalAmount,
      startDate: stay.start,
      endDate: stay.end,
      isPaid: false,
      source: "online",
      paymentMethod: "paystack",
      paymentStatus: "pending",
      reference,
      holdExpiresAt: new Date(Date.now() + PAYMENT_HOLD_MINUTES * 60 * 1000),
    });

    const paystackRes = await axios.post(
      `${PAYSTACK_BASE_URL}/transaction/initialize`,
      {
        email,
        amount: totalAmount * 100, // Paystack uses kobo
        reference,
        callback_url: `${FRONTEND_URL}/booking`, // Paystack adds ?reference=...
        metadata: {
          bookingId: hold._id.toString(),
          fullName,
          phone,
          roomName: room.name,
          startDate,
          endDate,
          nights: stay.nights,
          totalAmount,
        },
      },
      { headers: paystackHeaders() }
    );

    const { authorization_url } = paystackRes.data.data;

    return res.status(200).json({ authorization_url, reference, totalAmount, nights: stay.nights });
  } catch (error) {
    console.error("❌ Payment initialization failed:", error?.response?.data || error);
    if (hold) await Booking.deleteOne({ _id: hold._id }).catch(() => {});
    return res.status(500).json({ message: "Failed to initialize payment" });
  }
};



// Mark a successful Paystack transaction as paid. Safe to call more than once
// (the browser redirect and the Paystack webhook can both arrive).
const finalizePaystackPayment = async (tx) => {
  const reference = tx.reference;
  let booking = await Booking.findOne({ reference });

  if (booking && booking.isPaid) return { booking, conflict: !!booking.needsAttention };

  if (!booking) {
    // Payment started before room holds existed: rebuild the booking from metadata
    const meta = tx.metadata || {};
    const stay = parseStay(meta.startDate, meta.endDate);
    if (stay.error) throw new Error(`Cannot build booking for ${reference}: ${stay.error}`);
    booking = new Booking({
      fullName: meta.fullName,
      phone: meta.phone,
      email: meta.email || tx.customer?.email,
      roomName: meta.roomName,
      roomNumber: Number(meta.roomNumber) || 0,
      roomPrice: Number(meta.roomPrice) || 0,
      nights: stay.nights,
      totalAmount: tx.amount / 100,
      startDate: stay.start,
      endDate: stay.end,
      source: "online",
      reference,
    });
  }

  const problems = [];
  // Someone else took the room after this guest's hold expired
  const available = await isRoomAvailable(booking.roomName, booking.startDate, booking.endDate, booking._id);
  if (!available) problems.push("Room was taken by another booking — move the guest or refund");
  if (booking.totalAmount && tx.amount < booking.totalAmount * 100) {
    problems.push(`Paid ₦${(tx.amount / 100).toLocaleString()} but total is ₦${booking.totalAmount.toLocaleString()}`);
  }

  booking.isPaid = true;
  booking.paymentMethod = "paystack";
  booking.paymentStatus = "paid";
  booking.amountPaid = tx.amount / 100;
  booking.holdExpiresAt = undefined;
  booking.needsAttention = problems.length ? problems.join("; ") : undefined;
  await booking.save();

  return { booking, conflict: problems.length > 0 };
};



const createManualBooking = async (req, res) => {
  try {
    const { fullName, phone, email, roomName, startDate, endDate } = req.body;
    const isPaid = req.body.isPaid === true;

    if (missingGuestDetails(req.body) || !roomName) {
      return res.status(400).json({ message: "Please fill in name, email, phone and room." });
    }

    const stay = parseStay(startDate, endDate);
    if (stay.error) return res.status(400).json({ message: stay.error });

    if (!isPaid && !isStartDateValid(stay.start)) {
      return res.status(400).json({
        message: "Reservations must be made at least 24 hours in advance.",
      });
    }

    const room = await Room.findOne({ name: String(roomName) });
    if (!room) return res.status(404).json({ message: "Room not found." });

    const available = await isRoomAvailable(room.name, stay.start, stay.end);
    if (!available) {
      return res.status(400).json({
        message: "This room is already booked or reserved for the selected dates. Please check other rooms.",
      });
    }

    const newBooking = new Booking({
      fullName,
      phone,
      email,
      roomName: room.name,
      roomNumber: Number(room.roomNumber) || 0,
      roomPrice: room.price,
      nights: stay.nights,
      totalAmount: room.price * stay.nights,
      startDate: stay.start,
      endDate: stay.end,
      isPaid,
      paymentMethod: isPaid ? "manual" : "none",
      paymentStatus: isPaid ? "paid" : "pending",
      source: "dashboard",
    });

    await newBooking.save();

    res.status(201).json({ message: "Manual booking added", booking: newBooking });
  } catch (error) {
    res.status(500).json({ message: "Manual booking failed", error: error.message });
  }
};



const cancelBooking = async (req, res) => {
  try {
    const { id } = req.params;

    const booking = await Booking.findById(id);
    if (!booking) return res.status(404).json({ message: "Booking not found" });

    if (new Date() >= new Date(booking.startDate))
      return res.status(400).json({ message: "Cannot cancel after start date" });

    booking.isCancelled = true;
    await booking.save();

    res.json({ message: "Booking cancelled", booking });
  } catch (error) {
    res.status(500).json({ message: "Cancellation failed" });
  }
};

// ✅ Admin records that a reservation has been paid (cash, transfer, POS)
const markBookingPaid = async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.status(404).json({ message: "Booking not found" });
    if (booking.isCancelled) return res.status(400).json({ message: "Booking is cancelled" });

    booking.isPaid = true;
    booking.paymentMethod = "settled";
    booking.paymentStatus = "settled";
    booking.holdExpiresAt = undefined;
    await booking.save();

    res.json({ message: "Booking marked as paid", booking: { ...booking.toObject(), status: getBookingStatus(booking) } });
  } catch (error) {
    res.status(500).json({ message: "Could not mark booking as paid" });
  }
};

const checkAvailability = async (req, res) => {
  try {
    const { startDate, endDate, category } = req.query;

    if (!startDate || !endDate || !category) {
      return res.status(400).json({ error: "Missing required query parameters" });
    }

    const stay = parseStay(startDate, endDate);
    if (stay.error) return res.status(400).json({ error: stay.error });

    const rooms = await Room.find({ category });

    if (!rooms || rooms.length === 0) {
      return res.status(404).json({ error: "No rooms found in this category." });
    }

    // Bookings store the room's own name (e.g. "Malaysia"), not the category
    const bookings = await Booking.find(
      blockingBookingsQuery(rooms.map((room) => room.name), stay.start, stay.end)
    );

    const unavailableRoomNames = new Set(bookings.map((b) => b.roomName));

    const availableRooms = rooms.filter(
      (room) => !unavailableRoomNames.has(room.name)
    );

    return res.status(200).json(availableRooms);
  } catch (error) {
    console.error("❌ Error checking availability:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};


// ✅ Called by the booking page after Paystack redirects back
const verifyPayment = async (req, res) => {
  try {
    const { reference } = req.body;

    if (!reference) {
      return res.status(400).json({ message: "Reference is required" });
    }

    const { data } = await axios.get(
      `${PAYSTACK_BASE_URL}/transaction/verify/${encodeURIComponent(reference)}`,
      { headers: paystackHeaders() }
    );

    if (!(data.status && data.data.status === "success")) {
      return res.status(400).json({
        verified: false,
        message: "Payment not successful",
      });
    }

    const { booking, conflict } = await finalizePaystackPayment(data.data);

    return res.status(200).json({
      verified: true,
      updated: true,
      conflict,
      message: conflict
        ? "Payment received, but there is a problem with this booking. The hotel will contact you to sort it out."
        : "Payment verified and booking confirmed",
      booking: {
        roomName: booking.roomName,
        startDate: booking.startDate,
        endDate: booking.endDate,
        nights: booking.nights,
        amountPaid: booking.amountPaid,
      },
    });
  } catch (err) {
    console.error("❌ Verification error:", err?.response?.data || err);
    return res.status(500).json({ message: "Error verifying payment" });
  }
};




const clearAllBookings = async (req, res) => {
  try {
    await Booking.deleteMany({});
    res.status(200).json({ message: 'All bookings cleared' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to clear bookings' });
  }
};



module.exports = {
  getBookings,
  createBooking,
  initializePayment,
  verifyPayment,
  finalizePaystackPayment,
  createManualBooking,
  cancelBooking,
  markBookingPaid,
  checkAvailability,
  clearAllBookings,
};
