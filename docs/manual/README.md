# Moonproject manual

Read `Moonproject-Manual.pdf`: the complete A4 book, with page-number footers, clickable contents, PDF bookmarks and a linked screen index.

Build from the repository root with its existing Node and Playwright setup:

```sh
node docs/manual/build-manual.mjs
```

The script uses `@playwright/test` already in the repository. It adds no dependency and needs no running app or database. If this machine uses an existing Chromium outside Playwright's default cache, set `E2E_CHROMIUM` to that executable, just as for the repository's e2e suite.

`manual.md` supplies the book structure and additional instructions. Each `{{guide:N}}` includes the numbered owner guide directly, including its screenshots. Correct guide wording at its source; do not copy it into the manuscript. The build fails if any of the 63 guides is missing or repeated, any screenshot is missing, or an internal link has no target. The screen index reads the actual menu and document titles from the app. Review it if those source formats change.

For a local HTML/contents preview, set `MANUAL_REVIEW_DIR` to a temporary review directory. Only the PDF, manuscript, script and this README belong in the published manual folder. Build time does not read the shop's records, environment credentials or user profile.

Verification for this edition:

- Application checked at main `2bc2bc061fba2a5c7a549a7c2828e82cc741255e` (6 October 2026).
- All 63 numbered guides and all 81 referenced screenshots included. The existing pictures show fictional practice data; older layouts are identified as such in the front matter.
- Button wording checked against web screens, generic document labels and the menu. First-run, sales, quick-sale, payroll, backup, every-screen and customer-email flows cross-checked against `e2e/` and relevant module tests.
- Printed dates checked against `generic/PrintedDate.tsx`, the JO/COL/AP/EXP forms, document lifecycle and ACC period guard. Access checked against security permission synchronization. Loan forgiveness, short payments, shop-order reversals, duplicate reasons and restore number reuse checked against their actual forms and handlers.
- PDF rendered with Playwright Chromium. All chapter starts, contents, three screenshot pages and every troubleshooting page reviewed as page images; page size, links, guide coverage, screenshot count and absence of blank pages checked from the PDF.
- `npm test -- --maxWorkers=2`: 254 files, 1,763 tests passed. Typecheck was not run: no TypeScript changed. No plan, app, dependency or screenshot files changed.
