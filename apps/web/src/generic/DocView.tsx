/**
 * Generic view for any doc type (PLAN H2): status, "What this did" in plain words for everyone, and
 * "Behind the scenes" (journal lines) only when the server sent them (acc.journal.view).
 * Cancel and Edit (= cancel and reissue) start here. The cancel dialog shows what the server warns about first (a filed
 * period, ACC-22), from the preview before Cancel; a warning never blocks. Every document has its Attachments panel.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, newIdempotencyKey, type CancelPreview, type CashPlace, type DocDetail, type DocTypeInfo, type PrintVariant } from '../api.ts';
import { Link, navigate } from '../router.tsx';
import { Button, JournalTable, Notice, Panel, ReasonDialog, StatusChip, longDate, manilaTime, peso, showDate } from '../components/ui.tsx';
import { docPath } from '../shell/menu.ts';
import { choiceLabel, fieldsOf, toValues } from './fields.ts';
import { AttachmentsPanel } from './Attachments.tsx';
import { Crumb } from '../shell/crumbs.tsx';

/** A module's own view parts: more detail under "What this did", and its own cancel (e.g. a quick sale and its payment). */
/** `noEdit` hides Edit where a cancel and a new document is the way to correct (a payroll's figures depend on the state it was worked out on). */
/** `cancelNote` is shown in the cancel dialog (a payroll whose month was already remitted, D6). */
export interface ViewParts { extra?: (d: DocDetail) => ReactNode; cancel?: (id: string, reason: string, key: string) => Promise<unknown>; noEdit?: boolean; cancelNote?: (d: DocDetail) => ReactNode }
/** Opens a document's printout in a new window and prints it; the problem in words, or null. Also used by a list row's Print. */
export async function printDocument(typeKey: string, id: string, variant: PrintVariant = 'document'): Promise<string | null> {
  const page = window.open('', '_blank');
  if (!page) return 'Allow a new window to print this document.';
  try {
    const { html } = await api.printDocument(typeKey, id, variant);
    page.onload = () => page.print();
    page.document.open(); page.document.write(html); page.document.close();
    return null;
  } catch (e) { page.close(); return (e as Error).message; }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `inDialog`: shown over its list; `refresh` reloads the list after a cancel. `startCancel`: its cancel dialog opens at once (a list row's Cancel). */
export function DocView({ type, id, recorded, parts = {}, inDialog, startCancel }: { type: DocTypeInfo; id: string; recorded: boolean; parts?: ViewParts; inDialog?: { refresh: () => void }; startCancel?: boolean }) {
  const fields = useMemo(() => fieldsOf(type.inputJsonSchema), [type]);
  const [d, setD] = useState<DocDetail | null>(null);
  const [places, setPlaces] = useState<CashPlace[]>([]);
  const [error, setError] = useState('');
  const [printError, setPrintError] = useState('');
  const [printVariants, setPrintVariants] = useState<PrintVariant[]>([]);
  const [cancelKey, setCancelKey] = useState<string | null>(() => (startCancel ? newIdempotencyKey() : null)); // one Idempotency-Key per cancel dialog
  const [cancelPreview, setCancelPreview] = useState<CancelPreview | null>(null);

  const load = useCallback(() => api.get(type.key, id).then(setD, (e: Error) => setError(e.message)), [type.key, id]);
  useEffect(() => void load(), [load]);
  useEffect(() => void (fields.some((f) => f.kind === 'cashPlace') && api.cashPlaces().then(setPlaces, () => undefined)), [fields]);
  useEffect(() => {
    let active = true;
    api.printableTypes().then((types) => {
      if (active) setPrintVariants(types.find((item) => item.key === type.key)?.variants ?? []);
    }, () => { if (active) setPrintVariants([]); });
    return () => { active = false; };
  }, [type.key]);

  useEffect(() => {
    setCancelPreview(null);
    if (!cancelKey) return;
    let active = true;
    api.cancelPreview(type.key, id).then((p) => { if (active) setCancelPreview(p); }, () => undefined); // the cancel itself says what is wrong
    return () => { active = false; };
  }, [cancelKey, type.key, id]);

  if (error) return <Notice>{error}</Notice>;
  if (!d) return <p className="text-slate-500">Loading…</p>;
  const h = d.header;
  const text = toValues(fields, d.input);
  const shown = { cashPlace: (v: string) => places.find((p) => String(p.id) === v)?.name ?? v, money: (v: string) => `₱${v}`, boolean: (v: string) => (v ? 'Yes' : 'No') } as Record<string, (v: string) => string>;
  const posted = h.status === 'posted';
  const print = (variant: PrintVariant = 'document') => void printDocument(type.key, id, variant).then((e) => setPrintError(e ?? ''));
  const cancel = async (reason: string) => (
    await (parts.cancel ? parts.cancel(id, reason, cancelKey!) : api.cancel(type.key, id, reason, cancelKey!)), setCancelKey(null), inDialog ? inDialog.refresh() : navigate(docPath(type.key, `/${id}`)), await load()
  );

  return (
    <div className={inDialog ? 'space-y-4' : 'max-w-3xl space-y-4'}>
      {recorded && <Notice tone="success">Recorded as {h.number}.</Notice>}
      <div className={`flex flex-wrap items-center gap-3 ${inDialog ? 'pr-10' : ''}`}>{/* in a dialog, room for its × */}
        {!inDialog && <Crumb label={h.number} />}{/* over its list, the trail stays the list's */}
        <h1 className="text-2xl font-bold text-[#010101]">{type.title} {h.number}</h1>
        <StatusChip status={h.status} />
        <span className="flex-1" />
        {printVariants.includes('document') && <Button onClick={() => void print()}>Print</Button>}
        {printVariants.includes('job_ticket') && <Button onClick={() => void print('job_ticket')}>Print job ticket</Button>}
        {printVariants.includes('thermal') && <Button onClick={() => void print('thermal')}>Print 80 mm receipt</Button>}
        {posted && type.canCancel && type.canPost && !parts.noEdit && <Button onClick={() => navigate(docPath(type.key, `/${id}/edit`))}>Edit</Button>}
        {posted && type.canCancel && <Button tone="danger" onClick={() => setCancelKey(newIdempotencyKey())}>Cancel</Button>}
      </div>
      {printError && <Notice>{printError}</Notice>}
      <p className="text-sm text-slate-600">
        {type.dating === 'printed' ? 'Date printed on it' : 'Dated'} {longDate(h.businessDate)} · {type.dating === 'printed' ? 'typed' : 'recorded'} {manilaTime(h.postedAt)} · total <b className="tabular-nums text-slate-900">{peso(h.totalCents)}</b>
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
            <dd key={f.name}>{shown[f.kind]?.(text[f.name]!) ?? (f.kind === 'choice' ? choiceLabel(f.name, text[f.name]!) : text[f.name])}</dd>,
          ])}
        </dl>
        {parts.extra?.(d)}
      </Panel>
      <AttachmentsPanel type={type} id={id} />
      {d.journals && (
        <Panel title="Behind the scenes">
          {d.journals.map((j) => (
            <div key={j.id}>
              <p className="text-sm text-slate-600">{j.number} · {showDate(j.businessDate)} · {j.postingKind === 'reversal' ? 'reversal (cancel)' : 'original'} · {j.memo}</p>
              <JournalTable lines={j.lines} />
            </div>
          ))}
          {d.journals.length === 0 && <p className="text-sm text-slate-500">This document posts no journal.</p>}
        </Panel>
      )}
      {cancelKey && posted && (
        <ReasonDialog
          title={`Cancel ${h.number}?`}
          explain="The document stays on file, marked Cancelled, and everything it recorded is reversed with today's date. This cannot be undone."
          confirmLabel="Cancel document"
          danger
          onConfirm={cancel}
          onClose={() => setCancelKey(null)}
        >
          {cancelPreview?.issues.map((i) => <Notice key={i.code + i.field + i.message} tone={i.level}>{i.message}</Notice>)}
          {parts.cancelNote?.(d)}
        </ReasonDialog>
      )}
    </div>
  );
}
