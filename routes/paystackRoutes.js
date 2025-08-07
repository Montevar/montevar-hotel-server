const express = require("express");
const router = express.Router();
const paystackController = require("../controllers/paystackController");

// ✅ Middleware to validate incoming request
const validatePaystackInit = (req, res, next) => {
  const { email, amount } = req.body;

  if (!email || !amount) {
    return res.status(400).json({ message: "Email and amount are required" });
  }

  next();
};

// ✅ POST /api/paystack/initialize - initialize Paystack transaction
router.post("/initialize", validatePaystackInit, paystackController.initializeTransaction);

module.exports = router;
