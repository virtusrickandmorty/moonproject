# Build status

Updated 29 Sep 2026 from main at e87e460e533977c4ed64077382da43bee2974b42

This page says, in plain English, what is built on `main` today and what is still open before go-live. It was rewritten from the code on `main`, `docs/PLAN.md` (B3 and B4), `docs/review/posting-coverage.md`, `docs/owner-guide/README.md` and the "STATUS" lines of the merged pull requests. Where a fact could not be read from those, it says "not checked".

How to read the module table:
- **Tier** is from PLAN B3. "Not named" means B3 does not list the module in Must, Should or Later; it still ships in a basic form (B3, first line).
- **Document types** are the ones registered in the module's `doctypes` folder. "none" means the module posts and records nothing of its own (settings, registers and reports only). A type marked *(no journal)* records a document but posts no money.
- **Screens** = the module has a folder in `apps/web/src/modules/`. Screens for a module that has none of its own may still exist as generic screens (list, form, view) from the web shell.
- **Posting tests** = golden and cancel tests of the journal, as mapped in `docs/review/posting-coverage.md` (checked 29 Sep 2026 at 9406f50; commits on `main` after that were not re-checked for posting tests). "n/a" = the module posts nothing.
- **Guide** = a file in `docs/owner-guide/` on `main`. "open PR" = written but not merged yet. "none" = no guide file on `main` and no open PR found for it.

## 1. Modules

