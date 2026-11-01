const Booking = require("../models/booking");
const Room = require("../models/room");
const axios = require("axios");
const mongoose = require("mongoose");
const audit = require("../utils/audit");

const PAYSTACK_BASE_URL = process.env.PAYSTACK_BASE_URL || "https://api.paystack.co";
const FRONTEND_URL = process.env.FRONTEND_URL || "https://www.montevarhotel.com";

const DAY_MS = 24 * 60 * 60 * 1000;
const CHECK_IN_HOUR = 14; // 2:00 PM (hotel time, see TZ in server.js)
const CHECK_OUT_HOUR = 12; // 12:00 noon
const PAYMENT_HOLD_MINUTES = 30; // room is held this long while the guest pays on Paystack

// Safe summary of a failed Paystack call for the logs. Never log the axios error itself:
// it contains the request headers, including our secret key.
const paystackErrorInfo = (error) =>
  error?.response ? { status: error.response.status, data: error.response.data } : { error: error?.code || error?.message };

// Online guests may hold at most this many unpaid reservations at once (by email or phone)
const MAX_UNPAID_ONLINE_RESERVATIONS = 2;

// Online guests who reserve without paying must pay this long before check-in,
// or the reservation is cancelled and the room is free for others again
const PAY_BY_HOURS_BEFORE_CHECK_IN = 12;
const HOUR_MS = 60 * 60 * 1000;
const payByOf = (startDate) => new Date(new Date(startDate).getTime() - PAY_BY_HOURS_BEFORE_CHECK_IN * HOUR_MS);
// Reservations checking in before this time have missed their pay-by deadline
const lapsedCheckInBefore = () => new Date(Date.now() + PAY_BY_HOURS_BEFORE_CHECK_IN * HOUR_MS);
// An online "reserve now, pay later" booking (not a Paystack checkout, not entered by staff)
const isPayLater = (b) => b.source !== "dashboard" && !b.isPaid && !b.holdExpiresAt;
const hasLapsed = (b) => isPayLater(b) && !b.isCancelled && payByOf(b.startDate) <= new Date();

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
// Unpaid Paystack holds stop blocking the room once they expire, and unpaid online
// reservations once their pay-by deadline passes (even before the sweep cancels them).
const blockingBookingsQuery = (roomNames, start, end, excludeId) => {
  const query = {
    roomName: Array.isArray(roomNames) ? { $in: roomNames } : roomNames,
    isCancelled: { $ne: true },
    startDate: { $lt: end },
    endDate: { $gt: start },
    $or: [
      { isPaid: true },
      { holdExpiresAt: { $gt: new Date() } },
      { holdExpiresAt: null, source: "dashboard" },
      { holdExpiresAt: null, startDate: { $gt: lapsedCheckInBefore() } },
    ],
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

  if (booking.isCancelled) {
    return booking.cancelReason === "unpaid" ? "Canceled · Not paid in time" : "Canceled Booking";
  }
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
  if (hasLapsed(booking)) return "Online User · Not paid in time";
  return "Online User · Reserved · Unpaid";
};



// Who did it, for the audit trail: the manager's email, or the receptionist's staff login
const actorOf = (req) => req.session.managerEmail || "Receptionist (staff login)";

// Calendar day "YYYY-MM-DD" in hotel time
const dayString = (date) => new Date(date).toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });

// The parts of a booking people care about, as plain values (for the audit trail)
const bookingSnapshot = (b) => ({
  guest: b.fullName,
  phone: b.phone,
  email: b.email,
  room: b.roomName,
  checkIn: dayString(b.startDate),
  checkOut: dayString(b.endDate),
  nights: b.nights,
  total: b.totalAmount,
  paid: !!b.isPaid,
  cancelled: !!b.isCancelled,
  needsAttention: b.needsAttention || null,
  source: b.source === "dashboard" ? "Receptionist" : "Online",
  reference: b.reference || null,
  discount: b.discountAmount ? `${naira(b.discountAmount)} (${b.discountStatus})` : null,
  bookedAt: bookedAt(b).toLocaleString("en-GB", { timeZone: "Africa/Lagos", dateStyle: "medium", timeStyle: "short" }),
});

