/**
 * Reversals due (PLAN E12, reversing journal vouchers): accruals marked "reverse on the first day of next month" whose day
 * has come and that are not reversed yet. "Reverse" opens a new journal voucher with the same lines, debits and credits
 * swapped, dated that day; the accountant records it like any JV. Nothing is reversed automatically.
 */
import { useEffect, useState } from 'react';
import { api, type Me, type ReversalDue } from '../../api.ts';
import { Loading, Button, Notice, peso } from '../../components/ui.tsx';
import { Link, navigate } from '../../router.tsx';
import { docPath } from '../../shell/menu.ts';

export function ReversalsDue({ me }: { me: Me }) {
  const [rows, setRows] = useState<ReversalDue[] | null>(null);
  const [error, setError] = useState('');
  const allowed = me.permissions.includes('acc.jv.create');
  useEffect(() => void (allowed && api.reversalsDue().then(setRows, (e: Error) => setError(e.message))), [allowed]);
  if (!allowed) return <Notice>Access denied.</Notice>;
  return (
    <div className="max-w-4xl space-y-4">
      <h1 className="text-2xl font-semibold">Reversals due</h1>
      <p className="text-sm text-slate-600">Journal vouchers marked to reverse on the first day of the next month. Reverse opens the reversal ready to record; a voucher is reversed once.</p>
      {error && <Notice>{error}</Notice>}
      {!rows && !error && <Loading />}
      {rows?.length === 0 && <Notice tone="note">No reversal is due.</Notice>}
      {rows && rows.length > 0 && (
        <table className="w-full text-sm">
          <thead className="text-left text-slate-500"><tr><th>Voucher</th><th>Dated</th><th>What for</th><th className="text-right">Amount</th><th>Reverse on</th><th /></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.documentId} className="border-t border-slate-200">
                <td><Link className="underline" to={docPath('acc.jv', `/${r.documentId}`)}>{r.number}</Link></td>
                <td>{r.date}</td>
                <td>{r.memo}</td>
                <td className="text-right tabular-nums">{peso(r.totalCents)}</td>
                <td>{r.reverseOn}</td>
                <td className="text-right">{me.permissions.includes('acc.jv.post') && <Button tone="primary" onClick={() => navigate(docPath('acc.jv', `/new?reverse=${encodeURIComponent(r.documentId)}`))}>Reverse</Button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
