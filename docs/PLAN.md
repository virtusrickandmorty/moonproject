# Moonproject: the complete build plan

**Version 1.0, 27 Sep 2026.** Prepared for Virtus Garments, Inc. by Claude, from the owner's requirements (2 rounds of Q&A), a deep read of both old apps (Apps Script and VERSION 2) and their data, and research on the 2026 Philippine rules (BIR/EOPT, VAT, withholding, SSS/PhilHealth/Pag-IBIG, labor) and on hosting.

This file is self-contained: a new chat or another AI can build or review from it alone. The research behind it is kept in `/mnt/project-files/plan/research/` and `/mnt/project-files/plan/design/`. Section M lists which file holds which detail, for when a builder needs more depth (for example the 61-row SSS table).

**How to read it**
- **Part A** is for the owner, in plain English: what we are building, how the week goes, and what we need from you.
- **Parts B to J** are the builders' specification.
- **Part K** lists every decision still open. Each one has a default, so the build never waits.

---

## Contents
- A. For the owner (plain English)
- B. Scope: the modules and what "done" means
- C. Architecture: how it is built, installed, secured and backed up
- D. The accounting engine: chart of accounts, posting rules, tax math
- E. Module specifications
- F. Payroll engine and 2026 statutory settings
- G. Reports
- H. Screens, words and printouts (UX rules)
- I. Testing: golden scenarios and invariants
- J. The build week, the team of 4 AIs, and the switch-over
- K. Decision register (owner, co-owners, accountant)
- L. Risks
- M. Where the details live (source index)
- N. Review log

---

# A. For the owner (plain English)

## A1. What we are building
One new system that replaces both old apps. Staff do what they already do: encode a quotation, a job order, a payment, an expense, a payroll. They never see "debit" or "credit". Behind the scenes, every document automatically makes the correct accounting entry, so the books, cash balances, receivables, taxes and reports are always right and always agree with each other.

It runs on **one PC in the shop**. Staff open it in Chrome or Edge on any shop PC or phone on the shop Wi-Fi, and it keeps working even when the internet is down. The owners and the accountant can open it from outside through a free VPN app. There are no monthly hosting fees.

## A2. How it will feel for staff
- **Money in:** pick the job order, type the amount, and tap where the money went (Cash, GCash, BDO, China Bank). You can split one payment, for example part cash and part GCash. If the customer withheld tax (2307), type the withheld amount and the balance still clears.
- **Job orders:** pull in a whole team or department with everyone's sizes, then add or remove people and type jersey names and numbers. Assign workers to each production step with how many pieces each finished. That feeds their per-piece pay automatically.
- **Expenses:** pick a category from a fixed list (no free typing, so no more "BDO" spelled two ways), pick where the money came from, and done.
- **Payroll:** per-piece pay is pulled from the production records, and daily pay from attendance. SSS, PhilHealth, Pag-IBIG and tax are computed automatically for employees who have the box ticked. Cash advances are deducted and always balance.
- **Invoices:** every sale still needs a number from your BIR invoice booklet (the law requires an invoice for every sale of a VAT seller, even small walk-ins). The system asks for it at release/claim and at each quick sale, and shows exactly what to write on the booklet.
- **Mistakes:** anyone can edit, but nothing is ever deleted. Editing a saved document cancels the old one, issues a new one with a new number, and asks for a reason. Every action is logged with who did it and when.
- **Dates:** documents take today's date automatically. Only the accountant can date an adjustment in the past.

## A3. Your "job order creates a receivable" wish, explained
You said encoding a job order should create a receivable. Staff **will** see it that way: every job order shows its **Balance due** from day one, and the Collectibles screen lists every peso customers owe.

Underneath, the accounting follows the tax rules. The sale is officially booked when the **BIR sales invoice** (your manual booklet) is written, which is normally when the customer claims the order. Downpayments before that are held as "customer deposits", money that is not yet yours until the order is delivered. This keeps your books, your VAT return and your BIR invoices in agreement. Otherwise VAT would be counted on orders that were later cancelled or changed. Your accountant confirms this (decision ACC-01).

The "virtual invoice" you mentioned becomes the **invoice record**: when the manual invoice is written, the encoder types its number, and the system shows exactly what to write on the booklet (VATable sales, VAT, total). The system itself never prints anything titled "Invoice" or "Official Receipt".

## A4. The week, honestly
- **Days 1 to 7:** all four AIs build it, each owning separate modules of the same GitHub repository: two Claudes do the accounting core, sales, production and payroll; ChatGPT (Codex) and Gemini (Jules) do customers, reports, printouts, purchasing, the importer and the guides. Only the Claudes write code that makes accounting entries, and each AI checks another AI's work.
- **Days 8 to 10:** testing with your real customers, employees and suppliers imported, on the actual shop PC with your printers.
- **Then a side-by-side run** (about 1 to 2 weeks) while the old apps are still used, and then **one switch-over date agreed by all three owners**. After that date the old apps become read-only.

Can it be *perfect* in a week? No honest builder can promise that. What we can promise: the accounting core is proven by automatic tests before anyone uses it, nothing can be deleted, everything is backed up automatically, and every module works end to end. Some "nice to have" parts (listed in B3 as *Should* and *Later*) may arrive during the side-by-side run.

## A5. What we need from you
**Before the build starts (about 10 minutes of your time):**
1. Create an empty private GitHub repository for the new app (name suggestion: `moonproject`) and add it to this project in **Project settings → Repositories**. Say "go" in the build thread.
2. Tell us the shop PC: Windows 10 or 11, and roughly how old it is.

