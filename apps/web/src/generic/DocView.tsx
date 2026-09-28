/**
 * Generic view for any doc type (PLAN H2): status, "What this did" in plain words for everyone, and
 * "Behind the scenes" (journal lines) only when the server sent them (acc.journal.view).
 * Cancel and Edit (= cancel and reissue) start here.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, newIdempotencyKey, type CashPlace, type DocDetail, type DocTypeInfo } from '../api.ts';
import { Link, navigate } from '../router.tsx';
import { Button, JournalTable, Notice, Panel, ReasonDialog, StatusChip, longDate, manilaTime, peso } from '../components/ui.tsx';
import { docPath } from '../shell/menu.ts';
import { fieldsOf, toValues } from './fields.ts';

/** A module's own view parts: more detail under "What this did", and its own cancel (e.g. a quick sale and its payment). */
/** `noEdit` hides Edit where a cancel and a new document is the way to correct (a payroll's figures depend on the state it was worked out on). */
/** `cancelNote` is shown in the cancel dialog (a payroll whose month was already remitted, D6). */
export interface ViewParts { extra?: (d: DocDetail) => ReactNode; cancel?: (id: string, reason: string, key: string) => Promise<unknown>; noEdit?: boolean; cancelNote?: (d: DocDetail) => ReactNode }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function DocView({ type, id, recorded, parts = {} }: { type: DocTypeInfo; id: string; recorded: boolean; parts?: ViewParts }) {
  const fields = useMemo(() => fieldsOf(type.inputJsonSchema), [type]);
  const [d, setD] = useState<DocDetail | null>(null);
  const [places, setPlaces] = useState<CashPlace[]>([]);
  const [error, setError] = useState('');
  const [cancelKey, setCancelKey] = useState<string | null>(null); // one Idempotency-Key per cancel dialog

  const load = useCallback(() => api.get(type.key, id).then(setD, (e: Error) => setError(e.message)), [type.key, id]);
  useEffect(() => void load(), [load]);
  useEffect(() => void (fields.some((f) => f.kind === 'cashPlace') && api.cashPlaces().then(setPlaces, () => undefined)), [fields]);

  if (error) return <Notice>{error}</Notice>;
  if (!d) return <p className="text-slate-500">Loading…</p>;
  const h = d.header;
  const text = toValues(fields, d.input);
  const shown = { cashPlace: (v: string) => places.find((p) => String(p.id) === v)?.name ?? v, money: (v: string) => `₱${v}`, boolean: (v: string) => (v ? 'Yes' : 'No') } as Record<string, (v: string) => string>;
  const posted = h.status === 'posted';
  const cancel = async (reason: string) => (
    await (parts.cancel ? parts.cancel(id, reason, cancelKey!) : api.cancel(type.key, id, reason, cancelKey!)), setCancelKey(null), navigate(docPath(type.key, `/${id}`)), await load()
  );

  return (
    <div className="max-w-3xl space-y-4">
      {recorded && <Notice tone="success">Recorded as {h.number}.</Notice>}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{type.title} {h.number}</h1>
        <StatusChip status={h.status} />
        <span className="flex-1" />
        {posted && type.canCancel && type.canPost && !parts.noEdit && <Button onClick={() => navigate(docPath(type.key, `/${id}/edit`))}>Edit</Button>}
        {posted && type.canCancel && <Button tone="danger" onClick={() => setCancelKey(newIdempotencyKey())}>Cancel</Button>}
      </div>
      <p className="text-sm text-slate-600">
        Dated {longDate(h.businessDate)} · recorded {manilaTime(h.postedAt)} · total <b className="tabular-nums text-slate-900">{peso(h.totalCents)}</b>
      </p>
      {h.replacesId && <Notice tone="info">This replaces <Link to={docPath(type.key, `/${h.replacesId}`)} className="underline">an earlier {type.title}</Link> that was edited.</Notice>}
      {!posted && (
        <Notice tone="warning">
          Cancelled {manilaTime(h.cancelledAt ?? '')}: {h.cancelReason}. Everything it recorded was reversed on the cancel date.{' '}
          {h.replacedById && <Link to={docPath(type.key, `/${h.replacedById}`)} className="underline">See the replacement.</Link>}
        </Notice>
      )}
      <Panel title="What this did">
        <p>{h.summary}</p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          {fields.filter((f) => text[f.name] !== undefined && !UUID.test(text[f.name]!)).map((f) => [
            <dt key={`${f.name}-t`} className="text-slate-500">{f.label}</dt>,
            <dd key={f.name}>{shown[f.kind]?.(text[f.name]!) ?? text[f.name]}</dd>,
          ])}
        </dl>
        {parts.extra?.(d)}
      </Panel>
      {d.journals && (
        <Panel title="Behind the scenes">
          {d.journals.map((j) => (
            <div key={j.id}>
              <p className="text-sm text-slate-600">{j.number} · {j.businessDate} · {j.postingKind === 'reversal' ? 'reversal (cancel)' : 'original'} · {j.memo}</p>
              <JournalTable lines={j.lines} />
            </div>
          ))}
          {d.journals.length === 0 && <p className="text-sm text-slate-500">This document posts no journal.</p>}
        </Panel>
      )}
      {cancelKey && (
        <ReasonDialog
          title={`Cancel ${h.number}?`}
          explain="The document stays on file, marked Cancelled, and everything it recorded is reversed with today's date. This cannot be undone."
          confirmLabel="Cancel document"
          danger
          onConfirm={cancel}
          onClose={() => setCancelKey(null)}
        >
          {parts.cancelNote?.(d)}
        </ReasonDialog>
      )}
    </div>
  );
}
