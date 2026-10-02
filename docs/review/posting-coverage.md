# Posting coverage check (W29)

Checked on 2026-09-29 against `main` at 9406f50; brought up to date on 2026-10-03 against `main` at 8160e02 (the rows for
DIV, the sale half of FA-DISP and the allowance method, and "Added since 29 Sep" below). One row per posting code in PLAN D5 (every table) and per golden in
PLAN I2, with the doc type that posts it, the test that checks its journal line by line, and the test that checks its
cancel (D6). Paths are under `apps/server/src/modules/` unless they start with `apps/` or `tests/`; test names are
quoted from the start of the `it(...)` title.

**What counts.** *Journal*: the test asserts the document's own journal to the centavo, account by account (party too
where the helper shows it): `linesOf` / `journalOf` / `journal()` rows, or an exact `balances()` of a clean ledger.
*Cancel*: the test cancels that document and asserts the mirror (reversal rows) or the ledger it leaves (exact
balances). In every such test `runInvariants` must also come back clean, and its L4 check proves that original and
reversal net to zero per account and party. **gap** = no such test existed before this check. **added** = the test
this PR adds for the gap.

**Result.** Every doc type that exists posts what the plan says; no rule posts wrongly, so there is no `it.fails` test.
Before this PR there were 7 gaps: G-26, and the cancel or journal check of RENT-ACCR, RCV, CA-GIVE, COL-OVER and
DEP-REFUND. All 7 now have tests (5 new files, below). DIV, the sale half of FA-DISP and the allowance method (1209) of
BAD-DEBT were not built on 29 Sep; all three were built since, each with a golden, its cancel and a property test.

## Sales and collections

