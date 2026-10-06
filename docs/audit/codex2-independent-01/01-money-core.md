# A1 — Money core

## 1. Scope, identity and coverage

**Overall status: PARTIAL.** The executed accounting checks and findings below are delivered. Remaining work is listed in section 5. This is an independent sampled assessment, not certification of safety, accounting correctness or compliance.

- Run: `codex2-independent-01`; task A1; assessment date: **5 October 2026**, Asia/Manila.
- Immutable application: **`d4bc1ef84f2771a9f8720f199c9cd4d831dbc949`**. Every application observation below refers to this commit.
- Publication branch: `audit/codex2-independent-01-a1`, advanced to fetched current main **`4e22ef53d9a549aa7d227b9b2e1711da260c4d92`** before adding this report. The permitted baseline document still names the same application SHA.
- Agent: Codex; exact model identifier and configured reasoning effort not independently available.
- Actual OS: Microsoft Windows NT **10.0.26300.0**, x64; PowerShell; Node **24.19.0**, npm **11.6.2**.
- Verified source root: `C:/Users/James/Documents/Codex/2026-10-05/cloud-environment-plugin-cloud-environment-openai/moonproject-independent-audit`. `git rev-parse --show-toplevel` matched this exact path; origin matched `https://github.com/virtusrickandmorty/moonproject`. The registered main checkout was clean and stayed untouched; after the final fetch it was 14 commits behind origin/main.
- Separate task-owned checkouts: sibling `a1-work/application` (detached at the application SHA) and `a1-work/report` (report branch). Own tooling, disposable databases and logs are in sibling `a1-work/tooling`. No production data or operational integrations were used. No application fixes were made.

The business context is the supplied baseline: a Philippine VAT-registered garment corporation, manual booklet sales invoices, owners, an accountant and encoders, and a Windows PC serving shop browsers. These remain owner-supplied facts. Configuration is not statutory authority.

Independence: read the permitted baseline, AGENTS, scoped source/tests and factual owner guides. Deferred plan/status/research and other auditors' findings were not intentionally read. **Accidental exposure:** the full test command invoked existing `docs/review/blind-recompute` fixtures and printed fixture-related failures. No earlier substantive finding was adopted; subsequent focused scenario retries excluded the blind-recompute tests. This indirect exposure limits any claim of a completely blind pass. Only this task's own recovery artifacts were used. No parallel auditor was launched by this task; other tasks' execution state was not established.

### Coverage and evidence labels

“Observed” means executed in the isolated app or test database; “code-proved” means the relevant reachable source path was traced; “suspected” needs further proof; “unassessed” means no conclusion. Existing test success supports only its assertions.

| Area | Coverage and roles | Limits |
| --- | --- | --- |
| Engine documents, journal posting, cancellation/reissue | Source: lifecycle, routes, ledger writer/queries, numbering, idempotency. Own accountant API scenarios for posting, same-key retry, failed reissue rollback and cancellation; direct database immutability checks. | No forced power interruption or independent-process race. No claim that every document type in the entire ERP was independently exercised. |
| Money, dates and settings | Source: integer helpers, date helpers, Manila clock, effective settings. Executed cent splitting, midnight/year boundary and impossible backdate. | Settings boundary permutations and clock rollback not exhaustively executed. |
| Audit and attachments | Source review of audit and attachment storage/routes and normal engine use; existing suite executed. | No full rendered upload/download/restore journey or retention certification. Restricted findings require private review. |
| ACC | Source: account creation, JV, openings, month end; related statement/year rollover path. Accountant API: account creation and JV; own trial-balance and balance-sheet checks. Existing opening, month-end and statement tests executed. | Full rendered opening wizard, month-end sign-off and year-end operator journey remain unassessed. |
| CASH | Source: places, transfers, counts, other receipts, bank adjustments and reconciliation. Accountant API: transfer/count; owner and accountant browser: reconciliation list/detail. Owner started and finished a fictional zero-balance reconciliation. | Cash-count confirmation concurrency was reproduced through API sequencing, not simultaneous browser users. |
| LOAN | Source: loan creation, repayment, opening, schedule/late list. Accountant API: loan, reduced final payment and failed second payment. Existing loan tests executed. | No independently recalculated matrix of all interest methods/terms or full rendered repayment journey. |
| FA | Source: assets, purchase/opening paths, depreciation and disposal, including sale path. Existing tests executed. Owner browser: empty asset register and purchase entry link. | No complete independent purchase-through-sale browser journey or external accountant depreciation sign-off. |
| EQ | Source: owner/officer money, dividends/opening and register paths; existing tests executed. Owner and accountant browser: empty people register. Allocation helper independently checked. | No full browser declaration/payment journey or verified recipient tax classification. |
| Import/restore/direct DB | Narrow adjacent review of master-import commit and backup restore handling. Existing suite plus own UPDATE/DELETE rejection checks. | No actual destructive restore or operating-system tamper test; do not infer protection from a person controlling the DB file. |

