# Build status

| Day | Lane | Done | Notes |
|---|---|---|---|
| 1 | Claude #1 | Repo skeleton; SQLite rules (no delete, immutable journals and posted documents, gapless numbering); chart of accounts seed (PLAN D2); ledger post/reverse/balances/trial balance; engine invariants L1–L4, L7, L12; hash-chained audit; idempotency; document engine (preview, post, cancel, reissue, drafts); login, sessions, CSRF, rate limits, step-up, users and role grid; reference module **CASH: Fund Transfer** with golden G-17, cancel/reissue and property tests; `AGENTS.md`; CI | Local HTTPS, Windows service and backups come on days 2–4 (PLAN J2) |

## Engine decisions made on day 1 (defaults, change by PR if the accountant disagrees)
- Cash places are GL accounts flagged `is_cash_place`; the account itself identifies the place, so cash lines carry no party.
- Every document gets an internal gapless number from its series. Booklet numbers (sales invoice, CR) will be stored in `documents.external_number` and checked against the booklet register (TAX, day 3).
- Journal numbers are `JE-YYYY-NNNNNN`, one series per year (PLAN D7).
- Cancel reversals are dated the cancel date (ACC-09 default).
- `stages` (for JO) and effective-dated settings are not in the engine yet; they come as optional additions when JO and ACC need them.
