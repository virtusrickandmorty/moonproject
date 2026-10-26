/**
 * Deposits not on a job order (the owner's request, 26 Oct 2026): money a customer paid before any job order (a layout
 * fee deposit, and other deposits) is their credit. If they order, it is credited to the job order with a deposit
 * transfer; if they did not, once it is 30 days old from the date paid it may be forfeited as other income. The server
 * works out what is matured, oldest money first.
 */
import { useEffect, useState } from 'react';
import { useLiveChange } from '../../live.ts';
import { api, type Me, type UnappliedDepositRow } from '../../api.ts';
import { Notice, peso, showDate } from '../../components/ui.tsx';
import { Link } from '../../router.tsx';
import { docPath } from '../../shell/menu.ts';
import { Card, FigureStrip, PageHead, TABLE_HEAD } from '../../components/Figures.tsx';

const can = (me: Me, p: string) => me.permissions.includes(p);
const button = 'inline-flex items-center rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50';

export function UnappliedDeposits({ me }: { me: Me }) {
  const [list, setList] = useState<{ days: number; rows: UnappliedDepositRow[] } | null>(null);
  const [error, setError] = useState('');
  const load = () => api.unappliedDeposits().then(setList, (e: Error) => setError(e.message));
  useEffect(() => { load(); }, []);
  useLiveChange(() => load()); // a collection, transfer or forfeit recorded elsewhere
  const rows = list?.rows ?? [];
  const days = list?.days ?? 30;
  const held = rows.reduce((s, r) => s + r.heldCents, 0);
  const matured = rows.reduce((s, r) => s + r.maturedCents, 0);
  const ready = rows.filter((r) => r.maturedCents > 0).length;

  return (
    <div className="space-y-4">
      <PageHead title="Deposits not on a job order" sub={`Money paid before any job order (a layout fee, say). Credit it to the job order when the customer orders; if they do not, it can be forfeited as income ${days} days after it was paid.`} />
      {error && <Notice>{error}</Notice>}
      {list && <FigureStrip label="Deposits at a glance" figures={[
        { label: 'Held for customers', value: peso(held), icon: 'wallet', note: `${rows.length} ${rows.length === 1 ? 'customer' : 'customers'}` },
        { label: `${days} days old or more`, value: peso(matured), icon: 'clock', warn: matured > 0, note: ready ? `${ready} ready to credit or forfeit` : 'None yet' },
        { label: 'Still waiting', value: peso(held - matured), icon: 'calendar', note: 'Their credit for a job order' },
      ]} />}
      <Card title="Deposits held" icon="wallet" note="Oldest payment first">
        {list && rows.length === 0 && <p className="text-sm text-slate-500">No customer has a deposit outside a job order.</p>}
        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className={TABLE_HEAD}>
                <tr><th className="py-2">Customer</th><th>First paid</th><th className="text-right">Held</th><th className="text-right">Can be forfeited</th><th>Status</th><th /></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.customerId} className="border-t border-slate-100 align-top">
                    <td className="py-2"><Link to={`/cus/${r.customerId}`} className="text-indigo-700 underline">{r.customerName}</Link> <span className="text-xs text-slate-500">{r.customerCode}</span></td>
                    <td className="py-2">{showDate(r.firstPaid)}</td>
                    <td className="py-2 text-right tabular-nums">{peso(r.heldCents)}</td>
                    <td className="py-2 text-right tabular-nums">{peso(r.maturedCents)}</td>
                    <td className="py-2">
                      {r.maturedCents > 0
                        ? <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">Ready to forfeit</span>
                        : <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">Waiting</span>}
                      {r.nextMatures && <div className="mt-1 text-xs text-slate-500">{r.maturedCents > 0 ? 'The rest' : 'Matures'} on {showDate(r.nextMatures)}</div>}
                    </td>
                    <td className="py-2">
                      <div className="flex flex-wrap justify-end gap-2">
                        {can(me, 'col.transfer') && <Link to={docPath('col.deposit_transfer', `/new?customer=${r.customerId}`)} className={button}>Credit to a job order</Link>}
                        {can(me, 'col.forfeit') && r.maturedCents > 0 && <Link to={docPath('col.forfeit', `/new?customer=${r.customerId}`)} className={button}>Forfeit</Link>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
