// server/routes/quote.js
import express from 'express';
import Quote from '../models/Quote.js';
import { buildTransport, pickRecipients, getFromAddress } from '../services/mailer.js';

const router = express.Router();

const MAIN_INBOX = process.env.MAIN_INBOX || 'inbox@example.com';
const DO_SEND = String(process.env.MAIL_SEND || 'true').toLowerCase() === 'true';

router.post('/', async (req, res) => {
  try {
    const { name, email, origin, destination, details, dept } = req.body || {};

    const errors = [];
    if (!name) errors.push('name');
    if (!email) errors.push('email');
    if (!origin) errors.push('origin');
    if (!destination) errors.push('destination');
    if (errors.length) return res.status(400).json({ ok: false, errors });

    const doc = await Quote.create({
      name, email, origin, destination,
      details: details || '',
      dept: (dept || 'ops')
    });

    const { to, cc } = pickRecipients(MAIN_INBOX, (dept || 'ops').toLowerCase());
    const subject = `New Quote — ${name} (${origin} → ${destination})`;
    const text = [
      `Name: ${name}`,
      `Email: ${email}`,
      `Department: ${dept || 'ops'}`,
      `Origin: ${origin}`,
      `Destination: ${destination}`,
      `Details: ${details || '-'}`,
      `Ref: ${doc._id}`
    ].join('\n');

    if (DO_SEND) {
      // ✅ Build the transporter only when sending
      const transporter = buildTransport();
      await transporter.sendMail({
        from: getFromAddress(),
        to, cc,
        replyTo: email,
        subject,
        text
      });
    } else {
      console.log('[MAIL disabled] Would send:', { to, cc, subject });
    }

    res.json({ ok: true, id: String(doc._id) });
  } catch (e) {
    console.error('quote POST failed:', e?.response || e);
    res.status(500).json({ ok: false, errors: ['server'] });
  }
});

export default router;
