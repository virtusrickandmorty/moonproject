# Three busy years (PERF)

The shop keeps years of data on one PC. These two tools show how the app behaves when it does.

## `npm run perf-data`: the database

Builds `data/perf/perf.db` (and `perf.db.json` beside it, with the made-up passwords) holding three busy years, from 1 January 2026 to
31 December 2028: about 6,000 customers, 25,000 job orders with their releases and invoices, about 40,000 collections, 30 employees
paid twice a month, a production entry for every job order, a quick sale and an expense each day, supplier bills, monthly cash counts
and quarterly VAT closes. Takes about 25 minutes.

- Every record is made through the same HTTP routes the screens use (`platform/practice/perf-data.ts`, on the helpers of
  `practice/data.ts`). Nothing is written to a table directly.
- The same seed gives the same database: one seeded generator makes every choice and the clock is fixed. The ids are random, as
  everywhere, so "the same" means the same documents, numbers, dates, amounts and journals; `perf.db.json` holds a fingerprint of them.
  (`apps/server/test/perf-data.test.ts` builds a small one twice.)
- Options: `--db <path>`, `--seed 1`, `--days 1096`, `--customers 6000`, `--jobs 25000`, `--employees 30`, `--start 2026-01-01`.
  The data starts on 1 January 2026 because the starter statutory tables and piece rates in the migrations take effect that day, so
  payroll can only run from there.

## `npm run perf`: the timing test

`timing.perf.ts`, left out of `npm test`. It opens the database above (or `PERF_DB=<path>`) as the owner (as the accountant for the few
screens only the accountant may open), calls every list and report the way its screen does, for the last month of the data and its
last whole year, and checks the time of the first answer (nothing is warmed up): a month within 2 seconds, a year within 5, the
search within 300 ms. Long lists are asked for a page at a time, as the screens do (`?limit=100`); the Export CSV files of a year
(every row) are timed too. The audit chain check, which reads every audit entry and journal ever made, has the year's 5 seconds.

Every time is printed as a table and written to `data/perf/last-run.json` (or `PERF_OUT=<path>`).
The test opens the database read-write (sessions and the audit log are written), and applies any new migration to it: work on a copy
if you want to run the same file against two versions of the code.