// When the booking was made. Older bookings have no createdAt, but the id holds its creation time.
const bookedAt = (b) => b.createdAt || b._id.getTimestamp();

const auditLabel = (b) => `${b.fullName} · ${b.roomName}`;

// Full price, and what the guest pays once an approved discount comes off
const fullPrice = (b) => b.roomPrice * (b.nights || 0);
const priceAfterDiscount = (b) =>
  Math.max(0, fullPrice(b) - (b.discountStatus === "approved" ? b.discountAmount || 0 : 0));
const naira = (n) => `₦${Number(n).toLocaleString("en-NG")}`;



// ✅ GET all bookings (admin)
const getBookings = async (req, res) => {
  try {
    // Hide abandoned Paystack checkouts (hold expired, never paid)
    const bookings = await Booking.find({
      $nor: [{ isPaid: false, holdExpiresAt: { $lte: new Date() } }],
    }).sort({ _id: -1 });

    res.json(bookings.map((b) => ({
      ...b.toObject(),
      bookedAt: bookedAt(b),
      payBy: isPayLater(b) && !b.isCancelled ? payByOf(b.startDate) : undefined,
      status: getBookingStatus(b),
    })));
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

    // Stop one person reserving many rooms without paying
    const openReservations = await Booking.countDocuments({
      source: "online",
      isPaid: false,
      isCancelled: { $ne: true },
      holdExpiresAt: null,
      startDate: { $gt: lapsedCheckInBefore() },
      $or: [{ email: String(email) }, { phone: String(phone) }],
    });
    if (openReservations >= MAX_UNPAID_ONLINE_RESERVATIONS) {
      return res.status(429).json({
        message: "You already have unpaid reservations with us. Please pay for them or contact the hotel before reserving more.",
      });
    }

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

    res.status(201).json({ message: "Booking created (without payment)", booking, payBy: payByOf(booking.startDate) });
  } catch (error) {
    console.error("❌ Booking creation error:", error.message);
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
    console.error("❌ Payment initialization failed:", paystackErrorInfo(error));
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
    // A payment this server didn't start (e.g. before room holds existed). Its metadata comes from
    // whoever made the payment, so only the room and dates are used: the price comes from our database.
    const meta = tx.metadata || {};
    const stay = parseStay(meta.startDate, meta.endDate);
    const room = await Room.findOne({ name: String(meta.roomName || "") });
    if (stay.error || !room || !meta.fullName || !meta.phone) {
      console.error(`❌ Paystack payment ${reference} has no matching booking and unusable details`);
      return { booking: null, conflict: true };
    }
    booking = new Booking({
      fullName: String(meta.fullName),
      phone: String(meta.phone),
      email: String(meta.email || tx.customer?.email || ""),
      roomName: room.name,
      roomNumber: Number(room.roomNumber) || 0,
      roomPrice: room.price,
      nights: stay.nights,
      totalAmount: room.price * stay.nights,
      startDate: stay.start,
      endDate: stay.end,
      source: "online",
      reference,
    });
  }

  const amountPaid = tx.amount / 100;
  const amountDue = booking.totalAmount || booking.roomPrice * (booking.nights || 1);

  // Only a full payment in naira counts as paid; anything else waits for the admin
  const paymentProblems = [];
  if (tx.currency !== "NGN") paymentProblems.push(`Paid in ${tx.currency || "unknown currency"}, not naira`);
  else if (amountPaid < amountDue) {
    paymentProblems.push(`Paid ₦${amountPaid.toLocaleString()} but total is ₦${amountDue.toLocaleString()}`);
  }

  const problems = [...paymentProblems];
  // Someone else took the room after this guest's hold expired
  const available = await isRoomAvailable(booking.roomName, booking.startDate, booking.endDate, booking._id);
  if (!available) problems.push("Room was taken by another booking — move the guest or refund");

  const paidInFull = paymentProblems.length === 0;
  booking.isPaid = paidInFull;
  booking.paymentMethod = "paystack";
  booking.paymentStatus = paidInFull ? "paid" : "pending";
  booking.amountPaid = amountPaid;
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

    // Optional front-desk discount: waits for a manager to approve it
    const full = room.price * stay.nights;
    let discount = null;
    const { discountAmount, discountReason } = req.body;
    if (discountAmount !== undefined && discountAmount !== null && discountAmount !== "" && Number(discountAmount) !== 0) {
      const amount = Number(discountAmount);
      if (!Number.isInteger(amount) || amount < 1 || amount > full) {
        return res.status(400).json({ message: `Discount must be a whole naira amount between ₦1 and the full price (${naira(full)}).` });
      }
      const reason = typeof discountReason === "string" ? discountReason.trim() : "";
      if (reason.length < 3 || reason.length > 200) {
        return res.status(400).json({ message: "Please say why the discount was given (3–200 characters)." });
      }
      discount = {
        discountAmount: amount,
        discountReason: reason,
        discountStatus: "pending",
        discountRequestedBy: actorOf(req),
        discountRequestedAt: new Date(),
      };
    }

    const available = await isRoomAvailable(room.name, stay.start, stay.end);
    if (!available) {
      return res.status(400).json({
        message: "This room is already booked or reserved for the selected dates. Please check other rooms.",
      });
    }

    const newBooking = new Booking({
      ...discount,
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
    await audit(req, actorOf(req), "booking.create", {
      bookingId: newBooking._id, name: auditLabel(newBooking), booking: bookingSnapshot(newBooking),
    });
    if (discount) {
      await audit(req, actorOf(req), "booking.discount_request", {
        bookingId: newBooking._id, name: auditLabel(newBooking),
        amount: discount.discountAmount, fullPrice: full, guestPays: full - discount.discountAmount, reason: discount.discountReason,
      });
    }

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
    await audit(req, actorOf(req), "booking.cancel", { bookingId: booking._id, name: auditLabel(booking) });

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

    // A reservation that missed its pay-by deadline no longer holds the room; someone else may have it now
    if (hasLapsed(booking) && !(await isRoomAvailable(booking.roomName, booking.startDate, booking.endDate, booking._id))) {
      return res.status(409).json({ message: `This reservation was not paid in time and ${booking.roomName} has since been booked by another guest.` });
    }

    booking.isPaid = true;
    booking.paymentMethod = "settled";
    booking.paymentStatus = "settled";
    booking.holdExpiresAt = undefined;
    await booking.save();
    await audit(req, actorOf(req), "booking.mark_paid", { bookingId: booking._id, name: auditLabel(booking) });

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
    if (!booking) {
      return res.status(200).json({
        verified: true,
        updated: false,
        conflict: true,
        message: "Payment received, but we could not match it to a booking. The hotel will contact you to sort it out.",
      });
    }

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
    console.error("❌ Verification error:", paystackErrorInfo(err));
    return res.status(500).json({ message: "Error verifying payment" });
  }
};




const CLEAR_ALL_CONFIRMATION = "DELETE ALL BOOKINGS";

const clearAllBookings = async (req, res) => {
  try {
    if (req.body?.confirm !== CLEAR_ALL_CONFIRMATION) {
      return res.status(400).json({ message: `Type ${CLEAR_ALL_CONFIRMATION} to confirm.` });
    }
    const { deletedCount } = await Booking.deleteMany({});
    await audit(req, actorOf(req), "booking.clear_all", { count: deletedCount });
    res.status(200).json({ message: 'All bookings cleared' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to clear bookings' });
  }
};



const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const validText = (v, max) => typeof v === "string" && v.trim().length > 0 && v.trim().length <= max;

const auditReason = (body) => {
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  return reason.length >= 3 && reason.length <= 300 ? reason : null;
};

// ✅ Manager edits any booking (receptionist or online). Every change is recorded with a reason.
const managerUpdateBooking = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: "Booking not found" });
    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.status(404).json({ message: "Booking not found" });

    const body = req.body || {};
    const reason = auditReason(body);
    if (!reason) return res.status(400).json({ message: "Please give a short reason for this change (3–300 characters)." });

    const before = bookingSnapshot(booking);
    const wasCancelled = !!booking.isCancelled;
    const wasLapsed = hasLapsed(booking);

    if (body.fullName !== undefined) {
      if (!validText(body.fullName, 100)) return res.status(400).json({ message: "Guest name is required (max 100 characters)." });
      booking.fullName = body.fullName.trim();
    }
    if (body.phone !== undefined) {
      if (!validText(body.phone, 30)) return res.status(400).json({ message: "Phone is required (max 30 characters)." });
      booking.phone = body.phone.trim();
    }
    if (body.email !== undefined) {
      if (!validText(body.email, 254) || !EMAIL_RE.test(body.email.trim())) {
        return res.status(400).json({ message: "Please enter a valid email." });
      }
      booking.email = body.email.trim();
    }

    let roomChanged = false;
    if (body.roomName !== undefined && String(body.roomName) !== booking.roomName) {
      const room = await Room.findOne({ name: String(body.roomName) });
      if (!room) return res.status(404).json({ message: "Room not found." });
      booking.roomName = room.name;
      booking.roomNumber = Number(room.roomNumber) || 0;
      booking.roomPrice = room.price; // a moved guest pays the new room's price
      roomChanged = true;
    }

    // Managers may correct past dates too, so no "24 hours ahead" rule here
    const stay = parseStay(
      body.startDate !== undefined ? body.startDate : dayString(booking.startDate),
      body.endDate !== undefined ? body.endDate : dayString(booking.endDate)
    );
    if (stay.error) return res.status(400).json({ message: stay.error });
    const datesChanged =
      stay.start.getTime() !== booking.startDate.getTime() || stay.end.getTime() !== booking.endDate.getTime();
    if (roomChanged || datesChanged) {
      booking.startDate = stay.start;
      booking.endDate = stay.end;
      booking.nights = stay.nights;
      booking.totalAmount = priceAfterDiscount(booking);
    }

    if (body.isPaid !== undefined) {
      if (typeof body.isPaid !== "boolean") return res.status(400).json({ message: "Paid must be true or false." });
      if (body.isPaid !== !!booking.isPaid) {
        const viaPaystack = booking.paymentMethod === "paystack";
        booking.isPaid = body.isPaid;
        booking.paymentStatus = body.isPaid ? (viaPaystack ? "paid" : "settled") : "pending";
        if (!viaPaystack) booking.paymentMethod = body.isPaid ? "settled" : "none";
        if (body.isPaid) booking.holdExpiresAt = undefined;
      }
    }
    if (body.isCancelled !== undefined) {
      if (typeof body.isCancelled !== "boolean") return res.status(400).json({ message: "Cancelled must be true or false." });
      booking.isCancelled = body.isCancelled;
      if (!body.isCancelled) booking.cancelReason = undefined;
    }
    if (body.resolveAttention === true) booking.needsAttention = undefined;

    if (hasLapsed(booking)) {
      return res.status(400).json({
        message: `This online reservation is past its pay-by time (${PAY_BY_HOURS_BEFORE_CHECK_IN} hours before check-in), so it would be cancelled automatically. Tick Paid, or move the check-in date.`,
      });
    }

    // A live booking that moved (or came back from cancelled or lapsed) must not clash with another guest
    if (!booking.isCancelled && (roomChanged || datesChanged || wasCancelled || wasLapsed)) {
      const free = await isRoomAvailable(booking.roomName, booking.startDate, booking.endDate, booking._id);
      if (!free) {
        return res.status(409).json({ message: `${booking.roomName} is already taken for those dates by another booking.` });
      }
    }

    const after = bookingSnapshot(booking);
    const changedBefore = {};
    const changedAfter = {};
    for (const k of Object.keys(after)) {
      if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) {
        changedBefore[k] = before[k];
        changedAfter[k] = after[k];
      }
    }
    if (Object.keys(changedAfter).length === 0) return res.status(400).json({ message: "Nothing changed." });

    await booking.save();
    await audit(req, req.session.managerEmail, "booking.update", {
      bookingId: booking._id, name: auditLabel(booking), before: changedBefore, after: changedAfter, reason,
    });

    res.json({ ...booking.toObject(), bookedAt: bookedAt(booking), status: getBookingStatus(booking) });
  } catch (error) {
    console.error("❌ Manager booking update error:", error);
    res.status(500).json({ message: "Could not update booking" });
  }
};

