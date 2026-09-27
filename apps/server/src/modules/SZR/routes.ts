import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../../app.ts';
import { newId } from '@moonproject/shared';
import { AppError } from '@moonproject/shared';
import { appendAudit } from '../../engine/audit.ts';
import { currentUser } from '../../engine/security/routes.ts';
import { tx } from '../../platform/db/driver.ts';
import { stamp, today } from '../../platform/clock.ts';
import { customerRef } from '../CUS/public.ts';
import { szrSetInput, szrLoanInput, szrReturnInput } from './schemas.ts';

const preconditionRequired = (msg: string) => new AppError('PRECONDITION_REQUIRED', msg, 428);
const badRequest = (msg: string) => new AppError('BAD_REQUEST', msg, 400);
const notFound = (msg: string) => new AppError('NOT_FOUND', msg, 404);
const conflict = (msg: string) => new AppError('CONFLICT', msg, 409);

export function szrRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, clock } = deps;

  app.get('/api/szr/sets', { config: { permission: 'szr.set.view' } }, async (req) => {
    return db.prepare("SELECT * FROM szr_sets WHERE status != 'inactive' ORDER BY code").all();
  });

  app.get('/api/szr/sets/:id', { config: { permission: 'szr.set.view' } }, async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const setRecord = db.prepare('SELECT * FROM szr_sets WHERE id = ?').get(id);
    if (!setRecord) throw notFound('Set not found');
    return setRecord;
  });

  app.post('/api/szr/sets', { config: { permission: 'szr.set.edit' } }, async (req) => {
    const input = szrSetInput.parse(req.body);
    const id = newId();
    const now = stamp(clock);
    const user = currentUser(req);

    tx(db, () => {
      try {
        db.prepare(`
          INSERT INTO szr_sets (id, code, garment_type, sizes_included, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(id, input.code, input.garmentType, input.sizesIncluded, input.status, now, now);
      } catch (e: any) {
        if (e.message.includes('UNIQUE constraint failed')) {
          throw conflict('Set code already exists');
        }
        throw e;
      }

      const after = db.prepare('SELECT * FROM szr_sets WHERE id = ?').get(id);
      appendAudit(db, {
        at: now,
        userId: user.userId,
        action: 'szr.set.create',
        entityType: 'szr_sets',
        entityId: id,
        data: { before: null, after },
      });
    });
    return { id, version: 1 };
  });

  app.put('/api/szr/sets/:id', { config: { permission: 'szr.set.edit' } }, async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const input = szrSetInput.parse(req.body);
    const versionMatch = req.headers['if-match'];
    if (!versionMatch) throw preconditionRequired('Missing If-Match header');
    const expectedVersion = parseInt(versionMatch.replace(/"/g, ''), 10);
    const now = stamp(clock);
    const user = currentUser(req);

    let newVersion = 0;

    tx(db, () => {
      const before = db.prepare('SELECT * FROM szr_sets WHERE id = ?').get(id) as any;
      if (!before) throw notFound('Set not found');
      if (before.status === 'inactive') throw badRequest('Cannot edit inactive set');
      if (before.version !== expectedVersion) throw conflict('Set was modified by someone else');

      try {
        const result = db.prepare(`
          UPDATE szr_sets SET
            code = ?, garment_type = ?, sizes_included = ?, status = ?, version = version + 1, updated_at = ?
          WHERE id = ? AND version = ?
        `).run(
          input.code,
          input.garmentType,
          input.sizesIncluded,
          input.status,
          now,
          id,
          expectedVersion
        );

        if (result.changes !== 1) throw conflict('Set was modified by someone else');
      } catch (e: any) {
        if (e.message.includes('UNIQUE constraint failed')) {
          throw conflict('Set code already exists');
        }
        throw e;
      }
      newVersion = expectedVersion + 1;

      const after = db.prepare('SELECT * FROM szr_sets WHERE id = ?').get(id);
      appendAudit(db, {
        at: now,
        userId: user.userId,
        action: 'szr.set.edit',
        entityType: 'szr_sets',
        entityId: id,
        data: { before, after },
      });
    });
    return { success: true, version: newVersion };
  });

  app.post('/api/szr/sets/:id/deactivate', { config: { permission: 'szr.set.edit' } }, async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const versionMatch = req.headers['if-match'];
    if (!versionMatch) throw preconditionRequired('Missing If-Match header');
    const expectedVersion = parseInt(versionMatch.replace(/"/g, ''), 10);
    const now = stamp(clock);
    const user = currentUser(req);

    tx(db, () => {
      const before = db.prepare('SELECT * FROM szr_sets WHERE id = ?').get(id) as any;
      if (!before) throw notFound('Set not found');
      if (before.status === 'inactive') return;
      if (before.version !== expectedVersion) throw conflict('Set was modified by someone else');

      const result = db.prepare("UPDATE szr_sets SET status = 'inactive', version = version + 1, updated_at = ? WHERE id = ? AND version = ?").run(now, id, expectedVersion);
      if (result.changes !== 1) throw conflict('Set was modified by someone else');

      const after = db.prepare('SELECT * FROM szr_sets WHERE id = ?').get(id);
      appendAudit(db, {
        at: now,
        userId: user.userId,
        action: 'szr.set.deactivate',
        entityType: 'szr_sets',
        entityId: id,
        data: { before, after },
      });
    });
    return { success: true };
  });

  app.get('/api/szr/loans', { config: { permission: 'szr.loan.view' } }, async (req) => {
    return db.prepare('SELECT * FROM szr_loans ORDER BY date_out DESC').all();
  });

  app.get('/api/szr/loans/overdue', { config: { permission: 'szr.loan.view' } }, async (req) => {
    const todayDate = today(clock);
    return db.prepare(`
      SELECT * FROM szr_loans
      WHERE returned_date IS NULL AND expected_return_date < ?
      ORDER BY expected_return_date ASC
    `).all(todayDate);
  });

  app.post('/api/szr/loans', { config: { permission: 'szr.loan.edit' } }, async (req) => {
    const input = szrLoanInput.parse(req.body);
    const id = newId();
    const now = stamp(clock);
    const todayDate = today(clock);
    const user = currentUser(req);

    if (input.expectedReturnDate < todayDate) {
      throw badRequest('Expected return date cannot be before today');
    }

    tx(db, () => {
      const cust = customerRef(db, input.customerId);
      if (!cust || !cust.is_active) {
        throw badRequest('Invalid or inactive customer');
      }

      const setRecord = db.prepare('SELECT * FROM szr_sets WHERE id = ?').get(input.setId) as any;
      if (!setRecord) throw notFound('Set not found');
      if (setRecord.status !== 'in shop') throw badRequest('Set is not in shop');

      db.prepare(`
        INSERT INTO szr_loans (id, set_id, customer_id, date_out, expected_return_date, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, input.setId, input.customerId, todayDate, input.expectedReturnDate, now, now);

      db.prepare("UPDATE szr_sets SET status = 'lent', version = version + 1, updated_at = ? WHERE id = ?").run(now, input.setId);

      const afterLoan = db.prepare('SELECT * FROM szr_loans WHERE id = ?').get(id);
      appendAudit(db, {
        at: now,
        userId: user.userId,
        action: 'szr.loan.create',
        entityType: 'szr_loans',
        entityId: id,
        data: { before: null, after: afterLoan },
      });

      const afterSet = db.prepare('SELECT * FROM szr_sets WHERE id = ?').get(input.setId);
      appendAudit(db, {
        at: now,
        userId: user.userId,
        action: 'szr.set.edit',
        entityType: 'szr_sets',
        entityId: input.setId,
        data: { before: setRecord, after: afterSet },
      });
    });
    return { id };
  });

  app.post('/api/szr/loans/:id/return', { config: { permission: 'szr.loan.edit' } }, async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const input = szrReturnInput.parse(req.body);
    const now = stamp(clock);
    const todayDate = today(clock);
    const user = currentUser(req);

    tx(db, () => {
      const loanRecord = db.prepare('SELECT * FROM szr_loans WHERE id = ?').get(id) as any;
      if (!loanRecord) throw notFound('Loan not found');
      if (loanRecord.returned_date) throw badRequest('Loan is already returned');

      const setRecord = db.prepare('SELECT * FROM szr_sets WHERE id = ?').get(loanRecord.set_id) as any;

      db.prepare(`
        UPDATE szr_loans SET returned_date = ?, condition_on_return = ?, updated_at = ? WHERE id = ?
      `).run(todayDate, input.conditionOnReturn, now, id);

      db.prepare(`
        UPDATE szr_sets SET status = ?, version = version + 1, updated_at = ? WHERE id = ?
      `).run(input.status, now, loanRecord.set_id);

      const afterLoan = db.prepare('SELECT * FROM szr_loans WHERE id = ?').get(id);
      appendAudit(db, {
        at: now,
        userId: user.userId,
        action: 'szr.loan.return',
        entityType: 'szr_loans',
        entityId: id,
        data: { before: loanRecord, after: afterLoan },
      });

      if (setRecord) {
        const afterSet = db.prepare('SELECT * FROM szr_sets WHERE id = ?').get(loanRecord.set_id);
        appendAudit(db, {
          at: now,
          userId: user.userId,
          action: 'szr.set.edit',
          entityType: 'szr_sets',
          entityId: loanRecord.set_id,
          data: { before: setRecord, after: afterSet },
        });
      }
    });
    return { success: true };
  });
}
