/**
 * The website's own door (the owner's request, Nov 2026): main.ts opens a second port for www.virtusgarments.com
 * (MOONPROJECT_SITE_PORT), and every request through it is checked here. The ERP keeps its own port and address.
 * Through the website's door:
 *   - the website's pages, a customer's link pages and the built files are served as usual;
 *   - any other page (a staff bookmark, the floor app, the sign-in page) moves to the same page on the ERP's address;
 *   - the API answers only what the website itself uses, with no sign-in: never the staff sign-in, the first-owner
 *     set-up or anything that needs a session, so the ERP's sign-in and data are not reachable from the website at all.
 * Same program, same database: only the door differs.
 */
import type { IncomingMessage } from 'node:http';
import type { FastifyInstance } from 'fastify';
import { AppError, isWebsitePage } from '@moonproject/shared';
import { isFileUnder } from './web.ts';

/** Open without sign-in, yet the ERP's alone: the staff sign-in and the first-owner set-up. */
const ERP_ONLY = /^\/api\/(auth|setup)\//;

export interface WebsiteDoor {
  /** Whether this request came in through the website's door. */
  isWebsite: (raw: IncomingMessage) => boolean;
  /** Where the ERP opens, e.g. https://erp.virtusgarments.com. */
  erpUrl: string;
}

export function websiteDoor(app: FastifyInstance, door: WebsiteDoor, webRoot: string): void {
  app.addHook('onRequest', async (req, reply) => {
    if (!door.isWebsite(req.raw)) return;
    const route = req.routeOptions.url;
    const path = req.url.split('?')[0]!;
    if (route === '/*' && !/^\/api(\/|$)/.test(path)) {
      if (isWebsitePage(path) || isFileUnder(webRoot, decodeURIComponentSafe(path).slice(1)) || path.startsWith('/assets/')) return;
      return reply.redirect(`${door.erpUrl}${req.url}`, 302);
    }
    if (req.routeOptions.config?.permission === 'public' && route && !ERP_ONLY.test(route)) return;
    throw new AppError('ERP_ADDRESS', `This is the website. The ERP opens at ${door.erpUrl.replace(/^https?:\/\//, '')}.`, 403, { erpUrl: door.erpUrl });
  });
}

const decodeURIComponentSafe = (s: string) => {
  try { return decodeURIComponent(s); } catch { return s; }
};
