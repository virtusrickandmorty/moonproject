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
import { currentUser } from '../../engine/security/routes.ts';
import { tx } from '../../platform/db/driver.ts';
import { stamp, today } from '../../platform/clock.ts';
import { AI_MODELS, type CreditInfo, aiSettings, backPrompt, checkCap, falService, logRun, mockupPrompt, pesoOf, readFalKey, recentRuns, redrawPrompt, saveAiSettings, spentThisMonth, type AiService, type AiStep } from './ai.ts';
import { localTools, oneAtATime, queueLength, toolsDir, type ImageTools } from './tools.ts';

export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const KEEP_MS = 3 * 86_400_000;
const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

/** Tests use stand-in tools; the shop PC uses the installed ones. */
let stand: ImageTools | null = null;
export function useImageToolsForTests(tools: ImageTools | null): void { stand = tools; }
let standAi: AiService | null = null;
export function useAiServiceForTests(service: AiService | null): void { standAi = service; }

/** The online AI's limits (Fal.ai, Recraft): a picture under 5 MB and 4096 px a side; the screen sends it smaller. */
const MAX_AI_BYTES = 5 * 1024 * 1024;
const ASPECT = { tall: '9:16', square: '1:1', wide: '16:9' } as const;
/** GPT Image 2.5 takes a size in pixels (sides in 16s): about the same detail as Nano Banana Pro's 2K. */
const GPT_SIZE = { tall: { width: 1152, height: 2048 }, square: { width: 1536, height: 1536 }, wide: { width: 2048, height: 1152 } } as const;
const aiQuery = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('redraw'), quality: z.enum(['best', 'economy', 'crisp']), shape: z.enum(['tall', 'square', 'wide']), text: z.enum(['remove', 'keep']), part: z.enum(['whole', 'front', 'back']).default('whole'),
    // The words on the jersey to remove, comma-separated (the owner types them): letters, digits and a few signs.
    words: z.string().trim().max(160).regex(/^[\p{L}\p{N} .,'&#-]*$/u).default('').transform((v) => v.split(',').map((w) => w.trim()).filter(Boolean).slice(0, 8)),
  }).strict(),
  // The back, made by the AI from the front's flat artwork; a name and number to letter on it, or none.
  z.object({ op: z.literal('back'), shape: z.enum(['tall', 'square', 'wide']), name: z.string().trim().max(24).regex(/^[\p{L}\p{N} .'&-]*$/u).default(''), number: z.string().trim().regex(/^\d{0,3}$/).default('') }).strict(),
  z.object({ op: z.literal('vector') }).strict(),
]);
/** A mockup: the front's (and the back's) flat artwork on a garment; pictures as data URIs (the screen sends them small). */
const mockupInput = z.object({
  front: z.string().regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/),
  back: z.string().regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/).optional(),
  garment: z.enum(['jersey', 'tshirt', 'polo', 'longsleeve']),
}).strict();

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

  /**
   * Erase what is marked and fill it from around it (LaMa, on the shop PC, free): a name, number or logo off a photo
   * before the online AI redraws it, or a leftover on a result. The picture and the mask (white: erase) as data URIs.
   */
  const eraseInput = z.object({
    image: z.string().regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/),
    mask: z.string().regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/),
  }).strict();
  app.post('/api/img/erase', { bodyLimit: 48 * 1024 * 1024, config: { permission: 'img.use' } }, async (req) => {
    const e = eraseInput.parse(req.body);
    const t = tools();
    if (!t.installed().erase) throw new AppError('IMG_NOT_INSTALLED', 'The eraser is not installed on the shop PC yet (tools/img/install.ps1).', 503);
    const picture = Buffer.from(e.image.slice(e.image.indexOf(',') + 1), 'base64');
    const mask = Buffer.from(e.mask.slice(e.mask.indexOf(',') + 1), 'base64');
    const type = sniffType(picture);
    if (!type || !EXT[type] || sniffType(mask) !== 'image/png') throw new AppError('FILE_TYPE', 'Only JPEG, PNG or WebP pictures can be used.', 415);
    if (picture.length > MAX_IMAGE_BYTES) throw tooBig();
    tidy();
    const id = randomUUID();
    const dir = join(work, id);
    mkdirSync(dir, { recursive: true });
    const input = resolve(dir, `in.${EXT[type]}`), maskFile = resolve(dir, 'mask.png'), output = resolve(dir, 'out.png');
    writeFileSync(input, picture); writeFileSync(maskFile, mask);
    const started = Date.now();
    await oneAtATime(() => t.erase(input, maskFile, output));
    rmSync(input, { force: true }); rmSync(maskFile, { force: true });
    if (!existsSync(output)) throw new AppError('IMG_FAILED', 'The eraser made no picture. Try marking again.', 500);
    return { id, url: `/api/img/results/${id}`, ms: Date.now() - started };
  });

  /**
   * The Fal.ai credit left (the owner's request, Oct 2026), asked with the billing key when there is one, else the run
   * key; kept a minute, asked again after each run and when the keys change. ?fresh=1 asks now.
   */
  let credit: { at: number; info: CreditInfo } | null = null;
  const creditLeft = async (ratePeso: number, fresh: boolean): Promise<CreditInfo> => {
    if (!fresh && credit && Date.now() - credit.at < 60_000) return credit.info;
    const checkedAt = stamp(deps.clock);
    const key = readFalKey(db, 'billing') ?? readFalKey(db);
    let info: CreditInfo;
    if (!key) info = { problem: 'no-key', message: 'No Fal.ai key is saved yet.', checkedAt };
    else {
      try {
        const usd = await (standAi ?? falService).credit(key);
        info = { usd, peso: Math.round(usd * ratePeso * 100) / 100, checkedAt };
      } catch (e) {
        info = e instanceof AppError && e.code === 'IMG_AI_BILLING_KEY'
          ? { problem: 'needs-billing-key', message: e.message, checkedAt }
          : { problem: 'failed', message: e instanceof Error ? e.message : String(e), checkedAt };
      }
    }
    credit = { at: Date.now(), info };
    return info;
  };

  /** The online AI's settings, this month's spending and prices in pesos, the credit left, and the latest runs (owner: img.ai). */
  app.get('/api/img/ai', { config: { permission: 'img.ai' } }, async (req) => {
    const s = aiSettings(db);
    const rate = Math.round(s.ratePeso * 100);
    const month = today(deps.clock).slice(0, 7);
    const fresh = (req.query as { fresh?: string }).fresh === '1';
    return { ...s, month, spentPeso: spentThisMonth(db, month), credit: await creditLeft(s.ratePeso, fresh),
      prices: { best: pesoOf(AI_MODELS.best.mills, rate), economy: pesoOf(AI_MODELS.economy.mills, rate), crisp: pesoOf(AI_MODELS.crisp.mills, rate), vector: pesoOf(AI_MODELS.vector.mills, rate) },
      runs: recentRuns(db, 30, (id, step) => { const f = step === 'vectorize' ? 'design.svg' : 'out.png'; return existsSync(join(work, id, f)) ? `/api/img/results/${id}${step === 'vectorize' ? '/design.svg' : ''}` : null; }) };
  });
  app.put('/api/img/ai', { config: { permission: 'img.ai' } }, async (req) => {
    const saved = tx(db, () => saveAiSettings(db, req.body, { userId: currentUser(req).userId, at: stamp(deps.clock) }));
    credit = null; // a key or the rate changed: ask again
    return saved;
  });

  /**
   * One online AI run: the month's limit checked first, the run logged with its cost either way (a failed one costs
   * nothing: Fal.ai charges only for a result), and the result kept as the other tools' are (out.png or design.svg).
   */
  const aiRun = async (userId: string, step: AiStep, model: (typeof AI_MODELS)[keyof typeof AI_MODELS], input: Record<string, unknown>) => {
    const month = today(deps.clock).slice(0, 7);
    checkCap(db, month, model.mills);
    const started = Date.now();
    let bytes: Buffer;
    try {
      bytes = await (standAi ?? falService).run(readFalKey(db) ?? '', model.endpoint, input);
    } catch (e) {
      logRun(db, { at: stamp(deps.clock), month, userId, step, model: model.label, ok: false, mills: 0, ms: Date.now() - started, note: e instanceof Error ? e.message : String(e) });
      throw e;
    }
    // A result was given (and charged): kept first, then logged with where it is, so it can be downloaded again.
    const ms = Date.now() - started;
    const svg = step === 'vectorize';
    const got = svg ? (/<svg[\s>]/i.test(bytes.subarray(0, 4096).toString('utf8')) ? 'svg' : null) : sniffType(bytes);
    const fine = svg ? got === 'svg' : got === 'image/png' || got === 'image/jpeg' || got === 'image/webp';
    tidy();
    const id = randomUUID();
    if (fine) {
      mkdirSync(join(work, id), { recursive: true });
      writeFileSync(join(work, id, svg ? 'design.svg' : 'out.png'), bytes);
    }
    credit = null; // the run was charged: ask again
    logRun(db, { at: stamp(deps.clock), month, userId, step, model: model.label, ok: true, mills: model.mills, ms, ...(fine ? { resultId: id } : { note: 'The result was not a picture.' }) });
    if (!fine) throw new AppError('IMG_AI_FAILED', svg ? 'The vectorizer gave something other than an SVG. Try again.' : 'The online AI gave back something that is not a picture. Try again.', 502);
    const costPeso = pesoOf(model.mills, Math.round(aiSettings(db).ratePeso * 100));
    if (svg) {
      const url = `/api/img/results/${id}/design.svg`;
      return { id, url, files: { 'design.svg': url }, costPeso, ms };
    }
    return { id, url: `/api/img/results/${id}`, bytes: bytes.length, costPeso, ms };
  };

  app.post('/api/img/ai/mockup', { bodyLimit: 16 * 1024 * 1024, config: { permission: 'img.ai' } }, async (req) => {
    const m = mockupInput.parse(req.body);
    const images = m.back ? [m.front, m.back] : [m.front];
    for (const uri of images) if (uri.length > MAX_AI_BYTES * 1.4) throw new AppError('FILE_TOO_BIG', "A picture is bigger than 5 MB, the online AI's limit. Use a smaller one.", 413);
    return aiRun(currentUser(req).userId, 'mockup', AI_MODELS.best,
      { prompt: mockupPrompt(m.garment, !!m.back), image_urls: images, aspect_ratio: m.back ? '16:9' : '3:4', output_format: 'png' });
  });

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

    /**
     * The online AI (owner: img.ai), the body the picture: ?op=redraw&quality=best|economy|crisp&shape=tall|square|wide&text=remove|keep
     * &part=whole|front|back (front/back: one side of a picture showing both); ?op=back&shape&name&number (the back, made from
     * the front's flat artwork); ?op=vector (Recraft).
     */
    upload.post('/api/img/ai/run', { config: { permission: 'img.ai' } }, async (req) => {
      const q = aiQuery.safeParse(req.query);
      if (!q.success) throw new AppError('VALIDATION', 'Pick what the AI should do.', 400);
      const data = req.body;
      const type = Buffer.isBuffer(data) ? sniffType(data) : null;
      if (!Buffer.isBuffer(data) || !type || !EXT[type]) throw new AppError('FILE_TYPE', 'Only JPEG, PNG or WebP pictures can be used.', 415);
      if (data.length > MAX_AI_BYTES) throw new AppError('FILE_TOO_BIG', "The picture is bigger than 5 MB, the online AI's limit. Use a smaller one.", 413);
      const op = q.data;
      const uri = `data:${type};base64,${data.toString('base64')}`;
      const who = currentUser(req).userId;
      if (op.op === 'vector') return aiRun(who, 'vectorize', AI_MODELS.vector, { image_url: uri });
      if (op.op === 'back') {
        return aiRun(who, 'back', AI_MODELS.best, { prompt: backPrompt(op.name, op.number), image_urls: [uri], aspect_ratio: ASPECT[op.shape], output_format: 'png' });
      }
      const prompt = redrawPrompt(op.quality, op.text === 'remove', op.part, op.words);
      if (op.quality === 'crisp') return aiRun(who, 'redraw', AI_MODELS.crisp, { prompt, image_urls: [uri], image_size: GPT_SIZE[op.shape], quality: 'high', output_format: 'png' });
      return op.quality === 'best'
        ? aiRun(who, 'redraw', AI_MODELS.best, { prompt, image_urls: [uri], aspect_ratio: ASPECT[op.shape], output_format: 'png' })
        : aiRun(who, 'redraw', AI_MODELS.economy, { prompt, image_url: uri, aspect_ratio: ASPECT[op.shape], output_format: 'png' });
    });
  });
}
