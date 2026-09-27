/**
 * Made-up employees for PRD tests, in the table EMP will create (PLAN E11). A stand-in until EMP is built: after that
 * the CREATE statement is skipped and the same rows go into the real EMP table.
 */
import { newId } from '@moonproject/shared';
import type { Db } from '../../../platform/db/driver.ts';

export function seedEmployees(db: Db) {
  db.exec(`CREATE TABLE IF NOT EXISTS emp_employees (id TEXT PRIMARY KEY, code TEXT NOT NULL, full_name TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1)`);
  let n = 0;
  const add = (name: string, active = 1) => {
    const id = newId();
    db.prepare('INSERT INTO emp_employees (id, code, full_name, is_active) VALUES (?, ?, ?, ?)').run(id, `EMP-T${++n}`, name, active);
    return id;
  };
  return { cutter: add('Dana Cutter'), sewer1: add('Ely Sewer'), sewer2: add('Fai Stitcher'), packer: add('Gil Packer'), left: add('Hana Former', 0) };
}