| Code | Tier (B3) | Document types | Screens | Posting tests | Owner guide | Still missing |
|---|---|---|---|---|---|---|
| PLT | Must | none (platform code in `apps/server/src/platform`) | yes (health dot, System health, practice shop) | n/a | 14 Installing, 10 Joining a device, 20 Practice shop, 25 System health | Code signing of Setup.exe (R-12). Not on real hardware yet: only the Windows CI machine has run the installer, update, watchdog and practice shop |
| SEC | Must | none | yes (users, roles, shop certificate) | n/a | 10 Joining a phone or PC covers the certificate; users and roles guide is an open PR (#153) | Permission matrix test: not checked |
| AUD | Must | none | yes (audit log, integrity check) | n/a | open PR (#96, with calendar) | Nightly checks and other control reports were noted as next in the PR (#82); not checked whether they were added later |
| BAK | Must | none | yes (backups, recovery keys, restore) | n/a | 11 Backups, 12 Restore | Restore drill on the shop PC not done (section 3). Notice to all owners on a restore: not checked |
| MIG | Must | none (importer stages, validates and commits; posts nothing itself) | yes (upload, review, finish) | n/a | open PR (#132) | Import rehearsal not done (section 3). Opening balances are in ACC, not here |
| CUS | Must | none | yes | n/a | 01 New customer and measurements | Not checked: size presets, tax profile |
| CAT | Not named | none | yes | n/a | none | Price list screens came with QUO (#151) |
| QUO | Must | quo.quotation *(no journal)* | yes (price list, quotation form and view) | n/a | none | Job order from a quotation was added (#158). Quotation attachments: not checked |
| JO | Must | jo.job_order *(no journal)*, jo.release *(no journal)*, jo.invoice_record, jo.dp_invoice, jo.opening | yes | yes (G-01, G-02, G-04, G-05, G-09, G-10) | 02 Job order, 03 Release and invoice; a newer guide for the new screens is an open PR (#157) | Progress billing is Later and not built |
| COL | Must | col.collection, col.refund, col.deposit_transfer, col.cwt_only, col.forfeit, col.credit_memo, col.write_off | yes | yes (G-03, G-06, G-07, G-09, G-11, G-12, G-28). Deposit VAT modes B and C: G-04, G-05 | 04 Collection, 27 Credits and write-offs | Bad-debt allowance method (account 1209) not built. Customer statements and AR aging are in RPT |
| QS | Must | qs.sale | yes | yes (G-08) | 05 Quick sale | None found |
| PRD | Must | prd.entry *(no journal)* | yes (entry form, board, TV board) | n/a | none | Rework and job ticket print: not checked |
| RATE | Must | none | yes | n/a | none | None found |
| PUR | Must | pur.po *(no journal)*, pur.rr *(no journal)* | yes (suppliers, supplies, PO, receiving) | yes, "posts nothing" test for receiving (RCV) | 30 Suppliers and purchase orders | Keeping the catalogue's last purchase cost up to date: not built (per the day-7 note) |
| AP | Must | ap.bill, ap.payment, ap.advance, ap.advance_return, ap.opening | yes | yes (G-15, BILL-POST, RENT-ACCR, SUP-ADV, BILL-PAY) | 13 Bills and expenses | 2307 print for suppliers: not checked (see Should list) |
| EXP | Must | exp.voucher | yes | yes (G-13, G-14, G-16) | 13 Bills and expenses | Split tenders: noted as not built on day 5; not checked since |
| CASH | Must | cash.transfer, cash.count, cash.other_receipt, cash.bank_adj | yes (accounts, cash book, count, bank reconciliation) | yes (G-17, G-18) | 07 Cash accounts and count, 08 Cash book, 32 Bank reconciliation | Check deposits (B2 lists them): not checked |
| EQ | Must | eq.owner_money, eq.officer, eq.opening | yes (owners and officers register) | yes (G-19) | open PR (#152) | Dividend declaration (DIV) not built; the accountant can post it only as a journal voucher (Later tier) |
| LOAN | Must | loan.loan, loan.payment, loan.opening | yes | yes (G-20) | open PR (#152) | Not checked: guide 24 is about SSS and Pag-IBIG loans taken by employees (PAY), not this module |
| FA | Must | fa.buy, fa.depreciation, fa.disposal, fa.opening | yes | yes (G-21) | open PR (#152) | Sale of an asset is not built: only a retirement posts; a sale is refused with SALE_NEEDS_INVOICE |
| EMP | Must | none | yes (employees, attendance, holidays) | n/a | none | SIL and leave balances: SIL is on the employee record; a full leave balance screen is not checked. Rehire: not checked |
| PAY | Must | pay.run, pay.release, pay.thirteenth | yes (run, release, 13th month, year-end, loans, prior pay) | yes (G-23, G-24, G-25, G-29) | 06 Payroll, 23 13th-month pay, 24 Government loans, 28 Year-end tax and 2316 | Payslip email not built. Holiday premium automation beyond the basic rules is Later; not checked |
| CA | Must | ca.advance, ca.repayment, ca.writeoff, ca.opening | yes | yes (G-23; CA-GIVE) | 22 Cash advances | None found |
| STAT | Not named | stat.remittance, stat.opening | yes (lists, remittance, exposure report) | yes | 21 Government remittances; guide for the agency upload files is an open PR (#138) | Loan-amortization remittance lines (2404/2405) were noted as not built in #91; #106 later added loan deductions to the remittance check |
| ACC | Must | acc.jv, acc.opening | yes (chart of accounts, settings, opening balances, month-end checklist) | yes (JV, G-27) | 17 Opening balances, 33 Month-end checklist | Auto-reversing journal voucher, filed-period warning, attachments: not checked. Accountant sign-off of the opening trial balance not done (section 3) |
| TAX | Must | tax.vat_close, tax.bir_payment, tax.it_provision, tax.it_settlement, plus opening types (tax.opening, tax.payable.opening) | yes (registers, booklets, worksheets, calendar, income tax, SLSP and SAWT) | yes (G-26, VAT-PAY, EWT-REM, IT-QPAY, IT-PROV, IT-SETTLE) | 18 BIR payments, 29 VAT each quarter, 28 Year-end tax | Zero-rated and exempt sales, uncollected receivables, importations and purchases without VAT are not tracked (day-7 note; not checked since). The accountant confirms ATC codes per payee |
| RPT | Must | none | yes (books, statements, sales and collections, receivables, payroll and production, operations, BIR books) | n/a | 09 Books and reports, 16 Statements, 26 Sales and collections reports; reports and BIR books guide is an open PR (#156) | Cash flow statement not built (Should). Comparative columns not built. Statement of changes in equity not built (Later) |
| DASH | Must | none | yes (role homes) | n/a | none | Role homes and notifications are merged (#32); widgets beyond that: not checked |
| PRT | Must (PRN in B2) | none | yes (company print details) | n/a | none | Every print must be test-printed on the shop's printers (section 3). Prints exist for: quotation, job order, job ticket, release slip, purchase order, collection receipt, credit memo, payment voucher, expense voucher, fund transfer, cash count, journal voucher, payslip, cash advance slip, inventory count sheet |
| CAL | Should | none | yes | n/a | open PR (#96) | None found |
| SZR | Later | none | yes | n/a | none | Overdue list exists (server and screen); alerts beyond that: not checked |
| INV | Not named | inv.count | yes | yes (G-22) | 15 Inventory count | Weighted-average cost if the accountant picks it: not built |
| NAV | Should | none | yes (global search) | n/a | none | None found |

## 2. "Should" and "Later" items of PLAN B3

**Should** (target go-live, may land during the side-by-side run)

| Item | Built? | Note |
|---|---|---|
| TV board | built | PRD screens, and NAV #144 |
| Calendar | built | CAL |
| Customer emails | not built | No COM module on `main` |
| Bank reconciliation screen | built | CASH #121 |
| Cash flow statement | not built | Named as not yet in the RPT status line |
| 13th-month run screen | built | PAY 13th-month form |
| SLSP export file | built | TAX #125: SLSP and SAWT data with CSV |
| 2307 print for suppliers | not built | No such print in `PRT/print.ts`; the 2307 to issue list exists in TAX |
| Purchase orders print | built | "Purchase Order" print |
| Inventory count sheets print | built | "Inventory Count Sheet" print |
| Statutory exposure report | built | STAT #130 |
| Global search | built | NAV #144 |
| Payslip email | not built | The payslip prints; no email |
| SIL and leave balances | not checked | SIL for the year is shown on the employee record; a balance screen was not checked |

**Later** (after go-live)

| Item | Built? | Note |
|---|---|---|
| Sizer tracker alerts | not built | SZR shows lent sets and an overdue list; no alerts. Not checked in detail |
| Holiday premium automation beyond the basic rules | not checked | |
| Progress billing | not built | |
| RMC 65-2024 output-VAT relief worksheet | not built | |
| Charts | not built | |
| Management pack | not built | |
| E-mail statements in bulk | not built | No email in the code |

## 3. Go-live requirements (PLAN B4)

| Requirement | Who does it | Done? | Note |
|---|---|---|---|
| All Must items done | Claude #1 (checks the table in section 1) | not done | Gaps in section 1 marked "not checked" have not been cleared |
| Month-in-the-life golden scenario (G-30) | Claude #1 | done | `apps/server/test/month-in-the-life.test.ts` against `tests/golden/month.tb.csv` (#139); it now includes deposit VAT modes B and C, which were built after it (not re-checked here) |
| Blind recompute by ChatGPT and Gemini agrees to the centavo | Claude #1 sends the pack; ChatGPT and Gemini recompute | not done | The pack exists in `docs/review/blind-recompute/` and `npm run blind-pack`; no answers compared yet |
| Import rehearsal passes its count and checksum gates | the owner runs it with Claude #1 | not done | Importer and its screens are built; not rehearsed on the real old data |
| Restore drill succeeds on the shop PC | the owner | not done | Drill is built (BAK); not run on the shop PC |
| Every print test-printed on the shop's printers | the owner | not done | Prints are built (PRT) |
| Accountant signs off the opening trial balance | the accountant | not done | Opening balances built and not closed on real data |
| Accountant signs off the decisions marked "before go-live" in PLAN Part K | the accountant | not done | Not checked one by one |
| Module review packs checked by ChatGPT and Gemini, accepted findings fixed (B4, per module) | Claude #1 | not checked | |
| Each module has posting goldens and property tests passing | Claude #1 | done for every posting document type | See `docs/review/posting-coverage.md`. Not built: DIV, the sale half of FA-DISP, the allowance method of bad debt |
| Each module's owner guide | Jules | not done | Missing or only in an open PR: see the Guide column |
| End-to-end browser tests | Claude #2 | done | `e2e/` (first run, sales, quick sale, payroll, backups) |

## Engine decisions made on day 1 (defaults, change by PR if the accountant disagrees)
- Cash places are GL accounts flagged `is_cash_place`; the account itself identifies the place, so cash lines carry no party.
- Every document gets an internal gapless number from its series. Booklet numbers (sales invoice, CR) are stored by the module that takes them (JO, QS, COL) and checked in its `validate` against the TAX booklet register (TAX/public.ts `bookletIssue`); no engine hook was needed.
- Journal numbers are `JE-YYYY-NNNNNN`, one series per year (PLAN D7).
- Cancel reversals are dated the cancel date (ACC-09 default). A document that states a balance as of its own date (OB- opening balances, INVC- inventory counts) is mirrored on that date instead (`cancelOn: 'document_date'`), which needs `acc.backdate`, so an edit replaces it exactly.
