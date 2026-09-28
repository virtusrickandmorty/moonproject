/**
 * VAT position of a quarter (research vat-cwt-ewt §3.8 R46): what the quarterly VAT close takes out of 2301 output VAT,
 * 1401 input VAT, 1404 VAT withheld and 1402 input VAT carried over, per customer or supplier.
 * A VAT account's closable balance for quarter Q is every line dated up to Q's last day, except the lines of VAT
 * closes, plus the lines of the closes of earlier quarters and their reversals. So a close posted after its quarter
 * ended never leaks into the next quarter, a cancelled close counts for nothing, and an item dated in an earlier
 * quarter but posted after that quarter was closed (a late journal voucher) is swept into the next close: the
 * next-quarter treatment (Q-V6). The `earlier…` figures say how much of that there is.
 * VAT withheld is claimed only with the 2307 in hand; what still waits for its certificate stays in 1404.
 */
import type { Db } from '../../platform/db/driver.ts';
import { quarterRange, vatReturnDue, type Quarter } from './calendar.ts';
import { withholdingReceivedRegister } from './registers.ts';

export interface PartyAmount { partyType: 'customer' | 'supplier'; partyId: string; cents: number }

type Role = 'OUTPUT_VAT' | 'INPUT_VAT' | 'VAT_WITHHELD' | 'INPUT_VAT_CARRYOVER';
const SIGN = { credit: 'l.credit_cents - l.debit_cents', debit: 'l.debit_cents - l.credit_cents' };
const JOIN = `FROM journal_lines l JOIN journals j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
  LEFT JOIN tax_vat_closes c ON c.document_id = j.source_id AND j.source_type = 'document'`;

/** Closable balance of the account with this role for quarter (year, quarter), per party, on its normal side. */
function closable(db: Db, role: Role, side: 'credit' | 'debit', year: number, quarter: Quarter): { partyType: string | null; partyId: string | null; cents: number }[] {
  return db
    .prepare(
      `SELECT l.party_type AS partyType, l.party_id AS partyId, SUM(${SIGN[side]}) AS cents ${JOIN}
       WHERE j.sealed = 1 AND a.role_key = @role
         AND ((c.document_id IS NULL AND j.business_date <= @to) OR c.year * 4 + c.quarter < @key)
       GROUP BY l.party_type, l.party_id HAVING cents <> 0 ORDER BY l.party_type, l.party_id`,
    )
    .all({ role, to: quarterRange(year, quarter).to, key: year * 4 + quarter }) as { partyType: string | null; partyId: string | null; cents: number }[];
}

/** The quarter's own movement on the account, VAT closes left out. */
function movement(db: Db, role: Role, side: 'credit' | 'debit', year: number, quarter: Quarter): number {
  const { from, to } = quarterRange(year, quarter);
  return db
    .prepare(`SELECT COALESCE(SUM(${SIGN[side]}), 0) ${JOIN} WHERE j.sealed = 1 AND a.role_key = ? AND c.document_id IS NULL AND j.business_date BETWEEN ? AND ?`)
    .pluck()
    .get(role, from, to) as number;
}

const sum = (xs: { cents: number }[]) => xs.reduce((s, x) => s + x.cents, 0);
const withParty = (rows: ReturnType<typeof closable>, type: 'customer' | 'supplier'): PartyAmount[] =>
  rows.map((r) => ({ partyType: type, partyId: r.partyId ?? '', cents: r.cents }));

export function vatPosition(db: Db, year: number, quarter: Quarter) {
  const { from, to } = quarterRange(year, quarter);
  const output = withParty(closable(db, 'OUTPUT_VAT', 'credit', year, quarter), 'customer');
  const input = withParty(closable(db, 'INPUT_VAT', 'debit', year, quarter), 'supplier');

  // VAT withheld still waiting for its 2307, per customer: collections up to the quarter's end, not cancelled.
  const pendingBy = new Map<string, number>();
  for (const r of withholdingReceivedRegister(db, '0000-01-01', to).rows) {
    if (r.posting === 'original' && r.documentStatus === 'posted' && r.certificate === 'pending' && r.customerId && r.vatWithheldCents) {
      pendingBy.set(r.customerId, (pendingBy.get(r.customerId) ?? 0) + r.vatWithheldCents);
    }
  }
  const held = withParty(closable(db, 'VAT_WITHHELD', 'debit', year, quarter), 'customer');
  const withheld = held.map((h) => ({ ...h, cents: Math.max(h.cents - (pendingBy.get(h.partyId) ?? 0), 0) })).filter((h) => h.cents > 0);

  const outputVatCents = sum(output);
  const inputVatCents = sum(input);
  const vatWithheldCents = sum(withheld);
  const carryOverCents = sum(closable(db, 'INPUT_VAT_CARRYOVER', 'debit', year, quarter));
  const netCents = outputVatCents - inputVatCents - vatWithheldCents - carryOverCents;
  return {
    year, quarter, from, to,
    output, input, withheld,
    outputVatCents, inputVatCents, vatWithheldCents,
    /** VAT withheld whose 2307 is not in hand yet: stays in 1404 for the quarter the certificate comes. */
    vatWithheldPendingCents: sum(held) - vatWithheldCents,
    carryOverCents,
    /** Output and input VAT dated in earlier quarters but not closed with them, included in the figures above. */
    earlierOutputVatCents: outputVatCents - movement(db, 'OUTPUT_VAT', 'credit', year, quarter),
    earlierInputVatCents: inputVatCents - movement(db, 'INPUT_VAT', 'debit', year, quarter),
    payableCents: Math.max(netCents, 0),
    carryForwardCents: Math.max(-netCents, 0),
  };
}
export type VatPosition = ReturnType<typeof vatPosition>;

/** The posted VAT close of a quarter, if any. */
export function vatCloseOf(db: Db, year: number, quarter: Quarter): { documentId: string; number: string; date: string } | undefined {
  return db
    .prepare(
      `SELECT d.id AS documentId, d.number, d.business_date AS date FROM tax_vat_closes c JOIN documents d ON d.id = c.document_id
       WHERE c.year = ? AND c.quarter = ? AND d.status = 'posted'`,
    )
    .get(year, quarter) as { documentId: string; number: string; date: string } | undefined;
}

/**
 * VAT for one quarter (the accountant home's "VAT this quarter", PLAN E13; the figures the quarterly VAT close posts).
 * Positive: payable with the 2550Q; negative: carried over to the next quarter. An estimate until the close is posted.
 */
export function vatSummary(db: Db, year: number, quarter: Quarter) {
  const { output: _o, input: _i, withheld: _w, ...p } = vatPosition(db, year, quarter);
  return { ...p, returnDue: vatReturnDue(db, year, quarter), close: vatCloseOf(db, year, quarter) ?? null };
}
