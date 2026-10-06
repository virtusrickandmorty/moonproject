/**
 * The date printed on a booklet invoice, a collection receipt or a supplier's document (doc types with dating 'printed').
 * Blank means today. The document, its journal and the VAT registers carry this date; the server refuses a date after
 * today or in a month signed off at month-end. An edit starts from the date of the document it replaces.
 */
import { useEffect, useState } from 'react';
import { isBusinessDate } from '@moonproject/shared';
import { Field, inputClass } from '../components/ui.tsx';

/** What was typed, as the date to send: none for today. */
export function printedDay(text: string): { businessDate?: string; error?: string } {
  const t = text.trim();
  if (!t) return {};
  return isBusinessDate(t) ? { businessDate: t } : { error: 'Type the date printed on the document like 2026-09-30, or leave it empty for today.' };
}

/** The field's text, and the date it sends; `original` is the document an edit replaces (its date is kept unless changed). */
export function usePrintedDate(original?: { businessDate: string }) {
  const [text, setText] = useState('');
  useEffect(() => void (original && setText(original.businessDate)), [original?.businessDate]);
  return { text, setText, ...printedDay(text) };
}

export function PrintedDateField({ value, onChange, label = 'Date printed on it' }: { value: string; onChange: (v: string) => void; label?: string }) {
  return (
    <Field label={label} hint="Leave empty for today. Its VAT goes to the month of this date.">
      <input type="date" className={`${inputClass} max-w-48`} value={value} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}
