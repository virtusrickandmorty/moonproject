/**
 * Live changes (the owner's request, Oct 2026): every open screen, on every computer, hears within moments that something
 * changed, and reloads what it shows. Every change in Moonproject writes an audit row (NR-3), so the audit log's newest
 * row is the one signal: a single watcher per server reads it every LIVE_MS and tells each open screen (a server-sent
 * event stream, GET /api/live) the kinds of record that changed. No record's data is sent: each screen asks again for
 * what it shows, with the user's own permissions, as usual.
 */
import type { FastifyInstance } from 'fastify';
import type { Db } from '../platform/db/driver.ts';

export const LIVE_MS = 1_500;
const QUIET_MS = 25_000; // a comment line keeps a quiet connection open through proxies and sleeping laptops

interface Stream { send: (event: string) => void; end: () => void }

export function liveRoutes(app: FastifyInstance, db: Db): void {
  const streams = new Set<Stream>();
  const newest = () => db.prepare('SELECT COALESCE(MAX(seq), 0) FROM audit_log').pluck().get() as number;
  let last = newest();
  let watcher: ReturnType<typeof setInterval> | null = null;
  let quiet = 0;
  const tick = () => {
    if (streams.size === 0) return;
    const now = newest();
    if (now > last) {
      const types = db.prepare('SELECT DISTINCT entity_type FROM audit_log WHERE seq > ? ORDER BY entity_type').pluck().all(last) as string[];
      last = now;
      quiet = 0;
      const event = `event: change\ndata: ${JSON.stringify({ seq: now, types })}\n\n`;
      for (const s of streams) s.send(event);
    } else if ((quiet += LIVE_MS) >= QUIET_MS) {
      quiet = 0;
      for (const s of streams) s.send(': still here\n\n');
    }
  };
  const stop = () => {
    if (watcher) clearInterval(watcher);
    watcher = null;
  };

  /** The change stream for a signed-in user. One watcher serves every open stream; it stops when none is open. */
  app.get('/api/live', { config: { permission: 'authenticated' } }, (req, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    reply.raw.write(`retry: 3000\nevent: hello\ndata: ${JSON.stringify({ seq: newest() })}\n\n`);
    const stream: Stream = { send: (event) => void reply.raw.write(event), end: () => reply.raw.end() };
    streams.add(stream);
    if (!watcher) watcher = setInterval(tick, LIVE_MS);
    req.raw.on('close', () => {
      streams.delete(stream);
      if (streams.size === 0) stop();
    });
  });

  // The server closing (or a test's app) ends every stream first, so no open stream holds it up.
  app.addHook('preClose', async () => {
    stop();
    for (const s of [...streams]) s.end();
    streams.clear();
  });
}
