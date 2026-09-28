/**
 * Cash advances owed (PLAN E11: the CA ledger per employee is GL 1210): who owes, and one employee's cash advance view
 * with the open advances, the deduction per payroll, the repayments and write-offs with what was owed after each, and
 * "Pay back" and "Write off".
 */
import { useEffect, useState } from 'react';
import { api, type CaOwing, type CaStatus, type DocTypeInfo, type Me } from '../../api.ts';
import { Notice, Panel, peso } from '../../components/ui.tsx';
import { Link } from '../../router.tsx';
import { docPath } from '../../shell/menu.ts';

const link = 'rounded-md bg-white px-3 py-2 text-sm font-medium ring-1 ring-slate-300 hover:bg-slate-100';
const KIND = { repayment: 'Paid back', writeoff: 'Written off' } as const;

export function CaOwed() {
  const [rows, setRows] = useState<CaOwing[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => void api.caOwing().then(setRows, (e: Error) => setError(e.message)), []);
  if (error) return <Notice>{error}</Notice>;
  if (!rows) return <p className="text-slate-500">Loading…</p>;
  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-2xl font-semibold">Cash advances owed</h1>
      {rows.length === 0 ? <p className="text-slate-500">Nobody owes on cash advances.</p> : (
        <table className="w-full text-sm">
          <thead className="text-left text-slate-500"><tr><th>Employee</th><th className="text-right">Owes</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.employeeId} className="border-t border-slate-100">
                <td className="py-1"><Link to={`/ca/employees/${r.employeeId}`} className="underline">{r.name}</Link></td>
                <td className="text-right tabular-nums">{peso(r.owedCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function CaEmployeePage({ me, docTypes, params }: { me: Me; docTypes: DocTypeInfo[]; params?: Record<string, string> }) {
  const id = params?.id ?? '';
  const [s, setS] = useState<CaStatus | null>(null);
  const [error, setError] = useState('');
  useEffect(() => void api.caStatus(id).then(setS, (e: Error) => setError(e.message)), [id]);
  if (error) return <Notice>{error}</Notice>;
  if (!s) return <p className="text-slate-500">Loading…</p>;
  const may = (key: string) => docTypes.some((d) => d.key === key && d.canPost);
  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-2xl font-semibold">Cash advances of {s.name}{s.active ? '' : ' (separated)'}</h1>
      <p>Owes <b className="tabular-nums">{peso(s.outstandingCents)}</b> now{s.installmentCents ? `; ${peso(s.installmentCents)} is deducted each payroll` : ''}.</p>
      <div className="flex flex-wrap gap-2">
        {s.outstandingCents > 0 && may('ca.repayment') && <Link to={docPath('ca.repayment', `/new?employee=${id}`)} className={link}>Pay back</Link>}
        {s.outstandingCents > 0 && may('ca.writeoff') && <Link to={docPath('ca.writeoff', `/new?employee=${id}`)} className={link}>Write off</Link>}
        {s.active && may('ca.advance') && <Link to={docPath('ca.advance', '/new')} className={link}>Give an advance</Link>}
        {me.permissions.includes('emp.view') && <Link to={`/emp/employees/${id}`} className="self-center underline">Employee record</Link>}
      </div>
      <Panel title="Advances still open">
        {s.open.length === 0 ? <p className="text-sm text-slate-500">None.</p> : (
          <table className="w-full text-sm">
            <thead className="text-left text-slate-500"><tr><th>Advance</th><th className="text-right">Given</th><th className="text-right">Each payroll</th><th className="text-right">Still open</th></tr></thead>
            <tbody>
              {s.open.map((a) => (
                <tr key={a.documentId} className="border-t border-slate-100">
                  <td className="py-1"><Link to={docPath('ca.advance', `/${a.documentId}`)} className="underline">{a.number}</Link></td>
                  <td className="text-right tabular-nums">{peso(a.amountCents)}</td><td className="text-right tabular-nums">{peso(a.installmentCents)}</td><td className="text-right tabular-nums">{peso(a.openCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
      <Panel title="Paid back and written off">
        {s.settlements.length === 0 ? <p className="text-sm text-slate-500">Nothing yet; payroll deductions show on the payslips.</p> : (
          <table className="w-full text-sm">
            <thead className="text-left text-slate-500"><tr><th>Date</th><th>Document</th><th /><th className="text-right">Amount</th><th className="text-right">Owed after</th></tr></thead>
            <tbody>
              {s.settlements.map((x) => (
                <tr key={x.documentId} className="border-t border-slate-100">
                  <td className="py-1">{x.businessDate}</td>
                  <td><Link to={docPath(`ca.${x.kind}`, `/${x.documentId}`)} className="underline">{x.number}</Link></td>
                  <td>{KIND[x.kind]}</td>
                  <td className="text-right tabular-nums">{peso(x.amountCents)}</td><td className="text-right tabular-nums">{peso(x.balanceAfterCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