Observed screen routes: `/cash/recon`, its created reconciliation detail, `/fa/assets`, `/eq/people`, sign-in and navigation. Owner and accountant sessions were used. Encoder checks were API-only. Production staff and customized permission combinations were not exhaustively assessed. No print-quality, speed, click-count or training-time claim is made.

### Executed commands and outcomes

Commands ran in the isolated application checkout. npm was freshly obtained from the official npm registry, not inherited from the earlier environment. The baseline's Windows workaround was verified locally: `node <tooling>/package/bin/npm-cli.js ci --ignore-scripts`. It succeeded (157 packages); skipped lifecycle scripts remain a setup limitation. TEMP and TMP pointed to the task's own temporary directory.

| Command/check | Actual result |
| --- | --- |
| `npm run typecheck` through the local npm CLI | Passed. |
| `npm run build -w @moonproject/web` | Passed; large-chunk warning, not treated as a proven usability problem. |
| `npm test -- --hookTimeout=60000 --maxWorkers=2` | **230 files passed, 3 failed; 1,596 tests passed, 5 failed, 1,601 total.** Not an all-green suite. |
| Year scenario retry after LF normalization of its own checked-out golden CSVs | **20 tests passed**. Initial failure was Windows CRLF header parsing. |
| Month scenario retry, `-t 'month in the life' --hookTimeout=60000 --maxWorkers=1` | **8 passed, 6 skipped** after LF normalization of the scenario file and golden CSV. The six excluded blind-fixture tests were not re-executed. |
| Plain-Node retry, one worker | **2 assertions passed; suite failed** during `afterAll` directory removal with Windows EPERM. Retrying with broader execution permission did not fix cleanup. This is an environment/test-cleanup failure, not evidence of incorrect accounting. |
| `node e2e/serve-practice.ts`, own E2E_DIR and port 43201 | Ran successfully with fictional data; rendered owner and accountant sessions reached the app. |
| Own six scenario driver using real application handlers and isolated in-memory databases | Completed: date, loan residual, count interleaving, account classification, restricted checks and positive controls. Each scenario's existing invariant checker returned no failures, including the reproduced business errors. |
| Direct money-helper comparison with exact integer arithmetic | Reproduced A1-006. |

Evidence retained locally: `typecheck.log`, `build.log`, `tests-full.log`, `tests-year-lf.log`, `tests-month-lf-retry.log`, `tests-plain-node-retry.log`, own reproduction output and reconciliation screenshots. Logs containing restricted material are private and excluded from this PR. Line-ending normalization only affected disposable test/fixture files, not application source; none is published. Failed commands and retries are retained. Ordinary lifecycle-script installation and all default-command behavior are not claimed to pass.

## 2. Findings

### A1-001 — An account can be accepted as an asset but reported as revenue

**Confirmed defect; Medium; high confidence, observed API/report output plus code.** Affects the accountant creating accounts and anyone relying on financial statements. Wrong account setup is contained and avoidable, but the application accepts contradictory data and a balanced statement does not expose the mistake.

At the baseline, `apps/server/src/modules/acc/routes.ts:22` accepts code and type independently. `apps/server/src/modules/rpt/statements.ts:156` and `:194` classify by the first digit of the code. Created fictional code `4999`, type `asset`, debit normal side; posted a balanced ₱100 debit to it and credit to retained earnings. The balance sheet reported assets ₱0, equity ₱0 and current earnings −₱100, and still reported balanced; the income statement showed −₱100.

Expected: reject the contradictory classification before use, or consistently classify from the stored account type. Actual: accepted as an asset, displayed in revenue-based results. Mitigations considered: accountant-only setup, valid code range, normal-side handling and balanced journals; none reconciles these two classifications.

Remedy: define one account-classification rule, validate it during creation and audit already-created accounts before changing reports. Preserve legitimate contra-account normal sides. Verify every type/code combination, contra accounts and migrated custom accounts against trial balance and statements. **Effort: medium**, including existing-data review; no automatic historical relabeling recommended.

### A1-002 — A reduced final loan payment leaves debt without a payable instalment

