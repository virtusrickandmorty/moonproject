import { useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError, type CustomerRow, type DocHeader, type DocTypeInfo, type Preview } from '../../api.ts';
import { Button, Field, Notice, Panel, inputClass, peso, ReasonDialog } from '../../components/ui.tsx';
import { navigate } from '../../router.tsx';
import { docPath } from '../../shell/menu.ts';
import { RecordDialog, type FormMode } from '../../generic/DocForm.tsx';

type Item = { id: string; code: string; name: string; unit: 'pc' | 'set'; is_active: number };
type Line = { itemId: string; description: string; qty: number; unit: 'pc' | 'set'; discountCents: number;
  discountReason?: string; overrideUnitPriceCents?: number; overrideReason?: string };
type Form = { customerId: string; prospectName: string; contact: string; validForDays: number; termsText: string; notes: string;
  lines: Line[]; documentDiscountCents: number; discountReason: string };
const blankLine = (): Line => ({ itemId: '', description: '', qty: 1, unit: 'pc', discountCents: 0 });
const blank = (): Form => ({ customerId: '', prospectName: '', contact: '', validForDays: 15, termsText: '', notes: '',
  lines: [blankLine()], documentDiscountCents: 0, discountReason: '' });
const cents = (value: string): number | null => /^\d+(?:\.\d{1,2})?$/.test(value) ? Math.round(Number(value) * 100) : null;
const amount = (value: number | undefined) => value === undefined ? '' : (value / 100).toFixed(2);
function MoneyField({ value, onValue, placeholder }: { value: number | undefined; onValue: (n: number | undefined) => void; placeholder?: string }) {
  const [text, setText] = useState(amount(value));
  const sent = useRef<number | undefined>(value);
  useEffect(() => { if (value !== sent.current) setText(amount(value)); }, [value]);
  return <input inputMode="decimal" placeholder={placeholder} className={inputClass} value={text} onChange={(e) => {
    const next = e.target.value;
    setText(next);
    if (!next) { sent.current = undefined; onValue(undefined); }
    else { const n = cents(next); if (n !== null) { sent.current = n; onValue(n); } }
  }} />;
}
const optional = (value: string) => value.trim() || undefined;
const toInput = (v: Form) => ({
  ...(v.customerId ? { customerId: v.customerId } : { prospectName: v.prospectName.trim() }),
  ...(optional(v.contact) ? { contact: optional(v.contact) } : {}), validForDays: v.validForDays,
  ...(optional(v.termsText) ? { termsText: optional(v.termsText) } : {}),
  ...(optional(v.notes) ? { notes: optional(v.notes) } : {}),
  lines: v.lines.map((l) => ({ itemId: l.itemId, description: l.description.trim(), qty: l.qty, unit: l.unit,
    discountCents: l.discountCents,
    ...(l.discountReason ? { discountReason: l.discountReason.trim() } : {}),
    ...(l.overrideUnitPriceCents !== undefined ? { overrideUnitPriceCents: l.overrideUnitPriceCents } : {}),
    ...(l.overrideReason ? { overrideReason: l.overrideReason.trim() } : {}) })),
  documentDiscountCents: v.documentDiscountCents,
  ...(optional(v.discountReason) ? { discountReason: optional(v.discountReason) } : {}),
});

