/**
 * The supplier bill list's own parts (the owner's request, Nov 2026): the general list's rows, each with whether it is paid:
 * green Paid, amber what is still to pay and when it is due, red when it is overdue.
 */
import { api, type DocHeader } from '../../api.ts';
import type { ListColumn, ListSource } from '../../generic/DocList.tsx';
import { PayBadge, manilaToday } from '../PUR/parts.tsx';

type BillRow = DocHeader & { owedCents?: number; dueDate?: string };

export const billList = {
  source: {
    list: async (q) => {
      const rows = await api.list('ap.bill', q);
      const posted = rows.filter((r) => r.status === 'posted').map((r) => r.id);
      const owed = posted.length ? await api.apBillsOwed(posted).catch(() => []) : [];
      const by = new Map(owed.map((o) => [o.id, o]));
      return rows.map((r) => { const o = by.get(r.id); return o ? { ...r, owedCents: o.owedCents, dueDate: o.dueDate } : r; });
    },
    counts: (q) => api.docCounts('ap.bill', q),
  } as ListSource,
  columns: [{
    head: 'Payment',
    cell: (r) => { const b = r as BillRow; return r.status === 'posted' ? <PayBadge owedCents={b.owedCents} dueDate={b.dueDate} today={manilaToday()} /> : ''; },
  }] as ListColumn[],
};
