/**
 * The practice shop's databases (PLAN C8), registered by the PAY routes when the app is the practice shop. The real shop and
 * the practice shop can run in one process, so this is per database, never a switch for the process.
 * In the practice shop a payroll may be tried on a period that has not ended yet (the owner's request, Oct 2026: to test
 * adding payrolls); the real shop still waits for the period to end.
 */
import type { Db } from '../../platform/db/driver.ts';

const practiceDbs = new WeakSet<Db>();
export const markPractice = (db: Db) => { practiceDbs.add(db); };
export const isPractice = (db: Db) => practiceDbs.has(db);
