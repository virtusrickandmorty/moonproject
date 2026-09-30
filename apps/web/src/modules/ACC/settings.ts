/**
 * Accounting & Tax › Settings (PLAN F1): each dated setting in plain words, the value in force on a date, the form
 * values of a new version and the old-beside-new preview. Kept apart from the page so it can be tested. The server
 * checks every value again and its refusals are shown as they come.
 */
import type { Setting, SettingVersion } from '../../api.ts';
import { EWT_WORDS } from '../AP/payables.ts';

export type Form = Record<string, string>;
export interface PreviewRow { label: string; before: string; after: string; changed: boolean }
interface Kind {
  title: string;
  words: (v: unknown) => string;
  toForm: (v: unknown) => Form;
  fromForm: (f: Form) => { value?: unknown; errors: string[] };
  rows: (before: unknown, after: unknown) => PreviewRow[];
}

/** Basis points as a percent: 1200 -> "12%", 125 -> "1.25%". */
export const bpWords = (bp: number) => `${bp / 100}%`;
/** "12" or "1.25" (whole basis points, at most 2 decimals) to basis points, or null. */
export function percentToBp(text: string): number | null {
  const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(text.trim());
  return m ? Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0')) : null;
}
const bpText = (bp: number) => String(bp / 100);

const single = (title: string, words: (v: unknown) => string, extra: Partial<Kind> & Pick<Kind, 'toForm' | 'fromForm'>): Kind => ({
  title, words, rows: (b, a) => [{ label: title, before: words(b), after: words(a), changed: words(b) !== words(a) }], ...extra,
});
const percent = (title: string, max: number): Kind =>
  single(title, (v) => bpWords(Number(v)), {
    toForm: (v) => ({ percent: bpText(Number(v)) }),
    fromForm: (f) => {
      const bp = percentToBp(f.percent ?? '');
      return bp === null || bp > max * 100 ? { errors: [`Enter a percent from 0 to ${max}, with at most 2 decimals.`] } : { value: bp, errors: [] };
    },
  });
const yesNo = (title: string): Kind =>
  single(title, (v) => (v ? 'Yes' : 'No'), { toForm: (v) => ({ yes: v ? 'yes' : 'no' }), fromForm: (f) => ({ value: f.yes === 'yes', errors: [] }) });

export const DEPOSIT_MODES: Record<string, string> = { A: 'A: a deposit only', B: 'B: VAT on the deposit', C: 'C: an invoice on the downpayment' };
export const EWT_CLASS_NAMES = EWT_WORDS;
export const BAD_DEBT_METHODS: Record<string, string> = { direct: 'Written off directly to bad debts (6270)', allowance: 'Allowance for credit losses (1209), written off against it' };
interface CrMode { mode: 'booklet' | 'system'; signOff?: { name: string; date: string; basis: string } }
const crWords = (v: unknown) => {
  const c = v as CrMode;
  return c.mode === 'system' ? `Numbered and printed by the system${c.signOff ? `, signed off by ${c.signOff.name} on ${c.signOff.date}` : ''}` : 'Typed from the ATP booklet';
};
const ewt = (v: unknown) => v as Record<string, number>;

const KINDS: Record<string, Kind> = {
  'tax.vat_rate_bp': percent('VAT rate', 50),
  'tax.interest_final_tax_bp': percent('Final tax on bank interest', 50),
  'tax.dividend_final_tax_bp': percent('Final tax on dividends to individual stockholders', 50),
  'sales.deposit_vat_mode': single('Downpayment VAT', (v) => DEPOSIT_MODES[String(v)] ?? String(v), {
    toForm: (v) => ({ choice: String(v) }),
    fromForm: (f) => (f.choice && f.choice in DEPOSIT_MODES ? { value: f.choice, errors: [] } : { errors: ['Choose A, B or C.'] }),
  }),
  'col.cr_mode': single('Collection receipts', crWords, {
    toForm: (v) => { const c = v as CrMode; return { mode: c.mode, name: c.signOff?.name ?? '', date: c.signOff?.date ?? '', basis: c.signOff?.basis ?? '' }; },
    fromForm: (f) => {
      if (f.mode === 'booklet') return { value: { mode: 'booklet' }, errors: [] };
      const errors: string[] = [];
      const name = (f.name ?? '').trim();
      const basis = (f.basis ?? '').trim();
      if (name.length < 3 || name.length > 120) errors.push("Enter the accountant's name who signed off, 3 to 120 characters.");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date ?? '')) errors.push('Enter the date of the sign-off.');
      if (basis.length < 10 || basis.length > 500) errors.push('Say on what basis the accountant signed off, 10 to 500 characters.');
      return errors.length ? { errors } : { value: { mode: 'system', signOff: { name, date: f.date, basis } }, errors };
    },
  }),
  'tax.top_withholding_agent': yesNo('Top Withholding Agent'),
  'col.forfeit_vatable': yesNo('Forfeited deposit is VATable'),
  'acc.bad_debt_method': single('Bad debts', (v) => BAD_DEBT_METHODS[String(v)] ?? String(v), {
    toForm: (v) => ({ choice: String(v) }),
    fromForm: (f) => (f.choice && f.choice in BAD_DEBT_METHODS ? { value: f.choice, errors: [] } : { errors: ['Choose direct write-off or the allowance method.'] }),
  }),
  'tax.ewt_rates_bp': {
    title: 'Withholding tax (EWT) rates',
    words: (v) => Object.entries(ewt(v)).map(([k, bp]) => `${EWT_CLASS_NAMES[k] ?? k} ${bpWords(bp)}`).join('; '),
    toForm: (v) => Object.fromEntries(Object.entries(ewt(v)).map(([k, bp]) => [k, bpText(bp)])),
    fromForm: (f) => {
      const value: Record<string, number> = {};
      const errors: string[] = [];
      for (const k of Object.keys(EWT_CLASS_NAMES)) {
        const bp = percentToBp(f[k] ?? '');
        if (bp === null || bp > 5000) errors.push(`${EWT_CLASS_NAMES[k]}: enter a percent from 0 to 50, with at most 2 decimals.`);
        else value[k] = bp;
      }
      return errors.length ? { errors } : { value, errors };
    },
    rows: (b, a) => Object.keys({ ...ewt(b), ...ewt(a) }).map((k) => {
      const [before, after] = [ewt(b)[k], ewt(a)[k]].map((x) => (x === undefined ? '—' : bpWords(x)));
      return { label: EWT_CLASS_NAMES[k] ?? k, before: before!, after: after!, changed: before !== after };
    }),
  },
};