| Code | Doc type | Journal checked by | Cancel checked by |
|---|---|---|---|
| JO-POST | `jo.job_order` (JO-) | `JO/tests/job-order.test.ts` › "records JO-000001 for ₱56,000.00 and posts no journal (D5 JO-POST)" | `JO/tests/job-order.test.ts` › "cancel posts nothing, freezes the stage and leaves nothing owed" |
| DEP-RCV | `col.collection` (COL-) | `COL/tests/collection.test.ts` › "G-01: a ₱28,000 cash downpayment on an un-invoiced JO is a deposit on that JO (DEP-RCV)" | `COL/tests/collection.test.ts` › "G-06: … cancel mirrors it" (reversal of the Cr 2201 JO-B line); `JO/tests/release.test.ts` › "cancelling a collection whose deposit an invoice record applied reopens the receivable" |
| DEP-VAT | `col.collection`, mode B | `COL/tests/deposit-vat.test.ts` › "G-04: the downpayment adds Dr 2209 / Cr 2301 3,000.00; …" | `COL/tests/deposit-vat.test.ts` › "G-04 cancels: the invoice first …, then the downpayment (nothing left)"; "G-04 cancel of the downpayment after the invoice applied it …" |
| INV-REC | `jo.invoice_record` (IR-), via `/api/jo/releases` | `JO/tests/release.test.ts` › "G-02: release all with invoice no. 0501 …"; "G-09 (invoice part) …"; "G-10: a discount shown on the invoice posts gross + 4190 …"; "invoices only the released part … splits sales by class …" | `JO/tests/release.test.ts` › "plain cancel of a paid invoice record: the mirror, and the payment becomes a deposit of the JO again"; "an unpaid invoice record cancels with the mirror only; …" |
| DEP-APPLY | `jo.invoice_record` (same journal) | `JO/tests/release.test.ts` › "G-02: …" (Dr 2201 / Cr 1201 28,000.00); `COL/tests/deposit-vat.test.ts` › "G-05: …" (mode C: 2201 to sales) | `JO/tests/release.test.ts` › "plain cancel of a paid invoice record: …" (the mirror includes the deposit application; the follow-up Dr 1201 / Cr 2201) |
| DEP-VAT-REV | `jo.invoice_record`, mode B | `COL/tests/deposit-vat.test.ts` › "G-04: … the invoice adds Dr 2301 / Cr 2209 3,000.00 …" | `COL/tests/deposit-vat.test.ts` › "G-04 cancels: the invoice first (its mirror puts the VAT back on the deposits) …" |
| INV-DP | `jo.dp_invoice` (IR-), mode C | `COL/tests/deposit-vat.test.ts` › "G-05: DP invoice Dr 1201 28,000 / Cr 2201 25,000, Cr 2301 3,000; …" | `COL/tests/deposit-vat.test.ts` › "G-05 cancels: the DP invoice waits for the release invoice; …" |
| COL-RCV | `col.collection` | `COL/tests/collection.test.ts` › "G-03: GCash 10,000 + cash 17,750 + 1% CWT 250 …"; "COL-RCV, government buyer: …"; "settles a difference of up to ₱1.00 to cash short and over (D4.9) …" (6280 both sides) | `COL/tests/collection.test.ts` › "COL-RCV, government buyer: … cancel mirrors it"; "G-06: … cancel mirrors it"; "G-12: … mirror today, new number, linked" |
| COL-OVER | `col.collection` (unapplied part) | `COL/tests/collection.test.ts` › "G-07: ₱12,000 paid on ₱10,000 AR keeps ₱2,000 unapplied; … (COL-OVER, DEP-REFUND)" | gap: G-07 cancelled the collection but checked only the status and the JO's AR. **added** `COL/tests/refund-cancel.test.ts` › "the refund's mirror holds the ₱2,000 again; the collection's mirror reopens the ₱10,000 AR and takes the ₱2,000 unapplied back out of 2201" |
| DEP-XFER | `col.deposit_transfer` (DXF-) | `COL/tests/deposit-transfer.test.ts` › "G-28: an edited JO's ₱20,000 deposit moves to the reissued JO, 2201 to 2201 with no cash line; cancel mirrors it"; "unapplied money moved to a partly invoiced JO pays its receivable first …" | `COL/tests/deposit-transfer.test.ts` › "G-28: … cancel mirrors it" |
| CWT-ONLY | `col.cwt_only` (CWT-) | `COL/tests/credits.test.ts` › "golden: an invoice paid net of 1% CWT, then its 2307: Dr 1410 / Cr 1201 …" | same test ("… cancel mirrors") |
| DEP-REFUND | `col.refund` (RFD-) | `COL/tests/collection.test.ts` › "G-07: …" (Dr 2201 / Cr 1101 2,000.00) | gap: G-07 checked only the status code of the refund cancel. **added** `COL/tests/refund-cancel.test.ts` (same test as COL-OVER) |
| DEP-FORFEIT | `col.forfeit` (DFF-) | `COL/tests/credits.test.ts` › "golden: an abandoned JO's ₱28,000 deposit is kept as other income, no VAT, flagged; …"; "VATable from a date set by the accountant: Cr 7103 NET and Cr 2301 12/112; …" | same tests (`linesOf(id, 'reversal')` = mirror) |
| CM-ALLOW | `col.credit_memo` (CM-) | `COL/tests/credits.test.ts` › "golden, unpaid invoice: allowance ₱5,600 → Dr 4191 5,000.00, Dr 2301 600.00 / Cr 1201 5,600.00; …"; "golden, paid invoice: return ₱5,600 → Cr 2201 …"; "part paid: …" | `COL/tests/credits.test.ts` › "golden, paid invoice: … " (both memos cancelled, reversal = mirror) |
| QS-SALE | `qs.sale` + `col.collection` | `QS/tests/sale.test.ts` › "G-08: alteration ₱350 cash, invoice no. 0502: …"; "splits sales by class, shows a discount as gross + 4190, and takes split tenders" | `QS/tests/sale.test.ts` › "cancel cancels both, mirrored with today's date; …" |
| BAD-DEBT | `col.write_off` (BDW-) | `COL/tests/credits.test.ts` › "golden: writes off all the invoice owes, Dr 6270 / Cr 1201, output VAT stays; …" | same test (reversal = mirror). Allowance method (Dr 1209): `COL/tests/allowance.test.ts` › "golden: refused when the allowance is short, …; then Dr 1209 / Cr 1201; recovery: cancel (Dr 1201 / Cr 1209), then the collection"; property › "random allowances …, write-offs, cancels and recoveries: …" |

