/**
 * npm run blind-pack: writes docs/review/blind-recompute/, the pack the owner gives ChatGPT and Gemini for the blind
 * recompute (PLAN I1 item 8): the month's inputs as plain tables (each document, its date, amounts and choices; no
 * journals), PLAN Part D (and Part F, for the payroll figures) copied as they are, and the CSV header to answer in.
 * Their answer goes to `npm run compare-blind -- <their.csv>`.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CSV_HEADER, PARTY_ACCOUNTS, TAX_KINDS } from './blind.ts';
import { CUTOVER, MONTH_END, STEPS } from './month-scenario.ts';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const PACK_DIR = 'docs/review/blind-recompute';

/** A part of PLAN.md, from its "# X." heading to the next part's, without the closing rule. */
function planPart(letter: string): string {
  const plan = readFileSync(join(ROOT, 'docs/PLAN.md'), 'utf8');
  const start = plan.indexOf(`\n# ${letter}. `);
  const end = plan.indexOf('\n# ', start + 1);
  if (start < 0 || end < 0) throw new Error(`PLAN.md has no part ${letter}`);
  return plan.slice(start + 1, end).replace(/\n---\s*$/, '').trimEnd() + '\n';
}

const cell = (s: string) => s.replace(/\|/g, '\\|');

function scenario(): string {
  const out = [
    '# The month: inputs',
    '',
    `Virtus Garments, Inc. starts its books in the new system on the cut-over date, ${CUTOVER}, and then records one month, September 2026, which`,
    `ends the third quarter. The tables list every document in the order it is recorded, with its date, the amounts and the choices typed on it.`,
    'They give no journals: working those out is your task. Rows marked "—" record no journal and are there for the facts they give.',
    '',
  ];
  for (const s of STEPS) {
    if (s.notInPack) continue;
    out.push(`## ${s.date}: ${s.title}`, '', '| doc_ref | Document and facts |', '|---|---|');
    for (const f of s.facts) {
      const ref = /^([GSM]-\d\d[a-z]?)\b/.exec(f)?.[1];
      out.push(`| ${ref ?? '—'} | ${cell(f)} |`);
    }
    out.push('');
  }
  const left = [...new Set(STEPS.filter((s) => s.notInPack).map((s) => s.notInPack!))];
  out.push('## Not in this scenario', '', ...left.map((l) => `- ${l}`), '');
  return out.join('\n');
}

function readme(): string {
  return [
    '# Blind recompute: instructions for the reviewer',
    '',
    'You are checking the accounting of Moonproject, the ERP of a made-to-order garment shop in the Philippines, without seeing what it posts.',
    '',
    '1. Read `part-d.md` (PLAN Part D, the accounting rules; it is binding) and, for the payroll figures, `part-f.md` (PLAN Part F).',
    `2. Read \`scenario.md\`: the opening balances on ${CUTOVER} and every document of September 2026, to ${MONTH_END}, in order.`,
    '3. Work out every journal the rules require, to the centavo, and answer in one CSV file in the format of `answer.csv`.',
    '',
    '## The CSV',
    '',
    '```',
    CSV_HEADER,
    '```',
    '',
    '- One row per journal line. `doc_ref` is the reference in the first column of the scenario tables (G-02, G-12r, M-07, ...); a document with two journals has two references there.',
    '- `line`: 1, 2, 3 ... within the journal.',
    '- `account_code`: the 4-digit code of PLAN D2.',
    '- `debit`, `credit`: pesos with two decimals and no peso sign, like `28000.00`; leave the other one empty.',
    `- \`party\`: only on lines of these accounts: ${[...PARTY_ACCOUNTS].join(', ')}. Use the name the scenario gives: the customer, supplier, one-off payee, employee, stockholder, loan (for example "Sample Bank loan", "Heat press financing") or fixed asset (for example "Heat press"). Leave it empty on every other account, cash accounts included.`,
    `- \`tax_kind\`: on tax lines only, one of ${TAX_KINDS.join(', ')}.`,
    '- `base`, `rate`: optional, on tax lines: the amount the tax was worked on (pesos) and its rate in percent (like `12` or `5`).',
    '- No other rows, no totals. Keep separate lines where Part D keeps them (for example a debit and a credit on the same account in one journal).',
    '',
    'Your answer is compared line by line with the ERP\'s journals (`npm run compare-blind -- <your.csv>`); every difference is listed in plain words.',
    '',
  ].join('\n');
}

/** Every file of the pack, by name. */
export function buildPack(): Record<string, string> {
  return {
    'README.md': readme(),
    'scenario.md': scenario(),
    'part-d.md': `<!-- Copied from docs/PLAN.md by npm run blind-pack. -->\n${planPart('D')}`,
    'part-f.md': `<!-- Copied from docs/PLAN.md by npm run blind-pack. -->\n${planPart('F')}`,
    'answer.csv': `${CSV_HEADER}\n`,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const dir = join(ROOT, PACK_DIR);
  mkdirSync(dir, { recursive: true });
  for (const [file, content] of Object.entries(buildPack())) writeFileSync(join(dir, file), content);
  console.log(`Wrote ${PACK_DIR}/: ${Object.keys(buildPack()).join(', ')}.`);
}
