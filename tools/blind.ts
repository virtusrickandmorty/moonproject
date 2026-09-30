/**
 * The blind recompute (PLAN I1 item 8): the CSV the reviewers answer in, and the comparison of their journals with the
 * app's. Shared by `tools/blind-pack.ts`, `tools/compare-blind.ts` and the month test.
 *
 * One row per journal line: doc_ref,line,account_code,debit,credit,party,tax_kind,base,rate
 *   doc_ref       the reference the scenario gives the journal (G-02, G-12r, M-07, ...)
 *   line          1, 2, 3 ... within the journal (only for reading; lines are matched by account, party and side)
 *   debit/credit  pesos with two decimals, one of them empty or 0
 *   party         only on the subledger accounts below, named as the scenario names them; empty elsewhere
 *   tax_kind      output_vat, input_vat, cwt, vat_withheld, ewt or wtax on those tax lines; empty elsewhere
 *   base, rate    optional: the amount the tax was worked on and its rate in percent (12, 5, 1); when both are
 *                 given, the line's amount must be base × rate rounded half away from zero (D4.5)
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const CSV_HEADER = 'doc_ref,line,account_code,debit,credit,party,tax_kind,base,rate';

/** Accounts whose lines name a party (PLAN D2 "Party", D9 L3), plus capital stock, which names the stockholder. */
export const PARTY_ACCOUNTS = new Set([
  '1201', '1209', '1210', '1220', '1230', '1401', '1404', '1410',
  '1510', '1511', '1520', '1521', '1530', '1531', '1540', '1541', '1550', '1551',
  '2101', '2110', '2111', '2201', '2209', '2301', '2310', '2311', '2401', '2402', '2403', '2404', '2405',
  '2501', '2502', '2503', '2601', '2602', '3101',
]);

