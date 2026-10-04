# A0 — Baseline and readiness

## Identity and immutable application baseline

- Audit run: `codex2-independent-01`.
- Repository: https://github.com/virtusrickandmorty/moonproject.
- Immutable application SHA: `d4bc1ef84f2771a9f8720f199c9cd4d831dbc949`.
- Application commit date (author and committer): **2026-10-04T23:24:32+08:00**.
- Actual local setup and smoke-check date: **2026-10-05**, Asia/Manila.
- Pre-publication fetch completed at approximately **2026-10-05T01:46:37+08:00**.
- Fetched publication base, `origin/main`: `d4bc1ef84f2771a9f8720f199c9cd4d831dbc949`.
- Report branch: `audit/codex2-independent-01-baseline`, starting from that fetched current main.
- Model and effort: **owner-selected / not independently verified**.
- No existing run baseline or report artifacts were present on fetched main. Searches of open and closed PRs for this run and of the intended remote report branch returned none before publication.

The application SHA is frozen to the initial clean clone as instructed. Application inspection, dependency installation and smoke execution used that detached SHA, independently of the report branch. Subsequent report commits and future changes to main do not change the application baseline. Future tasks must reuse this recorded SHA rather than selecting a new application baseline.

## Verified local workspace and isolation

Actual OS: **Microsoft Windows NT 10.0.26300.0**, Node platform `win32`, architecture `x64`; local PowerShell shell. This run used no cloud workspace.

Verified registered source root:

```text
%USERPROFILE%/Documents/Codex/2026-10-05/cloud-environment-plugin-cloud-environment-openai/moonproject-independent-audit
```

The path existed, `git rev-parse --show-toplevel` identified exactly that root, and `git remote get-url origin` returned `https://github.com/virtusrickandmorty/moonproject`. Its branch was `main`, HEAD was the application SHA above, and its working tree was clean. Fetch did not switch, reset or discard that checkout.

Separate task-owned checkouts outside the registered source root:

```text
Application: %USERPROFILE%/Documents/Codex/2026-10-05/cloud-environment-plugin-cloud-environment-openai/work/codex2-independent-01-app
Report:      %USERPROFILE%/Documents/Codex/2026-10-05/cloud-environment-plugin-cloud-environment-openai/work/codex2-independent-01-report
Tooling:     %USERPROFILE%/Documents/Codex/2026-10-05/cloud-environment-plugin-cloud-environment-openai/work/codex2-independent-01-tooling
```

The application worktree is detached at the immutable baseline. The report worktree is on the report branch. The application source, dependency declarations and lockfile were not edited. Generated web assets and installed packages are ignored artifacts in the disposable application checkout. Task-only databases, credentials, logs, browser assets, smoke driver and screenshot are under Tooling, outside both source checkouts; none belong in Git. The fictional database is `Tooling/practice-runtime/practice/moonproject.db`, with its own backup directory. No existing shop database was used.

No substantive audits ran simultaneously. This A0 checks reproducibility and readiness only; it contains no defect opinions.

## Owner-supplied business assumptions to verify

The owner supplied the following brief. These are assumptions for later verification, not independently established evidence:

- Virtus Garments, Inc. makes garments and uniforms to order in the Philippines.
- The business is VAT-registered and uses VAT-inclusive prices.
- Sales invoices are manual booklet invoices; collection records/receipts are recorded in the app.
- Users include owners, one accountant, three encoders and production staff.
- One Windows shop PC serves browsers over the LAN, with remote access for people outside.
- The app replaces a Google Sheets app.
- Goals are accurate accounting, traceable changes, protected access, local operation during internet outages, and screens non-accountants can use.

Configuration choices do not establish legal compliance. No business assumption required clarification to perform the unaffected local setup.

## Operating rules and sources used

Read `AGENTS.md` from the verified source and fetched main. The owner explicitly authorizes this baseline document despite builder-only documentation ownership. The owner's independent-pass instructions defer `docs/PLAN.md`, `docs/STATUS.md`, `docs/review/`, `docs/research/` and all earlier findings, including read-first links in AGENTS. Those deferred materials were not read for this task.

