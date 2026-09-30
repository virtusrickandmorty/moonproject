/**
 * Month in the life (PLAN I2 G-30) and the blind recompute (PLAN I1 item 8). The month is `tools/month-scenario.ts`: G-27's
 * opening on 2026-08-31, G-01 to G-24 in September 2026 (G-04 and G-05, downpayment VAT modes B and C, on 24 and 25
 * September, each on its own job order), then the month-end, all through the HTTP API.
 *
 * The journals below are worked out by hand from the goldens in PLAN I2 and the rules of Part D, never copied from the
 * app. The test reads this block: each journal the app posts must be exactly its line here (account, amount, and the
 * party on subledger accounts, D9 L3), and the lines here must add up to tests/golden/month.tb.csv, which the app's
 * trial balance on 2026-09-30 must equal to the centavo. "·" separates lines; a line starting "·" continues a journal.
 *
 * Figures worked out (D4.1 VAT = round(G × 12/112), D4.5 withholding on NET, F1/F3 payroll):
 *   VAT of ₱10,000.00 = 1,071.43, net 8,928.57; of ₱56,000.00 = 6,000.00; of ₱112,000.00 = 12,000.00; of ₱350.00 = 37.50.
 *   G-04 (mode B, D3): VAT of the ₱28,000.00 downpayment = 3,000.00 on 2209, recognised in 2301 now (DEP-VAT); the invoice of
 *         ₱56,000.00 books 6,000.00 and takes the 3,000.00 back out of 2209 (DEP-VAT-REV): 2301 +6,000.00, 2209 = 0.
 *   G-05 (mode C, D3): the downpayment invoice 0509: 28,000.00 = net 25,000.00 (to 2201 until release) + VAT 3,000.00;
 *         the balance invoice 0510 shows 56,000.00 − 28,000.00 = 28,000.00 = net 25,000.00 + VAT 3,000.00, and the
 *         downpayment's 25,000.00 leaves 2201 for 4101 (DEP-APPLY): sales 50,000.00, 2301 +6,000.00, 2201 = 0, AR 28,000.00.
 *   G-10: list 56,000.00 → net 50,000.00; invoice 50,400.00 → VAT 5,400.00, net 45,000.00; discount 50,000.00 − 45,000.00.
 *   G-13: VAT of 40,000.00 = 4,285.71, net 35,714.29, EWT 5% = 1,785.71. G-14: non-VAT, EWT 5% of the gross = 2,000.00.
 *   G-18: cash on hand in the ledger on 21 September = 20,000.00 − 2,000.00 + 28,000.00 + 17,750.00 + 5,000.00
 *         + 12,000.00 − 2,000.00 + 350.00 − 6,600.00 + 10,000.00 = 82,500.00; counted 82,450.00, ₱50.00 short.
 *   G-22: 1301 is 0.00 in the books (G-27 opens no inventory); counted 200 yd × 120.00 + 20 × 50.00 = 25,000.00.
 *   G-24a Carla 1–15: gross 7,500.00; SSS on MSC 7,500 (EE 375, ER 750, EC 10); PhilHealth 5% of 15,000 (375 each);
 *         Pag-IBIG 2% of 7,500 (150 each); no tax (7,500 − 900 below the semi-monthly zero bracket); 13th 7,500 / 12 = 625.
 *   G-24  Carla 16–30: SSS on MSC 15,000 (EE 750, ER 1,500, EC 30) less cutoff 1; Pag-IBIG 2% of 10,000 (cap) = 200
 *         each less 150; PhilHealth taken; net 7,500 − 375 − 50 = 7,075.00 (PLAN F3 example C).
 *   G-23b Ana 16–30: 10 days × 550.00 = 5,500.00; OT 2 h × 550/8 × 125% = 171.88; SSS on MSC 5,500 (EE 275, ER 550,
 *         EC 10); PhilHealth 5% of 550 × 313/12 = 717.29 → 358.65 each; Pag-IBIG 2% of 5,671.88 = 113.44 each; MWE: no
 *         tax; CA 1,000.00; 13th 5,500 / 12 = 458.33; net 5,671.88 − 275 − 358.65 − 113.44 − 1,000 = 3,924.79.
 *   M-01: heat press (100,000.00 − 10,000.00) / 60 = 1,500.00; embroidery machine 295,000.00 / 59 months left = 5,000.00.
 *   M-02: cash on hand = 82,450.00 + 28,000.00 (G-04a) + 28,000.00 (G-05b) − 2,000.00 (G-23) − 7,075.00 − 3,924.79 (S-03, S-04)
 *         = 125,450.21; counted 125,470.21.
 *   M-03..M-05: SSS 1,135 + 1,145 + 835 = 3,115.00; PhilHealth 750 + 717.30 = 1,467.30; Pag-IBIG 300 + 100 + 226.88 = 626.88.
 *   M-06: EWT of Q3 = 1,785.71 + 2,000.00 = 3,785.71 (the 1601-EQ: September has no 0619-E).
 *   M-07: output VAT Test School 6,000.00 + 3 × 1,071.43 + 37.50 + 5,400.00 − 600.00 + 6,000.00 (G-04) + 6,000.00 (G-05)
 *         = 26,051.79; Sample City Hall 12,000.00; input VAT 4,285.71 + 1,200.00 + 12,000.00 = 17,485.71; VAT withheld
 *         5,000.00 (2307 in hand); payable 38,051.79 − 17,485.71 − 5,000.00 = 15,566.08.
 *
 * BEGIN JOURNALS
 * G-27a OB-000001     2026-08-31  Dr 1101 20,000.00 · Dr 1111 150,000.00 · Cr 3900 170,000.00
 * G-27b OBJO-000001   2026-08-31  Dr 1201 36,000.00 (Sample Parish) · Cr 3900 36,000.00
 * G-27c OBFA-000001   2026-08-31  Dr 1510 300,000.00 (Embroidery machine) · Cr 3900 300,000.00
 * G-27d OBJO-000002   2026-08-31  Dr 3900 20,000.00 · Cr 2201 20,000.00 (Sample Dance Club)
 * G-27e OBLN-000001   2026-08-31  Dr 3900 200,000.00 · Cr 2601 200,000.00 (Sample Lending loan)
 * G-27f OB-000002     2026-08-31  Dr 3900 286,000.00 · Cr 3101 250,000.00 (Sample Owner A) · Cr 3201 36,000.00
 * S-01  TRF-000001    2026-09-01  Dr 1102 2,000.00 · Cr 1101 2,000.00
 * G-01  COL-000001    2026-09-01  Dr 1101 28,000.00 · Cr 2201 28,000.00 (Test School)
 * G-02  IR-000001     2026-09-02  Dr 1201 56,000.00 (Test School) · Cr 4101 50,000.00 · Cr 2301 6,000.00 (Test School)
 *                                 · Dr 2201 28,000.00 (Test School) · Cr 1201 28,000.00 (Test School)
 * G-03  COL-000002    2026-09-02  Dr 1121 10,000.00 · Dr 1101 17,750.00 · Dr 1410 250.00 (Test School) · Cr 1201 28,000.00 (Test School)
 * G-06a IR-000002     2026-09-07  Dr 1201 10,000.00 (Test School) · Cr 4101 8,928.57 · Cr 2301 1,071.43 (Test School)
 * G-06  COL-000003    2026-09-07  Dr 1101 5,000.00 · Dr 1111 20,000.00 · Cr 1201 10,000.00 (Test School) · Cr 2201 15,000.00 (Test School)
 * G-07a IR-000003     2026-09-08  Dr 1201 10,000.00 (Test School) · Cr 4101 8,928.57 · Cr 2301 1,071.43 (Test School)
 * G-07  COL-000004    2026-09-08  Dr 1101 12,000.00 · Cr 1201 10,000.00 (Test School) · Cr 2201 2,000.00 (Test School)
 * G-07b RFD-000001    2026-09-09  Dr 2201 2,000.00 (Test School) · Cr 1101 2,000.00
 * G-08a IR-000004     2026-09-09  Dr 1201 350.00 (Test School) · Cr 4103 312.50 · Cr 2301 37.50 (Test School)
 * G-08b COL-000005    2026-09-09  Dr 1101 350.00 · Cr 1201 350.00 (Test School)
 * G-09a IR-000005     2026-09-10  Dr 1201 112,000.00 (Sample City Hall) · Cr 4101 100,000.00 · Cr 2301 12,000.00 (Sample City Hall)
 * G-09  COL-000006    2026-09-10  Dr 1111 106,000.00 · Dr 1410 1,000.00 (Sample City Hall) · Dr 1404 5,000.00 (Sample City Hall)
 *                                 · Cr 1201 112,000.00 (Sample City Hall)
 * G-10  IR-000006     2026-09-11  Dr 1201 50,400.00 (Test School) · Dr 4190 5,000.00 · Cr 4101 50,000.00 · Cr 2301 5,400.00 (Test School)
 * G-11  CM-000001     2026-09-14  Dr 4191 5,000.00 · Dr 2301 600.00 (Test School) · Cr 1201 5,600.00 (Test School)
 * G-12a IR-000007     2026-09-15  Dr 1201 10,000.00 (Test School) · Cr 4101 8,928.57 · Cr 2301 1,071.43 (Test School)
 * G-12  COL-000007    2026-09-15  Dr 1121 10,000.00 · Cr 1201 10,000.00 (Test School)
 * G-24a PAY-000001    2026-09-15  Dr 6101 7,500.00 · Dr 6102 1,285.00 · Dr 6103 625.00 · Cr 2401 1,135.00 (Carla Opisina)
 *                                 · Cr 2402 750.00 (Carla Opisina) · Cr 2403 300.00 (Carla Opisina) · Cr 2111 625.00 (Carla Opisina)
 *                                 · Cr 2110 6,600.00 (Carla Opisina)
 * S-02  POUT-000001   2026-09-15  Dr 2110 6,600.00 (Carla Opisina) · Cr 1101 6,600.00
 * G-12r COL-000007/rev 2026-09-16 Dr 1201 10,000.00 (Test School) · Cr 1121 10,000.00
 * G-12b COL-000008    2026-09-16  Dr 1101 10,000.00 · Cr 1201 10,000.00 (Test School)
 * G-13  EXP-000001    2026-09-16  Dr 6110 35,714.29 · Dr 1401 4,285.71 (Sample Lessor Corp.) · Cr 2311 1,785.71 (Sample Lessor Corp.)
 *                                 · Cr 1111 38,214.29
 * G-14  EXP-000002    2026-09-17  Dr 6110 40,000.00 · Cr 2311 2,000.00 (Sample Landlord) · Cr 1111 38,000.00
 * G-15  BILL-000001   2026-09-17  Dr 5101 10,000.00 · Dr 1401 1,200.00 (Sample Fabric Trading) · Cr 2101 11,200.00 (Sample Fabric Trading)
 * G-15b SPAY-000001   2026-09-18  Dr 2101 5,000.00 (Sample Fabric Trading) · Cr 1111 5,000.00
 * G-16  EXP-000003    2026-09-18  Dr 6140 200.00 · Cr 1102 200.00
 * G-17  TRF-000002    2026-09-21  Dr 1112 9,975.00 · Dr 6230 25.00 · Cr 1111 10,000.00
 * G-18  CNT-000001    2026-09-21  Dr 6280 50.00 · Cr 1101 50.00
 * G-19  OWN-000001    2026-09-22  Dr 1111 100,000.00 · Cr 2501 100,000.00 (Sample Owner A)
 * G-20  LOAN-000001   2026-09-22  Dr 1111 495,000.00 · Dr 7201 5,000.00 · Cr 2601 500,000.00 (Sample Bank loan)
 * G-20b LPAY-000001   2026-09-23  Dr 2601 20,000.00 (Sample Bank loan) · Dr 7201 5,000.00 · Cr 1111 25,000.00
 * G-21  FA-000001     2026-09-23  Dr 1510 100,000.00 (Heat press) · Dr 1401 12,000.00 (Sample Machines) · Cr 1111 30,000.00
 *                                 · Cr 2602 82,000.00 (Heat press financing)
 * G-04a COL-000009    2026-09-24  Dr 1101 28,000.00 · Cr 2201 28,000.00 (Test School) · Dr 2209 3,000.00 (Test School)
 *                                 · Cr 2301 3,000.00 (Test School)
 * G-04b IR-000008     2026-09-24  Dr 1201 56,000.00 (Test School) · Cr 4101 50,000.00 · Cr 2301 6,000.00 (Test School)
 *                                 · Dr 2201 28,000.00 (Test School) · Cr 1201 28,000.00 (Test School)
 *                                 · Dr 2301 3,000.00 (Test School) · Cr 2209 3,000.00 (Test School)
 * G-05a IR-000009     2026-09-25  Dr 1201 28,000.00 (Test School) · Cr 2201 25,000.00 (Test School) · Cr 2301 3,000.00 (Test School)
 * G-05b COL-000010    2026-09-25  Dr 1101 28,000.00 · Cr 1201 28,000.00 (Test School)
 * G-05c IR-000010     2026-09-25  Dr 1201 28,000.00 (Test School) · Cr 4101 25,000.00 · Cr 2301 3,000.00 (Test School)
 *                                 · Dr 2201 25,000.00 (Test School) · Cr 4101 25,000.00
 * G-23  CA-000001     2026-09-25  Dr 1210 2,000.00 (Ana Tahi) · Cr 1101 2,000.00
 * G-22  INVC-000001   2026-09-30  Dr 1301 25,000.00 · Cr 5109 25,000.00
 * G-24  PAY-000002    2026-09-30  Dr 6101 7,500.00 · Dr 6102 820.00 · Dr 6103 625.00 · Cr 2401 1,145.00 (Carla Opisina)
 *                                 · Cr 2403 100.00 (Carla Opisina) · Cr 2111 625.00 (Carla Opisina) · Cr 2110 7,075.00 (Carla Opisina)
 * G-23b PAY-000003    2026-09-30  Dr 5202 5,671.88 · Dr 5203 1,032.09 · Dr 5204 458.33 · Cr 2401 835.00 (Ana Tahi)
 *                                 · Cr 2402 717.30 (Ana Tahi) · Cr 2403 226.88 (Ana Tahi) · Cr 1210 1,000.00 (Ana Tahi)
 *                                 · Cr 2111 458.33 (Ana Tahi) · Cr 2110 3,924.79 (Ana Tahi)
 * S-03  POUT-000002   2026-09-30  Dr 2110 7,075.00 (Carla Opisina) · Cr 1101 7,075.00
 * S-04  POUT-000003   2026-09-30  Dr 2110 3,924.79 (Ana Tahi) · Cr 1101 3,924.79
 * M-01  DEPR-000001   2026-09-30  Dr 5302 5,000.00 · Cr 1511 5,000.00 (Embroidery machine) · Dr 5302 1,500.00 · Cr 1511 1,500.00 (Heat press)
 * M-02  CNT-000002    2026-09-30  Dr 1101 20.00 · Cr 6280 20.00
 * M-03  REM-000001    2026-09-30  Dr 2401 2,280.00 (Carla Opisina) · Dr 2401 835.00 (Ana Tahi) · Cr 1111 3,115.00
 * M-04  REM-000002    2026-09-30  Dr 2402 750.00 (Carla Opisina) · Dr 2402 717.30 (Ana Tahi) · Cr 1111 1,467.30
 * M-05  REM-000003    2026-09-30  Dr 2403 400.00 (Carla Opisina) · Dr 2403 226.88 (Ana Tahi) · Cr 1111 626.88
 * M-06  BIRP-000001   2026-09-30  Dr 2311 1,785.71 (Sample Lessor Corp.) · Dr 2311 2,000.00 (Sample Landlord) · Cr 1111 3,785.71
 * M-07  VATC-000001   2026-09-30  Dr 2301 26,051.79 (Test School) · Dr 2301 12,000.00 (Sample City Hall) · Cr 1401 4,285.71 (Sample Lessor Corp.)
 *                                 · Cr 1401 1,200.00 (Sample Fabric Trading) · Cr 1401 12,000.00 (Sample Machines)
 *                                 · Cr 1404 5,000.00 (Sample City Hall) · Cr 2302 15,566.08
 * M-08  BIRP-000002   2026-09-30  Dr 2302 15,566.08 · Cr 1111 15,566.08
 * END JOURNALS
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { runInvariants } from '../src/engine/ledger/invariants.ts';
import { CSV_HEADER, PARTY_ACCOUNTS, chartNames, compareJournals, parseCsv, toCsv, type BlindRow } from '../../../tools/blind.ts';
import { buildPack } from '../../../tools/blind-pack.ts';
import { MONTH_END, STEPS, asBlindRows, money, runMonth, type JournalRow, type Month } from '../../../tools/month-scenario.ts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const TB_CSV = join(ROOT, 'tests/golden/month.tb.csv');

interface Line { code: string; debitCents: number; creditCents: number; party: string }
interface Expected { ref: string; number: string; date: string; kind: 'original' | 'reversal'; lines: Line[] }

const amount = (s: string) => Math.round(Number(s.replace(/,/g, '')) * 100);

/** The hand-worked journals of the comment block above. */
function handJournals(): Expected[] {
  const src = readFileSync(fileURLToPath(import.meta.url), 'utf8');
  const block = src.slice(src.indexOf(' * BEGIN JOURNALS'), src.indexOf(' * END JOURNALS')).split('\n').slice(1).filter((l) => l.trim() !== '');
  const out: Expected[] = [];
  for (const raw of block) {
    const head = /^ \* ([GSM]-\d\d[a-z]?)\s+([A-Z0-9]+-\d{6})(\/rev)?\s+(\d{4}-\d\d-\d\d)\s+(.+)$/.exec(raw);
    const more = /^ \*\s+· (.+)$/.exec(raw);
    if (!head && !more) throw new Error(`Cannot read the journal block line: ${raw}`);
    if (head) out.push({ ref: head[1]!, number: head[2]!, date: head[4]!, kind: head[3] ? 'reversal' : 'original', lines: [] });
    for (const entry of (head ? head[5]! : more![1]!).split(' · ')) {
      const e = /^(Dr|Cr) (\d{4}) ([\d,]+\.\d\d)(?: \(([^)]+)\))?$/.exec(entry.trim());
      if (!e) throw new Error(`Cannot read the journal line "${entry}"`);
      const cents = amount(e[3]!);
      out.at(-1)!.lines.push({ code: e[2]!, debitCents: e[1] === 'Dr' ? cents : 0, creditCents: e[1] === 'Cr' ? cents : 0, party: e[4] ?? '' });
    }
  }
  return out;
}

