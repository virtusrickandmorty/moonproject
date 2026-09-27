# Moonproject: house rules for every builder (Claude #1, Claude #2, Codex, Jules)

**Moonproject** is the accounting-first ERP for Virtus Garments, Inc., a made-to-order garment shop in the Philippines.
It runs on one shop PC (Windows) and is used from browsers on the shop LAN.

**Work only from this GitHub repository** (github.com/virtusrickandmorty/moonproject), in a fresh clone.
Older Virtus apps (the Apps Script app, "VERSION 2" and any other "virtus erp" folders on a PC) are NOT this project:
never read, copy or build on them. Everything you need is in this repo, mainly `docs/PLAN.md`.

## Read first
1. This file.
2. `docs/PLAN.md` Parts **B** (scope and rules), **C** (architecture), **D** (accounting), and the section of **E** for your module.
   Screens and prints: Part **H**. Tests: Part **I**. Do not read the whole plan unless you need to.
3. The reference module: `apps/server/src/modules/CASH/` (Fund Transfer). Copy its shape.

## Lanes: only change files in your own lane
| Builder | Owns |
|---|---|
| **Claude #1** (Core & Ledger) | `packages/shared/`, `apps/server/src/{app.ts,main.ts,platform/,engine/,modules/load.ts}`, modules **ACC, TAX, CASH, EQ, LOAN, FA, AP, EXP, AUD, BAK** (opening balances live in ACC), `ops/`, `.github/`, `tests/`, `tools/` (except the seed tool), `docs/` (except `docs/owner-guide/`), this file |
| **Claude #2** (Sales, Production & Payroll) | `apps/web/` shell, login, first-run wizard, generic list/form/view screens; modules **JO, COL, QS, PRD, RATE, EMP, PAY, CA, STAT** (server and web) |
| **Codex** (Customers, Reports & Screens) | modules **CUS, CAT, QUO, DASH, CAL, NAV, COM, PRN**; report screens in `apps/web/src/modules/RPT/`; TV board |
| **Jules** (Purchasing, Import & Guides) | modules **PUR, INV, SZR, MIG** (the importer); `tools/seed.ts`; `docs/owner-guide/` |

A module lives in `apps/server/src/modules/<CODE>/` and, for custom screens, `apps/web/src/modules/<CODE>/`.
If you need a change outside your lane (a shared contract, an engine feature, a permission in another module),
**say so in your PR description** instead of editing it. Claude #1 makes engine changes.

