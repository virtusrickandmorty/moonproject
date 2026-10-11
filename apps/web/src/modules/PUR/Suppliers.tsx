/**
 * Suppliers (PLAN E9): the list with search and an active or inactive filter. A new supplier and a supplier clicked open in
 * a dialog over the list (the owner's request, Oct 2026); its own page stays at /pur/suppliers/<id>.
 */
import { useCallback, useEffect, useState } from 'react';
import { api, type DocTypeInfo, type Me, type PurStatus, type SupplierRecord } from '../../api.ts';
import { Button, Dialog, Notice, inputClass, searchClass, searchRowClass } from '../../components/ui.tsx';
import { NewSupplierForm, SupplierView } from './Supplier.tsx';
import { EWT_WORDS, filterSuppliers } from './purchasing.ts';

export function Suppliers({ me, docTypes = [] }: { me: Me; docTypes?: DocTypeInfo[] }) {
  const [rows, setRows] = useState<SupplierRecord[] | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<PurStatus>('active');
  const [error, setError] = useState('');
  const [open, setOpen] = useState<string | 'new' | null>(null);
  const load = useCallback(() => api.supplierList(status).then((r) => (setRows(r), setError('')), (e: Error) => setError(e.message)), [status]);
  useEffect(() => void load(), [load]);
  const shown = rows && filterSuppliers(rows, search);

  return (
    <div className="max-w-5xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Suppliers</h1>
        {me.permissions.includes('pur.supplier.edit') && <Button tone="primary" onClick={() => setOpen('new')}>+ New supplier</Button>}
      </div>
      <div className={searchRowClass}>
        <input aria-label="Search suppliers" placeholder="Search name or TIN" className={`${inputClass} ${searchClass}`} value={search} onChange={(e) => setSearch(e.target.value)} />
        <select aria-label="Show" className={`${inputClass} max-w-40`} value={status} onChange={(e) => setStatus(e.target.value as PurStatus)}>
          <option value="active">Active</option><option value="inactive">Inactive</option><option value="all">All</option>
        </select>
      </div>
      {error && <Notice>{error}</Notice>}
      {shown && (
        <div className="overflow-x-auto">
          <table className="w-full rounded-xl bg-white text-sm shadow-sm ring-1 ring-slate-200/70 [&_td]:px-2 [&_td]:py-2 [&_th]:px-2 [&_th]:py-2">
            <thead className="text-left text-slate-500"><tr><th>Name</th><th>Registered name</th><th>TIN</th><th>VAT</th><th>Usual tax withheld (EWT)</th><th>Terms</th><th>Status</th></tr></thead>
            <tbody>
              {shown.map((s) => (
                <tr key={s.id} tabIndex={0} onClick={() => setOpen(s.id)} onKeyDown={(e) => { if (e.key === 'Enter') setOpen(s.id); }}
                  className={`cursor-pointer border-t border-slate-100 ${s.is_active ? '' : 'text-slate-500'}`}>
                  <td className="font-medium text-indigo-700">{s.name}</td>
                  <td>{s.registered_name}</td><td>{s.tin ?? ''}</td><td>{s.is_vat_registered ? 'VAT' : 'Non-VAT'}</td>
                  <td>{s.ewt_class ? EWT_WORDS[s.ewt_class] ?? s.ewt_class : 'None'}</td>
                  <td>{s.payment_terms_days === null ? '' : `${s.payment_terms_days} days`}</td><td>{s.is_active ? 'Active' : 'Inactive'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {shown?.length === 0 && <p className="text-sm text-slate-500">No supplier matches.</p>}
      {open === 'new' && <Dialog title="New supplier" size="full" onClose={() => setOpen(null)}>
        <NewSupplierForm onAdded={(id) => { setOpen(id); void load(); }} />
      </Dialog>}
      {open && open !== 'new' && <Dialog title="Supplier" size="full" hideTitle onClose={() => setOpen(null)}>
        <SupplierView me={me} docTypes={docTypes} id={open} inDialog onChanged={() => void load()} />
      </Dialog>}
    </div>
  );
}
