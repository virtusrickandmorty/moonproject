/**
 * Sending mail. The rest of COM talks only to `MailTransport`, so tests use a fake one and never touch a network.
 * The real one is an SMTP connection made with nodemailer; it needs the App Password, which is read from its file at
 * the moment of sending and never kept.
 */
import { connect } from 'node:net';

export interface MailMessage {
  from: { name: string; address: string };
  to: string;
  subject: string;
  text: string;
  attachment?: { filename: string; content: string; contentType: string } | undefined;
}
export interface SmtpConfig { host: string; port: number; user: string; password: string }

export interface MailTransport {
  /** Is the internet up? When it is not, nothing is tried and nothing is counted as a failed try. */
  online(): Promise<boolean>;
  /** Resolves when the mail server took the message; throws with the server's reason when it did not. */
  send(config: SmtpConfig, message: MailMessage): Promise<void>;
}

const PROBES = [['1.1.1.1', 443], ['8.8.8.8', 53]] as const;
const reach = (host: string, port: number) =>
  new Promise<boolean>((resolve) => {
    const socket = connect({ host, port, timeout: 4000 });
    socket.once('connect', () => (socket.destroy(), resolve(true)));
    socket.once('timeout', () => (socket.destroy(), resolve(false)));
    socket.once('error', () => (socket.destroy(), resolve(false)));
  });

export const smtpTransport: MailTransport = {
  async online() {
    for (const [host, port] of PROBES) if (await reach(host, port)) return true;
    return false;
  },
  async send(config, m) {
    const { createTransport } = await import('nodemailer');
    // Port 465 is TLS from the first byte; any other port must upgrade with STARTTLS or the send is refused.
    const mail = createTransport({
      host: config.host, port: config.port, secure: config.port === 465, requireTLS: config.port !== 465,
      auth: { user: config.user, pass: config.password }, connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 30_000,
    });
    try {
      await mail.sendMail({
        from: { name: m.from.name, address: m.from.address }, to: m.to, subject: m.subject, text: m.text,
        ...(m.attachment ? { attachments: [{ filename: m.attachment.filename, content: m.attachment.content, contentType: m.attachment.contentType }] } : {}),
      });
    } finally {
      mail.close();
    }
  },
};

let current: MailTransport = smtpTransport;
export const mailTransport = (): MailTransport => current;
/** Tests put a fake transport here; `null` puts the real one back. */
export function useTransport(t: MailTransport | null): void {
  current = t ?? smtpTransport;
}
