/** The image tools' routes (the owner's request, Oct 2026), with stand-in tools: the real ones need the shop PC's card. */
import { copyFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTestEnv, type TestEnv } from '../../../../test/helpers.ts';
import { smallPng } from '../../../../test/pictures.ts';
import { useImageToolsForTests } from '../routes.ts';
import type { ImageTools } from '../tools.ts';

let env: TestEnv;
const calls: string[] = [];
const stand = (installed = { upscale: true, background: true }): ImageTools => ({
  installed: () => installed,
  upscale: async (input, output, scale, kind) => { calls.push(`upscale ${scale} ${kind}`); copyFileSync(input, output); },
  removeBackground: async (input, output, cutout) => { calls.push(`background ${cutout}`); copyFileSync(input, output); },
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
  useImageToolsForTests(stand({ upscale: true, background: false }));
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