## Purchases and expenses

| Code | Doc type | Journal checked by | Cancel checked by |
|---|---|---|---|
| EXP-PAY | `exp.voucher` (EXP-) | `EXP/tests/voucher.test.ts` › "G-13: rent 40,000.00 to a VAT-registered lessor from BDO, EWT 5% on NET"; "G-14: …"; "G-16: tricycle 200.00 from petty cash, no VAT receipt" | `EXP/tests/voucher.test.ts` › "cancel posts a mirror dated today and nets to zero; encoders cannot cancel" |
| BILL-POST | `ap.bill` (BILL-) | `AP/tests/ap.test.ts` › "fabric ₱11,200 from a VAT supplier (Virtus not a TWA), ₱5,000 paid, ₱6,200 still owed"; "non-VAT supplier: the gross goes to the cost and EWT is on G; …" | `AP/tests/ap.test.ts` › "a bill with payments cancels only after them; each cancel mirrors its posting, dated today" |
| RENT-ACCR | `ap.bill`, category Rent | `AP/tests/ap.test.ts` › "EWT is credited when the bill is recorded, not at payment: rent ₱40,000" | gap: no rent bill was cancelled, so the EWT reversal of D6 was unchecked. **added** `AP/tests/rent-accrual.test.ts` › "₱40,000 rent billed: … the cancel mirrors every line, EWT included" (and the 2307-to-issue list drops it) |
| RCV | `pur.rr` (RR-) | gap: no test asserted that it posts nothing. **added** `PUR/tests/rr-posting.test.ts` › "a PO and a receipt of 5 of its 10 yards: no journal; the cancel: no reversal" | gap (cancel only checked for status 200). **added**: same test |
| SUP-ADV | `ap.advance` (SADV-); applied on `ap.bill` | `AP/tests/advance.test.ts` › "₱5,000 down on a purchase order; the ₱11,200 fabric bill takes it, ₱6,200 is left to pay"; "₱11,200 to a VAT printer withholds 2% …" | `AP/tests/advance.test.ts` › "a bill with applied advances is cancelled before the advance; …" (reversal rows of the bill and the advance) |
| BILL-PAY | `ap.payment` (SPAY-) | `AP/tests/ap.test.ts` › "fabric ₱11,200 …"; "a payment never exceeds what is still owed; split tenders and a bank fee" (6230) | `AP/tests/ap.test.ts` › "a bill with payments cancels only after them; …" |
| EWT-REM | `tax.bir_payment` (BIRP-), 0619-E / 1601-EQ | `TAX/tests/bir-payment.test.ts` › "pays each month and the quarter per payee; partial, penalty, overpayment, third month and backdating; cancel mirrors" | same test |

## Money, owners, loans, assets, inventory

