/**
 * TPL Services (the owner's request, 11 Oct 2026): Virtus makes a client's items ahead, keeps them, and delivers when the
 * client calls; each delivery is invoiced on the client's terms and collected later. A restock is a job order for stock
 * (production as usual); the delivery receipt carries its invoice, a quick sale on terms (QS).
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { conflict } from '@moonproject/shared';
import { defineModule } from '../../engine/documents/registry.ts';
import { onForStockCheck, onJobOrderEdited, onStockPlace } from '../JO/public.ts';
import { program } from './programs.ts';
import { cancellingTogether, deliveryDoc, deliveryOfInvoice, togetherNotice } from './doctypes/delivery.ts';
import { valuationDoc } from './doctypes/valuation.ts';
import { tplRoutes } from './routes.ts';
import { carryRestockOver, piecesPutIn, restockOf } from './stock.ts';

// A restock job order's pieces go into the client's stock, never out on a release slip.
onForStockCheck((db, jobOrderId) => (restockOf(db, jobOrderId) ? 'This job order was made for the client\'s stock (TPL). Put its finished pieces into stock, then deliver them with a delivery receipt.' : null));
// Edited, it stays for stock.
onJobOrderEdited(carryRestockOver);
// Its screens offer putting the finished pieces into the client's stock instead of a release slip.
onStockPlace((db, jobOrderId) => {
  const r = restockOf(db, jobOrderId);
  return r ? { label: `Put into ${program(db, r.programId)?.customerName ?? 'the client'}'s stock`, href: `/tpl/${r.programId}` } : null;
});

export default defineModule({
  code: 'TPL',
  name: 'TPL Services',
  permissions: [
    { key: 'tpl.view', label: 'View TPL clients, their stock and deliveries', defaultRoles: ['encoder', 'accountant', 'owner'] },
    { key: 'tpl.program.manage', label: 'Set up stock programs: terms, credit limit, items and prices', defaultRoles: ['accountant', 'owner'] },
    { key: 'tpl.stock', label: 'Put finished pieces into a client\'s stock', defaultRoles: ['encoder', 'accountant', 'owner'] },
    { key: 'tpl.deliver', label: 'Record deliveries (their invoice also needs qs.post; cancelling one, qs.cancel)', defaultRoles: ['encoder', 'accountant', 'owner'] },
    { key: 'tpl.count', label: 'Adjust a client\'s stock after a count', defaultRoles: ['accountant', 'owner'] },
    { key: 'tpl.override', label: 'Deliver over the credit limit or with an invoice past due', defaultRoles: ['owner'] },
    { key: 'tpl.value', label: "Value the TPL clients' stock at a month end (it adjusts the books)", defaultRoles: ['accountant', 'owner'] },
  ],
  docTypes: [deliveryDoc, valuationDoc],
  migrationsDir: join(dirname(fileURLToPath(import.meta.url)), 'migrations'),
  routes: tplRoutes,
  notices: [togetherNotice],
  dependents: [
    (db, docType, documentId, reissuing) => {
      // A restock job order with pieces in stock stays: its pieces are the client's stock now.
      if (docType === 'jo.job_order' && restockOf(db, documentId) && piecesPutIn(db, documentId) > 0) {
        throw conflict('IN_STOCK', `Some of its pieces are already in the client's stock, so it cannot be ${reissuing ? 'edited' : 'cancelled'}. Correct the stock with a count instead.`);
      }
      // A delivery's invoice goes with the delivery (cancel the delivery, which takes both). The screens answer TPL_INVOICE
      // by cancelling the delivery, after the cancel dialog said so (togetherNotice).
      if (docType === 'qs.sale') {
        const r = deliveryOfInvoice(db, documentId);
        if (r && !cancellingTogether.has(r.id)) {
          const number = db.prepare('SELECT number FROM documents WHERE id = ?').pluck().get(documentId) as string;
          throw conflict('TPL_INVOICE', reissuing
            ? `${number} is the invoice of delivery ${r.number}, so it cannot be edited on its own. Cancel ${r.number} (its invoice goes with it) and record the delivery again.`
            : `${number} is the invoice of delivery ${r.number}: cancel ${r.number}, and this invoice is cancelled with it.`, [r]);
        }
      }
      return [];
    },
  ],
});
