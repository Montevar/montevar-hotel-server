// server/config/paystack.js
const axios = require('axios');

const createPaystackPayment = async ({ name, email, amount, bookingId, roomId, phone }) => {
  try {
    const response = await axios.post(
      'https://api.paystack.co/transaction/initialize',
      {
        email,
        amount: amount * 100, // Paystack uses kobo
        metadata: {
          name,
          phone,
          bookingId,
          roomId,
        },
        callback_url: 'http://localhost:3000/payment-success',
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    // ✅ Return only the authorization URL
    return {
      authorization_url: response.data.data.authorization_url,
    };
  } catch (error) {
    console.error("Paystack error:", error.response?.data || error.message);
    return null;
  }
};

module.exports = createPaystackPayment;
