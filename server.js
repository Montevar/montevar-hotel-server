// server/server.js

require('dotenv').config();
const express = require('express');
const app = express();
app.disable('x-powered-by'); // ✅ Hides Express version

const connectDB = require('./config/db');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const logger = require('morgan');
const cors = require('cors');
const path = require('path');
const room = require('./models/room');
const session = require('express-session');
const MongoStore = require('connect-mongo');

// ✅ Connect to MongoDB
connectDB();

// ✅ Middleware
app.use(helmet());
app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ✅ CORS for local frontend
app.use(cors({
  origin: '*',
  credentials: true,
}));

// ✅ Session config (single instance)
app.use(session({
  secret: process.env.SESSION_SECRET || 'fallback_secret',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ mongoUrl: process.env.MONGO_URI }),
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: false, // Always false for local
    maxAge: 1000 * 60 * 30,
  },
}));

// ✅ Rate limiter
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
}));

// ✅ Ignore favicon requests
app.get('/favicon.ico', (req, res) => res.status(204).end());

// ✅ Serve static room images
app.use(
  '/images',
  express.static(path.join(__dirname, 'public/images'), {
    setHeaders: (res, path) => {
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    },
  })
);

// ✅ Debug test route (dev only)
app.get('/api/debug-rooms', async (req, res) => {
  try {
    const rooms = await room.find();
    res.json({
      total: rooms.length,
      sample: rooms.slice(0, 5),
      categories: rooms.map(r => ({
        name: r.name,
        category: r.category,
      })),
    });
  } catch (err) {
    console.error('[DEBUG_ROOMS_ERROR]', err);
    res.status(500).json({ message: 'Error fetching rooms' });
  }
});

// ✅ Main API routes
app.use('/api/auth', require('./routes/auth/totp'));
app.use('/api/protected', require('./routes/protected'));
app.use('/api/rooms', require('./routes/roomRoutes'));
app.use('/api/bookings', require('./routes/bookingRoutes'));
app.use('/api/paystack', require('./routes/paystackRoutes'));

// ✅ Catch-all for 404
app.use((req, res) => {
  res.status(404).json({ message: 'API route not found' });
});

// ✅ Start server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Dev Server listening at http://localhost:${PORT}`);
});
