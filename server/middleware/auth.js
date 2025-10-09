// server/middleware/auth.js
import jwt from 'jsonwebtoken';

export function requireAuth(req, res, next){
  const h = req.headers.authorization || '';
  const headerToken = h.startsWith('Bearer ') ? h.slice(7) : null;
  const cookieToken = req.cookies?.jwt || null;

  // Prefer Authorization header to allow clients to recover from a bad cookie
  const token = headerToken || cookieToken;
  if (!token) return res.status(401).json({ ok:false, message:'unauthorized' });

  try{
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload;

    // Sliding refresh using env TTL
    const TOKEN_TTL = process.env.JWT_TTL || '45m';
    const now = Math.floor(Date.now() / 1000);
    const secsLeft = (payload.exp || 0) - now;
    if (secsLeft > 0 && secsLeft < 10 * 60) {
      const renewed = jwt.sign(
        { id: payload.id, email: payload.email, role: payload.role, displayName: payload.displayName || '' },
        process.env.JWT_SECRET,
        { expiresIn: TOKEN_TTL }
      );
      // compute cookie maxAge from TTL
      const ttlToMs = s => {
        const m = /^(\d+)([smhd])$/i.exec(s || '');
        if(!m) return 45*60*1000;
        const n = +m[1]; const u = m[2].toLowerCase();
        return n * (u==='s'?1e3:u==='m'?6e4:u==='h'?36e5:864e5);
      };
      res.cookie('jwt', renewed, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: ttlToMs(TOKEN_TTL)
      });
    }
    next();
  } catch {
    res.clearCookie('jwt', {
      httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production'
    });
    return res.status(401).json({ ok:false, message:'invalid token' });
  }
}


export const requireRole = role => (req,res,next)=>{
  if(!req.user || req.user.role !== role) return res.status(403).json({ ok:false, message:'forbidden' });
  next();
};
// middleware/auth.js (helper)
export const requireAnyRole = (...roles) => (req,res,next)=>{
  if(!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({ ok:false, message:'forbidden' });
  }
  next();
};
