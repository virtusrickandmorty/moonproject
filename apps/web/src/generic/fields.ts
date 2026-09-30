/**
 * Turns a doc type's input JSON schema (from GET /api/doc-types) into form fields, and typed text into
 * input and back. Pure, so it is tested without a browser.
 * Conventions: cashPlaceId or *CashPlaceId = a cash place picked with big buttons (PLAN H2), *Cents = a peso amount.
 * A schema field's `title` (zod .meta({ title })) overrides the label. A union of literals (`anyOf` of consts, e.g. a
 * VAT close's quarter 1 to 4) is a choice like an enum. A string with format "date" (zod .meta({ format: 'date' })) is
 * a date picked from a calendar.
 */
import { formatPesos, parsePesos } from '@moonproject/shared';
import type { JsonSchema } from '../api.ts';

export type FieldKind = 'cashPlace' | 'money' | 'integer' | 'date' | 'text' | 'longText' | 'boolean' | 'choice' | 'unsupported';
export interface FieldSpec { name: string; label: string; kind: FieldKind; required: boolean; options?: string[]; numeric?: boolean }
/** What the user typed, per field; booleans are 'true' or ''. */
export type Values = Record<string, string>;

const LABELS: Record<string, string> = { fromCashPlaceId: 'Where did the money come from?', toCashPlaceId: 'Where did the money go?', cashPlaceId: 'Which cash place?', crNumber: 'CR number' };

export function humanize(name: string): string {
  const words = name.replace(/(CashPlaceId|Cents|Id)$/, '').replace(/([A-Z])/g, ' $1').trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The values of an enum, or of a union of literals; undefined for anything else. */
function choices(s: JsonSchema): unknown[] | undefined {
  if (s.enum) return s.enum;
  if (s.anyOf?.length && s.anyOf.every((m) => m.const !== undefined)) return s.anyOf.map((m) => m.const);
  return undefined;
}

function kindOf(name: string, s: JsonSchema): FieldKind {
  if (choices(s)) return 'choice';
  if (s.type === 'integer') return /^cashPlaceId$|CashPlaceId$/.test(name) ? 'cashPlace' : name.endsWith('Cents') ? 'money' : 'integer';
  if (s.type === 'boolean') return 'boolean';
  if (s.type === 'string') return s.format === 'date' ? 'date' : (s.maxLength ?? Infinity) > 200 ? 'longText' : 'text';
  return 'unsupported';
}

export function fieldsOf(schema: JsonSchema): FieldSpec[] {
  const required = new Set(schema.required ?? []);
  return Object.entries(schema.properties ?? {}).map(([name, s]) => {
    const options = choices(s);
    return {
      name,
      label: s.title ?? LABELS[name] ?? humanize(name),
      kind: kindOf(name, s),
      required: required.has(name),
      ...(options ? { options: options.map(String), ...(options.every((o) => typeof o === 'number') ? { numeric: true } : {}) } : {}),
    };
  });
}

/** Typed text -> input for the server. The server re-checks everything; this only catches typing slips. */
export function toInput(fields: FieldSpec[], values: Values): { input: Record<string, unknown>; errors: Record<string, string> } {
  const input: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  for (const f of fields) {
    const raw = (values[f.name] ?? '').trim();
    if (f.kind === 'boolean') input[f.name] = raw === 'true';
    else if (raw === '') {
      if (f.required) errors[f.name] = f.kind === 'cashPlace' ? 'Pick one.' : 'Required.';
    } else if (f.kind === 'money') {
      try {
        input[f.name] = parsePesos(raw);
      } catch {
        errors[f.name] = 'Type an amount like 1,250.00';
      }
    } else if (f.kind === 'choice' && f.numeric) {
      input[f.name] = Number(raw);
    } else if (f.kind === 'integer' || f.kind === 'cashPlace') {
      if (/^-?\d+$/.test(raw)) input[f.name] = Number(raw);
      else errors[f.name] = 'Type a whole number.';
    } else input[f.name] = raw;
  }
  return { input, errors };
}

/** Stored input (from GET /api/docs/:type/:id) -> typed text, to prefill an edit. */
export function toValues(fields: FieldSpec[], input: Record<string, unknown>): Values {
  const values: Values = {};
  for (const f of fields) {
    const v = input[f.name];
    if (v === undefined || v === null || f.kind === 'unsupported') continue; // lists and groups need the module's own screen
    values[f.name] = f.kind === 'money' ? formatPesos(v as number) : f.kind === 'boolean' ? (v ? 'true' : '') : String(v);
  }
  return values;
}
