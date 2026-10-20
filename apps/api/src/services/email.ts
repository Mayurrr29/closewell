import nodemailer from 'nodemailer';
import { env } from '../config/env';
import { logger, maskEmail } from '../lib/logger';
import { EmailOutbox } from '../models/identity';

/**
 * Email provider abstraction.
 *  - mock: nothing is sent. The message is stored in the outbox and shown in
 *    the dev mailbox (/api/dev/mailbox, disabled in production).
 *  - smtp: delivered through the configured SMTP server. The body is not
 *    stored because it can contain one-time links.
 */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

let transport: nodemailer.Transporter | null = null;
function smtp() {
  transport ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT ?? 587,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
  });
  return transport;
}

export async function sendEmail(msg: EmailMessage): Promise<{ delivered: boolean; mode: 'mock' | 'smtp' }> {
  if (env.EMAIL_MODE === 'mock') {
    await EmailOutbox.create({ ...msg, mode: 'mock', status: 'logged' });
    logger.info({ to: maskEmail(msg.to), subject: msg.subject }, 'Email captured in mock mode (not delivered)');
    return { delivered: false, mode: 'mock' };
  }
  try {
    await smtp().sendMail({ from: env.EMAIL_FROM, to: msg.to, subject: msg.subject, text: msg.text });
    await EmailOutbox.create({ to: msg.to, subject: msg.subject, mode: 'smtp', status: 'sent' });
    return { delivered: true, mode: 'smtp' };
  } catch (err) {
    logger.error({ err, to: maskEmail(msg.to) }, 'SMTP delivery failed');
    await EmailOutbox.create({ to: msg.to, subject: msg.subject, mode: 'smtp', status: 'failed', error: (err as Error).message });
    return { delivered: false, mode: 'smtp' };
  }
}

export const appUrl = (path: string) => `${env.APP_ORIGIN.replace(/\/$/, '')}${path}`;
