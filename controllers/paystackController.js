const crypto = require("crypto");
const { finalizePaystackPayment } = require("./bookingController");

// Paystack signs each webhook with HMAC-SHA512 of the raw body using our secret key
const isValidSignature = (req) => {
  const signature = req.headers["x-paystack-signature"];
  if (!signature || !req.rawBody || !process.env.PAYSTACK_SECRET_KEY) return false;

  const expected = crypto
    .createHmac("sha512", process.env.PAYSTACK_SECRET_KEY)
    .update(req.rawBody)
    .digest("hex");

  return (
    signature.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  );
};

// Creates/confirms the booking even if the guest closed the browser after paying
exports.handleWebhook = async (req, res) => {
  if (!isValidSignature(req)) {
    return res.status(401).json({ message: "Invalid signature" });
  }

  const event = req.body;
  try {
    if (event.event === "charge.success" && event.data?.status === "success") {
      await finalizePaystackPayment(event.data);
    }
    res.sendStatus(200);
  } catch (err) {
    console.error("❌ Paystack webhook error:", err);
    res.sendStatus(500); // Paystack will retry
  }
};
