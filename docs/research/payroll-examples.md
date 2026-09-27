# Payroll worked examples (golden G-25)

Copied on 2026-09-27 from the planning research file `payroll-ph-2026.md` §13–14.3, so builders can test against it. The research file itself lives outside the repo. Every person here is made up. Where PAY differs from these examples, the difference is either a recorded decision (say so in the test) or a bug.

All amounts are in ₱. Rates for piece work are **illustrative** (not the shop's rate table). The **INCREMENTAL** deduction mode (§3.4) and the "period-end month" rule are used unless stated otherwise. SMW = ₱550 (Silang, IVA-22).

### Example A: daily-paid sewer, ₱550/day (= SMW, so MWE), semi-monthly, 6-day week, August 2026
**Cutoff 1 (Aug 1–15; 13 scheduled days, 12 worked, 1 unpaid absence):** gross = 12 × 550 = **6,600.00**

**Cutoff 2 (Aug 16–31; 13 scheduled days):** worked Aug 17–22 and 24–29 (12 days).
- **Aug 21 (Fri):** special non-working day, worked.
- **Aug 31 (Mon):** regular holiday, not worked. It is paid because the worker was present on Sat Aug 29, the preceding workday.
- 2 hours of OT on Aug 26.

| Line | Computation | Amount |
|---|---|---|
| BASIC_DAILY | 11 ordinary days × 550 | 6,050.00 |
| BASIC_DAILY (Aug 21) | 550 | 550.00 |
| SPECIAL_DAY_PREMIUM (Aug 21) | 550 × 30% | 165.00 |
| HOLIDAY_REG_UNWORKED (Aug 31) | 550 × 100% | 550.00 |
| OT (Aug 26) | 550/8 × 125% × 2 h | 171.88 |
| **Gross, cutoff 2** | | **7,486.88** |

August SSS compensation = 6,600.00 + 7,486.88 = **14,086.88**.

| Item | Cutoff 1 (MTD comp 6,600) | Cutoff 2 (MTD comp 14,086.88) | August total |
|---|---|---|---|
| SSS MSC | 6,500 | 14,000 | 14,000 |
| SSS EE | 325.00 | +375.00 | **700.00** |
| SSS ER | 650.00 | +750.00 | **1,400.00** |
| SSS EC | 10.00 | +0.00 | **10.00** (MSC < 15,000) |
| PhilHealth (MBS = 550 × 313/12 = 14,345.83) EE | 358.65 | 0.00 | **358.65** |
| PhilHealth ER | 358.65 | 0.00 | **358.65** |
| Pag-IBIG EE (2% × MTD, cap 10,000) | 132.00 | +68.00 | **200.00** |
| Pag-IBIG ER | 132.00 | +68.00 | **200.00** |
| WTax (MWE: SMW, holiday, premium and OT all exempt) | 0.00 | 0.00 | **0.00** |
| Cash-advance installment | 0.00 | 500.00 | 500.00 |
| **Net pay** | 6,600 − 815.65 = **5,784.35** | 7,486.88 − 375 − 68 − 500 = **6,543.88** | |
| 13th-month accrual (basic / 12) | 6,600/12 = 550.00 | (6,050 + 550)/12 = 550.00 | 1,100.00 |

Totals to remit for August for this worker: SSS 2,110.00, PhilHealth 717.30, Pag-IBIG 400.00. Employer cost on top of gross: 1,968.65.

### Example B: piece-rate sewer, weekly (Mon–Sat, paid Saturday), September 2026 (four weeks ending Sep 5, 12, 19 and 26)
Earnings come from dated step assignments (illustrative rates: NBA-cut jersey sewing ₱28/pc, shorts ₱18/pc, polo ₱45/pc).

| Week (period) | Lines | Gross | Basic (13th-month and PhilHealth base) |
|---|---|---|---|
| W1 (Aug 31–Sep 5) | jerseys 90 × 28 = 2,520; shorts 60 × 18 = 1,080; **holiday pay Aug 31** = average of the last 7 actual workdays before the holiday (Aug 22 and 24–29 earned 5,145 in total, so 735.00 ≥ SMW 550) | **4,335.00** | 3,600.00 |
| W2 (Sep 7–12) | polo 70 × 45 = 3,150; jerseys 60 × 28 = 1,680; shorts 58 × 18 = 1,044 | **5,874.00** | 5,874.00 |
| W3 (Sep 14–19) | jerseys 75 × 28 = 2,100; shorts 68 × 18 = 1,224 | **3,324.00** | 3,324.00 |
| W4 (Sep 21–26) | polo 60 × 45 = 2,700; jerseys 50 × 28 = 1,400; shorts 47 × 18 = 846 | **4,946.00** | 4,946.00 |
| **September** | | **18,479.00** | **17,744.00** |

Minimum-wage check: W3 = 3,324 over 6 days = ₱554/day ≥ ₱550, so no warning. W1 = 3,600 over 5 days = ₱720/day.

| Week | MTD comp | SSS MSC | SSS EE | SSS ER | EC | PhilHealth basis | PHIC EE (= ER) | HDMF EE (= ER) | Taxable (weekly) | WTax (weekly table) |
|---|---|---|---|---|---|---|---|---|---|---|
| W1 | 4,335 | 5,000 | 250.00 | 500.00 | 10.00 | max(3,600; SMW equivalent 14,345.83) = 14,345.83 | 358.65 | 86.70 | 4,335 − 695.35 = 3,639.65 | 0.00 |
| W2 | 10,209 | 10,000 | 250.00 | 500.00 | 0.00 | 14,345.83 | 0.00 | 113.30 | 5,874 − 363.30 = 5,510.70 | 15% × (5,510.70 − 4,808) = **105.41** |
| W3 | 13,533 | 13,500 | 175.00 | 350.00 | 0.00 | 14,345.83 | 0.00 | 0.00 | 3,324 − 175 = 3,149.00 | 0.00 |
| W4 | 18,479 | 18,500 | 250.00 | 500.00 | 20.00 | 17,744.00 | 84.95 | 0.00 | 4,946 − 334.95 = 4,611.05 | 0.00 |
| **Sep total** | | 18,500 | **925.00** | **1,850.00** | **30.00** | | **443.60** | **200.00** | | **105.41** |

- Checks: SSS for 18,479 on its own = MSC 18,500, so EE 925 / ER 1,850 / EC 30. ✔ PhilHealth 17,744 × 2.5% = 443.60. ✔ Pag-IBIG capped at 200. ✔
- The worker is treated as **not** an MWE (piece default, §6.3), so W2 withholds ₱105.41. Annualized (about 18,479 × 12 = 221,748 before contributions), the tax due is ₱0, so the **year-end adjustment refunds** everything withheld by Jan 25 (§6.6). FLAG: the accountant may prefer to mark such workers MWE.
- W4 with a ₱1,000 CA installment: net = 4,946 − 250 − 84.95 − 1,000 = **3,611.05**.
- Under **LAST_RUN_ONLY** instead: W1–W3 deduct nothing, and W4 deducts SSS 925 + PHIC 443.60 + HDMF 200 = 1,568.60 plus the CA of 1,000 from a 4,946 week. That is why INCREMENTAL is the recommended default.

### Example C: the monthly office employee, ₱15,000/month, paid ₱7,500 per semi-monthly cutoff, September 2026
| Item | Cutoff 1 (Sep 1–15) | Cutoff 2 (Sep 16–30) | Month |
|---|---|---|---|
| Gross | 7,500.00 | 7,500.00 | 15,000.00 |
| SSS (MTD 7,500 → MSC 7,500; then 15,000 → MSC 15,000) EE | 375.00 | +375.00 | **750.00** |
| SSS ER / EC | 750.00 / 10.00 | +750.00 / +20.00 | **1,500.00 / 30.00** |
| PhilHealth (MBS 15,000) EE = ER | 375.00 | 0.00 | **375.00** |
| Pag-IBIG EE = ER | 150.00 | +50.00 | **200.00** |
| Taxable (semi-monthly) | 7,500 − 900 = 6,600.00 | 7,500 − 425 = 7,075.00 | |
| WTax | 0.00 | 0.00 | **0.00** (below 10,417 per cutoff; monthly check 15,000 − 1,325 = 13,675 < 20,833) |
| **Net** | **6,600.00** | **7,075.00** | 13,675.00 |
| MWE? | ₱15,000 > SMW equivalent ₱14,345.83, so **not** an MWE (tax is ₱0 anyway) | | |

Absence deduction (if any): daily equivalent = 15,000 × 12 / 313 = ₱575.08 (6-day week) or / 261 = ₱689.66 (5-day week). The factor is an accountant setting.

### Example C2 (tax-bearing variant, to test the WTax path): ₱35,000/month, semi-monthly, INCREMENTAL
- SSS for the month: MSC 35,000 → EE 1,750 (regular 1,000 + MPF 750), ER 3,500 (2,000 + 1,500) + EC 30. PhilHealth EE 875 / ER 875. Pag-IBIG 200 / 200.
- Cutoff 1: deductions SSS 875 + PHIC 875 + HDMF 200 → taxable 15,550.00 → 15% × (15,550 − 10,417) = **769.95**.
- Cutoff 2: deductions SSS 875 → taxable 16,625.00 → 15% × (16,625 − 10,417) = **931.20**.
- Month total **1,701.15**. The monthly-table check gives 35,000 − 2,825 = 32,175 → 15% × 11,342 = 1,701.30. Annual check: (35,000 − 2,825) × 12 = 386,100 → 15% × 136,100 = 20,415.00 = 1,701.25/month, so year-end tops up ₱1.20.
- LAST_RUN_ONLY would give 1,104.10 + 638.70 = 1,742.80 (bracket jump in cutoff 1), a larger year-end refund.

---

## 14. Journal entries payroll must post

## 14.1 Accounts needed (names only; codes belong to the chart-of-accounts design)
- **Assets:**
  - Advances to Employees (cash-advances receivable);
  - Receivable from Employees – unrecovered contributions (optional).
- **Liabilities:**
  - Salaries and Wages Payable (net pay due);
  - SSS Contributions Payable (EE + ER + EC; optionally EC and MPF sub-ledgers);
  - SSS Loans Payable;
  - PhilHealth Contributions Payable;
  - Pag-IBIG Contributions Payable;
  - Pag-IBIG Loans Payable;
  - **Withholding Tax Payable – Compensation**, separate from Expanded WT Payable (1601-EQ);
  - 13th-Month Pay Payable (accrued);
  - optional Accrued Leave (SIL) Payable.
- **Expenses:**
  - **Direct Labor – Production** (cost of sales, tagged to job order and production step, for piece and production daily workers);
  - **Salaries and Wages – Administrative** (office staff);
  - Employer Contributions – SSS/EC, – PhilHealth, – Pag-IBIG (or one "Employer Statutory Contributions" account with sub-accounts), split by cost centre like the wages;
  - 13th-Month Pay Expense (by cost centre);
  - Leave Pay / SIL Expense;
  - Penalties and Surcharges (non-deductible).
- **Cash accounts:** cash on hand, petty cash, GCash, BDO, China Bank (brief §1). A release may be split across several.

## 14.2 Postings by document (inferred design; the accountant confirms)
1. **Payroll Run** (posted when the run is finalized):
   ```
   Dr Direct Labor / Salaries – Admin          gross earnings (by cost centre; job-order tag on piece lines)
   Dr Employer Contributions expense           SSS ER + EC, PhilHealth ER, Pag-IBIG ER (this run's increments)
   Dr 13th-Month Pay Expense                   accrual (13th-month base / 12)
       Cr SSS Contributions Payable            EE + ER + EC
       Cr PhilHealth Contributions Payable     EE + ER
       Cr Pag-IBIG Contributions Payable       EE + ER
       Cr Withholding Tax Payable – Comp.      WTax withheld
       Cr SSS / Pag-IBIG Loans Payable         loan amortizations deducted
       Cr Advances to Employees                CA installments deducted
       Cr 13th-Month Pay Payable               accrual
       Cr Salaries and Wages Payable           net pay
   ```
   Each payable line carries **scheme + applicable month** so the remittance can clear it exactly.
   - **Gross is never a plug.** It is Σ earning lines; the entry must balance by construction and a test must prove it. That fixes the VERSION 2 defect in `v2-hr-payroll-admin.md` §5 problem 1.
2. **Payroll Release (payment):** `Dr Salaries and Wages Payable / Cr Cash account(s)`, one credit per cash account used.
   - A separate document keeps unpaid wages visible as a liability and allows split payment. A one-step option (run and release together) is possible if the accountant prefers.
3. **Statutory Remittance** (one per scheme per applicable month, with the PRN or reference no. and date paid):
   ```
   Dr SSS Contributions Payable (month M)      amount remitted
   Dr Penalties and Surcharges                 penalty/interest, if late
       Cr Cash in Bank / Cash                  total paid
   ```
   The same pattern applies to PhilHealth, Pag-IBIG, loans, and the **BIR 1601-C** (`Dr Withholding Tax Payable – Comp.`). The remittance screen shows the payable balance for month M against the amount paid and flags any variance.
4. **Cash advance granted:** `Dr Advances to Employees / Cr Cash account`. It is cleared only by payroll deductions, cash repayment (a CR-like document) or an accountant write-off (`Dr expense / Cr Advances`), so the CA sub-ledger always equals the GL. That fixes the ₱3,900 gap.
5. **13th-month payout** (December or on separation): `Dr 13th-Month Pay Payable (accrued) [+ Dr 13th-Month Pay Expense for any true-up] / Cr Salaries and Wages Payable`, then a release.
   - No SSS, PhilHealth or Pag-IBIG.
   - Tax only on the excess over ₱90,000 together with other benefits.
6. **Year-end tax adjustment:**
   - Deficiency: an extra WTax deduction in the final run (`Cr Withholding Tax Payable`).
   - Excess: a refund by Jan 25, `Dr Withholding Tax Payable – Comp. / Cr Salaries and Wages Payable` (then release). The lower payable reduces the next 1601-C remittance (inferred; FLAG: the accountant confirms the BIR presentation).
7. **SIL commutation:** `Dr Leave Pay Expense / Cr Salaries and Wages Payable`.
8. **Arrears catch-up** (past months with no deductions; accountant decision, FLAG):
   - Employer share: `Dr Employer Contributions expense` (or a prior-period adjusting entry by the accountant) `/ Cr Contributions Payable`.
   - Employee share not deducted at the time: either the employer absorbs it (`Dr expense`), or it becomes `Advances to Employees` only with the employee's written consent.

## 14.3 The examples posted
- **Example A, cutoff 2** (Aug 31; production):
  `Dr Direct Labor 7,486.88; Dr Employer Contributions 818.00 (SSS ER 750 + HDMF ER 68); Dr 13th-Month Expense 550.00`
  `Cr SSS Payable 1,125.00 (375 + 750); Cr Pag-IBIG Payable 136.00; Cr Advances to Employees 500.00; Cr 13th-Month Payable 550.00; Cr Wages Payable 6,543.88`
  Debits 8,854.88 = credits 8,854.88 ✔
- **Example A, cutoff 1** (Aug 15):
  `Dr Direct Labor 6,600.00; Dr Employer Contributions 1,150.65 (650 + 10 + 358.65 + 132); Dr 13th-Month Expense 550.00`
  `Cr SSS Payable 985.00; Cr PhilHealth Payable 717.30; Cr Pag-IBIG Payable 264.00; Cr 13th-Month Payable 550.00; Cr Wages Payable 5,784.35`
  Debits 8,300.65 = credits 8,300.65 ✔
  August payables after both cutoffs: SSS 2,110.00; PhilHealth 717.30; Pag-IBIG 400.00. Each matches the monthly contribution exactly.
- **Example B, W2** (Sep 12):
  `Dr Direct Labor 5,874.00; Dr Employer Contributions 613.30 (500 + 113.30)`
  `Cr SSS Payable 750.00; Cr Pag-IBIG Payable 226.60; Cr WTax Payable – Comp. 105.41; Cr Wages Payable 5,405.29` (13th-month accrual 489.50 omitted for brevity)
  Debits 6,487.30 = credits 6,487.30 ✔
- **Example B, W4** (Sep 26):
  `Dr Direct Labor 4,946.00; Dr Employer Contributions 604.95 (500 + 20 + 84.95)`
  `Cr SSS Payable 770.00; Cr PhilHealth Payable 169.90; Cr Advances to Employees 1,000.00; Cr Wages Payable 3,611.05`
  Debits 5,550.95 = credits 5,550.95 ✔
- **Example C, cutoff 2** (Sep 30; admin):
  `Dr Salaries – Admin 7,500.00; Dr Employer Contributions 820.00 (750 + 20 + 50)`
  `Cr SSS Payable 1,145.00; Cr Pag-IBIG Payable 100.00; Cr Salaries Payable 7,075.00`
  Debits 8,320.00 = credits 8,320.00 ✔
- **SSS remittance for September** (by Oct 31): `Dr SSS Contributions Payable (Sep) / Cr Cash in Bank – BDO` for the month's total (EE + ER + EC of all employees).

---

