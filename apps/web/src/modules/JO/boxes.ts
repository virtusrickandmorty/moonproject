/** Sales-screen validation state. It never rewrites a request or adds a server call. */
import { useRef, useState } from 'react';
import type { ZodType } from 'zod';
import { ApiError, refusedFields } from '../../api.ts';

export type BoxErrors = Record<string, string>;

/** A request omits empty rows. Keep a refusal on the row that produced that request entry. */
export function rowFields(fields: BoxErrors, array: string, indices: number[]): BoxErrors {
  return Object.fromEntries(Object.entries(fields).map(([name, message]) => {
    const parts = name.split('.');
    if (parts[0] === array && /^\d+$/.test(parts[1] ?? '') && indices[Number(parts[1])] !== undefined) parts[1] = String(indices[Number(parts[1])]);
    return [parts.join('.'), message];
  }));
}
export const usedTenderRows = (rows: { cashPlaceId: string; amount: string; reference: string }[]) => rows.flatMap((r, i) => r.cashPlaceId || r.amount.trim() || r.reference.trim() ? [i] : []);

/** Keep nested paths: refusedFields supplies the shared wording, one refusal at a time. */
export function boxRefusals(e: unknown): BoxErrors {
  const out = refusedFields(e);
  if (!(e instanceof ApiError) || !Array.isArray(e.details)) return out;
  const paths: BoxErrors = {};
  for (const d of e.details as { field?: string; message?: string }[]) {
    if (typeof d?.field !== 'string' || !d.field) continue;
    const name = d.field.replace(/^(sale|payment|release|invoice)\./, '');
    paths[name] ??= refusedFields(new ApiError(e.code, e.message, e.status, [{ ...d, field: 'box' }])).box ?? 'Check this entry.';
  }
  return paths;
}

export function schemaFields(schema: ZodType, input: unknown): BoxErrors {
  const parsed = schema.safeParse(input);
  if (parsed.success) return {};
  return boxRefusals(new ApiError('INVALID_INPUT', 'Check these entries.', 400,
    parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message }))));
}

export function issueFields(issues: readonly { field?: string; message: string; level: string }[] = []): BoxErrors {
  return Object.fromEntries(issues.filter((i) => i.level === 'error' && i.field).map((i) => [i.field!.replace(/^(sale|payment|release|invoice)\./, ''), i.message]));
}

export function previewFields(value: unknown): BoxErrors {
  const p = value as { issues?: Parameters<typeof issueFields>[0]; sale?: unknown; payment?: unknown; release?: unknown };
  return { ...issueFields(p?.issues), ...(p?.sale ? previewFields(p.sale) : {}), ...(p?.payment ? previewFields(p.payment) : {}), ...(p?.release ? previewFields(p.release) : {}) };
}

/** Only a refusal with no named box belongs above the button. */
export function generalRefusal(e: unknown): string {
  if (e instanceof ApiError && Array.isArray(e.details) && e.details.length && e.details.every((d) => d?.field)) return '';
  return (e as Error).message;
}

export function useBoxes(local: BoxErrors, key: string, external: BoxErrors = {}, attempted = false, remap: (fields: BoxErrors) => BoxErrors = (fields) => fields) {
  const [submitted, setSubmitted] = useState(false);
  const [blurred, setBlurred] = useState<Record<string, boolean>>({});
  const [refusal, setRefusal] = useState<{ key: string; fields: BoxErrors } | null>(null);
  const dirty = useRef(new Set<string>());
  const server = remap(refusal?.key === key ? refusal.fields : {});
  const remote = remap(external);
  const error = (...names: string[]) => (submitted || attempted || names.some((name) => blurred[name]))
    ? names.map((name) => server[name] || remote[name] || local[name]).find(Boolean) : undefined;
  const box = (name: string) => ({
    onInput: () => { dirty.current.add(name); },
    onBlur: () => { if (dirty.current.has(name)) setBlurred((old) => ({ ...old, [name]: true })); },
  });
  const choice = (name: string) => ({ onClickCapture: () => { dirty.current.add(name); }, onBlur: box(name).onBlur });
  const touch = (name: string) => { dirty.current.add(name); setBlurred((old) => ({ ...old, [name]: true })); };
  const submit = () => setSubmitted(true);
  const reset = () => { setSubmitted(false); setBlurred({}); setRefusal(null); dirty.current.clear(); };
  const capture = (e: unknown) => { setRefusal({ key, fields: boxRefusals(e) }); };
  const review = (p: unknown) => { const fields = previewFields(p); setRefusal({ key, fields }); return !Object.keys(fields).length; };
  const refuse = (e: unknown) => { capture(e); if (Object.keys(boxRefusals(e)).length) setSubmitted(true); return generalRefusal(e); };
  const run = async <T,>(action: () => Promise<T>): Promise<T | undefined> => {
    submit();
    if (Object.keys(local).some((name) => local[name])) return;
    try { return await action(); }
    catch (e) { const general = refuse(e); if (general) throw new Error(general); }
  };
  return { error, box, choice, touch, submit, reset, capture, review, refuse, run };
}
export type Boxes = ReturnType<typeof useBoxes>;
