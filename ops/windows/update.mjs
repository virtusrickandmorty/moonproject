/**
 * Safe updates (PLAN C8 "Updates"). Moonproject-Setup.exe runs this on an update, with Node's own built-ins only
 * (node:sqlite), from a copy of node.exe in Setup's temporary folder, so it may move the program folders:
 *   before  The service is stopped, so nothing is being written. Makes a copy of the database and checks it, then moves
 *           the program (app, node, service, VERSION.txt) to <app>\previous: the new version installs into clean
 *           folders, and a file the new version dropped (an old migration) cannot linger.
 *   after   The new version was started. Waits for /api/health to answer with the new version. If it does not, and
 *           nothing was recorded since the copy (the audit log did not grow), it puts the previous program and the
 *           copy back and starts that again.
 * Each step logs to <data>\logs\update.log. The outcome goes to <data>\update\last-update.json and, for Setup's message,
 * last-update.txt (line 1: updated, rolled-back or failed; line 2: what to tell the owner).
 * Usage: node update.mjs before --app <Program Files\Moonproject> --data <ProgramData\Moonproject> --to <version>
 *        node update.mjs after --app ... --data ... [--wait <seconds>]
 */
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { appendFileSync, copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { get as httpGet } from 'node:http';
import { get as httpsGet } from 'node:https';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const { positionals, values: opt } = parseArgs({
  allowPositionals: true,
  options: {
    app: { type: 'string' },
    data: { type: 'string' },
    to: { type: 'string' },
    wait: { type: 'string', default: '180' },
    health: { type: 'string', default: 'https://127.0.0.1/api/health' },
    service: { type: 'string' }, // the service wrapper; a test passes a stand-in script
  },
});
const [step] = positionals;
if (!opt.app || !opt.data || !['before', 'after'].includes(step ?? '') || (step === 'before' && !opt.to)) {
  console.error('Usage: node update.mjs before|after --app <program folder> --data <data folder> [--to <version>] [--wait <seconds>]');
  process.exit(2);
}

/** What an update replaces; everything else in the program folder (the uninstaller) stays. */
const PROGRAM = ['app', 'node', 'service', 'VERSION.txt'];
const KEEP_COPIES = 3;
const db = join(opt.data, 'data', 'moonproject.db');
const dir = join(opt.data, 'update');
const previous = join(opt.app, 'previous');
const pendingFile = join(dir, 'pending.json');
const logFile = join(opt.data, 'logs', 'update.log');

function log(message) {
  const line = `${new Date().toISOString()} ${step}: ${message}`;
  console.log(line);
  try {
    mkdirSync(join(opt.data, 'logs'), { recursive: true });
    appendFileSync(logFile, `${line}\n`);
  } catch {
    // the console line is enough
  }
}

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** A rename can fail for a moment while Windows or an antivirus still holds a file that was just closed. */
function move(from, to) {
  for (let i = 0; ; i++) {
    try {
      return renameSync(from, to);
    } catch (e) {
      if (i >= 9) throw e;
      sleep(1000);
    }
  }
}

/**
 * Node strips types only outside node_modules, so the installer links @moonproject/shared to packages\shared (a
 * junction). It is removed before its folder moves (it would point into the other version) and made again after.
 */
const linkOf = (appDir) => join(appDir, 'node_modules', '@moonproject', 'shared');
function unlinkShared(appDir) {
  if (lstatSync(linkOf(appDir), { throwIfNoEntry: false })?.isSymbolicLink()) unlinkSync(linkOf(appDir));
}
function linkShared(appDir) {
  if (existsSync(join(appDir, 'packages', 'shared')) && !lstatSync(linkOf(appDir), { throwIfNoEntry: false })) {
    mkdirSync(join(appDir, 'node_modules', '@moonproject'), { recursive: true });
    symlinkSync(join(appDir, 'packages', 'shared'), linkOf(appDir), 'junction');
  }
}

function installedVersion(root) {
  try {
    return JSON.parse(readFileSync(join(root, 'app', 'version.json'), 'utf8')).version;
  } catch {
    // installs from before version.json: "Moonproject 0.1.7" on the first line of VERSION.txt
    return /^Moonproject (\S+)/.exec(readFileSync(join(root, 'VERSION.txt'), 'utf8'))?.[1] ?? null;
  }
}

function auditSeq(file) {
  const d = new DatabaseSync(file, { readOnly: true });
  try {
    return d.prepare('SELECT COALESCE(MAX(seq), 0) AS n FROM audit_log').get().n;
  } finally {
    d.close();
  }
}

function service(command) {
  const wrapper = opt.service ?? join(opt.app, 'service', 'moonproject-service.exe');
  if (!existsSync(wrapper)) return log(`No service wrapper at ${wrapper}, so it was not told to ${command}`);
  const [file, args] = wrapper.endsWith('.mjs') ? [process.execPath, [wrapper, command]] : [wrapper, [command]];
  try {
    execFileSync(file, args, { stdio: 'pipe', timeout: 120_000 });
    log(`Service: ${command}`);
  } catch (e) {
    log(`Service ${command} answered: ${String(e.stderr || e.message).trim()}`);
  }
}

const onWindows = process.platform === 'win32' && !opt.service;
function sc(...args) {
  try {
    return execFileSync('sc.exe', args, { encoding: 'utf8', stdio: 'pipe' });
  } catch (e) {
    return `${e.stdout ?? ''}${e.stderr ?? ''}`;
  }
}

/**
 * A version that cannot start keeps failing, and Windows restarts it (the service's failure actions) up to two minutes
 * later, maybe while its folders move. So the service is disabled until they have moved, and waited for until stopped.
 */
function stopAndHold() {
  if (onWindows) sc('config', 'Moonproject', 'start=', 'disabled');
  service('stop');
  for (let i = 0; onWindows && i < 60 && !/STOPPED|1060/.test(sc('query', 'Moonproject')); i++) sleep(1000);
}
function release() {
  if (onWindows) sc('config', 'Moonproject', 'start=', 'auto');
  service('start');
}

function health(url) {
  return new Promise((resolve) => {
    const get = url.startsWith('https:') ? httpsGet : httpGet;
    // The loopback check only asks whether the server answers; the name on its certificate is the shop's, not 127.0.0.1.
    const req = get(url, { rejectUnauthorized: false, timeout: 5000 }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          resolve(res.statusCode === 200 && json.ok === true ? json : null);
        } catch {
          resolve(null);
        }
      });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
  });
}

