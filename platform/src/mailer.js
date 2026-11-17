'use strict';
const nodemailer = require('nodemailer');
const config = require('./config');

let transport;
const outbox = []; // used when SMTP is not configured (dev/tests)
async function send(to, subject, text) {
  if (!config.smtp.host) { outbox.push({ to, subject, text }); console.log(`[mail:no-smtp] to=${to} subject=${subject}`); return; }
  transport = transport || nodemailer.createTransport({ host: config.smtp.host, port: config.smtp.port, auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined });
  await transport.sendMail({ from: config.smtp.from, to, subject, text });
}
module.exports = { send, outbox };
