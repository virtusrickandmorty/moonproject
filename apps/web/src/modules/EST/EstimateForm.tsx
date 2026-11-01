/**
 * Cost estimate form (the owner's request, Nov 2026): the customer (or a prospect), then the items with their quantities.
 * The server prices each from its cost sheet; the form shows the cost, the suggested price and the profit as it answers.
 * A price may be changed with a reason, and an extra cost per piece (a special print, say) added with what it is for.
 */
import { useEffect, useMemo, useState } from 'react';
import { formatPesos, parsePesos } from '@moonproject/shared';
import { api, ApiError, type DocHeader, type DocTypeInfo, type Me, type Preview } from '../../api.ts';
import { Button, Field, Notice, Panel, ReasonDialog, inputClass, peso } from '../../components/ui.tsx';
import { navigate } from '../../router.tsx';
import { docPath } from '../../shell/menu.ts';
import { RecordDialog, type FormMode } from '../../generic/DocForm.tsx';
import { CustomerPicker, Figures } from '../COL/parts.tsx';
import { ItemSearch } from '../JO/parts.tsx';
import type { EstimateDoc } from './estimate.ts';

type Line = { itemId: string; description: string; qty: string; extra: string; extraReason: string; price: string; priceReason: string };
type Form = { customerId: string; customerName: string; prospectName: string; contact: string; notes: string; lines: Line[] };
type InputLine = { itemId: string; description: string; qty: number; extraCostCents?: number; extraReason?: string; unitPriceCents?: number; priceReason?: string };

const money = (t: string): number | null => { try { const c = parsePesos(t); return c >= 0 ? c : null; } catch { return null; } };
const blank: Form = { customerId: '', customerName: '', prospectName: '', contact: '', notes: '', lines: [] };

/** The form as the server takes it, or what is still missing. */
export function estimateInput(f: Form): { input?: Record<string, unknown>; missing?: string } {
  if (!f.customerId && !f.prospectName.trim()) return { missing: 'Pick the customer, or type a prospect name.' };
  if (f.lines.length === 0) return { missing: 'Add an item from the price list.' };
  const lines: InputLine[] = [];
  for (const [i, l] of f.lines.entries()) {
    const qty = Number(l.qty);
    if (!Number.isInteger(qty) || qty < 1) return { missing: `Line ${i + 1}: the quantity must be a whole number, 1 or more.` };
    const extra = l.extra.trim() ? money(l.extra) : undefined;
    const price = l.price.trim() ? money(l.price) : undefined;
    if (extra === null || price === null) return { missing: `Line ${i + 1}: type amounts like 25.00.` };
    lines.push({ itemId: l.itemId, description: l.description.trim() || 'Item', qty,
      ...(extra ? { extraCostCents: extra, extraReason: l.extraReason.trim() || undefined } : {}),
      ...(price !== undefined ? { unitPriceCents: price, priceReason: l.priceReason.trim() || undefined } : {}) });
  }
  return { input: { ...(f.customerId ? { customerId: f.customerId } : { prospectName: f.prospectName.trim() }),
    ...(f.contact.trim() ? { contact: f.contact.trim() } : {}), ...(f.notes.trim() ? { notes: f.notes.trim() } : {}), lines } };
}

const formOf = (input: { customerId?: string; prospectName?: string; contact?: string; notes?: string; lines: InputLine[] }, customerName: string): Form => ({
  customerId: input.customerId ?? '', customerName, prospectName: input.prospectName ?? '', contact: input.contact ?? '', notes: input.notes ?? '',
  lines: input.lines.map((l) => ({ itemId: l.itemId, description: l.description, qty: String(l.qty), extra: l.extraCostCents ? formatPesos(l.extraCostCents) : '',
    extraReason: l.extraReason ?? '', price: l.unitPriceCents === undefined ? '' : formatPesos(l.unitPriceCents), priceReason: l.priceReason ?? '' })),
});

