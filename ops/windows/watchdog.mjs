/**
 * The watchdog (PLAN C8 "Health"). Windows restarts the service when the server exits, but not when it hangs or when
 * the service was stopped by force. Setup installs a scheduled task, "Moonproject Watchdog", that runs this as SYSTEM
 * every 5 minutes with the installed Node, built-ins only:
 *   check    Asks /api/health. When it has not answered twice in a row, restarts the Moonproject service and logs the
 *            restart to <data>\logs\watchdog.log. It waits until the service has really stopped (WinSW "stopwait",
 *            then the service state) before starting it again, so a slow stop is never started over. It leaves the service alone while an update runs (Setup pauses the
 *            task; the service is disabled, or <data>\update\pending.json is there).
 *   install  Registers the task, replacing an older one. Setup runs it after the service has started.
 * Setup removes the task on uninstall.
 * Usage: node watchdog.mjs check|install [--app <Program Files\Moonproject>] [--data <ProgramData\Moonproject>]
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { get as httpGet } from 'node:http';
import { get as httpsGet } from 'node:https';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const TASK = 'Moonproject Watchdog';
const SCRIPT = fileURLToPath(import.meta.url);
/** A miss older than this is not "in a row" with the next one (the PC slept, or the task was paused). */
const IN_A_ROW_MS = 12 * 60_000;

const { positionals, values: opt } = parseArgs({
  allowPositionals: true,
  options: {
    app: { type: 'string', default: dirname(dirname(SCRIPT)) }, // this script is in <app>\service
    data: { type: 'string', default: join(process.env.ProgramData ?? 'C:\\ProgramData', 'Moonproject') },
    health: { type: 'string', default: 'https://127.0.0.1/api/health' },
    timeout: { type: 'string', default: '20' },
    service: { type: 'string' }, // the service wrapper; a test passes a stand-in script
  },
});
const [step] = positionals;
if (!['check', 'install'].includes(step ?? '')) {
  console.error('Usage: node watchdog.mjs check|install [--app <program folder>] [--data <data folder>]');
  process.exit(2);
}

const logFile = join(opt.data, 'logs', 'watchdog.log');
const stateFile = join(opt.data, 'logs', 'watchdog-state.json');
const onWindows = process.platform === 'win32' && !opt.service;

function log(message) {
  const line = `${new Date().toISOString()} ${message}`;
  console.log(line);
  mkdirSync(dirname(logFile), { recursive: true });
  appendFileSync(logFile, `${line}\n`);
}

function health(url) {
  return new Promise((resolve) => {
    const get = url.startsWith('https:') ? httpsGet : httpGet;
    // Only whether the server answers: the name on its certificate is the shop's, not 127.0.0.1.
    const req = get(url, { rejectUnauthorized: false, timeout: Number(opt.timeout) * 1000 }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        try {
          resolve(res.statusCode === 200 && JSON.parse(body).ok === true);
        } catch {
          resolve(false);
        }
      });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(false));
  });
}

function sc(...args) {
  try {
    return execFileSync('sc.exe', args, { encoding: 'utf8', stdio: 'pipe' });
  } catch (e) {
    return `${e.stdout ?? ''}${e.stderr ?? ''}`;
  }
}

function service(command) {
  const wrapper = opt.service ?? join(opt.app, 'service', 'moonproject-service.exe');
  const [file, args] = wrapper.endsWith('.mjs') ? [process.execPath, [wrapper, command]] : [wrapper, [command]];
  try {
    execFileSync(file, args, { stdio: 'pipe', timeout: 120_000 });
    return null;
  } catch (e) {
    return String(e.stderr || e.message).trim();
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** How long a stop may take: WinSW ends the server after 30 s (stoptimeout), plus room for Windows to settle. */
const STOP_WAIT_MS = 90_000;

/** The service state from Windows ("running", "stop_pending", "stopped", ...). */
const serviceState = () => /STATE\s*:\s*\d+\s+(\w+)/.exec(sc('query', 'Moonproject'))?.[1]?.toLowerCase() ?? 'unknown';

/** Stops the service and waits until Windows says it is stopped; the state it ended in. */
async function stopAndWait() {
  service('stopwait'); // WinSW 2.12 returns once the service has stopped; one that was already stopped says so, which is fine
  if (!onWindows) return 'stopped';
  const until = Date.now() + STOP_WAIT_MS;
  let now = serviceState();
  while (now !== 'stopped' && Date.now() < until) {
    await sleep(2000);
    now = serviceState();
  }
  return now;
}

const readMisses = () => {
  try {
    const s = JSON.parse(readFileSync(stateFile, 'utf8'));
    return Date.now() - Date.parse(s.at) < IN_A_ROW_MS ? s.misses : 0;
  } catch {
    return 0;
  }
};
const writeMisses = (misses) => {
  mkdirSync(dirname(stateFile), { recursive: true });
  writeFileSync(stateFile, `${JSON.stringify({ misses, at: new Date().toISOString() })}\n`);
};

async function check() {
  if (await health(opt.health)) return writeMisses(0);
  // An update stops the service and moves its folders: Setup starts it again when it is done.
  if (existsSync(join(opt.data, 'update', 'pending.json'))) return writeMisses(0);
  let state = 'stopped';
  if (onWindows) {
    const config = sc('qc', 'Moonproject');
    if (/1060/.test(config) || /START_TYPE\s*:\s*4/.test(config)) return writeMisses(0); // not installed, or held off on purpose
    state = serviceState();
  }
  const misses = readMisses() + 1;
  if (misses < 2) return writeMisses(misses);
  writeMisses(0);
  const stopped = await stopAndWait(); // a hung server is stopped (WinSW ends it after 30 s)
  if (stopped !== 'stopped') {
    log(`No answer from ${opt.health} twice in a row (the service was ${state}). It did not stop within ${STOP_WAIT_MS / 1000} s (it is ${stopped}), so it was not started again; the next check tries again.`);
    process.exitCode = 1;
    return;
  }
  const failed = service('start');
  log(failed
    ? `No answer from ${opt.health} twice in a row (the service was ${state}). Starting it again failed: ${failed}`
    : `No answer from ${opt.health} twice in a row (the service was ${state}): restarted the Moonproject service`);
  if (failed) process.exitCode = 1;
}

/** No double quotes in the command: Windows would have to pass them through two layers of quoting. */
function install() {
  const ps = [
    "$ErrorActionPreference = 'Stop'",
    "$a = New-ScheduledTaskAction -Execute $env:WD_NODE -Argument ([char]34 + $env:WD_SCRIPT + [char]34 + ' check')",
    '$t = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 5)',
    "$p = New-ScheduledTaskPrincipal -UserId 'NT AUTHORITY\\SYSTEM' -LogonType ServiceAccount -RunLevel Highest",
    '$s = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 4)',
    "Register-ScheduledTask -TaskName $env:WD_TASK -Action $a -Trigger $t -Principal $p -Settings $s -Description 'Restarts Moonproject when it has not answered twice in a row. Checks every 5 minutes.' -Force | Out-Null",
  ].join('; ');
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps], {
    env: { ...process.env, WD_NODE: process.execPath, WD_SCRIPT: SCRIPT, WD_TASK: TASK }, stdio: 'inherit',
  });
  log(`Installed the "${TASK}" task: every 5 minutes`);
}

try {
  if (step === 'install') install();
  else await check();
} catch (e) {
  try {
    log(`Stopped: ${e.stack ?? e}`);
  } catch {
    console.error(e);
  }
  process.exitCode = 1;
}