| Code | Doc type | Journal checked by | Cancel checked by |
|---|---|---|---|
| TRF | `cash.transfer` (TRF-) | `CASH/tests/transfer.test.ts` › "BDO -> China Bank, sent 10,000.00, received 9,975.00"; "with no fee posts two lines only" | `CASH/tests/transfer.test.ts` › "cancel posts a mirror dated today and nets to zero" |
| CASH-COUNT | `cash.count` (CNT-) | `CASH/tests/cash-extras.test.ts` › "ledger ₱12,500.00, counted ₱12,450.00: Dr 6280 50.00 / Cr 1101 50.00"; "an over count credits 6280; a matching count posts nothing" | `CASH/tests/cash-extras.test.ts` › "ledger ₱12,500.00, counted ₱12,450.00: …" (cancel puts the ₱50.00 back) |
| OTH-RCV | `cash.other_receipt` (ORC-) | `CASH/tests/cash-extras.test.ts` › "posts cash against the category account, and cancels to zero" | same test |
| BANK-ADJ | `cash.bank_adj` (BADJ-) | `CASH/tests/bank.test.ts` › "a bank charge of 150.00: Dr 6230 150.00 / Cr 1111 150.00, and its cancel"; "interest of 1,000.00 gross: Dr 1111 800.00, Dr 8103 200.00 / Cr 7101 1,000.00, and its cancel" | same tests |
| OWN-IN | `eq.owner_money` (OWN-) | `EQ/tests/eq.test.ts` › "owner puts 100,000.00 into BDO as an advance from a stockholder"; "capital stock: par to 3101, the excess to 3104; …"; "a subscription payment clears 3103 …"; "deposits for future subscription go to 3105 (FRB 6 met) or 2502" | `EQ/tests/eq.test.ts` › "cancel posts a mirror dated today and nets to zero; encoders cannot cancel" |
| OFC-OUT | `eq.officer` (OFC-), kind `taken` | `EQ/tests/eq.test.ts` › "officer takes 5,000.00 from the cash box and pays back 3,000.00 into GCash" | `EQ/tests/eq.test.ts` › "cancel: money taken waits for its pay-backs to be cancelled first; mirrors net to zero" |
| OFC-IN | `eq.officer`, kinds `returned`, `repaid_to_officer` | `EQ/tests/eq.test.ts` › "officer takes 5,000.00 … pays back 3,000.00 into GCash"; "the company pays back an advance, never more than it owes" | `EQ/tests/eq.test.ts` › "cancel: money taken waits for its pay-backs …" |
| DIV | `eq.dividend` (DIV-) | `EQ/tests/dividend.test.ts` › "₱50.00 a share on 5,000 shares: Dr 3210 250,000.00 / Cr 2503 per stockholder net of 10% final tax on individuals / Cr 2312 17,500.00" | `EQ/tests/dividend.test.ts` › "a declaration is cancelled only after the payments made from it; its mirror lands on its own date"; `EQ/tests/dividend-property.test.ts` › "random earnings, share changes, declarations, payments, 1601-FQ payments and cancels keep 3210, 2503 and 2312 in step" |
| LOAN-IN | `loan.loan` (LOAN-) | `LOAN/tests/loan.test.ts` › "loan ₱500,000 with a ₱5,000 fee deducted; instalment ₱25,000 = …" | `LOAN/tests/loan.test.ts` › "a loan with payments cannot be cancelled; once cancelled it takes no payment" (ledger empty after) |
| LOAN-PAY | `loan.payment` (LPAY-) | `LOAN/tests/loan.test.ts` › "loan ₱500,000 …" | `LOAN/tests/loan.test.ts` › "cancelling a payment mirrors it and opens the instalment again" |
| FA-BUY | `fa.buy` (FA-) | `FA/tests/fa.test.ts` › "capitalises the net cost, claims the VAT in full, …" (G-21); "other classes go to 6210, on account to 2101; …" | `FA/tests/fa.test.ts` › "a purchase waits for its runs; a run can be cancelled only when it is the latest for its assets" (ledger empty after) |
| FA-DEP | `fa.depreciation` (DEPR-) | `FA/tests/fa.test.ts` › "capitalises the net cost … charges 1,500.00 a month to 5302 and blocks a second run" | `FA/tests/fa.test.ts` › "a purchase waits for its runs; …"; "a run is redone (cancel + new number) …" |
| FA-DISP | `fa.disposal` (FAD-), retirement only | `FA/tests/fa.test.ts` › "retirement: book value to 7202, a sale is refused, later runs skip the asset, cancel puts it back"; `FA/tests/opening.test.ts` › "retires an opening asset like a bought one …" | `FA/tests/fa.test.ts` › "retirement: … cancel puts it back" (register and L4). Sale (Cash X, 2301, 7102 or 7202): `FA/tests/sale.test.ts` › "posts the journal line by line, warns September is not run, then shows in the register, the booklet and the sales book"; "a customer picked: Cr 7102 the gain, …"; property › "every random sale balances, and gain less loss equals NET less book value; cancels undo it" |
| INV-COUNT | `inv.count` (INVC-) | `INV/tests/count.test.ts` › "GL 1301 ₱30,000, counted ₱25,000: … next count ₱42,000: Dr 1301 17,000.00 / Cr 5109"; "ready-made merchandise posts to 1302: …" | `INV/tests/count.test.ts` › "cancel mirrors the adjustment on the count date, latest count first (D6); …" |

