import type { DocDetail } from '../../api.ts';
import { peso } from '../../components/ui.tsx';
import { Link } from '../../router.tsx';
import type { ViewParts } from '../../generic/DocView.tsx';
import { KIND_LABEL, isKind } from './adjustment.ts';

type Adjustment = { placeName: string; kind: string; amountCents: number; description: string; note?: string; finalTaxBp: number; finalTaxCents: number; netCents: number };

/** What the bank did, in plain words: a charge, or interest with the final tax the bank kept. */
export const bankAdjustmentView: ViewParts = {
  extra: (d: DocDetail) => {
    const a = d.doc as Adjustment | undefined;
    if (!a) return null;
    const interest = a.kind === 'interest';
    return (
      <div className="space-y-2 pt-2 text-sm">
        <p className="font-medium">{isKind(a.kind) ? KIND_LABEL[a.kind] : a.kind} on {a.placeName}: {a.description}</p>
        <dl className="grid max-w-sm grid-cols-[1fr_auto] gap-x-4 gap-y-1">
          <dt>{interest ? 'Interest before final tax' : 'Charge'}</dt><dd className="text-right tabular-nums">{peso(a.amountCents)}</dd>
          {interest && <><dt>Final tax kept by the bank ({a.finalTaxBp / 100}%)</dt><dd className="text-right tabular-nums">−{peso(a.finalTaxCents)}</dd></>}
          {interest && <><dt className="font-medium">Credited to the account</dt><dd className="text-right font-medium tabular-nums">{peso(a.netCents)}</dd></>}
        </dl>
        {a.note && <p>Note: {a.note}</p>}
        <p className="text-slate-500">Tick it as cleared in the <Link to="/cash/recon" className="underline">bank reconciliation</Link>. While it is ticked in a saved reconciliation it cannot be cancelled.</p>
      </div>
    );
  },
};