Setup evidence came from baseline package files and lockfile, `.github/workflows/ci.yml`, `.github/workflows/windows.yml`, `README.md`, `e2e/README.md`, `e2e/serve-practice.ts`, the Playwright and Vitest configurations, and narrowly relevant startup/test setup. No earlier worktrees, databases, screenshots, logs or reports were used as audit inputs.

The owner requests one representative server smoke and defers the full suite to A9; that task-specific scope governs this documentation PR over AGENTS' general full-test pre-PR rule. No full-suite pass is claimed.

## Supported and actual runtime

- Declared project support: **Node >=22** in the root package and AGENTS.
- Both CI and Windows installer workflow select **Node 24**.
- Actual Node: **24.19.0**, x64, bundled local runtime.
- Actual npm: **11.6.2**, downloaded from the official npm registry into Tooling because the bundled Node runtime exposed no npm command on PATH.
- Bundled Python used for the native-build retry: **3.12.14**.
- Locked toolchain: TypeScript **5.9.3**, Vitest **5.0.2**, tsx **4.23.15**, Vite **8.3.1**, Playwright **1.63.0**.
- Installed/tested browser: Playwright Chromium **153.0.8010.12** (build **1243**), plus its required downloaded assets.
- SQLite package: locked `better-sqlite3@13.0.3`; its shipped `win32-x64` prebuild loaded successfully and reported SQLite **3.53.4**.

Only the actual Node 24 Windows setup was exercised here; the declared minimum Node version was not separately tested.

## Reproducible Windows setup and start commands

From the Application checkout, with the task's local npm tool already unpacked in Tooling:

```powershell
$auditTools = '%USERPROFILE%\Documents\Codex\2026-10-05\cloud-environment-plugin-cloud-environment-openai\work\codex2-independent-01-tooling'
$env:PATH = "$auditTools\package\bin;" + $env:PATH
$env:npm_config_cache = "$auditTools\npm-cache"
$env:TEMP = "$auditTools\temp"
$env:TMP = $env:TEMP
$env:PLAYWRIGHT_BROWSERS_PATH = "$auditTools\browsers"

node "$auditTools\package\bin\npm-cli.js" ci --ignore-scripts
node "$auditTools\package\bin\npm-cli.js" run typecheck
node "$auditTools\package\bin\npm-cli.js" test -- apps/server/test/web.test.ts --hookTimeout=60000
node "$auditTools\package\bin\npm-cli.js" run build -w @moonproject/web
node node_modules\@playwright\test\cli.js install chromium
```

Create the task-owned temporary directories before first use. npm was bootstrapped locally by downloading `https://registry.npmjs.org/npm/-/npm-11.6.2.tgz` with Node fetch and extracting it with Windows `tar`; no global installation was made.

The ordinary `npm ci` command was attempted first and failed; the `--ignore-scripts` installation is an explicit environment workaround, not a claim that ordinary installation passes. The unchanged locked SQLite package supplies a usable native prebuild. Its in-memory database check, the server test and the live browser interaction verify the exercised runtime path despite the skipped lifecycle scripts. This does not establish that every unexercised dependency path works.

Practice-fixture startup, using the repository's existing fictional-data E2E server:

```powershell
$env:E2E_DIR = "$auditTools\practice-runtime"
$env:PORT = '43198'
node e2e\serve-practice.ts
```

Use an empty, task-owned E2E_DIR on first start. `serve-practice.ts` recreates its `practice` subdirectory, seeds 30 days of fictional data, writes local-only practice passwords, and starts the existing server. Inspect same-task recovery artifacts before restarting; never point it at an existing shop directory. Node 24's native TypeScript support is the plain-Node startup route exercised by the project's Windows service test.

Actual development-script route `tsx e2e/serve-practice.ts` failed before application startup in this shell. The successful plain-Node route does not require changing application code or the package script.

Browser reproduction: navigate to `http://127.0.0.1:43198/`, enter `practice-owner` and the owner password generated in `E2E_DIR/practice-passwords.json`, then press **Sign in**. This task's recovery smoke driver is `Tooling/browser-smoke.mjs`; running it with the browser and temporary-directory environment above exercised that UI interaction. Passwords and screenshots are deliberately excluded from this public report.

## Smoke outcomes and material errors

