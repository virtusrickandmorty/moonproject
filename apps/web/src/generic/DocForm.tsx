/**
 * Generic form for any doc type (PLAN H2): fields from the input schema, live totals from the server's own
 * calculator, Save draft, and Record through a confirm dialog showing the server preview. Also the Edit of a
 * recorded document, which cancels it and issues a replacement with a new number (NR-4). The client never
 * sends a date, number, total or status: only the input and the total the user confirmed.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { api, ApiError, newIdempotencyKey, type CashPlace, type DocHeader, type DocTypeInfo, type Preview } from '../api.ts';
import { navigate } from '../router.tsx';
import { Button, Dialog, Field, JournalTable, Notice, Panel, ReasonDialog, inputClass, peso, useAction } from '../components/ui.tsx';
import { docPath } from '../shell/menu.ts';
import { fieldsOf, toInput, toValues, type FieldSpec, type Values } from './fields.ts';

export type FormMode = { kind: 'new'; draftId?: string } | { kind: 'edit'; id: string };

function FieldInput({ f, value, set, places }: { f: FieldSpec; value: string; set: (v: string) => void; places: CashPlace[] }) {
  const on = (e: { target: { value: string } }) => set(e.target.value);
  switch (f.kind) {
    case 'cashPlace':
      return (
        <div role="radiogroup" aria-label={f.label} className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {places.map((p) => (
            <button key={p.id} type="button" role="radio" aria-checked={value === String(p.id)} onClick={() => set(String(p.id))} className={`rounded-lg p-3 text-left ring-1 ${value === String(p.id) ? 'bg-indigo-600 text-white ring-indigo-600' : 'bg-white ring-slate-300 hover:bg-indigo-50'}`}>
              {p.name}
              {p.balanceCents !== null && <span className="block text-xs opacity-75">{peso(p.balanceCents)}</span>}
            </button>
          ))}
        </div>
      );
    case 'money':
      return <input inputMode="decimal" placeholder="0.00" className={`${inputClass} text-right tabular-nums`} value={value} onChange={on} />;
    case 'longText':
      return <textarea rows={2} className={inputClass} value={value} onChange={on} />;
    case 'boolean':
      return <input type="checkbox" checked={value === 'true'} onChange={(e) => set(e.target.checked ? 'true' : '')} />;
    case 'choice':
      return <select className={inputClass} value={value} onChange={on}><option value="" />{f.options!.map((o) => <option key={o}>{o}</option>)}</select>;
    case 'unsupported':
      return <p className="text-slate-500">This part needs the module's own screen.</p>;
    default:
      return <input inputMode={f.kind === 'integer' ? 'numeric' : undefined} className={inputClass} value={value} onChange={on} />;
  }
}

export function RecordDialog(p: { type: DocTypeInfo; preview: Preview; original?: DocHeader; reason: string; onRecord: (key: string) => Promise<unknown>; onClose: () => void }) {
  const key = useMemo(newIdempotencyKey, [p.preview]); // same key when a click is retried, a new one after a new preview
  const a = useAction();
  const errors = p.preview.issues.filter((i) => i.level === 'error');
  return (
    <Dialog title={p.original ? `Cancel ${p.original.number} and record the replacement?` : `Record this ${p.type.title}?`} onClose={p.onClose}>
      <p>{p.preview.summary}</p>
      <p className="text-sm text-slate-600">Total: <span className="text-lg font-semibold tabular-nums text-slate-900">{peso(p.preview.totalCents)}</span></p>
      {p.original && <Notice tone="info">{p.original.number} will be cancelled (reversed with today's date) and the replacement gets a new number. Reason: {p.reason}</Notice>}
      {p.preview.issues.map((i) => <Notice key={i.code + i.field} tone={i.level}>{i.message}</Notice>)}
      {p.preview.journal && <Panel title="Behind the scenes"><JournalTable lines={p.preview.journal} /></Panel>}
      {a.error && <Notice>{a.error}</Notice>}
      <div className="flex justify-end gap-2">
        <Button onClick={p.onClose}>Go back</Button>
        <Button tone="primary" autoFocus disabled={a.busy || errors.length > 0} onClick={() => a.run(() => p.onRecord(key))}>{a.busy ? 'Recording…' : 'Record'}</Button>
      </div>
    </Dialog>
  );
}

export function DocForm({ type, mode }: { type: DocTypeInfo; mode: FormMode }) {
  const fields = useMemo(() => fieldsOf(type.inputJsonSchema), [type]);
  const [values, setValues] = useState<Values>({});
  const [places, setPlaces] = useState<CashPlace[]>([]);
  const [draft, setDraft] = useState<{ id: string; version: number } | null>(null);
  const [original, setOriginal] = useState<DocHeader>();
  const [reason, setReason] = useState('');
  const [live, setLive] = useState<Preview | null>(null);
  const [confirm, setConfirm] = useState<Preview | null>(null);
  const [touched, setTouched] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const { input, errors } = toInput(fields, values);
  const inputKey = JSON.stringify(input);
  const fail = (e: Error) => setNotice({ tone: 'error', text: e.message });
  const modeKey = mode.kind === 'edit' ? mode.id : (mode.draftId ?? '');

  useEffect(() => {
    if (fields.some((f) => f.kind === 'cashPlace')) api.cashPlaces().then(setPlaces, fail);
    if (mode.kind === 'edit') api.get(type.key, mode.id).then((d) => (setOriginal(d.header), setValues(toValues(fields, d.input))), fail);
    else if (mode.draftId)
      api.drafts(type.key).then((ds) => {
        const d = ds.find((x) => x.id === mode.draftId);
        if (!d) return fail(new Error('That draft was already recorded or discarded.'));
        setDraft({ id: d.id, version: d.version });
        setValues(d.payload.values ?? {});
      }, fail);
  }, [type.key, fields, modeKey]);

  // Live totals and checks from the server's calculator, a moment after typing stops.
  useEffect(() => {
    if (Object.keys(errors).length > 0) return setLive(null);
    let stale = false;
    const t = setTimeout(() => api.preview(type.key, input).then((p) => stale || setLive(p), () => stale || setLive(null)), 400);
    return () => ((stale = true), clearTimeout(t));
  }, [type.key, inputKey]);

  const openConfirm = () => {
    setTouched(true);
    if (Object.keys(errors).length === 0) api.preview(type.key, input).then(setConfirm, fail);
  };

  const record = async (key: string) => {
    try {
      const r = original ? await api.reissue(type.key, original.id, input, confirm!.totalCents, reason, key) : await api.post(type.key, input, confirm!.totalCents, key);
      if (draft) await api.discardDraft(draft.id).catch(() => undefined);
      navigate(docPath(type.key, `/${r.id}?recorded=1`));
    } catch (e) {
      // The server's total differs from what the user confirmed: show the new preview and ask again.
      if (e instanceof ApiError && e.code === 'TOTALS_CHANGED') setConfirm(await api.preview(type.key, input));
      throw e;
    }
  };

  const saveDraft = () =>
    (draft ? api.saveDraft(draft.id, draft.version, { values }) : api.createDraft(type.key, { values })).then(
      (d) => (setDraft(d), setNotice({ tone: 'success', text: 'Draft saved. It has no number and records nothing until you press Record.' })),
      fail,
    );

  // Enter moves to the next field; Ctrl+Enter records (PLAN H2).
  const onKeyDown = (e: KeyboardEvent<HTMLFormElement>) => {
    const el = e.target as HTMLElement;
    if (e.key !== 'Enter' || (!e.ctrlKey && !e.metaKey && el.tagName !== 'INPUT')) return;
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) return openConfirm();
    const all = [...formRef.current!.querySelectorAll<HTMLElement>('input, textarea, select, [role=radio]')];
    all[all.indexOf(el) + 1]?.focus();
  };

  if (mode.kind === 'edit' && original && !reason) {
    if (original.status !== 'posted') return <Notice>{original.number} is already cancelled.</Notice>;
    const explain = `A recorded document is never changed. ${original.number} will be cancelled and a new one issued with a new number. Nothing changes until you record the replacement.`;
    return <ReasonDialog title={`Edit ${original.number}`} explain={explain} confirmLabel="Continue to edit" onConfirm={setReason} onClose={() => navigate(docPath(type.key, `/${original.id}`))} />;
  }
  const blocked = fields.some((f) => f.kind === 'unsupported' && f.required);
  return (
    <form ref={formRef} onKeyDown={onKeyDown} onSubmit={(e) => e.preventDefault()} className="grid gap-4 lg:grid-cols-[1fr_20rem]">
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">{original ? `Edit ${original.number}` : `New ${type.title}`}</h1>
        {original && <Notice tone="info">When you record, {original.number} is cancelled and the replacement gets a new number. Reason: {reason}</Notice>}
        {blocked && <Notice tone="warning">This document needs its own screen; the general form cannot fill it in yet.</Notice>}
        {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
        <Panel title="Details">
          {fields.map((f) => (
            <Field key={f.name} label={f.label} required={f.required} error={touched ? errors[f.name] : undefined}>
              <FieldInput f={f} value={values[f.name] ?? ''} set={(v) => setValues((old) => ({ ...old, [f.name]: v }))} places={places} />
            </Field>
          ))}
        </Panel>
        <div className="flex gap-2">
          <Button tone="primary" disabled={blocked || !type.canPost} onClick={openConfirm} title="Ctrl+Enter">Record</Button>
          {mode.kind === 'new' && <Button onClick={saveDraft}>Save draft</Button>}
          <Button onClick={() => history.back()}>Back</Button>
        </div>
      </div>
      <Panel title="So far">
        {live ? <p className="text-2xl font-semibold tabular-nums">{peso(live.totalCents)}</p> : <p className="text-sm text-slate-500">Fill in the required fields to see the total.</p>}
        {live && <p className="text-sm">{live.summary}</p>}
        {live?.issues.map((i) => <Notice key={i.code + i.field} tone={i.level}>{i.message}</Notice>)}
      </Panel>
      {confirm && <RecordDialog type={type} preview={confirm} original={original} reason={reason} onRecord={record} onClose={() => setConfirm(null)} />}
    </form>
  );
}
