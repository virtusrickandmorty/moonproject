# End-to-end browser tests (PLAN I1 item 6)

`npm run e2e` builds the web app, starts the server on an empty database and backup folder in a temporary folder
(`serve.ts`), and drives Chromium as staff do. The tests find things by the words on the screen (labels, headings,
button names), never by CSS classes. The specs share one shop and run in file order, so run the whole suite, not one file.

- `01-first-run`: the first owner, sign out, sign in.
- `02-sales`: a job order with the customer added on the form, its downpayment and the rest, a release with the invoice to follow, the invoice record; balance due zero and nothing in AR aging.
- `03-quick-sale`: a customer, a quick sale with its collection.
- `04-payroll`: an employee, a week of attendance, the run, its release, the payslip.
- `05-backups`: recovery keys, back up now, restore drill.

First time on a PC: `npx playwright install chromium`. Where Chromium is already installed, point `E2E_CHROMIUM` at it.
`E2E_PORT` changes the port (3199).
