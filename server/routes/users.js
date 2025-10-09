import { Router } from 'express';
import bcrypt from 'bcryptjs';
import User from '../models/User.js';
import { buildTransport, getFromAddress } from '../services/mailer.js';
const router = Router();

router.post('/invite', async (req,res)=>{
  // This route must be wrapped by requireAuth + requireRole('it') in index.js
  const { email, role } = req.body || {};
  const normalized = String(email||'').toLowerCase();
  if(!normalized) return res.status(400).json({ ok:false, message:'email required' });

  const defaultPassword = process.env.DEFAULT_WORKER_PASSWORD || '12345678';
  const passwordHash = await bcrypt.hash(defaultPassword, 10);
 const user = await User.findOneAndUpdate(
  { email: normalized },
  {
    $setOnInsert: {
      email: normalized,
      role: role || 'ops',
      passwordHash,
      active: true
    },
    // fields here update on every call (intended)
    forcePasswordChange: true
  },
  { new: true, upsert: true }
);

  try{
    const t = buildTransport(); // uses your SMTP env
    const from = getFromAddress();
    await t.sendMail({
      from,
      to: normalized,
      subject: 'Welcome to Tretize Worker Portal',
      text: `You are now registered.\nEmail: ${normalized}\nTemporary password: ${defaultPassword}\nPlease log in and change your password.`,
      html: `<p>You are now registered.</p><p><b>Email:</b> ${normalized}<br><b>Temporary password:</b> ${defaultPassword}</p><p>Please log in and change your password.</p>`
    });
  }catch(err){
    console.warn('Mail send failed:', err?.message||err);
  }

  res.json({ ok:true, email: user.email, role: user.role });
});

export default router;
