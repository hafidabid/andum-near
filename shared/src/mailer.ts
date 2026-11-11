import nodemailer from 'nodemailer';

export interface MailMessage { to: string; subject: string; text: string }
export interface Mailer { send(m: MailMessage): Promise<{ id: string }>; /** optional connectivity check (SMTP handshake) */ verify?(): Promise<void> }
export const MAILER = 'MAILER';

/** Collects messages in memory. Used by tests. */
export class CaptureMailer implements Mailer {
  sent: MailMessage[] = [];
  failNext = 0;
  async send(m: MailMessage) {
    if (this.failNext > 0) { this.failNext--; throw new Error('mailer failure'); }
    this.sent.push(m); return { id: `cap-${this.sent.length}` };
  }
  last(to?: string) { return [...this.sent].reverse().find((m) => !to || m.to === to); }
}

export class ConsoleMailer implements Mailer {
  async send(m: MailMessage) { console.log(`[mail] to=${m.to} subject=${m.subject}`); return { id: 'console' }; }
}

/** SMTP (Mailpit locally, any SMTP in staging). Resend can be used through its SMTP relay. */
export class SmtpMailer implements Mailer {
  private t;
  constructor(private from: string, conn: string | { host: string; port: number; secure: boolean; auth?: { user: string; pass: string } }) {
    this.t = nodemailer.createTransport(conn as any);
  }
  async verify() { await this.t.verify(); }
  async send(m: MailMessage) {
    const r = await this.t.sendMail({ from: this.from, to: m.to, subject: m.subject, text: m.text });
    return { id: String(r.messageId) };
  }
}

export interface MailEnv { EMAIL_PROVIDER: string; EMAIL_FROM: string; SMTP_URL?: string; SMTP_HOST?: string; SMTP_PORT?: number; SMTP_USER?: string; SMTP_PASS?: string; SMTP_SECURE?: boolean }

/** SMTP_HOST (+PORT/USER/PASS/SECURE) wins over SMTP_URL; production providers want auth and TLS, Mailpit wants neither. */
export function createMailer(env: MailEnv): Mailer {
  if (env.EMAIL_PROVIDER === 'console') return new ConsoleMailer();
  if (env.SMTP_HOST) {
    const secure = env.SMTP_SECURE ?? false;
    return new SmtpMailer(env.EMAIL_FROM, { host: env.SMTP_HOST, port: env.SMTP_PORT ?? (secure ? 465 : 587), secure, auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS ?? '' } : undefined });
  }
  return new SmtpMailer(env.EMAIL_FROM, env.SMTP_URL ?? 'smtp://localhost:1025');
}

export const emailTemplates = {
  loginCode: (code: string) => ({ subject: 'Your Andum sign-in code', text: `Your sign-in code is ${code}. It is valid for 10 minutes. If you did not ask for it, you can ignore this email.` }),
  otp: (code: string) => ({ subject: 'Your Andum verification code', text: `Your verification code is ${code}. It is valid for 10 minutes.` }),
  invite: (sender: string, link: string) => ({ subject: `${sender} sent you something on Andum`, text: `${sender} sent you a package.\nOpen it here: ${link}` }),
  partReady: (link: string, part: number) => ({ subject: 'A part of your package is ready', text: `Part ${part + 1} of your package can be taken now.\n${link}` }),
  approvalRequest: (link: string, sender: string) => ({ subject: 'Your approval is needed', text: `${sender} named you as an approver. Review and approve here: ${link}` }),
};
