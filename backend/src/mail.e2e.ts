/** SmtpMailer against a real SMTP server speaking the protocol (in-process), so provider wiring is proven before a real provider is configured. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SMTPServer } from 'smtp-server';
import { SmtpMailer, createMailer, emailTemplates } from '@andum/shared';
import { AddressInfo } from 'net';

let server: SMTPServer; let port: number;
const received: { from: string; to: string[]; raw: string; user?: string }[] = [];

beforeAll(async () => {
  server = new SMTPServer({
    authOptional: false, allowInsecureAuth: true, disabledCommands: ['STARTTLS'],
    onAuth(auth, _s, cb) { auth.username === 'mailer' && auth.password === 's3cret' ? cb(null, { user: auth.username }) : cb(new Error('Invalid login')); },
    onData(stream, session, cb) {
      let raw = ''; stream.on('data', (c) => (raw += c));
      stream.on('end', () => { received.push({ from: session.envelope.mailFrom ? (session.envelope.mailFrom as any).address : '', to: session.envelope.rcptTo.map((r) => r.address), raw, user: (session as any).user }); cb(); });
    },
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.server.address() as AddressInfo).port;
});
afterAll(async () => { await new Promise((r) => server.close(r as any)); });

const base = { EMAIL_PROVIDER: 'smtp', EMAIL_FROM: 'Andum <no-reply@andum.test>' };

describe('SMTP mailer', () => {
  it('delivers a message with auth, from address, recipient, subject and body', async () => {
    const m = createMailer({ ...base, SMTP_HOST: '127.0.0.1', SMTP_PORT: port, SMTP_USER: 'mailer', SMTP_PASS: 's3cret' });
    await m.verify!();
    const r = await m.send({ to: 'rina@example.com', ...emailTemplates.loginCode('123456') });
    expect(r.id).toBeTruthy();
    const got = received.at(-1)!;
    expect(got.from).toBe('no-reply@andum.test'); expect(got.to).toEqual(['rina@example.com']); expect(got.user).toBe('mailer');
    expect(got.raw).toContain('Subject: Your Andum sign-in code'); expect(got.raw).toContain('123456');
  });
  it('rejects wrong credentials (verify and send)', async () => {
    const m = createMailer({ ...base, SMTP_HOST: '127.0.0.1', SMTP_PORT: port, SMTP_USER: 'mailer', SMTP_PASS: 'wrong' });
    await expect(m.verify!()).rejects.toThrow();
    await expect(m.send({ to: 'a@b.co', subject: 's', text: 't' })).rejects.toThrow();
  });
  it('fails cleanly when the server is down (so the API can answer 503)', async () => {
    const m = new SmtpMailer('x@y.z', { host: '127.0.0.1', port: 1, secure: false });
    await expect(m.send({ to: 'a@b.co', subject: 's', text: 't' })).rejects.toThrow();
  });
  it('SMTP_URL form works too and SMTP_HOST takes precedence', async () => {
    const viaUrl = createMailer({ ...base, SMTP_URL: `smtp://mailer:s3cret@127.0.0.1:${port}` });
    await viaUrl.send({ to: 'url@example.com', subject: 'via url', text: 'x' });
    expect(received.at(-1)!.to).toEqual(['url@example.com']);
    const both = createMailer({ ...base, SMTP_URL: 'smtp://127.0.0.1:1', SMTP_HOST: '127.0.0.1', SMTP_PORT: port, SMTP_USER: 'mailer', SMTP_PASS: 's3cret' });
    await both.send({ to: 'host@example.com', subject: 'host wins', text: 'x' });
    expect(received.at(-1)!.to).toEqual(['host@example.com']);
  });
  it('console provider never touches the network', async () => {
    const m = createMailer({ EMAIL_PROVIDER: 'console', EMAIL_FROM: 'x' });
    expect((await m.send({ to: 'a@b.co', subject: 's', text: 't' })).id).toBe('console');
  });
  it('does not allow header injection through the recipient or subject', async () => {
    const m = createMailer({ ...base, SMTP_HOST: '127.0.0.1', SMTP_PORT: port, SMTP_USER: 'mailer', SMTP_PASS: 's3cret' });
    const before = received.length;
    await m.send({ to: 'ok@example.com', subject: 'hello\r\nBcc: evil@example.com', text: 'x' }).catch(() => undefined);
    const got = received.slice(before).at(-1);
    if (got) { expect(got.to).toEqual(['ok@example.com']); expect(got.raw).not.toMatch(/^Bcc:/m); }
  });
});