## Payroll and statutory

| Code | Doc type | Journal checked by | Cancel checked by |
|---|---|---|---|
| PAY-RUN | `pay.run` (PAY-) | `PAY/tests/pay.test.ts` › "cutoff 1 takes PhilHealth for the month; …" and "with the 13th-month accrual switched off (ACC-18), cutoff 2 is exactly G-24"; `PAY/tests/pay-examples.test.ts` (G-25) | `PAY/tests/pay.test.ts` › "CA ₱2,000 given, ₱1,000 deducted; release; the run waits for its release; cancels restore the CA balance" (G-29); `PAY/tests/year-end.test.ts` › "the year-end run cancelled and done again: … the cancel mirrors the refund; …" |
| PAY-REL | `pay.release` (POUT-) | `PAY/tests/pay.test.ts` › "CA ₱2,000 given, …" (Dr 2110 / Cr 1101 3,924.79); `PAY/tests/thirteenth.test.ts` (13th-month release) | `PAY/tests/pay.test.ts` › "CA ₱2,000 given, …" (2110 back to 0 per employee after the mirrors) |
| CA-GIVE | `ca.advance` (CA-) | `PAY/tests/pay.test.ts` › "CA ₱2,000 given, …" | gap: cancelled only at the end of G-29, with no check of its reversal. **added** `CA/tests/advance.test.ts` › "₱2,000 from GCash: Dr 1210 2,000.00 (the employee) / Cr 1121 2,000.00; cancelled the next day, the mirror puts it back" |
| CA-REPAY | `ca.repayment` (CAR-) | `CA/tests/settle.test.ts` › "part: ₱500 of a ₱2,000 advance paid back by bank transfer; cancelled the next day"; "full: all ₱2,000 paid back in cash; …" | `CA/tests/settle.test.ts` › "part: …" |
| CA-WO | `ca.writeoff` (CAW-) | `CA/tests/settle.test.ts` › "G-23 then the rest forgiven: …" | same test |
| TH13-PAY | `pay.thirteenth` (TH13-) | `PAY/tests/thirteenth.test.ts` › "a full-year employee, one hired mid-year, one above ₱90,000: …"; "accrued more than paid: … credited back to 6103 / 5204 …"; "with the accrual switched off …" | `PAY/tests/thirteenth.test.ts` › "a full-year employee, …" (reversal rows) |
| STAT-REM | `stat.remittance` (REM-) | `STAT/tests/stat.test.ts` › "SSS and 1601-C for September paid in full, PhilHealth in two parts; …"; "SSS for September paid late with a ₱250.00 penalty: Dr 6290 …" | `STAT/tests/stat.test.ts` › same two tests (reversal rows) |

## Tax closes, accountant, opening