/** A journal's lines as sorted text, parties on subledger accounts only (D9 L3). */
const text = (lines: Line[]) =>
  lines.map((l) => `${l.debitCents ? 'Dr' : 'Cr'} ${l.code} ${money(l.debitCents || l.creditCents)}${PARTY_ACCOUNTS.has(l.code) && l.party ? ` (${l.party})` : ''}`).sort();

interface TbRow { code: string; name: string; debitCents: number; creditCents: number }
function readTb(): TbRow[] {
  const [head, ...rows] = readFileSync(TB_CSV, 'utf8').trim().split('\n');
  expect(head).toBe('account_code,account_name,debit,credit');
  return rows.map((r) => {
    const m = /^(\d{4}),("(?:[^"]|"")*"|[^,]*),([\d.]+),([\d.]+)$/.exec(r);
    if (!m) throw new Error(`Cannot read the trial balance line: ${r}`);
    return { code: m[1]!, name: m[2]!.replace(/^"|"$/g, '').replace(/""/g, '"'), debitCents: amount(m[3]!), creditCents: amount(m[4]!) };
  });
}

let m: Month;
let journals: JournalRow[];

beforeAll(async () => {
  m = await runMonth();
  journals = await m.journals();
}, 120_000);

describe('month in the life (PLAN I2 G-30)', () => {
  it('the hand-worked journals balance and add up to tests/golden/month.tb.csv', () => {
    const hand = handJournals();
    for (const j of hand) expect(j.lines.reduce((s, l) => s + l.debitCents - l.creditCents, 0), j.ref).toBe(0);
    const sums = new Map<string, number>();
    for (const l of hand.flatMap((j) => j.lines)) sums.set(l.code, (sums.get(l.code) ?? 0) + l.debitCents - l.creditCents);
    const fromHand = [...sums].filter(([, b]) => b !== 0).sort(([a], [b]) => a.localeCompare(b)).map(([code, b]) => [code, Math.max(b, 0), Math.max(-b, 0)]);
    const tb = readTb();
    expect(tb.map((r) => [r.code, r.debitCents, r.creditCents])).toEqual(fromHand);
    const total = (k: 'debitCents' | 'creditCents') => tb.reduce((s, r) => s + r[k], 0);
    expect([total('debitCents'), total('creditCents')]).toEqual([154_950_654, 154_950_654]);
  });

  it('records every document of the month with the journal worked out by hand, dated as planned', async () => {
    const hand = handJournals();
    expect(m.recorded.map((r) => r.ref)).toEqual(hand.map((j) => j.ref));
    expect(STEPS.flatMap((s) => s.refs)).toEqual(hand.map((j) => j.ref));
    for (const j of hand) {
      const r = m.doc(j.ref);
      expect([r.number, r.date, r.kind], j.ref).toEqual([j.number, j.date, j.kind]);
      const app = journals.filter((x) => x.ref === j.ref).map((x) => ({ code: x.accountCode, debitCents: x.debitCents, creditCents: x.creditCents, party: x.party }));
      expect(text(app), `${j.ref} ${j.number}`).toEqual(text(j.lines));
    }
    // A party the scenario did not name would show as "unlabelled": every party on a subledger line is one we know.
    expect(journals.filter((x) => x.party.startsWith('unlabelled'))).toEqual([]);
  });

  it('G-27: the opening trial balance is 506,000.00 each side and opening balance equity is zero', async () => {
    const tb = await m.get(`/api/rpt/trial-balance?asOf=2026-08-31`);
    expect([tb.totalDebitCents, tb.totalCreditCents]).toEqual([50_600_000, 50_600_000]);
    expect(tb.rows.find((r: { code: string }) => r.code === '3900')).toBeUndefined();
    expect((await m.get('/api/acc/opening')).closed).toMatchObject({ cutoverDate: '2026-08-31', totalDebitCents: 50_600_000, totalCreditCents: 50_600_000 });
  });

  it('refuses the 0619-E of a third month, posting nothing', () => {
    expect(m.refusals.map((r) => [r.step, r.code])).toEqual([['0619-E', 'THIRD_MONTH']]);
    expect(m.refusals[0]!.message).toBe('September 2026 is the last month of Q3 2026, which has no 0619-E: its EWT is paid with the 1601-EQ for the quarter.');
  });

  it('G-04 and G-05 end as PLAN I2 says: each job order owes 28,000.00, 2209 and their deposits are zero, and the sales register ties to 2301', async () => {
    for (const jo of [m.ids.jo8!, m.ids.jo9!]) {
      expect((await m.get(`/api/jo/orders/${jo}/status`)).money).toMatchObject({ totalCents: 5_600_000, invoicedCents: 5_600_000, receivableCents: 2_800_000, depositsHeldCents: 0, balanceDueCents: 2_800_000 });
    }
    const tb = await m.get(`/api/rpt/trial-balance?asOf=2026-09-25`);
    expect(tb.rows.find((r: TbRow) => r.code === '2209')).toBeUndefined();
    // Before the VAT close: G-04 and G-05 each add 6,000.00 of output VAT and 50,000.00 of VATable sales.
    const register = await m.get('/api/tax/registers/sales?from=2026-09-24&to=2026-09-25');
    expect([register.totals.netCents, register.totals.vatCents, register.glVatCents]).toEqual([10_000_000, 1_200_000, 1_200_000]);
  });

  it('ends on the trial balance of tests/golden/month.tb.csv, to the centavo, account names included', async () => {
    const tb = await m.get(`/api/rpt/trial-balance?asOf=${MONTH_END}`);
    expect(tb.rows.map((r: TbRow) => ({ code: r.code, name: r.name, debitCents: r.debitCents, creditCents: r.creditCents }))).toEqual(readTb());
    expect([tb.totalDebitCents, tb.totalCreditCents]).toEqual([154_950_654, 154_950_654]);
  });

  it('keeps every D9 invariant', () => {
    expect(runInvariants(m.env.db).filter((r) => !r.ok)).toEqual([]);
  });

  it('ties every subledger to its control account', async () => {
    const tb = await m.get(`/api/rpt/trial-balance?asOf=${MONTH_END}`);
    const bal = (code: string) => {
      const r = tb.rows.find((x: TbRow) => x.code === code);
      return r ? r.debitCents - r.creditCents : 0;
    };
    const sum = <T>(xs: T[], f: (x: T) => number) => xs.reduce((s, x) => s + f(x), 0);
    // Each control account equals the sum of its parties' balances, and none is left without a party (D9 L3).
    for (const code of new Set(journals.map((j) => j.accountCode).filter((c) => PARTY_ACCOUNTS.has(c)))) {
      const lines = journals.filter((j) => j.accountCode === code);
      expect(lines.filter((l) => !l.party), code).toEqual([]);
      expect(sum(lines, (l) => l.debitCents - l.creditCents), code).toBe(bal(code));
    }
    // The subledgers the modules keep: receivables, deposits, payables, cash advances, loans and assets.
    expect((await m.get(`/api/rpt/ar-aging?asOf=${MONTH_END}`)).totalCents).toBe(bal('1201'));
    expect((await m.get(`/api/rpt/deposits-held?asOf=${MONTH_END}`)).totalCents).toBe(-bal('2201'));
    expect(sum(await m.get('/api/ap/suppliers'), (s: { balanceCents: number }) => s.balanceCents)).toBe(-bal('2101'));
    expect(sum(await m.get('/api/ca/employees'), (e: { owedCents: number }) => e.owedCents)).toBe(bal('1210'));
    expect(sum(await m.get('/api/loan/loans'), (l: { balanceCents: number }) => l.balanceCents)).toBe(-bal('2601'));
    expect(sum(await m.get('/api/loan/financed-assets'), (l: { financedCents: number }) => l.financedCents)).toBe(-bal('2602')); // nothing repaid yet
    const assets = await m.get<{ costCents: number; accumulatedCents: number }[]>('/api/fa/assets');
    expect([sum(assets, (a) => a.costCents), sum(assets, (a) => a.accumulatedCents)]).toEqual([bal('1510'), -bal('1511')]);
    // What the month leaves open, as worked out by hand.
    expect([bal('1201'), bal('2201'), bal('2101'), bal('1210'), bal('2601'), bal('2602'), bal('1511')]).toEqual([13_680_000, -3_500_000, -620_000, 100_000, -68_000_000, -8_200_000, -650_000]);
  });
});