**Confirmed defect; Medium; high confidence, observed API scenario plus code.** Affects accountants recording the lender's actual allocation. Remaining debt is still visible in the ledger, so this is a contained workflow and follow-up failure, not proved lost money.

`apps/server/src/modules/loan/doctypes/payment.ts:77` treats any posted payment against an instalment as paid; `apps/server/src/modules/loan/loans.ts:82` and `:108` use that marker for the schedule and next due. The form permits an altered principal/interest split with a note.

Reproduction: create a ₱1,000, zero-interest, one-month loan due 5 October; record ₱500 principal with a reason. Posting succeeds. The register then shows ₱500 owed but `nextDue: null`; the next-day late list is empty. Trying to pay the remaining ₱500 against the sole instalment returns `PAID` (422).

Expected: an accepted partial/changed payment leaves an actionable residual or an explicit rescheduling workflow. Mitigations: the balance remains correct, overpayment is blocked, cancellation is available, and an accountant could journal manually. Cancelling a real earlier payment to combine later cash events is not a faithful ordinary solution; a manual journal bypasses the loan schedule.

Remedy: track instalment principal/interest remaining, or provide an explicit audited schedule adjustment and terminal residual payment. Verify partial, interest-only, changed allocation, final short payment, cancellation and reissue, with late-list and ledger agreement. **Effort: medium**; agree the lender-allocation policy first.

### A1-003 — A cash count can post an adjustment different from the confirmed preview

**Confirmed defect; Medium; high confidence, observed interleaved API sequence plus form/engine source.** Affects authorized cash counters when another entry posts between preview and confirmation. Likelihood increases with several encoders; the reproduced error was only ₱10 and is not Critical.

`apps/server/src/modules/cash/doctypes/count.ts:51` recomputes the ledger and difference but uses the counted amount as `totalCents`. `apps/server/src/engine/documents/lifecycle.ts:141` checks only that total against the confirmation. The cash-count form confirms that same total.

Reproduction: ledger ₱100; preview physical count ₱100, difference zero. Post a legitimate ₱10 transfer out. Submit the same count and its confirmed ₱100 total. It succeeds and records a ₱10 overage adjustment; no warning was returned. The recorded adjustment was not the one reviewed at preview.

Expected: require a fresh confirmation when the relevant ledger position or adjustment changes. Atomic balanced posting is a useful mitigation but only makes the newly calculated result internally consistent. The large-difference warning also does not cover this small interleaving.

Remedy: include a cash-position/version or computed-adjustment token in confirmation and reject a stale count until re-previewed. Specify the physical count's cut-off time. Verify a transaction before preview, one between preview/save, identical retry and concurrent counts. **Effort: medium**; touches the confirmation contract and screen.

### A1-004 — Backdating accepts a day that does not exist

**Confirmed defect; Medium; high confidence, observed accountant API posting plus code.** Affects permitted backdated entries and period-based reports. A normal date picker reduces accidental entry, but the server accepts invalid calendar data.

`apps/server/src/engine/documents/lifecycle.ts:67` checks format and comparison with today, not calendar validity. A balanced accountant JV with the requested date `2026-02-30` and a late-entry reason returned 200 and stored that date in the document and journal. A trial balance through 28 February excluded the ₱100 movement; through 1 March included it.

Expected: reject nonexistent dates before numbering, journal or document writes. Actual: an impossible date acquires a traceable posted record. Mitigations considered: backdate permission, no future date, balanced JV, UI date input and TEXT storage; none validates the day at this server boundary. Shared calendar validation already exists.

Remedy: use real business-date validation consistently, including effective-date inputs after separate review. Verify leap days, day zero, month 13, 30 February, valid month/year ends and no writes on rejection. Existing malformed historical dates need an accountant-reviewed correction process. **Effort: small** for validation, potentially medium for data review.

### A1-005 — Authorized reconciliation reopening is absent from the screen

**Usability issue; Medium; high confidence, observed owner/accountant screens and code-proved missing action.** An accountant correcting the latest finished statement has no ordinary browser path to an existing supported operation. No incorrect bank balance was demonstrated.

`apps/server/src/modules/cash/recon.ts:215` implements reopening the latest reconciliation with a reason and an audit entry. The permission-controlled route is registered in `apps/server/src/modules/cash/routes.ts:73`. `apps/web/src/modules/cash/BankRecon.tsx` renders the finished report and any existing reopen reason (`:148`), but has no reopen action. Both owner and accountant viewed the same fictional finished October reconciliation; the statement value was disabled and no reopen control appeared. The accountant observation is the relevant one; owner access alone would not prove a defect.

