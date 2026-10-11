/**
 * One supplier (PLAN E9): add or change it (If-Match), deactivate it, its contacts, its open balance and bills from AP
 * (ap.ledger.view), and its purchase orders and receiving reports (pur.po.view, pur.rr.view).
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api, type ApLedger, type DocTypeInfo, type Me, type SupplierContact, type SupplierPo, type SupplierRecord, type SupplierRr, type SupplyRecord } from '../../api.ts';
import { Button, Dialog, Field, Notice, Panel, StatusChip, inputClass, peso, useAction } from '../../components/ui.tsx';
import { Link, navigate } from '../../router.tsx';
import { docPath } from '../../shell/menu.ts';
import { EWT_WORDS, UNIT_WORDS, contactToInput, emptyContactForm, emptySupplierForm, needsSwornDeclaration, supplierToForm, supplierToInput, type ContactForm, type SupplierForm } from './purchasing.ts';
import { Crumb } from '../../shell/crumbs.tsx';

export function SupplierPage({ me, docTypes, params }: { me: Me; docTypes: DocTypeInfo[]; params?: Record<string, string> }) {
  const id = params?.id;
  if (!id) return <NewSupplier canEdit={me.permissions.includes('pur.supplier.edit')} />;
  return <SupplierView me={me} docTypes={docTypes} id={id} />;
}

/**
 * One supplier's details, contacts, supplies, balance, orders and receipts: its own page, or a dialog over the supplier list
 * (`inDialog`: no page crumb and no "All suppliers" link; the owner's request, Oct 2026: purchasing forms open in a modal).
 */
