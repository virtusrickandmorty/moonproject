<!-- Copied from docs/PLAN.md by npm run blind-pack. -->
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
