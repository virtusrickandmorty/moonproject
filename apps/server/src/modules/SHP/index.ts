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
    { key: 'shp.payment.manage', label: "Set the shop's online payment QR and the cash account it pays into", defaultRoles: ['owner'] },
  ],
  docTypes: [],
  notices: [shopItemsNotice],
  migrationsDir: join(dirname(fileURLToPath(import.meta.url)), 'migrations'),
  routes(app, deps) {
    shpRoutes(app, deps);
    shpStockRoutes(app, deps);
    shpOrderRoutes(app, deps);
    shpTrackRoutes(app, deps);
    shpReviewRoutes(app, deps);
    shpSeoRoutes(app, deps);
  },
});