| Check / actual command | Exit or observation | Outcome |
| --- | --- | --- |
| Fetch `origin main` with Git HTTPS helper path and `-c http.sslBackend=openssl` | 0, twice | Current main recorded; registered checkout preserved. |
| Ordinary `npm ci` | 1 | Native package triggered `node-gyp rebuild`; Python was not discoverable. npm also logged EPERM cleanup warnings. |
| `npm ci` with explicit bundled Python | 1 | Python found; node-gyp cache creation under AppData returned EPERM. |
| `npm ci` with Python and task-local node-gyp cache | 1 | Node headers downloaded; no suitable Visual Studio C++ installation was discoverable. |
| `npm ci --ignore-scripts` | 0 | Locked dependencies unpacked; compilation/lifecycle scripts skipped explicitly. |
| SQLite in-memory prebuild check | 0 | Database opened and returned SQLite 3.53.4. |
| `npm run typecheck` through local npm CLI | 0 | Typecheck passed at the application baseline. |
| `npm test -- apps/server/test/web.test.ts` | 1 | Setup hook exceeded the default 10,000 ms; four tests skipped. |
| Same representative test with `--hookTimeout=60000` and task-local TEMP/TMP | 0 | One server test file, four tests passed. No assertions or tracked test files changed. |
| `npm run build -w @moonproject/web` | 0 | Web app built; Vite reported its large-chunk warning. |
| Playwright `install chromium` | 0 | Windows browser assets installed under Tooling. |
| `node node_modules/tsx/dist/cli.mjs e2e/serve-practice.ts` | 1 | `os.userInfo()` failed with `uv_os_get_passwd` / ENOMEM before application startup. |
| `node e2e/serve-practice.ts` | Long-running server, not a completed command | Application logged listening on 127.0.0.1:43198; HTTP health returned 200 with `ok: true`. |
| Local Playwright browser smoke driver | 0 | Chromium reached the app with HTTP 200, filled the sign-in form, clicked Sign in, and displayed the authenticated Practice Owner home screen. No page errors observed in this smoke. |
| Codex in-app browser tool | Sign-in screen visibly returned | Independently reached the same local app; Username, Password and Sign in controls were accessible. |

The browser used actual app UI and a real local browser process; this was an executed smoke check, not a source-only review. Test and browser output, including failures, are retained only as this task's recovery artifacts outside the repository. No full test suite, full E2E suite, area audit or compliance assessment was performed.

## Readiness and environment limitations

**READY FOR LIVE UI AUDIT — local Windows fictional-data setup, using the documented workarounds.**

Installation with scripts disabled, typecheck, the representative server smoke, web build, application health, browser-tool reachability and one real authenticated UI interaction completed. The ordinary install and tsx startup routes remain limited in this sandbox:

1. For ordinary `npm ci`, use a normally provisioned Windows development machine with a discoverable Python and Visual Studio 2022-or-newer C++ build toolchain/Windows SDK, and a writable node-gyp cache. No system toolchain was installed here. The tested local alternative is the unchanged package's shipped native prebuild with `npm ci --ignore-scripts`; skipped lifecycle scripts remain a limitation.
2. For this shell's tsx account-information failure, the tested remedy is the existing plain Node 24 startup route. A normally functioning Windows account lookup is needed to reverify tsx itself; no dependency was patched to bypass it.
3. This host needed a task-local npm download and process-local Git HTTPS configuration. No global Git/npm settings or system software were changed. Native PowerShell HTTPS download failed with an authentication error; Node fetch succeeded.
4. The first server smoke needed a longer setup-hook timeout. Its failure and the exact passing retry are both recorded.
5. The practice fixture is loopback HTTP with isolated fictional data. Shop LAN HTTPS, remote access, service installation, offline operation and legal compliance have not been established by A0.
6. The browser reachability check is valid for this local host and setup. A later chat must reverify its own tool connection and start only its own task-owned runtime; it must not assume this process remains running.
7. A9 must run the full suite and assess default-command results. This smoke does not justify saying all tests pass.

Only this baseline document is proposed as a tracked change. The publication diff must add `docs/audit/codex2-independent-01/00-baseline.md` and nothing else. Publishing it does not merge the report or advance the immutable application SHA.

## Coverage checklist (not yet audited)

- [ ] A1
- [ ] A2
- [ ] A3
- [ ] A4
- [ ] A5
- [ ] A6
- [ ] A7
- [ ] A8
- [ ] A9 — full suite
- [ ] A10
- [ ] A11
