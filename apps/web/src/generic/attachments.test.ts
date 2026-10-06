/** The web client's attachment calls against the real server (in memory): add a picture as it is, list, remove with a reason. */
import { rmSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestEnv } from '../../../server/test/helpers.ts';
import { smallJpeg } from '../../../server/test/pictures.ts';
import { SESSION_COOKIE } from '../../../server/src/engine/security/sessions.ts';
import { attachmentsDir } from '../../../server/src/engine/attachments.ts';
import { attachmentUrl, createApi, newIdempotencyKey } from '../api.ts';

/** fetch() backed by app.inject; a Blob body goes as its bytes, as the browser sends a File. */
const injectFetch = (app: FastifyInstance, jar = { cookie: '' }) => async (url: string, init: RequestInit) => {
  const payload = init.body instanceof Blob ? Buffer.from(await init.body.arrayBuffer()) : (init.body as string);
  const res = await app.inject({ method: init.method as 'GET', url, payload, headers: { ...(init.headers as object), cookie: jar.cookie } });
  const set = res.cookies.find((c) => c.name === SESSION_COOKIE);
  if (set) jar.cookie = set.value ? `${set.name}=${set.value}` : '';
  return new Response(res.body || null, { status: res.statusCode });
};

describe('attachments from the web client', () => {
  it('adds a photo to a document, lists it, refuses a renamed program and removes with a reason', async () => {
    const env = await createTestEnv();
    const api = createApi(injectFetch(env.app));
    await api.firstOwner({ username: 'owner1', displayName: 'Test Owner', password: 'moon garden paper lamp' });
    const place = (name: string) => api.cashPlaces().then((ps) => ps.find((p) => p.name.endsWith(name))!.id);
    const input = { fromCashPlaceId: await place('BDO'), toCashPlaceId: await place('China Bank'), amountSentCents: 100_000, amountReceivedCents: 100_000 };
    const { id } = await api.post('cash.transfer', input, 100_000, newIdempotencyKey());

    const jpeg = smallJpeg();
    const photo = new File([new Uint8Array(jpeg)], 'bank slip – 1.jpg', { type: 'image/jpeg' });
    const added = await api.addAttachment('cash.transfer', id, photo);
    expect(added).toMatchObject({ fileName: 'bank slip – 1.jpg', contentType: 'image/jpeg', bytes: jpeg.length, addedByName: 'Test Owner', removedAt: null });
    expect(await api.attachments('cash.transfer', id)).toEqual([added]);
    expect(attachmentUrl('cash.transfer', id, added.id)).toBe(`/api/docs/cash.transfer/${id}/attachments/${added.id}`);

    const program = new File(['MZ this program cannot be run in DOS mode'], 'photo.jpg', { type: 'image/jpeg' });
    await expect(api.addAttachment('cash.transfer', id, program)).rejects.toMatchObject({ code: 'FILE_TYPE', status: 415 });

    const removed = await api.removeAttachment('cash.transfer', id, added.id, 'Slip of another transfer');
    expect(removed).toMatchObject({ removedByName: 'Test Owner', removedReason: 'Slip of another transfer' });
    expect((await api.attachments('cash.transfer', id)).map((a) => a.removedReason)).toEqual(['Slip of another transfer']);
    const dir = attachmentsDir(env.db);
    await env.app.close();
    env.db.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
