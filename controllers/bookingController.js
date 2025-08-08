const Booking = require("../models/booking");
const Room = require("../models/room");
const axios = require("axios");

// Utility: Get current datetime
const getCurrentDateTime = () => {
  const now = new Date();
  now.setSeconds(0, 0);
  return now;
};

// Utility: Check if room is currently booked/reserved
const isRoomUnavailable = (booking) => {
  const now = getCurrentDateTime();
  const start = new Date(booking.startDate);
  const end = new Date(booking.endDate);
  end.setHours(12, 0, 0, 0); // Booking expires at 12:00 noon

  return !booking.isCancelled && now >= start && now <= end;
};

// Utility: Determine booking status
const getBookingStatus = (booking) => {
  const now = getCurrentDateTime();
  const start = new Date(booking.startDate);
  const end = new Date(booking.endDate);
  end.setHours(12, 0, 0, 0);

  if (booking.isCancelled) return "Canceled Booking";
  if (now > end) return "Expired Booking";

  const isAdmin = booking.source === "dashboard";
  const isOnline = booking.source === "online" || booking.source === "user"; // for legacy "user" data
  const isPaid = booking.isPaid;

  if (isAdmin) {
    return isPaid ? "Admin · Booked · Paid" : "Admin · Reserved";
  }

  if (isOnline) {
    return isPaid
      ? "Online User · Via Paystack · Paid"
      : "Online User · Reserved · Unpaid";
  }

  return "Unknown Booking Source";
};


// ✅ GET all bookings
const getBookings = async (req, res) => {
  try {
    const bookings = await Booking.find().sort({ createdAt: -1 });

    const updated = bookings.map((b) => ({
      ...b._doc,
      status: getBookingStatus(b),
    }));

    res.json(updated);
  } catch (error) {
    res.status(500).json({ message: "Error fetching bookings", error });
  }
};


// Helper to check if a room is available between two dates
const isRoomAvailable = async (roomName, startDate, endDate) => {
  const requestedStart = new Date(startDate);
  const requestedEnd = new Date(endDate);
  requestedEnd.setHours(12, 0, 0, 0);

  const now = new Date();

  const existingBookings = await Booking.find({
    roomName,
    isCancelled: { $ne: true },
    endDate: { $gte: now }, // ✅ exclude expired bookings
    $or: [
      {
        startDate: { $lte: requestedEnd },
        endDate: { $gte: requestedStart },
      },
    ],
  });

  return existingBookings.length === 0;
};