Expected: users with the reopening permission can invoke that operation with an explanation. Mitigations: the underlying operation, latest-month restriction and audit trail already exist. Current owner guide `32-bank-reconciliation.md:26` instead tells users that a finished statement cannot change.

Remedy: expose a permission-aware “Reopen latest reconciliation” control, collect the required reason and explain why older months are unavailable; update the guide. Verify allowed accountant, denied encoder, earlier-month rejection and preserved audit history. **Effort: small**; no new accounting operation is needed.

### A1-006 — Large proportional allocations can give the remainder cent to the wrong recipient

**Confirmed defect in the helper; Low; high confidence in direct arithmetic reproduction, code-proved downstream use.** The demonstrated total remains correct; this is a one-cent allocation error at unusually large values, not a loss of the overall amount. A full dividend document using these values was not executed.

`packages/shared/src/money.ts:66` multiplies integer centavos by weights using JavaScript numbers, whose product need not remain a safe integer. For total `9999997013` cents and weights `[999999752,999999889,999999465]`, observed allocation was `[3333332504,3333332962,3333331547]`. Exact integer largest-remainder arithmetic gives `[3333332504,3333332961,3333331548]`. These are large but within the reviewed dividend amount/individual share bounds; dividend distribution uses this helper.

Expected: exact largest-remainder allocation with stable tie ordering. Input integer checks and preservation of the sum mitigate corruption but do not make intermediate multiplication exact. Small positive and negative splits passed.

Remedy: use exact integer products/remainders, or establish and enforce a safe product bound. Verify exact BigInt oracle comparisons near limits, negative totals, ties and zero weights, then one real dividend workflow. **Effort: small**; review other callers before release.

### A1-007 — The owner guide incorrectly says asset sales cannot be recorded

**Usability issue; Low; high confidence, code-proved documentation contradiction.** A shop owner following the overview could use a manual workaround for a supported workflow. Actual reader confusion was not measured.

Current `docs/owner-guide/36-fixed-assets-loans-owners.md:13` and `:31` state that only retirement is possible. Baseline `apps/server/src/modules/fa/doctypes/disposal.ts:37` accepts retirement or sale and the subsequent path computes proceeds, VAT and gain/loss, validates the manual invoice, and persists the sale. The focused disposal guide also describes selling.

Expected: consistent guidance pointing to the supported sale procedure. Remedy: replace the obsolete restriction with a link and a short retirement-versus-sale explanation. Verify against a rendered sale journey and keep both guides consistent. **Effort: small**. This is not a legal conclusion about every asset sale's tax treatment.

**Restricted findings require private review.** Their details and verification evidence are excluded from this public report and PR.

## 3. Enhancements

| ID / priority | User problem and evidence | Existing equivalent checked; expected benefit | Effort, dependencies and complexity |
| --- | --- | --- | --- |
| A1-I01 / Low | The rendered Money menu uses “Loans” for the register and loan documents, and similarly “Fixed assets” / “Fixed Assets” for different destinations. A new encoder must infer the distinction. | Both routes already exist; label them “Loan register” / “Loan documents”, and distinguish asset register from purchases. No extra feature needed. | Small; navigation labels and guide consistency; negligible added complexity. |
| A1-I02 / Medium, after correctness work | A balanced journal and passing invariant checks did not catch A1-001 or the stranded debt in A1-002. Operators would benefit from a short exception list during review. | Month-end checks and loan balance/late list already exist. Extend those with “balance outstanding, no next instalment” and contradictory account classification checks; do not add a competing dashboard. | Small to medium; reuse existing checks after agreeing correction policy; some maintenance burden as account rules evolve. |

The remedies in section 2 are defect/usability corrections, not additional feature requests. No new analytics, automation or commercial integration is proposed without a demonstrated shop need.

## 4. What works well and should be preserved