**During the week:** answer the decisions in Part K when you can. Each one has a safe default, so nothing waits on you. The most important are:
- **For your accountant** (a short list to forward): when a sale is booked, the VAT on downpayments, whether our system may print its own Collection Receipt, the rent withholding tax, and the government contribution catch-up.
- **For you:** which remote-access app to use (a free one allowed for business, or Tailscale's paid plan for just the remote users), the per-piece rate table, each employee's daily rate, and which employees get SSS/PhilHealth/Pag-IBIG ticked.
- **For all three owners:** the switch-over date.

## A6. Things the research found that you should know now
These are stated calmly. None is an emergency today, but each needs the accountant's eye before or soon after go-live.
1. **Rent withholding tax (5%) was never withheld** on the ₱40,000/month rent. The 2026 exposure so far is about ₱10,700 to ₱12,000 plus penalties. The new system withholds automatically.
2. **SSS, PhilHealth, Pag-IBIG and withholding tax were never deducted** in either old app. The new system computes them. The accountant decides how to handle past months; PhilHealth has a one-time interest waiver open until **31 Dec 2026**.
3. **Some daily rates in the old payroll (₱300 to ₱500) are below the Silang, Cavite minimum wage of ₱550/day** (Wage Order IVA-22, since 5 Oct 2025). They may be half-day or trainee rates. Please check. The new payroll warns when pay falls below the minimum.
4. **Tailscale's free plan says "non-commercial use only".** A business ERP counts as commercial use. The plan defaults to a free alternative that allows business use (NetBird), or Tailscale's paid plan for remote users only (about US$8 per user per month). Inside the shop, nothing depends on it.
5. **A receipt printed by our own system may need BIR registration** (RMO 9-2021 treats receipt-printing systems as a "computerized accounting system" component). The safe default: keep using a BIR-approved (ATP) receipt booklet and type its number into the system. The system can switch to printing its own "COLLECTION RECEIPT" once your accountant confirms it is allowed.
6. **E-invoicing deadline, 31 Dec 2026** (RMC 98-2026): it applies to e-commerce sellers, large taxpayers and systems that issue invoices. Our design never issues invoices, so it stays out of that route. Your accountant should confirm that taking orders through Facebook or Messenger does not make Virtus an "e-commerce" seller.
7. **The old Apps Script app can be opened and changed by anyone who has its link**, and its code contains a hardcoded password. Turn off its web deployment once the switch-over is done, or now if nobody uses it.

---

# B. Scope: the modules and what "done" means

## B1. Guiding rules (the "never again" list turned into requirements)
| # | Rule | Fixes (old app failure) |
|---|---|---|
| NR-1 | Every movement of money or value posts a balanced journal in the same database transaction as the document. No exceptions (opening balances, owner money, transfers, cash counts, corrections all are documents) | ₱384,846 of cash moved without journals in VERSION 2, including ₱164,168 of owner capital |
| NR-2 | Balances (cash, AR, AP, deposits, advances, VAT, loans) are **derived from the ledger**, never stored | Wallet balances drifted; negative cash on hand in the GL |
| NR-3 | Nothing is hard-deleted, ever. DB triggers block DELETE on every table; posted journals and posted documents cannot be UPDATEd | Hard deletes; numbering gaps; edits re-created lines with no history |
| NR-4 | Edit of a posted document = cancel (mirror reversal dated today) + reissue (new number), linked, with reason and user | Silent in-place edits and cascades |
| NR-5 | Gapless numbering per series, allocated inside the posting transaction; never reused | max+1 IDs, collisions, reuse after delete |
| NR-6 | The server recomputes every total, VAT and withholding; client-sent totals, dates, numbers and statuses are rejected | Server trusted client totals, VAT %, dates |
| NR-7 | Document dates = server date in Asia/Manila; only documents of a type marked `accountant_may_backdate` (JV, payroll run, remittance, BIR payment, bank adjustment, depreciation run) may be backdated, and only by someone with `acc.backdate`, never to a future date | UTC date bugs, client-chosen dates |
| NR-8 | Accounts are fixed lists: cash places and expense categories are picked, never typed | "BDO" under two names; 19% in "Others" |
| NR-9 | Correct treatments: CWT is an asset, loan principal is a liability, equipment is capitalised and depreciated, inventory at cost, owner money is equity or a liability, profit is revenue − costs (never a plug) | Old apps got each of these wrong |
| NR-10 | Server-side authentication and exact permission keys on every route; no hardcoded passwords; no "admin" by name; strong password hashing; login rate limits; uploads served only after a permission check | Browser-only auth, hardcoded password, unsalted hashes, open uploads |
| NR-11 | No business data cached in the browser; no "migrate-local"/bulk transaction import endpoints | Cached journals re-injected |
| NR-12 | Data in proper line tables, never JSON blobs, for business records | items_json, row writes shifted into wrong columns |
| NR-13 | Automatic, encrypted, verified, off-machine backups with rotation | 93 unencrypted DB copies kept forever inside the app folder |
| NR-14 | No print is titled "Invoice", "Sales Invoice" or "Official Receipt" | Old prints used those titles on unregistered documents |
| NR-15 | Every posting rule has automated tests; a "month in the life" golden scenario with fixed expected trial balance | Posting code had no tests |

## B2. Module list (34 modules, 8 menu groups)
| Group | Code | Module | One line |
|---|---|---|---|
| Foundation | PLT | Platform & Setup | Install, start, update on the shop PC; company profile; series; effective-dated settings; practice database |
| | SEC | Users & Security | Login, sessions, rate limits, users, roles × exact permission keys, all server-side |
| | AUD | Audit & Integrity | Append-only hash-chained audit, per-record history, integrity checks |
| | BAK | Backup & Restore | Automatic encrypted backups, off-machine copies, restore wizard, drills |
| | MIG | Migration & Opening | Audited master-data importer, opening-balance wizard, opening job orders, cut-over checklist |
| Sales & Customers | CUS | Customers & Measurements | Customer → groups → wearers; versioned measurement charts; size presets; tax profile |
| | CAT | Catalog & Pricing | Garment types, services, ready-made items; price list with quantity tiers and effective dates |
| | QUO | Quotations | Inquiry as draft quotation; quotation with attachments; print; explicit conversion to JO |
| | JO | Job Orders & Release | One job order (commercial + production), wearer roster, deposit, balance due, manual invoice record, release/claim |
| | COL | Collections & Receivables | Collections (split tender, many JOs, CWT/2307, deposits), refunds, forfeits, credit memos, SOA, AR aging |
| | QS | Quick Sale | Walk-in sale of any service or item with immediate invoice record + collection |
| | COM | Customer Communications | Optional queued emails with outbox log and consent |
| Production | PRD | Production | Steps, routes, worker assignments with pieces, progress, board, TV board, job ticket, rework |
| | RATE | Piece-Rate Table | Garment type × operation × complexity rates, effective-dated, overrides with reason |
| | SZR | Sizer Tracker | Sample-size sets lent/returned, overdue alerts |
| Purchasing & Expenses | PUR | Suppliers & Purchasing | Supplier master (TIN, VAT status, EWT class), supplies catalog, purchase orders, receiving |
| | AP | Payables | Supplier bills, EWT, supplier payments, AP aging, 2307 issued |
| | EXP | Expenses | Cash expense vouchers with fixed categories, input VAT, EWT, petty cash |
| | INV | Inventory (periodic) | Count sheets at cost; month/year-end adjustment |
| Money | CASH | Cash & Banks | Cash places as GL accounts, transfers with fees, check deposits, other receipts, cash count, cash book, bank reconciliation |
| | EQ | Owners & Related Parties | Capital, deposits for subscription, stockholder advances, due to/from officers, dividends |
| | LOAN | Loans | Proceeds, schedule, repayments split principal/interest |
| | FA | Fixed Assets | Register, acquisition, monthly depreciation run, disposal |
| People & Payroll | EMP | Employees & Time | Employee master, pay profile history, attendance, holidays, leave |
| | PAY | Payroll | Runs per pay group; piece pay from production; statutory; CA deductions; 13th month; release; payslips |
| | CA | Cash Advances | Give, schedule, deduct, repay, write-off; subledger = GL |
| | STAT | Statutory & Year-end | Remittance reports and payments; 2316/alphalist data; arrears/exposure report |
| Accounting & Tax | ACC | Accounting Engine & Journals | Chart of accounts, posting rules, JVs (accountant), recognition and deposit-VAT settings, year-end |
| | TAX | Tax Compliance | VAT registers, 2550Q worksheet, SLSP export, CWT (2307 received) register, EWT register and 2307 issued, ATP booklet registry, tax calendar |
| Reports | RPT | Reports | Financial statements, books, sales, production, payroll, inventory, assets, exceptions |
| Workspace | DASH | Dashboard & Notifications | Role homes, widgets, computed notifications |
| | CAL | Calendar | Fittings, due dates, releases, holidays, tax deadlines, birthdays |
| | NAV | Search & Navigation | Permission-filtered menu, global search, list tools |
| | PRN | Printing & Export | One print engine with title allowlist and legend; PDF/CSV/XLSX export |

## B3. Priority tiers (what must be there at go-live)
Every module ships at go-live in at least a basic form. Inside modules, features are tiered:
- **Must (go-live blocker):** all of NR-1..15; PLT, SEC, AUD, BAK, MIG; CUS (groups, wearers, measurement revisions); QUO; JO (roster, deposit, balance due, release, invoice record); COL (split tender, CWT, deposits, refunds); QS; PRD (routes, assignments with pieces, board, Complete/Not needed/Reopen); RATE; PUR+AP (bills, payments, EWT); EXP; CASH (transfers, cash book, cash count); EQ (owner money classification); LOAN; FA (register + depreciation run); EMP; PAY (daily, piece, monthly; statutory; CA; release; payslip); CA; ACC (JV, COA); TAX (VAT registers, CWT register, EWT register, booklet registry); RPT (journal, GL, TB, IS, BS, cash books, AR/AP aging, SOA, sales, VAT/CWT/EWT summaries, payroll register, remittance lists, audit trail); DASH (role homes); PRN.
- **Should (target go-live, may land during the side-by-side run):** TV board; calendar; customer emails; bank reconciliation screen; cash flow statement; 13th-month run screen (the accrual itself is Must); SLSP export file; 2307 print for suppliers; purchase orders print; inventory count sheets print; statutory exposure report; global search; payslip email; SIL/leave balances.
- **Later (after go-live):** sizer tracker alerts; holiday premium automation beyond the basic rules; progress billing; RMC 65-2024 output-VAT relief worksheet; charts; management pack; e-mail statements in bulk.

## B4. Definition of done (per module, and for go-live)
A module is done when: its document types are registered with posting goldens and random-input property tests passing; its permission matrix test passes; its prints pass the title/legend check; its screens have plain-English summaries; `docs/STATUS.md` is updated; and its review pack has been checked by ChatGPT and Gemini with every accepted finding fixed.

Go-live requires: all Must items done; the month-in-the-life golden scenario and the blind recompute by both reviewers agree to the centavo; the import rehearsal passes its count and checksum gates; a restore drill succeeds on the shop PC; every print was test-printed on the shop's printers; the accountant has signed off the opening trial balance and the decisions marked "before go-live" in Part K.

---

# C. Architecture

## C1. The system on one page
```
 SHOP LAN (works with the internet unplugged)                     OUTSIDE (optional)
 Shop PCs / phones (Chrome, Edge)  --- https://<server-LAN-IP> ---+   Owners / accountant
 (each device trusts the "Moonproject Local CA" once)              |   VPN app (default NetBird;
                                                                   |   any VPN works) -> https://<VPN-IP>
 SERVER PC (Windows 10/11, SSD, UPS) ------------------------------+
   Windows service "Moonproject" (WinSW -> bundled node.exe, runs as a virtual service account)
     HTTPS :443  UI + /api + /print  (one origin; TLS from the app's own local CA)
     HTTP  :80   redirect + CA download + "Join this PC" helper only
     127.0.0.1:8081 health + ops endpoints (loopback only)
     SQLite  D:\Moonproject\data\moonproject.db (WAL, synchronous=FULL) + data\attachments\ (by SHA-256)
     in-app scheduler: snapshots, backups, integrity checks, clock check, email outbox (never posts)
   Scheduled tasks: watchdog every 5 min; disk health weekly; time resync daily
   Google Drive for desktop mirrors D:\Moonproject-Backups\offsite ; USB drives A/B rotated weekly
```

## C2. Stack (decided)
| Layer | Choice | Why |
|---|---|---|
| Language | **TypeScript** everywhere (server, web, tests, install tools) | One language; AI builders and reviewers read one codebase |
| Runtime | **Node.js 24 LTS**, `node.exe` bundled and pinned inside every release (move to Node 26 LTS after Oct 2026 when tested) | Nothing installed globally on the shop PC |
| Server | **Fastify 5** + **zod 4** schemas (shared with the web) + raw SQL with prepared statements | Small, typed, fast API tests with `inject()` |
| Database | **SQLite** via **better-sqlite3** (the only native module; prebuilt for Windows), behind a one-file driver adapter so it can move to `node:sqlite` later. STRICT tables. PRAGMAs: `journal_mode=WAL`, `synchronous=FULL`, `foreign_keys=ON`, `busy_timeout=5000`; one writer connection; `BEGIN IMMEDIATE` for posting | 1–5 users; one file = one backup; no second service to maintain. PostgreSQL rejected (extra service, upgrades, dump backups) |
| Web UI | **React 19 + Vite + Tailwind 4** single-page app served from the same origin; no business data in browser storage (only UI preferences) | Familiar for builders; avoids the "cached journals" failure |
| Tests | **Vitest** (unit, golden, API via `inject()`), **fast-check** (property tests), **Playwright** (a few end-to-end flows), Windows smoke install in CI | Accounting correctness is proven, not asserted |
| Packaging | **GitHub Actions**: Linux job runs all tests; Windows job builds the release and smoke-installs it. **Inno Setup `Setup.exe`** installs/updates/repairs; install/update logic in TypeScript (`ops.js`) run by the bundled node | Builders work in Linux containers; a real Windows runner proves each release |
| Service | **WinSW v2.12** wraps node.exe as a Windows service (auto-start, crash restart), virtual account `NT SERVICE\Moonproject`, watchdog scheduled task restarts a hung service | Runs without anyone logged in; NSSM is unmaintained |
| Dependencies | Exact version pins; at most about 20 direct runtime dependencies; `npm ci` only | Fewer things break over the years |

## C3. Repository layout
One private repo `moonproject` on the company's GitHub (owner is admin with 2FA). npm-workspaces monorepo:
```
moonproject/
  packages/shared/src/  money.ts dates.ts ids.ts errors.ts permissions.ts
                        doctypes/<module>/<doc>.schema.ts   calc/<module>/*.ts   (pure, used by server AND web)
  apps/server/src/
    main.ts app.ts
    platform/   db/(driver, pragmas, migrate, triggers, fingerprint) clock.ts tls/ scheduler.ts health.ts backup/ logging.ts
    engine/     documents/(registry, lifecycle, routes, drafts) ledger/(post, reverse, invariants, accounts)
                numbering.ts audit.ts idempotency.ts permissions.ts print/ settings.ts attachments.ts outbox.ts
    modules/<CODE>/  index.ts (defineModule) doctypes/ posting/<doc>.posting.ts sql/ print/ migrations/ tests/
  apps/web/src/  shell/ components/ generic/(DocList, DocForm, DocView) modules/<CODE>/ (custom pages only)
  ops/  src/(setup, update, rollback, uninstall, watchdog, usb, restore, fix-clock, join)  installer/Moonproject.iss  winsw/
  tests/golden/  tests/e2e/  tests/fixtures/
  tools/ seed.ts review-pack.ts gen-permissions.ts check-titles.ts compare-blind.ts
  docs/ adr/ owner-guide/ runbooks/ STATUS.md decisions.md
```
Rules: modules **self-register** (a build-time glob of `modules/*/index.ts`; no central list to edit). A module writes only its own tables (table names prefixed with the module code, e.g. `col_receipt_lines`); it reads others only through their `public.ts`. Engine tables have no prefix. A lint rule and a SQL-parsing test enforce this.

## C4. The document engine (the heart of the build)
Every business document (quotation, job order, collection, expense, bill, transfer, payroll run, depreciation run, JV, ...) uses **one lifecycle**, implemented once. A module only declares its document types:
```ts
interface DocTypeDef<Input, Doc> {
  key; module; title /* from the print-title allowlist */;
  numbering: { series; external?: { booklet: 'SALES_INVOICE'|'CR'; required(settings): boolean } };
  permissions: { view; create; post; cancel; print? };
  dating: 'system' | 'accountant_may_backdate';
  inputSchema /* zod .strict(): NO date, number, totals, status, user, vat fields */;
  compute(input, ctx): Doc;                 // PURE: totals, VAT, withholding, allocations, integer centavos
  validate(doc, ctx): Issue[];              // business rules (read-only DB access)
  persist(tx, doc, header): void;           // INSERT-only into the module's own tables
  journal?(doc, ctx): JournalDraft | null;  // PURE; uses account ROLE KEYS, never ids
  stages?; dependents?(tx, id); relinkOnReissue?(tx, oldId, newId);
  print?; summary(doc): string;             // "This will record ₱5,000 received in GCash for JO-000123"
  arbitrary(): fc.Arbitrary<Input>;         // random valid inputs for property tests (required)
}
```
| Action | What the engine does, in one `BEGIN IMMEDIATE` transaction |
|---|---|
| Create/edit draft | Permission check; strict parse; store draft payload (drafts have no number); audit |
| Preview | compute + validate + journal with **no writes**; returns totals, issues, plain summary, journal preview (accountant view) |
| **Post** | permission → clock guard → compute → compare with client's `expectedTotalCents` (409 if different: "Totals changed, review again") → validate → allocate number (or register the external booklet number) → insert `documents` row → persist → `ledger.post` → outbox/notifications → audit → store idempotency response |
| **Cancel** | permission; dependents must be empty or cancelled in the same action; `ledger.reverse` = **mirror of stored lines** (never recomputed), dated today; document status Cancelled with reason (≥10 chars), user, time; audit |
| **Edit posted** (reissue) | One transaction: cancel original + post replacement; link `replaces`/`replaced_by`; relink children; if the new one fails validation, nothing changes |
| Stage change | Only transitions declared in `stages`; audited |
| Print | Permission; server-rendered; reprint counter; audited |

Non-posting documents (quotation, PO, receiving, release slip, production assignment entries) use the same lifecycle without `journal`. Anything that happens later to a posted document is a **new child record**, never an update. Why this matters: a simple money document (expense, transfer, loan payment, depreciation run) becomes about 150 lines, and still gets list/form/view, posting, cancel/reissue, numbering, audit, permissions, idempotency, printing and tests for free.

## C5. Database rules
| Rule | Detail |
|---|---|
| Money | INTEGER centavos, column names end in `_cents`; no floating point anywhere in posting |
| Quantities, rates | Quantities INTEGER (pieces) or INTEGER milli-units for fabric; piece rates in centavos; percentages as basis points |
| Dates | `business_date` TEXT `YYYY-MM-DD` in Asia/Manila; timestamps TEXT ISO-8601 with offset `+08:00`. Never `toISOString().slice(0,10)` (lint-banned) |
| No delete | Trigger on every table: `BEFORE DELETE ... RAISE(ABORT)`. Master data is deactivated, not deleted |
| Immutable ledger | `journals` and `journal_lines`: no UPDATE, no DELETE (triggers). A journal is sealed on insert; a trigger checks Σdebit = Σcredit per journal at seal time and blocks lines on header accounts |
| Posted documents | Only lifecycle fields (status, cancel fields, replaced_by) may change after posting; enforced by trigger column lists |
| Numbering | `number_series(series_key, prefix, next_value, pad)`; allocation `UPDATE ... RETURNING` inside the posting transaction; unique index on `(series_key, number)`. Continuous, no yearly reset (default, ACC-12) |
| Idempotency | Every POST carries an `Idempotency-Key`; unique `(key)` table stores the response; unique `(source_type, source_id, posting_kind)` on journals where kind ∈ original/reversal |
| Concurrency | `If-Match` version on drafts and master records |
| Audit | `audit_log` append-only, written in the same transaction; each row stores `prev_hash` and `row_hash = sha256(prev_hash || canonical_json(row))`; chain anchors copied into every backup's sidecar (off machine) |
| Settings | Effective-dated, insert-only rows (VAT rate, statutory tables, CR mode, deposit VAT mode, minimum wage, ...). A version used by a posted document can never change |
| Migrations | Forward-only, transactional, checksummed, expand/contract; a backup is taken before migrating |

## C6. Security
| Area | Decision |
|---|---|
| Passwords | scrypt (N=2^17, r=8, p=1) with per-user salt; passphrases of 15+ characters, e.g. three or four words (DEFAULT, OWN-14); no forced expiry; owner can reset a user's password (user must change it at next login) |
| Sessions | Server-side sessions; token stored hashed; cookie `__Host-` + HttpOnly + Secure + SameSite=Strict; idle timeout 60 min, absolute 12 h |
| CSRF | SameSite cookie + custom header `X-CSRF-Token` + Origin check |
| Rate limits | DB-backed: 5 failed logins per user per 15 min → 15 min lockout; 20 per IP per 15 min; step-up re-auth endpoint is rate-limited too (no password oracles) |
| Permissions | Roles × exact permission keys (`jo.post`, `pay.view_rates`, `acc.jv.post`, ...) checked in a route pre-handler on **every** route; **no super-admin bypass** and no role-name checks. Default roles: Encoder, Accountant, Owner, Production (view/assign only), TV (read-only board) |
| Step-up | Dangerous actions (restore, user/role admin, guarded settings such as CR mode, deposit VAT mode) need the user's own password again (< 5 min old) plus an audit entry and a notice to all owners. There are no second-person approvals (owner's "trust basis") |
| HTTPS | App-managed local CA (name-constrained) issues the server certificate for its LAN IP, VPN IP and hostname; each device trusts the CA once through the "Join this PC" page, and the CA fingerprint is shown on the server's own screen so it can be compared before trusting. There is no plain-HTTP mode for the app itself (DEFAULT, OWN-13) |
| Uploads | JPG/PNG/WebP/PDF only, content-sniffed, 10 MB each, stored by SHA-256 outside the web root, served only through a permission-checked route |
| Secrets | In the DB (so a backup restores everything); never logged; logs redact personal data |
| Windows | Server runs under a virtual account; data folder ACL limited to the service account and Administrators; staff use a standard Windows user; Defender on with the DB folder excluded from real-time scanning of open files only |
| Privacy | Data Privacy Act: personal data never in logs, review packs or test fixtures; exports are logged; salaries visible only with `pay.view_rates` |

## C7. Remote access (VPN-neutral)
The app does not depend on any VPN. The shop works over the LAN with or without internet.
- **Default: NetBird Cloud Free** (business use allowed; up to 5 users as of Sep 2026). **Free fallback:** Cloudflare Zero Trust Free. **Paid option:** Tailscale Standard (about US$8 per remote user per month). **Not allowed:** Tailscale Personal and ZeroTier Free, whose terms say non-commercial. Owner decides (OWN-01). Switching VPN takes about an hour and needs no app change.

## C8. Backups, updates, clock, health
| Topic | Decision |
|---|---|
| Backups | Made by the app with SQLite's online backup API: snapshot every 2 h during shop hours (keep 48 h), daily (keep 30), monthly (keep 24), yearly (keep forever). Each copy is verified (`integrity_check` + ledger self-test: TB balances, audit chain intact), gzip-compressed and **age-encrypted** to two recovery public keys (the server holds no private key). Copies go to a Google Drive for desktop folder (company Google account) and to two USB drives rotated weekly |
| Recovery keys | Generated in the browser at first setup; Key A with the owner, Key B sealed elsewhere; printed + USB; the setup asks for one to be typed back to prove it was saved |
| Restore | Guided wizard; enforced quarterly restore drill (the app asks, walks through, and records the result). Dead PC target: 2–3 hours (new PC → Setup.exe from USB → "Restore from backup" → recovery key) |
| Updates | Owner double-clicks the new Setup.exe. It freezes writes, takes a verified pre-update backup, installs the new version side by side, migrates on start, checks `/health`, and rolls back automatically if the check fails and nothing has been written yet |
| Clock | Setup configures Windows Time sync and the time zone ("Singapore Standard Time" = UTC+8 = Asia/Manila). The app computes business dates in Asia/Manila and **blocks posting** if the clock jumps backwards or drifts badly, with a plain-English fix screen. The server date shows on every screen |
| Power & disk | UPS strongly recommended (auto-shutdown software); weekly SMART disk-health check card; `synchronous=FULL` |
| Health | "System Health" page with traffic lights (backups fresh? off-site copy age? disk? clock? audit chain? TB balanced? pending updates? Windows 10 end-of-support date) and a "Run system check" button; plain-English error screens with codes; one-click support file (no personal data) |
| Practice mode | A separate practice database with demo data for training; clearly marked on every screen; an owner can reset it |

## C9. Printing and email
- Server-rendered print views: A4 (most), A4 2-up (release slip, collection receipt, payslip, CA slip, payment voucher), optional 80 mm or 58 mm thermal for collection receipts. PDF through the browser's print dialog. QR codes as SVG (job ticket, release slip). No headless browser.
- Titles come from an allowlist enum; a CI check scans templates, email subjects and PDF file names for "Invoice" and "Official Receipt". The legend **"THIS DOCUMENT IS NOT VALID FOR CLAIM OF INPUT TAX."** is printed bold under the title on every customer- and supplier-facing print (list in H4).
- Email (optional): SMTP outbox (e.g. a company Gmail with an App Password), queued and retried; never blocks work; respects each customer's email consent flag; recipient always from the customer record.

---

# D. The accounting engine

## D1. Principles (binding)
1. **One ledger.** Journals are the only store of money movements. Cash, AR, AP, deposits, CWT, EWT, VAT, advances, officers and loans are all computed from journal lines filtered by account and party. No stored balance columns (a cache, if any, is rebuildable and checked nightly).
2. **One document → one journal**, posted in the same transaction as the number, the document rows and the audit row. All tenders, withholdings and applications of one document sit in that one journal.
3. **Posting uses role keys** (`AR_TRADE`, `OUTPUT_VAT`, ...), never account ids, so the accountant can rename or renumber accounts without code changes. Encoders never pick accounts: documents pick them; encoders pick a cash place or an expense category (each mapped to exactly one account).
4. **Subledgers:** accounts marked with a party type require a party on every line (customer, supplier, employee, officer/stockholder, loan, asset, cash place). The control account always equals the sum of its subledger (integrity check).
5. **Immutability:** posted journals are never changed. A cancel is a new mirror journal with `reverses_journal_id`, dated the cancel date (DEFAULT, ACC-09). Reports sum all posted journals; "Cancelled" is a status of the document, not of the journal.
6. **No hidden posting:** nothing posts on start-up or from timers. Depreciation, accruals, the VAT close and the 13th-month payout are user-run documents with a period key (unique per period).
7. **Framework:** PFRS for Small Entities (DEFAULT, ACC-17), calendar fiscal year, virtual year-end close (current-year earnings computed; no closing entry).

