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
  const isOnline = booking.source === "online" || booking.source === "user";
  const isPaid = booking.isPaid;

  if (isAdmin) {
    return isPaid ? "Admin · Booked · Paid" : "Admin · Reserved";
  }

  if (isOnline) {
    if (isPaid) {
      return booking.paymentMethod === "paystack"
        ? "Online User · Via Paystack · Paid"
        : "Online User · Settled · Paid";
    }
    return "Online User · Reserved · Unpaid";
  }

  return "Unknown Booking Source";
};



// ✅ GET all bookings
const getBookings = async (req, res) => {
  try {
    const now = getCurrentDateTime();
    const bookings = await Booking.find().sort({ createdAt: -1 });

    const updatedBookings = await Promise.all(bookings.map(async (b) => {
      // Auto-promote reserved bookings to paid if start date has arrived
      if (!b.isCancelled && !b.isPaid && now >= new Date(b.startDate)) {
        b.isPaid = true;
        b.paymentMethod = b.source === "dashboard" ? "settled" : "settled"; // mark as settled
        await b.save();
      }

      return {
        ...b._doc,
        status: getBookingStatus(b),
      };
    }));

    res.json(updatedBookings);
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


const isStartDateValid = (startDate) => {
  const now = new Date();
  const minStart = new Date(now.getTime() + 24 * 60 * 60 * 1000); // now + 24 hours
  return startDate >= minStart;
};



// ✅ POST: Create booking (without payment — online reservation)
const createBooking = async (req, res) => {
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
    } = req.body;

    const normalizedStartDate = new Date(startDate);
    const normalizedEndDate = new Date(endDate);
    normalizedEndDate.setHours(12, 0, 0, 0);

    // Check if startDate is at least 24 hours in the future
    if (!isStartDateValid(normalizedStartDate)) {
      return res.status(400).json({
        message: "Reservations must be made at least 24 hours in advance.",
      });
    }

    const available = await isRoomAvailable(roomName, normalizedStartDate, normalizedEndDate);
    if (!available) {
      return res.status(400).json({
        message: "This room is already booked or reserved for the selected dates. Please check other rooms.",
      });
    }

    const booking = new Booking({
      fullName,
      phone,
      email,
      roomName,
      roomNumber,
      roomPrice,
      startDate: normalizedStartDate,
      endDate: normalizedEndDate,
      isPaid: false,
      source: "online",
    });

    await booking.save();

    res.status(201).json({ message: "Booking created (without payment)", booking });
  } catch (error) {
    console.error("❌ Booking creation error:", error);
    res.status(500).json({ message: "Booking failed", error: error.message });
  }
};




// ✅ POST: Create booking with Paystack
// FIX APPLIED HERE
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

    // ✅ Calculate number of nights
    const nights = Math.ceil(
      (new Date(endDate).setHours(12, 0, 0, 0) -
        new Date(startDate)) /
      (24 * 60 * 60 * 1000)
    );

    // ✅ Calculate correct amount
    const totalAmount = roomPrice * nights;
    const amountInKobo = totalAmount * 100;

    const available = await isRoomAvailable(
      roomName,
      new Date(startDate),
      new Date(endDate)
    );
    if (!available) {
      return res.status(400).json({ message: "Room not available for selected dates" });
    }

    const reference = `MV-${Date.now()}`;

    const paystackRes = await axios.post(
      "https://api.paystack.co/transaction/initialize",
      {
        email,
        amount: amountInKobo,
        callback_url: `https://montevarhotel.com/booking?reference=${reference}`,
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
          nights,         // NEW FIELD
          totalAmount,    // NEW FIELD
        },
        reference,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    const { authorization_url } = paystackRes.data.data;

    return res.status(200).json({ authorization_url, reference });

  } catch (error) {
    console.error("❌ Payment initialization failed:", error?.response?.data || error);
    return res.status(500).json({ message: "Failed to initialize payment", error });
  }
};



// The rest of your file remains *unchanged*  

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
      isPaid = false,
      source = "dashboard",
    } = req.body;

    const normalizedStartDate = new Date(startDate);
    const normalizedEndDate = new Date(endDate);
    normalizedEndDate.setHours(12, 0, 0, 0);

    if (!isPaid && !isStartDateValid(normalizedStartDate)) {
      return res.status(400).json({
        message: "Reservations must be made at least 24 hours in advance.",
      });
    }

    const available = await isRoomAvailable(roomName, normalizedStartDate, normalizedEndDate);
    if (!available) {
      return res.status(400).json({
        message: "This room is already booked or reserved for the selected dates. Please check other rooms.",
      });
    }

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

const checkAvailability = async (req, res) => {
  try {
    const { startDate, endDate, category } = req.query;

    if (!startDate || !endDate || !category) {
      return res.status(400).json({ error: "Missing required query parameters" });
    }

    const requestedStart = new Date(startDate);
    const requestedEnd = new Date(endDate);
    requestedEnd.setHours(12, 0, 0, 0);

    console.log("🔍 Checking availability for:", {
      category,
      startDate: requestedStart.toISOString(),
      endDate: requestedEnd.toISOString(),
    });

    const now = new Date();

    const bookings = await Booking.find({
      roomName: category,
      isCancelled: { $ne: true },
      endDate: { $gte: now },
      $or: [
        {
          startDate: { $lte: requestedEnd },
          endDate: { $gte: requestedStart },
        },
      ],
    });

    const unavailableRoomNumbers = bookings.map((b) => b.roomNumber);

    const rooms = await Room.find({ category });

    if (!rooms || rooms.length === 0) {
      return res.status(404).json({ error: "No rooms found in this category." });
    }

    const availableRooms = rooms.filter(
      (room) => !unavailableRoomNumbers.includes(room.roomNumber)
    );

    if (availableRooms.length === 0) {
      return res.status(200).json([]);
    }

    return res.status(200).json(availableRooms);
  } catch (error) {
    console.error("❌ Error checking availability:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};


// VERIFY PAYMENT (unchanged)
const verifyPayment = async (req, res) => {
  try {
    const { reference } = req.body;

    if (!reference) {
      return res.status(400).json({ message: "Reference is required" });
    }

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

      const available = await isRoomAvailable(
        meta.roomName,
        new Date(meta.startDate),
        new Date(meta.endDate)
      );
      if (!available) {
        return res.status(400).json({
          verified: false,
          message: "Room is no longer available",
        });
      }

      console.log("Verifying payment with reference:", reference);

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
        source: "online",
        paymentMethod: "paystack",
        paymentStatus: "paid",
        status: "BOOKED",
        reference: reference,
      });

      await booking.save();

      return res.status(200).json({
        verified: true,
        updated: true, 
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
  createManualBooking,
  cancelBooking,
  checkAvailability,
  clearAllBookings,
};
