/**
 * The image tools' routes (the owner's request, Oct 2026), all under img.use: send a picture (the request body, like a
 * document attachment) with what to do; get the result back as a PNG by its id. Results are temporary files kept for
 * three days in <data>/img-work, never in the database: they are working copies, not business records.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError, notFound } from '@moonproject/shared';
import type { AppDeps } from '../../app.ts';
import { sniffType } from '../../engine/attachments.ts';
import { localTools, oneAtATime, queueLength, toolsDir, type ImageTools } from './tools.ts';

export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const KEEP_MS = 3 * 86_400_000;
const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

/** Tests use stand-in tools; the shop PC uses the installed ones. */
let stand: ImageTools | null = null;
export function useImageToolsForTests(tools: ImageTools | null): void { stand = tools; }

const runQuery = z.discriminatedUnion('op', [
  z.object({ op: z.literal('upscale'), scale: z.enum(['2', '4']), kind: z.enum(['artwork', 'photo']) }).strict(),
  z.object({ op: z.literal('background'), cutout: z.enum(['object', 'design']) }).strict(),
]);

export function imgRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db } = deps;
  const dbFile = db.name && db.name !== ':memory:' ? db.name : '';
  const work = dbFile ? join(dirname(dbFile), 'img-work') : join(tmpdir(), 'moonproject-img-work');
  const tools = () => stand ?? localTools(toolsDir(dbFile || join(process.cwd(), 'data', 'moonproject.db')));
  const tooBig = () => new AppError('FILE_TOO_BIG', 'The picture is bigger than 15 MB. Use a smaller one.', 413);

  /** Results older than three days go (files only: nothing in the database refers to them). */
  const tidy = () => {
    if (!existsSync(work)) return;
    for (const name of readdirSync(work)) {
      const at = join(work, name);
      try { if (Date.now() - statSync(at).mtimeMs > KEEP_MS) rmSync(at, { recursive: true, force: true }); } catch { /* next time */ }
    }
  };

  app.get('/api/img/status', { config: { permission: 'img.use' } }, async () => ({ ...tools().installed(), waiting: queueLength() }));

  app.get<{ Params: { id: string } }>('/api/img/results/:id', { config: { permission: 'img.use' } }, async (req, reply) => {
    const id = z.uuid().safeParse(req.params.id);
    const file = id.success ? join(work, id.data, 'out.png') : '';
    if (!file || !existsSync(file)) throw notFound('The picture (results are kept three days)');
    return reply.header('content-type', 'image/png').header('cache-control', 'private, no-store').header('x-content-type-options', 'nosniff').send(readFileSync(file));
  });

  app.register(async (upload) => {
    upload.addHook('preParsing', async (req) => { if (Number(req.headers['content-length'] ?? 0) > MAX_IMAGE_BYTES) throw tooBig(); });
    upload.addContentTypeParser('*', async (_req: FastifyRequest, payload: NodeJS.ReadableStream) => {
      const chunks: Buffer[] = []; let size = 0;
      for await (const c of payload) { size += (c as Buffer).length; if (size <= MAX_IMAGE_BYTES) chunks.push(c as Buffer); }
      if (size > MAX_IMAGE_BYTES) throw tooBig();
      return Buffer.concat(chunks);
    });
    /** ?op=upscale&scale=2|4&kind=artwork|photo, or ?op=background&cutout=object|design. The body is the picture. */
    upload.post('/api/img/run', { config: { permission: 'img.use' } }, async (req) => {
      const q = runQuery.safeParse(req.query);
      if (!q.success) throw new AppError('VALIDATION', 'Pick what to do with the picture.', 400);
      const data = req.body;
      const type = Buffer.isBuffer(data) ? sniffType(data) : null;
      if (!Buffer.isBuffer(data) || !type || !EXT[type]) throw new AppError('FILE_TYPE', 'Only JPEG, PNG or WebP pictures can be used.', 415);
      const t = tools();
      const ready = t.installed();
      if (q.data.op === 'upscale' ? !ready.upscale : !ready.background) {
        throw new AppError('IMG_NOT_INSTALLED', `The ${q.data.op === 'upscale' ? 'upscaler' : 'background remover'} is not installed on the shop PC yet (tools/img/install.ps1).`, 503);
      }
      tidy();
      const id = randomUUID();
      const dir = join(work, id);
      mkdirSync(dir, { recursive: true });
      const input = join(dir, `in.${EXT[type]}`);
      const output = join(dir, 'out.png');
      writeFileSync(input, data);
      const started = Date.now();
      const op = q.data;
      await oneAtATime(() => (op.op === 'upscale' ? t.upscale(input, output, Number(op.scale) as 2 | 4, op.kind) : t.removeBackground(input, output, op.cutout)));
      if (!existsSync(output)) throw new AppError('IMG_FAILED', 'The image tool made no picture. Try another option.', 500);
      rmSync(input, { force: true });
      return { id, url: `/api/img/results/${id}`, bytes: statSync(output).size, ms: Date.now() - started };
    });
  });
}
