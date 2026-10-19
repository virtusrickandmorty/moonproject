/** The image tools' routes (the owner's request, Oct 2026), with stand-in tools: the real ones need the shop PC's card. */
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTestEnv, type TestEnv } from '../../../../test/helpers.ts';
import { smallPng } from '../../../../test/pictures.ts';
import { useImageToolsForTests } from '../routes.ts';
import type { FlatOptions, ImageTools, VectorOptions } from '../tools.ts';

let env: TestEnv;
const calls: string[] = [];
let given: FlatOptions | VectorOptions | null = null;
const stand = (installed = { upscale: true, background: true, art: true, erase: true }): ImageTools => ({
  installed: () => installed,
  upscale: async (input, output, scale, kind) => { calls.push(`upscale ${scale} ${kind}`); copyFileSync(input, output); },
  removeBackground: async (input, output, cutout) => { calls.push(`background ${cutout}`); copyFileSync(input, output); },
  flatten: async (input, output, options) => {
    given = options; copyFileSync(input, output);
    return { width: 4, height: 4, colours: [{ hex: 'ffffff', paint: null, share: 80, background: true }, { hex: 'c81e1e', paint: 'c81e1e', share: 20, background: false }] };
  },
  vectorize: async (_input, folder, options) => {
    given = options;
    writeFileSync(join(folder, 'design.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    writeFileSync(join(folder, 'design.pdf'), '%PDF-1.4');
    return { width: 4, height: 4, widthCm: options.width, heightCm: options.width, colours: [], shapes: 1, files: ['design.svg', 'design.pdf'], warnings: [] };
  },
  erase: async (input, mask, output) => { calls.push(`erase ${readFileSync(mask).length > 0}`); copyFileSync(input, output); },
});
beforeEach(async () => { env = await createTestEnv(); calls.length = 0; useImageToolsForTests(stand()); });
afterEach(() => useImageToolsForTests(null));

const send = async (who: Parameters<TestEnv['as']>[0], query: string, body: Buffer) => (await env.as(who)).post(`/api/img/run?${query}`, body, { 'content-type': 'application/octet-stream' });

it('upscales or cuts out a picture and gives the result back as a PNG, for those allowed', async () => {
  const picture = smallPng();
  const up = await send('encoder', 'op=upscale&scale=4&kind=photo', picture);
  expect(up.statusCode, up.body).toBe(200);
  const { id, url } = up.json() as { id: string; url: string };
  expect(calls).toEqual(['upscale 4 photo']);
  const got = await (await env.as('encoder')).get(url);
  expect(got.statusCode).toBe(200);
  expect(got.headers['content-type']).toBe('image/png');
  expect(Buffer.from(got.rawPayload).equals(picture)).toBe(true);

  expect((await send('owner', 'op=background&cutout=object', picture)).statusCode).toBe(200);
  expect(calls.at(-1)).toBe('background object');
  expect(((await (await env.as('owner')).get('/api/img/status')).json() as { upscale: boolean }).upscale).toBe(true);

  // Not production's (not given img.use); a picture only; a choice only from the list; an unknown result.
  expect((await send('production', 'op=upscale&scale=2&kind=artwork', picture)).statusCode).toBe(403);
  expect((await send('encoder', 'op=upscale&scale=2&kind=artwork', Buffer.from('%PDF-1.7 not a picture'))).json()).toMatchObject({ code: 'FILE_TYPE' });
  expect((await send('encoder', 'op=upscale&scale=8&kind=artwork', picture)).statusCode).toBe(400);
  expect((await (await env.as('encoder')).get(`/api/img/results/${id.replace(/.$/, id.endsWith('0') ? '1' : '0')}`)).statusCode).toBe(404);
});

it('says plainly when a tool is not installed on the shop PC yet', async () => {
  useImageToolsForTests(stand({ upscale: true, background: false, art: false, erase: false }));
  const r = await send('encoder', 'op=background&cutout=design', smallPng());
  expect(r.statusCode).toBe(503);
  expect(r.json()).toMatchObject({ code: 'IMG_NOT_INSTALLED' });
});

it('finds the tools by a full path, though the server opened the database by a relative one (the shop\'s does)', async () => {
  const { toolsDir } = await import('../tools.ts');
  const { isAbsolute } = await import('node:path');
  const saved = process.env.MOONPROJECT_IMG_TOOLS;
  delete process.env.MOONPROJECT_IMG_TOOLS;
  try {
    const dir = toolsDir('data/moonproject.db');
    expect(isAbsolute(dir)).toBe(true);
    expect(dir.split('\\').join('/')).toMatch(/\/data\/tools$/);
    process.env.MOONPROJECT_IMG_TOOLS = 'some/tools';
    expect(isAbsolute(toolsDir('data/moonproject.db'))).toBe(true);
  } finally {
    if (saved === undefined) delete process.env.MOONPROJECT_IMG_TOOLS; else process.env.MOONPROJECT_IMG_TOOLS = saved;
  }
});

it('turns a photo into flat art: corners, colours and a palette to repaint come through; the colours found come back', async () => {
  const r = await send('encoder', 'op=flatten&clean=2&light=1&colours=0&specks=2&clear=1&corners=0.1,0.1,0.9,0.05,0.95,0.9,0,1', smallPng());
  expect(r.statusCode, r.body).toBe(200);
  expect(given).toEqual({ clean: 2, light: true, colours: 0, specks: 2, clear: true, corners: [[0.1, 0.1], [0.9, 0.05], [0.95, 0.9], [0, 1]] });
  expect((r.json() as { info: { colours: unknown[] } }).info.colours).toHaveLength(2);

  // Again with the colours found: one made exact, the background kept clear ("-").
  expect((await send('encoder', 'op=flatten&clean=2&light=0&colours=0&specks=2&clear=1&palette=ffffff,c81e1e&paint=-,ff0000', smallPng())).statusCode).toBe(200);
  expect(given).toMatchObject({ palette: ['ffffff', 'c81e1e'], paint: [null, 'ff0000'] });
  // A paint for each colour; corners are four points; at most 12 colours.
  expect((await send('encoder', 'op=flatten&clean=2&light=0&colours=0&specks=2&clear=1&palette=ffffff,c81e1e&paint=-', smallPng())).statusCode).toBe(400);
  expect((await send('encoder', 'op=flatten&clean=2&light=0&colours=0&specks=2&clear=1&corners=0.1,0.1', smallPng())).statusCode).toBe(400);
  expect((await send('encoder', 'op=flatten&clean=2&light=0&colours=13&specks=2&clear=1', smallPng())).statusCode).toBe(400);
});

it('vectorizes into an SVG and a PDF, each served as itself and running nothing when opened alone', async () => {
  const r = await send('encoder', 'op=vectorize&style=cutter&colours=0&specks=1&edges=sharp&width=20&invert=0&mirror=1', smallPng());
  expect(r.statusCode, r.body).toBe(200);
  expect(given).toEqual({ style: 'cutter', colours: 0, specks: 1, edges: 'sharp', width: 20, invert: false, mirror: true });
  const { files } = r.json() as { files: Record<string, string> };
  expect(Object.keys(files)).toEqual(['design.svg', 'design.pdf']);
  const svg = await (await env.as('encoder')).get(files['design.svg']!);
  expect(svg.headers['content-type']).toBe('image/svg+xml');
  expect(svg.headers['content-security-policy']).toContain('sandbox');
  expect((await (await env.as('encoder')).get(files['design.pdf']!)).headers['content-type']).toBe('application/pdf');
  // Only the result's own files.
  expect((await (await env.as('encoder')).get(files['design.svg']!.replace('design.svg', 'in.png'))).statusCode).toBe(404);
  expect((await send('encoder', 'op=vectorize&style=cutter&colours=0&specks=1&edges=sharp&width=900&invert=0&mirror=0', smallPng())).statusCode).toBe(400);
  // Full colour (sublimation): 16, 32 or 64 colours; not any number.
  expect((await send('encoder', 'op=vectorize&style=full&colours=32&specks=1&edges=smooth&width=60&invert=0&mirror=0', smallPng())).statusCode).toBe(200);
  expect(given).toMatchObject({ style: 'full', colours: 32 });
  expect((await send('encoder', 'op=vectorize&style=full&colours=40&specks=1&edges=smooth&width=60&invert=0&mirror=0', smallPng())).statusCode).toBe(400);

  useImageToolsForTests(stand({ upscale: true, background: true, art: false, erase: false }));
  expect((await send('encoder', 'op=vectorize&style=colour&colours=0&specks=1&edges=smooth&width=25&invert=0&mirror=0', smallPng())).json()).toMatchObject({ code: 'IMG_NOT_INSTALLED' });
});

it('erases what is marked (a name or number before the AI, a leftover after), for those with the image tools', async () => {
  const png = `data:image/png;base64,${smallPng().toString('base64')}`;
  const r = await (await env.as('encoder')).post('/api/img/erase', { image: png, mask: png });
  expect(r.statusCode, r.body).toBe(200);
  expect(calls).toEqual(['erase true']);
  expect((await (await env.as('encoder')).get((r.json() as { url: string }).url)).headers['content-type']).toBe('image/png');
  expect((await (await env.as('encoder')).post('/api/img/erase', { image: 'data:text/plain;base64,aGk=', mask: png })).statusCode).toBe(400);
  expect((await (await env.as('production')).post('/api/img/erase', { image: png, mask: png })).statusCode).toBe(403);
  useImageToolsForTests(stand({ upscale: true, background: true, art: true, erase: false }));
  expect((await (await env.as('encoder')).post('/api/img/erase', { image: png, mask: png })).json()).toMatchObject({ code: 'IMG_NOT_INSTALLED' });
});