| Code | Doc type | Journal checked by | Cancel checked by |
|---|---|---|---|
| VAT-CLOSE | `tax.vat_close` (VATC-) | `TAX/tests/vat-close.test.ts` › "closes Q3 into VAT payable, per customer and supplier, leaving the pending 2307 in 1404"; **added** `TAX/tests/vat-close-g26.test.ts` (G-26 figures) | `TAX/tests/vat-close.test.ts` › "closes quarters in order: … Q2 cannot be cancelled under Q3"; **added** `TAX/tests/vat-close-g26.test.ts` (reversal rows) |
| VAT-PAY | `tax.bir_payment`, 2550Q | `TAX/tests/bir-payment.test.ts` › "in two parts, the second late with a penalty; …; cancel mirrors" | same test |
| IT-QPAY | `tax.bir_payment`, 1702Q | `TAX/tests/income-tax.test.ts` › "a profitable Q1, paid late with a penalty; Q2 takes off Q1's payment …" | same test (the Q2 payment's reversal) |
| IT-PROV | `tax.it_provision` (ITP-) | `TAX/tests/annual-income-tax.test.ts` › "a profitable year at the regular rate: …; cancels mirror in order" | same test |
| IT-SETTLE | `tax.it_settlement` (ITS-) | `TAX/tests/annual-income-tax.test.ts` › same test; "MCIT is the higher and the credits overpay it: …" | same test |
| JV | `acc.jv` (JV-) | `ACC/tests/acc.test.ts` › "posts any postable accounts with the party they need, and cancels with a mirror" | same test |
| OB-* | `acc.opening` (OB-), `ap.opening`, `loan.opening`, `fa.opening`, `jo.opening`, `ca.opening`, `eq.opening`, `tax.opening`, `tax.payable.opening`, `stat.opening` | `ACC/tests/opening.test.ts` › "golden: a cash line alone is Dr cash / Cr 3900 …", "golden: the equity breakdown brings 3900 to zero; …"; the "golden" tests of `AP`, `LOAN`, `FA`, `JO`, `CA`, `EQ`, `TAX` (`opening.test.ts`, `opening-payable.test.ts`) and `STAT/tests/opening.test.ts` | `ACC/tests/opening.test.ts` › "cancels with a mirror on the cut-over date while the opening is open"; each module's opening test "a cancel lands on the cut-over date …" |
| *-REV | engine (`cancelDocument`), every doc type | — | Every cancel above; L4 in `runInvariants` (original + reversal net to zero per account and party); `apps/server/test/engine.test.ts` |

## Goldens (PLAN I2)

| # | Journal checked by | Cancel / follow-up checked by |
|---|---|---|
| G-01 | `COL/tests/collection.test.ts` › "G-01: …"; `JO/tests/job-order.test.ts` › "records JO-000001 …" | `COL/tests/collection.test.ts` › "G-06: … cancel mirrors it" (the same deposit line) |
| G-02 | `JO/tests/release.test.ts` › "G-02: release all with invoice no. 0501: INV-REC + DEP-APPLY; …" | `JO/tests/release.test.ts` › "plain cancel of a paid invoice record: …" |
| G-03 | `COL/tests/collection.test.ts` › "G-03: …"; `JO/tests/release.test.ts` › "G-02: … then G-03 clears it" | `COL/tests/collection.test.ts` › "COL-RCV, government buyer: … cancel mirrors it" |
| G-04 | `COL/tests/deposit-vat.test.ts` › "G-04: …" | `COL/tests/deposit-vat.test.ts` › "G-04 cancels: …"; "G-04 cancel of the downpayment after the invoice applied it …" |
| G-05 | `COL/tests/deposit-vat.test.ts` › "G-05: …" | `COL/tests/deposit-vat.test.ts` › "G-05 cancels: …" |
| G-06 | `COL/tests/collection.test.ts` › "G-06: …" | same test |
| G-07 | `COL/tests/collection.test.ts` › "G-07: …" | gap (statuses only). **added** `COL/tests/refund-cancel.test.ts` |
| G-08 | `QS/tests/sale.test.ts` › "G-08: …" | `QS/tests/sale.test.ts` › "cancel cancels both, mirrored with today's date; …" |
| G-09 | `JO/tests/release.test.ts` › "G-09 (invoice part): …"; `COL/tests/collection.test.ts` › "COL-RCV, government buyer: …" (the collection part: 1404 5% + 1410 1%, at ₱11,200 scale) | `COL/tests/collection.test.ts` › "COL-RCV, government buyer: … cancel mirrors it" |
| G-10 | `JO/tests/release.test.ts` › "G-10: …" | `JO/tests/release.test.ts` › "an unpaid invoice record cancels with the mirror only; …" |
| G-11 | `COL/tests/credits.test.ts` › "golden, unpaid invoice: allowance ₱5,600 → …" | `COL/tests/credits.test.ts` › "golden, paid invoice: …" (credit memo cancels) |
| G-12 | `COL/tests/collection.test.ts` › "G-12: …" (original, reversal, new document) | same test |
| G-13 | `EXP/tests/voucher.test.ts` › "G-13: …" | `EXP/tests/voucher.test.ts` › "cancel posts a mirror dated today …" |
| G-14 | `EXP/tests/voucher.test.ts` › "G-14: …" | as G-13 |
| G-15 | `AP/tests/ap.test.ts` › "fabric ₱11,200 from a VAT supplier …" | `AP/tests/ap.test.ts` › "a bill with payments cancels only after them; …" |
| G-16 | `EXP/tests/voucher.test.ts` › "G-16: …" | `EXP/tests/voucher.test.ts` › "edit = cancel + new number: paid from the cash box, not petty cash" |
| G-17 | `CASH/tests/transfer.test.ts` › "BDO -> China Bank, …" | `CASH/tests/transfer.test.ts` › "cancel posts a mirror dated today and nets to zero" |
| G-18 | `CASH/tests/cash-extras.test.ts` › "ledger ₱12,500.00, counted ₱12,450.00: …" | same test |
| G-19 | `EQ/tests/eq.test.ts` › "owner puts 100,000.00 into BDO …"; "saving without a classification is rejected …" | `EQ/tests/eq.test.ts` › "cancel posts a mirror dated today …" |
| G-20 | `LOAN/tests/loan.test.ts` › "loan ₱500,000 with a ₱5,000 fee deducted; …" | `LOAN/tests/loan.test.ts` › "cancelling a payment mirrors it …"; "a loan with payments cannot be cancelled; …" |
| G-21 | `FA/tests/fa.test.ts` › "capitalises the net cost, claims the VAT in full, charges 1,500.00 a month to 5302 and blocks a second run" | `FA/tests/fa.test.ts` › "a purchase waits for its runs; …" |
| G-22 | `INV/tests/count.test.ts` › "GL 1301 ₱30,000, counted ₱25,000: …" | `INV/tests/count.test.ts` › "cancel mirrors the adjustment on the count date, latest count first (D6); …" |
| G-23 | `PAY/tests/pay.test.ts` › "CA ₱2,000 given, ₱1,000 deducted; …"; `CA/tests/settle.test.ts` › "G-23 then the rest forgiven: …" | `PAY/tests/pay.test.ts` (same test); **added** `CA/tests/advance.test.ts` (the CA- mirror) |
| G-24 | `PAY/tests/pay.test.ts` › "cutoff 1 takes PhilHealth …"; "with the 13th-month accrual switched off (ACC-18), cutoff 2 is exactly G-24"; `PAY/tests/pay-examples.test.ts` › "both cutoffs as in §13 (cutoff 2 is G-24, …)" | `PAY/tests/pay.test.ts` › "cutoff 1 takes PhilHealth …" (later cutoff first, then both cancelled; L4) |
| G-25 | `PAY/tests/pay-examples.test.ts` › Examples A, B, C, C2 | Payroll run cancels as PAY-RUN |
| G-26 | gap: no test used the plan's figures. **added** `TAX/tests/vat-close-g26.test.ts` › "Q2: Dr 2301 60,000.00 / Cr 1401 25,000.00, Cr 2302 35,000.00; Q3: Dr 2301 20,000.00, Dr 1402 10,000.00 / Cr 1401 30,000.00; cancels mirror, latest first" | same test (added) |
| G-27 | `apps/server/test/month-in-the-life.test.ts` › "G-27: the opening trial balance is 506,000.00 each side and opening balance equity is zero" | `ACC/tests/opening.test.ts` › "cancels with a mirror on the cut-over date while the opening is open" |
| G-28 | `COL/tests/deposit-transfer.test.ts` › "G-28: …" | same test |
| G-29 | `PAY/tests/pay.test.ts` › "CA ₱2,000 given, … the run waits for its release; cancels restore the CA balance"; `PAY/tests/pay.test.ts` › "pays the week, marks the rows paid, … and cancels in order" (piece assignments unpaid again); `PAY/tests/thirteenth.test.ts` | same tests |
| G-30 | `apps/server/test/month-in-the-life.test.ts` › "records every document of the month with the journal worked out by hand, dated as planned"; "ends on the trial balance of tests/golden/month.tb.csv, to the centavo, account names included" (`tests/golden/month.tb.csv`) | — (one month in sequence; no cancel in the plan's scenario) |

## Added since 29 Sep

Posting types built after the check above (none of them is a D5 row of its own except BAD-ALLOW), read on 3 Oct 2026.

| Code | Doc type | Journal checked by | Cancel checked by |
|---|---|---|---|
| BAD-ALLOW | `col.allowance` (ACL-) | `COL/tests/allowance.test.ts` › "golden: up per customer from the aging (Dr 6270 / Cr 1209 per customer), then down (Dr 1209 / Cr 6270); cancel mirrors on its own date" | same test; property › "random allowances (per customer and in total), write-offs, cancels and recoveries: each allowance posts its change exactly; the invariants hold" |
| DIV payment | `eq.dividend_payment` (DIVP-) | `EQ/tests/dividend.test.ts` › "pays a stockholder what the declaration made payable, in part or in full, never more; cancel mirrors it" | same test |
| 1601-FQ payment | `tax.bir_payment`, form 1601-FQ | `EQ/tests/dividend.test.ts` › "the 1601-FQ pays the quarter’s final tax: Dr 2312 / Cr cash; …"; "the late 1601-FQ asks for the penalty; a penalty goes to 6290" | `EQ/tests/dividend-property.test.ts` (1601-FQ payments and cancels) |
| UVAT, UVATR | `tax.uncollected_vat` (UVAT-), `tax.uncollected_vat_recovery` (UVATR-) | `TAX/tests/uncollected-vat.test.ts` › "golden: the claim Dr 2301 / Cr 2303 with the invoice as ref, …; the add-backs as the customer pays; cancels mirror" | same test; property › "after a claim and any payments with their add-backs, 2303 on the invoice = the claim VAT on what is still owed; …" |
| JV reversal | `acc.jv`, reversing (`jv-reversals.ts`) | `ACC/tests/reversing-jv.test.ts` › "golden: a month-end accrual and its reversal on the first day of the next month, mirrored to the centavo" | `ACC/tests/reversing-jv.test.ts` › "reversed at most once; cancelling the reversal lets it be reversed again; …" |
| Split tenders | `exp.voucher` (EXP-), up to four cash places | `EXP/tests/tenders.test.ts` › the four goldens (no EWT or VAT; input VAT; EWT, G-14; EWT and input VAT, G-13) | `EXP/tests/tenders.test.ts` › "a reissue can change the split: one place becomes two, and the old journal is mirrored"; property › "every voucher’s journal balances and its tenders equal the cash credits, …" |
| Customer checks | `col.collection` into 1103, deposit `cash.transfer`, returned check | `COL/tests/checks.test.ts` › "lists every check not yet deposited with its days; a deposit is one transfer 1103 -> bank; 1103 equals the list"; "comes back to 1103, the bank charge goes to 6230, …" | `COL/tests/checks.test.ts` › "… cancelling the collection puts the receivable back, to the centavo"; "its fund transfers are undone only in the order the check moved, …"; property › "whatever is collected, deposited, returned and cancelled, 1103 on the ledger equals the checks-on-hand list" |
| Night differential | `pay.run`, line kind `night` | `PAY/tests/pay-examples.test.ts` › "₱1,000/day, not an MWE, 16–31 August: …"; "₱1,000/day, not an MWE, 1–15 September 2026: an ordinary day and a rest day; …" | property › "pay never goes down when night minutes are added, …"; "pay never goes down when night overtime minutes are added, …" |

Not built: nothing from D5.

## New tests in this PR

| File | Covers |
|---|---|
| `apps/server/src/modules/TAX/tests/vat-close-g26.test.ts` | G-26, VAT-CLOSE journal and cancel with the plan's figures |
| `apps/server/src/modules/AP/tests/rent-accrual.test.ts` | RENT-ACCR cancel: every line mirrored, EWT included; the 2307-to-issue list drops it |
| `apps/server/src/modules/PUR/tests/rr-posting.test.ts` | RCV: no journal on posting or on cancel |
| `apps/server/src/modules/CA/tests/advance.test.ts` | CA-GIVE journal and cancel mirror |
| `apps/server/src/modules/COL/tests/refund-cancel.test.ts` | COL-OVER and DEP-REFUND cancels line by line (G-07) |

All five pass on the current engine. None found a rule that posts wrongly, so none is marked `it.fails`.
