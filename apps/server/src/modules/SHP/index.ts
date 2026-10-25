import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { defineModule } from '../../engine/documents/registry.ts';
import { shpRoutes } from './routes.ts';
import { shpStockRoutes } from './stock.ts';
import { shpOrderRoutes } from './orders.ts';
import { shopItemsNotice } from './public.ts';
import { shpTrackRoutes } from './track.ts';
import { shpReviewRoutes } from './reviews.ts';
import { shpSeoRoutes } from './seo.ts';
import { shpSeasonRoutes } from './seasons.ts';
import { shpSeasonEventRoutes } from './season-events.ts';
import { shpInsightRoutes } from './insights.ts';
import { valuationDoc } from './valuation.ts';
import { onForStockCheck, onJobOrderEdited, onStockPlace } from '../JO/public.ts';
import { carryWorkOver, shpWorkRoutes, workOf } from './work-routes.ts';

// A shop work order's pieces go into the website shop's stock, never out on a release slip (the owner's request, Oct 2026).
onForStockCheck((db, jobOrderId) => (workOf(db, jobOrderId) ? "This job order was made for the website shop's stock. Put its finished pieces into the shop's stock (Website shop · Shop work)." : null));
// Edited, it stays shop work.
onJobOrderEdited(carryWorkOver);
// Its screens offer putting the finished pieces into the shop's stock instead of a release slip.
onStockPlace((db, jobOrderId) => (workOf(db, jobOrderId) ? { label: "Put into the shop's stock", href: '/shp?tab=work' } : null));

export default defineModule({
  code: 'SHP',
  name: 'Website shop',
  permissions: [
    { key: 'shp.view', label: 'See the products shown in the website shop, their stock and categories', defaultRoles: ['encoder', 'accountant', 'owner'] },
    { key: 'shp.manage', label: 'Add, change, hide and show website shop products, their photos and categories', defaultRoles: ['encoder', 'owner'] },
    { key: 'shp.stock', label: 'Record shop pieces coming in and stock counts', defaultRoles: ['encoder', 'owner'] },
    { key: 'shp.orders.view', label: 'See online orders and their proofs of payment', defaultRoles: ['encoder', 'accountant', 'owner'] },
    // Confirming records the sale and its payment (a quick sale), and cancelling or returning a confirmed order cancels it, so both also need the quick sale permissions (checked on the sale).
    { key: 'shp.orders.manage', label: 'Confirm or reject online payments, move orders to ready and completed, and cancel or return confirmed orders', defaultRoles: ['encoder', 'accountant', 'owner'] },
    // The POS records a quick sale, so selling there also needs qs.create and qs.post (the server checks those on the sale).
    { key: 'shp.pos', label: 'Sell shop items at the POS counter (also needs the quick sale permissions to record the sale)', defaultRoles: ['encoder', 'owner'] },
    { key: 'shp.reviews.manage', label: "Hide and show buyers' reviews on the website", defaultRoles: ['encoder', 'owner'] },
    // Making one records a job order on the production board, so it also needs jo.post.
    { key: 'shp.work', label: "Send website shop items to production: restock, rework, or change pieces into a shop item", defaultRoles: ['encoder', 'owner'] },
    { key: 'shp.value', label: "Value the website shop's own stock at a month end (it adjusts the books)", defaultRoles: ['accountant', 'owner'] },
    { key: 'shp.payment.manage', label: "Set the shop's online payment QR and the cash account it pays into", defaultRoles: ['owner'] },
  ],
  docTypes: [valuationDoc],
  notices: [shopItemsNotice],
  migrationsDir: join(dirname(fileURLToPath(import.meta.url)), 'migrations'),
  routes(app, deps) {
    shpRoutes(app, deps);
    shpStockRoutes(app, deps);
    shpOrderRoutes(app, deps);
    shpTrackRoutes(app, deps);
    shpReviewRoutes(app, deps);
    shpSeoRoutes(app, deps);
    shpWorkRoutes(app, deps);
    shpSeasonRoutes(app, deps);
    shpSeasonEventRoutes(app, deps);
    shpInsightRoutes(app, deps);
  },
});
