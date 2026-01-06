// server/index.js
import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cors from 'cors';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import User from './models/User.js';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import quoteRouter from './routes/quote.js';
// Routers
import trackRouter from './routes/track.js';
import authRouter from './routes/auth.js';
import usersRouter from './routes/users.js';
// If you have auth router/middleware, import here:
import { requireAuth, requireRole } from './middleware/auth.js';

const app = express();


// ---------- Basic middlewares ----------
app.use(helmet());

// CORS configuration
const corsOptions = {
  origin: process.env.NODE_ENV === 'production'
    ? (process.env.CLIENT_URL || false) // Restricted in production
    : '*', // Allow all in dev
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));

// Rate Limiting
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit each IP to 10 requests per windowMs
  message: 'Too many login attempts from this IP, please try again after 15 minutes',
  standardHeaders: true,
  legacyHeaders: false,
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(morgan('dev'));

// ---------- API routes (MOVE THEM UP HERE) ----------
app.use('/api/quote', apiLimiter, quoteRouter);
app.use('/api/track', apiLimiter, trackRouter.public);
app.use('/api/track-secure', apiLimiter, requireAuth, trackRouter.secure);
app.use('/api/users', apiLimiter, requireAuth, requireRole('it'), usersRouter);
// Apply strict limiter to auth login, generic to others if needed, but for now we apply generic to base and strict to login specifically if possible.
// Actually, let's apply strict limiter to /api/auth/login specifically.
app.use('/api/auth/login', authLimiter);
app.use('/api/auth', apiLimiter, authRouter);

// ---------- Health check ----------
app.get('/healthz', (_req, res) => res.status(200).send('ok'));

// ---------- Static (serve your front-end) ----------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, '..', 'Public');

app.use(express.static(PUBLIC_DIR));

// ---------- Catch-all (must be LAST) ----------
app.get('*', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// If you have public auth routes (login/change-password), mount them here:
// app.use('/api/auth', authRouter);

// ---------- Let front-end handle unknown routes ----------

// ---------- Global Error Handler ----------
app.use((err, req, res, next) => {
  console.error('Unhandled Error:', err);
  res.status(500).json({ ok: false, message: 'Internal Server Error' });
});

// ---------- Mongoose connect & start ----------
const PORT = process.env.PORT || 5050;
const HOST = '0.0.0.0';
const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI is missing');
  process.exit(1);
}

// Fail fast instead of buffering commands forever
mongoose.set('bufferCommands', false);
// Optional: quiet old warnings
mongoose.set('strictQuery', true);

const mongooseOpts = {
  dbName: process.env.MONGO_DB_NAME || undefined,
  serverSelectionTimeoutMS: 10000,
  socketTimeoutMS: 20000,
  retryWrites: true,
  w: 'majority',
  heartbeatFrequencyMS: 8000,
};

console.log('⏳ Connecting to MongoDB…');
mongoose.connect(MONGODB_URI, mongooseOpts)
 .then(async () => {
  console.log('✅ MongoDB connected');

  // Bootstrap only once (safe & idempotent)
  if (process.env.BOOTSTRAP_ADMIN_EMAIL && process.env.BOOTSTRAP_ADMIN_PASS) {
    const email = process.env.BOOTSTRAP_ADMIN_EMAIL.toLowerCase();
    const exists = await User.findOne({ email }).lean();
    if (!exists) {
      await User.create({
        email,
        passwordHash: await bcrypt.hash(process.env.BOOTSTRAP_ADMIN_PASS, 10),
        role: 'it',
        active: true,
        forcePasswordChange: true
      });
      console.log('🛠 Bootstrapped default IT user (must change password on first login).');
    }
  }

  app.listen(PORT, HOST, () => {
    console.log(`🚀 Server listening on http://${HOST}:${PORT}`);
  });
})
  
  .catch(err => {
    console.error('❌ MongoDB connection failed:', err?.message || err);
    process.exit(1);
  });

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('⏬ Shutting down…');
  await mongoose.connection.close();
  process.exit(0);
});
