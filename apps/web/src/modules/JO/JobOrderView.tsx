/**
 * The job order's own view parts (PLAN E4 "money on the JO view", D6): its money, and deposits left on a cancelled or
 * edited JO, with the way to move them to the replacement (DEP-XFER) or pay them back.
 */
import { useEffect, useState } from 'react';
import { api, type DocDetail, type JoStatus } from '../../api.ts';
import { Link } from '../../router.tsx';
import { Notice, peso } from '../../components/ui.tsx';
import type { ViewParts } from '../../generic/DocView.tsx';
import { docPath } from '../../shell/menu.ts';
import { Figures } from '../COL/parts.tsx';

const action = 'rounded-md bg-white px-3 py-1 text-sm ring-1 ring-slate-300 hover:bg-indigo-50';

function JoMoney({ d }: { d: DocDetail }) {
  const { id, status, replacesId } = d.header;
  const [s, setS] = useState<JoStatus | null>(null);
  const [before, setBefore] = useState<{ number: string; heldCents: number } | null>(null);
  const [can, setCan] = useState({ move: false, refund: false });
  useEffect(() => {
    api.joStatus(id).then(setS, () => undefined);
    api.docTypes().then((ts) => setCan({ move: !!ts.find((t) => t.key === 'col.deposit_transfer')?.canCreate, refund: !!ts.find((t) => t.key === 'col.refund')?.canCreate }), () => undefined);
    if (replacesId) Promise.all([api.get('jo.job_order', replacesId), api.joStatus(replacesId)]).then(([old, os]) => setBefore({ number: old.header.number, heldCents: os.money.depositsHeldCents }), () => undefined);
  }, [id, status]);
  if (!s) return null;
  const m = s.money;
  const held = m.depositsHeldCents;
  return (
    <div className="space-y-2">
      <Figures items={status === 'posted' ? [['Collected', m.collectedCents], ['Invoiced', m.invoicedCents], ['Deposits held', held], ['Balance due', m.balanceDueCents, 'font-semibold']] : [['Deposits held', held]]} />
      {status === 'cancelled' && held > 0 && (
        <Notice tone="warning">
          {peso(held)} of deposits is still held on this cancelled job order. Move it to {d.header.replacedById ? 'the replacement or another' : 'another'} job order of the customer, or pay it back.{' '}
          <span className="mt-2 flex gap-2">
            {can.move && <Link to={docPath('col.deposit_transfer', `/new?from=${id}`)} className={action}>Move the deposit</Link>}
            {can.refund && <Link to={docPath('col.refund', '/new')} className={action}>Pay it back</Link>}
          </span>
        </Notice>
      )}
      {status === 'posted' && before && before.heldCents > 0 && (
        <Notice tone="info">
          {before.number}, which this replaces, still holds {peso(before.heldCents)} of deposits.{' '}
          {can.move && <Link to={docPath('col.deposit_transfer', `/new?from=${replacesId}&to=${id}`)} className={action}>Move it here</Link>}
        </Notice>
      )}
    </div>
  );
}

export const jobOrderView: ViewParts = { extra: (d) => <JoMoney d={d} /> };
