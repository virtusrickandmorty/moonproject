/**
 * A worker's own sign-in for the floor app (the owner's request, Nov 2026): the user account an employee signs in with on
 * the phone. Only accounts with the Production worker role are offered; one account is one employee at a time. The
 * latest row of an employee is the link in force (emp_floor_users is insert-only); every change is audited.
 */
import { z } from 'zod';
import { badRequest, conflict, notFound } from '@moonproject/shared';
import type { Db } from '../../platform/db/driver.ts';
import { appendAudit } from '../../engine/audit.ts';

const LINK = `SELECT l.employee_id, l.user_id FROM emp_floor_users l
  WHERE l.seq = (SELECT MAX(x.seq) FROM emp_floor_users x WHERE x.employee_id = l.employee_id)`;

/** The account an employee signs in with on the floor app, if one is linked. */
export function floorUserOf(db: Db, employeeId: string): { userId: string; username: string; displayName: string } | null {
  const r = db.prepare(`SELECT u.id AS userId, u.username, u.display_name AS displayName FROM (${LINK}) l JOIN users u ON u.id = l.user_id WHERE l.employee_id = ?`).get(employeeId) as
    | { userId: string; username: string; displayName: string }
    | undefined;
  return r ?? null;
}

/** The employee a signed-in user is on the floor app, if the account is linked to an active employee. */
export function employeeOfUser(db: Db, userId: string): { id: string; code: string; name: string } | null {
  const r = db.prepare(`SELECT e.id, e.code, e.full_name AS name FROM (${LINK}) l JOIN emp_employees e ON e.id = l.employee_id WHERE l.user_id = ? AND e.is_active = 1`).get(userId) as
    | { id: string; code: string; name: string }
    | undefined;
  return r ?? null;
}

/** The active accounts with the Production worker role, and the employee each is linked to now (for the picker). */
export function floorAccounts(db: Db): { id: string; username: string; displayName: string; employeeId: string | null; employeeName: string | null }[] {
  return db.prepare(`SELECT u.id, u.username, u.display_name AS displayName, l.employee_id AS employeeId, e.full_name AS employeeName
      FROM users u JOIN user_roles r ON r.user_id = u.id AND r.role_key = 'worker' AND r.active = 1
      LEFT JOIN (${LINK}) l ON l.user_id = u.id LEFT JOIN emp_employees e ON e.id = l.employee_id
      WHERE u.is_active = 1 ORDER BY u.display_name, u.username`).all() as { id: string; username: string; displayName: string; employeeId: string | null; employeeName: string | null }[];
}

export const floorUserInput = z.object({ userId: z.string().min(1).max(64).nullable() }).strict();

/** Links an employee to a Production worker account, or unlinks (null). Call inside a transaction. */
export function setFloorUser(db: Db, employeeId: string, raw: unknown, who: { userId: string; at: string }) {
  const v = floorUserInput.parse(raw);
  const e = db.prepare('SELECT full_name AS name, is_active AS active FROM emp_employees WHERE id = ?').get(employeeId) as { name: string; active: number } | undefined;
  if (!e) throw notFound('The employee');
  if (v.userId !== null) {
    if (!e.active) throw conflict('SEPARATED', `${e.name} is separated.`);
    const account = floorAccounts(db).find((a) => a.id === v.userId);
    if (!account) throw badRequest('NOT_A_WORKER', 'Pick an active sign-in with the Production worker role (Admin › Users).');
    if (account.employeeId && account.employeeId !== employeeId) throw conflict('IN_USE', `${account.username} is already ${account.employeeName}'s sign-in. Unlink it there first.`);
  }
  if ((floorUserOf(db, employeeId)?.userId ?? null) === v.userId) return floorUserOf(db, employeeId);
  db.prepare('INSERT INTO emp_floor_users (employee_id, user_id, at, by_user_id) VALUES (?, ?, ?, ?)').run(employeeId, v.userId, who.at, who.userId);
  appendAudit(db, { at: who.at, userId: who.userId, action: 'emp.floor_user', entityType: 'emp.employee', entityId: employeeId, data: { userId: v.userId } });
  return floorUserOf(db, employeeId);
}