// ✅ POST: Create booking with Paystack
// ✅ NEW: Initialize payment only — no DB
const initializePayment = async (req, res) => {
  try {
    const {
      fullName,
      phone,
      email,
      roomId,
      roomName,
      roomNumber,
      roomPrice,
      amount,
      startDate,
      endDate,
    } = req.body;

    const amountInKobo = roomPrice * 100;

    // ✅ Just initialize payment — no DB write
    const paystackRes = await axios.post(
      "https://api.paystack.co/transaction/initialize",
      {
        email,
        amount: amountInKobo,
        callback_url: process.env.PAYSTACK_CALLBACK_URL || "https://montevar-hotel-frontend.vercel.app/paystack", // make sure your frontend uses /paystack
        metadata: {
          fullName,
          phone,
          email,
          roomId,
          roomName,
          roomNumber,
          roomPrice,
          amount,
          startDate,
          endDate,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    const { authorization_url, reference } = paystackRes.data.data;

    return res.status(200).json({ authorization_url, reference });
  } catch (error) {
    console.error("❌ Payment initialization failed:", error?.response?.data || error);
    return res.status(500).json({ message: "Failed to initialize payment", error });
  }
};



// ✅ POST: Manual booking/reservation (dashboard)
const createManualBooking = async (req, res) => {
  try {
    const {
      fullName,
      phone,
      email,
      roomName,
      roomNumber,
      roomPrice,
      startDate,
      endDate,
      isPaid = false, // ✅ default to false
      source = "dashboard", // ✅ default to dashboard
    } = req.body;

    // ✅ Normalize start and end dates
    const normalizedStartDate = new Date(startDate);
    const normalizedEndDate = new Date(endDate);
    normalizedEndDate.setHours(12, 0, 0, 0); // Set end date to 12:00 noon

    // ✅ First, check if the room is available for the selected date range
    const available = await isRoomAvailable(roomName, normalizedStartDate, normalizedEndDate);
    if (!available) {
      return res.status(400).json({
        message: "This room is already booked or reserved for the selected dates. Please check other rooms.",
      });
    }

    // ✅ Now proceed to create and save the booking
    const newBooking = new Booking({
      fullName,
      phone,
      email,
      roomName,
      roomNumber,
      roomPrice,
      startDate: normalizedStartDate,
      endDate: normalizedEndDate,
      isPaid,
      source,
    });

    await newBooking.save();

    res.status(201).json({ message: "Manual booking added", booking: newBooking });
  } catch (error) {
    res.status(500).json({ message: "Manual booking failed", error: error.message });
  }
};

// ✅ POST: Cancel booking
const cancelBooking = async (req, res) => {
  try {
    const { id } = req.params;

    const booking = await Booking.findById(id);
    if (!booking) return res.status(404).json({ message: "Booking not found" });

    const now = getCurrentDateTime();
    const start = new Date(booking.startDate);
    if (now >= start)
      return res.status(400).json({ message: "Cannot cancel after start date" });

    booking.isCancelled = true;
    await booking.save();

    res.json({ message: "Booking cancelled", booking });
  } catch (error) {
    res.status(500).json({ message: "Cancellation failed", error });
  }
};

// ✅ POST: Check room availability
const checkAvailability = async (req, res) => {
  try {
    const { startDate, endDate, category } = req.query;

    if (!startDate || !endDate || !category) {
      return res.status(400).json({ error: "Missing required query parameters" });
    }

    const requestedStart = new Date(startDate);
    const requestedEnd = new Date(endDate);
    requestedEnd.setHours(12, 0, 0, 0); // Make sure end date is at 12 noon

    // Debug log
    console.log("🔍 Checking availability for:", {
      category,
      startDate: requestedStart.toISOString(),
      endDate: requestedEnd.toISOString(),
    });

    // Step 1: Get conflicting bookings
    const now = new Date();

const bookings = await Booking.find({
  roomName: category,
  isCancelled: { $ne: true },
  endDate: { $gte: now }, // ✅ exclude expired
  $or: [
    {
      startDate: { $lte: requestedEnd },
      endDate: { $gte: requestedStart },
    },
  ],
});


    const unavailableRoomNumbers = bookings.map((b) => b.roomNumber);

    // Step 2: Fetch all rooms of the selected category
    const rooms = await Room.find({ category });

    if (!rooms || rooms.length === 0) {
      return res.status(404).json({ error: "No rooms found in this category." });
    }

    // Step 3: Filter out rooms that are already booked/reserved
    const availableRooms = rooms.filter(
      (room) => !unavailableRoomNumbers.includes(room.roomNumber)
    );

    if (availableRooms.length === 0) {
      return res.status(200).json([]); // No available rooms found
    }

    // Step 4: Return the available rooms
    return res.status(200).json(availableRooms);
  } catch (error) {
    console.error("❌ Error checking availability:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};


// ✅ POST: Verify Paystack payment (optional if handled frontend)

// ✅ Updated verifyPayment
const verifyPayment = async (req, res) => {
  try {
    const { reference } = req.body;

    const { data } = await axios.get(
      `https://api.paystack.co/transaction/verify/${reference}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        },
      }
    );

    if (data.status && data.data.status === "success") {
      const meta = data.data.metadata;

      // ✅ Check availability again just in case
      const available = await isRoomAvailable(meta.roomName, new Date(meta.startDate), new Date(meta.endDate));
      if (!available) {
        return res.status(400).json({
          verified: false,
          message: "Room is no longer available",
        });
      }

      // ✅ Create booking now that payment is confirmed
      const booking = new Booking({
        fullName: meta.fullName,
        phone: meta.phone,
        email: meta.email,
        roomId: meta.roomId,
        roomName: meta.roomName,
        roomNumber: meta.roomNumber,
        roomPrice: meta.roomPrice,
        startDate: meta.startDate,
        endDate: meta.endDate,
        isPaid: true,
        source: "ONLINE USER",
        paymentMethod: "paystack",
        paymentStatus: "PAID",
        status: "BOOKED",
        reference: reference,
      });

      await booking.save();

      return res.status(200).json({
        verified: true,
        message: "Payment verified and booking created",
      });
    }

    return res.status(400).json({
      verified: false,
      message: "Payment not successful",
    });
  } catch (err) {
    console.error("❌ Verification error:", err?.response?.data || err);
    return res.status(500).json({
      message: "Error verifying payment",
      error: err.message,
    });
  }
};



// Clear all bookings permanently
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
  initializePayment, // 👈 new
  verifyPayment,
  createManualBooking,
  cancelBooking,
  checkAvailability,
  clearAllBookings,
};

