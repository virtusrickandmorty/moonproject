# codex2-independent-01: lean summary

Optional public record of the consolidated review, 5 October 2026. Acting on the review does not wait for this file.

- Application SHA: `d4bc1ef84f2771a9f8720f199c9cd4d831dbc949`. Rechecked against main `4e22ef53d9a549aa7d227b9b2e1711da260c4d92`: no finding below is fixed there yet.
- Status: **partial.** Covered: [00-baseline.md](00-baseline.md), [11-ease-repetition-speed.md](11-ease-repetition-speed.md) (complete for its stated scope) and `01-money-core.md` (partial, pending in PR #275). The B1 money-gap check, B2 payroll and tax review and B3 reliability review have not been run yet, so payroll, tax and reliability are not covered. The security review and A1's restricted findings were consolidated privately and are not summarized here.
- Detail stays in the linked reports; this file only ranks and groups it.

## Who did what

- **Independent:** the baseline, A1 and A11 were written by a separate auditor account that did not build the app.
- **Builder material they used:** the corrected business brief, the existing tests and fixtures, and the owner guides. A1 discloses one accidental run of builder fixtures and adopted nothing from it.
- **Planned builder reviews:** B1, B2 and B3 were planned as disclosed builder reviews; none has run.
- **Builder side:** this summary and its code re-checks. "Confirmed" means the auditor observed it and the code at the application SHA agrees; it is not a second independent opinion.

## Ranked findings

| Priority | Finding | Label |
|---|---|---|
| Money | A1-003 a cash count can post a different over/short than the one confirmed, if money moves between preview and save | Confirmed; intentional design, still risky |
| Money | A1-001 an account's type and code can disagree, and statements follow the code | Confirmed |
| Money | A1-004 backdated documents accept a date that does not exist | Confirmed |
| Money | A1-002 a short final loan payment leaves debt with no instalment to pay | Confirmed |
| Money | A1-006 one centavo can go to the wrong person in very large splits | Confirmed in the helper; low |
| Lost entry | A11-001 changing the attendance period drops unsaved marks without warning | Confirmed |
| Lost entry | A11-002 a measurement correction keeps only the values retyped | Confirmed; intentional, risky |
| Blocked work | A11-003 the default TV user cannot open the TV board | Confirmed |
| Blocked work | A1-005 no screen button to reopen the latest bank reconciliation | Confirmed |
| Friction | A11-004, A11-006, A11-008, A11-007 (same as A1-I01) | Confirmed |
| Friction | A11-005 tax choices assume accountant knowledge | Suspected |
| Guides | A1-007, A11-009, plus the reconciliation guide's reopen text | Confirmed |

No wrong-pay finding is in the published reports, but payroll was not audited, so it is **unresolved**, not clean. A11's "stale customer" suspicion was refuted with evidence. On Windows, one test's cleanup and line-ending-sensitive fixtures keep the full suite from a clean exit (unresolved).

## Fix batches

Security fixes are tracked privately and are not listed here.

1. **Money:** A1-003, A1-004, A1-001, A1-006; A1-002 after the accountant answers question 1.
2. **Blocked and lost work:** A11-003, A1-005, A11-001; A11-002 after question 4.
3. **Friction:** A11-004, A11-006, A11-008, menu names.
4. **Guides:** after batches 2 and 3, so the text matches the screens.
5. **Windows test portability.**

## Verification tests

- A ledger change between preview and save makes the count ask for a fresh preview; a same-key retry still returns the same document.
- 30 February and month 13 are refused with no number used; 29 February in a leap year is accepted.
- An account whose type does not match its code range is refused; contra accounts still work.
- A short final loan payment leaves a residual that appears on the late list.
- A new TV user sees the board on a fresh and an existing database, and nothing more.
- Leaving attendance with unsaved marks asks Save, Discard or Stay.
- Correcting one measurement keeps the others.
- Reopen works for the accountant only, for the latest month only, with an audit entry.
- Each changed guide is followed literally on the practice shop; the full suite exits 0 on Windows.

## Questions for the owner and accountant

1. When a lender takes less on an instalment, should the rest stay due on it, move to the next one, or need a reschedule?
2. Must an account's type always match its code's first digit, apart from contra accounts?
3. If money moves between counting and saving, should the cash count be refused?
4. When one measurement is corrected, should the other values carry over?
5. Which supplier, loan, owner-money and payroll jobs do encoders do?
6. Who sets withholding profiles, and how does an encoder flag "not sure"?

## Deferred areas

Payroll and tax, reliability and restore, live role tests, sales and receivables, purchases and stock, screens and prints, a full month end to end, and the remaining A1 checks (interruptions, two users at once, interest, depreciation, restore). Real tests with the encoders, phones, printing and remote speed are also still open.

## Improvements worth their complexity

1. Two more month-end checks: "loan balance with no next instalment" and "account type does not match its code" (A1-I02). Small.
2. Encoder favourites (A11-I01), once question 5 is answered. Medium.
3. One owner summary on Home in place of repeated figures (A11-I02). Medium; can wait.

Not worth it yet: a bulk attendance tool, expense templates or a keyboard-command system.
