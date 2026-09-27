/** Made-up workers for PRD tests, in EMP's employee master. */
import type { Db } from '../../../platform/db/driver.ts';
import { addEmployee } from '../../EMP/tests/fixture.ts';

export function seedEmployees(db: Db) {
  const add = (name: string) => addEmployee(db, name);
  return { cutter: add('Dana Cutter'), sewer1: add('Ely Sewer'), sewer2: add('Fai Stitcher'), packer: add('Gil Packer'), left: addEmployee(db, 'Hana Former', { separatedOn: '2026-06-30' }) };
}