## D2. Chart of accounts (seed; accountant may rename/add; codes 4 digits; x000/xx00 are headers)
**Assets**
| Code | Account | Role key | Party |
|---|---|---|---|
| 1101 | Cash on hand (main cash box) | cash place | cash place |
| 1102 | Petty cash fund | cash place | cash place |
| 1103 | Checks on hand (undeposited customer checks) | cash place | cash place |
| 1111 | Cash in bank – BDO | cash place | cash place |
| 1112 | Cash in bank – China Bank | cash place | cash place |
| 1121 | E-wallet – GCash | cash place | cash place |
| 1190 | Cash in transit (R) | TRANSFER_CLEARING | cash place |
| 1201 | Accounts receivable – trade | AR_TRADE | customer (+ invoice record) |
| 1209 | Allowance for credit losses (R) | AR_ALLOWANCE | customer |
| 1210 | Advances to employees (cash advances) | EMP_ADVANCES | employee |
| 1220 | Due from officers and stockholders | DUE_FROM_OFFICERS | officer |
| 1230 | Advances to suppliers | SUPPLIER_ADVANCES | supplier |
| 1290 | Other receivables | — | free |
| 1301 | Materials and supplies inventory (periodic) | INV_MATERIALS | — |
| 1302 | Merchandise inventory – ready-made | INV_MERCH | — |
| 1401 | Input VAT – current quarter | INPUT_VAT | supplier |
| 1402 | Input VAT – carried over | INPUT_VAT_CARRYOVER | — |
| 1404 | Creditable VAT withheld by government buyers (R) | VAT_WITHHELD | customer |
| 1410 | Creditable withholding tax (customers' 2307) | CWT | customer (2307 status) |
| 1411 | Prepaid income tax (quarterly payments) | PREPAID_INCOME_TAX | — |
| 1420 | Prepaid expenses | — | free |
| 1510/1511 | Machinery & production equipment / accum. depreciation | FA class | asset |
| 1520/1521 | Office & computer equipment / accum. depreciation | FA class | asset |
| 1530/1531 | Furniture & fixtures / accum. depreciation | FA class | asset |
| 1540/1541 | Transportation equipment / accum. depreciation | FA class | asset |
| 1550/1551 | Leasehold improvements / accum. amortization | FA class | asset |
| 1801 | Refundable deposits (rent, utilities) | — | free |

**Liabilities**
| Code | Account | Role key | Party |
|---|---|---|---|
| 2101 | Accounts payable | AP | supplier (+ bill) |
| 2102 | Accrued expenses | ACCRUED_EXP | free |
| 2110 | Salaries and wages payable (net pay) | PAYROLL_PAYABLE | employee (+ run) |
| 2111 | 13th-month pay payable | THIRTEENTH_PAYABLE | employee |
| 2201 | Customer deposits and unapplied payments | CUSTOMER_DEPOSITS | customer (+ job order) |
| 2209 | Output VAT recognised on deposits (contra; used only in deposit-VAT mode B) | DEPOSIT_VAT | customer |
| 2301 | Output VAT – current quarter | OUTPUT_VAT | customer |
| 2302 | VAT payable (after quarterly close) | VAT_PAYABLE | — |
| 2310 | Withholding tax on compensation payable | WTC_PAYABLE | employee |
| 2311 | Expanded withholding tax payable | EWT_PAYABLE | supplier (+ ATC) |
| 2320 | Income tax payable | INCOME_TAX_PAYABLE | — |
| 2401 | SSS contributions payable (EE + ER + EC) | SSS_PAYABLE | employee (+ month) |
| 2402 | PhilHealth contributions payable | PHIC_PAYABLE | employee (+ month) |
| 2403 | Pag-IBIG contributions payable | HDMF_PAYABLE | employee (+ month) |
| 2404 / 2405 | SSS / Pag-IBIG loan amortizations payable | SSS_LOAN_PAYABLE / HDMF_LOAN_PAYABLE | employee |
| 2501 | Due to officers and stockholders (advances from stockholders) | DUE_TO_OFFICERS | officer |
| 2502 | Deposit for future stock subscription – liability | DFFS_LIABILITY | stockholder |
| 2503 | Dividends payable (R) | DIVIDENDS_PAYABLE | stockholder |
| 2601 | Loans payable (principal) | LOANS_PAYABLE | loan |
| 2602 | Equipment financing payable | EQUIP_FINANCING | loan |

**Equity**: 3101 Capital stock (CAPITAL_STOCK) · 3102 Subscribed capital stock · 3103 Subscriptions receivable (contra) · 3104 Additional paid-in capital · 3105 Deposit for future stock subscription – equity (only when all four SEC FRB 6 conditions are met) · 3201 Retained earnings · 3210 Dividends declared (R) · 3290 Current-year earnings (virtual, not postable) · **3900 Opening balance equity** (cut-over clearing; must be zero after the equity breakdown).

**Revenue**: 4101 Sales – made-to-order garments (SALES_MTO) · 4102 Sales – ready-made items (SALES_RTW) · 4103 Service income – repairs and alterations (SALES_SERVICE) · 4190 Sales discounts (contra) · 4191 Sales returns and allowances (contra).

**Cost of sales (periodic)**: 5101 Purchases – materials and supplies · 5102 Purchases – ready-made merchandise · 5103 Freight-in · 5104 Purchase returns and discounts · 5109 Inventory change (count adjustment) · 5201 Direct labor – piece-rate (job-order tagged) · 5202 Direct labor – daily production staff · 5203 Direct labor – employer contributions · 5204 Direct labor – 13th month and benefits · 5301 Subcontracted production · 5302 Depreciation – production equipment.

**Operating expenses** (each is an **expense category** encoders pick; category → account is fixed): 6101 Salaries – office and sales · 6102 Employer contributions – office · 6103 13th month and benefits – office · 6104 Staff meals and welfare · 6110 Rent (default EWT: rent 5%) · 6120 Electricity · 6121 Water · 6130 Communication and internet · 6140 Transportation and travel · 6141 Fuel and oil · 6150 Delivery and courier · 6160 Office supplies · 6170 Repairs and maintenance · 6180 Advertising and promotion · 6190 Professional fees (default EWT: professional) · 6195 Taxes and licenses · 6210 Depreciation – non-production · 6220 Insurance · 6230 Bank and e-wallet charges · 6240 Representation · 6250 Training · 6260 Software and subscriptions · 6270 Bad debts (accountant only) · 6280 Cash short and over · 6290 Penalties and surcharges (non-deductible) · 6990 Miscellaneous (warning when above 10% of monthly spend).

**Other income/expense and tax**: 7101 Interest income (gross) · 7102 Gain on disposal · 7103 Other income (scrap, forfeited deposits) · 7201 Interest expense and financing charges · 7202 Loss on disposal · 8101 Income tax – current · 8103 Final tax on interest income.

(R) = reserved: exists but hidden from encoders until the accountant enables it. Each cash place created in the Cash Accounts screen becomes its own GL account (1101–1189); no "wallet type" mapping; a cash place with a balance cannot be deactivated.

## D3. When a sale and a receivable exist (DEFAULT, confirm ACC-01)
**Decision: option B.** The job order itself posts **nothing**; it is a commitment. The sale, AR and output VAT are booked when the **manual BIR sales invoice is recorded**, which is required at release/claim.
- **Release gate:** releasing/claiming needs the manual invoice number and date. If the booklet is not at hand, the encoder ticks "invoice to follow"; the JO then sits on the daily exceptions list until recorded.
- **Partial release:** each release can carry its own invoice record for the released part; the JO tracks total, invoiced and remaining.
- **What staff see:** **Balance due** on every JO = JO total − (all collections applied to the JO, including CWT). Before invoicing it is a memo figure (non-GL); after invoicing it equals the open AR, so staff see one continuous number. Reports label it: "Collectibles = un-invoiced job-order balances (memo) + receivables (ledger)".
- **Downpayments** always sit in 2201 Customer deposits until an invoice applies them (automatically, oldest first, on the invoice record).
- **Quick sale** = invoice record + collection at once (a VAT-registered seller must invoice every sale regardless of amount).
- **Rejected options:** (A) AR at job order: revenue and VAT before any invoice or delivery, disagrees with the VAT return, reversals for every change. (C) AR at release with invoice later: VAT without an invoice number, registers drift from the booklet.

### Downpayment VAT modes (one effective-dated setting; accountant picks before go-live, ACC-02)
All three give the same total output VAT; only timing and paperwork differ. **DEFAULT: Mode A** until the accountant decides (EOPT counts "deposits and advanced payments" in gross sales of *services*, and made-to-order garments may be a contract for a piece of work (Civil Code Art. 1467), so the accountant must rule; 125 of 166 old orders took a 50% downpayment and ₱510,360 of downpayments crossed a VAT quarter).
| Mode | At downpayment | At the release invoice |
|---|---|---|
| **A – deposit only** | Dr Cash (+ Dr CWT if withheld) / Cr 2201 (gross) | Dr AR (full) / Cr Sales (net), Cr Output VAT; then Dr 2201 / Cr AR (deposit applied) |
| **B – VAT on deposit** (one invoice at release) | as A, plus Dr 2209 / Cr 2301 = VAT(deposit) | as A, plus Dr 2301 / Cr 2209 (same amount) |
| **C – invoice on downpayment** (two booklet invoices) | Invoice record #1 for the DP: Dr AR / Cr 2201 (net of DP), Cr 2301 (VAT of DP); the collection clears AR | Invoice record #2 for the balance: Dr AR (G − DP) / Cr Sales (NET − NET_dp), Cr 2301 (VAT − VAT_dp); plus Dr 2201 (NET_dp) / Cr Sales (NET_dp) |

## D4. Tax math (binding)
1. **VAT-inclusive:** `VAT = round_half_away_from_zero(G × r/(1+r))` at **document level per VAT class**, `NET = G − VAT`. Integer form for r = 12%: `VAT = sign(G) × ((|G|×12 + 56) div 112)` with G in centavos. Line VAT allocated by largest remainder so Σ lines = document. Examples: 56,000.00 → VAT 6,000.00 / net 50,000.00; 999.00 → 107.04 / 891.96; 350.00 → 37.50 / 312.50; 40,000.00 → 4,285.71 / 35,714.29.
2. **VAT rate** is an effective-dated setting (12% now; a 10% bill exists but is not law). Each line stores the rate used; the rate is looked up on the tax date (BIR invoice date for sales, supplier invoice date for purchases, accrual date for EWT).
3. **Discounts** shown on the invoice reduce G before VAT (post net sale, or gross + 4190 if the invoice shows the discount). A discount given later at collection is **not** allowed on a collection; it needs an accountant credit memo.
4. **Invoice worksheet:** when recording a manual invoice, the screen shows "write these on the booklet": VATable sales, VAT, total. Only the accountant may override VAT by ≤ ₱1.00 to match a booklet already written, with a reason.
5. **Withholding base** = NET(G) for VAT-registered payees, G for non-VAT; then `round_half_away_from_zero(base × rate)`. Never compute `G × rate / 1.12` in one step.
6. **Customer CWT** (2307 received) = the amount actually withheld (typed), with a warning if it differs from the expected 1% goods / 2% services by more than ₱1.00. Government buyers: +5% VAT withheld (1404), creditable. Platforms may withhold 0.5%.
7. **Supplier input VAT** = the VAT printed on the supplier invoice (warning if off by > ₱1.00 from 12/112); only when the supplier is VAT-registered and supplier invoice number, date and TIN are captured; otherwise the gross goes to the expense.
8. **EWT (Virtus as withholding agent)** is credited when the expense or bill is **recorded** (accrual), not at payment (RR 4-2024): rent 5%, contractors/printers 2%, professional fees individual 5% (10% if gross > ₱3M or no sworn declaration), firm 10%/15%; goods/services from regular suppliers 1%/2% **only if** Virtus is published as a Top Withholding Agent (setting, OWN/ACC-06). ATC stored per line.
9. **Collection rounding tolerance:** a cash difference up to ₱1.00 on a collection goes to 6280 Cash short and over.
10. **Reversals** mirror stored figures; they never recompute. Income tax returns use whole pesos (worksheet only).

## D5. Posting matrix (every event; amounts in centavos internally; examples in pesos)
Notation: "Cash X" = the GL account of the cash place chosen on the tender line (tenders can be split across several cash places; each tender = one debit/credit line).

### Sales and collections
| Code | Trigger (document → action) | Debit | Credit | Notes |
|---|---|---|---|---|
| JO-POST | Job order posted | — | — | No journal (commitment). Balance due is memo |
| DEP-RCV | Collection applied to an un-invoiced JO | Cash X (per tender); 1410 CWT (if withheld) | 2201 Customer deposits (party customer + JO) | Mode A and B |
| DEP-VAT | (Mode B only) same collection | 2209 | 2301 | VAT(G_dp) |
| INV-REC | Invoice record (manual invoice no./date) at release or partial release | 1201 AR (G) ; 4190 (discount, if shown) | 4101/4102/4103 (NET, split by line class); 2301 (VAT) | Stores booklet id + number; buyer TIN/name if ≥ ₱1,000 to a VAT-registered buyer |
| DEP-APPLY | Same invoice record, automatic | 2201 (deposits of this JO, oldest first, up to G) | 1201 AR (modes A/B); in mode C the NET_dp held in 2201 goes to Sales instead | Same journal as INV-REC; leftover deposit stays for the next partial release |
| DEP-VAT-REV | (Mode B) same invoice record | 2301 | 2209 | Amount recognised on the applied deposits |
| INV-DP | (Mode C) invoice record for a downpayment | 1201 | 2201 (NET_dp); 2301 (VAT_dp) | Then DEP-APPLY moves NET_dp to Sales at the release invoice |
| COL-RCV | Collection applied to invoiced AR | Cash X (per tender); 1410 CWT; 1404 VAT withheld (gov't); 6280 (short ≤ ₱1) | 1201 AR (per invoice applied); 6280 (over ≤ ₱1) | Rule: Σ tenders + CWT + VATW = Σ applied + unapplied |
| COL-OVER | Unapplied remainder of a collection | (in same journal) | 2201 (party customer, no JO) | Apply later or refund |
| DEP-XFER | Apply unapplied deposit to another JO/invoice | 2201 (old) | 2201 (new JO) or 1201 | Encoder action; audited |
| CWT-ONLY | 2307 received with no cash (customer withheld at its accrual) | 1410 | 1201 | Needs the 2307 attached |
| DEP-REFUND | Refund of a deposit/overpayment | 2201 | Cash X | CWT on a refunded deposit: ACC-14 decides (default: refund the cash part; keep CWT, flag for accountant) |
| DEP-FORFEIT | Customer abandons a JO; deposit kept (terms say non-refundable) | 2201 | 7103 Other income (+ 2301 if the accountant rules it VATable, ACC-15) | Needs owner/accountant permission `col.forfeit` |
| CM-ALLOW | Credit memo (return/allowance), accountant-confirmed form | 4191 (NET); 2301 (VAT) | 1201 (or 2201 if already paid) | Quarter of the CM carries the VAT reduction |
| QS-SALE | Quick sale: invoice record + collection in one action | as INV-REC then COL-RCV | | Two linked documents, one screen |
| BAD-DEBT | Accountant write-off | 6270 (or 1209 via allowance) | 1201 | Accountant only |

### Purchases and expenses (periodic inventory)
| Code | Trigger | Debit | Credit | Notes |
|---|---|---|---|---|
| EXP-PAY | Expense voucher paid now | Category account (NET or G); 1401 (VAT if valid VAT invoice) | Cash X (per tender); 2311 EWT (if ATC applies) | Petty cash expenses credit 1102 |
| BILL-POST | Supplier bill (goods, services, rent, utilities) | 5101/5102/5301/category (NET); 1401 | 2101 AP (G − EWT); 2311 EWT | EWT at accrual; duplicate check on (supplier, supplier invoice no.) |
| RENT-ACCR | Monthly rent accrual (a bill with category Rent) | 6110 (NET); 1401 | 2101 (G − EWT); 2311 | Rent paid late still gets its EWT in the right month |
| RCV | Receiving report | — | — | Quantities only (periodic) |
| SUP-ADV | Supplier advance | 1230 | Cash X | Applied on the bill: Dr 2101 / Cr 1230 |
| BILL-PAY | Supplier payment (split allowed) | 2101 (per bill); 6230 (fee) | Cash X | |
| EWT-REM | EWT remittance (0619-E / 1601-EQ) | 2311 (per period); 6290 (penalty) | Cash X | Produces the list of 2307s to issue to payees |

### Money, owners, loans, assets, inventory
| Code | Trigger | Debit | Credit | Notes |
|---|---|---|---|---|
| TRF | Fund transfer (amount sent, amount received) | Cash to (received); 6230 (fee = sent − received) | Cash from (sent) | Petty cash replenishment and check deposits (1103 → bank) are transfers |
| CASH-COUNT | Cash count vs ledger | 6280 (short) or Cash X | Cash X or 6280 (over) | Shows counted, ledger, difference |
| OTH-RCV | Other receipt (interest, refunds, insurance) | Cash X | 7101/1290/… by category | Not for sales (sales need an invoice) |
| BANK-ADJ | Bank charges / interest from reconciliation | 6230 ; for interest: Cash X (net) + 8103 (20% final tax) | Cash X ; 7101 (gross) | From the bank reconciliation screen |
| OWN-IN | Money from an owner; **classification required** | Cash X | (a) 3101 par + 3104 excess or 3103 if subscribed; (b) 3105 if all four FRB 6 conditions met, else 2502; (c) 2501 advance from stockholder | Never revenue; never unrecorded. Default (c) until the accountant classifies (ACC-10) |
| OFC-OUT | Company pays an officer's personal expense / officer takes cash | 1220 | Cash X | Never an expense |
| OFC-IN | Officer repays / company repays officer advance | Cash X / 2501 | 1220 / Cash X | |
| DIV | Dividend declaration (accountant; board resolution ref.) | 3210 | 2503 (+ final tax payable) | Later tier |
| LOAN-IN | Loan proceeds | Cash X (net received); 7201 (fees, or as accountant directs) | 2601/2602 (principal) | |
| LOAN-PAY | Loan instalment | 2601 (principal); 7201 (interest) | Cash X | Split from the schedule; encoder may override with a note. Principal never expensed |
| FA-BUY | Asset acquisition | 15x0 (cost net of VAT); 1401 (VAT) | Cash X / 2101 / 2602 | Capital-goods input VAT claimed in full |
| FA-DEP | Monthly depreciation run (user-run, unique per asset and month) | 5302 (production class) or 6210 | 15x1 | Straight-line (cost − residual) ÷ months |
| FA-DISP | Disposal / retirement | Cash X; 15x1 (accum.); 7202 (loss) | 15x0 (cost); 2301 (VAT on sale); 7102 (gain) | A sale of an asset needs an invoice record |
| INV-COUNT | Period-end count at cost | 1301/1302 (increase) or 5109 | 5109 or 1301/1302 (decrease) | Adjustment = counted value − GL balance; cost = latest purchase cost (DEFAULT, ACC-13) |

### Payroll and statutory
| Code | Trigger | Debit | Credit | Notes |
|---|---|---|---|---|
| PAY-RUN | Payroll run posted (accrual) | 5201 (piece, JO-tagged) / 5202 (daily production) / 6101 (office) = gross by cost centre; 5203/6102 employer shares; 5204/6103 13th-month accrual | 2401 SSS (EE+ER+EC); 2402 PhilHealth (EE+ER); 2403 Pag-IBIG (EE+ER); 2310 WTax; 2404/2405 loans; 1210 CA deducted; 2111 13th accrual; 2110 net pay | Gross = Σ earning lines (never a plug). Each payable line tagged scheme + month |
| PAY-REL | Payroll release (payout, split allowed) | 2110 | Cash X | Dated the day paid |
| CA-GIVE | Cash advance given | 1210 | Cash X | |
| CA-REPAY | Cash repayment by employee | Cash X | 1210 | |
| CA-WO | CA write-off (accountant) | 6990 or as directed | 1210 | |
| TH13-PAY | 13th-month payout run | 2111 (+ 5204/6103 true-up) | 2110 (then PAY-REL); 2310 if above ₱90,000 | No SSS/PhilHealth/Pag-IBIG |
| STAT-REM | Remittance (SSS, PhilHealth, Pag-IBIG, 1601-C) per month | 2401/2402/2403/2310 (month M); 6290 penalties | Cash X | Screen compares payable for month M vs amount paid |

### Tax closes, accountant, opening
| Code | Trigger | Debit | Credit | Notes |
|---|---|---|---|---|
| VAT-CLOSE | Quarterly VAT close (2550Q), accountant | 2301 (quarter output); 1402 (if input > output) | 1401 (quarter input); 2302 (payable) | Uses 1402/1404 carry-overs |
| VAT-PAY | VAT payment | 2302 | Cash X | |
| IT-QPAY / IT-PROV / IT-SETTLE | Income tax quarterly payment / year-end provision / settlement | 1411 / 8101 / 2320 | Cash X / 2320 / 1411, 1410 (only CWT backed by 2307s received), Cash X | Accountant |
| JV | Journal voucher (only place accounts are chosen freely) | any postable | any postable | Accountant only; may be backdated; filed-period warning |
| OB-* | Opening balances wizard (cut-over date) | per section | 3900 | See D8 |
| *-REV | Cancel of any posted document | mirror of the original lines | mirror | Dated the cancel date |

## D6. Cancel-and-reissue rules per document
| Document | Can cancel when | Effect on linked records |
|---|---|---|
| Quotation (finalised) | Not yet converted | None (no journal). Edits before conversion allowed in place with "Rev. n" |
| Job order | No invoice record and no release posted (else cancel those first) | Collections stay; their deposits remain in 2201 under the customer → encoder chooses **transfer to a new/reissued JO**, **refund**, or **forfeit** in the same dialog |
| Invoice record | Always (a new invoice record is needed to release again) | Mirror journal (incl. the deposit application). **Reissue:** collections applied to it are relinked to the replacement invoice. **Plain cancel:** collections applied to it become deposits of the JO again (same transaction: Dr 1201 / Cr 2201 per applied amount), shown in the dialog. The manual invoice number is marked "cancelled (all copies kept)" in the booklet register |
| Collection | Always | Mirror journal; applications removed; 2307 register entry marked cancelled; CR booklet number marked cancelled. If part of it was a deposit that an invoice record already applied, the cancel also posts Dr 1201 / Cr 2201 for that part, so the customer's balance due reopens instead of 2201 going negative |
| Expense / bill / supplier payment | Bill: no payment applied (else cancel payment first) | EWT lines reverse; 2307-to-issue list updates |
| Transfer, owner money, loan in/pay, cash count | Always | Mirror |
| Payroll run | Not yet released (else cancel the release first) | Piece assignments become payable again; CA deductions return to the CA balance (the CA ledger reads journals, so it self-corrects). If month M's statutory remittance was already posted, the cancel warns that the payable will go negative and lists it for the accountant |
| Depreciation run, inventory count, VAT close | Only the latest one for that asset/period | Mirror |
| Production assignment entry | Before the payroll run that paid it (after that: correction entry with negative pieces, next run) | — |

Reissue = cancel + new document in one transaction with a required reason (≥ 10 characters). A document in a period marked as filed (`filed_returns` register) shows a warning and the audit entry is tagged "changed after filing".

## D7. Numbering series (continuous, gapless, never reset; DEFAULT ACC-12)
| Series | Prefix | Allocated | Notes |
|---|---|---|---|
| Quotation | QUO- | at finalise | Drafts have no number |
| Job order | JO- | at post | |
| Release slip | REL- | at post | |
| Invoice record | (booklet number, typed) + internal IR- | at post | Validated against the **ATP booklet register** (ATP no., range from–to): in range, unique, used once; skipped-number report. JO releases and quick sales share the IR- series and the booklet |
| Collection (internal) | COL- | at post | Always |
| Refund | RFD- | at post | Money given back from a customer's deposit or overpayment (COL) |
| Deposit transfer | DXF- | at post | Moves a customer deposit from one job order to another (COL, G-28); no cash line |
| Collection receipt | CR booklet no. (typed, booklet mode) or CR- (system-numbered mode) | at post | Booklet mode is DEFAULT (ACC-03) |
| Credit memo | CM- | at post | Form confirmed by accountant (ACC-08) |
| Expense voucher | EXP- | at post | |
| Supplier bill / payment | BILL- / SPAY- | at post | |
| Purchase order / receiving | PO- / RR- | at post | |
| Transfer / cash count / other receipt | TRF- / CNT- / ORC- | at post | |
| Owner money / officer | OWN- / OFC- | at post | |
| Loan / loan payment | LOAN- / LPAY- | at post | |
| Fixed asset / depreciation run / disposal | FA- / DEPR- / FAD- | at post | |
| Inventory count | INVC- | at post | |
| Production entry | PE- | at post | Pieces done per step and worker (PRD); posts no journal, payroll pays it (F3) |
| Payroll run / release / CA / remittance | PAY- / POUT- / CA- / REM- | at post | |
| VAT close / JV / opening | VATC- / JV- / OB- | at post | |
| BIR payment | BIRP- | at post | Tax paid with one BIR return: 2550Q (VAT of a quarter), 0619-E or 1601-EQ (EWT); D5 VAT-PAY and EWT-REM |
| Journal entry | JE-YYYY- | at post | Journal numbers per year for the books |

## D8. Period-end, year-end and cut-over
- **Monthly (accountant checklist screen):** rent accrual (if not billed), depreciation run, bank reconciliation per bank, cash counts, inventory count (monthly or yearly, ACC-13), statutory remittances, EWT 0619-E, review of the exceptions list (released without invoice, cash negative, unposted drafts > 3 days, "Misc" above 10%).
- **Quarterly:** VAT close + 2550Q worksheet + SLSP data; 1601-EQ + QAP; 2307s to issue; 1702Q worksheet; CWT register reconciliation (2307s pending).
- **Yearly:** 13th month by Dec 24; year-end tax adjustment on compensation; 2316, 1604-C, 1604-E, alphalists; books printout (loose-leaf or transcription) and binding; virtual close.
- **Cut-over (opening balances wizard, all dated the cut-over date, all against 3900):**
  1. Cash per cash place (from counts and bank statements) — Dr cash / Cr 3900.
  2. **Open job orders as documents, not a lump sum** (from the importer's list of 69 candidate orders at the Sept snapshot): for each, owner/accountant ticks Delivered? / Invoiced (no., date)? / Still collectible?  
     – delivered/invoiced with balance → Opening invoice record: Dr 1201 / Cr 3900;  
     – not delivered with money collected → Opening JO + deposit: Dr 3900 / Cr 2201; remaining contract stays as the JO's balance due;  
     – live production orders are re-created as live JOs with their remaining steps.
  3. AP open bills (e.g. equipment payable ₱384,511.10 open), loans (e.g. investment loans ₱738,900 open, lenders and terms to confirm), CA balances per employee (after settling the old ₱3,900 mismatch), officers' balances, fixed-asset register (cost, accumulated depreciation, acquisition date, life), inventory at cost, input VAT carry-over, unused CWT with 2307s, statutory payables/arrears.
  4. Equity breakdown (capital stock, APIC, deposits for subscription, retained earnings) so that **3900 = 0**; the wizard will not close until 3900 = 0 and the TB balances. The accountant signs off the opening TB (recorded with name and date).
  5. Reconciliation gates: Σ opening AR subledger = AR control; Σ deposits = 2201; rows accepted + excluded = rows listed.

## D9. Engine invariants (each is an automated test and a nightly integrity check shown on System Health)
| # | Invariant |
|---|---|
| L1 | Every journal balances (Σ debit = Σ credit), and the trial balance balances |
| L2 | No line posts to a header account or an inactive account |
| L3 | Lines on subledger accounts carry a party; control = Σ subledger for 1201, 2101, 2201, 1410, 1210, 1220, 2501, 2601, 2602, 2110, 2311, 2401–2403 |
| L4 | Each posted money document has exactly one original journal; each cancelled one also exactly one reversal; original + reversal net to zero per account and party |
| L5 | Journals and posted documents cannot be updated or deleted (trigger test) |
| L6 | Output VAT GL = invoice-record register VAT; input VAT GL = purchase register VAT; CWT GL = collection register CWT; EWT GL = EWT register |
| L7 | Numbers are unique and gapless per series; booklet numbers in range and used once |
| L8 | 3900 = 0 after cut-over is closed |
| L9 | Business dates of operational documents = server Manila date at posting; only JV/OB dates differ |
| L10 | CA subledger per employee = the CA register; payroll gross = Σ earning lines; net = gross − deductions |
| L11 | Warning (not block): any cash place with a negative balance |
| L12 | Audit hash chain verifies end to end |

---

# E. Module specifications
Conventions for every module: screens follow H2 (list → form → view); every document type follows C4; postings use D5 codes only; permission keys are `<module>.<action>` (e.g. `jo.post`, `col.cancel`, `pay.view_rates`). Each module lists its key acceptance tests; the full scenario set is in Part I.

## E1. Customers & Measurements (CUS)
**Entities**
- `cus_customers`: id, code (CUS-00001), kind (person|organization), display_name, registered_name, TIN, VAT-registered flag, withholding profile (none | TWA goods 1% | TWA services 2% | government (5% VAT + CWT) | platform 0.5%), billing address, contact persons, phones (normalised +63), email, email_consent, credit_terms_days, parent_customer_id (for university departments), active, legacy_id, notes.
- `cus_groups`: id, customer_id, name (team/department/section), active.
- `cus_people` (wearers): id, customer_id, group_id (nullable), full_name, nickname, default_jersey_name, default_jersey_number, gender (optional), birthday (optional, for greetings only if collected), active.
- `cus_measure_charts`: id, person_id, revision_no, status (active|superseded), size_mode (preset|measured), upper_size, lower_size (XS, S, M, L, XL, 2XL, 3XL, 4XL, 5XL, kids sizes editable list), unit (inch default), fields: shoulder, chest, upper_waist, collar, bust_point, figure_point, bust_distance, arm_hole, sleeve_hole, sleeve_length, upper_length, lower_waist, hips, crotch, thigh, calf, ankle, lower_length, remarks; measured_by, measured_on, reason (required from revision 2), supersedes_id. **Never updated**: a change inserts a new revision and marks the old one superseded (one active chart per person, unique partial index).
**Rules**
1. Duplicate warning on save (same normalised phone, email, or name similarity); owner-only audited **merge** (moves groups, people, documents' party references via relink records; the old customer becomes inactive "merged into X").
2. A customer with documents cannot be deactivated if it has open balance or open JOs.
3. Organisation → groups → people; a person belongs to one customer, optionally one group; people can be moved between groups (audited).
4. Measurement values validated per field (range warnings, e.g. sleeve hole 75 → "did you mean 7.5?").
**Screens:** customer list (search, stat cards: with balance, with open JOs); customer view (tabs: overview with balance due, groups & people grid, measurements, documents timeline, statement); measurement entry form sized for a tablet (big numeric inputs, previous revision shown beside).
**Prints:** Sizing Profile (per person or per group), statement of account (from COL).
**Import (MIG):** 172 customers (3 ID schemes → legacy_id; 3 duplicate pairs to review; phones normalised), 89 measurement rows (84 "MANUAL" rows in 5 batches need the owner to assign customer/group on the review screen; "-" → blank; "Sleeve Height" → sleeve_length), university (15 records) and hospital (2) proposed as parent + groups (owner decides OWN-20).
**Tests:** revision never overwrites (old row unchanged, new row active); merge relinks all references and is audited; import dry-run counts equal source counts minus excluded rows.

## E2. Catalog & Pricing (CAT)
- `cat_items`: id, code, name, class (made-to-order garment | service | ready-made item), garment_type (for piece rates), unit (pc | set), set_components (e.g. set = top + bottom = 2 pieces for production counting), revenue role (SALES_MTO / SALES_SERVICE / SALES_RTW), active.
- `cat_prices`: item_id, effective_from, min_qty, unit_price_cents (VAT-inclusive). Price lookup = latest effective row with min_qty ≤ qty. Encoder may override the price on a line (logged).
- Discount rules: per line or per document; reason required above a setting (e.g. 10%).
**Tests:** tier lookup; effective dating; override logged.

## E3. Quotations (QUO)
- Header: customer (or walk-in prospect name), contact, validity (default +15 days), terms text, notes, attachments (design mock-ups, up to 5 images), status (draft → finalised → converted | expired | cancelled).
- Lines: item, description, qty, unit, unit price, line discount, line total; optional group/roster preview.
- **Convert to Job Order** = explicit action (`quo.convert`): creates a JO draft prefilled and linked; a quotation converts once (cancel the JO to allow re-conversion).
- Inquiry = a draft quotation with minimal fields (no separate module).
- Print: QUOTATION (legend; terms; validity; bank details for deposits).
**Tests:** totals server-computed; conversion once; expired quotation can still convert with a warning.

## E4. Job Orders & Release (JO)
**Header:** customer, group(s) pulled, contact, date (system), due date (default +15 days), priority, payment terms (50% downpayment | full payment | COD | 7/15/30 days; list editable), required downpayment (computed from terms), notes, attachments, status/stage: `open → in_production → ready → partially_released → released → closed`, plus `cancelled`.
**Lines:** item/garment type, description, complexity (for piece rates), qty (pieces; sets expand to components for production), unit price (VAT-inclusive), discount, line total, route template → steps (editable, canonical order), per-line rate overrides (reason).
**Roster** (`jo_roster`): one row per wearer per line: person_id (or free name for one-off), group, size (preset or "measured" → links the active chart revision at the time), jersey name (auto-uppercase), jersey number, qty (default 1), notes. Pull a whole group, then add/remove people; roster grid behaves like a spreadsheet (paste from Excel allowed).
**Money on the JO view:** total, collections applied (cash + CWT), **Balance due**, deposits held, invoiced amount, not-yet-invoiced amount.
**Release/Claim** (`jo_releases`, a document REL-): lines or wearers released (partial allowed), claimed_by name, ID type seen (no ID number stored), released_by (user), balance snapshot; if balance > 0 → required note + credit due date; manual invoice number/date (required unless "invoice to follow"); prints RELEASE SLIP (2-up, legend, QR). Posting: the invoice record (INV-REC + DEP-APPLY) is its own document created in the same action.
**Rules**
1. The JO posts no journal (D3). Commercial changes after posting (price, qty, items, customer) = cancel & reissue; operational fields (due date, priority, notes, route/assignments, attachments, roster corrections that keep quantities) are editable in place with audit (DEFAULT OWN-21).
2. Release requires all lines' last step Completed or "Not needed", or an owner override with reason.
3. Credit release (balance > 0) allowed with note + due date (who may: `jo.release_with_balance`, default Owner + Accountant; OWN-22).
4. Cancel JO with deposits → refund / transfer to another JO / forfeit dialog (D6).
5. Due-date alerts: 3 days before and overdue (dashboard + calendar).
**Prints:** JOB ORDER (customer copy, legend, terms), JOB TICKET (production copy with roster, sizes, jersey details, route checklist, QR; no prices), RELEASE SLIP.
**Tests:** a 30-wearer group JO in under 3 minutes (e2e timing); roster pull uses active chart revisions; partial release invoices only released lines; release blocked without invoice number unless "to follow" (then appears on exceptions list).

## E5. Collections & Receivables (COL)
**Collection document** (COL-; plus the CR number per mode):
- Customer; **applications**: one or more JOs/invoice records with amount applied each (default: oldest due first); **tenders**: one or more (cash place, amount, reference no. for GCash/bank/check, check date and bank for checks → 1103); **withholding**: CWT amount + ATC (WC158 goods 1% / WC160 services 2% / other), VAT withheld (government), 2307 status (pending/received, attachment); unapplied remainder → deposit.
- Balance rule: Σ tenders + CWT + VATW = Σ applied + unapplied (server-enforced).
- **CR mode** (setting, ACC-03): *booklet* (DEFAULT): encoder types the ATP CR booklet number (validated against the CR booklet register; never prefilled); nothing printed per payment. *System-numbered*: prints COLLECTION RECEIPT (2-up A4 or 80 mm) with the legend; enabling needs the accountant's sign-off fields (name, date, basis) + step-up.
- Posting: DEP-RCV (un-invoiced JO part) and/or COL-RCV (invoiced part) and COL-OVER, all in one journal.
**Other documents:** deposit transfer (DEP-XFER), refund (DEP-REFUND), forfeit (DEP-FORFEIT), credit memo (CM-ALLOW; accountant), CWT-only (CWT-ONLY), bad debt (accountant).
**2307 register** (TAX owns the report): every CWT line with customer TIN, ATC, base, amount, quarter, status; blocks claiming the same certificate twice; "2307 to chase" list.
**Statement of account** (print, legend, not numbered): opening, JOs, invoices, collections, deposits, balance due, aging.
**AR aging:** by invoice record open items (current, 1–30, 31–60, 61–90, >90) plus a memo section for un-invoiced JO balances.
**Tests:** split tender posts one journal with a line per cash place; CWT goes to 1410 never an expense; overpayment goes to 2201; cancel mirrors; booklet number cannot repeat.

## E6. Quick Sale (QS)
One screen for walk-ins: customer (default "Walk-in", or pick/create), lines (any item or service: repair, alteration, ready-made, custom text with a category), total, manual invoice number (required; VAT sellers invoice every sale), tenders (split allowed), optional CR booklet no. / system CR print. Creates an invoice record + collection, linked, in one transaction (QS-SALE). Target: under 45 seconds.
**Tests:** posts AR and clears it in the same transaction; cancel cancels both.

## E7. Production (PRD) and Piece-Rate Table (RATE)
**Step catalogue** (`prd_steps`, editable, canonical order): 1 Layout/Sampling, 2 Printing, 3 Heatpress, 4 Cutting, 5 Embroidery, 6 Sewing, 7 Packing; optional QC (off by default; OWN-24). Default pay basis per step: Sewing = per piece; Cutting = per piece or daily; others daily by default (any step can have piece rates).
**Route templates** (seed): T1 Cut–Sew–Pack; T2 Sublimation full (Layout → Printing → Heatpress → Cutting → Sewing → Packing); T3 Embroidered garment (Layout → Cutting → Embroidery → Sewing → Packing); T4 Embroidered, no layout (Cutting → Embroidery → Sewing → Packing); T5 Embroidery only; T6 Print & press only (Layout → Printing → Heatpress → Packing). A JO line picks a template; steps can be removed/added, always kept in canonical order.
**Step status per JO line:** pending → in progress → completed | not needed; Reopen allowed (reason) until released; actor + time stamps.
**Assignments** (`prd_assignments`, insert-only child records): jo_line_id (or component), step_id, employee_id, pieces_done, work_date (system date), rate_cents (snapshot from the rate table or override with reason), amount_cents, encoded_by, pay_run_line_id (set when paid; unique so it can be paid once), correction_of_id (negative correction entries after payment).
**Rules**
1. Pieces per step ≤ pieces available from the previous required step (sets count as their components); over-cap needs a reason ("pasubra"/rework is a separate assignment type with its own rate, OWN-25).
2. A step can have several workers; the sum of their pieces ≤ step quantity.
3. Completing the last step marks the line Ready; all lines Ready → JO Ready (notification; optional "ready for pick-up" email).
4. Piece rate lookup: `rate(garment_type, step/operation, complexity, effective date)`; the encoder may type an override (reason; `rate.override` permission, default Encoder allowed, logged; OWN-26).
**RATE table:** garment type × operation × complexity (simple/standard/complex), rate, effective_from; history kept. **Seed**: the 49-row table derived from 409 old piece-pay lines (research file `migration-profile.md` §5.3; e.g. T-shirt sewing ₱40–45, shorts ₱45, polo ₱60–70, NBA-cut jersey ₱70–75). The owner confirms the conflicting rates before go-live (OWN-05).
**Screens:** production board (by step columns, filters by due date/priority), my tasks, JO production tab (route chips per line, assign workers with piece counts in a quick grid), **TV board** (read-only, auto-refresh 30 s, large text, no money, individual customers as initials), labor summary per JO.
**Tests:** cap enforcement; an assignment paid in a run cannot be paid again; correction after payment flows to the next run; JO status sync.

## E8. Sizer Tracker (SZR, Should/Later)
Sample-size sets: set code, garment type, sizes included, status (in shop | lent | lost/damaged | inactive); loan records (customer/group, date out, expected return, returned date, condition). Overdue list on the dashboard. No postings (charging a lost set = a quick sale).

## E9. Suppliers & Purchasing (PUR), Payables (AP), Expenses (EXP), Inventory (INV)
**Suppliers:** name, registered name, TIN, VAT-registered flag, default EWT class/ATC (none, rent 5%, contractor 2%, professional individual 5%/10%, firm 10%/15%, goods 1%/services 2% if Virtus is TWA), sworn declaration valid-until (for professional rates), payment terms, bank details, contacts, active, legacy_id. Import 18 (1 duplicate name to review).
**Supplies catalogue:** 27 materials (from 31 rows), unit (yard, meter, kg, roll, pc, ...), last purchase cost (for count valuation), category (materials | ready-made merchandise).
**Purchase order** (PO-): supplier, lines (supply, qty, unit cost), expected date, print PURCHASE ORDER (legend). Editable in place until first receiving (OWN-23), then cancel & reissue.
**Receiving report** (RR-): quantities received against PO lines (partial allowed); no journal.
**Supplier bill** (BILL-): supplier, supplier invoice no. + date (duplicate check), lines (category or supply, amount VAT-inclusive), VAT from the invoice, EWT auto from the supplier's class (editable by accountant), due date. Posting BILL-POST. Rent accrual uses the same document.
**Supplier payment** (SPAY-): applies to bills; tenders (split, checks); fee line. Posting BILL-PAY. Prints PAYMENT VOUCHER (legend) and **BIR Form 2307** data for the quarter (print via TAX, Should).
**Expense voucher** (EXP-): for things paid immediately: category (fixed list), payee (supplier or one-off name + TIN if VAT receipt), description, amount, VAT receipt fields (supplier invoice no., date, TIN) to claim input VAT, EWT if applicable, tenders (petty cash allowed). Posting EXP-PAY. Receipt photo attachment encouraged.
**Petty cash:** imprest fund (1102); replenishment = transfer from bank/cash (TRF); petty cash count = cash count.
**Inventory count** (INVC-): count sheet per category (materials, ready-made), qty counted × cost (latest purchase cost default) = counted value; adjustment vs GL 1301/1302 posts INV-COUNT. Monthly or yearly (ACC-13). Prints COUNT SHEET.
**AP aging** and supplier ledger from 2101 open items.
**Tests:** EWT at accrual (bill), not at payment; rent ₱40,000 golden; duplicate supplier invoice blocked; input VAT only with valid fields; count adjustment both directions.

## E10. Cash & Banks (CASH), Owners (EQ), Loans (LOAN), Fixed Assets (FA)
**Cash places:** seed Cash on hand, Petty cash, Checks on hand, BDO, China Bank, GCash (each its own GL account; bank account number masked). Balances computed from the GL. Encoders see names; balance visibility per role (DEFAULT: encoders see cash on hand and petty cash balances only, OWN-27).
**Documents:** fund transfer (TRF; amount sent/received; fee), check deposit (TRF from 1103), cash count (CASH-COUNT; denomination grid), other receipt (OTH-RCV), bank adjustment (BANK-ADJ).
**Bank reconciliation** (Should): per bank and statement month; statement lines typed or pasted (CSV); tick-match to GL lines (cleared flag per journal line in a child table, never editing the line); unmatched bank items create BANK-ADJ documents; report shows book balance, outstanding items, bank balance, difference = 0.
**Cash book:** GL detail of one cash place with running balance; print.
**Owners & officers:** register of stockholders/officers (name, role, shares if known); OWN-IN with required classification; OFC-OUT/OFC-IN; officer ledger. The old ₱164,168 (VERSION 2) and ₱500,000 (Apps Script hardcoded) owner amounts are handled only at cut-over by the accountant (ACC-10).
**Loans:** lender, principal, date, rate, term, schedule (generated or typed), LOAN-IN, LOAN-PAY (split from schedule, override with note), loan ledger.
**Fixed assets:** register (class, description, acquisition date, cost, residual, useful life months, location, status), FA-BUY (or opening entry), monthly **Depreciation run** document (DEPR-; one per month; lists each asset's charge; unique asset+month), disposal (FA-DISP; sale requires an invoice record). Seed classes and default lives (machinery 60 months, computers 36, furniture 60, vehicles 60, leasehold over lease term; ACC-16). ₱553,118.90 of old equipment expenses must be capitalised through the opening wizard with dates and lives.
**Tests:** transfer with fee golden; owner money cannot be saved without classification; loan principal never hits an expense account; depreciation run twice for a month is blocked.

## E11. Employees & Time (EMP), Payroll (PAY), Cash Advances (CA), Statutory (STAT)
Full engine in Part F. Module scope:
- **Employee master:** code, name, position, department, cost centre (production | office/sales), status (active | separated with date and reason), hire date, pay profile history (effective-dated rows: pay type daily | per-piece | monthly | mixed, daily rate, monthly rate, pay group, workweek, MWE flag), statutory switches (SSS, PhilHealth, Pag-IBIG, WTax; **DEFAULT ON for every employee**; unticking needs a reason, OWN-07), government IDs (SSS no., PhilHealth PIN, Pag-IBIG MID, TIN; visible only with `emp.view_ids`), bank/GCash for payout (optional), emergency contact, birthday (optional). Import 19 (4 Board Members without pay type: owner confirms whether any are on payroll, OWN-28).
- **Attendance:** simple day grid per pay period (present, half-day, absent, leave, holiday worked, rest day worked, OT hours); typed by the encoder or accountant.
- **Holidays:** 2026 PH calendar seeded (Proclamation 1006 + Eid'l Fitr Mar 20 + Eid'l Adha May 27; research §8.2), plus local Cavite/Silang days (OWN-29); pay rules as settings.
- **Leave:** SIL 5 days after 1 year (balance tracking Should).
- **Payroll run** (PAY-): pay group + period; generates lines from attendance, **production assignments dated in the period (not yet paid)**, monthly salary, holidays, manual lines (allowance, OT, maintenance, adjustment; reason), statutory deductions, CA installments; preview per employee; post = PAY-RUN; **payslips** (print A4 2-up; optional email, Should); release (POUT-) = PAY-REL with split tenders.
- **Cash advances** (CA-): give (CA-GIVE), installment plan per run, deduction in payroll, cash repayment, write-off (accountant); CA ledger per employee always = GL 1210 (the ledger is read from journals).
- **Statutory (STAT):** monthly lists per scheme (SSS contributions list, PhilHealth RF-1-style list, Pag-IBIG MCRF-style list, 1601-C worksheet) from the payable lines tagged scheme+month; remittance document STAT-REM with reference no. (PRN/receipt) and variance check; year-end 2316 data and alphalist export; **exposure report** for past months with no deductions (for the accountant's catch-up decision, ACC-05).
- **13th month:** accrued each run (1/12 of basic, incl. piece basic); payout run in December or on separation (TH13-PAY).

## E12. Accounting (ACC) and Tax Compliance (TAX)
- **COA screen** (accountant): add/rename accounts; types fixed; role keys locked; cannot deactivate with balance.
- **Journal voucher** (JV-): accountant only; any postable accounts; party when required; backdating allowed with "late entry" flag; filed-period warning; attachments; reversal-on-date option for accruals (auto-reversing JV creates a second JV dated the first day of next month, user-confirmed).
- **Settings screens (effective-dated, step-up):** VAT rate; deposit VAT mode (A/B/C); CR mode (booklet/system + sign-off); TWA status; recognition options (invoice-to-follow allowed?); filed-returns register (form, period, date filed, reference).
- **ATP booklet registry:** booklet kind (sales invoice | collection receipt | other), ATP number and date, printer, serial from–to, received date, status; per-number status (used, cancelled with all copies, unused). Reports: used/unused/skipped.
- **Tax registers & worksheets:** Sales register (invoice records) with VATable/VAT/total and buyer TIN; purchases register (bills + expenses with VAT) by class (goods, services, capital goods, imports); **2550Q worksheet**; **SLSP** data export (CSV in the BIR layout, Should); CWT (2307 received) register and SAWT data; EWT register by ATC and payee, 0619-E and 1601-EQ worksheets, QAP data, 2307 print (Should); tax calendar (deadlines from the settings table) on the calendar and accountant home.
- **Deposits crossing a VAT quarter** report (supports ACC-02).

## E13. Platform, Security, Audit, Backup, Migration (PLT, SEC, AUD, BAK, MIG)
- **First run:** create the first Owner (passphrase), company profile (registered name, TIN + branch code, RDO, address, VAT-registered, logo), cash places, recovery keys (browser-generated, printed, one typed back), backup folder and Google Drive folder, LAN address card, "Join this PC" helper for each device.
- **Users & roles:** unique user per person (no shared accounts); role templates Encoder, Accountant, Owner, Production, TV; grid of exact permission keys per role (owner edits; step-up); deactivating a user revokes sessions.
- **Audit viewer:** filter by user, date, document, action; before/after values for master data; exports logged; hash-chain status.
- **Integrity centre:** runs D9 checks on demand and nightly; red items explain what to do.
- **Backup/Restore screens:** status of each tier, last off-site copy age, "Copy backups to USB", restore wizard (step-up), drill scheduler.
- **Master-data importer (MIG-01):** pipeline stage → validate → **owner review screen** (merge duplicates, assign the 84 MANUAL measurement rows, confirm employee rates, confirm piece-rate seed) → dry run with counts and checksums (e.g. measurement cells sum 30,122.0) → single-transaction commit with a legacy-ID map; re-runnable on a fresh export at cut-over; raw staging values cleared after verification (privacy).
- **Opening balances wizard (MIG-02):** D8 steps, open JO checklist, accountant sign-off.
- **Cut-over checklist screen:** every go-live item from J4 with tick, name and date.

## E14. Dashboard (DASH), Calendar (CAL), Search (NAV), Communications (COM)
- **Role homes:** Encoder (to-do: drafts, due this week, ready for release, collectibles, production queue, "2307 to chase"); Accountant (exceptions inbox, tax deadlines, VAT this quarter, month-end checklist, integrity status); Owner (System Health dot, cash position from the ledger, month-to-date sales/collections/expenses, recent cancellations with reasons, overdue collectibles); Production (my tasks, board); TV (board only).
- **Notifications (computed, per-user read state):** JO due soon/overdue, JO ready, released with balance, invoice to follow, draft older than 3 days, cash place negative, backup stale, clock problem, 2307 pending > 30 days, statutory/tax deadlines, every cancel/reissue (owners).
- **Calendar:** fittings (typed events), JO due dates, releases, holidays, tax/statutory deadlines, birthdays (only if collected).
- **Global search:** customers, people, JOs, invoice/CR numbers, suppliers, employees; permission-filtered.
- **Customer emails (optional, Should):** templates for order created, progress (only on "ready for pick-up", not every save), claimed, statement; queued in the outbox; consent flag; log.

---

# F. Payroll engine and 2026 statutory settings

## F1. Settings (all effective-dated, insert-only, edited by the accountant with a preview/test screen)
| Scheme | Value in force (Sep 2026) | Source |
|---|---|---|
| SSS | 15% of MSC: **employer 10%, employee 5%**. MSC ₱5,000–₱35,000 in ₱500 steps (compensation below ₱5,250 → ₱5,000; ₱34,750 and above → ₱35,000). Regular SS on MSC up to ₱20,000; the part above ₱20,000 goes to MPF/WISP (same 10%/5%). **EC (employer only): ₱10 if MSC ≤ ₱14,500, ₱30 if ≥ ₱15,000.** Max per month ER ₱3,530, EE ₱1,750. No change until 2027 | SSS Circular 2024-006, eff. 2025-01-01. Seed all 61 bracket rows from research `payroll-ph-2026.md` §3.8 |
| PhilHealth | **5%** of monthly basic salary, split equally; floor ₱10,000, ceiling ₱100,000 (premium ₱500–₱5,000). Daily-paid basis: daily rate × 313/12 (6-day week) or × 261/12 (5-day). Piece workers: actual monthly basic piece earnings, floor applies | PhilHealth Advisory 2025-0002; Circular 2018-0001 |
| Pag-IBIG | EE **2%** (1% if monthly compensation ≤ ₱1,500), ER **2%**, on compensation capped at ₱10,000 → max ₱200 each | HDMF Circular 460 (Feb 2024) |
| Withholding tax | RR 11-2018 **Annex E** (2023 onward) tables: daily, weekly, semi-monthly, monthly. Monthly: 0 up to ₱20,833; 15% of excess over ₱20,833; ₱1,875 + 20% over ₱33,333; ₱8,541.80 + 25% over ₱66,667; ₱33,541.80 + 30% over ₱166,667; ₱183,541.80 + 35% over ₱666,667. Semi-monthly zero bracket up to ₱10,417; weekly up to ₱4,808; daily up to ₱685 (full rows: research §6.2) | BIR Annex E RR 11-2018 |
| Minimum wage earner | SMW + holiday pay + OT + night differential + hazard pay of an MWE are tax-exempt; other pay taxable | RR 11-2018 §2.78.1(B)(13) |
| 13th month + other benefits exemption | ₱90,000 per year (a ₱120,000 proposal is not law) | RR 11-2018 |
| De minimis ceilings | RR 29-2025 (from 2026-01-06): rice ₱2,500/month, uniform ₱8,000/yr, gifts ₱6,000/yr, medical ₱12,000/yr, laundry ₱400/month, ... | Research §6.5 |
| 13th-month pay | ≥ 1/12 of basic pay earned in the year (piece-rate workers included); excludes OT, holiday pay, premiums; pay by Dec 24; DOLE report by Jan 15 | PD 851 |
| Holiday pay | Regular holiday: 100% if unworked (eligible), 200% worked, 260% worked on rest day. Special non-working: no work no pay, 130% worked, 150% on rest day. OT +25% ordinary, +30% on premium days. Night differential 10%. Piece worker holiday pay = average daily earnings of the last 7 workdays, not below SMW | DOLE LA 12-25 |
| Minimum wage (Silang, Cavite, Region IV-A first-class municipality) | **₱550/day** non-agriculture from 2025-10-05 | Wage Order IVA-22 (confirm Silang's class, OWN-06) |
| SIL | 5 days/year after 1 year of service (Virtus has ~19 staff, so it applies) | Labor Code Art. 95 |

## F2. Pay groups (DEFAULT, confirm OWN-08)
| Group | Period | Tax table | Who |
|---|---|---|---|
| WEEKLY_PIECE | 6-day week (Mon–Sat, paid Saturday; old apps used Sun–Fri or 6-day periods) | weekly | piece-rate sewers/cutters |
| SEMI_DAILY | 1–15, 16–end | semi-monthly | daily-paid |
| SEMI_MONTHLY | 1–15, 16–end (monthly rate ÷ 2) | semi-monthly | monthly staff |
A worker may have daily and piece lines in the same run only if their pay type is "mixed".

## F3. Run algorithm (server-side, deterministic, unit-tested)
```
for each employee in the run (pay_group, period_start, period_end, pay_date):
  earnings = attendance (days × daily rate; half-days), piece assignments dated in the period and unpaid
             (rate snapshot × pieces, job-order tagged), monthly salary share, holiday lines, OT, allowances, manual lines
  warnings = min-wage check (daily rate < SMW; piece earnings < days worked × SMW → optional MIN_WAGE_TOPUP line, ACC-06b)
  M = contribution month = month of period_end (setting)
  MTD = month-to-date bases for M over all posted runs + this run
  if SSS on:        ded.sss  = sss_monthly(MTD.sss_comp)  − already deducted for M   (EE, ER, EC, MPF split)
  if PhilHealth on: ded.phic = phic_monthly(MTD basis)    − already for M
  if Pag-IBIG on:   ded.hdmf = hdmf_monthly(MTD.comp)     − already for M
  taxable = Σ taxable earnings − EE shares (SSS incl. MPF, PhilHealth, Pag-IBIG)
  wtax = WTax on? table[frequency, version @ pay_date](taxable) : 0 ; MWE: exempt parts excluded
  final run of year / separation: year-end adjustment (annualise; refund or deficiency)
  CA installment = min(plan, outstanding), capped so net ≥ minimum net pay setting
  net = Σ earnings − Σ deductions (never negative; a statutory EE shortfall is carried and flagged)
  13th accrual = Σ 13th-month-base lines / 12
```
- Deduction order when net is short: SSS/PhilHealth/Pag-IBIG EE → WTax → government loans → CA → other (only with written consent).
- Version selection: contributions use the version effective on the first day of month M; WTax the version on the pay date; minimum wage and holiday rules the version on each work date.
- Posting PAY-RUN splits gross and employer shares by cost centre (production → 5201/5202/5203/5204; office → 6101/6102/6103); piece lines keep the JO and step tags for the labor-per-JO report.
- **Paid-once guarantee:** a unique index on `prd_assignments.pay_run_line_id`; cancelling a run releases its assignments.
- **Goldens:** research `payroll-ph-2026.md` §13 examples A (₱550/day MWE, semi-monthly), B (weekly piece-rate over 4 weeks), C (₱15,000/month office), C2 (₱35,000/month, tax path) with their balanced journals in §14.3. Example C cutoff 2 (Sep 30): Dr 6101 7,500.00; Dr 6102 820.00 (SSS ER 750 + EC 20 + Pag-IBIG ER 50) / Cr 2401 1,145.00 (EE 375 + ER 750 + EC 20); Cr 2403 100.00; Cr 2110 7,075.00. Debits 8,320.00 = credits 8,320.00.

## F4. Payroll reports and prints
Payslip (per employee: earnings lines, deductions, CA balance after, YTD); payroll register (per run and per month); piece-work summary per employee and per JO; labor cost per JO; SSS/PhilHealth/Pag-IBIG monthly lists; 1601-C worksheet; 13th-month register; 2316 data and 1604-C alphalist export (Should); statutory exposure report (months with no deductions); CA ledger per employee.

---

# G. Reports (all from the ledger or from posted documents; filters, drill-down to the document, export CSV/XLSX/PDF, print)
| Group | Report | Tier |
|---|---|---|
| Books & statements | General journal; General ledger; Trial balance (any date, comparative); Income statement (month, quarter, YTD, comparative; cost of sales = purchases ± inventory change + direct labor + overhead); Balance sheet; Cash flow statement (indirect method from the ledger, Should); Statement of changes in equity (Later) | Must (cash flow Should) |
| BIR books layouts | Cash receipts journal; Cash disbursements journal; Sales journal (invoice records); Purchase journal; General journal; General ledger — printable in loose-leaf layout (page numbers, running totals) for manual transcription or loose-leaf binding (ACC-04) | Must |
| Cash | Cash book per cash place; cash position (all places); transfers; cash counts with differences; bank reconciliation report (Should) | Must |
| Customers | AR aging (invoice records) + memo of un-invoiced JO balances; collectibles; customer ledger; statement of account; deposits held by customer/JO; deposits crossing a VAT quarter; collections register (by cash place, by encoder); refunds/forfeits | Must |
| Sales | Sales by period/customer/item/garment type; JOs by status; released with balance; invoice-to-follow list; quotation conversion rate (Should) | Must |
| Production | Board status; throughput per step; lead time per JO; late JOs; worker output (pieces per step per period); labor cost per JO; job margin (invoice net − tagged piece labor; non-GL) (Should) | Must/Should |
| Suppliers | AP aging; supplier ledger; purchases by supplier/category; PO status; received-not-billed | Must |
| Tax | Sales register (VATable, VAT, buyer TIN); purchases register by class; 2550Q worksheet; SLSP data export (Should); CWT/2307 received register + SAWT data; VAT withheld by government; EWT register by ATC and payee; 0619-E/1601-EQ worksheets; QAP data; 2307-to-issue list; ATP booklet usage/skipped numbers; tax calendar | Must (exports Should) |
| Payroll | See F4 | Must |
| Assets & inventory | Fixed-asset schedule (cost, accumulated depreciation, book value, monthly charge); depreciation run detail; inventory count and adjustments | Must |
| Control | Audit trail; changes after filing; late entries (JVs dated before their creation); cancellations and reissues with reasons; exceptions (released without invoice, negative cash, stale drafts, Misc > 10%); integrity check results; login history | Must |
| Owner | "Health of the business": cash position, month sales vs last year, collections, overdue receivables, payables due, payroll this month, top customers (Should) | Should |

---

# H. Screens, words and printouts (UX rules)
The detailed UX specification (menus, 22 dashboard widgets, 44 message texts, 66-row glossary, 27 prints with fields, speed targets, accessibility) is in `/mnt/project-files/plan/design/ux-conventions.md`. Builders follow it; the essentials are below.

## H1. Menu (9 groups; items filtered by permission)
Overview (home, calendar, production board) · Sales (customers, quotations, job orders, collections, quick sale, statements) · Production (board, my tasks, assignments, piece rates, sizer sets) · Purchases & Expenses (suppliers, purchase orders, receiving, bills, supplier payments, expenses, inventory counts) · Money (cash places, transfers, cash counts, bank reconciliation, owners & officers, loans, fixed assets) · People & Payroll (employees, attendance, holidays, payroll runs, releases, cash advances, remittances) · Accounting & Tax (journal vouchers, chart of accounts, tax registers, booklets, VAT close, filed returns) · Reports · Admin (users & roles, settings, audit, backups, import, opening balances, system health). Plus a "+ New" button and readable URLs.

## H2. Standard screen patterns
- **List:** search, stat cards that filter (e.g. "Due this week 7"), status chips, red left border when overdue, strikethrough when cancelled, 25 rows per page, export (logged).
- **Form:** sections, required marks, live totals computed by the same shared calculator as the server, **Save draft** (no number) and **Record** (posts). Record opens a confirm dialog with the server preview and a plain summary ("This will record ₱5,000 received in GCash for JO-000123"). Enter moves to the next field; Ctrl+Enter records.
- **View:** status, linked-documents timeline (quotation → JO → releases → invoice records → collections), History tab (audit), attachments, **What this did** panel (plain words, for everyone) and **Behind the scenes** panel (journal lines with debit/credit, rule id, settings used; accountant and owners only).
- **Edit a recorded document:** dialog explains "the original will be cancelled and a new one issued with a new number", asks a reason, changes nothing until the replacement is saved.
- **Money questions instead of accounts:** "Where did the money go?" / "Where did the money come from?" as big buttons, one per cash place. Encoders never see debit, credit or journal (a CI scan checks encoder screens for banned words).
- **Server date banner** on every screen; practice-mode banner when in practice mode.
- **Language:** English labels with the shop's own words in brackets where helpful (bale, pakyawan, pasubra).

## H3. Glossary (staff word → accounting underneath; excerpt)
| Staff sees | Underneath |
|---|---|
| Balance due | Memo JO balance (before invoice) + AR (after invoice) |
| Downpayment / deposit | 2201 Customer deposits |
| Tax withheld by customer (2307) | 1410 Creditable withholding tax (an asset) |
| Invoice record / "write these on the booklet" | INV-REC: AR, Sales, Output VAT |
| Money in / Collection | COL: cash/bank/GCash debit, AR or deposits credit |
| Expense | EXP: expense category + input VAT + EWT |
| Owner money | OWN-IN: equity or due to stockholders |
| Cash advance / bale | 1210 Advances to employees |
| Pakyawan / per-piece | Piece-rate direct labor 5201 |
| Pasubra / rework | Rework assignment type |

## H4. Print catalogue (no "Invoice", no "Official Receipt"; legend = "THIS DOCUMENT IS NOT VALID FOR CLAIM OF INPUT TAX." in bold)
| Print | Legend | Paper |
|---|---|---|
| QUOTATION | yes | A4 |
| JOB ORDER (customer copy) | yes | A4 |
| JOB TICKET (production, no prices) | no (internal) | A4 |
| RELEASE SLIP | yes | A4 2-up |
| STATEMENT OF ACCOUNT | yes | A4 |
| COLLECTION RECEIPT (system-numbered mode only) | yes | A4 2-up or 80 mm |
| CREDIT MEMO (if the accountant approves the ERP form) | yes | A4 |
| PURCHASE ORDER | yes | A4 |
| PAYMENT VOUCHER | yes | A4 2-up |
| EXPENSE VOUCHER / FUND TRANSFER SLIP / CASH COUNT SHEET / JOURNAL VOUCHER | no (internal) | A4 |
| PAYSLIP / CASH ADVANCE SLIP | no | A4 2-up |
| SIZING PROFILE | no | A4 |
| COUNT SHEET / FIXED ASSET SCHEDULE / books layouts | no | A4 / long bond |
| Invoice worksheet ("write these on the booklet") | screen only, never printed | — |
Every print shows the company's registered name, TIN and address, the document number, business date, "Printed by / at" and a reprint counter. Bank accounts printed for deposits must be company accounts (OWN-30).

## H5. Speed targets (checked on test day with a stopwatch)
Collection recorded ≤ 30 s; quick sale ≤ 45 s; expense ≤ 30 s; 30-wearer group JO ≤ 3 min; assignment of workers for one step ≤ 30 s; weekly piece payroll for 8 workers ≤ 5 min; page loads ≤ 1 s on the shop LAN.

---

# I. Testing: golden scenarios and invariants

## I1. Test layers (all are CI gates; a red gate blocks merge)
1. **Unit:** money/VAT/withholding math (the D4 examples), statutory calculators (F1), rate lookup, date utilities (Manila dates, never UTC slicing).
2. **Posting goldens:** every event code in D5 has at least one golden: input → exact journal lines (account, party, debit, credit) to the centavo, plus its cancel (mirror nets to zero).
3. **Property tests (fast-check):** for random valid inputs of every document type: posts balanced; cancel nets to zero per account and party; reissue with invalid input leaves the original unchanged; NET + VAT = G; allocations sum exactly; numbers gapless under concurrent posting.
4. **Permission matrix:** generated test of every route × every role (allowed/denied as the grid says).
5. **API tests:** strict schemas reject client-sent `date`, `number`, `total*`, `status`, `vat*`, `created_by`; idempotency (same key → one document); `If-Match` conflicts.
6. **End-to-end (Playwright, few):** first-run setup; JO → collection → release with invoice → balance zero; quick sale; payroll run → release; restore drill on a copy.
7. **Windows smoke (CI):** install Setup.exe on a Windows runner, service starts, `/health` green, upgrade from the previous release's demo DB, rollback path.
8. **Blind recompute (reviewers):** ChatGPT and Gemini receive scenario inputs + Part D rules, not the ERP's outputs, and return expected journals as CSV (`doc_ref,line,account_code,debit,credit,party,tax_kind,base,rate`); `tools/compare-blind.ts` diffs automatically.

## I2. Golden scenarios (expected journals; pesos shown, centavos stored)
Setup for G-01..G-12: customer "Test School" (VAT-registered, TWA goods 1%); deposit VAT mode A unless stated; CR booklet mode.
| # | Scenario | Expected journal(s) |
|---|---|---|
| G-01 | JO ₱56,000 (1 line, made-to-order); downpayment ₱28,000 cash | JO: none. DEP-RCV: Dr 1101 28,000.00 / Cr 2201 28,000.00 (party Test School, JO). Balance due 28,000.00 |
| G-02 | Release all with manual invoice no. 0501 | Dr 1201 56,000.00 / Cr 4101 50,000.00, Cr 2301 6,000.00; Dr 2201 28,000.00 / Cr 1201 28,000.00. Open AR 28,000.00 = balance due |
| G-03 | Collect balance: customer withheld 1% (base NET(28,000) = 25,000.00 → CWT 250.00); GCash 10,000.00 + cash 17,750.00 | Dr 1121 10,000.00; Dr 1101 17,750.00; Dr 1410 250.00 / Cr 1201 28,000.00. Balance due 0; 2307 register +1 (pending) |
| G-04 | G-01/G-02 in **mode B** | Deposit adds Dr 2209 3,000.00 / Cr 2301 3,000.00; invoice adds Dr 2301 3,000.00 / Cr 2209 3,000.00. End: 2301 = 6,000.00, 2209 = 0 |
| G-05 | G-01/G-02 in **mode C** (no CWT) | DP invoice: Dr 1201 28,000.00 / Cr 2201 25,000.00, Cr 2301 3,000.00; collection Dr 1101 28,000.00 / Cr 1201 28,000.00; release invoice: Dr 1201 28,000.00 / Cr 4101 25,000.00, Cr 2301 3,000.00 and Dr 2201 25,000.00 / Cr 4101 25,000.00. End: Sales 50,000.00, Output VAT 6,000.00, 2201 = 0, AR 28,000.00 |
| G-06 | One collection ₱25,000 (cash 5,000 + BDO 20,000) applied ₱10,000 to invoiced JO-A and ₱15,000 to un-invoiced JO-B | Dr 1101 5,000.00; Dr 1111 20,000.00 / Cr 1201 10,000.00; Cr 2201 15,000.00 (JO-B) |
| G-07 | Pays ₱12,000 on AR ₱10,000; later refund ₱2,000 | Dr 1101 12,000.00 / Cr 1201 10,000.00, Cr 2201 2,000.00; refund Dr 2201 2,000.00 / Cr 1101 2,000.00 |
| G-08 | Quick sale: alteration ₱350 cash, manual invoice no. 0502 | Dr 1201 350.00 / Cr 4103 312.50, Cr 2301 37.50; Dr 1101 350.00 / Cr 1201 350.00 |
| G-09 | Government customer: invoice ₱112,000; collection withholds 5% VAT on 100,000.00 and 1% CWT; BDO 106,000.00 | Invoice Dr 1201 112,000.00 / Cr 4101 100,000.00, Cr 2301 12,000.00; collection Dr 1111 106,000.00, Dr 1404 5,000.00, Dr 1410 1,000.00 / Cr 1201 112,000.00 |
| G-10 | Invoice with discount shown: list ₱56,000 − ₱5,600 = ₱50,400 | Dr 1201 50,400.00; Dr 4190 5,000.00 / Cr 4101 50,000.00; Cr 2301 5,400.00 |
| G-11 | Credit memo allowance ₱5,600 (accountant) | Dr 4191 5,000.00; Dr 2301 600.00 / Cr 1201 5,600.00 |
| G-12 | Collection ₱10,000 recorded in GCash by mistake; edited to Cash | Original Dr 1121 / Cr 1201 10,000.00; reversal (today) Dr 1201 / Cr 1121 10,000.00; new document (new number) Dr 1101 / Cr 1201 10,000.00. Net: 1121 = 0, 1101 +10,000.00. Both linked; reason stored |
| G-13 | Rent ₱40,000 (VAT-registered lessor, VAT-inclusive), paid from BDO, EWT 5% | Dr 6110 35,714.29; Dr 1401 4,285.71 / Cr 2311 1,785.71; Cr 1111 38,214.29 |
| G-14 | Same rent, non-VAT lessor | Dr 6110 40,000.00 / Cr 2311 2,000.00; Cr 1111 38,000.00 |
| G-15 | Supplier bill fabric ₱11,200 (VAT supplier; Virtus not a TWA); pay ₱5,000 | Bill Dr 5101 10,000.00; Dr 1401 1,200.00 / Cr 2101 11,200.00; payment Dr 2101 5,000.00 / Cr 1111 5,000.00; AP open 6,200.00 |
| G-16 | Tricycle ₱200 from petty cash, no VAT receipt | Dr 6140 200.00 / Cr 1102 200.00 |
| G-17 | Transfer BDO → China Bank: sent ₱10,000, received ₱9,975 | Dr 1112 9,975.00; Dr 6230 25.00 / Cr 1111 10,000.00 |
| G-18 | Cash count: ledger ₱12,500.00, counted ₱12,450.00 | Dr 6280 50.00 / Cr 1101 50.00 |
| G-19 | Owner puts ₱100,000 into BDO, classified "advance from stockholder" | Dr 1111 100,000.00 / Cr 2501 100,000.00. Saving without a classification is rejected |
| G-20 | Loan ₱500,000, ₱5,000 fee deducted; instalment ₱25,000 = 20,000 principal + 5,000 interest | Dr 1111 495,000.00; Dr 7201 5,000.00 / Cr 2601 500,000.00; Dr 2601 20,000.00; Dr 7201 5,000.00 / Cr 1111 25,000.00 |
| G-21 | Heat press ₱112,000 (VAT incl.): ₱30,000 BDO, ₱82,000 financed; residual 10,000, 60 months | Dr 1510 100,000.00; Dr 1401 12,000.00 / Cr 1111 30,000.00; Cr 2602 82,000.00. Monthly run: Dr 5302 1,500.00 / Cr 1511 1,500.00. Second run for the same month is blocked |
| G-22 | Count: GL 1301 ₱30,000, counted ₱25,000; next count ₱42,000 | Dr 5109 5,000.00 / Cr 1301 5,000.00; then Dr 1301 17,000.00 / Cr 5109 17,000.00 |
| G-23 | CA ₱2,000 cash; ₱1,000 deducted in payroll | Dr 1210 2,000.00 / Cr 1101 2,000.00; the run credits 1210 1,000.00; CA ledger = GL 1210 = 1,000.00 |
| G-24 | Payroll, monthly office staff ₱15,000, cutoff 2 (F3) | Dr 6101 7,500.00; Dr 6102 820.00; Dr 6103 625.00 / Cr 2401 1,145.00; Cr 2403 100.00; Cr 2111 625.00; Cr 2110 7,075.00. The 6103/2111 pair is the 13th-month accrual (ACC-18 default "accrue every run", 7,500 / 12); with the accrual switched off the rest is unchanged |
| G-25 | Payroll research examples A, B, C2 (daily MWE, weekly piece, tax path) | As in `docs/research/payroll-examples.md` (a copy of `payroll-ph-2026.md` §13–14.3) |
| G-26 | VAT close: output 60,000 / input 25,000; other quarter output 20,000 / input 30,000 | Dr 2301 60,000.00 / Cr 1401 25,000.00; Cr 2302 35,000.00. Dr 2301 20,000.00; Dr 1402 10,000.00 / Cr 1401 30,000.00 |
| G-27 | Opening: cash 20,000; BDO 150,000; AR 36,000 (opening invoice); machinery 300,000; undelivered JO with 20,000 collected; loan 200,000; equity: capital stock 250,000, retained earnings 36,000 | Dr 1101 20,000.00, 1111 150,000.00, 1201 36,000.00, 1510 300,000.00 / Cr 3900 506,000.00; Dr 3900 20,000.00 / Cr 2201 20,000.00; Dr 3900 200,000.00 / Cr 2601 200,000.00; Dr 3900 286,000.00 / Cr 3101 250,000.00, Cr 3201 36,000.00. 3900 = 0; TB 506,000.00 = 506,000.00 |
| G-28 | Cancel JO with ₱20,000 deposit → transfer to reissued JO | Dr 2201 (old JO) 20,000.00 / Cr 2201 (new JO) 20,000.00; no cash line |
| G-29 | Payroll run paid, then someone tries to cancel it | Blocked until the release is cancelled; after both mirrors, the run's piece assignments are unpaid again and the CA balance is restored |
| G-30 | Month in the life: G-01..G-24 in sequence on fixed dates | Expected TB committed in `tests/golden/month.tb.csv` |

## I3. Negative and control tests (must fail safely)
| # | Attempt | Expected |
|---|---|---|
| N-01 | Two users record collections at the same instant | Two consecutive numbers, no gap, no duplicate |
| N-02 | Double-click Record (same Idempotency-Key) | One document |
| N-03 | Client sends a date, number, total or VAT | 400, rejected by the strict schema |
| N-04 | Encoder posts a JV or backdates anything | 403 |
| N-05 | Encoder opens salary rates without `pay.view_rates` | Masked / 403 |
| N-06 | Encoder switches CR mode to system-numbered | 403; accountant needs sign-off fields + step-up |
| N-07 | 6 wrong passwords | Lockout 15 min; audit row |
| N-08 | Direct SQL UPDATE/DELETE on journal_lines or DELETE on any table | Trigger aborts |
| N-09 | Server clock set back one day | Posting blocked; fix screen shown |
| N-10 | Same manual invoice number twice, or out of booklet range | Rejected |
| N-11 | Piece assignment already paid appears in a new run | Not included |
| N-12 | Print title contains "Invoice" or "Official Receipt" | CI check fails |
| N-13 | Attachment URL opened without a session | 401 |
| N-14 | Collection clears AR with a "discount" | Not possible (no such field); needs a credit memo |
| N-15 | Restore of a backup made by a newer version | Refused with a plain message |

---

# J. The build week, the team of 4 AIs, and the switch-over

## J1. Team and lanes (revised 27 Sep: all 4 AIs build)
One private GitHub repository `moonproject`. Every AI works on its own branch and opens pull requests; nothing merges unless all automatic tests pass. On day 1, Claude #1 copies this plan into the repo as `docs/PLAN.md` and adds `AGENTS.md` and `CLAUDE.md` (the house rules: read `docs/PLAN.md` Parts B–D and your module's section; use the document engine; integer centavos; never edit another lane's folders; every money rule needs a golden test). Codex and Jules read `AGENTS.md` automatically.

| Who | Where it runs | Owns (modules, see B2) |
|---|---|---|
| **Claude #1: Core & Ledger** | This Claude project (repo attached in Project settings) | Day-1 skeleton and contracts (C3, C4), the platform, engine, ledger, numbering, audit, permissions, print base, installer/CI; **ACC, TAX, CASH, EQ, LOAN, FA, AP, EXP, SEC, AUD, BAK, MIG-02** (opening balances); financial statements and books. **Merges every PR** after review |
| **Claude #2: Sales, Production & Payroll** | Your second Claude account, in Claude Code on the web (claude.ai/code), connected to the same repo | Web shell, login, first-run wizard, generic list/form/view screens; **JO, COL, QS, PRD, RATE, EMP, PAY, CA, STAT**; sales/production/payroll reports |
| **ChatGPT (Codex): Customers, Reports & Screens** | chatgpt.com/codex, connected to the repo | **CUS, CAT, QUO, DASH, CAL, NAV, COM, PRN** print templates (H4), the report screens of G that read from ready-made engine queries, TV board |
| **Gemini (Jules): Purchasing, Import & Guides** | jules.google.com, connected to the repo | **PUR** (suppliers, supplies, PO, receiving), **INV** count sheets, **SZR**, **MIG-01** importer with the owner review screen, seed/demo data tool, **owner guides** (`docs/owner-guide/`, plain English with screenshots) |
| **Owner** | Browser | Starts each Codex/Jules task with the starter prompt (J6), pastes review results, answers Part K, test days |
| **Accountant** | — | ACC decisions; signs off the opening TB; settles disagreements |

**Money rule:** any code that creates journal entries (`*.posting.ts`, `compute`) is written or rewritten by Claude #1 or Claude #2 only. Codex and Jules build screens, reports, prints and imports around them, never posting rules.

**Review pairs (every PR gets one reviewer besides the tests):** Claude #1 reviews all money code and all of Claude #2's PRs · Claude #2 reviews Codex's PRs · Codex reviews Jules's PRs · Jules reviews Claude #1's non-money PRs (security, installer, backup) as a second pair of eyes. The review is a PR comment with findings in the format `ID | severity | file | expected | actual`.

## J2. Day by day (10 days)
| Day | Claude #1 | Claude #2 | Codex (ChatGPT) | Jules (Gemini) |
|---|---|---|---|---|
| 0 | Owner creates the repo on github.com, adds it in Project settings, connects Codex and Jules to it | | | |
| 1 | Skeleton, contracts frozen by midday, DB + triggers, engine, auth, **reference module Fund Transfer**, `docs/PLAN.md`, `AGENTS.md` | Web shell, login, generic list/form/view, confirm dialog | (waits for the contract freeze) Reads PLAN, drafts CUS screens on a branch | (waits) Reads PLAN, drafts the importer's parsing of the Apps Script sheet columns (no real data in the repo) |
| 2 | COA, JV, CASH, EQ, EXP; first Windows package + smoke | CUS integration review; JO (roster, stages) | CUS (groups, people, measurement revisions), CAT | PUR suppliers + supplies catalogue |
| 3 | AP, TAX registers + booklets, LOAN | COL, QS, release + invoice record | QUO; print templates for QUO/JO/release | PO + receiving; INV count sheets |
| 4 | FA + depreciation; backup pipeline; local HTTPS | PRD + RATE (+ rate seed) | DASH role homes, notifications | MIG-01 importer (stage → validate → review → dry run → commit) |
| 5 | Financial statements, books layouts, audit viewer, integrity centre | EMP, attendance, holidays | Report screens for sales/AR/AP/cash | SZR; seed/demo tool |
| 6 | MIG-02 opening balances wizard | PAY (runs, statutory, CA, release, payslips) | CAL, global search, TV board | Owner guides (install, backup, restore, daily use) |
| 7 | System Health, restore drill, update/rollback; review fixes | CA, STAT lists; review fixes | Remaining prints (H4), COM emails; review fixes | Import rehearsal with the real sheet on the shop PC; fixes |
| 8 | **Test day 1** (shop day simulation with staff on the practice database; stopwatch the H5 targets; real printers) — everyone fixes their own modules | | | |
| 9 | **Test day 2** (accountant reviews reports, registers, opening-balance dry run; golden month + blind recompute agree) | | | |
| 10 | Release candidate; restore drill on the shop PC; decisions "before go-live" closed | | | |
| then | Side-by-side run 1–2 weeks, then the switch-over (J4) | | | |

Install on the shop PC in practice mode as early as day 2 (Claude #1's first Windows package), so printers, LAN and devices are sorted out long before the test days.

## J3. Saving usage, and the cut line
- **One task = one module or one screen.** Each AI reads only `AGENTS.md`, Parts B–D of `docs/PLAN.md` and its module's section, never this long chat.
- Claude #1 and #2 work in fresh, short sessions per module; no multi-agent runs.
- If an AI runs out of its weekly allowance, its next unstarted module moves to whoever has room (the lanes are folders, so any AI can pick one up).
- **Dropped first if time runs short** (moved into the side-by-side weeks): TV board → calendar → customer emails → bank reconciliation screen → cash flow statement → SLSP/QAP export files → 2307 print → sizer tracker → global search → payslip email → owner "health of the business" page.
- **Never dropped:** accounting correctness (Part D + goldens), cancel/reissue and no-delete, audit, permissions and login security, backups and restore, the opening-balance wizard, the importer, payroll statutory math.

## J4. Switch-over (cut-over) plan
**Prerequisites:** all three owners agree the date (CO-01); accountant confirmations ACC-01..04, 06, 10 recorded; Must tier done; restore drill passed; test prints approved; recovery keys stored.
**Cut-over day (a quiet day, e.g. a Sunday):**
1. Freeze the old apps (no new entries after closing time the day before).
2. Fresh export of the Apps Script sheet → importer (stage, validate, owner review, dry run, commit). Verify counts and checksums.
3. Opening-balances wizard (D8): cash counts and bank balances as of the cut-over date; open job orders checklist; AP, loans, CA, officers, assets, inventory count, VAT/CWT carry-overs; equity → 3900 = 0; accountant signs the opening TB.
4. Re-create in-production orders as live JOs with remaining steps.
5. Make the old apps read-only (turn off the Apps Script web deployment; VERSION 2 stopped, its DB archived read-only).
6. First real transactions; end-of-day cash count in the new system.
**Rollback criteria (first 3 days):** if the TB or cash cannot be reconciled, or a posting defect with money impact is found and not fixed within a day, pause the new system, keep paper records, fix, and re-run the opening from the saved import (the importer is re-runnable).

## J5. Owner's checklist (data to gather during the week)
- Server PC details (Windows 10/11, Home/Pro, RAM, SSD), UPS model, router (for a fixed LAN IP), printers (A4 model; thermal 58/80 mm?).
- Company registration data (registered name, TIN + branch code, RDO, address), logo.
- ATP booklets on hand: sales invoice booklets (ATP no., serial ranges, next unused number), any CR/OR booklets.
- Bank/GCash balances and statements at the cut-over date; cash count.
- Employee list confirmation: pay type, rate, pay group, government IDs, who has SSS/PhilHealth/Pag-IBIG/WTax ticked.
- Piece-rate table confirmation (the 49-row seed; conflicting rates).
- Open orders status (the 52 old orders frozen at "Cutting", the 5 released with a balance, deposits held).
- Loans (lenders, principal, terms), equipment list (dates, cost), supplier TINs and VAT status, landlord's VAT status and the rent contract.

## J6. Starter prompts (the owner copies these)
**Claude #2 (Claude Code on the web, second account), first task:**
> You are Builder "Claude #2: Sales, Production & Payroll" for the Moonproject in the `moonproject` repository. Read `AGENTS.md`, then `docs/PLAN.md` Parts B, C, D and E4–E7 and E11, and F. Today's task: [module, e.g. "JO – Job Orders & Release"]. Work only in your lane's folders, follow the document engine contract, write golden tests for every posting, keep the PR under about 800 lines, and open a pull request titled "[JO] ..." when all tests pass.

**Codex (ChatGPT), each task:**
> Repository `moonproject`. Read `AGENTS.md` and `docs/PLAN.md` Parts B, C, H and the section for [module, e.g. "E1 Customers & Measurements (CUS)"]. Build only that module in `apps/server/src/modules/CUS/` and `apps/web/src/modules/CUS/`, using the generic screens and the document engine. Do not write or change any posting rules (`*.posting.ts`). Add tests. Open a pull request titled "[CUS] ...". If a contract seems to be missing, say so in the PR instead of changing shared files.

**Jules (Gemini), each task:**
> Repository `moonproject`. Read `AGENTS.md` and `docs/PLAN.md` Parts B, C, H and the section for [module, e.g. "E9 Suppliers & Purchasing (PUR)"]. Build only that module in its own folders, using the generic screens and the document engine. Do not write or change posting rules or shared contracts. Never commit real customer or employee data; use made-up examples. Add tests and open a pull request titled "[PUR] ...".

**Review request (paste into the reviewing AI):**
> Review pull request #[n] in `moonproject` against `docs/PLAN.md` (Parts B1, D and the module's section) and `AGENTS.md`. List findings as `ID | severity (blocker/major/minor) | file | expected | actual`. Blockers: any money movement without a journal, any delete or in-place edit of posted data, client-sent totals/dates trusted, a print titled Invoice or Official Receipt, a missing permission check.

---

# K. Decision register
Each item has a DEFAULT the build uses until answered. "When" = latest point the answer is needed.

## K1. Accountant (ACC)
| ID | Question | Default | When |
|---|---|---|---|
| ACC-01 | When is a sale and receivable booked: at the manual invoice record, required at release (option B)? | B | Before go-live |
| ACC-02 | Downpayment VAT: A deposit only, B VAT on deposit, or C a manual invoice for each downpayment? | A | Before go-live |
| ACC-03 | May the ERP print its own system-numbered COLLECTION RECEIPT without registration, or must CRs come from an ATP booklet? Exact legend and required CR fields? Are leftover ORs used as supplementary receipts? | Booklet mode | Before go-live |
| ACC-04 | Books: manual books transcribed from ERP reports, or loose-leaf (PTU) printed from the ERP? Which books are registered now? ERP stays unregistered (not CAS)? | ERP unregistered; loose-leaf layouts available | Before go-live |
| ACC-05 | Past months with no SSS/PhilHealth/Pag-IBIG/WTax: catch-up method, who bears employee shares, PhilHealth interest waiver (open until 31 Dec 2026) | Exposure report only; no automatic catch-up | Before Dec 2026 |
| ACC-06 | Is Virtus a published Top Withholding Agent? Which EWT applies (rent 5%, contractors/printers 2%, professional fees)? Is the landlord VAT-registered, and is ₱40,000 gross? Accountant/notary: individual or firm? | Rent 5%, contractors 2%, professional 10% without sworn declaration; not TWA | Before go-live |
| ACC-06b | Piece workers earning below the minimum wage for days worked: add a top-up line automatically? | Warn only | Before first payroll |
| ACC-07 | Made-to-order garments: goods or services (affects the customer's 1%/2% CWT and ACC-02)? | Goods for CWT expectation; CWT typed as actually withheld | Before go-live |
| ACC-08 | Wrong manual invoice procedure and credit memo form (ATP booklet or ERP form)? | Cancel with all copies kept + replacement; CM by accountant | Before go-live |
| ACC-09 | Reversal date when a document from a filed period is cancelled: cancel date or original date? | Cancel date + filed-period warning | Before go-live |
| ACC-10 | Classification of owner money (VERSION 2's ₱164,168; the Apps Script's hardcoded ₱500,000; each co-owner's injections): shares, deposit for subscription (FRB 6 conditions), or stockholder advances? | Advances from stockholders (2501) until classified | At cut-over |
| ACC-11 | Does taking orders/payments online make Virtus an "e-commerce" taxpayer under RMC 98-2026 (e-invoicing by 31 Dec 2026)? Taxpayer class on BIR records (micro/small)? eFPS or eBIRForms? | Not e-commerce; small | Now (deadline 31 Dec 2026) |
| ACC-12 | Numbering continuous (never reset yearly)? | Continuous | Before go-live |
| ACC-13 | Inventory count frequency (monthly/yearly) and cost basis (latest cost/weighted average)? | Monthly count, latest purchase cost | Before first month-end |
| ACC-14 | Refund of a deposit that had CWT: refund cash part and keep the credit, or refund gross? | Refund cash part; flag | Before go-live |
| ACC-15 | Forfeited deposits: other income; VATable, needing an invoice? | Other income, not VATable, flagged | Before go-live |
| ACC-16 | Depreciation policy per class (method, lives, residual); production equipment to cost of sales? | Straight-line; lives in E10; production → 5302 | Before first month-end |
| ACC-17 | Framework (PFRS for Small Entities?) and fiscal year | PFRS for SEs, calendar year | Before go-live |
| ACC-18 | 13th month: accrue every run, or expense when paid? | Accrue every run | Before first payroll |
| ACC-19 | Cost centres: production labor to cost of sales, office to admin? | Yes | Before first payroll |
| ACC-20 | Payroll in two steps (run = accrual, release = payment)? | Two steps | Before first payroll |
| ACC-21 | Statutory deductions: incremental month-to-date true-up each run; contribution month = period end? | Yes | Before first payroll |
| ACC-22 | Corrections after a 2550Q/1601-EQ is filed: warning marker enough (no lock, per owner)? | Warning + "changes after filing" report | Before go-live |
| ACC-23 | Post-dated checks: record when the check date arrives (memo list until then)? | Yes | Before go-live |
| ACC-24 | Any government customers (5% VAT withholding)? | Supported; none assumed | Before go-live |
| ACC-25 | SLSP submission format/threshold; SAWT preparation | Registers + CSV data | First quarter-end |

## K2. Owner (OWN)
| ID | Question | Default | When |
|---|---|---|---|
| OWN-01 | Remote access: NetBird free, Cloudflare Zero Trust free, or Tailscale Standard paid (remote users only)? Who needs remote access? | NetBird free | Before go-live |
| OWN-02 | Server PC, UPS, router, printers (see J5) | — | Day 2 |
| OWN-03 | Google account for off-site backups; who holds recovery keys A and B | Company Google account; owner + one co-owner | Day 2 |
| OWN-04 | Payment terms list and Terms & Conditions text on quotations/JOs (old: mock-up approval, ±1.5 cm tolerance, 50% non-refundable downpayment, full payment before release, 7-day defect returns) | Keep the old four clauses | Day 3 |
| OWN-05 | Piece-rate seed (49 rows): polo ₱60 or ₱70? NBA jersey ₱70 or ₱75? sublimated t-shirt ₱40 or ₱45? "Scrubsuit" = top only or top + pants? blouse ₱140? | Latest paid rate | Before first payroll |
| OWN-06 | Each employee's daily rate vs the ₱550 Silang minimum; the monthly salary (₱15,000?) | Rates from payroll history, flagged | Before first payroll |
| OWN-07 | SSS/PhilHealth/Pag-IBIG/WTax ticked for everyone? Any legitimate exception? Government IDs | ON for all; untick needs a reason | Before first payroll |
| OWN-08 | Pay groups, periods and pay days (weekly piece Mon–Sat paid Saturday? semi-monthly 15th/30th?) | As F2 | Before first payroll |
| OWN-09 | Cash advance policy: default instalment, minimum net pay, written authorization on file | Instalment typed per CA; minimum net ₱0 warning | Before first payroll |
| OWN-10 | Partial releases (some wearers first) allowed? | Yes | Day 3 |
| OWN-11 | Customer emails (created, ready, claimed, statement): on or off? Sender address? | Off until configured | Later |
| OWN-12 | What encoders see: bank/GCash balances, payroll, sales totals | Cash on hand/petty cash only; no payroll; no sales totals | Day 1 |
| OWN-13 | HTTPS via an app certificate installed once per device | Yes | Day 2 |
| OWN-14 | Passwords: 15+ character passphrases, no forced expiry | Yes | Day 1 |
| OWN-15 | Which customer/group do the 84 "MANUAL" measurement rows (5 batches) belong to? | Owner assigns on the import review screen | Before import |
| OWN-16 | Merge the 3 duplicate customer pairs? Which email is current for the pair with two? | Merge after review | Before import |
| OWN-17 | Status of the 52 old orders frozen at "Cutting" and the 5 released with a balance (₱306,890 open; are they collectible? invoiced?) | Owner/accountant tick per row in the opening checklist | Cut-over |
| OWN-18 | How to settle the old ₱3,900 cash-advance mismatch across 7 employees | Settle per employee before cut-over | Cut-over |
| OWN-19 | Keep the sizer tracker? Commissions paid to anyone? Collect birthdays for greetings? | Sizer later; no commissions; birthdays optional | Later |
| OWN-20 | University (15 department records) and hospital (2): one customer with departments as groups, or separate customers linked to a parent? | Parent + child customers (departments pay separately), groups inside | Before import |
| OWN-21 | JO fields editable without reissue (due date, priority, notes, route, attachments, roster corrections keeping quantities) | As listed | Day 2 |
| OWN-22 | Who may release goods with an unpaid balance? | Owner and accountant | Day 3 |
| OWN-23 | Purchase orders editable until first receiving | Yes | Day 3 |
| OWN-24 | Add a Quality Check step? | No (off) | Day 3 |
| OWN-25 | Rework ("pasubra"): paid? at what rate? | Paid at a rework rate typed per entry | Before first payroll |
| OWN-26 | Who may override a piece rate? | Encoders (logged with reason) | Day 3 |
| OWN-27 | Cash balances visible to encoders | See OWN-12 | Day 2 |
| OWN-28 | Are any of the 4–5 "Board Member" records on payroll (salary) or paid directors' fees? | Not on payroll | Before first payroll |
| OWN-29 | Local Cavite/Silang special days to add to the holiday calendar | National list only | Before first payroll |
| OWN-30 | Which bank accounts print on quotations/statements (company accounts only)? | Company BDO/China Bank/GCash only | Day 2 |
| OWN-31 | Import VERSION 2 transaction history? | No: master data from the Apps Script sheet only; VERSION 2 archived read-only | Now |

## K3. Co-owners (CO)
| ID | Question | Default | When |
|---|---|---|---|
| CO-01 | One switch-over date agreed by all three owners; old apps read-only after it | Proposed: the Sunday after the second test day, then side-by-side 1–2 weeks | Before test days |
| CO-02 | Who gets the Owner role (all three owners; nobody else) | The three owners | Day 1 |
| CO-03 | How each owner's past money into the company was made (for ACC-10) | — | Cut-over |

---

# L. Risks
| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R-01 | Scope too big for the build days, or an AI runs out of weekly usage | High | Some Should items late | One document engine; generic UI; strict lanes; cut line J3; lanes are folders, so another AI can take over a module; side-by-side weeks absorb Should items |
| R-02 | Wrong accounting slips through because builders write both code and tests | Medium | High | Goldens from this plan's worked examples; property tests; blind recompute by two independent reviewers; accountant sign-off of the scenario TB |
| R-03 | Accountant decisions arrive late (ACC-01..03) | Medium | Medium | Defaults are safe (booklet CR, deposit-only, invoice at release); settings switch without code changes |
| R-04 | Staff keep using the old apps | High | High | CO-01 agreement; old apps made read-only on cut-over day |
| R-05 | Import data quality (duplicates, MANUAL measurements, frozen orders) | High | Medium | Staged importer with owner review, dry run and checksums; re-runnable |
| R-06 | Shop PC failure or power loss | Medium | High | UPS, SSD, automatic encrypted off-site backups, USB kit, 2–3 h recovery drill |
| R-07 | Lost recovery keys → backups unreadable | Low | Very high | Two keys, printed + USB, typed back at setup, quarterly drill |
| R-08 | Wrong PC clock dates documents wrongly | Low | Medium | Time sync setup; clock guard blocks posting; date banner |
| R-09 | Remote-access licence or free-plan changes | Medium | Low | VPN-neutral design; switch in about 1 hour |
| R-10 | BIR position on system-printed receipts or e-invoicing differs | Medium | Medium | ERP never issues invoices; CR booklet default; accountant/RDO confirmation before switching |
| R-11 | Statutory arrears/penalties surface when deductions start | High | Medium (money) | Exposure report; accountant plan (ACC-05); PhilHealth waiver before 31 Dec 2026 |
| R-12 | Unsigned Setup.exe triggers Windows SmartScreen warnings; certificate trust on phones | High | Low | Illustrated owner guide; optional code signing later |
| R-13 | Windows 10 end of free updates (12 Oct 2027) | Certain | Medium | Health card turns amber from Apr 2027; budget a Windows 11 PC |
| R-14 | Personal data exposure (Data Privacy Act) | Low | High | Encrypted backups; no personal data in logs/packs; permissions on IDs and salaries |

---

# M. Where the details live (source index)
| Need | File (under `/mnt/project-files/`) |
|---|---|
| Agreed requirements (binding) | `plan/00-brief.md` |
| Full UX spec: menus, 22 widgets, 44 messages, 66-term glossary, 27 prints with fields, speed/accessibility | `plan/design/ux-conventions.md` |
| Full architecture ADRs (49), security, TLS, backup, update, CI details, Day-0 skeleton checklist | `plan/design/proposals/arch-ops.md` |
| Chart of accounts detail, 33-rule posting rulebook, recognition options, engine rules, cut-over | `plan/research/v2-finance-accounting.md` §14–18 |
| VAT/CWT/EWT rules table R01–R51, rounding, 22 edge cases, forms and deadlines | `plan/research/vat-cwt-ewt.md` |
| BIR invoicing, receipts, CAS/registration, books, retention, e-invoicing | `plan/research/bir-invoicing-books.md` |
| Payroll: 61-row SSS table, WTax tables, holidays 2026, minimum wages, worked examples A/B/C/C2 with journals | `plan/research/payroll-ph-2026.md` |
| Hosting on Windows, Tailscale/VPN terms, SQLite, backups, printing, clock | `plan/research/deployment-windows-tailscale.md` |
| Every old feature (265 rows) mapped to the 34 modules, print map, report catalogue, dropped items | `plan/research/feature-inventory.md` |
| Import profile: field mappings, cleansing rules, 49-row piece-rate seed, routes, opening AR figures, checksums | `plan/research/migration-profile.md` |
| How the old apps worked and their defects (with line numbers) | `plan/research/appscript-flows.md`, `v2-sales-production.md`, `v2-finance-accounting.md`, `v2-hr-payroll-admin.md` |
| Uploaded files and what each is | `.notes/inputs.md` |

---

# N. Review log (27 Sep 2026)
One combined review of this plan, in this order:
1. **Accounting correctness.** Every worked example and golden (G-01..G-27) was recomputed by script: all journals balance to the centavo, and the VAT, withholding and rounding figures match D4 (e.g. ₱999.00 → VAT 107.04; rent ₱40,000 → VAT 4,285.71, EWT 1,785.71). Fixed: the deposit application rule for mode C; what happens when an invoice record or a collection is cancelled after deposits were applied (the balance due reopens instead of deposits going negative); payroll cancel after a remittance.
2. **Security.** Checked against every "never again" item (B1). Fixed: the passphrase length now matches the research (15+); the local certificate's fingerprint is shown on the server so devices do not trust a fake one.
3. **Ease of use for staff.** Checked the flows against the speed targets and the words staff use. Added: the owner summary now says every sale and release needs a booklet invoice number (a habit change); shop terms in brackets on labels.
Not done in this review (by the owner's choice to save usage): separate multi-agent stress tests by lens. ChatGPT and Gemini are asked to review Part D and Part I before building starts (J2, day 1 evening).
