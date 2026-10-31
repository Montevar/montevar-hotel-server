const express = require("express");
const router = express.Router();
const paystackController = require("../controllers/paystackController");

// ✅ POST /api/paystack/webhook - Paystack tells us about successful payments
// (set this URL in Paystack Dashboard → Settings → API Keys & Webhooks)
router.post("/webhook", paystackController.handleWebhook);

module.exports = router;