export function EstimateForm({ type, mode }: { type: DocTypeInfo; mode: FormMode; me?: Me }) {
  const [v, setV] = useState<Form>(blank);
  const [original, setOriginal] = useState<DocHeader | null>(null);
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirm, setConfirm] = useState<Preview | null>(null);
  const [error, setError] = useState('');
  const built = useMemo(() => estimateInput(v), [v]);
  const key = JSON.stringify(built.input ?? null);

  useEffect(() => {
    if (mode.kind === 'edit') api.get(type.key, mode.id).then((d) => {
      setOriginal(d.header);
      setV(formOf(d.input as Parameters<typeof formOf>[0], String((d.doc as EstimateDoc | undefined)?.customerName ?? '')));
    }, (e: Error) => setError(e.message));
  }, [type.key, mode.kind, mode.kind === 'edit' ? mode.id : '']);
  useEffect(() => {
    if (!built.input) { setPreview(null); return; }
    let stale = false;
    const timer = setTimeout(() => api.preview(type.key, built.input).then((p) => { if (!stale) setPreview(p); }, (e: Error) => { if (!stale) setError(e.message); }), 400);
    return () => { stale = true; clearTimeout(timer); };
  }, [type.key, key]); // eslint-disable-line react-hooks/exhaustive-deps

  if (mode.kind === 'edit' && original && !reason) return <ReasonDialog title={`Edit ${original.number}`}
    explain="The old estimate will be cancelled and the replacement will get a new number when you record it."
    confirmLabel="Continue to edit" onConfirm={setReason} onClose={() => navigate(docPath(type.key, `/${original.id}`))} />;

  const setLine = (i: number, p: Partial<Line>) => setV({ ...v, lines: v.lines.map((l, j) => (j === i ? { ...l, ...p } : l)) });
  const doc = preview?.doc as EstimateDoc | undefined;
  const record = async (idemKey: string) => {
    try {
      const r = original ? await api.reissue(type.key, original.id, built.input, confirm!.totalCents, reason, idemKey) : await api.post(type.key, built.input, confirm!.totalCents, idemKey);
      navigate(docPath(type.key, `/${r.id}?recorded=1`));
    } catch (e) {
      if (e instanceof ApiError && e.code === 'TOTALS_CHANGED') setConfirm(await api.preview(type.key, built.input));
      throw e;
    }
  };
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{original ? `Edit ${original.number}` : 'New cost estimate'}</h1>
      {error && <Notice>{error}</Notice>}
      {original && <Notice tone="info">Recording will cancel {original.number} and issue a replacement. Reason: {reason}</Notice>}
      <Panel title="Customer or prospect">
        <div className="grid items-end gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <CustomerPicker value={v.customerId ? { id: v.customerId, name: v.customerName } : null} onChange={(c) => setV({ ...v, customerId: c?.id ?? '', customerName: c?.name ?? '', prospectName: '' })} />
          <Field label="Contact"><input className={inputClass} value={v.contact} onChange={(e) => setV({ ...v, contact: e.target.value })} /></Field>
        </div>
        {!v.customerId && <Field label="Or a prospect's name"><input className={inputClass} value={v.prospectName} onChange={(e) => setV({ ...v, prospectName: e.target.value })} /></Field>}
      </Panel>
      <Panel title="Items">
        {v.lines.map((l, i) => {
          const p = doc?.lines[i];
          return (
            <div key={i} className="space-y-2 border-b border-slate-100 pb-3">
              <div className="grid items-end gap-2 sm:grid-cols-[minmax(0,2fr)_6rem_8rem_minmax(0,2fr)_auto]">
                <Field label={`Item ${i + 1}`}><input aria-label={`Item ${i + 1} description`} className={inputClass} value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} /></Field>
                <Field label="Quantity"><input aria-label={`Item ${i + 1} quantity`} inputMode="numeric" className={`${inputClass} text-right`} value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} /></Field>
                <Field label="Extra cost / pc" hint="Optional"><input aria-label={`Item ${i + 1} extra cost`} inputMode="decimal" className={`${inputClass} text-right`} value={l.extra} onChange={(e) => setLine(i, { extra: e.target.value })} /></Field>
                {l.extra.trim() ? <Field label="Extra cost for"><input aria-label={`Item ${i + 1} extra cost for`} className={inputClass} value={l.extraReason} onChange={(e) => setLine(i, { extraReason: e.target.value })} /></Field> : <span />}
                <Button onClick={() => setV({ ...v, lines: v.lines.filter((_, j) => j !== i) })}>Remove</Button>
              </div>
              <div className="grid items-end gap-2 sm:grid-cols-[minmax(0,2fr)_8rem_minmax(0,2fr)]">
                <p className="text-sm tabular-nums">{p ? <>Cost {peso(p.unitCostCents)} · suggested <b>{peso(p.suggestedCents)}</b> ({p.tierFromQty}+ pcs, {p.marginBp / 100}%){p.catalogCents !== null && <> · price list {peso(p.catalogCents)}</>}</> : '…'}</p>
                <Field label="Price each" hint="Empty: the suggested price"><input aria-label={`Item ${i + 1} price`} inputMode="decimal" className={`${inputClass} text-right`} value={l.price} onChange={(e) => setLine(i, { price: e.target.value })} /></Field>
                {l.price.trim() ? <Field label="Why this price"><input aria-label={`Item ${i + 1} price reason`} className={inputClass} value={l.priceReason} onChange={(e) => setLine(i, { priceReason: e.target.value })} /></Field> : <span />}
              </div>
              {p && <p className="text-right text-sm tabular-nums">{l.qty} × {peso(p.priceCents)} = <b>{peso(p.lineTotalCents)}</b> · profit {peso(p.qty * p.profitCents)}</p>}
            </div>
          );
        })}
        {v.lines.length < 30 && <ItemSearch label="Add a price list item" onPick={(it) => setV({ ...v, lines: [...v.lines, { itemId: it.id, description: it.name, qty: '1', extra: '', extraReason: '', price: '', priceReason: '' }] })} />}
      </Panel>
      <Panel title="Notes"><textarea rows={2} className={inputClass} aria-label="Notes" value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} /></Panel>
      <Panel title="The order">
        {built.missing && <Notice tone="warning">{built.missing}</Notice>}
        {doc && preview && (
          <Figures items={[['Cost', doc.costCents], ...(doc.commissionTotalCents ? [['Commission', doc.commissionTotalCents] as [string, number]] : []), ['Profit', doc.profitCents], ['Total', preview.totalCents, 'text-lg font-semibold']]} />
        )}
        {preview && <p className="text-sm">{preview.summary}</p>}
        {preview?.issues.map((x) => <Notice key={x.code + x.field} tone={x.level}>{x.message}</Notice>)}
        <div className="flex flex-wrap gap-2">
          <Button tone="primary" disabled={!type.canPost || !preview} onClick={() => void api.preview(type.key, built.input).then(setConfirm, (e: Error) => setError(e.message))}>Record</Button>
          <Button onClick={() => navigate(docPath(type.key))}>Close</Button>
        </div>
      </Panel>
      {confirm && <RecordDialog type={type} preview={confirm} original={original ?? undefined} reason={reason} onRecord={record} onClose={() => setConfirm(null)} />}
    </div>
  );
}
