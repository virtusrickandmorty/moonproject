/**
 * Stages what Moonproject-Setup.exe installs (PLAN C6, C8), into ops/windows/out/stage:
 *   node/node.exe       the Node that runs this script (the CI job's Node 24), so better-sqlite3's binary matches it
 *   app/                the server source (Node runs it directly, stripping the types), the built web app, and the
 *                       production node_modules; the @moonproject/shared link is made by the installer (see the .iss)
 *   service/            WinSW, the Windows service wrapper, with moonproject-service.xml
 * Setup also carries update.mjs, which it runs on an update (backup first, roll back if the new version fails).
 * Run on Windows after `npm ci` and the web build: `node ops/windows/stage.mjs`.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const out = join(repo, 'ops', 'windows', 'out', 'stage');
const app = join(out, 'app');
/** WinSW 2.12.0, x64, MIT licence: https://github.com/winsw/winsw/releases/tag/v2.12.0 */
const WINSW = 'https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW-x64.exe';

if (!existsSync(join(repo, 'apps', 'web', 'dist', 'index.html'))) throw new Error('Build the web app first: npm run build -w @moonproject/web');
rmSync(out, { recursive: true, force: true });
mkdirSync(app, { recursive: true });

// The server and shared source without tests; the web app as built; the workspace manifests npm ci needs.
const noTests = (src) => !relative(repo, src).split(sep).some((part) => part === 'tests' || part === 'test' || part.endsWith('.test.ts'));
for (const f of ['package.json', 'package-lock.json', 'apps/server/package.json', 'apps/web/package.json', 'packages/shared/package.json']) {
  cpSync(join(repo, f), join(app, f));
}
for (const d of ['apps/server/src', 'packages/shared/src', 'apps/web/dist']) cpSync(join(repo, d), join(app, d), { recursive: true, filter: noTests });

// The server's production dependencies only (without --workspace, npm also installs the web app's build tools). npm links the workspaces into node_modules/@moonproject; those links are removed,
// because Node does not strip types under node_modules: the installer links @moonproject/shared to packages/shared.
execFileSync('npm', ['ci', '--omit=dev', '--no-audit', '--no-fund', '--workspace', '@moonproject/server'], { cwd: app, stdio: 'inherit', shell: process.platform === 'win32' });
rmSync(join(app, 'node_modules', '@moonproject'), { recursive: true, force: true });
mkdirSync(join(app, 'node_modules', '@moonproject'));

mkdirSync(join(out, 'node'));
cpSync(process.execPath, join(out, 'node', 'node.exe'));

mkdirSync(join(out, 'service'));
const winsw = await fetch(WINSW);
if (!winsw.ok) throw new Error(`WinSW download failed: ${winsw.status}`);
writeFileSync(join(out, 'service', 'moonproject-service.exe'), Buffer.from(await winsw.arrayBuffer()));
cpSync(join(repo, 'ops', 'windows', 'moonproject-service.xml'), join(out, 'service', 'moonproject-service.xml'));

const version = process.env.MOONPROJECT_VERSION || '0.0.0-dev'; // the same default as moonproject.iss
writeFileSync(join(out, 'VERSION.txt'), `Moonproject ${version}\nNode ${process.version}\n`);
// The server reports it on /api/health (apps/server/src/platform/version.ts); an update checks it (update.mjs).
writeFileSync(join(app, 'version.json'), `${JSON.stringify({ version })}\n`);
console.log(`Staged ${version} in ${out}`);
