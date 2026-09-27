import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../../app.ts';
import { currentUser } from '../../engine/security/routes.ts';
import { listCashPlaces } from '../../engine/ledger/accounts.ts';
import { accountBalance } from '../../engine/ledger/queries.ts';

export function cashRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db } = deps;

  /** Cash places with balances computed from the ledger (NR-2). Balances hidden per OWN-27. */
  app.get('/api/cash/places', { config: { permission: 'cash.places.view' } }, async (req) => {
    const u = currentUser(req);
    const all = u.permissions.has('cash.balances.view_all');
    const visible = new Set(
      (db.prepare('SELECT account_id FROM cash_place_settings WHERE encoder_sees_balance = 1').all() as { account_id: number }[]).map((r) => r.account_id),
    );
    return listCashPlaces(db).map((c) => ({
      id: c.id,
      name: c.name,
      balanceCents: all || visible.has(c.id) ? accountBalance(db, c.id) : null,
    }));
  });
}
