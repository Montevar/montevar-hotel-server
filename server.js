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
const allowedOrigins = [
  'https://montevar-hotel-frontend.vercel.app',
  'https://montevarhotel.com',
  'https://www.montevarhotel.com',
];


app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));


// ✅ Session config (single instance)
app.set('trust proxy', 1);

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: process.env.MONGO_URI,
    ttl: 60 * 60 * 24 * 365 * 10, // 10 years session expiration in MongoDB
  }),
  cookie: {
    httpOnly: true,
    sameSite: 'None',
    secure: true,
    maxAge: 1000 * 60 * 60 * 24 * 365 * 10, // 10 years cookie expiration
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
console.log("✅ Paystack route loaded successfully");
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
