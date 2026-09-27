/** Expense categories: a fixed list, each tied to one expense account (PLAN D2, NR-8). The name is the account's. */
import type { Db } from '../../platform/db/driver.ts';
import type { EwtClass } from './doctypes/voucher.ts';

export interface Category { id: number; accountId: number; code: string; name: string; defaultEwtClass: EwtClass | null; isActive: boolean }

const SELECT = `SELECT c.id, c.account_id AS accountId, a.code, a.name, c.default_ewt_class AS defaultEwtClass,
  (c.is_active = 1 AND a.is_active = 1) AS isActive FROM exp_categories c JOIN accounts a ON a.id = c.account_id`;
type Row = Omit<Category, 'isActive'> & { isActive: number };
const asCategory = (r: Row): Category => ({ ...r, isActive: r.isActive === 1 });

export function category(db: Db, id: number): Category | undefined {
  const r = db.prepare(`${SELECT} WHERE c.id = ?`).get(id) as Row | undefined;
  return r && asCategory(r);
}

export function listCategories(db: Db): Category[] {
  return (db.prepare(`${SELECT} ORDER BY c.sort_order, a.code`).all() as Row[]).map(asCategory).filter((c) => c.isActive);
}
