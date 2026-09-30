/**
 * Attachments in backups (PLAN C8): each attached file is backed up once, encrypted to the recovery keys, beside the
 * database copies, and goes off-site and to USB with them; a restore puts the files back; the drill reports a file
 * missing from the backup or changed.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Encrypter, generateX25519Identity, identityToRecipient } from 'age-encryption';
import { PASSWORD, createTestEnv, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { attachmentsDir } from '../../../engine/attachments.ts';
import { prepareDatabase } from '../../../app.ts';
import { openDb } from '../../../platform/db/driver.ts';
import { openBackup } from '../restore.ts';
import { loadModules } from '../../load.ts';

let env: TestEnv;
let owner: Client, accountant: Client;
let dir: string;
let keys: { identity: string; recipient: string }[];
let jvId: string;
let photo: Buffer;
let sha: string;

const newKey = async () => {
  const identity = await generateX25519Identity();
  return { identity, recipient: await identityToRecipient(identity) };
};
const account = (code: string) => env.db.prepare('SELECT id FROM accounts WHERE code = ?').pluck().get(code) as number;
const stepUp = (c: Client) => c.post('/api/auth/step-up', { password: PASSWORD });
const JPEG = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(2048)]);
const attach = (data: Buffer, name: string) =>
  accountant.post(`/api/docs/acc.jv/${jvId}/attachments`, data, { 'content-type': 'application/octet-stream', 'x-file-name': name });
const backUp = async () => {
  const r = await owner.post('/api/bak/run', {}, idem());
  expect(r.statusCode, r.body).toBe(200);
  return r.json() as { file: string; attachments: { files: number; newFiles: number; missing: string[] }; attachmentsError: string | null };
};
const encrypted = (folder: string) => (existsSync(join(folder, 'attachments')) ? readdirSync(join(folder, 'attachments')) : []);
const check = async (purpose: 'drill' | 'restore', file: string) => {
  await stepUp(owner);
  return owner.post('/api/bak/restore/check', { source: 'local', file, key: keys[0]!.identity, purpose });
};

beforeEach(async () => {
  env = await createTestEnv();
  owner = await env.as('owner');
  accountant = await env.as('accountant');
  dir = mkdtempSync(join(tmpdir(), 'moonproject-bak-att-'));
  process.env.MOONPROJECT_RESTORE_DIR = join(dir, 'restore');
  keys = [await newKey(), await newKey()];
  await stepUp(owner);
  const settings = { backupDir: join(dir, 'local'), offsiteDir: join(dir, 'offsite'), recipients: keys.map((k) => k.recipient) };
  expect((await owner.put('/api/bak/settings', settings)).statusCode).toBe(200);
  const jv = await accountant.post('/api/docs/acc.jv/post', {
    input: { memo: 'Rent for September', lines: [{ accountId: account('1101'), debitCents: 900_000 }, { accountId: account('3900'), creditCents: 900_000 }] },
    expectedTotalCents: 900_000,
  }, idem());
  expect(jv.statusCode, jv.body).toBe(200);
  jvId = jv.json().id;
  photo = JPEG();
  const added = await attach(photo, 'lease.jpg');
  expect(added.statusCode, added.body).toBe(200);
  sha = added.json().sha256;
});
afterEach(async () => {
  delete process.env.MOONPROJECT_RESTORE_DIR;
  const live = attachmentsDir(env.db);
  await env.app.close();
  env.db.close();
  rmSync(dir, { recursive: true, force: true });
  rmSync(live, { recursive: true, force: true });
});

describe('attachments in backups', () => {
  it('backs up each attached file once, encrypted, and copies it off-site and to USB with the backups', async () => {
    const first = await backUp();
    expect(first.attachments).toMatchObject({ files: 1, newFiles: 1, missing: [] });
    const [name] = encrypted(join(dir, 'local'));
    expect(name).toMatch(new RegExp(`^${sha}\\.[0-9a-f]{12}\\.age$`));
    const stored = readFileSync(join(dir, 'local', 'attachments', name!));
    expect(stored.includes(photo.subarray(4, 64))).toBe(false); // encrypted, not the picture
    expect(JSON.parse(readFileSync(join(dir, 'local', first.file.replace('.db.gz.age', '.json')), 'utf8')).attachments).toMatchObject({ files: 1, newFiles: 1 });
    expect(encrypted(join(dir, 'offsite'))).toEqual([name]); // the first backup is yearly, so it goes off-site

    // The next backup adds nothing for the same file; a new file is added once.
    env.clock.advance(60_000);
    expect((await backUp()).attachments).toMatchObject({ files: 1, newFiles: 0 });
    expect((await attach(JPEG(), 'receipt.jpg')).statusCode).toBe(200);
    env.clock.advance(60_000);
    expect((await backUp()).attachments).toMatchObject({ files: 2, newFiles: 1 });
    expect(encrypted(join(dir, 'local'))).toHaveLength(2);

    const usb = join(dir, 'usb');
    expect((await owner.post('/api/bak/usb', { drive: 'A', dir: usb })).statusCode).toBe(200);
    expect(encrypted(usb)).toHaveLength(2);
  });

  it('logs a file missing from the attachments folder, and still backs up the rest', async () => {
    rmSync(join(attachmentsDir(env.db), sha));
    const r = await backUp();
    expect(r.attachments).toMatchObject({ files: 1, newFiles: 0, missing: [sha] });
    expect(env.db.prepare(`SELECT status, error FROM bak_runs`).get()).toEqual({ status: 'ok', error: expect.stringContaining(`were not backed up: ${sha}`) });
  });

  it('a restore brings the files back, here and on a new PC', async () => {
    const { file } = await backUp();
    rmSync(join(attachmentsDir(env.db), sha));
    const url = `/api/docs/acc.jv/${jvId}/attachments/${(await accountant.get(`/api/docs/acc.jv/${jvId}/attachments`)).json()[0].id}`;
    expect((await accountant.get(url)).json().code).toBe('FILE_MISSING');

    const res = await check('restore', file);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().attachments).toEqual({ files: 1, bytes: photo.length, missing: [], changed: [] });
    expect(readFileSync(join(attachmentsDir(env.db), sha)).equals(photo)).toBe(true);
    expect((await accountant.get(url)).rawPayload.equals(photo)).toBe(true);

    // A new PC (the command-line restore): the files land beside the new database.
    const newPc = join(dir, 'new-pc', 'attachments');
    const modules = await loadModules();
    const blank = openDb(':memory:');
    prepareDatabase(blank, env.clock, modules);
    const migrations = blank.prepare('SELECT id, checksum FROM schema_migrations ORDER BY id').all() as { id: string; checksum: string }[];
    const facts = await openBackup(join(dir, 'local', file), keys[1]!.identity, join(dir, 'new-pc', 'staged.db'), migrations, () => undefined, { restoreAttachmentsTo: newPc });
    expect(facts.attachments.missing).toEqual([]);
    expect(readFileSync(join(newPc, sha)).equals(photo)).toBe(true);
  });

  it('the drill checks every file and reports one missing from the backup or changed', async () => {
    const { file } = await backUp();
    const passed = await check('drill', file);
    expect(passed.statusCode, passed.body).toBe(200);
    expect(passed.json()).toMatchObject({ drill: 'passed', attachments: { files: 1, missing: [], changed: [] } });

    const [name] = encrypted(join(dir, 'local'));
    const encryptedFile = join(dir, 'local', 'attachments', name!);
    const good = readFileSync(encryptedFile);
    const e = new Encrypter();
    for (const k of keys) e.addRecipient(k.recipient);
    writeFileSync(encryptedFile, await e.encrypt(JPEG()));
    const changed = await check('drill', file);
    expect([changed.statusCode, changed.json().code, changed.json().details]).toEqual([422, 'ATTACHMENTS_BAD', { files: 1, bytes: photo.length, missing: [], changed: [sha] }]);

    rmSync(encryptedFile);
    const missing = await check('drill', file);
    expect([missing.statusCode, missing.json().details.missing]).toEqual([422, [sha]]);
    expect(missing.json().message).toContain(`1 missing (${sha})`);
    expect(env.db.prepare(`SELECT result FROM bak_restore_checks WHERE purpose = 'drill' ORDER BY at, rowid`).pluck().all()).toEqual(['ok', 'failed', 'failed']);

    writeFileSync(encryptedFile, good);
    expect((await check('drill', file)).statusCode).toBe(200);
  });
});