export function SupplierView({ me, docTypes, id, inDialog = false, onChanged }: { me: Me; docTypes: DocTypeInfo[]; id: string; inDialog?: boolean; onChanged?: () => void }) {
  const [supplier, setSupplier] = useState<SupplierRecord | null>(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const load = useCallback(() => api.supplier(id).then((s) => (setSupplier(s), onChanged?.()), (e: Error) => setError(e.message)), [id]);
  useEffect(() => void load(), [load]);
  const can = (p: string) => me.permissions.includes(p);
  const canEdit = can('pur.supplier.edit');
  if (error) return <Notice>{error}</Notice>;
  if (!supplier) return <p className="text-slate-500">Loading…</p>;
  const linkable = (key: string) => docTypes.some((d) => d.key === key);

  return (
    <div className={`space-y-4 ${inDialog ? 'pr-8' : 'max-w-4xl'}`}>
      <div className="flex flex-wrap items-center gap-3">
        {!inDialog && <Crumb label={supplier.name} />}<h1 className="text-2xl font-semibold">{supplier.name}</h1>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${supplier.is_active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700'}`}>{supplier.is_active ? 'Active' : 'Inactive'}</span>
        <span className="flex-1" />
        {!inDialog && <Link to="/pur/suppliers" className="text-sm underline">All suppliers</Link>}
        {supplier.is_active === 1 && canEdit && <Deactivate supplier={supplier} onDone={load} />}
      </div>
      {!supplier.is_active && <Notice tone="info">This supplier is inactive. It stays on file with its history, and cannot be picked for new orders or bills.</Notice>}
      <Details key={supplier.version} supplier={supplier} editable={supplier.is_active === 1 && canEdit} done={saved} onSaved={() => (setSaved('Saved.'), load())} />
      <Contacts supplier={supplier} editable={supplier.is_active === 1 && canEdit} />
      {can('pur.supply.view') && <SuppliesSold supplier={supplier} editable={supplier.is_active === 1 && canEdit} />}
      {can('ap.ledger.view') && <Owed supplierId={supplier.id} canOpen={(t) => linkable(t)} />}
      {can('pur.po.view') && <Orders supplierId={supplier.id} />}
      {can('pur.rr.view') && <Receipts supplierId={supplier.id} />}
    </div>
  );
}

function NewSupplier({ canEdit }: { canEdit: boolean }) {
  return (
    <div className="max-w-4xl space-y-4">
      <h1 className="text-2xl font-semibold">New supplier</h1>
      {canEdit ? <NewSupplierForm onAdded={(id) => navigate(`/pur/suppliers/${id}`)} /> : <Notice>Only the accountant or an owner adds suppliers.</Notice>}
    </div>
  );
}

/** The new-supplier form alone: on its page, or in a dialog over the supplier list. */
export function NewSupplierForm({ onAdded }: { onAdded: (id: string) => void }) {
  return <SupplierFields initial={emptySupplierForm()} editable saveLabel="Add supplier" onSave={async (input) => onAdded((await api.addSupplier(input)).id)} />;
}

/** Remounted on every new version, so the fields always show what the server holds. */
function Details({ supplier, editable, done, onSaved }: { supplier: SupplierRecord; editable: boolean; done: string; onSaved: () => Promise<unknown> }) {
  return (
    <SupplierFields initial={supplierToForm(supplier)} editable={editable} saveLabel="Save changes" done={done}
      onSave={async (input) => { await api.updateSupplier(supplier.id, supplier.version, input); await onSaved(); }} />
  );
}

function SupplierFields({ initial, editable, saveLabel, done, onSave }: { initial: SupplierForm; editable: boolean; saveLabel: string; done?: string; onSave: (input: ReturnType<typeof supplierToInput>['input']) => Promise<unknown> }) {
  const [v, setV] = useState(initial);
  const [touched, setTouched] = useState(false);
  const a = useAction();
  const { input, errors } = supplierToInput(v);
  const text = (k: keyof SupplierForm, label: string, opts: { required?: boolean; hint?: string; type?: string } = {}) => (
    <Field label={label} required={opts.required} hint={opts.hint}>
      <input type={opts.type} disabled={!editable} className={inputClass} value={v[k] as string} onChange={(e) => setV({ ...v, [k]: e.target.value })} />
    </Field>
  );
  return (
    <Panel title="Details">
      <div className="grid gap-3 sm:grid-cols-2">
        {text('name', 'Name (as staff call it)', { required: true })}
        {text('registeredName', 'Registered name', { required: true, hint: 'The name on its receipts and BIR registration; it goes on the 2307.' })}
        {text('tin', 'TIN', { hint: 'Like 123-456-789-000' })}
        {text('paymentTermsDays', 'Payment terms (days)', { hint: 'How many days after its invoice we pay.' })}
        <Field label="Usual tax withheld from supplier (EWT)" hint="Bills from this supplier start with this class; the accountant may change it on a bill.">
          <select disabled={!editable} className={inputClass} value={v.ewtClass} onChange={(e) => setV({ ...v, ewtClass: e.target.value })}>
            <option value="">No tax withheld (EWT)</option>
            {Object.entries(EWT_WORDS).map(([k, w]) => <option key={k} value={k}>{w}</option>)}
          </select>
        </Field>
        {text('swornDeclarationUntil', 'Sworn declaration valid until', { type: 'date', hint: needsSwornDeclaration(v.ewtClass) ? 'Required for the 5% professional rate.' : 'Only for professionals using the lower rate.' })}
        {text('legacyId', 'Old record no. (optional)')}
        <label className="flex items-center gap-2 self-end text-sm">
          <input type="checkbox" disabled={!editable} checked={v.isVatRegistered} onChange={(e) => setV({ ...v, isVatRegistered: e.target.checked })} /> VAT-registered
        </label>
      </div>
      {touched && errors.map((e) => <Notice key={e}>{e}</Notice>)}
      {a.error && <Notice>{a.error}</Notice>}
      {done && !a.error && <Notice tone="success">{done}</Notice>}
      {editable && <Button tone="primary" disabled={a.busy} onClick={() => (setTouched(true), errors.length === 0 && a.run(() => onSave(input)))}>{saveLabel}</Button>}
    </Panel>
  );
}

function Deactivate({ supplier, onDone }: { supplier: SupplierRecord; onDone: () => Promise<unknown> }) {
  const [open, setOpen] = useState(false);
  const a = useAction();
  return (
    <>
      <Button tone="danger" onClick={() => setOpen(true)}>Deactivate</Button>
      {open && (
        <Dialog title={`Deactivate ${supplier.name}?`} onClose={() => setOpen(false)}>
          <p className="text-sm">The supplier stays on file with every order, bill and payment. It can no longer be picked for new purchase orders or bills, and its details cannot be changed.</p>
          {a.error && <Notice>{a.error}</Notice>}
          <div className="flex justify-end gap-2">
            <Button onClick={() => setOpen(false)}>Keep active</Button>
            <Button tone="danger" disabled={a.busy} onClick={() => a.run(async () => { await api.deactivateSupplier(supplier.id, supplier.version); setOpen(false); await onDone(); })}>Deactivate</Button>
          </div>
        </Dialog>
      )}
    </>
  );
}

/**
 * The supplies this supplier sells (the owner's request, Oct 2026): linked here, listed first on a purchase order from
 * it. A link is switched off, never deleted.
 */
function SuppliesSold({ supplier, editable }: { supplier: SupplierRecord; editable: boolean }) {
  const [linked, setLinked] = useState<SupplyRecord[]>([]);
  const [all, setAll] = useState<SupplyRecord[]>([]);
  const [pick, setPick] = useState('');
  const a = useAction();
  const load = useCallback(() => api.supplierSupplies(supplier.id).then(setLinked, () => undefined), [supplier.id]);
  useEffect(() => { void load(); if (editable) api.supplyList('active').then(setAll, () => undefined); }, [load, editable]);
  const link = (supplyId: string, on: boolean) => a.run(async () => { await api.linkSupply(supplier.id, supplyId, on); setPick(''); await load(); });
  const free = all.filter((s) => !linked.some((l) => l.id === s.id));
  return (
    <Panel title="Supplies from this supplier">
      {linked.length === 0 && <p className="text-sm text-slate-500">No supply is linked yet. Link the ones this supplier sells: they come first on its purchase orders.</p>}
      {linked.length > 0 && (
        <table className="w-full text-sm">
          <thead className="text-left text-slate-500"><tr><th>Supply</th><th>Unit</th><th className="text-right">Last cost</th><th /></tr></thead>
          <tbody>
            {linked.map((s) => (
              <tr key={s.id} className="border-t border-slate-100">
                <td className="py-1"><Link to={`/pur/supplies/${s.id}`} className="text-indigo-700 underline">{s.name}</Link></td>
                <td>{UNIT_WORDS[s.unit]}</td>
                <td className="text-right tabular-nums">{s.purchase_cost_cents ? peso(s.purchase_cost_cents) : '—'}</td>
                <td className="text-right">{editable && <button type="button" className="text-slate-500 underline" onClick={() => void link(s.id, false)}>Unlink</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {editable && (
        <div className="flex max-w-xl gap-2 border-t border-slate-100 pt-2">
          <select aria-label="Supply to link" className={inputClass} value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">Pick a supply to link…</option>
            {free.map((s) => <option key={s.id} value={s.id}>{s.name} ({UNIT_WORDS[s.unit].toLowerCase()})</option>)}
          </select>
          <Button disabled={!pick || a.busy} onClick={() => void link(pick, true)}>Link supply</Button>
        </div>
      )}
      {a.error && <Notice>{a.error}</Notice>}
    </Panel>
  );
}

function Contacts({ supplier, editable }: { supplier: SupplierRecord; editable: boolean }) {
  const [rows, setRows] = useState<SupplierContact[]>([]);
  const [v, setV] = useState<ContactForm>(emptyContactForm());
  const [touched, setTouched] = useState(false);
  const a = useAction();
  const load = useCallback(() => api.supplierContacts(supplier.id).then(setRows, () => undefined), [supplier.id]);
  useEffect(() => void load(), [load]);
  const { input, errors } = contactToInput(v);
  const add = () => a.run(async () => { await api.addSupplierContact(supplier.id, input); setV(emptyContactForm()); setTouched(false); await load(); });
  const set = (k: keyof ContactForm) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  return (
    <Panel title="Contacts">
      {rows.length === 0 && <p className="text-sm text-slate-500">No contact on file.</p>}
      {rows.map((c) => (
        <p key={c.id} className="flex flex-wrap items-center gap-x-4 text-sm">
          <b>{c.name}</b><span className="text-slate-600">{[c.role, c.phone, c.email].filter(Boolean).join(' · ')}</span>
          {editable && <button type="button" className="text-slate-500 underline" onClick={() => a.run(async () => { await api.deactivateSupplierContact(supplier.id, c.id); await load(); })}>Remove</button>}
        </p>
      ))}
      {editable && (
        <div className="space-y-2 border-t border-slate-100 pt-2">
          <div className="grid gap-2 sm:grid-cols-4">
            <input aria-label="Contact name" placeholder="Name" className={inputClass} value={v.name} onChange={set('name')} />
            <input aria-label="Contact role" placeholder="Role (sales, accounting…)" className={inputClass} value={v.role} onChange={set('role')} />
            <input aria-label="Contact phone" placeholder="Mobile, like 0917 123 4567" className={inputClass} value={v.phone} onChange={set('phone')} />
            <input aria-label="Contact email" placeholder="Email" className={inputClass} value={v.email} onChange={set('email')} />
          </div>
          {touched && errors.map((e) => <Notice key={e}>{e}</Notice>)}
          <Button disabled={a.busy} onClick={() => (setTouched(true), errors.length === 0 && add())}>Add contact</Button>
        </div>
      )}
      {a.error && <Notice>{a.error}</Notice>}
    </Panel>
  );
}

/** What we owe this supplier and its bills, from AP's ledger (read-only). */
function Owed({ supplierId, canOpen }: { supplierId: string; canOpen: (docType: string) => boolean }) {
  const [l, setL] = useState<ApLedger | null>(null);
  const [error, setError] = useState('');
  useEffect(() => void api.apLedger(supplierId).then(setL, (e: Error) => setError(e.message)), [supplierId]);
  if (error) return <Panel title="Bills and what we owe"><Notice>{error}</Notice></Panel>;
  if (!l) return <Panel title="Bills and what we owe"><p className="text-sm text-slate-500">Loading…</p></Panel>;
  return (
    <Panel title="Bills and what we owe">
      <p className="text-sm">We owe this supplier <b className="text-lg tabular-nums">{peso(l.balanceCents)}</b> (open balance).</p>
      {l.bills.length === 0 ? <p className="text-sm text-slate-500">No bills yet.</p> : (
        <Table head={['Bill', 'Invoice no.', 'Due', 'Owed now', '']}
          rows={l.bills.map((b) => ({ key: b.id, cancelled: b.status === 'cancelled', cells: [
            canOpen(b.docType ?? 'ap.bill') ? <Link key="n" to={docPath(b.docType ?? 'ap.bill', `/${b.id}`)} className="text-indigo-700 underline">{b.number}</Link> : b.number,
            b.supplierInvoiceNo, b.dueDate, <span key="o" className="tabular-nums">{peso(b.owedCents)}</span>, <StatusChip key="s" status={b.status} />] }))} right={[3]} />
      )}
    </Panel>
  );
}

function Orders({ supplierId }: { supplierId: string }) {
  const [rows, setRows] = useState<SupplierPo[] | null>(null);
  useEffect(() => void api.supplierPurchaseOrders(supplierId).then(setRows, () => setRows([])), [supplierId]);
  return (
    <Panel title="Purchase orders">
      {rows && rows.length === 0 && <p className="text-sm text-slate-500">No purchase orders yet.</p>}
      {rows && rows.length > 0 && (
        <Table head={['Order', 'Date', 'Expected', 'Total', 'Received', '']}
          rows={rows.map((p) => ({ key: p.id, cancelled: p.status === 'cancelled', cells: [
            <Link key="n" to={docPath('pur.po', `/${p.id}`)} className="text-indigo-700 underline">{p.number}</Link>, p.date, p.expectedDate ?? '',
            <span key="t" className="tabular-nums">{peso(p.totalCents)}</span>, p.status === 'cancelled' ? '' : p.fullyReceived ? 'All received' : 'Still open', <StatusChip key="s" status={p.status} />] }))} right={[3]} />
      )}
    </Panel>
  );
}

function Receipts({ supplierId }: { supplierId: string }) {
  const [rows, setRows] = useState<SupplierRr[] | null>(null);
  useEffect(() => void api.supplierReceivingReports(supplierId).then(setRows, () => setRows([])), [supplierId]);
  return (
    <Panel title="Receiving reports">
      {rows && rows.length === 0 && <p className="text-sm text-slate-500">Nothing received yet.</p>}
      {rows && rows.length > 0 && (
        <Table head={['Report', 'Date', 'For order', '']}
          rows={rows.map((r) => ({ key: r.id, cancelled: r.status === 'cancelled', cells: [
            <Link key="n" to={docPath('pur.rr', `/${r.id}`)} className="text-indigo-700 underline">{r.number}</Link>, r.date,
            <Link key="p" to={docPath('pur.po', `/${r.poId}`)} className="text-indigo-700 underline">{r.poNumber}</Link>, <StatusChip key="s" status={r.status} />] }))} right={[]} />
      )}
    </Panel>
  );
}

function Table({ head, rows, right }: { head: string[]; rows: { key: string; cancelled: boolean; cells: ReactNode[] }[]; right: number[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm [&_td]:py-1 [&_td]:pr-3 [&_th]:pr-3">
        <thead className="text-left text-slate-500"><tr>{head.map((h, i) => <th key={h + i} className={right.includes(i) ? 'text-right' : ''}>{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className={`border-t border-slate-100 ${r.cancelled ? 'text-slate-400 line-through' : ''}`}>
              {r.cells.map((c, i) => <td key={i} className={right.includes(i) ? 'text-right' : ''}>{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
