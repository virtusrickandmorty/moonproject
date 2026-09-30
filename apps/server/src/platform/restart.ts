/**
 * Restart after a restore (PLAN C8 "Restore"). Once asked, the server takes no more changes (they would be lost when
 * the restored copy is swapped in), waits until no request is running (at most RESTART_WAIT_MS), then calls `exit`.
 * main.ts exits with RESTART_EXIT_CODE: the Windows service counts that as a failure and starts Moonproject again, and
 * the start swaps the checked copy in.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';

/** Not 0: WinSW reports a clean exit as "stopped", and Windows restarts a service only after a failure. */
export const RESTART_EXIT_CODE = 3;
export const RESTART_WAIT_MS = 60_000;

export interface Restarter {
  /** Why a restart is coming, or null. */
  readonly reason: string | null;
  request(reason: string): void;
}

export function idleRestarter(app: FastifyInstance, exit: (reason: string) => void, waitMs = RESTART_WAIT_MS): Restarter {
  const running = new Set<FastifyRequest>();
  let reason: string | null = null;
  let timer: NodeJS.Timeout | undefined;
  let done = false;
  const fire = () => {
    if (done || reason === null) return;
    done = true;
    clearTimeout(timer);
    exit(reason);
  };
  const finished = async (req: FastifyRequest) => {
    running.delete(req);
    if (reason !== null && running.size === 0) setImmediate(fire);
  };
  app.addHook('onRequest', async (req) => void running.add(req));
  app.addHook('onResponse', finished);
  app.addHook('onRequestAbort', finished);
  return {
    get reason() {
      return reason;
    },
    request(why) {
      if (reason !== null) return;
      reason = why;
      // A request that never ends (a client gone mid-way) does not hold the restart back for long.
      timer = setTimeout(fire, waitMs);
      timer.unref();
      if (running.size === 0) setImmediate(fire);
    },
  };
}
