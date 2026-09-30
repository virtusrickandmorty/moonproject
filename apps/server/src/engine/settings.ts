/**
 * Effective-dated settings (PLAN C3, D4.2, E12). A setting never changes in place: a new version is a new row with
 * the date it takes effect, and documents read the version in force on their tax or business date. So a version a
 * posted document used never changes, and "what was the VAT rate on 3 March" always has one answer.
 */
import { z } from 'zod';
import { AppError, badRequest, conflict } from '@moonproject/shared';
import type { Db } from '../platform/db/driver.ts';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.');

/** The accountant's sign-off needed before the ERP prints its own collection receipts (ACC-03). */
const crSignOff = z
  .object({ name: z.string().trim().min(3).max(120), date: isoDate, basis: z.string().trim().min(10).max(500) })
  .strict();

/** EWT classes: the keys PUR suppliers and EXP categories store (PLAN D4.8). Their rates are the setting below. */
export const EWT_CLASSES = ['rent_5', 'contractor_2', 'prof_ind_5', 'prof_ind_10', 'prof_firm_10', 'prof_firm_15', 'goods_1', 'services_2'] as const;
export type EwtClass = (typeof EWT_CLASSES)[number];
const ewtRate = z.number().int().min(0).max(5000);
const ewtRates = z.object(Object.fromEntries(EWT_CLASSES.map((k) => [k, ewtRate])) as Record<EwtClass, typeof ewtRate>).strict();

/** Every setting, with the schema its value must pass. All of them need a fresh password (step-up) to change. */
export const SETTINGS = {
  'tax.vat_rate_bp': {
    label: 'VAT rate, in basis points (1200 = 12%)',
    schema: z.number().int().min(0).max(5000),
  },
  'sales.deposit_vat_mode': {
    label: 'Downpayment VAT mode: A deposit only, B VAT on deposit, C invoice on downpayment (ACC-02)',
    schema: z.enum(['A', 'B', 'C']),
  },
  'col.cr_mode': {
    label: 'Collection receipts: typed from the ATP booklet, or numbered and printed by the system (ACC-03)',
    schema: z.discriminatedUnion('mode', [
      z.object({ mode: z.literal('booklet') }).strict(),
      z.object({ mode: z.literal('system'), signOff: crSignOff }).strict(),
    ]),
  },
  'tax.top_withholding_agent': {
    label: 'Virtus is a published Top Withholding Agent (ACC-06)',
    schema: z.boolean(),
  },
  'tax.ewt_rates_bp': {
    label: 'EWT rate of each withholding class, in basis points (500 = 5%) (PLAN D4.8)',
    schema: ewtRates,
  },
  'col.forfeit_vatable': {
    label: 'A forfeited customer deposit is VATable: 12/112 of it goes to output VAT (ACC-15; default no)',
    schema: z.boolean(),
  },
  'acc.bad_debt_method': {
    label: 'Bad debts: written off directly to 6270, or provided for on 1209 and written off against it (ACC-26; default direct)',
    schema: z.enum(['direct', 'allowance']),
  },
  'tax.interest_final_tax_bp': {
    label: 'Final tax the bank withholds on interest, in basis points (2000 = 20%, PLAN D5 BANK-ADJ)',
    schema: z.number().int().min(0).max(5000),
  },
} as const;

export type SettingKey = keyof typeof SETTINGS;
export type SettingValue<K extends SettingKey> = z.infer<(typeof SETTINGS)[K]['schema']>;

export const isSettingKey = (k: string): k is SettingKey => Object.hasOwn(SETTINGS, k);

export interface SettingVersion {
  id: number;
  key: SettingKey;
  effectiveFrom: string;
  value: unknown;
  reason: string;
  createdAt: string;
  createdBy: string | null;
}

/** The value in force on `date` (YYYY-MM-DD). */
export function settingAt<K extends SettingKey>(db: Db, key: K, date: string): SettingValue<K> {
  const json = db
    .prepare('SELECT value_json FROM settings WHERE key = ? AND effective_from <= ? ORDER BY effective_from DESC, id DESC LIMIT 1')
    .pluck()
    .get(key, date) as string | undefined;
  if (json === undefined) throw new AppError('SETTING_MISSING', `No ${key} setting applies on ${date}.`, 500);
  return SETTINGS[key].schema.parse(JSON.parse(json)) as SettingValue<K>;
}

/** Every version of a setting, newest first. */
export function settingHistory(db: Db, key: SettingKey): SettingVersion[] {
  const rows = db
    .prepare('SELECT id, key, effective_from, value_json, reason, created_at, created_by FROM settings WHERE key = ? ORDER BY effective_from DESC, id DESC')
    .all(key) as { id: number; key: SettingKey; effective_from: string; value_json: string; reason: string; created_at: string; created_by: string | null }[];
  return rows.map((r) => ({
    id: r.id,
    key: r.key,
    effectiveFrom: r.effective_from,
    value: JSON.parse(r.value_json),
    reason: r.reason,
    createdAt: r.created_at,
    createdBy: r.created_by,
  }));
}

/**
 * Adds a version. It may start today or later, never earlier, so documents already recorded keep the version they
 * used. A later row on the same date wins, which is how a future version entered by mistake is corrected.
 * Call inside a transaction, together with the audit entry.
 */
export function addSettingVersion(
  db: Db,
  v: { key: SettingKey; effectiveFrom: string; value: unknown; reason: string; userId: string; at: string; today: string },
): SettingVersion {
  const from = isoDate.safeParse(v.effectiveFrom);
  if (!from.success) throw badRequest('BAD_DATE', 'Enter the date the change takes effect (YYYY-MM-DD).');
  if (v.effectiveFrom < v.today) {
    throw badRequest('SETTING_BACKDATED', 'A setting can change from today or a later date, never an earlier one, so recorded documents keep the setting they used.');
  }
  const parsed = SETTINGS[v.key].schema.safeParse(v.value);
  if (!parsed.success) {
    throw badRequest('BAD_VALUE', 'This value is not allowed for this setting.', parsed.error.issues.map((i) => ({ field: ['value', ...i.path].join('.'), message: i.message })));
  }
  const json = JSON.stringify(parsed.data);
  if (JSON.stringify(settingAt(db, v.key, v.effectiveFrom)) === json) {
    throw conflict('NO_CHANGE', 'The setting already has this value on that date.');
  }
  const id = db
    .prepare('INSERT INTO settings (key, effective_from, value_json, reason, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)')
    .run(v.key, v.effectiveFrom, json, v.reason, v.at, v.userId).lastInsertRowid as number;
  return { id: Number(id), key: v.key, effectiveFrom: v.effectiveFrom, value: parsed.data, reason: v.reason, createdAt: v.at, createdBy: v.userId };
}
