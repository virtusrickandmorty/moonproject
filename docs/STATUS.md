# Build status

| Day | Lane | Done | Notes |
|---|---|---|---|
| 1 | Claude #1 | Repo skeleton; SQLite rules (no delete, immutable journals and posted documents, gapless numbering); chart of accounts seed (PLAN D2); ledger post/reverse/balances/trial balance; engine invariants L1–L4, L7, L12; hash-chained audit; idempotency; document engine (preview, post, cancel, reissue, drafts); login, sessions, CSRF, rate limits, step-up, users and role grid; reference module **CASH: Fund Transfer** with golden G-17, cancel/reissue and property tests; `AGENTS.md`; CI | Local HTTPS, Windows service and backups come on days 2–4 (PLAN J2) |
| 2 | Claude #1 | **ACC:** effective-dated settings (`engine/settings.ts`: VAT rate, deposit VAT mode, CR mode with sign-off, TWA; step-up, today or later); chart-of-accounts API (add, rename, reserve, deactivate only without role or balance, DB triggers keep code/type/role fixed); **Journal Voucher** (accountant only, any postable account, party rules, late entry with reason when backdated). Seed fix: 7100–7103 other income are revenue | Not yet: auto-reversing JV, filed-period warning, attachments, cash places created from the Cash Accounts screen |
| 2–3 | Claude #2 | **WEB** shell and generic list/form/view screens; **JO** job orders (roster, stages, release slip REL-, invoice record IR- with engine `afterCancel`); **COL** collections, refunds (RFD-), deposit transfer (DXF-, G-28); **QS** quick sale and collection screens | Deposit VAT mode A only (B and C refused). Booklet register check waits for TAX |
| 3–4 | Codex | **CUS** customers and measurements; **CAT** catalog; **QUO** quotations; their public helpers and screens (#21); **MIG** importer: stage, validate, review, dry run (#22, took over Jules's #14) | Importer commit step and opening balances (ACC) not yet |
| 3–4 | Jules | **PUR** suppliers, supplies, purchase orders and receiving (PO-, RR-; posting-free; property tests by Codex #20); **SZR** sizer tracker (server) | Supplier bills and payments are AP (Claude #1) |
| 4–5 | Claude #2 | **PRD** production entries (PE-, no journal) and **RATE** piece rates; **EMP** employees, pay profiles, attendance, holidays, SIL (#23) | Rehire, attendance lock after payroll, SIL conversion not yet |
| 5 | Claude #2 | **PAY** payroll runs (PAY-, F1 statutory tables, month-to-date true-up, 13th-month accrual), releases (POUT-), payslips; **CA** cash advances (CA-) (#24) | STAT remittances and reports, CA repayment/write-off, 13th-month payout, year-end tax, loan deductions not yet |
| 5 | Claude #1 | Engine: `journal(doc, ctx, header?)` gets the posted document's id, number and date (QS no longer reads its own row back). PLAN D7 rows for IR-, RFD-, DXF-, PE-; G-24 with the 13th-month accrual; payroll examples for G-25 in `docs/research/payroll-examples.md` | Next: CASH extras, EQ, EXP, AP, TAX, LOAN, FA, backups and installer |

## Engine decisions made on day 1 (defaults, change by PR if the accountant disagrees)
- Cash places are GL accounts flagged `is_cash_place`; the account itself identifies the place, so cash lines carry no party.
- Every document gets an internal gapless number from its series. Booklet numbers (sales invoice, CR) will be stored in `documents.external_number` and checked against the booklet register (TAX, day 3).
- Journal numbers are `JE-YYYY-NNNNNN`, one series per year (PLAN D7).
- Cancel reversals are dated the cancel date (ACC-09 default).
- `stages` (for JO) is not in the engine yet. Effective-dated settings arrived on day 2 (`engine/settings.ts`).