export function QuotationForm({ type, mode }: { type: DocTypeInfo; mode: FormMode }) {
  const [v, setV] = useState<Form>(blank);
  const [items, setItems] = useState<Item[]>([]);
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [customerSearch, setCustomerSearch] = useState('');
  const [itemSearch, setItemSearch] = useState('');
  const [original, setOriginal] = useState<DocHeader | null>(null);
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirm, setConfirm] = useState<Preview | null>(null);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<{ id: string; version: number } | null>(null);
  const input = useMemo(() => toInput(v), [v]);
  const ready = v.lines.length > 0 && v.lines.every((l) => l.itemId && l.description.trim() && l.qty >= 1) &&
    Boolean(v.customerId) !== Boolean(v.prospectName.trim()) && v.validForDays >= 1;

  useEffect(() => {
    if (mode.kind === 'edit') api.get(type.key, mode.id).then((d) => {
      setOriginal(d.header);
      const x = d.input as Record<string, unknown>;
      setV({ customerId: String(x.customerId ?? ''), prospectName: String(x.prospectName ?? ''), contact: String(x.contact ?? ''),
        validForDays: Number(x.validForDays ?? 15), termsText: String(x.termsText ?? ''), notes: String(x.notes ?? ''),
        lines: (x.lines as Line[]).map((l) => ({ ...l })), documentDiscountCents: Number(x.documentDiscountCents ?? 0),
        discountReason: String(x.discountReason ?? '') });
    }, (e: Error) => setError(e.message));
    else if (mode.draftId) api.drafts(type.key).then((ds) => {
      const d = ds.find((x) => x.id === mode.draftId);
      if (d) { setDraft({ id: d.id, version: d.version }); setV(d.payload.values as unknown as Form); }
    }, (e: Error) => setError(e.message));
  }, [type.key, mode.kind, mode.kind === 'edit' ? mode.id : mode.draftId]);
  useEffect(() => { api.customers(customerSearch).then(setCustomers, () => undefined); }, [customerSearch]);
  useEffect(() => {
    fetch(`/api/cat/items?${new URLSearchParams({ search: itemSearch, active: '1', limit: '100' })}`, { credentials: 'same-origin' })
      .then((r) => { if (!r.ok) throw new Error('Could not load catalog items.'); return r.json() as Promise<Item[]>; })
      .then(setItems, (e: Error) => setError(e.message));
  }, [itemSearch]);
  useEffect(() => {
    if (!ready) { setPreview(null); return; }
    let stale = false;
    const timer = setTimeout(() => api.preview(type.key, input).then((p) => { if (!stale) setPreview(p); }, () => { if (!stale) setPreview(null); }), 400);
    return () => { stale = true; clearTimeout(timer); };
  }, [type.key, input, ready]);

  const line = (index: number, patch: Partial<Line>) => setV((old) => ({ ...old, lines: old.lines.map((l, i) => i === index ? { ...l, ...patch } : l) }));
  const openConfirm = () => api.preview(type.key, input).then(setConfirm, (e: Error) => setError(e.message));
  const record = async (key: string) => {
    try {
      const r = original ? await api.reissue(type.key, original.id, input, confirm!.totalCents, reason, key)
        : await api.post(type.key, input, confirm!.totalCents, key);
      if (draft) await api.discardDraft(draft.id).catch(() => undefined);
      navigate(docPath(type.key, `/${r.id}?recorded=1`));
    } catch (e) {
      if (e instanceof ApiError && e.code === 'TOTALS_CHANGED') setConfirm(await api.preview(type.key, input));
      throw e;
    }
  };
  const saveDraft = async () => {
    try {
      const payload = { values: v as unknown as Record<string, string> };
      const d = draft ? await api.saveDraft(draft.id, draft.version, payload) : await api.createDraft(type.key, payload);
      setDraft(d); setError('Draft saved. It has no quotation number yet.');
    } catch (e) { setError((e as Error).message); }
  };
  if (mode.kind === 'edit' && original && !reason) return <ReasonDialog title={`Edit ${original.number}`}
    explain="The old quotation will be cancelled and the replacement will get a new number when you record it."
    confirmLabel="Continue to edit" onConfirm={setReason} onClose={() => navigate(docPath(type.key, `/${original.id}`))} />;

  return <div className="max-w-5xl space-y-4"><h1 className="text-2xl font-semibold">{original ? `Edit ${original.number}` : 'New quotation'}</h1>
    {error && <Notice>{error}</Notice>}{original && <Notice tone="info">Recording will cancel {original.number} and issue a replacement. Reason: {reason}</Notice>}
    <Panel title="Customer or prospect"><div className="grid gap-3 sm:grid-cols-2">
      <Field label="Search customers"><input className={inputClass} value={customerSearch} onChange={(e) => setCustomerSearch(e.target.value)} /></Field>
      <Field label="Customer"><select className={inputClass} value={v.customerId} onChange={(e) => setV({ ...v, customerId: e.target.value, prospectName: '' })}>
        <option value="">Choose a customer</option>{v.customerId && !customers.some((c) => c.id === v.customerId) && <option value={v.customerId}>Selected customer</option>}
        {customers.filter((c) => c.is_active).map((c) => <option key={c.id} value={c.id}>{c.display_name}</option>)}</select></Field>
      <Field label="Prospect name"><input className={inputClass} value={v.prospectName} onChange={(e) => setV({ ...v, prospectName: e.target.value, customerId: '' })} /></Field>
      <Field label="Contact"><input className={inputClass} value={v.contact} onChange={(e) => setV({ ...v, contact: e.target.value })} /></Field>
      <Field label="Valid for days" required><input type="number" min="1" max="365" className={inputClass} value={v.validForDays}
        onChange={(e) => setV({ ...v, validForDays: Number(e.target.value) })} /></Field></div></Panel>
    <Panel title="Items"><Field label="Search catalog"><input className={`${inputClass} max-w-sm`} value={itemSearch} onChange={(e) => setItemSearch(e.target.value)} /></Field>
      <div className="space-y-3">{v.lines.map((l, i) => <div key={i} className="rounded-md border p-3"><div className="grid gap-3 sm:grid-cols-4">
        <Field label="Catalog item" required><select className={inputClass} value={l.itemId} onChange={(e) => {
          const item = items.find((x) => x.id === e.target.value);
          line(i, { itemId: e.target.value, description: item?.name ?? l.description, unit: item?.unit ?? l.unit });
        }}><option value="">Choose item</option>{l.itemId && !items.some((x) => x.id === l.itemId) && <option value={l.itemId}>Selected item</option>}
          {items.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name} ({item.unit})</option>)}</select></Field>
        <Field label="Description" required><input className={inputClass} value={l.description} onChange={(e) => line(i, { description: e.target.value })} /></Field>
        <Field label="Quantity" required><input type="number" min="1" className={inputClass} value={l.qty} onChange={(e) => line(i, { qty: Number(e.target.value) })} /></Field>
        <Field label="Unit"><input className={inputClass} value={l.unit} readOnly /></Field>
        <Field label="Line discount"><MoneyField value={l.discountCents} onValue={(n) => line(i, { discountCents: n ?? 0 })} /></Field>
        <Field label="Discount reason"><input className={inputClass} value={l.discountReason ?? ''} onChange={(e) => line(i, { discountReason: e.target.value })} /></Field>
        <Field label="Override price"><MoneyField value={l.overrideUnitPriceCents} placeholder="Use catalog price"
          onValue={(n) => line(i, { overrideUnitPriceCents: n })} /></Field>
        <Field label="Override reason"><input className={inputClass} value={l.overrideReason ?? ''} onChange={(e) => line(i, { overrideReason: e.target.value })} /></Field>
      </div><Button disabled={v.lines.length === 1} onClick={() => setV({ ...v, lines: v.lines.filter((_, x) => x !== i) })}>Remove item</Button></div>)}</div>
      <Button disabled={v.lines.length >= 50} onClick={() => setV({ ...v, lines: [...v.lines, blankLine()] })}>+ Add item</Button></Panel>
    <Panel title="Terms and discount"><div className="grid gap-3 sm:grid-cols-2">
      <Field label="Document discount"><MoneyField value={v.documentDiscountCents}
        onValue={(n) => setV({ ...v, documentDiscountCents: n ?? 0 })} /></Field>
      <Field label="Discount reason"><input className={inputClass} value={v.discountReason} onChange={(e) => setV({ ...v, discountReason: e.target.value })} /></Field>
      <Field label="Terms"><textarea className={inputClass} value={v.termsText} onChange={(e) => setV({ ...v, termsText: e.target.value })} /></Field>
      <Field label="Notes"><textarea className={inputClass} value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} /></Field></div></Panel>
    {preview && <Panel title="So far"><p className="text-2xl font-semibold">{peso(preview.totalCents)}</p><p>{preview.summary}</p>
      {preview.issues.map((x) => <Notice key={x.code + x.field} tone={x.level}>{x.message}</Notice>)}</Panel>}
    <div className="flex gap-2"><Button tone="primary" disabled={!ready || !type.canPost} onClick={() => void openConfirm()}>Record</Button>
      {mode.kind === 'new' && <Button onClick={() => void saveDraft()}>Save draft</Button>}
      <Button onClick={() => navigate(docPath(type.key))}>Back</Button></div>
    {confirm && <RecordDialog type={type} preview={confirm} original={original ?? undefined} reason={reason} onRecord={record} onClose={() => setConfirm(null)} />}
  </div>;
}
