/** Suppliers (PLAN E9): the list with search and an active or inactive filter; a new supplier opens its own page (pur.supplier.edit). */
import { useCallback, useEffect, useState } from 'react';
import { api, type Me, type PurStatus, type SupplierRecord } from '../../api.ts';
import { Button, Notice, inputClass } from '../../components/ui.tsx';
import { Link, navigate } from '../../router.tsx';
import { EWT_WORDS, filterSuppliers } from './purchasing.ts';

export function Suppliers({ me }: { me: Me }) {
  const [rows, setRows] = useState<SupplierRecord[] | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<PurStatus>('active');
  const [error, setError] = useState('');
  const load = useCallback(() => api.supplierList(status).then((r) => (setRows(r), setError('')), (e: Error) => setError(e.message)), [status]);
  useEffect(() => void load(), [load]);
  const shown = rows && filterSuppliers(rows, search);

  return (
    <div className="max-w-5xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Suppliers</h1>
        {me.permissions.includes('pur.supplier.edit') && <Button tone="primary" onClick={() => navigate('/pur/suppliers/new')}>+ New supplier</Button>}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <input aria-label="Search suppliers" placeholder="Search name or TIN" className={`${inputClass} max-w-xs`} value={search} onChange={(e) => setSearch(e.target.value)} />
        <select aria-label="Show" className={`${inputClass} max-w-40`} value={status} onChange={(e) => setStatus(e.target.value as PurStatus)}>
          <option value="active">Active</option><option value="inactive">Inactive</option><option value="all">All</option>
        </select>
      </div>
      {error && <Notice>{error}</Notice>}
      {shown && (
        <div className="overflow-x-auto">
          <table className="w-full rounded-lg bg-white text-sm shadow-sm ring-1 ring-slate-200 [&_td]:px-2 [&_td]:py-2 [&_th]:px-2 [&_th]:py-2">
            <thead className="text-left text-slate-500"><tr><th>Name</th><th>Registered name</th><th>TIN</th><th>VAT</th><th>Usual EWT</th><th>Terms</th><th>Status</th></tr></thead>
            <tbody>
              {shown.map((s) => (
                <tr key={s.id} className={`border-t border-slate-100 ${s.is_active ? '' : 'text-slate-500'}`}>
                  <td><Link to={`/pur/suppliers/${s.id}`} className="text-indigo-700 underline">{s.name}</Link></td>
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
    </div>
  );
}