// ✅ Manager deletes any booking. A full copy is kept in the audit trail.
const managerDeleteBooking = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: "Booking not found" });
    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.status(404).json({ message: "Booking not found" });

    const reason = auditReason(req.body);
    if (!reason) return res.status(400).json({ message: "Please give a short reason for deleting (3–300 characters)." });

    await booking.deleteOne();
    await audit(req, req.session.managerEmail, "booking.delete", {
      bookingId: booking._id, name: auditLabel(booking), booking: bookingSnapshot(booking), reason,
    });

    res.json({ message: "Booking deleted" });
  } catch (error) {
    console.error("❌ Manager booking delete error:", error);
    res.status(500).json({ message: "Could not delete booking" });
  }
};



// ✅ Manager approves or rejects a front-desk discount
const decideDiscount = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: "Booking not found" });
    const decision = req.body?.decision;
    if (decision !== "approve" && decision !== "reject") {
      return res.status(400).json({ message: "Decision must be approve or reject." });
    }
    const note = typeof req.body?.note === "string" ? req.body.note.trim().slice(0, 300) : "";
    if (decision === "reject" && note.length < 3) {
      return res.status(400).json({ message: "Please say why the discount is rejected (at least 3 characters)." });
    }

    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.status(404).json({ message: "Booking not found" });
    if (booking.discountStatus !== "pending") {
      return res.status(409).json({ message: "This discount has already been decided." });
    }

    const totalBefore = booking.totalAmount;
    booking.discountStatus = decision === "approve" ? "approved" : "rejected";
    booking.discountDecidedBy = req.session.managerEmail;
    booking.discountDecidedAt = new Date();
    booking.discountNote = note || undefined;
    booking.totalAmount = priceAfterDiscount(booking);
    await booking.save();

    await audit(req, req.session.managerEmail, decision === "approve" ? "booking.discount_approve" : "booking.discount_reject", {
      bookingId: booking._id, name: auditLabel(booking), amount: booking.discountAmount,
      reason: booking.discountReason, requestedBy: booking.discountRequestedBy, note: note || undefined,
      before: { total: totalBefore }, after: { total: booking.totalAmount },
    });

    res.json({ ...booking.toObject(), bookedAt: bookedAt(booking), status: getBookingStatus(booking) });
  } catch (error) {
    console.error("❌ Discount decision error:", error.message);
    res.status(500).json({ message: "Could not save the decision" });
  }
};

