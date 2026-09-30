import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError, isBusinessDate } from '@moonproject/shared';
import type { AppDeps } from '../../app.ts';
import { tx } from '../../platform/db/driver.ts';
import { stamp, systemClock, today } from '../../platform/clock.ts';
import { appendAudit } from '../../engine/audit.ts';
import { currentUser } from '../../engine/security/routes.ts';
import { requireStepUp } from '../../engine/security/sessions.ts';
import { customerStatement } from '../RPT/receivables.ts';
import { NOT_QUEUED_WORDS, enqueue, outboxList, resend, sendDue, sendTest } from './outbox.ts';
import { scanOnce } from './scan.ts';
import { appPasswordSet, comSettings, missingForSending, saveSettings } from './settings.ts';
import { renderStatementHtml } from './statement.ts';
import { statementMessage } from './text.ts';
import { mailTransport } from './transport.ts';

const statementInput = z.object({ customerId: z.string().min(1).max(64), from: z.string(), to: z.string() }).strict();
const listQuery = z.object({ status: z.enum(['queued', 'sent', 'failed']).optional(), kind: z.enum(['customer', 'payslip']).optional(), limit: z.coerce.number().int().min(1).max(500).optional() });
const TICK_MS = 60_000;

export function comRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, clock, practice } = deps;
  const now = () => stamp(clock);
  const shown = () => {
    const s = comSettings(db);
    const passwordSet = appPasswordSet(db);
    // The App Password is never sent back: only whether one is saved.
    return { ...s, appPasswordSet: passwordSet, missing: missingForSending(s, passwordSet) };
  };

  app.get('/api/com/settings', { config: { permission: 'com.settings.manage' } }, async () => shown());

  /** The owner, with a fresh password. `appPassword` is write-only: leave it out to keep the saved one. */
  app.put('/api/com/settings', { config: { permission: 'com.settings.manage' } }, async (req: FastifyRequest) => {
    const user = currentUser(req);
    requireStepUp(user, clock);
    const ifMatch = req.headers['if-match'];
    tx(db, () => saveSettings(db, req.body, Array.isArray(ifMatch) ? ifMatch[0] : ifMatch, { userId: user.userId, at: now() }));
    return shown();
  });

  app.post('/api/com/test-email', { config: { permission: 'com.settings.manage' } }, async (req: FastifyRequest) => {
    const user = currentUser(req);
    requireStepUp(user, clock);
    await sendTest(db, mailTransport(), { userId: user.userId, at: now() });
    return { ok: true, message: `A test email was sent to ${comSettings(db).senderAddress}.` };
  });

  app.get('/api/com/outbox', { config: { permission: 'com.outbox.view' } }, async (req: FastifyRequest) => {
    const q = listQuery.parse(req.query);
    return outboxList(db, q.status, q.limit, q.kind);
  });

  app.post<{ Params: { id: string } }>('/api/com/outbox/:id/resend', { config: { permission: 'com.outbox.resend' } }, async (req) => {
    resend(db, req.params.id, { userId: currentUser(req).userId, at: now() });
    return { success: true };
  });

  /** The "Email this statement" button: the statement screen's customer and dates, as an HTML file attached. */
  app.post('/api/com/statements', { config: { permission: 'com.statement.send' } }, async (req: FastifyRequest) => {
    const user = currentUser(req);
    const input = statementInput.parse(req.body);
    const { from, to } = input;
    if (!isBusinessDate(from) || !isBusinessDate(to) || from > to) throw new AppError('BAD_DATES', 'Choose a start date that is not after the end date.', 400);
    if (to > today(clock)) throw new AppError('BAD_DATES', 'A statement cannot run past today.', 400);
    return tx(db, () => {
      const statement = customerStatement(db, input.customerId, from, to);
      if (!statement) throw new AppError('BAD_CUSTOMER', 'Choose a customer from the list.', 400);
      const at = now();
      const queued = enqueue(db, {
        template: 'statement', customerId: input.customerId, period: { from, to }, userId: user.userId, at,
        build: (company, customerName) => {
          const file = `statement-of-account-${from}-to-${to}.html`;
          const message = statementMessage(company, { customerName, from, to, closingBalanceCents: statement.closingBalanceCents, depositsHeldCents: statement.depositsHeldCents, fileName: file });
          return { ...message, attachment: { name: file, html: renderStatementHtml(statement, { registeredName: company }, at) } };
        },
      });
      if (!queued.ok) throw new AppError('NOT_QUEUED', NOT_QUEUED_WORDS[queued.reason], 409);
      appendAudit(db, { at, userId: user.userId, action: 'com.statement_queued', entityType: 'com.outbox', entityId: queued.id, data: { customerId: input.customerId, from, to } });
      return { id: queued.id };
    });
  });

  // The timed job: every minute, find new work to email and send what is due. Only the real shop's clock runs it
  // (tests and the practice shop never do), and it never throws into the server.
  if (!practice && clock === systemClock) {
    let timer: NodeJS.Timeout | undefined;
    let busy = false;
    const tick = async () => {
      if (busy) return;
      busy = true;
      try {
        scanOnce(db, now(), (m) => app.log.warn(m));
        await sendDue(db, mailTransport(), now, (m) => app.log.warn(m));
      } catch (e) {
        app.log.error(`Customer emails: ${(e as Error).message}`);
      } finally {
        busy = false;
      }
    };
    app.addHook('onReady', async () => void (timer = setInterval(() => void tick(), TICK_MS).unref()));
    app.addHook('onClose', async () => clearInterval(timer));
  }
}