/** Waits for the server to answer as `version`. Versions installed before version.json neither know nor say theirs. */
async function answers(version, seconds) {
  const until = Date.now() + seconds * 1000;
  let last = null;
  do {
    last = await health(opt.health);
    if (last && (last.version === version || version === null || last.version === undefined)) return true;
    await new Promise((r) => setTimeout(r, 1000));
  } while (Date.now() < until);
  log(last ? `The server answered as ${last.version}, not ${version}` : `No answer from ${opt.health} in ${seconds} s`);
  return false;
}

function finish(result, pending, message) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'last-update.json'), `${JSON.stringify({ result, from: pending.from, to: pending.to, at: new Date().toISOString(), copy: pending.copy, message }, null, 2)}\n`);
  writeFileSync(join(dir, 'last-update.txt'), `${result}\r\n${message}\r\n`);
  rmSync(pendingFile, { force: true });
  log(`${result}: ${message}`);
}

function before() {
  mkdirSync(dir, { recursive: true });
  for (const f of [pendingFile, join(dir, 'last-update.json'), join(dir, 'last-update.txt')]) rmSync(f, { force: true });
  const from = installedVersion(opt.app);
  let copy = null;
  let seq = null;
  if (existsSync(db)) {
    copy = join(dir, `moonproject-before-${opt.to.replace(/[^\w.-]/g, '_')}-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
    const d = new DatabaseSync(db);
    try {
      d.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      seq = d.prepare('SELECT COALESCE(MAX(seq), 0) AS n FROM audit_log').get().n;
      d.prepare('VACUUM INTO ?').run(copy);
    } finally {
      d.close();
    }
    const c = new DatabaseSync(copy, { readOnly: true });
    try {
      const check = c.prepare('PRAGMA integrity_check').all().map((r) => Object.values(r)[0]);
      if (check.length !== 1 || check[0] !== 'ok') throw new Error(`The copy failed its check: ${check.join('; ')}`);
    } finally {
      c.close();
    }
    if (auditSeq(copy) !== seq) throw new Error('The copy does not hold the whole audit log');
    log(`Copied the database (audit log up to ${seq}) to ${copy}`);
  }

  rmSync(previous, { recursive: true, force: true, maxRetries: 5 });
  mkdirSync(previous);
  unlinkShared(join(opt.app, 'app'));
  const moved = [];
  try {
    for (const p of PROGRAM) {
      if (!existsSync(join(opt.app, p))) continue;
      move(join(opt.app, p), join(previous, p));
      moved.push(p);
    }
  } catch (e) {
    for (const p of moved) move(join(previous, p), join(opt.app, p));
    linkShared(join(opt.app, 'app'));
    throw e;
  }
  writeFileSync(pendingFile, `${JSON.stringify({ from, to: opt.to, copy, auditSeq: seq, at: new Date().toISOString() }, null, 2)}\n`);
  log(`Ready to install ${opt.to} over ${from ?? 'an unknown version'}; the program is kept in ${previous}`);
}

async function after() {
  if (!existsSync(pendingFile)) return log('No update was in progress');
  const pending = JSON.parse(readFileSync(pendingFile, 'utf8'));
  if (await answers(pending.to, Number(opt.wait))) {
    const copies = readdirSync(dir).filter((f) => f.startsWith('moonproject-before-') && f.endsWith('.db')).sort();
    for (const f of copies.slice(0, -KEEP_COPIES)) rmSync(join(dir, f), { force: true });
    finish('updated', pending, `Moonproject was updated from ${pending.from} to ${pending.to}. A copy of the database from just before the update is kept in ${dir}.`);
    return;
  }

  stopAndHold();
  const now = existsSync(db) ? auditSeq(db) : null;
  if (now !== pending.auditSeq) {
    finish('failed', pending, `The new version (${pending.to}) did not answer, and something was recorded after the update began, so the old version was not put back by itself. Nothing was deleted: the copy from before the update is ${pending.copy}. Please send ${logFile} to whoever gave you the update.`);
    release();
    process.exitCode = 1;
    return;
  }

  log(`Putting back ${pending.from}`);
  unlinkShared(join(opt.app, 'app'));
  for (const p of PROGRAM) {
    rmSync(join(opt.app, p), { recursive: true, force: true, maxRetries: 5 });
    if (existsSync(join(previous, p))) move(join(previous, p), join(opt.app, p));
  }
  linkShared(join(opt.app, 'app'));
  if (pending.copy) {
    for (const suffix of ['-wal', '-shm']) rmSync(`${db}${suffix}`, { force: true });
    copyFileSync(pending.copy, db);
    log(`Put back the database copied before the update`);
  }
  release();
  process.exitCode = 1;
  if (await answers(pending.from, Number(opt.wait))) {
    finish('rolled-back', pending, `The new version (${pending.to}) did not start, so Moonproject went back to ${pending.from}. Nothing was lost. Please send ${logFile} to whoever gave you the update.`);
  } else {
    finish('failed', pending, `The new version (${pending.to}) did not start, and ${pending.from} did not start again either. The copy from before the update is ${pending.copy}. Please send ${logFile} to whoever gave you the update.`);
  }
}

try {
  if (step === 'before') before();
  else await after();
} catch (e) {
  log(`Stopped: ${e.stack ?? e}`);
  process.exitCode = 1;
}