**Money rule:** code that creates journal entries (a doc type's `compute` and `journal`) is written only by Claude #1 or Claude #2.
Codex and Jules build screens, reports, prints and imports around them, never posting rules.

## Non-negotiable rules (PLAN B1)
- **Every movement of money posts a balanced journal** in the same transaction as the document. Use the document engine; never write to `journals` or `journal_lines` yourself.
- **Balances are computed from the ledger**, never stored (`engine/ledger/queries.ts`).
- **Nothing is deleted, ever.** Every table gets a `BEFORE DELETE` abort trigger automatically. Master data is deactivated (`is_active = 0`).
- **Posted documents are never edited.** Edit = cancel (mirror reversal dated today) + reissue with a new number. The engine does this.
- **Money is integer centavos.** Columns end in `_cents`, API fields end in `Cents`. No floats. Use `@moonproject/shared` money helpers (`vatFromGross`, `applyRate`, `allocate`).
- **Dates are Manila business dates** (`YYYY-MM-DD`) from the server clock (`manilaDate`). Never cut a date out of `toISOString()`. The client never sends a date, number, total, status, user or VAT figure: input schemas are `z.object({...}).strict()`.
- **Posting names accounts by role key** (`{ role: 'AR_TRADE' }`) or by master data the user picked (`{ cashPlace: id }`, `{ accountId }` from a category). Never by a hard-coded account code or id.
- **Permissions are exact keys** (`cash.trf.post`) checked on every route. Every route declares `config: { permission }` or the server refuses to start. No role-name checks, no admin bypass.
- **Tables:** a module creates only tables prefixed with its code (`cash_transfers`), in its own `migrations/NNNN_name.sql`. Migrations are forward-only: never edit one that was merged; add a new one. STRICT tables. Business data in line tables, never JSON blobs. Document tables get a `BEFORE UPDATE` abort trigger.
- **Read other modules only through their `public.ts`.** Engine tables (`documents`, `accounts`, ...) may be read directly.
- **Prints and screens never say "Invoice", "Sales Invoice" or "Official Receipt".** Titles come from `DOC_TITLES` in `engine/documents/registry.ts`.
- **No business data in browser storage.** No real customer or employee data in the repo, tests or fixtures: use made-up examples.

## How to add a document type (the engine contract, PLAN C4)
Look at `apps/server/src/modules/CASH/doctypes/transfer.ts`. A doc type declares:
`key`, `module`, `title`, `numbering.series`, `permissions {view, create, post, cancel}`, `dating`, a strict `inputSchema`,
`compute` (pure; returns the doc with `totalCents`), `validate` (returns `Issue[]`), `persist` (INSERT into your tables),
`journal` (pure; omit for non-posting documents), `load`, `toInput`, `summary` (plain English), `arbitrary` (fast-check generator),
and optionally `dependents` and `relinkOnReissue`.
Register it in your module's `index.ts` with `defineModule({...})` (default export). Modules self-register; there is no central list.

You get these routes for free (all under a signed-in session; changes need the `X-CSRF-Token` header):
| Route | What it does |
|---|---|
| `GET /api/doc-types` | Doc types the user may view, with JSON schema of the input |
| `GET /api/docs/:type` | List (newest first; `?limit`, `?before`, `?status`) |
| `GET /api/docs/:type/:id` | Header, stored doc, form input; journals only with `acc.journal.view` |
| `POST /api/docs/:type/preview` `{input}` | Totals, issues, plain summary, journal preview (accountants/owners only) |
| `POST /api/docs/:type/post` `{input, expectedTotalCents}` | Records it. Needs `Idempotency-Key` header. 409 `TOTALS_CHANGED` if the total differs from what the user confirmed |
| `POST /api/docs/:type/:id/cancel` `{reason}` | Cancel (reason 10+ characters). Needs `Idempotency-Key` |
| `POST /api/docs/:type/:id/reissue` `{input, expectedTotalCents, reason}` | Edit = cancel + new number, one transaction. Needs `Idempotency-Key` |
| `GET/POST /api/drafts`, `PUT /api/drafts/:id` (`If-Match: <version>`), `POST /api/drafts/:id/discard` | Drafts (no number, no posting) |
Other engine routes: `/api/setup/status`, `/api/setup/first-owner`, `/api/auth/{login,logout,me,change-password,step-up}`,
`/api/users...`, `/api/roles...` (owner, step-up), `/api/cash/places`, `/api/health`.
Errors are `{ code, message, details? }` with a plain-English `message` you can show to staff.

## Tests (a red test blocks merge)
Every posting rule needs a **golden test** (exact journal lines to the centavo, from PLAN I2 where one exists), its cancel,
and a **property test** using `arbitrary`. Use `apps/server/test/helpers.ts` (`createTestEnv`, `env.as('encoder')`, `idem()`, `balances()`),
and end scenarios with `runInvariants(db)` returning no problems. See `modules/CASH/tests/transfer.test.ts`.

## Commands
```
npm ci
npm run typecheck
npm test
npm run dev:server      # http://127.0.0.1:3000, database in ./data (development only)
```
Node 22 or newer.

## Pull requests
- Branch per task; PR title starts with the module code, e.g. `[JO] Job orders: roster and stages`. Keep a PR under about 800 changed lines.
- `npm run typecheck && npm test` must pass before you open it.
- Say in the PR description what you built, what you did not build, and any contract you need from another lane.
- Reviewers write findings as `ID | severity (blocker/major/minor) | file | expected | actual`.
- Claude #1 reviews and merges every PR.
