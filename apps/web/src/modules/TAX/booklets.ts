import type { BookletInput, BookletUsage } from '../../api.ts';

export interface BookletFields {
  kind: BookletInput['kind']; atpNo: string; printer: string; serialFrom: string; serialTo: string; receivedOn: string; note: string;
}

const serial = (s: string) => /^\d+$/.test(s.trim()) && Number.isSafeInteger(Number(s)) && Number(s) >= 1 && Number(s) <= 999_999_999_999;

export function bookletInput(fields: BookletFields): { input?: BookletInput; errors: string[] } {
  const errors: string[] = [];
  const atpNo = fields.atpNo.trim();
  const printer = fields.printer.trim();
  const note = fields.note.trim();
  const from = Number(fields.serialFrom);
  const to = Number(fields.serialTo);
  const [year, month, day] = fields.receivedOn.split('-').map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  if (atpNo.length < 3 || atpNo.length > 40) errors.push('Type the ATP number (3 to 40 characters).');
  if (printer && (printer.length < 2 || printer.length > 120)) errors.push('Type the printer name (2 to 120 characters), or leave it blank.');
  if (!serial(fields.serialFrom) || !serial(fields.serialTo)) errors.push('Type the first and last serial numbers as whole numbers.');
  else if (to < from || to - from >= 100_000) errors.push('Check the range: the last number must be later and no more than 100,000 forms can be registered.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fields.receivedOn) || date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) errors.push('Pick the date the booklet was received.');
  if (note.length > 300) errors.push('Keep the note within 300 characters.');
  return { errors, ...(errors.length ? {} : { input: { kind: fields.kind, atpNo, serialFrom: from, serialTo: to, receivedOn: fields.receivedOn, ...(printer ? { printer } : {}), ...(note ? { note } : {}) } }) };
}

/** The API limits its preview to 200 gaps. The detail includes every used number, so all gaps can be shown in pages here. */
export function skippedNumbers(usage: BookletUsage): number[] {
  if (usage.lastUsed === null) return [];
  const used = new Set(usage.used.map((line) => line.n));
  const gaps: number[] = [];
  for (let n = usage.booklet.serialFrom; n < usage.lastUsed; n++) if (!used.has(n)) gaps.push(n);
  return gaps;
}

export const documentLink = (docType: string, id: string) => `/docs/${encodeURIComponent(docType)}/${encodeURIComponent(id)}`;
