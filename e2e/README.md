# End-to-end browser tests (PLAN I1 item 6)

`npm run e2e` builds the web app, starts the server on an empty database and backup folder in a temporary folder
(`serve.ts`), and drives Chromium as staff do. The tests find things by the words on the screen (labels, headings,
button names), never by CSS classes. The specs share one shop and run in file order, so run the whole suite, not one file.

- `01-first-run`: the first owner, sign out, sign in; then the owner adds a staff user with a role, who signs in and changes the password at first sign-in.
- `02-sales`: a job order with the customer added on the form and a design picture attached to it, its downpayment and the rest, a release with the invoice to follow, the invoice record; balance due zero and nothing in AR aging. Then downpayment VAT mode C (the downpayment invoice, its collection, the release with the balance invoice), a job order made from a quotation, and a job order paid by check, the check then deposited from Checks on hand.
- `03-quick-sale`: a customer, a quick sale with its collection.
- `04-payroll`: an employee, a week of attendance, the run, its release, the payslip.
- `05-backups`: recovery keys, back up now, restore drill.
- `07-customer-emails`: customer emails stay off until the owner sets them up; the outbox and the statement's email button.

- `06-every-screen`: runs on the practice shop's made-up data (`serve-practice.ts`, its own server on `E2E_PRACTICE_PORT`, 3198; `06-every-screen.setup.ts` first adds the open work a trainee would start with (`practice-work.ts`), a TV user and backups). The roles run side by side, beside the other specs. Each default role (owner, accountant, encoder, production, tv) signs in and opens every menu item: no error message, no blank page, no console error, no 403, 404 or 500. Then each "+ New" form is filled from what the screen offers (no id to type) and pressed Record until its preview opens. It also checks the role sees no menu item it lacks the permission for.
- `08-import-bulk`: the old sheet's tabs through the importer: customers, then sizes typed with no customer (a suggestion accepted, wearers under one customer and a new group, one made its own customer), then employees' pay types and rates in one table, then the same files again with nothing made twice.

First time on a PC: `npx playwright install chromium`. Where Chromium is already installed, point `E2E_CHROMIUM` at it.
`E2E_PORT` changes the port (3199).