/** Account names by code, from the chart the app seeds (PLAN D2), for plain-word messages. */
export function chartNames(root: string): Record<string, string> {
  const sql = readFileSync(join(root, 'apps/server/src/platform/db/migrations/0002_chart_of_accounts.sql'), 'utf8');
  return Object.fromEntries([...sql.matchAll(/\('(\d{4})', '((?:[^']|'')*)'/g)].map((x) => [x[1]!, x[2]!.replace(/''/g, "'")]));
}

export const TAX_KINDS = ['output_vat', 'input_vat', 'cwt', 'vat_withheld', 'ewt', 'wtax'] as const;

export interface BlindRow {
  docRef: string;
  line: number;
  accountCode: string;
  debitCents: number;
  creditCents: number;
  party: string;
  taxKind: string;
  baseCents: number | null;
  /** Basis points: 1200 = 12%. */
  rateBp: number | null;
}

const peso = (cents: number) => `₱${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const plain = (cents: number) => (cents / 100).toFixed(2);

/** A CSV field: quoted when it holds a comma, a quote or a line break. */
function field(s: string): string {
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: BlindRow[]): string {
  const lines = rows.map((r) =>
    [
      r.docRef, String(r.line), r.accountCode, r.debitCents ? plain(r.debitCents) : '', r.creditCents ? plain(r.creditCents) : '', r.party, r.taxKind,
      r.baseCents === null ? '' : plain(r.baseCents), r.rateBp === null ? '' : String(r.rateBp / 100),
    ].map(field).join(','),
  );
  return [CSV_HEADER, ...lines].join('\n') + '\n';
}

/** Splits CSV text into records (RFC 4180 quoting). */
function records(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') (cur += '"'), i++;
      else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') row.push(cur), (cur = '');
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cur), out.push(row), (row = []), (cur = '');
    } else cur += c;
  }
  if (cur !== '' || row.length) row.push(cur), out.push(row);
  return out.filter((r) => r.some((f) => f.trim() !== ''));
}

/** "28,000.00", "₱28000", "28000.5" → centavos; empty → 0. Anything else is an error. */
function cents(s: string, where: string): number {
  const t = s.trim().replace(/^₱/, '').replace(/,/g, '');
  if (t === '') return 0;
  if (!/^-?\d+(\.\d{1,2})?$/.test(t)) throw new Error(`${where}: "${s}" is not an amount in pesos.`);
  const [whole, frac = ''] = t.replace('-', '').split('.');
  const n = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  return t.startsWith('-') ? -n : n;
}

/** "12", "12%", "0.5" → basis points; empty → null. */
function rate(s: string, where: string): number | null {
  const t = s.trim().replace(/%$/, '');
  if (t === '') return null;
  if (!/^\d+(\.\d{1,2})?$/.test(t)) throw new Error(`${where}: "${s}" is not a rate in percent (like 12 or 0.5).`);
  return Math.round(Number(t) * 100);
}

/** Reads a CSV in the blind-recompute format. Throws with the line number on anything it cannot read. */
export function parseCsv(text: string): BlindRow[] {
  const recs = records(text.replace(/^﻿/, ''));
  const head = recs.shift()?.map((h) => h.trim().toLowerCase());
  if (!head || head.join(',') !== CSV_HEADER) throw new Error(`The first line must be the header: ${CSV_HEADER}`);
  return recs.map((r, i) => {
    const where = `CSV line ${i + 2}`;
    const [docRef = '', line = '', code = '', dr = '', cr = '', party = '', taxKind = '', base = '', rt = ''] = r.map((f) => f.trim());
    if (!docRef) throw new Error(`${where}: doc_ref is empty.`);
    if (!/^\d{4}$/.test(code)) throw new Error(`${where}: account_code "${code}" is not a 4-digit account code.`);
    const row: BlindRow = {
      docRef, line: Number(line) || 0, accountCode: code, debitCents: cents(dr, where), creditCents: cents(cr, where), party, taxKind: taxKind.toLowerCase(),
      baseCents: base === '' ? null : cents(base, where), rateBp: rate(rt, where),
    };
    if (row.debitCents < 0 || row.creditCents < 0) throw new Error(`${where}: write a negative debit as a credit.`);
    if ((row.debitCents === 0) === (row.creditCents === 0)) throw new Error(`${where}: put the amount in debit or in credit, not both and not neither.`);
    return row;
  });
}

const norm = (party: string) => party.trim().toLowerCase().replace(/\s+/g, ' ').replace(/\.$/, '');

interface Side { cents: number; party: string; taxKinds: Set<string> }
/** One journal's lines added up per account, party (subledger accounts only) and side. */
function sides(rows: BlindRow[]): Map<string, Side> {
  const out = new Map<string, Side>();
  for (const r of rows) {
    const party = PARTY_ACCOUNTS.has(r.accountCode) ? r.party : '';
    for (const [side, amount] of [['Dr', r.debitCents], ['Cr', r.creditCents]] as const) {
      if (!amount) continue;
      const key = `${r.accountCode}|${norm(party)}|${side}`;
      const s = out.get(key) ?? { cents: 0, party, taxKinds: new Set<string>() };
      s.cents += amount;
      if (r.taxKind) s.taxKinds.add(r.taxKind);
      out.set(key, s);
    }
  }
  return out;
}

/**
 * Every difference between the app's journals and theirs, in plain words (none: they agree to the centavo).
 * `names` gives account names for the messages.
 */
export function compareJournals(app: BlindRow[], theirs: BlindRow[], names: Record<string, string> = {}): string[] {
  const diffs: string[] = [];
  const account = (code: string) => (names[code] ? `${code} ${names[code]}` : code);
  const what = (side: string, code: string, s: Side) => `${side === 'Dr' ? 'debits' : 'credits'} ${account(code)} ${peso(s.cents)}${s.party ? ` (${s.party})` : ''}`;
  const refs = (rows: BlindRow[]) => [...new Set(rows.map((r) => r.docRef))];
  const byRef = (rows: BlindRow[], ref: string) => rows.filter((r) => r.docRef === ref);

  for (const r of theirs) {
    if (r.baseCents === null || r.rateBp === null) continue;
    const expected = Math.sign(r.baseCents) * Math.floor((Math.abs(r.baseCents) * r.rateBp + 5_000) / 10_000);
    const amount = r.debitCents || r.creditCents;
    if (expected !== amount) {
      diffs.push(`${r.docRef} line ${r.line} (${account(r.accountCode)}): their base ${peso(r.baseCents)} × ${r.rateBp / 100}% is ${peso(expected)}, but the line says ${peso(amount)}.`);
    }
  }
  for (const r of theirs) {
    if (r.taxKind && !(TAX_KINDS as readonly string[]).includes(r.taxKind)) diffs.push(`${r.docRef} line ${r.line}: tax_kind "${r.taxKind}" is not one of ${TAX_KINDS.join(', ')}.`);
  }

  for (const ref of refs(app)) {
    if (!theirs.some((r) => r.docRef === ref)) {
      const posts = [...sides(byRef(app, ref))].map(([k, v]) => `${k.split('|')[2]} ${account(k.split('|')[0]!)} ${peso(v.cents)}${v.party ? ` (${v.party})` : ''}`);
      diffs.push(`${ref}: their CSV has no journal; the app posts ${posts.join(', ')}.`);
    }
  }
  for (const ref of refs(theirs)) {
    if (!app.some((r) => r.docRef === ref)) diffs.push(`${ref}: their CSV has a journal the app does not post for this reference.`);
  }

  for (const ref of refs(app).filter((x) => theirs.some((r) => r.docRef === x))) {
    const a = sides(byRef(app, ref));
    const t = sides(byRef(theirs, ref));
    for (const [key, as] of a) {
      const [code, , side] = key.split('|') as [string, string, string];
      const ts = t.get(key);
      if (!ts) diffs.push(`${ref}: the app ${what(side, code, as)}; theirs has no such ${side === 'Dr' ? 'debit' : 'credit'}.`);
      else {
        if (ts.cents !== as.cents) {
          diffs.push(`${ref}: the app ${what(side, code, as)}; theirs ${side === 'Dr' ? 'debits' : 'credits'} ${peso(ts.cents)}, ${peso(Math.abs(ts.cents - as.cents))} ${ts.cents > as.cents ? 'more' : 'less'}.`);
        }
        const kinds = (x: Side) => [...x.taxKinds].sort().join('/');
        if (as.taxKinds.size && ts.taxKinds.size && kinds(as) !== kinds(ts)) diffs.push(`${ref}: on ${account(code)} the app's tax_kind is ${kinds(as)}, theirs ${kinds(ts)}.`);
      }
    }
    for (const [key, ts] of t) {
      if (a.has(key)) continue;
      const [code, , side] = key.split('|') as [string, string, string];
      diffs.push(`${ref}: theirs ${what(side, code, ts)}; the app has no such ${side === 'Dr' ? 'debit' : 'credit'}.`);
    }
  }
  return diffs;
}
