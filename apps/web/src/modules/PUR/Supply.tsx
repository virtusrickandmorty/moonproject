import { useEffect, useState } from 'react';
import { api, type SupplyRecord } from '../../api.ts';
import { Notice, Panel, peso } from '../../components/ui.tsx';
import { Link } from '../../router.tsx';
import { CATEGORY_WORDS, UNIT_WORDS } from './purchasing.ts';
import { costSource } from './Supplies.tsx';
import { Crumb } from '../../shell/crumbs.tsx';

export function SupplyPage({ params }: { params?: Record<string, string> }) {
  return <SupplyView id={params?.id ?? ''} />;
}

/** One supply's details and the suppliers that sell it: its page, or a dialog over the supplies list (`inDialog`). */
export function SupplyView({ id, inDialog = false }: { id: string; inDialog?: boolean }) {
  const [supply, setSupply] = useState<SupplyRecord | null>(null);
  const [error, setError] = useState('');
  const [suppliers, setSuppliers] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => void api.supply(id).then(setSupply, (e: Error) => setError(e.message)), [id]);
  useEffect(() => void api.supplySuppliers(id).then(setSuppliers, () => undefined), [id]);
  if (error) return <Notice>{error}</Notice>;
  if (!supply) return <p className="text-slate-500">Loading…</p>;
  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-center gap-3">{!inDialog && <Crumb label={supply.name} />}<h1 className="flex-1 text-2xl font-semibold">{supply.name}</h1>{!inDialog && <Link to="/pur/supplies" className="text-sm underline">All supplies</Link>}</div>
      <Panel title="Details">
        <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          <dt className="text-slate-500">Unit</dt><dd>{UNIT_WORDS[supply.unit]}</dd>
          <dt className="text-slate-500">Kind</dt><dd>{CATEGORY_WORDS[supply.category]}</dd>
          <dt className="text-slate-500">Status</dt><dd>{supply.is_active ? 'Active' : 'Inactive'}</dd>
          <dt className="text-slate-500">Last purchase cost</dt><dd className="tabular-nums">{peso(supply.purchase_cost_cents)}</dd>
          <dt className="text-slate-500">Cost from</dt><dd>{costSource(supply)}</dd>
        </dl>
      </Panel>
      {/* The suppliers it is linked to (on each supplier's page; the owner's request, Oct 2026). */}
      <Panel title="Sold by">
        {suppliers.length === 0 ? <p className="text-sm text-slate-500">Not linked to a supplier yet. Link it on the supplier's page.</p>
          : <p className="flex flex-wrap gap-x-4 text-sm">{suppliers.map((s) => <Link key={s.id} to={`/pur/suppliers/${s.id}`} className="text-indigo-700 underline">{s.name}</Link>)}</p>}
      </Panel>
    </div>
  );
}