describe('blind recompute (PLAN I1 item 8)', () => {
  const names = chartNames(ROOT);

  it("finds no difference in a copy of the app's own journals", () => {
    const app = asBlindRows(journals);
    const copy = parseCsv(toCsv(app));
    expect(copy).toEqual(app);
    expect(compareJournals(app, copy, names)).toEqual([]);
  });

  it('names the one line that differs', () => {
    const app = asBlindRows(journals);
    const theirs = parseCsv(toCsv(app).replace('G-13,2,1401,4285.71', 'G-13,2,1401,4285.72'));
    expect(compareJournals(app, theirs, names)).toEqual([
      'G-13: the app debits 1401 Input VAT – current quarter ₱4,285.71 (Sample Lessor Corp.); theirs debits ₱4,285.72, ₱0.01 more.',
    ]);
  });

  it('names a missing journal, an extra one, a wrong party, and a tax line whose base × rate is off', () => {
    const app = asBlindRows(journals);
    const rows: BlindRow[] = app.filter((r) => r.docRef !== 'G-16').map((r) => (r.docRef === 'G-19' && r.accountCode === '2501' ? { ...r, party: 'Someone Else' } : r));
    rows.push({ docRef: 'X-01', line: 1, accountCode: '1101', debitCents: 100, creditCents: 0, party: '', taxKind: '', baseCents: null, rateBp: null });
    const g13 = rows.findIndex((r) => r.docRef === 'G-13' && r.accountCode === '2311');
    rows[g13] = { ...rows[g13]!, baseCents: 3_571_429, rateBp: 500 }; // 5% of 35,714.29 = 1,785.71: agrees
    const g14 = rows.findIndex((r) => r.docRef === 'G-14' && r.accountCode === '2311');
    rows[g14] = { ...rows[g14]!, baseCents: 3_571_429, rateBp: 500 }; // but G-14's lessor is not VAT-registered: 5% of the gross
    expect(compareJournals(app, rows, names)).toEqual([
      "G-14 line 2 (2311 Expanded withholding tax payable): their base ₱35,714.29 × 5% is ₱1,785.71, but the line says ₱2,000.00.",
      'G-16: their CSV has no journal; the app posts Dr 6140 Transportation and travel ₱200.00, Cr 1102 Petty cash fund ₱200.00.',
      'X-01: their CSV has a journal the app does not post for this reference.',
      'G-19: the app credits 2501 Due to officers and stockholders ₱100,000.00 (Sample Owner A); theirs has no such credit.',
      'G-19: theirs credits 2501 Due to officers and stockholders ₱100,000.00 (Someone Else); the app has no such credit.',
    ]);
  });

  it('reads their CSV strictly', () => {
    expect(() => parseCsv('doc_ref,line,account\nG-01,1,1101')).toThrow(`The first line must be the header: ${CSV_HEADER}`);
    expect(() => parseCsv(`${CSV_HEADER}\nG-01,1,1101,28000.00,28000.00,,,,`)).toThrow('CSV line 2: put the amount in debit or in credit, not both and not neither.');
    expect(() => parseCsv(`${CSV_HEADER}\nG-01,1,11O1,28000.00,,,,,`)).toThrow('CSV line 2: account_code "11O1" is not a 4-digit account code.');
    expect(() => parseCsv(`${CSV_HEADER}\nG-01,1,1101,28 000,,,,,`)).toThrow('CSV line 2: "28 000" is not an amount in pesos.');
    expect(parseCsv(`﻿${CSV_HEADER}\r\nG-01,1,1101,"28,000.00",,,,,\r\nG-01,2,2201,,₱28000,Test School,,,\r\n`)).toEqual([
      { docRef: 'G-01', line: 1, accountCode: '1101', debitCents: 2_800_000, creditCents: 0, party: '', taxKind: '', baseCents: null, rateBp: null },
      { docRef: 'G-01', line: 2, accountCode: '2201', debitCents: 0, creditCents: 2_800_000, party: 'Test School', taxKind: '', baseCents: null, rateBp: null },
    ]);
  });

  it('npm run compare-blind exits 0 on no difference and 1 naming the difference', () => {
    const dir = mkdtempSync(join(tmpdir(), 'blind-'));
    const appCsv = join(dir, 'app.csv');
    writeFileSync(appCsv, toCsv(asBlindRows(journals)));
    const theirs = join(dir, 'theirs.csv');
    const run = () => {
      try {
        return { code: 0, out: execFileSync(process.execPath, ['--import', 'tsx', join(ROOT, 'tools/compare-blind.ts'), theirs, '--app', appCsv], { cwd: ROOT, encoding: 'utf8' }) };
      } catch (e) {
        const err = e as { status: number; stdout: string };
        return { code: err.status, out: err.stdout };
      }
    };
    writeFileSync(theirs, readFileSync(appCsv, 'utf8'));
    expect(run()).toMatchObject({ code: 0, out: expect.stringContaining('No differences') });
    writeFileSync(theirs, readFileSync(appCsv, 'utf8').replace('G-17,2,6230,25.00', 'G-17,2,6230,52.00').replace('G-17,1,1112,9975.00', 'G-17,1,1112,9948.00'));
    const r = run();
    expect(r.code).toBe(1);
    expect(r.out).toContain('G-17: the app debits 6230 Bank and e-wallet charges ₱25.00; theirs debits ₱52.00, ₱27.00 more.');
  }, 30_000);

  it('the committed blind pack is what npm run blind-pack writes', () => {
    for (const [file, content] of Object.entries(buildPack())) {
      expect(readFileSync(join(ROOT, 'docs/review/blind-recompute', file), 'utf8'), file).toBe(content);
    }
  });
});
