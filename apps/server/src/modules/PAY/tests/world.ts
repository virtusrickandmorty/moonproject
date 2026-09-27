/** The payroll tests' world: a database at a Manila date, an actor with every permission, and helpers. Made-up people only. */
import { expect } from 'vitest';
import { AppError, formatPesos } from '@moonproject/shared';
import { createTestEnv, createUser, type TestEnv } from '../../../../test/helpers.ts';
import { cancelDocument, postDocument, previewDocument } from '../../../engine/documents/lifecycle.ts';
import type { DocTypeDef } from '../../../engine/documents/registry.ts';
import { stamp, today } from '../../../platform/clock.ts';
import { tx } from '../../../platform/db/driver.ts';
import { addEmployee, addPay, type TestPay } from '../../EMP/tests/fixture.ts';
import { saveAttendance } from '../../EMP/time.ts';

/** A test world at a Manila date: users, an actor with every permission, and helpers to record through the engine. */
export async function world(date: string) {
  const env = await createTestEnv(`${date}T02:00:00Z`); // 10:00 in Manila
  const userId = createUser(env.db, `payroll-${date}`, ['owner']);
  const actor = { userId, permissions: new Set(env.deps.registry.permissions().map((p) => p.key)) };
  const e = { db: env.db, clock: env.clock };
  const record = <I>(def: DocTypeDef<I>, input: I) => postDocument(e, def, actor, { input, expectedTotalCents: previewDocument(e, def, actor, input).totalCents });
  /** Records a document dated earlier than today (acc.backdate), as the run form does for a period that has ended (PAY-1). */
  const recordOn = <I>(def: DocTypeDef<I>, input: I, businessDate: string) =>
    postDocument(e, def, actor, { input, businessDate, expectedTotalCents: previewDocument(e, def, actor, input, businessDate).totalCents });
  const preview = <I>(def: DocTypeDef<I>, input: I, businessDate?: string) => previewDocument(e, def, actor, input, businessDate);
  const cancel = (def: DocTypeDef, id: string) => cancelDocument(e, def, actor, id, 'Recorded by mistake, redo it');
  const who = () => ({ userId, at: stamp(env.clock), today: today(env.clock), can: () => true });
  const attend = (days: object[]) => tx(env.db, () => saveAttendance(env.db, { days }, who()));
  const person = (name: string, pay: TestPay, o: Parameters<typeof addEmployee>[2] = {}) => {
    const id = addEmployee(env.db, name, o);
    addPay(env.db, id, userId, { effectiveFrom: o.hireDate ?? '2025-01-06', ...pay });
    return id;
  };
  const at = (d: string) => env.clock.set(`${d}T02:00:00Z`);
  return { env, db: env.db, userId, actor, record, recordOn, preview, cancel, attend, person, at, who };
}

/** The document's journal (original), per account: "2110 Cr 7,075.00", sorted by account code. */
export function journal(env: TestEnv, documentId: string, kind: 'original' | 'reversal' = 'original'): string[] {
  const rows = env.db
    .prepare(
      `SELECT a.code, SUM(l.debit_cents) AS dr, SUM(l.credit_cents) AS cr FROM journal_lines l JOIN journals j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
       WHERE j.source_type = 'document' AND j.source_id = ? AND j.posting_kind = ? GROUP BY a.code ORDER BY a.code`,
    )
    .all(documentId, kind) as { code: string; dr: number; cr: number }[];
  return rows.flatMap((r) => [...(r.dr ? [`${r.code} Dr ${formatPesos(r.dr)}`] : []), ...(r.cr ? [`${r.code} Cr ${formatPesos(r.cr)}`] : [])]);
}
export const partyBalance = (env: TestEnv, code: string, employeeId: string) =>
  env.db
    .prepare(`SELECT COALESCE(SUM(l.debit_cents - l.credit_cents), 0) FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE a.code = ? AND l.party_type = 'employee' AND l.party_id = ?`)
    .pluck()
    .get(code, employeeId) as number;
export const codes = (issues: { code: string; level: string }[], level = 'error') => issues.filter((i) => i.level === level).map((i) => i.code);
export const fails = (fn: () => unknown, code: string) => {
  try {
    fn();
  } catch (e) {
    expect((e as AppError).code).toBe(code);
    return (e as AppError).details;
  }
  throw new Error(`expected ${code}`);
};
