/** The loan view's own part: the repayment schedule it was recorded with, and a link to pay the next instalment. */
import type { ViewParts } from '../../generic/DocView.tsx';
import { Link } from '../../router.tsx';
import { docPath } from '../../shell/menu.ts';
import { ScheduleTable } from './LoanForm.tsx';

type Stored = { rows: { instalmentNo: number; dueDate: string; principalCents: number; interestCents: number }[] };

export const loanView: ViewParts = {
  extra: (d) => (
    <div className="space-y-2">
      <h3 className="font-medium">Repayment schedule</h3>
      <ScheduleTable rows={(d.doc as Stored | undefined)?.rows ?? []} />
      {d.header.status === 'posted' && <Link to={docPath('loan.payment', `/new?loan=${d.header.id}`)} className="text-sm underline">Record a payment on this loan</Link>}
    </div>
  ),
};
