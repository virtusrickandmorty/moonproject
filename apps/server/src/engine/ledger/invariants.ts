/**
 * Engine invariants (PLAN D9). Each returns a list of problems; empty means OK.
 * Run by tests after every scenario and, later, nightly on System Health.
 */
import type { Db } from '../../platform/db/driver.ts';
import { verifyAuditChain } from '../audit.ts';

export interface InvariantResult {
  id: string;
  ok: boolean;
  problems: string[];
}

function check(id: string, problems: string[]): InvariantResult {
  return { id, ok: problems.length === 0, problems };
}

export function runInvariants(db: Db): InvariantResult[] {
  const out: InvariantResult[] = [];

  // L1: every journal balances, every journal is sealed, and the TB balances.
  const unbalanced = db
    .prepare(
      `SELECT j.number FROM journals j LEFT JOIN journal_lines l ON l.journal_id = j.id
       GROUP BY j.id HAVING COALESCE(SUM(l.debit_cents),0) <> COALESCE(SUM(l.credit_cents),0) OR COUNT(l.id) < 2 OR MAX(j.sealed) = 0`,
    )
    .all() as { number: string }[];
  out.push(check('L1', unbalanced.map((r) => `Journal ${r.number} is unbalanced or unsealed`)));

  // L2: no line on a header, non-postable or inactive-at-post account (inactive checked at insert by trigger).
  const badAcc = db
    .prepare(`SELECT j.number, a.code FROM journal_lines l JOIN journals j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id WHERE a.is_header = 1 OR a.is_postable = 0`)
    .all() as { number: string; code: string }[];
  out.push(check('L2', badAcc.map((r) => `Journal ${r.number} posts to ${r.code}`)));

  // L3: subledger accounts carry the right party type.
  const badParty = db
    .prepare(
      `SELECT j.number, a.code FROM journal_lines l JOIN journals j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
       WHERE (a.party_type IS NOT NULL AND a.party_type <> 'free' AND (l.party_type IS NULL OR l.party_type <> a.party_type))
          OR (a.party_type IS NULL AND l.party_type IS NOT NULL)`,
    )
    .all() as { number: string; code: string }[];
  out.push(check('L3', badParty.map((r) => `Journal ${r.number} line on ${r.code} has a wrong or missing party`)));

  // L4: posted money documents have one original journal; cancelled ones also one reversal netting to zero
  // per account, party and document reference.
  const l4: string[] = [];
  const docs = db
    .prepare(
      `SELECT d.id, d.number, d.status,
         (SELECT COUNT(*) FROM journals j WHERE j.source_type = 'document' AND j.source_id = d.id AND j.posting_kind = 'original') AS orig,
         (SELECT COUNT(*) FROM journals j WHERE j.source_type = 'document' AND j.source_id = d.id AND j.posting_kind = 'reversal') AS rev
       FROM documents d`,
    )
    .all() as { id: string; number: string; status: string; orig: number; rev: number }[];
  for (const d of docs) {
    if (d.orig === 0) continue; // non-posting document types
    if (d.status === 'posted' && d.rev !== 0) l4.push(`${d.number} is posted but has a reversal`);
    if (d.status === 'cancelled' && d.rev !== 1) l4.push(`${d.number} is cancelled without exactly one reversal`);
  }
  const notNetting = db
    .prepare(
      `SELECT j.source_id, l.account_id, l.party_type, l.party_id, l.ref_doc_id, SUM(l.debit_cents - l.credit_cents) AS net
       FROM journal_lines l JOIN journals j ON j.id = l.journal_id
       WHERE j.source_type = 'document' AND j.source_id IN (SELECT id FROM documents WHERE status = 'cancelled')
       GROUP BY j.source_id, l.account_id, l.party_type, l.party_id, l.ref_doc_id HAVING net <> 0`,
    )
    .all() as { source_id: string }[];
  for (const r of notNetting) l4.push(`Cancelled document ${r.source_id} does not net to zero`);
  out.push(check('L4', l4));

  // L7: document numbers are gapless per series (numbers end in their sequence digits).
  const l7: string[] = [];
  const series = db.prepare('SELECT series_key, prefix, next_value, pad FROM number_series').all() as { series_key: string; prefix: string; next_value: number; pad: number }[];
  for (const s of series) {
    const table = s.series_key.startsWith('JE-') ? 'journals' : 'documents';
    const where = table === 'journals' ? 'number LIKE ?' : 'series_key = ?';
    const arg = table === 'journals' ? `${s.prefix}%` : s.series_key;
    const nums = (db.prepare(`SELECT number FROM ${table} WHERE ${where}`).all(arg) as { number: string }[])
      .map((r) => Number(r.number.slice(s.prefix.length)))
      .sort((a, b) => a - b);
    const expected = Array.from({ length: s.next_value - 1 }, (_, i) => i + 1);
    if (nums.length !== expected.length || nums.some((n, i) => n !== expected[i])) {
      l7.push(`Series ${s.series_key} has gaps or extra numbers (next ${s.next_value}, found ${nums.length})`);
    }
  }
  out.push(check('L7', l7));

  // L12: audit chain.
  const broken = verifyAuditChain(db);
  out.push(check('L12', broken === null ? [] : [`Audit chain breaks at entry ${broken}`]));

  return out;
}
