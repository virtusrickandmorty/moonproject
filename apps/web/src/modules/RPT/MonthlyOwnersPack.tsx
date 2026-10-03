import { useEffect, useState } from 'react';
import { openServerPrint, type Me } from '../../api.ts';
import { Button, Field, Notice, Panel, inputClass } from '../../components/ui.tsx';
import { BookTitle, useToday } from './Books.tsx';
import './books.css';
import { addressValue } from './ReportParts.tsx';

export function MonthlyOwnersPack({ me }: { me: Me }) {
  const today = useToday();
  const [month, setMonth] = useState(() => addressValue('month'));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (today && !month) setMonth(today.slice(0, 7)); }, [today, month]);
  if (!me.permissions.includes('rpt.books.view')) return <Notice>Access denied.</Notice>;
  const print = async () => {
    setBusy(true); setError('');
    try { await openServerPrint(me, '/api/rpt/monthly-owners-pack', { month }); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not prepare the pack.'); }
    finally { setBusy(false); }
  };
  return <article className="rpt-page space-y-4"><BookTitle title="Monthly owners' pack" dates={month} />
    <Panel title="Prepare the co-owners' meeting pack">
      <p className="mb-4 text-sm text-slate-600">One A4 printout brings together the financial statements, cash flow, receivables, payroll cost and job-order activity for the selected month.</p>
      <div className="flex flex-wrap items-end gap-3"><Field label="Month"><input type="month" className={inputClass} value={month} onChange={(event) => setMonth(event.target.value)} /></Field>
        <Button tone="primary" disabled={!month || busy} onClick={print}>{busy ? 'Preparing…' : 'Print owners’ pack'}</Button></div>
      {error && <div className="mt-4"><Notice>{error}</Notice></div>}
    </Panel>
  </article>;
}
