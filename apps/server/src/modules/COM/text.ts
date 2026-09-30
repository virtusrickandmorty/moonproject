/**
 * Email wording (PLAN E14, C9): plain English, always in the company's registered name. The same rule as the prints
 * (NR-14): no subject, body or file name says "Invoice" or "Official Receipt". Names and item descriptions typed by
 * staff go through `plain` first, so a customer named "Invoice Printing Co" cannot stop an email; what is left is
 * checked once more over the whole message, and a message that fails is never queued.
 */
import { formatPeso } from '@moonproject/shared';

export const FORBIDDEN_WORDS: readonly RegExp[] = [/invoice/i, /official[\s_-]*receipt/i];

/** The extension of the print allowlist check (PRT print.ts) to email subjects, bodies and file names. */
export function forbiddenWord(...texts: (string | null | undefined)[]): string | undefined {
  for (const text of texts) for (const rule of FORBIDDEN_WORDS) { const hit = text?.match(rule); if (hit) return hit[0]; }
  return undefined;
}

export function assertAllowedWording(m: { subject: string; body: string; attachmentName?: string | null }): void {
  const bad = forbiddenWord(m.subject, m.body, m.attachmentName);
  if (bad) throw new Error(`The email says "${bad}", which no customer email may say.`);
}

/** Text typed by staff (a name, an item), safe to put in a message. */
export const plain = (text: string): string => FORBIDDEN_WORDS.reduce((t, rule) => t.replace(new RegExp(rule.source, 'gi'), '…'), text).replace(/\s+/g, ' ').trim();

export type Template = 'job_order_created' | 'job_order_ready' | 'claimed' | 'statement' | 'payslip';
export const TEMPLATES: readonly Template[] = ['job_order_created', 'job_order_ready', 'claimed', 'statement', 'payslip'];
/** A customer email goes to a customer; a payslip email goes to an employee. The outbox screen filters by this. */
export type Kind = 'customer' | 'payslip';
export const kindOf = (template: Template): Kind => (template === 'payslip' ? 'payslip' : 'customer');
export interface Message { subject: string; body: string }

const hello = (name: string) => `Hello ${plain(name)},`;
const items = (lines: { description: string; qty: number }[]) => lines.map((l) => `  - ${l.qty} x ${plain(l.description)}`).join('\n');
const sign = (company: string) => `Thank you,\n${company}`;
const footer = (company: string) => `You are getting this email because you agreed to receive emails from ${company}. Reply to it if you would rather not.`;
const wrap = (company: string, parts: string[]) => `${parts.join('\n\n')}\n\n${footer(company)}\n`;

export function createdMessage(company: string, p: { customerName: string; number: string; dueDate: string; totalCents: number; requiredDownpaymentCents: number; lines: { description: string; qty: number }[] }): Message {
  return {
    subject: `${company}: we have received your order ${p.number}`,
    body: wrap(company, [
      hello(p.customerName),
      `Thank you for your order. ${company} has recorded job order ${p.number}.`,
      `What we will make for you:\n${items(p.lines)}`,
      `Promised date: ${p.dueDate}\nTotal: ${formatPeso(p.totalCents)}${p.requiredDownpaymentCents > 0 ? `\nDownpayment asked: ${formatPeso(p.requiredDownpaymentCents)}` : ''}`,
      'If anything here looks wrong, please reply to this email or tell the shop.',
      sign(company),
    ]),
  };
}

export function readyMessage(company: string, p: { customerName: string; number: string; balanceDueCents: number }): Message {
  return {
    subject: `${company}: your order ${p.number} is ready for pick-up`,
    body: wrap(company, [
      hello(p.customerName),
      `Good news: everything in job order ${p.number} is finished and ready for pick-up at ${company}.`,
      p.balanceDueCents > 0 ? `The balance to pay when you pick it up is ${formatPeso(p.balanceDueCents)}.` : 'Nothing more is due on this order.',
      'Please come by during shop hours. If someone else will pick it up for you, please tell us first.',
      sign(company),
    ]),
  };
}

export function claimedMessage(company: string, p: { customerName: string; jobOrderNumber: string; releaseNumber: string; date: string; claimedBy: string; balanceDueCents: number; lines: { description: string; qty: number }[] }): Message {
  return {
    subject: `${company}: your order ${p.jobOrderNumber} has been picked up`,
    body: wrap(company, [
      hello(p.customerName),
      `This is to confirm that on ${p.date} ${plain(p.claimedBy)} picked up the following from job order ${p.jobOrderNumber} (release slip ${p.releaseNumber}):\n${items(p.lines)}`,
      p.balanceDueCents > 0 ? `The balance still due is ${formatPeso(p.balanceDueCents)}.` : 'Nothing more is due on this release.',
      'If you did not expect this, please tell us right away.',
      sign(company),
    ]),
  };
}

export function statementMessage(company: string, p: { customerName: string; from: string; to: string; closingBalanceCents: number; depositsHeldCents: number; fileName: string }): Message {
  return {
    subject: `${company}: your statement of account, ${p.from} to ${p.to}`,
    body: wrap(company, [
      hello(p.customerName),
      `Attached (${p.fileName}) is your statement of account from ${p.from} to ${p.to}. Open it in your web browser.`,
      `Balance you owe us on ${p.to}: ${formatPeso(p.closingBalanceCents)}${p.depositsHeldCents > 0 ? `\nDeposits we are holding for you: ${formatPeso(p.depositsHeldCents)}` : ''}`,
      'If anything here does not match your records, please reply to this email.',
      sign(company),
    ]),
  };
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** "16 to 30 September 2026", "28 September to 4 October 2026" or "28 December 2026 to 3 January 2027" from two business dates. */
export function periodWords(from: string, to: string): string {
  const part = (d: string) => ({ y: d.slice(0, 4), m: MONTHS[Number(d.slice(5, 7)) - 1]!, d: String(Number(d.slice(8, 10))) });
  const a = part(from), b = part(to);
  if (a.y !== b.y) return `${a.d} ${a.m} ${a.y} to ${b.d} ${b.m} ${b.y}`;
  if (a.m !== b.m) return `${a.d} ${a.m} to ${b.d} ${b.m} ${b.y}`;
  return `${a.d} to ${b.d} ${b.m} ${b.y}`;
}

/**
 * The payslip email. It says who it is for, the pay period and that the payslip is attached: no pay figure, not even the
 * net pay, is in the subject or the text. The figures are in the attached payslip only.
 */
export function payslipMessage(company: string, p: { employeeName: string; from: string; to: string; fileName: string }): Message {
  const period = periodWords(p.from, p.to);
  return {
    subject: `Payslip for ${period}`,
    body: wrap(company, [
      hello(p.employeeName),
      `Attached (${p.fileName}) is your payslip for ${period}. Open it in your web browser. It has your pay and deductions for the period.`,
      'Please keep it private. If anything on it looks wrong, tell the office and do not reply with your pay details.',
      sign(company),
    ]),
  };
}
