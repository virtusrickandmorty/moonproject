/**
 * Changes after filing (ACC-22): documents dated in a period whose BIR return is filed (its payment recorded and not
 * cancelled) that were recorded or cancelled after that payment was recorded. The accountant decides whether the return
 * needs amending. For the accountant and the owners, with a download for Excel.
 */
import { useEffect, useState } from 'react';
import { api, type ChangeAfterFiling, type Me } from '../../api.ts';
import { Notice, manilaTime } from '../../components/ui.tsx';
import { Link } from '../../router.tsx';
import { docPath } from '../../shell/menu.ts';

export function ChangesAfterFiling({ me }: { me: Me }) {
  const [rows, setRows] = useState<ChangeAfterFiling[] | null>(null);
  const [error, setError] = useState('');
  const allowed = me.permissions.includes('tax.registers.view');
  useEffect(() => void (allowed && api.changesAfterFiling().then((r) => setRows(r.rows), (e: Error) => setError(e.message))), [allowed]);
  if (!allowed) return <Notice>Access denied.</Notice>;
  return (
    <div className="max-w-5xl space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <h1 className="text-2xl font-semibold">Changes after filing</h1>
        <span className="flex-1" />
        <a href="/api/tax/changes-after-filing?format=csv" className="text-sm underline print:hidden">Download for Excel</a>
      </div>
      <p className="text-sm text-slate-600">Documents dated in a filed period that were recorded or cancelled after the return was paid. The filed return still shows the figures before them: tell the accountant, who may need to amend it.</p>
      {error && <Notice>{error}</Notice>}
      {!rows && !error && <p className="text-slate-500">Loading…</p>}
      {rows?.length === 0 && <Notice tone="note">Nothing changed after a return was filed.</Notice>}
      {rows && rows.length > 0 && (
        <table className="w-full text-sm">
          <thead className="text-left text-slate-500"><tr><th>Date</th><th>Document</th><th>What happened</th><th>Who</th><th>When</th><th>Return</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.documentId}:${r.what}:${r.form}:${r.period}`} className="border-t border-slate-200">
                <td>{r.date}</td>
                <td><Link className="underline" to={docPath(r.docType, `/${r.documentId}`)}>{r.docTitle} {r.number}</Link></td>
                <td>{r.what === 'recorded' ? 'Recorded' : 'Cancelled'}</td>
                <td>{r.userName}</td>
                <td>{manilaTime(r.at)}</td>
                <td>{r.form} for {r.periodLabel} ({r.paymentNumber})</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
