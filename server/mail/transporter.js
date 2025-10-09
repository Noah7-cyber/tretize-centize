import nodemailer from 'nodemailer';

export function makeTransporter() {
  // Gmail (now). Later: swap to Zoho SMTP (host: smtp.zoho.com, port 465, secure true)
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.STMP_USER,
      pass: process.env.SMTP_PASS
    }
  });
}
