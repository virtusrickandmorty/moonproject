import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError, isBusinessDate } from '@moonproject/shared';
import type { AppDeps } from '../../app.ts';
import { tx } from '../../platform/db/driver.ts';
import { stamp, systemClock, today } from '../../platform/clock.ts';
import { appendAudit } from '../../engine/audit.ts';
import { currentUser } from '../../engine/security/routes.ts';
import { requireStepUp } from '../../engine/security/sessions.ts';
import { arAging, customerStatement } from '../RPT/receivables.ts';
import { customerContact } from '../CUS/public.ts';
import { NOT_QUEUED_WORDS, enqueue, outboxList, resend, sendDue, sendTest } from './outbox.ts';
import { scanOnce } from './scan.ts';
import { appPasswordSet, comSettings, EMAIL, missingForSending, saveSettings } from './settings.ts';
import { renderStatementHtml } from './statement.ts';
import { statementMessage } from './text.ts';
import { mailTransport } from './transport.ts';

const statementInput = z.object({ customerId: z.string().min(1).max(64), from: z.string(), to: z.string() }).strict();
const bulkStatementInput = z.object({ date: z.string(), customerIds: z.array(z.string().min(1).max(64)).max(500) }).strict();
const bulkStatementQuery = z.object({ date: z.string() }).strict();
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
      const at = now();
      if (!customerStatement(db, input.customerId, from, to)) throw new AppError('BAD_CUSTOMER', 'Choose a customer from the list.', 400);
      const queued = queueStatement(input.customerId, from, to, user.userId, at);
      if (!queued.ok) throw new AppError('NOT_QUEUED', NOT_QUEUED_WORDS[queued.reason], 409);
      appendAudit(db, { at, userId: user.userId, action: 'com.statement_queued', entityType: 'com.outbox', entityId: queued.id, data: { customerId: input.customerId, from, to } });
      return { id: queued.id };
    });
  });

  const checkStatementDate = (date: string) => {
    if (!isBusinessDate(date) || date > today(clock)) throw new AppError('BAD_DATE', 'Choose a statement date that is not after today.', 400);
  };
  const statementCandidates = (date: string) => {
    const balances = new Map<string, { customerId: string; customerName: string; balanceCents: number }>();
    for (const row of arAging(db, date).rows) {
      if (!row.customerId) continue;
      const found = balances.get(row.customerId);
      if (found) found.balanceCents += row.totalCents;
      else balances.set(row.customerId, { customerId: row.customerId, customerName: row.customerName, balanceCents: row.totalCents });
    }
    return [...balances.values()].filter((row) => row.balanceCents !== 0).map((row) => {
      const contact = customerContact(db, row.customerId);
      const reason = !contact?.emailConsent ? 'No email consent' : !contact.email || !EMAIL.test(contact.email) ? 'No email address' : undefined;
      const last = db.prepare(`SELECT MAX(sent_at) AS sentAt FROM com_outbox
        WHERE template = 'statement' AND customer_id = ? AND sent_at IS NOT NULL`).get(contact?.id ?? row.customerId) as { sentAt: string | null };
      return { ...row, customerId: contact?.id ?? row.customerId, customerName: contact?.name ?? row.customerName,
        email: contact?.email ?? null, reason, lastStatementEmailedAt: last.sentAt };
    }).sort((a, b) => a.customerName.localeCompare(b.customerName));
  };
  const queueStatement = (customerId: string, from: string, to: string, userId: string, at: string) => {
    const statement = customerStatement(db, customerId, from, to);
    if (!statement) return { ok: false as const, reason: 'no_customer' as const };
    const recipientId = customerContact(db, customerId)?.id ?? customerId;
    return enqueue(db, {
      template: 'statement', customerId, period: { from, to }, userId, at, dedupeKey: `statement:${to}:${recipientId}`,
      build: (company, customerName) => {
        const file = `statement-of-account-${from}-to-${to}.html`;
        return { ...statementMessage(company, { customerName, from, to, closingBalanceCents: statement.closingBalanceCents,
          depositsHeldCents: statement.depositsHeldCents, fileName: file }),
        attachment: { name: file, html: renderStatementHtml(statement, { registeredName: company }, at) } };
      },
    });
  };

  app.get('/api/com/statements/bulk', { config: { permission: 'com.statement.send' } }, async (req: FastifyRequest) => {
    const { date } = bulkStatementQuery.parse(req.query);
    checkStatementDate(date);
    const rows = statementCandidates(date);
    return { date, eligible: rows.filter((row) => !row.reason), excluded: rows.filter((row) => row.reason) };
  });

  app.post('/api/com/statements/bulk', { config: { permission: 'com.statement.send' } }, async (req: FastifyRequest) => {
    const user = currentUser(req);
    const { date, customerIds } = bulkStatementInput.parse(req.body);
    checkStatementDate(date);
    return tx(db, () => {
      const allowed = new Set(statementCandidates(date).filter((row) => !row.reason).map((row) => row.customerId));
      const from = `${date.slice(0, 7)}-01`;
      const at = now();
      let queued = 0;
      for (const customerId of new Set(customerIds)) {
        if (!allowed.has(customerId)) continue;
        const result = queueStatement(customerId, from, date, user.userId, at);
        if (!result.ok) continue;
        queued++;
        appendAudit(db, { at, userId: user.userId, action: 'com.statement_queued', entityType: 'com.outbox', entityId: result.id,
          data: { customerId, from, to: date, bulk: true } });
      }
      return { queued };
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
