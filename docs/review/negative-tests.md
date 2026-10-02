# Negative tests: PLAN I3 (N-01 to N-15)

Checked on 2026-09-29 against `main` at dc00ebe. One row per negative test of PLAN I3: what must happen when something goes
wrong, and the test that proves it. Paths are under `apps/server/` unless they start with `tests/`; test names are quoted
from the start of the `it(...)` title. **new** = there was no test on `main`; this check wrote it.

| # | Attempt | Proved by |
|---|---|---|
| N-01 | Two users record collections at the same instant | **new** `test/negative-tests.test.ts`: "gives two consecutive numbers, no gap and no duplicate" (an encoder and an accountant record at once: COL-000001 and COL-000002, series at 3, invariants clean) and "a refused request in the middle leaves no hole in the numbers". Also `test/engine.test.ts`: "keeps number series moving forward by one only (L7)" |
| N-02 | Double-click Record (same Idempotency-Key) | `src/modules/CASH/tests/transfer.test.ts`: "same Idempotency-Key records once (N-02)"; `src/modules/QS/tests/sale.test.ts`: "refuses client-sent totals, dates, VAT and numbers (N-03), checks permissions, and records once per key (N-02)"; `src/modules/JO/tests/release.test.ts`: "refuses client-sent totals, dates, VAT and numbers (N-03) and checks permissions (N-04)" (the same-key release); `src/modules/PRD/tests/production.test.ts`: "rejects client-sent totals, dates, rates sources and zero pieces (N-03); one entry per Idempotency-Key (N-02); permissions"; `src/modules/COL/tests/deposit-transfer.test.ts`: "rejects client-sent totals, splits, dates and numbers (N-03), and needs col.transfer" |
| N-03 | Client sends a date, number, total or VAT | `src/modules/CASH/tests/transfer.test.ts`: "rejects client-sent dates, numbers, totals and statuses (N-03)"; `src/modules/COL/tests/collection.test.ts`: "rejects client-sent totals, dates, numbers and statuses (N-03)"; `src/modules/COL/tests/deposit-transfer.test.ts` (as above); `src/modules/JO/tests/job-order.test.ts`: "rejects client-sent dates, numbers, totals and statuses (N-03)"; `src/modules/JO/tests/release.test.ts` and `src/modules/QS/tests/sale.test.ts` (as above); `src/modules/PRD/tests/production.test.ts` (as above); `tests/house-rules.test.ts`: "every document type is complete and has a property-test generator" (each doc type's input schema rejects an unknown key). **New**, for the routes that are not doc types: `test/negative-tests.test.ts`: "every z.object in server code is .strict(), except the path and query schemas listed here" |
| N-04 | Encoder posts a JV or backdates anything | `src/modules/ACC/tests/acc.test.ts`: "is for the accountant only (N-04)" (encoder and owner get 403 on a JV); `src/modules/CASH/tests/bank.test.ts`: "CASH-1: the accountant dates a charge seen in October on its statement day in September; others may not backdate"; `src/modules/CASH/tests/transfer.test.ts`, `src/modules/COL/tests/collection.test.ts`, `src/modules/JO/tests/job-order.test.ts`, `src/modules/JO/tests/release.test.ts`, `src/modules/QUO/tests/quotation.test.ts`: "needs the right permission (N-04)" and its variants. **New**, every route and every role: `test/role-matrix.test.ts` |
| N-05 | Encoder opens salary rates without `pay.view_rates` | `src/modules/EMP/tests/emp.test.ts`: "the first pay may start on the hire date; a change starts today or later; the rules per pay type; rates only with pay.view_rates" (the encoder sees no pay history); `test/public-code.test.ts`: "pay amounts stay out of the audit trail (C6, N-05)". The role matrix (`test/role-matrix.test.ts`, rules RATES and PAYROLL) checks that no encoder, production or TV role holds a payroll key, and its route sweep that every payroll route answers 403 to them |
| N-06 | Encoder switches CR mode to system-numbered | `src/modules/ACC/tests/acc.test.ts`: "needs the permission and a fresh password (N-06)" (encoder 403; accountant without step-up gets STEP_UP_REQUIRED) and "refuses earlier dates, bad values, no-change and edits" (the system mode needs the sign-off fields) |
| N-07 | 6 wrong passwords | `test/security.test.ts`: "locks out after 5 wrong passwords, and audits it (N-07)" (five fail; the next attempt, even with the right password, is 429 for 15 minutes; five `auth.login_failed` audit rows). The plan says "6"; the test's sixth attempt is the refused one |
| N-08 | Direct SQL UPDATE/DELETE on journal_lines or DELETE on any table | `test/engine.test.ts`: "blocks DELETE on every table (N-08, L5)" and "posts a balanced journal and blocks changes to it (L1, L5)" |
| N-09 | Server clock set back one day | `src/modules/CASH/tests/transfer.test.ts`: "blocks posting when the server clock goes backwards (N-09)". The guard (`clockGuard`) is in the engine and runs for every doc type's post, cancel and reissue; only the fund transfer has a test that moves the clock |
| N-10 | Same manual invoice number twice, or out of booklet range | `src/modules/QS/tests/sale.test.ts`: "shares the invoice booklet with job order releases: a number is used once across both"; `src/modules/JO/tests/release.test.ts` (the "already used" release); `src/modules/TAX/tests/booklets.test.ts`: "refuses invoice and CR numbers outside the registered booklets; the same check runs on job order releases" |
| N-11 | Piece assignment already paid appears in a new run | `src/modules/PAY/tests/pay.test.ts`: "weekly piece pay (F3 example B shape), paid once, corrections next run (N-11, D6)"; `src/modules/PRD/tests/production.test.ts`: "cancel before payroll; after payroll the row stays, is never paid again, and is corrected with negative pieces (D6, F3, N-11)" |
| N-12 | Print title contains "Invoice" or "Official Receipt" | `tests/house-rules.test.ts`: "no document is titled Invoice, Sales Invoice or Official Receipt (NR-14)"; `src/modules/PRT/tests/prt.test.ts`: "renders the complete owner-only test pack without writing any table" (every printed `<h1>` is one of the allowed titles); `renderPrint` throws for a title that is not in `DOC_TITLES` or the catalogue list |
| N-13 | Attachment URL opened without a session | `test/attachments.test.ts`: "opens a file only with a session (401) and the view permission (403), with its checked type and a sandbox" (built with K46; read on 3 Oct 2026) |
| N-14 | Collection clears AR with a "discount" | **new** `test/negative-tests.test.ts`: "has no field for one: every discount-like field is refused, and nothing is recorded"; "a smaller tender does not clear the receivable; the only allowance is the ₱1.00 rounding of D4.9"; "a later discount needs a credit memo, which only the accountant may record" |
| N-15 | Restore of a backup made by a newer version | `src/modules/BAK/tests/restore.test.ts`: "opens copies from this version or an older one, never a newer or changed one (N-15)" (the rule). **New**, end to end: `test/negative-tests.test.ts`: "is refused with a plain message, and nothing is left staged" (an encrypted copy carrying an unknown migration: 409 NEWER_VERSION with the message, staged file removed) |

## Role matrix

`test/role-matrix.test.ts` (new). PLAN C6 has no key-by-key table: it names the five roles and says Production is
"view/assign only" and TV a "read-only board". The test states the plan's sentences about who holds what (each rule
names its source: JV and backdating are the accountant's, salaries need `pay.view_rates`, encoders see no payroll, ...) and
checks the default grid against them. The differences it finds are listed inside the test (`KNOWN_DIFFERENCES`), so the
test passes today and fails when a new difference appears or a listed one is settled:

1. The TV role does not hold `prd.tv`, the permission of the TV board (plan C6 and E14: TV is the board). A TV user cannot open the board.
2. The TV role holds `nav.search` (plan E14: "TV (board only)").

Plan-silent, not counted as differences: the owner also holds `acc.settings.manage` (the plan says the accountant edits
settings, N-06) and `ca.writeoff` (D5 says "CA write-off (accountant)"). Claude #1 decides on all four.

Route sweep, from the running app: 330 route declarations. Every route without a session gets 401 except the five public
ones. All 305 routes that name a permission were called by each of the five roles with an empty body and a made-up id:
403 FORBIDDEN naming the permission exactly when the role lacks it, and never for a role that holds it. An empty body
changes nothing except `POST /api/system/health/check`, a read-only check.

The 20 routes marked `authenticated` and how they are tested:

- Through every document type and role (seven checks per type: view list, view one, preview, post, cancel, reissue, draft): `GET /api/doc-types`, `GET /api/docs/:type`, `GET /api/docs/:type/:id`, `POST .../preview`, `.../post`, `.../:id/cancel`, `.../:id/reissue`, `POST /api/drafts`, `PUT /api/drafts/:id`, `POST /api/drafts/:id/discard`, `GET /api/drafts`, `GET /api/prt/printable-types`, `POST /api/prt/print/:type/:id`. Drafts: create is checked for each type; `PUT` and discard are checked for ownership only (a draft belongs to its author), not for each type. The print route is tested for one document type (fund transfer, printed by each role), not for every printable type.
- Open to every signed-in user by design, tested to answer for all five roles: `GET /api/settings` (rates and modes, no personal data), `GET /api/system/tls`, `GET /api/system/practice`, `GET /api/auth/me`. `POST /api/auth/{logout,change-password,step-up}` act on the caller's own session and are not called in the sweep (logout would end it, step-up counts failures).

Not simple to test: the doc-type routes for a *posted* document of every type (only the fund transfer is recorded and read back per role), and the inner checks a handler makes after its route permission (for example masked fields). Those are tested in each module's own tests.

No role reached anything without its permission, and no body schema was missing `.strict()`: no fix was needed.
