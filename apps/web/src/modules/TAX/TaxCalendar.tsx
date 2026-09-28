/**
 * The tax calendar (PLAN E12, D8): each BIR return due in a range of dates (today and the 60 days after when the screen
 * opens), with the period it covers. The server works out the due dates, moved past weekends and holidays. Filed
 * returns are not recorded yet, so the screen never calls a date late.
 */
import { api, type Me } from '../../api.ts';
import { Notice, Panel } from '../../components/ui.tsx';
import { weekday } from '../EMP/time.ts';
import { RangeForm, useRangeReport } from './ReportParts.tsx';
import { movedFrom, nextSixtyDays } from './reports.ts';

export function TaxCalendar({ me }: { me: Me }) {
  const allowed = me.permissions.includes('tax.calendar.view');
  const r = useRangeReport(allowed, nextSixtyDays, api.taxCalendar);
  if (!allowed) return <Notice>You cannot view the tax calendar.</Notice>;
  const d = r.data;
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Tax calendar</h1>
      <p className="text-sm text-slate-600">
        The BIR returns due and when. A due date on a Saturday, a Sunday or a holiday in the holiday list moves to the next working day; for a special
        non-working day, confirm the move with the BIR's announcement.
      </p>
      <RangeForm r={r} />
      {r.error && <Notice>{r.error}</Notice>}
      {d && (
        <Panel title={`Due from ${r.from} to ${r.to}`}>
          {d.length === 0 ? <p className="text-sm text-slate-500">Nothing is due in these dates.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-slate-500"><tr><th className="pr-3">Due</th><th className="pr-3">Form</th><th className="pr-3">What</th><th>Period</th></tr></thead>
                <tbody>
                  {d.map((x) => (
                    <tr key={`${x.form} ${x.period}`} className="border-t border-slate-100 align-top">
                      <td className="whitespace-nowrap py-1 pr-3">
                        {weekday(x.dueDate)} {x.dueDate}
                        {movedFrom(x) && <span className="block text-xs text-slate-500">{movedFrom(x)}</span>}
                      </td>
                      <td className="whitespace-nowrap py-1 pr-3 font-medium">{x.form}</td>
                      <td className="py-1 pr-3">{x.title}</td>
                      <td className="py-1">{x.periodLabel}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-slate-500">Filed returns are not recorded in Moonproject yet, so this list shows what falls due, not what is already filed.</p>
        </Panel>
      )}
    </div>
  );
}
