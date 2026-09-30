# Blind recompute: instructions for the reviewer

You are checking the accounting of Moonproject, the ERP of a made-to-order garment shop in the Philippines, without seeing what it posts.

1. Read `part-d.md` (PLAN Part D, the accounting rules; it is binding) and, for the payroll figures, `part-f.md` (PLAN Part F).
2. Read `scenario.md`: the opening balances on 2026-08-31 and every document of September 2026, to 2026-09-30, in order.
3. Work out every journal the rules require, to the centavo, and answer in one CSV file in the format of `answer.csv`.

## The CSV

```
doc_ref,line,account_code,debit,credit,party,tax_kind,base,rate
```

- One row per journal line. `doc_ref` is the reference in the first column of the scenario tables (G-02, G-12r, M-07, ...); a document with two journals has two references there.
- `line`: 1, 2, 3 ... within the journal.
- `account_code`: the 4-digit code of PLAN D2.
- `debit`, `credit`: pesos with two decimals and no peso sign, like `28000.00`; leave the other one empty.
- `party`: only on lines of these accounts: 1201, 1209, 1210, 1220, 1230, 1401, 1404, 1410, 1510, 1511, 1520, 1521, 1530, 1531, 1540, 1541, 1550, 1551, 2101, 2110, 2111, 2201, 2209, 2301, 2310, 2311, 2401, 2402, 2403, 2404, 2405, 2501, 2502, 2503, 2601, 2602, 3101. Use the name the scenario gives: the customer, supplier, one-off payee, employee, stockholder, loan (for example "Sample Bank loan", "Heat press financing") or fixed asset (for example "Heat press"). Leave it empty on every other account, cash accounts included.
- `tax_kind`: on tax lines only, one of output_vat, input_vat, cwt, vat_withheld, ewt, wtax.
- `base`, `rate`: optional, on tax lines: the amount the tax was worked on (pesos) and its rate in percent (like `12` or `5`).
- No other rows, no totals. Keep separate lines where Part D keeps them (for example a debit and a credit on the same account in one journal).

Your answer is compared line by line with the ERP's journals (`npm run compare-blind -- <your.csv>`); every difference is listed in plain words.