// ✅ Cancel online reservations that were not paid by their deadline (runs on a timer, see server.js)
const expireUnpaidReservations = async () => {
  try {
    const lapsed = await Booking.find({
      source: { $ne: "dashboard" },
      isPaid: false,
      isCancelled: { $ne: true },
      holdExpiresAt: null,
      startDate: { $lte: lapsedCheckInBefore() },
      endDate: { $gt: new Date() },
    });
    for (const b of lapsed) {
      // Only if nobody paid or changed it in the meantime
      const cancelled = await Booking.findOneAndUpdate(
        { _id: b._id, isPaid: false, isCancelled: { $ne: true }, holdExpiresAt: null, startDate: b.startDate },
        { $set: { isCancelled: true, cancelReason: "unpaid" } },
        { new: true }
      );
      if (cancelled) {
        await audit(null, "System (automatic)", "booking.expire", {
          bookingId: b._id,
          name: auditLabel(b),
          payBy: payByOf(b.startDate).toLocaleString("en-GB", { timeZone: "Africa/Lagos", dateStyle: "medium", timeStyle: "short" }),
          booking: bookingSnapshot(cancelled),
        });
      }
    }
    return lapsed.length;
  } catch (error) {
    console.error("Unpaid reservation sweep failed:", error.message);
    return 0;
  }
};

module.exports = {
  decideDiscount,
  expireUnpaidReservations,
  managerUpdateBooking,
  managerDeleteBooking,
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