/** The setting has an editable form here; a key the screen does not know is shown as it is and cannot be changed here. */
export const isEditable = (key: string) => key in KINDS;
export const titleOf = (s: Pick<Setting, 'key' | 'label'>) => KINDS[s.key]?.title ?? s.label;
export const wordsOf = (key: string, value: unknown): string => (KINDS[key] ? KINDS[key].words(value) : JSON.stringify(value));
export const formOf = (key: string, value: unknown): Form => KINDS[key]?.toForm(value) ?? {};
export const valueFromForm = (key: string, f: Form) => KINDS[key]?.fromForm(f) ?? { errors: ['This setting cannot be changed here.'] };

/** The value in force on `date`: the newest version starting on or before it (a later row on the same date wins), as the server reads it. */
export function valueOn(versions: SettingVersion[], date: string): unknown {
  return [...versions].sort((a, b) => (a.effectiveFrom === b.effectiveFrom ? b.id - a.id : b.effectiveFrom.localeCompare(a.effectiveFrom))).find((v) => v.effectiveFrom <= date)?.value;
}
/** Versions that start after `date` and so replace a new version from then on. */
export const laterVersions = (versions: SettingVersion[], date: string) => versions.filter((v) => v.effectiveFrom > date).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));

export interface Draft { effectiveFrom: string; form: Form; reason: string }
export interface Checked { errors: string[]; body?: { effectiveFrom: string; value: unknown; reason: string }; preview?: { rows: PreviewRow[]; unchanged: boolean; later: SettingVersion[] } }

/** Checks a new version and works out its preview: the value in force on that date beside the new one. */
export function checkDraft(s: Setting, d: Draft, today: string): Checked {
  const errors: string[] = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.effectiveFrom)) errors.push('Enter the date the change takes effect.');
  else if (d.effectiveFrom < today) errors.push('A setting can change from today or a later date, never an earlier one, so recorded documents keep the setting they used.');
  const v = valueFromForm(s.key, d.form);
  errors.push(...v.errors);
  const reason = d.reason.trim();
  if (reason.length < 10 || reason.length > 500) errors.push('Give a reason of 10 to 500 characters.');
  if (errors.length || !KINDS[s.key]) return { errors };
  const before = valueOn(s.versions, d.effectiveFrom);
  const rows = KINDS[s.key]!.rows(before, v.value);
  return { errors, body: { effectiveFrom: d.effectiveFrom, value: v.value, reason }, preview: { rows, unchanged: !rows.some((r) => r.changed), later: laterVersions(s.versions, d.effectiveFrom) } };
}

/** Settings that have their own screen, where they are read and changed with the figures they act on. */
export const OWN_SCREENS: { label: string; text: string; path: string; permission: string }[] = [
  { label: 'Income tax rates and MCIT', text: 'The regular rate, the MCIT rate and the year operations began.', path: '/tax/1702q', permission: 'tax.registers.view' },
  { label: 'Annual deduction method', text: 'Itemized or the optional standard deduction, for each year.', path: '/tax/1702rt', permission: 'tax.registers.view' },
  { label: 'Company print details', text: 'Registered name, TIN and address printed on documents.', path: '/prt/company-profile', permission: 'prt.profile.manage' },
];
export const ownScreensFor = (permissions: string[]) => OWN_SCREENS.filter((s) => permissions.includes(s.permission));
