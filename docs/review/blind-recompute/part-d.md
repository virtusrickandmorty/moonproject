<!-- Copied from docs/PLAN.md by npm run blind-pack. -->
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
