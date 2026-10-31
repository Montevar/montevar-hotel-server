// server/server.js

// All booking dates/times (2 PM check-in, noon check-out) are in hotel time
process.env.TZ = 'Africa/Lagos';

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
const session = require('express-session');
const MongoStore = require('connect-mongo');

// ✅ Connect to MongoDB
connectDB();

// ✅ Middleware
app.use(helmet());
app.use(logger('dev'));
app.use(express.json({
  limit: '50kb',
  // Keep the raw body so the Paystack webhook signature can be checked
  verify: (req, res, buf) => { req.rawBody = buf; },
}));

// ✅ CORS: live frontends, plus any extra (e.g. http://localhost:3000) from EXTRA_CORS_ORIGINS
const allowedOrigins = [
  'https://montevar-hotel-frontend.vercel.app',
  'https://montevarhotel.com',
  'https://www.montevarhotel.com',
  ...(process.env.EXTRA_CORS_ORIGINS || '').split(',').map((o) => o.trim()).filter(Boolean),
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
    ttl: 60 * 60 * 12, // 12 hours session expiration in MongoDB
  }),
  cookie: {
    httpOnly: true,
    // COOKIE_INSECURE=true only for local development over http://
    sameSite: process.env.COOKIE_INSECURE === 'true' ? 'Lax' : 'None',
    secure: process.env.COOKIE_INSECURE !== 'true',
    maxAge: 1000 * 60 * 60 * 12, // 12 hours cookie expiration
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

// ✅ Main API routes
app.use('/api/auth', require('./routes/auth/totp'));
app.use('/api/rooms', require('./routes/roomRoutes'));
app.use('/api/bookings', require('./routes/bookingRoutes'));
app.use('/api/paystack', require('./routes/paystackRoutes'));
app.use('/api/manager', require('./routes/managerRoutes'));

// ✅ Catch-all for 404
app.use((req, res) => {
  res.status(404).json({ message: 'API route not found' });
});

// ✅ Start server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Dev Server listening at http://localhost:${PORT}`);
});
