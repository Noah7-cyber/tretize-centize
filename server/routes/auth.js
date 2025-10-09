// server/routes/auth.js
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

/* === TTL from ENV (default 45 minutes) === */
const TOKEN_TTL = process.env.JWT_TTL || '45m';
function ttlToMs(s){
  const m = /^(\d+)([smhd])$/i.exec(s || '');
  if(!m) return 45 * 60 * 1000;
  const n = +m[1]; const u = m[2].toLowerCase();
  return n * (u==='s'?1e3:u==='m'?6e4:u==='h'?36e5:864e5);
}
const cookieMaxAgeMs = ttlToMs(TOKEN_TTL);

function signToken(u) {
  return jwt.sign(
    { id: u._id, email: u.email, role: u.role, displayName: u.displayName || '' },
    process.env.JWT_SECRET,
    { expiresIn: TOKEN_TTL }
  );
}

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  const u = await User.findOne({ email: String(email||'').toLowerCase(), active: true });
  if (!u) return res.status(400).json({ ok:false, message:'invalid credentials' });

  const ok = await bcrypt.compare(String(password||''), u.passwordHash);
  if (!ok) return res.status(400).json({ ok:false, message:'invalid credentials' });

  const token = signToken(u);

  u.lastSeenAt = new Date();
  await u.save().catch(() => {});

  // clear any old cookie first, then set fresh
  res.clearCookie('jwt', { httpOnly:true, sameSite:'lax', secure:process.env.NODE_ENV==='production' });
  res.cookie('jwt', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: cookieMaxAgeMs
  });

  return res.json({
    ok: true,
    token,
    forcePasswordChange: u.forcePasswordChange,
    role: u.role,
    email: u.email,
    displayName: u.displayName || ''
  });
});

// helpful logout
router.post('/logout', (_req, res) => {
  res.clearCookie('jwt', { httpOnly:true, sameSite:'lax', secure:process.env.NODE_ENV==='production' });
  return res.json({ ok:true });
});

// POST /api/auth/change-password (unchanged behavior)
router.post('/change-password', requireAuth, async (req, res) => {
  const { newPassword, displayName } = req.body || {};
  if (!newPassword || newPassword.length < 8) {
    return res.status(400).json({ ok: false, message: 'min 8 chars' });
  }
  const u = await User.findById(req.user.id);
  if (!u) return res.status(401).json({ ok: false });

  u.passwordHash = await bcrypt.hash(newPassword, 10);
  if (displayName) u.displayName = String(displayName).trim();
  u.forcePasswordChange = false;
  await u.save();

  return res.json({ ok: true, role: u.role, displayName: u.displayName || '' });
});

export default router;
