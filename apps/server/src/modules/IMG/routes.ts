/**
 * The image tools' routes (the owner's request, Oct 2026), all under img.use: send a picture (the request body, like a
 * document attachment) with what to do; get the result back as a PNG by its id. Results are temporary files kept for
 * three days in <data>/img-work, never in the database: they are working copies, not business records.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
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

const level = z.enum(['0', '1', '2', '3']).transform(Number);
const flag = z.enum(['0', '1']).transform((v) => v === '1');
const colours = z.string().regex(/^(0|[2-9]|1[0-2]|16|32|64)$/).transform(Number); // 16-64: full colour
const hexes = z.string().regex(/^[0-9a-f]{6}(,[0-9a-f]{6}){0,11}$/).transform((v) => v.split(','));
const runQuery = z.discriminatedUnion('op', [
  z.object({ op: z.literal('upscale'), scale: z.enum(['2', '4']), kind: z.enum(['artwork', 'photo']) }).strict(),
  z.object({ op: z.literal('background'), cutout: z.enum(['object', 'design']) }).strict(),
  // Photo to flat art. corners: four x,y pairs as fractions; paint: a colour or "-" (clear) for each palette colour.
  z.object({
    op: z.literal('flatten'), clean: level, light: flag, colours, specks: level, clear: flag,
    corners: z.string().regex(/^(0|1|0?\.\d+)(,(0|1|0?\.\d+)){7}$/).transform((v) => {
      const n = v.split(',').map(Number);
      return [0, 2, 4, 6].map((i) => [n[i]!, n[i + 1]!] as [number, number]);
    }).optional(),
    palette: hexes.optional(),
    paint: z.string().regex(/^([0-9a-f]{6}|-)(,([0-9a-f]{6}|-)){0,11}$/).transform((v) => v.split(',').map((p) => (p === '-' ? null : p))).optional(),
  }).strict().refine((q) => (q.paint ? q.palette?.length === q.paint.length : true), 'A paint for each colour'),
  z.object({
    op: z.literal('vectorize'), style: z.enum(['colour', 'full', 'cutter']), colours, specks: level, edges: z.enum(['smooth', 'sharp']),
    width: z.coerce.number().min(1).max(300), invert: flag, mirror: flag,
  }).strict(),
]);

/** The files a result may have, and how each is served. */
const RESULT_FILES: Record<string, string> = { 'out.png': 'image/png', 'design.svg': 'image/svg+xml', 'design.pdf': 'application/pdf', 'separations.pdf': 'application/pdf' };

export function imgRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db } = deps;
  const dbFile = db.name && db.name !== ':memory:' ? resolve(db.name) : ''; // full paths: the tools run in their own folders
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

  const result = async (idParam: string, name: string, reply: FastifyReply) => {
    const id = z.uuid().safeParse(idParam);
    const file = id.success && RESULT_FILES[name] ? join(work, id.data, name) : '';
    if (!file || !existsSync(file)) throw notFound('The picture (results are kept three days)');
    return reply.header('content-type', RESULT_FILES[name]!).header('cache-control', 'private, no-store').header('x-content-type-options', 'nosniff')
      // Opened by itself, a picture or file of ours runs nothing.
      .header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox").send(readFileSync(file));
  };
  app.get<{ Params: { id: string } }>('/api/img/results/:id', { config: { permission: 'img.use' } }, async (req, reply) => result(req.params.id, 'out.png', reply));
  app.get<{ Params: { id: string; file: string } }>('/api/img/results/:id/:file', { config: { permission: 'img.use' } }, async (req, reply) => result(req.params.id, req.params.file, reply));

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
      const op = q.data;
      const [has, what] = op.op === 'upscale' ? [ready.upscale, 'upscaler'] : op.op === 'background' ? [ready.background, 'background remover'] : [ready.art, op.op === 'flatten' ? 'flat-art tool' : 'vectorizer'];
      if (!has) throw new AppError('IMG_NOT_INSTALLED', `The ${what} is not installed on the shop PC yet (tools/img/install.ps1).`, 503);
      tidy();
      const id = randomUUID();
      const dir = join(work, id);
      mkdirSync(dir, { recursive: true });
      const input = resolve(dir, `in.${EXT[type]}`);
      const output = resolve(dir, 'out.png');
      writeFileSync(input, data);
      const started = Date.now();
      if (op.op === 'vectorize') {
        const { op: _, ...options } = op;
        const info = await oneAtATime(() => t.vectorize(input, dir, options));
        rmSync(input, { force: true });
        const files = Object.fromEntries(Object.keys(RESULT_FILES).filter((f) => f !== 'out.png' && existsSync(join(dir, f))).map((f) => [f, `/api/img/results/${id}/${f}`]));
        if (!files['design.svg']) throw new AppError('IMG_FAILED', 'The vectorizer made no file. Try another option.', 500);
        return { id, url: files['design.svg'], files, info, ms: Date.now() - started };
      }
      const info = await oneAtATime(async () => {
        if (op.op === 'upscale') return void await t.upscale(input, output, Number(op.scale) as 2 | 4, op.kind);
        if (op.op === 'background') return void await t.removeBackground(input, output, op.cutout);
        const { op: _, ...options } = op;
        return t.flatten(input, output, options);
      });
      if (!existsSync(output)) throw new AppError('IMG_FAILED', 'The image tool made no picture. Try another option.', 500);
      rmSync(input, { force: true });
      return { id, url: `/api/img/results/${id}`, bytes: statSync(output).size, ms: Date.now() - started, ...(info ? { info } : {}) };
    });
  });
}
