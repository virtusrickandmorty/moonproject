import { useEffect, useState } from 'react';
import { api, type DocDetail } from '../../api.ts';
import type { ViewParts } from '../../generic/DocView.tsx';
import { Button, Notice, peso } from '../../components/ui.tsx';
import { navigate } from '../../router.tsx';
import type { ItemClass } from '../CAT/catalog.ts';
import { isExpired, jobOrderTarget, type QuotationDoc } from './quotation.ts';

const JO = 'jo.job_order';

/** The catalog class of each quoted item, for the kind of each job order line. An item that cannot be read is left out (the line then defaults to made-to-order). */
export async function itemClasses(itemIds: string[]): Promise<Record<string, ItemClass>> {
  const found: Record<string, ItemClass> = {};
  await Promise.all([...new Set(itemIds)].map(async (id) => {
    const r = await fetch(`/api/cat/items/${encodeURIComponent(id)}`, { credentials: 'same-origin' }).catch(() => null);
    if (r?.ok) found[id] = ((await r.json()) as { class: ItemClass }).class;
  }));
  return found;
}

/**
 * "Make a job order" is an explicit action on a recorded quotation. The server has no conversion record yet, so nothing is
 * written here: the button only opens the Job Order form with the quotation's lines filled in (`?fromQuotation=<id>`).
 * Until the Job Order form exists (`hasJobOrderForm`), it opens the job order list and says so.
 */
export function MakeJobOrder({ detail, hasJobOrderForm }: { detail: DocDetail; hasJobOrderForm: () => boolean }) {
  const doc = detail.doc as QuotationDoc | undefined;
  const [canCreate, setCanCreate] = useState<boolean | null>(null);
  const [serverDate, setServerDate] = useState('');
  useEffect(() => {
    void api.docTypes().then((types) => setCanCreate(types.find((t) => t.key === JO)?.canCreate ?? false), () => setCanCreate(false));
    void api.health().then((h) => setServerDate(h.serverTime.slice(0, 10)), () => undefined);
  }, []);
  if (!doc || detail.header.status !== 'posted') return null;
  const expired = serverDate !== '' && isExpired(doc.validUntil, serverDate);
  const prospect = !doc.customerId;
  const go = () => navigate(jobOrderTarget(hasJobOrderForm(), detail.header.id, detail.header.number));
  return <div className="space-y-2">
    {expired && <Notice tone="warning">This quotation expired on {doc.validUntil}. You can still make a job order from it, but check the prices first.</Notice>}
    {prospect && <Notice tone="info">This quotation is for a prospect. A job order needs a customer: add them under Customers, then edit this quotation to pick that customer.</Notice>}
    {canCreate === false && <Notice tone="info">Your role cannot record job orders.</Notice>}
    <Button tone="primary" disabled={prospect || !canCreate} onClick={go}>Make a job order</Button>
  </div>;
}

export const quotationView = (hasJobOrderForm: () => boolean): ViewParts => ({
  extra: (detail) => {
    const doc = detail.doc as QuotationDoc | undefined;
    if (!doc) return null;
    return <div className="space-y-3">
      <p>For {doc.customerName}{doc.contact ? ` · ${doc.contact}` : ''} · valid until {doc.validUntil}</p>
      <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-slate-500">
        <th>Item</th><th>Qty</th><th className="text-right">Price</th><th className="text-right">Discount</th><th className="text-right">Line total</th>
      </tr></thead><tbody>{doc.lines.map((line) => <tr key={line.lineNo} className="border-t"><td className="py-2">{line.description}
        {line.overrideReason && <span className="block text-xs text-slate-500">Price changed from {peso(line.listUnitPriceCents)}: {line.overrideReason}</span>}
        {line.discountReason && <span className="block text-xs text-slate-500">Discount: {line.discountReason}</span>}</td>
        <td>{line.qty} {line.unit}</td><td className="text-right tabular-nums">{peso(line.unitPriceCents)}</td>
        <td className="text-right tabular-nums">{peso(line.discountCents)}</td><td className="text-right tabular-nums">{peso(line.lineTotalCents)}</td></tr>)}</tbody></table></div>
      {doc.documentDiscountCents > 0 && <p>Whole-quotation discount: {peso(doc.documentDiscountCents)}{doc.discountReason ? ` (${doc.discountReason})` : ''}</p>}
      {doc.termsText && <p><b>Terms:</b> {doc.termsText}</p>}{doc.notes && <p><b>Notes:</b> {doc.notes}</p>}
      <MakeJobOrder detail={detail} hasJobOrderForm={hasJobOrderForm} />
    </div>;
  },
});
