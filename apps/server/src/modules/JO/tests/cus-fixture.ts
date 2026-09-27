/**
 * Made-up customers and wearers for JO tests, in the PLAN E1 tables. A stand-in until CUS (PR #4) is merged:
 * after that the CREATE statements are skipped and the same rows go into the real CUS tables.
 */
import { newId } from '@moonproject/shared';
import type { Db } from '../../../platform/db/driver.ts';

const TABLES = `
CREATE TABLE IF NOT EXISTS cus_customers (id TEXT PRIMARY KEY, code TEXT, kind TEXT, display_name TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS cus_groups (id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, name TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS cus_people (id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, group_id TEXT, full_name TEXT NOT NULL, default_jersey_name TEXT,
  default_jersey_number TEXT, is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS cus_measure_charts (id TEXT PRIMARY KEY, person_id TEXT NOT NULL, revision_no INTEGER NOT NULL, status TEXT NOT NULL,
  size_mode TEXT NOT NULL, upper_size TEXT, measured_by TEXT, measured_on TEXT, reason TEXT, supersedes_id TEXT);`;
const AT = '2026-09-28T10:00:00.000+08:00';

export function seedCustomers(db: Db, measuredBy: string) {
  db.exec(TABLES);
  let n = 0;
  const customer = (name: string, active = 1) => {
    const id = newId();
    db.prepare('INSERT INTO cus_customers (id, code, kind, display_name, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, `CUS-T${++n}`, 'organization', name, active, AT, AT);
    return id;
  };
  const group = (customerId: string, name: string) => {
    const id = newId();
    db.prepare('INSERT INTO cus_groups (id, customer_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(id, customerId, name, AT, AT);
    return id;
  };
  const person = (customerId: string, groupId: string | null, name: string, jersey: [string, string] | null = null) => {
    const id = newId();
    db.prepare('INSERT INTO cus_people (id, customer_id, group_id, full_name, default_jersey_name, default_jersey_number, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
      id, customerId, groupId, name, jersey?.[0] ?? null, jersey?.[1] ?? null, AT, AT,
    );
    return id;
  };
  const chart = (personId: string, revision: number, status: string, supersedes: string | null = null) => {
    const id = newId();
    db.prepare(
      `INSERT INTO cus_measure_charts (id, person_id, revision_no, status, size_mode, upper_size, measured_by, measured_on, reason, supersedes_id)
       VALUES (?, ?, ?, ?, 'preset', 'M', ?, '2026-09-28', ?, ?)`,
    ).run(id, personId, revision, status, measuredBy, supersedes ? 'Grew since the last fitting' : null, supersedes);
    return id;
  };

  const school = customer('Moonlight Test School');
  const team = group(school, 'Chess Team');
  const ari = person(school, team, 'Ari Sample', ['ari', '7']);
  const bea = person(school, team, 'Bea Example');
  const firstChart = chart(bea, 1, 'superseded');
  const beaChart = chart(bea, 2, 'active', firstChart);
  const cy = person(school, null, 'Cy Placeholder');
  const other = customer('Paper Lantern Club');
  const outsider = person(other, null, 'Robin Outsider');
  const closed = customer('Closed Test Shop', 0);
  return { school, team, ari, bea, beaChart, cy, other, outsider, closed };
}
