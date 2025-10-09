// server/services/mailer.js
import nodemailer from 'nodemailer';

export function buildTransport() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    throw new Error('SMTP env not set (SMTP_HOST/SMTP_USER/SMTP_PASS)');
  }

  return nodemailer.createTransport({
    host,
    port,
    // if 465, use TLS immediately; for 587 use STARTTLS
    secure: port === 465,
    auth: { user, pass }
  });
}

export function getFromAddress() {
  return process.env.SMTP_FROM || process.env.SMTP_USER;
}

export function pickRecipients(mainInbox, deptKey) {
  const routes = {
    finance:  process.env.FINANCE_EMAIL,
    admin:    process.env.ADMIN_EMAIL,
    ops:      process.env.OPERATIONS_EMAIL,
    it:       process.env.IT_EMAIL,
    business: process.env.BUSINESS_EMAIL,
  };
  const cc = routes[(deptKey || 'ops').toLowerCase()] || undefined;
  return { to: mainInbox, cc };
}
