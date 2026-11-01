/**
 * Sales › Costing (the owner's request, Nov 2026): a cost sheet per price list item — the supplies a piece takes, at
 * their latest purchase cost, the piece rates, overhead and setup — and the price each quantity tier should ask, next to
 * the price list's, with suggestions. Costs, margins and commission show with est.cost.view only; others see the prices.
 */
import { useCallback, useEffect, useState } from 'react';
import { parsePesos, formatPesos } from '@moonproject/shared';
import { api, type EstCosting, type EstLineInput, type EstPrices, type EstRules, type EstSheetInput, type EstSheets, type Me } from '../../api.ts';
import { Button, Dialog, Field, Loading, Notice, Panel, inputClass, peso, showDate, useAction } from '../../components/ui.tsx';

const pct = (bp: number) => `${bp / 100}%`;
const money = (text: string): number | null => { try { const c = parsePesos(text); return c >= 0 ? c : null; } catch { return null; } };
/** "1.25" → 1250 (thousandths), without floating point; null for anything else. */
const milli = (text: string): number | null => {
  const m = /^(\d{1,6})(?:\.(\d{1,3}))?$/.exec(text.trim());
  return m ? Number(m[1]) * 1000 + Number((m[2] ?? '').padEnd(3, '0')) : null;
};
const qtyText = (q: number) => String(q / 1000);

