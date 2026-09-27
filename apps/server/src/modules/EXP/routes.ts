import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../../app.ts';
import { listCategories } from './categories.ts';

export function expRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db } = deps;

  /** The fixed list of expense categories encoders pick from (NR-8), with each one's usual EWT class. */
  app.get('/api/exp/categories', { config: { permission: 'exp.voucher.view' } }, async () =>
    listCategories(db).map(({ id, code, name, defaultEwtClass }) => ({ id, code, name, defaultEwtClass })),
  );
}