- **The central posting boundary is useful.** The reviewed engine wraps document persistence, journal, numbering and idempotency in a database transaction. The ledger writer validates balanced integer lines. The own failed reissue returned 422 while leaving the original posted; a valid cancellation succeeded with the mirror entry. Preserve that single transaction boundary when fixing confirmation and loan handling.
- **Retry behavior has concrete evidence.** Two same-key requests in the own scenario returned the same document ID. This supports retry safety in that application process; it is not a power-loss or multi-process proof. Internal document/journal series and uniqueness checks make records traceable; statutory booklet numbering is a separate question.
- **Ledger-based balances and immutable accounting records reduce accidental edits.** Own direct UPDATE of a journal line and DELETE of a document were rejected by database triggers. Reviewed imports commit limited master-data types rather than editing posted journals. Backup restore retains the replaced database before replacement in the reviewed path. Preserve these controls, while separately validating recovery and file-access policy.
- **Manila date and year rollover behavior passed useful samples.** The clock changed from 31 December to 1 January at 16:00 UTC. A prior-year expense appeared in earlier earnings on 1 January while current-year earnings were zero and the balance sheet remained balanced. Closing is represented in reports; this is not proof of every year-end accounting adjustment or filing.
- **Small centavo splits are exact and deterministic.** Splitting 100 equally gave 34/33/33; −100 gave −34/−33/−33. Preserve tie ordering while addressing the large-product defect.
- **Useful guardrails already exist.** The reviewed loan payment validates changed splits with a reason and prevents principal above debt; reconciliation requires zero difference before finishing and restricts reopening to the latest period; disposal distinguishes retirement from sale and tracks the booklet reference. Their presence was considered before raising findings.
- **The local Windows app is executable with the documented setup workaround.** Typecheck, build, most of the broad suite and actual owner/accountant screens ran. No claim about visual polish beyond the screens inspected, or about the production installation, follows from that success.

## 5. Gaps, questions and continuation

Exact remaining validation for this PARTIAL audit:

1. Exercise crash/interruption during save, restart and retry, plus separate-process/concurrent-user numbering and posting; verify recovery with no duplicate or unexplained allocated numbers. In-process same-key success is insufficient.
2. Complete rendered ACC account/JV/opening/month-end/year-end, CASH transfer/count/adjustment, LOAN full repayment and FA purchase/depreciation/disposal, and EQ capital/officer/dividend journeys. Include cancellation/reissue after later dependent documents, with owner, accountant, encoder and denied-role cases. Existing tests/source sampling do not establish these user journeys.
3. Independently recalculate representative loan interest methods and depreciation across month end, leap year, salvage limits, catching up missed months and retirement/sale; agree contractual/accounting policies. Run the large-value allocation through an actual dividend document.
4. Execute a disposable backup/restore and attachment recovery drill, examine month-end sign-off invalidation after backdated entries, and establish how the shop preserves records across restore. Do not use production data. File-controller resistance and every import/restore path remain unassessed.
5. Resolve the Windows plain-Node cleanup failure in the test environment and review the excluded blind-fixture checks only at reconciliation or with fresh authorized fixtures. Keep initial failures visible; do not describe this run as all tests passing.
6. Complete private review and remediation verification for restricted findings. No restricted evidence belongs in a public PR.

Owner/accountant questions, not assumed answers:

- How should a lender's short final payment, changed split or rescheduled loan be represented? The accepted payment must not erase follow-up visibility while principal remains owed.
- Which opening date, prior-year closing entries, account-code conventions, fixed-asset useful lives and depreciation policies has the accountant approved? What prevents double-counting prior-system balances and virtual retained earnings?
- Which specific manual invoice authorities, series and supplementary records apply to this shop? The supplied brief says VAT-registered and manual booklet invoices. BIR **RMC 77-2024 Digest**, issued **11 July 2024**, page 1 discusses VAT invoice issuance and page 3 distinct invoice numbering/series. This was consulted as primary context, not proof that internal JE/TRF series meet invoice requirements. Confirm the actual shop registration and applicable **2026 transaction-period** issuances with the accountant before reaching a compliance conclusion: [BIR primary digest](https://bir-cdn.bir.gov.ph/BIR/pdf/RMC%20No.%2077-2024%20Digest.pdf).
- Confirm tax classification of dividend recipients, asset disposals and miscellaneous receipts before relying on software tax settings. No 2026 rate or legal exemption is certified here; comprehensive current legal applicability and record-retention obligations remain **unverified**.

Continuation should reuse only this task's own isolated evidence and the permitted baseline until reconciliation. Application remains pinned to the SHA above even when main advances. Preserve initial logs and add revisions; do not replace failed outcomes with passing retries. No production action, accounting adjustment, external filing, real payment or customer email was performed.

## 6. Adjacent observations

The financial-statement classification path in RPT is directly implicated in A1-001 and was inspected only to establish the accounting consequence. Test cleanup/CRLF portability is relevant to later environment/test review; this report does not establish a production installation defect. The conflicting owner guide is A1-007. No other auditor's conclusions were consulted to reach these observations.

Only this report is proposed for publication. No application code, fixture normalization, database, screenshot, log or private companion is part of the PR.