export function Costing({ me }: { me: Me }) {
  const [data, setData] = useState<EstSheets | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<string | null>(null); // the item whose sheet is open
  const [rulesOpen, setRulesOpen] = useState(false);
  const load = useCallback(() => void api.estSheets().then((d) => (setData(d), setError('')), (e: Error) => setError(e.message)), []);
  useEffect(load, [load]);
  if (error) return <Notice>{error}</Notice>;
  if (!data) return <Loading />;
  const manage = me.permissions.includes('est.manage');
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Costing</h1>
      <p className="text-sm text-slate-600">What a piece costs to make and the price each quantity should ask, worked out from the supplies' latest purchase costs and the piece rates.</p>
      {data.costs && <RulesSummary rules={data.rules} onEdit={manage ? () => setRulesOpen(true) : undefined} />}
      {manage && <NewSheet onPick={setOpen} />}
      <Panel title="Cost sheets">
        {data.sheets.length === 0 ? <p className="text-sm text-slate-600">No cost sheets yet.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-slate-500"><th className="py-1">Item</th>{data.costs && <th className="text-right">Cost / pc</th>}<th>Suggested price (price list)</th>{data.costs && <th>Suggestions</th>}</tr></thead>
              <tbody>
                {(data.sheets as (EstCosting | EstPrices)[]).map((s) => (
                  <tr key={s.itemId} className="border-t border-slate-100 align-top">
                    <td className="py-1.5">{data.costs ? <button type="button" className="font-medium text-indigo-700 hover:underline" onClick={() => setOpen(s.itemId)}>{s.itemName}</button> : s.itemName}</td>
                    {data.costs && <td className="text-right tabular-nums">{peso((s as EstCosting).directCents + (s as EstCosting).overheadCents)}</td>}
                    <td className="tabular-nums">{s.tiers.map((t) => <span key={t.fromQty} className="mr-3 inline-block">{t.fromQty}+: <b>{peso(t.priceCents)}</b>{t.catalogCents !== null && <span className="text-slate-500"> ({peso(t.catalogCents)})</span>}</span>)}</td>
                    {data.costs && <td className="text-xs text-amber-700">{((n) => (n ? `${n} to look at` : ''))((s as EstCosting).suggestions.filter((x) => x.code !== 'STARTER_RULES').length)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      {open && <Dialog title="Cost sheet" wide onClose={() => setOpen(null)}><SheetEditor itemId={open} manage={manage} onSaved={load} /></Dialog>}
      {rulesOpen && data.costs && <Dialog title="Costing rules" onClose={() => setRulesOpen(false)}><RulesForm rules={data.rules} onSaved={() => { setRulesOpen(false); load(); }} /></Dialog>}
    </div>
  );
}

function RulesSummary({ rules, onEdit }: { rules: EstRules; onEdit?: () => void }) {
  return (
    <Panel title="Costing rules">
      <p className="text-sm">
        Overhead {pct(rules.overheadBp)} of the direct cost · Commission {pct(rules.commissionBp)} of the price · Prices up to the next {peso(rules.roundToCents)} ·
        Margin {rules.tiers.map((t) => `${t.fromQty}+ pcs ${pct(t.marginBp)}`).join(', ')}
      </p>
      {rules.starter && <Notice tone="warning">These are made-up starter numbers. Set your own.</Notice>}
      {onEdit && <Button onClick={onEdit}>Change the rules</Button>}
    </Panel>
  );
}

/** "12.5%", " 10 " → basis points; "1,000" → 1000. Null for anything that is not such a number. */
export const percentBp = (t: string): number | null => {
  const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(t.replace(/[%\s]/g, ''));
  return m ? Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0')) : null;
};
export const wholeNumber = (t: string): number | null => (/^\d{1,6}$/.test(t.replace(/[,\s]/g, '')) ? Number(t.replace(/[,\s]/g, '')) : null);

/** The rules as the server takes them, or each box that is not right yet, in words. */
export function rulesOf(v: { overhead: string; commission: string; roundTo: string; tiers: { fromQty: string; margin: string }[]; reason: string }) {
  const problems: string[] = [];
  const overheadBp = percentBp(v.overhead);
  const commissionBp = percentBp(v.commission);
  if (overheadBp === null || overheadBp > 10_000) problems.push('Overhead: type a percent from 0 to 100, like 10.');
  if (commissionBp === null || commissionBp > 5_000) problems.push('Commission: type a percent from 0 to 50, like 5.');
  const tiers = v.tiers.filter((t) => t.fromQty.trim() || t.margin.trim()).map((t, i) => {
    const fromQty = wholeNumber(t.fromQty);
    const marginBp = percentBp(t.margin);
    if (fromQty === null || fromQty < 1) problems.push(`Tier ${i + 1}: type the pieces it starts from, like 12.`);
    if (marginBp === null || marginBp > 9_000) problems.push(`Tier ${i + 1}: type the margin as a percent up to 90, like 35.`);
    return { fromQty: fromQty ?? 0, marginBp: marginBp ?? 0 };
  });
  if (tiers.length === 0) problems.push('Add at least one tier.');
  else if (!tiers.some((t) => t.fromQty === 1)) problems.push('One tier starts at 1 piece.');
  if (new Set(tiers.map((t) => t.fromQty)).size !== tiers.length) problems.push('Each tier starts at a different number of pieces.');
  if (tiers.some((t) => t.marginBp + (commissionBp ?? 0) >= 9_500)) problems.push('A margin and the commission together must stay under 95%.');
  if (v.reason.trim().length < 10) problems.push('Reason: say why the rules change (10 characters or more).');
  return problems.length ? { problems } : { problems, rules: { overheadBp: overheadBp!, commissionBp: commissionBp!, roundToCents: Number(v.roundTo), tiers, reason: v.reason.trim() } };
}

function RulesForm({ rules, onSaved }: { rules: EstRules; onSaved: () => void }) {
  const [v, setV] = useState({ overhead: String(rules.overheadBp / 100), commission: String(rules.commissionBp / 100), roundTo: String(rules.roundToCents),
    tiers: rules.tiers.map((t) => ({ fromQty: String(t.fromQty), margin: String(t.marginBp / 100) })), reason: '' });
  const a = useAction();
  const checked = rulesOf(v);
  const save = () => a.run(async () => { await api.estSetRules(checked.rules!); onSaved(); });
  const setTier = (i: number, t: Partial<(typeof v.tiers)[number]>) => setV({ ...v, tiers: v.tiers.map((x, j) => (j === i ? { ...x, ...t } : x)) });
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Overhead, % of the direct cost"><input inputMode="decimal" className={inputClass} value={v.overhead} onChange={(e) => setV({ ...v, overhead: e.target.value })} /></Field>
        <Field label="Commission, % of the price"><input inputMode="decimal" className={inputClass} value={v.commission} onChange={(e) => setV({ ...v, commission: e.target.value })} /></Field>
        <Field label="Prices round up to">
          <select className={inputClass} value={v.roundTo} onChange={(e) => setV({ ...v, roundTo: e.target.value })}>{[1, 100, 500, 1000].map((c) => <option key={c} value={c}>{peso(c)}</option>)}</select>
        </Field>
      </div>
      <p className="text-sm font-semibold">Margin wanted, by quantity</p>
      {v.tiers.map((t, i) => (
        <div key={i} className="grid grid-cols-2 gap-3">
          <Field label="From pieces"><input inputMode="numeric" className={inputClass} value={t.fromQty} onChange={(e) => setTier(i, { fromQty: e.target.value })} /></Field>
          <Field label="Margin %"><input inputMode="decimal" className={inputClass} value={t.margin} onChange={(e) => setTier(i, { margin: e.target.value })} /></Field>
        </div>
      ))}
      <Button onClick={() => setV({ ...v, tiers: [...v.tiers, { fromQty: '', margin: '' }] })}>Add a tier</Button>
      <Field label="Reason" required hint="10 characters or more"><input className={inputClass} value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} /></Field>
      {checked.problems.length > 0 && <Notice tone="warning">{checked.problems.join(' ')}</Notice>}
      {a.error && <Notice>{a.error}</Notice>}
      <Button tone="primary" disabled={a.busy || checked.problems.length > 0} onClick={save}>Save the rules</Button>
    </div>
  );
}

function NewSheet({ onPick }: { onPick: (itemId: string) => void }) {
  const [q, setQ] = useState('');
  const [items, setItems] = useState<{ id: string; code: string; name: string }[]>([]);
  useEffect(() => {
    if (q.trim().length < 2) return setItems([]);
    const t = setTimeout(() => void api.estPickers(q).then((p) => setItems(p.items), () => setItems([])), 250);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <Panel title="Open or start a cost sheet">
      <input className={inputClass} placeholder="Type a price list item, like Polo shirt" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Price list item" />
      <div className="flex flex-wrap gap-2">{items.map((i) => <Button key={i.id} onClick={() => onPick(i.id)}>{i.code} {i.name}</Button>)}</div>
    </Panel>
  );
}

type LineForm = { kind: EstLineInput['kind']; mode: 'supply' | 'typed'; supplyId: string; supplyName: string; description: string; qty: string; cost: string };
type SheetForm = { garmentType: string; complexity: EstSheetInput['complexity']; isSet: boolean; setup: string; lines: LineForm[]; reason: string };
const blankLine = (kind: LineForm['kind']): LineForm => ({ kind, mode: kind === 'materials' ? 'supply' : 'typed', supplyId: '', supplyName: '', description: '', qty: '1', cost: '' });

/** The form's input, or the first thing still missing. */
function inputOf(itemId: string, f: SheetForm): { input?: Omit<EstSheetInput, 'reason'>; missing?: string } {
  if (!f.garmentType) return { missing: 'Pick the garment type it is made as.' };
  const setupCents = f.setup.trim() ? money(f.setup) : 0;
  if (setupCents === null) return { missing: 'Type the setup cost like 500.00.' };
  const lines: EstLineInput[] = [];
  for (const [i, l] of f.lines.entries()) {
    const qtyMilli = milli(l.qty);
    if (!qtyMilli) return { missing: `Line ${i + 1}: type how much a piece takes, like 1.25.` };
    if (l.mode === 'supply') {
      if (!l.supplyId) return { missing: `Line ${i + 1}: pick the supply.` };
      lines.push({ kind: l.kind, supplyId: l.supplyId, description: l.description.trim() || l.supplyName, qtyMilli });
    } else {
      const c = money(l.cost);
      if (c === null || !l.description.trim()) return { missing: `Line ${i + 1}: say what it is and type its cost, like 25.00.` };
      lines.push({ kind: l.kind, description: l.description.trim(), qtyMilli, typedCostCents: c });
    }
  }
  return { input: { itemId, garmentType: f.garmentType, complexity: f.complexity, isSet: f.isSet, setupCents, lines } };
}

function SheetEditor({ itemId, manage, onSaved }: { itemId: string; manage: boolean; onSaved: () => void }) {
  const [form, setForm] = useState<SheetForm | null>(null);
  const [name, setName] = useState('');
  const [types, setTypes] = useState<string[]>([]);
  const [costing, setCosting] = useState<EstCosting | null>(null);
  const [error, setError] = useState('');
  const a = useAction();
  useEffect(() => {
    void Promise.all([api.estSheet(itemId), manage ? api.estPickers() : Promise.resolve({ garmentTypes: [] as string[] })]).then(([r, p]) => {
      setName(`${r.item.code} ${r.item.name}`);
      setTypes(p.garmentTypes);
      const s = r.sheet as EstCosting | null;
      setForm(s ? {
        garmentType: s.garmentType, complexity: s.complexity, isSet: s.isSet, setup: formatPesos(s.setupCents), reason: '',
        lines: s.lines.map((l) => ({ kind: l.kind, mode: l.supplyId ? 'supply' : 'typed', supplyId: l.supplyId ?? '', supplyName: l.description, description: l.description, qty: qtyText(l.qtyMilli), cost: l.typedCostCents === undefined ? '' : formatPesos(l.typedCostCents) })),
      } : { garmentType: r.garmentTypeGuess ?? '', complexity: 'standard', isSet: r.item.unit === 'set', setup: '', reason: '', lines: [blankLine('materials')] });
      if (s) setCosting(s);
    }, (e: Error) => setError(e.message));
  }, [itemId, manage]);
  const built = form ? inputOf(itemId, form) : {};
  const key = JSON.stringify(built.input ?? null);
  useEffect(() => { // the figures again, a moment after each change
    if (!built.input) return;
    const t = setTimeout(() => void api.estPreview(built.input!).then((c) => (setCosting(c), setError('')), (e: Error) => setError(e.message)), 400);
    return () => clearTimeout(t);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!form) return error ? <Notice>{error}</Notice> : <Loading />;
  const setLine = (i: number, l: Partial<LineForm>) => setForm({ ...form, lines: form.lines.map((x, j) => (j === i ? { ...x, ...l } : x)) });
  const save = () => a.run(async () => { setCosting(await api.estSave({ ...built.input!, reason: form.reason.trim() })); setForm({ ...form, reason: '' }); onSaved(); });
  return (
    <div className="space-y-4">
      <p className="font-semibold">{name}{costing?.savedAt && <span className="font-normal text-slate-500"> · saved {showDate(costing.savedAt.slice(0, 10))}</span>}</p>
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Made as (piece rates)" required>
          <select className={inputClass} value={form.garmentType} disabled={!manage} onChange={(e) => setForm({ ...form, garmentType: e.target.value })}>
            <option value="">Pick…</option>{types.map((t) => <option key={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="Complexity">
          <select className={inputClass} value={form.complexity} disabled={!manage} onChange={(e) => setForm({ ...form, complexity: e.target.value as SheetForm['complexity'] })}>
            <option value="simple">Simple</option><option value="standard">Standard</option><option value="complex">Complex</option>
          </select>
        </Field>
        <Field label="Setup per order" hint="Layout, sample: spread over the pieces"><input inputMode="decimal" className={inputClass} value={form.setup} disabled={!manage} onChange={(e) => setForm({ ...form, setup: e.target.value })} /></Field>
        <label className="flex items-center gap-2 pt-6 text-sm"><input type="checkbox" checked={form.isSet} disabled={!manage} onChange={(e) => setForm({ ...form, isSet: e.target.checked })} /> A set (upper and lower)</label>
      </div>
      <Panel title="What a piece takes">
        {form.lines.map((l, i) => <LineRow key={i} l={l} figures={costing?.lines[i]} manage={manage} onChange={(x) => setLine(i, x)} />)}
        {manage && <div className="flex gap-2"><Button onClick={() => setForm({ ...form, lines: [...form.lines, blankLine('materials')] })}>Add a material</Button><Button onClick={() => setForm({ ...form, lines: [...form.lines, blankLine('sublimation')] })}>Add sublimation</Button></div>}
      </Panel>
      {built.missing && <Notice tone="warning">{built.missing}</Notice>}
      {error && <Notice>{error}</Notice>}
      {costing && <Figures c={costing} />}
      {manage && (
        <div className="flex flex-wrap items-end gap-3">
          <div className="grow"><Field label="What changed" required hint="5 characters or more"><input className={inputClass} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></Field></div>
          <Button tone="primary" disabled={a.busy || !built.input || form.reason.trim().length < 5} onClick={save}>Save the cost sheet</Button>
        </div>
      )}
      {a.error && <Notice>{a.error}</Notice>}
    </div>
  );
}

function LineRow({ l, figures, manage, onChange }: { l: LineForm; figures?: EstCosting['lines'][number]; manage: boolean; onChange: (l: Partial<LineForm>) => void }) {
  const [found, setFound] = useState<{ id: string; name: string; unit: string }[]>([]);
  const find = (text: string) => {
    const hit = found.find((s) => s.name === text);
    onChange(hit ? { supplyName: hit.name, supplyId: hit.id, description: hit.name } : { supplyName: text, supplyId: '' });
    if (!hit && text.trim().length >= 2) void api.estPickers(text).then((p) => setFound(p.supplies), () => undefined);
  };
  const [list] = useState(() => `supplies-${Math.random().toString(36).slice(2, 8)}`);
  return (
    <div className="grid items-end gap-2 border-b border-slate-100 pb-2 sm:grid-cols-[8rem_1fr_7rem_8rem_8rem]">
      <span className="pb-2 text-sm text-slate-600">{l.kind === 'materials' ? 'Material' : 'Sublimation'}</span>
      {l.mode === 'supply'
        ? <Field label="Supply"><input className={inputClass} list={list} value={l.supplyName} disabled={!manage} onChange={(e) => find(e.target.value)} /><datalist id={list}>{found.map((s) => <option key={s.id} value={s.name}>{s.unit}</option>)}</datalist></Field>
        : <Field label="What it is"><input className={inputClass} value={l.description} disabled={!manage} onChange={(e) => onChange({ description: e.target.value })} /></Field>}
      <Field label={`Per piece${figures ? ` (${figures.unit})` : ''}`}><input inputMode="decimal" className={inputClass} value={l.qty} disabled={!manage} onChange={(e) => onChange({ qty: e.target.value })} /></Field>
      {l.mode === 'typed'
        ? <Field label="Cost each"><input inputMode="decimal" className={inputClass} value={l.cost} disabled={!manage} onChange={(e) => onChange({ cost: e.target.value })} /></Field>
        : <span className="pb-2 text-sm tabular-nums" title={figures?.costSource}>{figures ? `${peso(figures.unitCostCents)} / ${figures.unit}` : ''}</span>}
      <span className="pb-2 text-right text-sm font-semibold tabular-nums">
        {figures ? peso(figures.costCents) : ''}
        {manage && <button type="button" className="ml-2 text-xs font-normal text-indigo-700 hover:underline" onClick={() => onChange({ mode: l.mode === 'supply' ? 'typed' : 'supply', supplyId: '', supplyName: '', cost: '' })}>{l.mode === 'supply' ? 'type a cost' : 'pick a supply'}</button>}
      </span>
    </div>
  );
}

function Figures({ c }: { c: EstCosting }) {
  const row = (label: string, cents: number, strong = false) => <tr className="border-t border-slate-100"><td className="py-1">{label}</td><td className={`text-right tabular-nums ${strong ? 'font-semibold' : ''}`}>{peso(cents)}</td></tr>;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title="Cost of a piece">
        <table className="w-full text-sm"><tbody>
          {row('Materials', c.materialsCents)}
          {row('Sublimation', c.sublimationCents)}
          {row(`Labour: ${c.labour.map((l) => `${l.stepName}${l.part === 'whole' ? '' : ` (${l.part})`} ${peso(l.rateCents)}`).join(', ') || 'no piece rate'}`, c.labourCents)}
          {row(`Overhead ${pct(c.rules.overheadBp)}`, c.overheadCents)}
          {row('Cost before setup', c.directCents + c.overheadCents, true)}
        </tbody></table>
      </Panel>
      <Panel title="Price by quantity">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-slate-500"><th>Pieces</th><th className="text-right">Cost</th><th className="text-right">Suggested</th><th className="text-right">Profit</th><th className="text-right">Price list</th></tr></thead>
          <tbody>{c.tiers.map((t) => (
            <tr key={t.fromQty} className="border-t border-slate-100">
              <td className="py-1">{t.fromQty}+ <span className="text-slate-500">({pct(t.marginBp)})</span></td>
              <td className="text-right tabular-nums">{peso(t.costCents)}</td>
              <td className="text-right font-semibold tabular-nums">{peso(t.priceCents)}</td>
              <td className="text-right tabular-nums">{peso(t.profitCents)}{t.commissionCents > 0 && <span className="block text-xs text-slate-500">commission {peso(t.commissionCents)}</span>}</td>
              <td className={`text-right tabular-nums ${t.catalogCents !== null && t.catalogCents < t.costCents ? 'font-semibold text-red-700' : ''}`}>{t.catalogCents === null ? '—' : peso(t.catalogCents)}</td>
            </tr>
          ))}</tbody>
        </table>
      </Panel>
      {c.suggestions.length > 0 && (
        <div className="space-y-2 lg:col-span-2">
          <p className="text-sm font-semibold">Suggestions</p>
          {c.suggestions.map((s, i) => <Notice key={i} tone={s.level === 'warning' ? 'warning' : 'info'}>{s.message}</Notice>)}
        </div>
      )}
    </div>
  );
}
