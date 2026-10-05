# codex2-independent-01: lean summary

Optional public record of the consolidated review, 5 October 2026. Acting on the review does not wait for this file.

- Application SHA: `d4bc1ef84f2771a9f8720f199c9cd4d831dbc949`. Rechecked against main `4e22ef53d9a549aa7d227b9b2e1711da260c4d92`: no finding below is fixed there yet.
- Inputs: [00-baseline.md](00-baseline.md), [11-ease-repetition-speed.md](11-ease-repetition-speed.md) (complete for its stated scope), `01-money-core.md` (partial, pending in PR #275), and the private reports B1 (money gaps), B2 (payroll and tax), B3 (reliability) and I1 (security).
- Security results and A1's restricted findings are handled privately and are not described here.
- Detail stays in the reports; this file only ranks and groups it.

## Who did what

- **Independent:** the baseline, A1, A11 and the security review were written by a separate auditor account that did not build the app.
- **Builder reviews:** B1, B2 and B3 were written by sessions of the same model family as the builders, and say so.
- **Builder material the auditors used:** the corrected business brief, the existing tests and fixtures, and the owner guides.
- **Builder side:** this summary. "Confirmed" means the reviewer found it and a re-read of the code at the application SHA agrees; it is not a second independent opinion.

## Ranked findings

| Priority | Finding | Label |
|---|---|---|
| Pay | B2-F1 a worker flagged as a minimum wage earner has no tax withheld even when paid above the minimum | Confirmed |
| Pay | B2-F2 piece pay takes the date and rate of the day it is typed, not the day the work was done | Confirmed |
| Pay | B2-F3 the same production sheet can be posted twice and paid twice | Confirmed |
| Money | B1-01 the same supplier invoice can be recorded twice (spelling variants, or bill plus voucher), doubling input VAT, cost and payables | Confirmed |
| Money | A1-003 a cash count can post a different over/short than the one confirmed | Confirmed; intentional design, still risky |
| Money | B1-02 booklet documents always carry the day they are typed, so month-end figures depend on encoding speed | Confirmed; legal timing for the accountant |
| Money | A1-001 account type and code can disagree; A1-004 a non-existent date is accepted; A1-002 a short final loan payment strands the rest | Confirmed |
| Pay | B2-F4 pay earned after the December 13th-month payout waits a year; B2-F6 contributions switched off give no payroll warning | Confirmed |
| Pay | B2-F5 the minimum-wage table may miss a 2026 tranche | Suspected |
| Lost entry | A11-001 attendance marks are dropped when the period changes; A11-002 a measurement correction keeps only the values retyped | Confirmed |
| Records | B3-3 an older installer silently downgrades the database; B3-5 a restore reissues document numbers already used on paper | Confirmed |
| Blocked work | A11-003 the default TV user cannot open the TV board; A1-005 no button to reopen a bank reconciliation | Confirmed |
| Blocked work | B3-2 the watchdog's stop-then-start may leave the service stopped; B3-6 the documented restore command cannot run on an installed PC | Confirmed in source; Windows outcome unverified |
| Friction | A11-004, A11-006, A11-008, A11-007 (same as A1-I01); A11-005 suspected | Confirmed |
| Guides | A1-007, A11-009, and the restore and bank reconciliation guides | Confirmed |

Minor items (centavo split, PhilHealth rounding, tax-code checks, CWT warning wording) are in the reports. A11's "stale customer" suspicion was refuted with evidence.

**Verified working:** offline LAN use, retried and simultaneous saves, restart after a crash with no lost or duplicate documents, and a backup-restore round trip (B3); job order to collection with withholding, refunds, supplier payments and the month boundary (B1); a daily-paid payroll and the VAT and withholding registers to the centavo (B2). The full unit suite (1,621 tests) and 18 browser tests passed on Linux at this SHA.

## Fix batches

1. **Pay:** B2-F1, F2, F3, F6 and a pre-run payroll review; F4 and F5 after the accountant answers.
2. **Money:** B1-01, A1-003, A1-004, A1-001, A1-006; B1-02 and A1-002 after the accountant answers.
3. **Security:** handled privately.
4. **Blocked and lost work:** A11-003, A1-005, A11-001, A11-002.
5. **Windows operation:** B3-2, B3-3, B3-5, B3-6, safer backup file writes.
6. **Friction and guides.**

## Verification tests

- An above-minimum worker flagged as a minimum wage earner is refused or warned.
- A production sheet typed late keeps its work date and rate, and a repeated sheet is warned.
- Supplier invoice variants such as `si-0042` and `SI 0042`, and a voucher for an invoice already billed, are refused or flagged.
- A ledger change between preview and save makes the cash count ask again.
- Impossible dates are refused with no number used.
- A short final loan payment leaves a residual on the late list.
- A new TV user sees the board and nothing more.
- Leaving attendance with unsaved marks asks first.
- An older installer refuses to downgrade.
- A restore on a fresh install works by the documented route.

## Questions for the accountant and owner

- **Accountant:**
  - Which workers are truly minimum wage earners, and what are the current wage-order tranches?
  - Is a late-December 13th-month true-up required?
  - What is the basis for each contribution switched off?
  - Must VAT follow the printed invoice date?
  - Which withholding tax code applies to made-to-order garments?
  - Are the loose-leaf books acceptable?
  - What is the PhilHealth basis for daily-paid workers?
  - Must an account's type match its code?
  - How should a lender's short payment be recorded?
- **Owner:**
  - Should a cash count be refused if money moved meanwhile?
  - Should measurement corrections carry the other values over?
  - Which jobs do encoders do?

## Deferred areas

Windows service, update, rollback and power-loss behaviour on real hardware; live role tests; statutory outputs not yet exercised (payslips, agency files, remittances, 2316, alphalist, SLSP files, loose-leaf prints); deposit VAT modes B and C, write-offs and post-dated checks; final pay and year-end adjustment; screens and prints; real tests with the encoders.

## Improvements worth their complexity

1. A pre-run payroll review listing duplicate pieces, minimum-wage-flag mismatches, contributions switched off and pieces typed late. High value, medium effort.
2. Month-end checklist additions: supplier invoices recorded after their month, releases awaiting an invoice, loans with no next instalment, account-code mismatches. Small.
3. Encoder favourites, once encoder duties are agreed. Medium.

Not worth it yet: a bulk attendance tool, expense templates or a keyboard-command system.
