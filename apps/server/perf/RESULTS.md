# Timings on three busy years: before and after

Every list and report of `npm run perf`, on the database `npm run perf-data` builds with the default seed (25,000 job orders, about
40,000 collections, 6,000 customers, 30 employees, 1 Jan 2026 to 31 Dec 2028); month = December 2028, year = 2028. One PC, first
answer of each request. "Before" is `main` at dc00ebe with the screens asking for every row; "after" is this pull request with the
screens asking a page at a time (`?limit=100`, or 5 loose pages for the BIR books). "not finished": the month took over 20 seconds, so the
year was not tried (or, for a CSV file, the run was stopped after half an hour).

| Screen | Scope | Before | After | Limit |
|---|---|---:|---:|---:|
| RPT collections register | month | 70 ms | 42 ms | 2 s |
| RPT collections register | year | 352 ms | 145 ms | 5 s |
| RPT sales by period | month | 246 ms | 234 ms | 2 s |
| RPT sales by period | year | 470 ms | 405 ms | 5 s |
| RPT deposits held | month | 304 ms | 270 ms | 2 s |
| RPT deposits held | year | 287 ms | 146 ms | 5 s |
| RPT AR aging | month | 957 ms | 771 ms | 2 s |
| RPT AR aging | year | 999 ms | 710 ms | 5 s |
| RPT job order follow-up | list | 26 s | 1.1 s | 2 s |
| RPT customers | list | 11 ms | 19 ms | 2 s |
| RPT customer statement | month | 11 ms | 25 ms | 2 s |
| RPT customer statement | year | 6 ms | 22 ms | 5 s |
| RPT accounts | list | 1 ms | 2 ms | 2 s |
| RPT general journal | month | 335 ms | 57 ms | 2 s |
| RPT general journal | year | 3.8 s | 784 ms | 5 s |
| RPT general ledger (one account) | month | 451 ms | 330 ms | 2 s |
| RPT general ledger (one account) | year | 1.2 s | 533 ms | 5 s |
| RPT general ledger (all accounts) | month | 1.4 s | 211 ms | 2 s |
| RPT general ledger (all accounts) | year | 4.1 s | 597 ms | 5 s |
| RPT trial balance | month | 289 ms | 494 ms | 2 s |
| RPT trial balance | year | 244 ms | 398 ms | 5 s |
| RPT income statement | month | 689 ms | 10 ms | 2 s |
| RPT income statement | year | 607 ms | 60 ms | 5 s |
| RPT income statement vs last year | month | 1.2 s | 12 ms | 2 s |
| RPT income statement vs last year | year | 1.5 s | 116 ms | 5 s |
| RPT balance sheet | month | 2.2 s | 286 ms | 2 s |
| RPT balance sheet | year | 2.1 s | 284 ms | 5 s |
| RPT cash flow | month | 240 ms | 195 ms | 2 s |
| RPT cash flow | year | 386 ms | 333 ms | 5 s |
| RPT AP aging | month | 19 ms | 15 ms | 2 s |
| RPT AP aging | year | 15 ms | 10 ms | 5 s |
| RPT purchases | month | 123 ms | 99 ms | 2 s |
| RPT purchases | year | 135 ms | 119 ms | 5 s |
| RPT purchase orders | list | 2 ms | 1 ms | 2 s |
| RPT received not billed | list | 1 ms | 1 ms | 2 s |
| RPT cash position | month | 76 ms | 60 ms | 2 s |
| RPT cash position | year | 72 ms | 62 ms | 5 s |
| RPT transfers | month | 3 ms | 4 ms | 2 s |
| RPT transfers | year | 2 ms | 2 ms | 5 s |
| RPT cash counts | month | 1 ms | 1 ms | 2 s |
| RPT cash counts | year | 1 ms | 1 ms | 5 s |
| RPT fixed assets | month | 31 ms | 39 ms | 2 s |
| RPT fixed assets | year | 31 ms | 39 ms | 5 s |
| RPT late entries | list | 1 ms | 2 ms | 2 s |
| RPT cancellations | list | 26 ms | 32 ms | 2 s |
| RPT exceptions | month | 374 ms | 545 ms | 2 s |
| RPT exceptions | year | 391 ms | 622 ms | 5 s |
| RPT sign-ins | month | 3 ms | 4 ms | 2 s |
| RPT sign-ins | year | 8 ms | 5 ms | 5 s |
| RPT BIR book cash-receipts | month | 278 ms | 79 ms | 2 s |
| RPT BIR book cash-receipts | year | 2.1 s | 1.8 s | 5 s |
| RPT BIR book cash-disbursements | month | 196 ms | 60 ms | 2 s |
| RPT BIR book cash-disbursements | year | 1.1 s | 969 ms | 5 s |
| RPT BIR book sales | month | 119 s | 125 ms | 2 s |
| RPT BIR book sales | year | not finished | 1.6 s | 5 s |
| RPT BIR book purchases | month | 1.4 s | 64 ms | 2 s |
| RPT BIR book purchases | year | 14 s | 1.1 s | 5 s |
| RPT BIR book general-journal | month | 365 ms | 246 ms | 2 s |
| RPT BIR book general-journal | year | 4.8 s | 3.4 s | 5 s |
| RPT BIR book general-ledger | month | 1.4 s | 205 ms | 2 s |
| RPT BIR book general-ledger | year | 7.1 s | 635 ms | 5 s |
| RPT payroll register | month | 68 ms | 57 ms | 2 s |
| RPT payroll register | year | 59 ms | 55 ms | 5 s |
| RPT piece work | month | 88 ms | 67 ms | 2 s |
| RPT piece work | year | 68 ms | 61 ms | 5 s |
| RPT labor cost | month | 8 ms | 7 ms | 2 s |
| RPT labor cost | year | 6 ms | 6 ms | 5 s |
| RPT 13th-month register | month | 1 ms | 2 ms | 2 s |
| RPT 13th-month register | year | 1 ms | 2 ms | 5 s |
| RPT production board | list | 1.5 s | 265 ms | 2 s |
| RPT production activity | month | 91 ms | 51 ms | 2 s |
| RPT production activity | year | 1.9 s | 257 ms | 5 s |
| RPT production throughput | month | 134 ms | 35 ms | 2 s |
| RPT production throughput | year | 1.9 s | 153 ms | 5 s |
| RPT worker output | month | 81 ms | 36 ms | 2 s |
| RPT worker output | year | 1.4 s | 162 ms | 5 s |
| RPT production timing | month | 1.2 s | 344 ms | 2 s |
| RPT production timing | year | 997 ms | 328 ms | 5 s |
| RPT lead time | month | 987 ms | 355 ms | 2 s |
| RPT lead time | year | 802 ms | 350 ms | 5 s |
| RPT late jobs | month | 748 ms | 378 ms | 2 s |
| RPT late jobs | year | 802 ms | 331 ms | 5 s |
| RPT job margin | list | 1.1 s | 590 ms | 2 s |
| TAX sales register | month | 116 s | 113 ms | 2 s |
| TAX sales register | year | not finished | 1.1 s | 5 s |
| TAX withholding received register | month | 164 ms | 11 ms | 2 s |
| TAX withholding received register | year | 257 ms | 61 ms | 5 s |
| TAX purchases register | month | 1.3 s | 10 ms | 2 s |
| TAX purchases register | year | 14 s | 102 ms | 5 s |
| TAX EWT register | month | 166 ms | 7 ms | 2 s |
| TAX EWT register | year | 233 ms | 45 ms | 5 s |
| TAX 2307 to issue | month | 171 ms | 11 ms | 2 s |
| TAX 2307 to issue | year | 174 ms | 11 ms | 5 s |
| TAX 2550Q | month | 350 s | 832 ms | 2 s |
| TAX 2550Q | year | not finished | 811 ms | 5 s |
| TAX 1601-EQ | month | 362 ms | 28 ms | 2 s |
| TAX 1601-EQ | year | 346 ms | 24 ms | 5 s |
| TAX 1702Q | month | 409 ms | 121 ms | 2 s |
| TAX 1702Q | year | 410 ms | 133 ms | 5 s |
| TAX SLSP sales | month | 677 s | 662 ms | 2 s |
| TAX SLSP sales | year | not finished | 664 ms | 5 s |
| TAX SLSP purchases | month | 3.2 s | 28 ms | 2 s |
| TAX SLSP purchases | year | 3.1 s | 24 ms | 5 s |
| TAX SAWT | month | 181 ms | 18 ms | 2 s |
| TAX SAWT | year | 182 ms | 16 ms | 5 s |
| TAX VAT summary | month | 709 ms | 418 ms | 2 s |
| TAX VAT summary | year | 713 ms | 433 ms | 5 s |
| TAX 0619-E | month | 183 ms | 9 ms | 2 s |
| TAX 0619-E | year | 185 ms | 7 ms | 5 s |
| TAX 1702-RT | month | 434 ms | 147 ms | 2 s |
| TAX 1702-RT | year | 427 ms | 145 ms | 5 s |
| TAX income tax deductions | month | 1 ms | 1 ms | 2 s |
| TAX income tax deductions | year | 2 ms | 1 ms | 5 s |
| TAX 1604-E | month | 2.4 s | 206 ms | 2 s |
| TAX 1604-E | year | 2.3 s | 368 ms | 5 s |
| TAX calendar | month | 2 ms | 2 ms | 2 s |
| TAX calendar | year | 1 ms | 1 ms | 5 s |
| TAX booklets | list | 1 ms | 1 ms | 2 s |
| TAX income tax settings | list | 1 ms | 1 ms | 2 s |
| TAX payments due | list | 4.7 s | 1.6 s | 2 s |
| CUS customers, first page | list | 2 ms | 2 ms | 2 s |
| CUS customers, deep page | list | 6 ms | 7 ms | 2 s |
| CUS customers, search | list | 4 ms | 2 ms | 2 s |
| CUS one customer | list | 2 ms | 1 ms | 2 s |
| CUS sizes | list | 1 ms | 1 ms | 2 s |
| JO orders to release | list | 33 s | 547 ms | 2 s |
| JO orders to release, by name | list | 2.2 s | 444 ms | 2 s |
| JO releases awaiting invoice | list | 393 ms | 333 ms | 2 s |
| COL open items of a customer | list | 131 ms | 119 ms | 2 s |
| COL invoices of a customer | list | 338 ms | 357 ms | 2 s |
| PAY periods | list | 30 ms | 28 ms | 2 s |
| PAY payslips of a run | list | 9 ms | 10 ms | 2 s |
| PAY runs to release | list | 232 ms | 220 ms | 2 s |
| PAY loans | list | 3 ms | 3 ms | 2 s |
| PAY prior pay | list | 2 ms | 3 ms | 2 s |
| PAY statutory tables | list | 4 ms | 3 ms | 2 s |
| PAY 2316 | list | 49 ms | 46 ms | 2 s |
| PAY alphalist | list | 45 ms | 44 ms | 2 s |
| PAY 13th-month years | list | 36 ms | 34 ms | 2 s |
| EMP employees | list | 3 ms | 2 ms | 2 s |
| EMP leave balances | list | 13 ms | 14 ms | 2 s |
| EMP attendance | month | 4 ms | 4 ms | 2 s |
| EMP holidays | list | 2 ms | 2 ms | 2 s |
| EMP one employee | list | 2 ms | 2 ms | 2 s |
| PRD board | list | 3.1 s | 406 ms | 2 s |
| PRD TV board | list | 3.0 s | 319 ms | 2 s |
| PRD workers | list | 2 ms | 2 ms | 2 s |
| STAT months | list | 14 s | 672 ms | 2 s |
| STAT exposure | list | 3 ms | 3 ms | 2 s |
| CASH places | list | 101 ms | 67 ms | 2 s |
| CASH cash book | month | 109 ms | 112 ms | 2 s |
| CASH cash book | year | 193 ms | 272 ms | 5 s |
| CASH bank reconciliations | list | 2 ms | 1 ms | 2 s |
| CAL calendar | month | 268 ms | 421 ms | 2 s |
| ACC chart of accounts | list | 216 ms | 34 ms | 2 s |
| ACC month-end checklist | list | 24 s | 1.6 s | 2 s |
| ACC opening balances | list | 787 ms | 707 ms | 2 s |
| ACC settings | list | 4 ms | 4 ms | 2 s |
| ACC go-live decisions | list | 2 ms | 2 ms | 2 s |
| DASH home | list | 23 s | 527 ms | 2 s |
| DASH owner health | list | 238 s | 1.7 s | 2 s |
| DASH notifications (home panel) | list | 22 s | 1.1 s | 2 s |
| DASH notifications (all, first page) | list | 12 s | 1.1 s | 2 s |
| AUD log | list | 2 ms | 2 ms | 2 s |
| AUD integrity check | list | 7.2 s | 3.5 s | 5 s |
| AUD users | list | 2 ms | 1 ms | 2 s |
| SZR overview | list | 2 ms | 1 ms | 2 s |
| SZR sets | list | 1 ms | 1 ms | 2 s |
| SZR loans | list | 1 ms | 1 ms | 2 s |
| SZR overdue loans | list | 1 ms | 1 ms | 2 s |
| PUR suppliers | list | 3 ms | 2 ms | 2 s |
| PUR supplies | list | 2 ms | 2 ms | 2 s |
| PUR open purchase orders | list | 39 ms | 33 ms | 2 s |
| AP suppliers | list | 10 ms | 6 ms | 2 s |
| EXP categories | list | 1 ms | 1 ms | 2 s |
| FA assets | list | 1 ms | 1 ms | 2 s |
| LOAN loans | list | 2 ms | 1 ms | 2 s |
| EQ people | list | 1 ms | 1 ms | 2 s |
| EQ balances | list | 1 ms | 1 ms | 2 s |
| CAT items | list | 2 ms | 1 ms | 2 s |
| RATE rates | list | 3 ms | 2 ms | 2 s |
| COM outbox | list | 1 ms | 1 ms | 2 s |
| USERS | list | 1 ms | 1 ms | 2 s |
| DOC list acc.jv | list | 3 ms | 1 ms | 2 s |
| DOC list acc.opening | list | 2 ms | 1 ms | 2 s |
| DOC list ap.bill | list | 6 ms | 6 ms | 2 s |
| DOC list ap.bill, next page | list | 5 ms | 6 ms | 2 s |
| DOC list ap.payment | list | 4 ms | 5 ms | 2 s |
| DOC list ap.payment, next page | list | 3 ms | 2 ms | 2 s |
| DOC list ap.opening | list | 1 ms | 1 ms | 2 s |
| DOC list ap.advance | list | 1 ms | 1 ms | 2 s |
| DOC list ap.advance_return | list | 1 ms | 1 ms | 2 s |
| DOC list ca.advance | list | 1 ms | 1 ms | 2 s |
| DOC list ca.repayment | list | 1 ms | 1 ms | 2 s |
| DOC list ca.writeoff | list | 1 ms | 1 ms | 2 s |
| DOC list ca.opening | list | 1 ms | 1 ms | 2 s |
| DOC list cash.transfer | list | 4 ms | 2 ms | 2 s |
| DOC list cash.transfer, next page | list | 3 ms | 2 ms | 2 s |
| DOC list cash.count | list | 2 ms | 1 ms | 2 s |
| DOC list cash.count, next page | list | 1 ms | 1 ms | 2 s |
| DOC list cash.other_receipt | list | 1 ms | 1 ms | 2 s |
| DOC list cash.bank_adj | list | 1 ms | 1 ms | 2 s |
| DOC list col.collection | list | 4 ms | 2 ms | 2 s |
| DOC list col.collection, next page | list | 3 ms | 3 ms | 2 s |
| DOC list col.refund | list | 1 ms | 1 ms | 2 s |
| DOC list col.deposit_transfer | list | 1 ms | 1 ms | 2 s |
| DOC list col.cwt_only | list | 1 ms | 1 ms | 2 s |
| DOC list col.forfeit | list | 1 ms | 1 ms | 2 s |
| DOC list col.credit_memo | list | 1 ms | 1 ms | 2 s |
| DOC list col.write_off | list | 1 ms | 1 ms | 2 s |
| DOC list eq.owner_money | list | 1 ms | 1 ms | 2 s |
| DOC list eq.officer | list | 1 ms | 1 ms | 2 s |
| DOC list eq.opening | list | 1 ms | 1 ms | 2 s |
| DOC list exp.voucher | list | 3 ms | 2 ms | 2 s |
| DOC list exp.voucher, next page | list | 3 ms | 2 ms | 2 s |
| DOC list fa.buy | list | 1 ms | 1 ms | 2 s |
| DOC list fa.depreciation | list | 1 ms | 1 ms | 2 s |
| DOC list fa.disposal | list | 1 ms | 1 ms | 2 s |
| DOC list fa.opening | list | 1 ms | 1 ms | 2 s |
| DOC list inv.count | list | 1 ms | 1 ms | 2 s |
| DOC list jo.job_order | list | 3 ms | 3 ms | 2 s |
| DOC list jo.job_order, next page | list | 2 ms | 2 ms | 2 s |
| DOC list jo.release | list | 3 ms | 5 ms | 2 s |
| DOC list jo.release, next page | list | 2 ms | 5 ms | 2 s |
| DOC list jo.invoice_record | list | 3 ms | 8 ms | 2 s |
| DOC list jo.invoice_record, next page | list | 3 ms | 6 ms | 2 s |
| DOC list jo.opening | list | 1 ms | 1 ms | 2 s |
| DOC list jo.dp_invoice | list | 1 ms | 1 ms | 2 s |
| DOC list loan.loan | list | 1 ms | 1 ms | 2 s |
| DOC list loan.payment | list | 1 ms | 1 ms | 2 s |
| DOC list loan.opening | list | 1 ms | 1 ms | 2 s |
| DOC list pay.run | list | 1 ms | 1 ms | 2 s |
| DOC list pay.run, next page | list | 1 ms | 1 ms | 2 s |
| DOC list pay.release | list | 1 ms | 1 ms | 2 s |
| DOC list pay.release, next page | list | 1 ms | 1 ms | 2 s |
| DOC list pay.thirteenth | list | 1 ms | 1 ms | 2 s |
| DOC list prd.entry | list | 2 ms | 5 ms | 2 s |
| DOC list prd.entry, next page | list | 2 ms | 7 ms | 2 s |
| DOC list pur.po | list | 1 ms | 1 ms | 2 s |
| DOC list pur.rr | list | 1 ms | 1 ms | 2 s |
| DOC list qs.sale | list | 3 ms | 8 ms | 2 s |
| DOC list qs.sale, next page | list | 3 ms | 9 ms | 2 s |
| DOC list quo.quotation | list | 2 ms | 3 ms | 2 s |
| DOC list quo.quotation, next page | list | 2 ms | 2 ms | 2 s |
| DOC list stat.remittance | list | 1 ms | 1 ms | 2 s |
| DOC list stat.opening | list | 1 ms | 1 ms | 2 s |
| DOC list tax.vat_close | list | 1 ms | 1 ms | 2 s |
| DOC list tax.vat_close, next page | list | 1 ms | 1 ms | 2 s |
| DOC list tax.bir_payment | list | 1 ms | 1 ms | 2 s |
| DOC list tax.opening | list | 1 ms | 1 ms | 2 s |
| DOC list tax.payable.opening | list | 1 ms | 1 ms | 2 s |
| DOC list tax.it_provision | list | 1 ms | 1 ms | 2 s |
| DOC list tax.it_settlement | list | 1 ms | 1 ms | 2 s |
| CSV collections register | year | 213 ms | 260 ms | 5 s |
| CSV sales by period | year | 333 ms | 400 ms | 5 s |
| CSV general journal | year | 2.4 s | 1.8 s | 5 s |
| CSV AR aging | year | 983 ms | 700 ms | 5 s |
| CSV TAX sales register | year | not finished | 1.1 s | 5 s |
| CSV BIR sales book | year | not finished | 1.5 s | 5 s |
| DOC one job order | list | 2 ms | 3 ms | 2 s |
| DOC one pay run | list | 4 ms | 5 ms | 2 s |
| NAV search customer | search | 171 ms | 189 ms | 300 ms |
| NAV search wearer | search | 164 ms | 200 ms | 300 ms |
| NAV search jobOrder | search | 168 ms | 198 ms | 300 ms |
| NAV search document | search | 167 ms | 196 ms | 300 ms |
| NAV search supplier | search | 162 ms | 191 ms | 300 ms |
| NAV search employee | search | 165 ms | 195 ms | 300 ms |
