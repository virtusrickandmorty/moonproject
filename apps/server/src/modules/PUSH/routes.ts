import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../../app.ts';
import { tx } from '../../platform/db/driver.ts';
import { currentUser } from '../../engine/security/routes.ts';
import { phonesOf, pushNew, pushTest, subscribe, unsubscribe, vapidKeys, webPushSender } from './push.ts';

const TICK_MS = 60_000; // a new notification reaches the phone within about a minute

export function pushRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, clock, registry } = deps;
  const signedIn = { config: { permission: 'authenticated' } };
  const where = { practice: deps.practice, host: deps.host }; // what the bell passes, so a phone hears what the bell says

  /** The shop's public push key (for the phone to subscribe with), and how many phones this person turned on. */
  app.get('/api/push/key', signedIn, async (req) => ({ publicKey: vapidKeys(db).publicKey, phones: phonesOf(db, currentUser(req).userId) }));
  app.post('/api/push/subscribe', signedIn, async (req) => tx(db, () => subscribe(db, clock, registry, currentUser(req), req.body, where)));
  app.post('/api/push/unsubscribe', signedIn, async (req) =>
    tx(db, () => unsubscribe(db, clock, currentUser(req).userId, (req.body as { endpoint?: unknown } | null)?.endpoint)));
  app.post('/api/push/test', signedIn, async (req) => pushTest(db, clock, webPushSender(db), currentUser(req)));

  // Every minute: what came up in each person's bell goes to their phones. Not in tests (they call pushNew themselves).
  if (!process.env.VITEST) {
    let timer: NodeJS.Timeout | undefined;
    let busy = false;
    const tick = async () => {
      if (busy) return;
      busy = true;
      try { await pushNew(db, clock, registry, webPushSender(db), (m) => app.log.warn(m), where); }
      catch (e) { app.log.error(`Phone notifications: ${(e as Error).message}`); }
      finally { busy = false; }
    };
    app.addHook('onReady', async () => void (timer = setInterval(() => void tick(), TICK_MS).unref()));
    app.addHook('onClose', async () => clearInterval(timer));
  }
}
