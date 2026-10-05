# A11 — Ease of use, repetition and speed

Audit run: `codex2-independent-01`. Application baseline: **`d4bc1ef84f2771a9f8720f199c9cd4d831dbc949`**. Review and execution: **5 October 2026, Asia/Manila**. Auditor: Codex; exact model identifier and reasoning effort were not independently exposed.

**Overall status: COMPLETE FOR STATED SCOPE.** This is a completed heuristic review of the role menus, form entry screens and the routine daily-task samples defined below. It is not exhaustive transaction testing, real first-day user research, or certification of safety or legal compliance. The remaining validation is listed in section 5; passing tests does not establish complete correctness.

The routine sales path is reasonably economical: a quotation can become a job order without retyping its lines, saved measurements can be selected, collections open with the customer and suggested amount, and a release can record its manual invoice at the same time. The clearest problems are losing unsaved attendance while changing periods, the easily misunderstood replacement of a measurement chart, and a default TV account that cannot open its board. Several smaller language and repetition problems also deserve attention.

## 1. Scope, isolation and evidence

### Workspace and independence

- Actual platform: **Microsoft Windows NT 10.0.26300.0**, PowerShell, Node `24.19.0`, `win32 x64`.
- Verified source root: `%USERPROFILE%/Documents/Codex/2026-10-05/cloud-environment-plugin-cloud-environment-openai/moonproject-independent-audit`. The directory existed; `git rev-parse --show-toplevel` returned exactly this root; origin was `https://github.com/virtusrickandmorty/moonproject`.
- Registered source checkout: clean `main`, initially at the application SHA; after fetch it was one commit behind `origin/main`. It was not switched, reset or edited.
- Fetched current main and report parent: `bc2684ba0e40fb24ce28027cf7d220b0a822547c`, rechecked before publication. The only audit-folder input was its `00-baseline.md`. No A11 report was on that main and the same-run A11 PR-title search returned none.
- Separate task-owned application checkout: sibling `a11-work/application`, detached at the baseline. Separate report checkout: `a11-work/report`, branch `audit/codex2-independent-01-a11`, from current main. Both are outside the verified registered repository root.
- Task-only tools, scripts, screenshots, JSON evidence and command logs are in sibling `a11-local-tools`. The practice database is under its `practice-runtime/practice`; no existing database was reused. An additional short temporary folder, `Documents/Codex/a11-temp-codex2-01`, was used only for the cleanup-test retry.
- Read `AGENTS.md`; followed the owner's exceptions for deferred read-first links and report ownership. Did not read `docs/PLAN.md`, `docs/STATUS.md`, `docs/review/`, `docs/research/`, other audit reports, PR discussions, old chats, other Virtus applications or shop folders. No accidental exposure to earlier audit conclusions is known. Existing automated tests and their fixtures were executed; their outcomes were not treated as earlier reviewers' opinions.
- Only A11 was audited. No subagents or simultaneous substantive area audits were used. No application code or tracked test assertions were changed, and no findings were fixed.

### Corrected business context supplied by the owner

These corrections take precedence over conflicting baseline-brief wording. They are supplied facts to verify, **not proof of statutory compliance**:

1. Both sales invoices and collection receipts normally come from pre-printed BIR-authorized booklets. Staff enter the booklet numbers; the app records documents and accounting entries. The app prints its own collection receipt only when the accountant selects system mode. The owner describes Moonproject as an internal, unregistered system, not a registered CAS; official books are printed loose-leaf from it.
2. There are three co-owners with the owner role, one accountant, three encoders, production staff and a TV display login. Usually one person uses the system, occasionally two.
3. The shop PC serves the LAN and must support local work without internet. Outside access will use an owner-configured tunnel; its method is not final.
4. It replaces two systems used together: a Google Sheets/Apps Script application and an older desktop application. Neither older system was inspected.
5. Some customers withhold tax and provide BIR 2307s. The shop reports no senior/PWD discount. Job orders can receive downpayments. Workers are paid per day or per piece using production entries. SSS, PhilHealth and Pag-IBIG can be enabled/disabled per employee. Inventory is periodic.

The run used fictional practice data and manual booklet-number entry. No production data, real email, payment, filing or external operational action was used. No conclusion about tax rates, contribution opt-outs, registration, loose-leaf authorization or receipt legality is made here; those require applicable primary law and accountant/owner facts beyond this usability review.

### What was actually checked

| Role | Available menu destinations opened at 1024 px | Creatable document forms opened | Interaction depth |
| --- | ---: | ---: | --- |
| Encoder | 64 | 26 | Customer, wearer/measurements, quotation, new JO, quotation conversion, downpayment, collection, release, quick sale, expense, cash count, attendance; searches, revisions and error cases |
| Production | 18 | 1 | Board, job-step dialog, recording pieces, completing steps, TV display |
| TV | 4 | 0 | Fresh account sign-in and direct board attempt; default account cannot use the board |
| Owner | 164 | 38 | Menu and form sweep; Home, business figures, role-management controls and representative reports inspected; fictional TV account setup |
| Accountant | 159 | 60 | Menu and form sweep; employee/pay setup, attendance prerequisites, weekly payroll calculation and release |
| Total role/screen visits | **409** | **125** | Counts include shared screens under each role, not 534 unique screens |

The menu sweep rendered each destination, captured its text and screenshot, and checked browser errors and HTTP failures. All 409 visits completed without a page exception or HTTP 4xx/5xx during those visits. The two Backups visits correctly reported that this disposable shop had not configured recovery keys or made a backup. This is screen-opening evidence, not proof that every button or permission is correct. The TV board is absent from the TV menu, so the separate direct-board check was essential.

The 125 form visits inspected initial rendered content, choices and page width; they did **not** submit every accounting document. Opening forms that need a cut-over date, a VAT quarter already closed in the fixture and empty income-tax periods showed specific state explanations. They were not counted as application failures. Posting coverage is the daily-task sample below.

Laptop viewport: **1024 × 900**. Phone viewport: **390 × 844**, Chromium viewport emulation, not a physical handset. All 23 phone route samples fit the document width; attendance/board/report tables can scroll inside their containers. Visual and interaction inspection included these phone routes:

- Encoder: `/`, `/cus`, `/docs/jo.job_order/new`, `/docs/quo.quotation/new`, `/docs/col.collection/new`, `/docs/jo.release/new`, `/docs/qs.sale/new`, `/docs/exp.voucher/new`, `/docs/cash.count/new`, `/emp/attendance`.
- Production: `/`, `/prd/board`, `/docs/prd.entry/new`, `/prd/tv`.
- Owner: `/`, `/rpt/monthly-owners-pack`, `/rpt/ar-aging`, `/acc/settings`.
- Accountant: `/docs/pay.run/new`, `/docs/pay.release/new`, `/rpt/payroll-register`.
- TV: `/`, `/prd/tv`.

A quick sale was actually recorded on the phone layout. Mobile menu open/close, new-document search, wearer search, attendance period navigation and measurement revision were interacted with. The laptop daily-task counts must not be read as measured counts for every phone task. Screenshots from this run, rather than old guide screenshots, supported the visual judgments. The exact wider route manifest appears at the end.

### Installation, commands and outcomes

Commands ran in the separate application checkout. Local npm `11.6.2` and a separate Playwright Chromium `153.0.8010.12` installation were bootstrapped for A11. The practice fixture was `e2e/serve-practice.ts`, with a fresh `E2E_DIR` and port `43211`. Open fictional work was added using the existing `e2e/practice-work.ts` helpers. TV setup followed the repository's practice-user pattern.

| Check | Outcome and limitation |
| --- | --- |
| Repository preflight and `fetch origin main` | Correct root/origin; successful fetch after repairing the local Git runtime. Bundled Git initially lacked its HTTPS helper. A disposable MinGit download and per-command `safe.directory` handled the local installation/ownership issue; no global Git configuration was changed. |
| `node <local-npm>/bin/npm-cli.js ci --ignore-scripts` | Exit 0; 157 packages installed. Used the baseline's explicit Windows workaround. Ordinary lifecycle-script installation was not re-certified. |
| SQLite in-memory check | Exit 0; shipped native prebuild loaded, SQLite `3.53.4`. |
| `npm run typecheck` through local npm | Exit 0. |
| `npm run build -w @moonproject/web` | Exit 0; existing Vite warning about a large bundle. Main JS output approximately 1,238 kB / 307 kB gzip. Bundle size alone is not evidence of perceived slowness. |
| `node e2e/serve-practice.ts` | Started the isolated fictional shop; actual browser logins and transactions worked. Did not assume previous tasks' dependencies or server survived. |
| Full suite, `npm test -- --hookTimeout=60000 --maxWorkers=2`, restricted account | Account lookup failed inside a tsx child (`uv_os_get_passwd`); interrupted for an environment repair. This was not a product-usability finding. |
| Same suite in working Windows account context | 230 files passed; 3 failed files; 1,597 tests passed and 4 failed. Failures included CRLF-sensitive golden fixtures plus temporary-directory cleanup. |
| Restoring Git's original file bytes | Original commit blobs had LF; portable Git's `core.autocrlf=true` had produced CRLF working files. `checkout-index` did not rewrite unchanged files; an initial archive also retained conversion. A Git archive made with **`-c core.autocrlf=false`** restored verified original LF bytes. Tracked diff remained empty. Two ineffective-repair suite attempts were stopped; their logs were retained. No assertion, fixture meaning or application code was patched. |
| Full suite after verified LF restoration | **1,621 / 1,621 test assertions passed; 232 / 233 files passed. Exit 1:** `apps/server/test/plain-node.test.ts:28` failed in `afterAll` removing its temporary directory with `EPERM`, after both tests passed. Duration 314.30 s. This is not a green full-suite result. |
| Isolated `plain-node.test.ts`, one worker, fresh shorter TEMP path | Both assertions passed; the same cleanup failure remained, exit 1. No further repeated full-suite runs were used to hide this result. |
| A11 browser drivers | All daily tasks in the table completed. Initial driver locator/timing mistakes were corrected and preserved as harness failures, not reported as ERP defects. |

Relevant passing tests include the web shell/menu, customer/measurement, quotation/JO, collection/quick sale, production/TV, attendance/payroll and document-screen tests within that full run. Their passing result does not negate the independent runtime findings below. The normal repository green-test condition remains unmet by the Windows teardown failure; this requested report-only PR records it and does not change code or propose a merge.

Command logs and scenario JSONs are retained as A11 recovery artifacts outside the repository. Useful files are `logs/tests-original-lf.log`, `logs/plain-node-short-temp.log`, `evidence/measure-*.json`, `evidence/reproduction-results.json`, the role tour manifests and the screenshots named by those manifests. No credentials, database, raw log or screenshot is included in the public diff.

### Daily-task measurements

**Counting method:** performed in the actual browser. `P` = distinct application pages visited after the stated starting point; `D` = confirmation/step dialogs. Embedded customer panels count as one page, not separate routes. `C` = actual automated click calls, including a click to focus each typed box. `S` = native dropdown selections made with Playwright `selectOption`, reported separately; these are **not invented mouse clicks**. `F` = boxes actually typed, including search boxes. Login, opening menu groups, scrolling, typing individual keystrokes and fixture setup are excluded. Counts describe the recorded path, not a minimal path or a typical worker's measured time. Future counts are estimates under the same convention unless identified as an existing observed shortcut.

| Daily task / role | Start and sample | Current P + D; C / S / F | Practical change | Estimated future P + D; C / S / F |
| --- | --- | --- | --- | --- |
| New customer / encoder | Home, expanded Sales; organization, required name only | 1 + 0; **4 / 0 / 1** | Explain optional accountant-maintained tax details; retain quick creation | 1 + 0; ≈4 / 0 / 1 |
| Measurements / encoder | Customer already open; add one wearer and four upper-body measurements | 1 + 0; **8 / 1 / 5** | Preserve current initial-entry flow; explicit copy-current option for later revisions, A11-002 | Initial entry unchanged. Four-value revision: estimated 2 typed boxes (changed measurement + reason), instead of retyping four values + reason |
| Quotation / encoder | Expanded menu; one catalog item, four pieces, existing customer | 3 + 1; **9 / 0 / 3** | Optional favorite to open quotation directly; catalog price already automatic | 2 + 1; ≈8 / 0 / 3 |
| New JO / encoder | Expanded menu; one made-to-order garment, existing measured wearer, manual price | 3 + 1; **9 / 2 / 3** | Preserve saved-wearer reuse; catalog use can remove manual description/price where configured | Same sampled manual-price path; no universal reduced count asserted |
| JO from quotation / encoder | Saved quotation; accept copied lines, choose payment terms | 2 + 1; **3 / 1 / 0** | Preserve existing conversion; do not build another copying feature | ≈same |
| Downpayment / encoder | Saved JO; accept suggested deposit, choose cash place, enter booklet CR | 2 + 1; **5 / 0 / 1** | Preserve preset; make changed-payment handling clearer, A11-004 | ≈same for accepting the suggestion |
| Production entry / production | Home/menu → board card → existing Sewing step; one worker, six pieces | 3 + 2; **6 / 1 / 1** | Optional clearly named record-current-step action on card, retaining step choice | 3 + 1; ≈5 / 1 / 1 |
| Release / encoder | Saved, fully paid JO with completed production; six pieces | 2 + 1; **6 / 0 / 2** | Preserve quantity and JO prefill plus combined manual invoice entry | ≈same |
| Collection / encoder | Saved JO after deposit; accept suggested remaining balance | 2 + 1; **5 / 0 / 1** | Preserve preset; changed amount should not require ambiguous duplicate entry | ≈same for exact remaining balance; see A11-004 for partial payment |
| Quick sale / encoder, laptop | Menu → sale list; one repair, existing customer, cash, manual invoice and CR | 3 + 1; **11 / 0 / 5** | Use the existing Home shortcut | 2 + 1; ≈10 / 0 / 5 on laptop |
| Quick sale / encoder, phone | Home's existing daily-action shortcut; same kind of one-line cash sale | 2 + 1; **10 / 0 / 5** | Already observed shortcut, not a proposed feature | ≈same |
| Expense / encoder | Menu/list; non-VAT fictional payee, snacks, receipt number/date and cash source | 3 + 1; **10 / 1 / 5** | Optional repeat-payee/template entry; require checking new amount and receipt details | Same pages; roughly 4 typed boxes if payee reuse removes one; selection cost depends on design |
| Cash count / encoder | Menu/list; two denominations in a selected cash box | 3 + 1; **6 / 1 / 2** | Optional daily shortcut; retain denomination entry and independent physical count | 2 + 1; ≈5 / 1 / 2 |
| Attendance / encoder | Menu; mark two employees present today; save together | 1 + 0; **2 / 2 / 0** | Preserve batch save; guard unsaved navigation | ≈same on successful save; extra dialog only when leaving unsaved work |
| Payroll week / accountant | Home/menu; employee/pay settings and six attendance days already recorded; calculate and release weekly run | 5 + 2; **10 / 0 / 1**, including one rejected blank-amount attempt | Fill selected net pay for a single cash source, A11-006 | 5 + 2; ≈8 / 0 / 0 |

Payroll prerequisites were actually performed: a fictional daily-paid employee in the weekly group, six present days, then a run containing those earnings. Its net pay was calculated by the app and released. The sample does not validate contribution or tax legality. Production used an existing route, selected a worker, typed only the piece count and used the stored piece rate. Completing production steps was exercised separately; completing a step and recording payable pieces have different purposes and should not be merged blindly.

Default due days, today's document date, catalog prices, garment quantities from wearers, customer and JO references, default single-tender quick-sale/expense totals, suggested collection amounts and production rates were reused where present. Manual booklet numbers, the claimant's identity and the physical cash count describe external facts; removing those entries would remove necessary evidence. The app is not expected to replace the shop's physical booklet with an automatic number.

### Screen waits and learning effort

Five warm local navigations per screen were measured after the test suite/form sweep finished. Timing ran from browser navigation through a named content element becoming visible, followed by two animation frames. It is a small local render-readiness sample, **not human task time**, a full-load benchmark or a remote/LAN guarantee.

| Screen / role | Median | Observed range, five runs |
| --- | ---: | ---: |
| Customers / encoder | 83 ms | 66–94 ms |
| Job-order list / encoder | 100 ms | 84–119 ms |
| Collection form cash choices / encoder | 99 ms | 83–150 ms |
| Production board / production | 84 ms | 83–113 ms |
| Saved payroll details / accountant | 102 ms | 82–158 ms |

No slow-screen defect is established by these samples. The small fictional dataset, warm caches, loopback connection and headless browser limit transfer to the real shop. A first timing attempt targeted a payroll employee region that no longer existed in the next unrecorded period after the workflow test; that harness timeout was excluded, and the saved payroll was explicitly measured instead. The 30-second production refresh and 12-second TV page rotation are visible/documented controls and code-backed intervals, not measured human waiting times.

A source-informed simulation cannot measure novice learning. A **planning estimate only** is 2–4 hours of guided practice plus a supervised shift for routine encoder work after role duties and tax profiles are configured. Payroll, corrections and exceptions would need separate training and accountant escalation; this estimate is not a promise that a novice can safely handle all 64 destinations. Validate it with the actual three encoders, using unprompted tasks and tracking completion, errors and help requests. The first-day/no-accountant heuristic identifies unanswered choices below; it is not real user testing.

## 2. Findings

All file/line references below are at the immutable application SHA unless explicitly described as a guide read from current main. Severity is based on impact and likelihood. No Critical or High finding was established in this sampled area. No financial loss, incorrect garment or incorrect payroll is claimed merely from a confusing screen.

### A11-001 — Changing attendance periods discards unsaved marks

- **Confirmed defect; Medium; high confidence — observed UI and complete source path.** Encoder/accountant attendance entry. Repeated period navigation is plausible during back-entry and can make staff retype work or mistakenly believe marks were retained.
- **Expected:** warn before leaving unsaved marks, or retain them until explicitly saved/discarded. **Actual:** on the phone grid, marked an initially blank day Present; the button showed one pending change. Clicked Earlier, then Later. The day was blank again, with no native or application confirmation. This was an unsaved mark, not a deleted saved attendance record.
- **Evidence:** `apps/web/src/modules/EMP/Attendance.tsx:23`, `:27`, `:42`, `:59`, `:61`: changing the range fetches stored cells and replaces local state. Same-run evidence: `repro-attendance-pending-phone`, `repro-attendance-lost-phone`, `reproduction-results.json`.
- **Mitigations checked:** visible Save changes and Undo changes; successful batch save; paid-period locks. These protect other cases but do not warn on a range change. No cross-page unsaved-work guard was found in the reached path.
- **Remedy / effort:** offer Save / Discard / Stay for pending changes before changing period or route; preserve failed saves. Medium, approximately 1–2 developer days including navigation cases. Do not silently mark blank days as Present.
- **Verify:** edit multiple days, change period, change menu, press Back and simulate a save failure at both widths. Saved values and paid-period locks must remain correct; Stay must keep all pending entries.

### A11-002 — A small measurement correction requires retyping unchanged values, or replaces them with blanks

- **Usability issue; Medium; high confidence — observed UI and server behavior.** Encoder revising an existing wearer's chart. The risk is an incomplete current chart after a changed-only correction; downstream manufacturing harm was not observed.
- **Expected:** clearly distinguish replacing the entire chart from correcting a few measurements, with a deliberate way to reuse the current chart. **Actual:** the new revision opens blank, defaulting to Size preset even for a measured wearer. Switching to Measurements shows previous values as hints. Entering only chest 39 and a correction reason produced an active revision containing only that value; shoulder 16, waist 34 and length 27 remained in the superseded revision, not the new active one.
- **Evidence:** `apps/web/src/modules/CUS/Customers.tsx:168`, `:172`, `:181`, `:193`, `:198`; `apps/server/src/modules/CUS/create.ts:115`–`:139`; `CUS/public.ts:69`. Evidence: `repro-revision-blank-phone`, `repro-revision-partial-phone`. Only one measurement is required for a measured chart; omitted values are stored as null.
- **Mitigations checked:** revision reason, previous-value hints, full history, range warnings and automatic measurement reuse when selecting a wearer for a JO. Earlier data was not erased. A garment-specific partial chart may be intentional; that is why this is a usability issue rather than an assertion that every partial chart is invalid.
- **Remedy / effort:** explicit “Correct current measurements” / “Start a completely new chart” choices; copy only on the former, preserve units/mode, show the changed/cleared values before saving. Medium, approximately 1–2 days. Do not silently carry old measurements into an intended fresh measurement session.
- **Verify:** correct one value, intentionally clear a value, change units, switch preset/measured and inspect both revisions plus a subsequent JO snapshot. Confirm the owner’s preferred remeasurement practice.

### A11-003 — The default TV-board user cannot open the TV board

- **Confirmed defect; Medium; high confidence — fresh role login plus source trace.** The dedicated shop display cannot do its intended job under the supplied default role. Contained because an owner can configure the intended permission; normal staff work can continue.
- **Expected:** the role described in Users as “TV board” should reach its read-only display. **Actual:** the fresh practice TV user had only Home, Settings, Shop certificate and Practice shop in its menu. Home said its role had no screens. Direct navigation to the board displayed a permission refusal and “Not updated yet”; a production user displayed the same fictional cards successfully.
- **Evidence:** `apps/server/src/modules/PRD/index.ts:12` omits TV from the read-only board's default roles; `engine/security/permissions-sync.ts:19`–`:21` applies those defaults only when a permission is first introduced. `apps/web/src/modules/SEC/users.ts:4`, `:12` describes the role; `shell/menu.ts:43` governs discoverability. Evidence: `tv-home`, `form-tv-0`, `phone-tv-1`, contrasted with `form-production-2`.
- **Mitigations checked:** owner Roles and permissions control exists; production can use the display; denial is explained. Do not work around it by giving a wall display an owner account. The finding is unavailable intended functionality, not a claim of a security bypass.
- **Remedy / effort:** include the intended read-only grant for new TV setups and provide an explicit owner-reviewed correction for existing role settings without overwriting custom grants. Small to medium, about half a day plus migration/role testing.
- **Verify:** new database, new TV user, first password change, normal menu navigation and existing database with custom grants. Keep the role read-only and retain the display's initials, stale-data warning and automatic paging.

### A11-004 — Changing a suggested downpayment leaves two amounts to reconcile

- **Usability issue; Medium; high confidence — observed preview and source.** Encoder collecting a different amount from the suggested deposit. This can be misunderstood during a busy counter transaction; the app's arithmetic was consistent with the entered figures.
- **Expected:** one clear “money actually received” amount for a single JO/single tender, with allocation changes explicitly separated. **Actual:** a JO's Take the downpayment filled both amounts with 400. Changing “Pay now on JO…” to 200 left the cash Amount at 400. The preview proposed 400 received, 200 on the JO and 200 kept as customer deposit. No incorrect collection was posted in this reproduction.
- **Evidence:** `apps/web/src/modules/COL/CollectionForm.tsx:134`–`:139`, `:153`, `:227`, `:238`, `:278`; evidence `repro-partial-collection-mismatch`. Accepting the original suggestion worked with no amount retyping.
- **Mitigations checked:** live Received/Applied/Kept as deposit figures, explicit confirmation wording and deposit warning, Apply oldest first, legitimate split payments and legitimate unapplied deposits. These substantially reduce the risk; it is not an unexplained imbalance or proven cash loss.
- **Remedy / effort:** distinguish cash received from its allocation visually and in wording. For a simple one-JO payment, make changing the received amount update the suggested allocation until the user explicitly customizes allocation. Preserve split tender, withheld tax and intentional deposit behavior. Medium, about 1–2 days with scenario testing.
- **Verify:** less/more than suggested, two JOs, two tenders, customer withholding, intentional unapplied deposit and reopening a correction. The preview must continue to explain exactly what will be recorded.

### A11-005 — Customer and expense tax choices still presume accountant knowledge

- **Usability issue; Medium; high confidence about wording, unmeasured novice error rate.** Encoder customer setup, supplier/expense entry and withholding exceptions. The owner says some customers provide 2307s, making this a real workflow rather than an unfamiliar feature to remove.
- **Expected:** staff can enter ordinary facts and identify when accountant setup or the customer's document is needed. **Actual:** the customer editor offers Withholding profile choices such as TWA goods/services and a VAT-registered checkbox without explaining who decides them. Expense entry offers EWT classes and professional-fee distinctions alongside ordinary payee/receipt fields. A first-day encoder cannot infer those classifications merely from a customer's name or an expense description.
- **Evidence:** rendered customer/expense forms, `Customers.tsx:97`–`:103`, `CUS/withholding.ts:3`–`:9`, `EXP/VoucherForm.tsx:30`, `:57`–`:74`, `COL/CollectionForm.tsx:244`–`:266`.
- **Mitigations checked:** minimal customer creation succeeds with only a name; inline JO customer creation is simpler; supplier/category defaults already suggest withholding; a customer profile pre-fills the collection and says to match the 2307; the withholding section is collapsed when unused. Journals are not shown to the encoder. These prevent a claim that every routine transaction requires accounting knowledge.
- **Remedy / effort:** use plain descriptions and an explicit “needs accountant review” handoff where classification is unknown; explain who maintains customer/supplier profiles and which facts to copy from a document. Keep classification controls available to the accountant. Medium, 1–2 days after agreeing the workflow; a new review state may require more work.
- **Verify:** actual encoder tests with ordinary cash customer, withholding customer and uncertain supplier; check correct defaults and escalation without treating “unknown” as legally “none.” Tax percentages shown by the software were not verified for legal applicability in this audit.

### A11-006 — Payroll release asks staff to retype the calculated payout

- **Usability issue; Low; high confidence — executed release and source.** Accountant or owner paying a weekly payroll. Small repeated burden and an avoidable typing-error opportunity, with validation containing the consequence.
- **Expected:** for one selected cash source paying all selected net pay, use the already calculated total while still allowing a split. **Actual:** the release showed 3,409.54 as the total and as grey amount hint. Leaving it blank and pressing Record was refused; typing that same number allowed recording. In contrast, the sampled quick sale and expense accepted a blank single-tender amount as their computed total.
- **Evidence:** `apps/web/src/modules/PAY/ReleaseForm.tsx:38`–`:40`, `:89`; `COL/parts.tsx:66`; `COL/money.ts:25`–`:35`. Evidence: `payroll-release-blank-refused`, `measure-payroll-week.json`.
- **Mitigations checked:** selected employees and total are shown; blank amount is rejected; split payment is available. No incorrect payout was observed.
- **Remedy / effort:** explicit default/“Use selected net pay” for one source; invalidate/recalculate it when employee selection changes. Small, about half a day with tests.
- **Verify:** one source, split sources, deselect/reselect employees, prior partial releases and zero-net employees; never pay the same employee twice.

### A11-007 — Different destinations share nearly identical menu names

- **Usability issue; Low; high confidence — rendered menus and distinct destinations.** Encoder/owner Money menu and accountant/owner report navigation. Likely extra searching, not duplicate accounting records.
- **Expected:** menu labels explain which view to choose. **Actual:** two “Loans” links are in Money (`/loan/loans`, `/docs/loan.loan`). “2307s Received” documents and “2307s received” register, “Opening Balances” documents and “Opening balances” setup, and cash-count entry/history versus its report also have near-identical names.
- **Evidence:** `apps/web/src/shell/menu.ts:31`, `:62`, `:116`, `:126`, `:139`, `:161`; the role menu JSONs and rendered tours. These destinations contain different functions; duplicating the label does not prove duplication of the underlying job.
- **Mitigations checked:** groups, folded sections, document titles and searchable + New. The two Loans items are nevertheless within the same group.
- **Remedy / effort:** “Loan register / Record and view loan documents,” “2307 register / Record a received 2307,” “Opening-balance setup / Opening documents,” with reciprocal links where useful. Small, 2–4 hours plus label/route checks. Consolidate an entry point only after checking owner/accountant requirements; preserve both functions.
- **Verify:** have an encoder find a loan balance and an accountant find received certificates without being told which duplicate label to choose; ensure all existing functions remain reachable.

### A11-008 — A wearer search result does not open the wearer's details

- **Confirmed defect; Low; high confidence — laptop and phone interaction plus code.** Encoder finding measurements by wearer name. Adds another selection/scroll after an apparently direct search result; the customer is still reachable.
- **Expected:** choosing a Wearer result opens that person's details/measurements when permitted. **Actual:** searching Nilo Sample produced a link containing both customer and wearer identifiers, but clicking opened only the customer, with the wearer still a button to choose. This occurred from another screen at both widths.
- **Evidence:** `apps/server/src/modules/NAV/search.ts:22` constructs the wearer link; `apps/web/src/modules/CUS/Customers.tsx:41`–`:47` reads only customer; `:151` selects a wearer after another click. Evidence: `phone-search-wearer-destination`, `search-wearer-not-open`.
- **Mitigations checked:** named result, correct customer, reachable wearer list and existing saved measurements. A suspected stale-customer issue was separately tested: choosing another customer updated correctly, so that hypothesis is **not** reported as a defect.
- **Remedy / effort:** honor the wearer parameter after loading the matching customer and focus/scroll to the named wearer, subject to existing permissions. Small, about half a day.
- **Verify:** direct URL, search from Home and Customers, multiple wearers, unavailable/inactive wearer, Back and phone layout; never select a wearer from the wrong customer.

### A11-009 — Two introductory guide instructions contradict or omit the working UI

- **Confirmed documentation defect; Low; high confidence.** Untrained encoder/accountant using factual owner guides. This increases avoidable uncertainty when no trainer is nearby.
- **Expected / actual:** `docs/owner-guide/01-new-customer.md:26` says adding measurements inside the wearer screen is “coming soon,” although that exact flow was executed. `docs/owner-guide/06-payroll.md:16`–`:22` tells users to choose a run/employees then Record, omitting the required money source and typed amount observed in A11-006.
- **Evidence:** guides read from fetched current main's report checkout; same content exists at the frozen application baseline. Runtime measurements and payroll release verified the discrepancy. No old guide screenshots were used as visual evidence.
- **Mitigation:** broader guides explain production, search and corrections well; app validation names the missing amount.
- **Remedy / effort:** remove the stale note and walk through the actual payroll-release fields; tie future guide review to a browser task. Small, 1–2 hours. Update again if A11-006 changes the amount behavior.
- **Verify:** follow those two short guides literally with a fresh fictional wearer and unpaid payroll; no undocumented step should be necessary.

## 3. Useful enhancements, distinct from defects

| ID / priority | Actual problem and existing capability checked | Proposal, benefit and cost |
| --- | --- | --- |
| **A11-I01 / Medium, owner decision first** | Encoder has 64 available destinations; owner 164. Groups already fold after 20 items, remember their state, and Home offers four role-based daily actions. Counts do not mean all items are simultaneously visible or unnecessary. | Add a small editable set of daily favorites or task landing pages, with the full authorized menu retained. Medium effort; depends on the owner defining encoder duties. Some personalization complexity; avoid another full parallel menu. |
| **A11-I02 / Medium** | Owner Home repeats cash balances in Cash position and How the business is doing; monthly sales/collections are also presented at different summary levels. The sampled phone Home was about 5,600 px tall. Needs attention, daily actions and collapsed role details already help. Evidence: `phone-owner-0`, `DASH/Home.tsx:107`, `:244`–`:246`. | Consolidate repeated figures into one owner summary with report links and optional detail. Medium effort; accountant/owner must choose the information hierarchy. Preserve warnings, period labels, drill-downs and all reports. Benefit is less scanning/scrolling, not fewer accounting records. |
| **A11-I03 / Low, workforce-size dependent** | Attendance already batches changed cells in one Save. On a phone, a half-month grid needs horizontal movement; the sticky employee name and status legend help. Two-worker entry was quick, so a new bulk tool is not justified by the fixture alone. | If the real headcount warrants it, add a selected-day view and explicit “apply this status to selected workers,” followed by review. Medium effort; depends on real attendance practices and holidays/paid locks. Never assume everyone was present. |
| **A11-I04 / Low** | Existing customer, catalog, wearer/group pulling and roster paste already reduce copying; Quick Sale has a Home shortcut. Expense still requires manual description/payee for an off-file repeat purchase. | Optional recent-payee or repeat-expense template that copies only stable facts, then asks for the new receipt/amount/date. Medium effort, depends on actual repetition frequency. Extra template-maintenance cost; do not copy old receipt numbers or silently apply old tax classification. |
| **A11-I05 / Low polish** | See compact details below. These are small clarity improvements, not new workflows. | Small combined effort; preserve existing safeguards. |

| A11-I05 detail | Evidence/location | Benefit / estimate / check |
| --- | --- | --- |
| Replace or omit the standalone “Step 6” under a recorded production entry's plain-language Sewing summary | Observed `done-production-entry`; `generic/DocView.tsx:96`–`:98` | Remove an internal numeric label the worker does not need; small. Keep the named step and document number; verify all production steps display correctly. |
| Explain “Customer or prospect”: choose an existing customer **or** enter a prospect | Rendered quotation form; `QUO/QuotationForm.tsx:87`–`:92` | Small wording help clarifies the alternatives; entering one already clears the other. No new customer database or duplicate search needed; test both paths. |
| Make “today's attendance” easier to locate on narrow screens | `phone-encoder-9`, `EMP/Attendance.tsx:80`–`:117` | Small cue or scroll-to-today control before building a second attendance screen. Check past-period entry remains available. |
| Show where optional keyboard shortcuts work | Production and JO Record controls implement Ctrl+Enter; `PRD/EntryForm.tsx:91`, `:167`, `JO/JobOrderForm.tsx:220`, `:302` | Small visible hint can help repeat users; currently code-backed and partly title-based. Verify shortcut opens confirmation rather than posting without review. A universal keyboard-command system was not justified. |

### Accounting words and what to do with them

These are observed terms or source-backed expansions of visible controls, not endorsements of the displayed tax treatment.

| Terms encountered | Where / who | Plain words or explanation that help |
| --- | --- | --- |
| TIN, VAT registered, Withholding profile, TWA | Customer editor / encoder; supplier/expense setup | Explain the source document and who maintains the classification. Keep an accountant-review route for uncertainty. TIN can be labeled “Tax identification number (TIN).” |
| VATable sales, VAT, downpayment VAT mode A/B/C | Booklet figures, invoice/release details; owner Home/settings | Keep the figures needed to write the manual booklet. Prefer “Sales before VAT” where the accountant confirms the label; explain the selected treatment in words. Do not hide legally relevant amounts or ask encoders to choose a policy. |
| CWT, EWT, ATC, WC158/WC160, 2307 | Collections/received certificates and supplier/expense forms | “Tax the customer withheld,” “Tax withheld from the supplier,” and “Tax code printed on the 2307.” Preserve official codes beside plain labels when copying/verification needs them. Existing “Still to get / Received” wording helps. |
| AR / AP, aging | Owner/accountant unpaid-balance reports and menus | Existing “Unpaid customer balances (AR aging)” and “Unpaid supplier bills (AP aging)” already provide plain words. Keep that convention. These reports serve different parties; do not merge them merely because both are aging reports. |
| Debit, credit, journal, account codes, accrual | Accountant/owner journal vouchers, ledger/financial reports and “Behind the scenes” | Needed for accounting work; keep available. Encoder's sampled posted documents did not show journals. For owners who do not do accounting, collapse technical details and retain a plain outcome/amount first. “Credit” on a customer adjustment still needs context because it is not always a journal-side instruction. |
| Deposits held, unapplied, apply oldest first | Collection and JO summaries | “Customer money not yet assigned to an order” helps explain unapplied deposits. Keep a separate cash-received figure; see A11-004. |
| SIL, OT, Night OT; Weekly (piece rate) | Attendance legend, employee/payroll setup | Existing legend explains most marks and night hours. Expand SIL as service incentive leave and OT as overtime near entry. The executed daily-paid weekly worker still used the group label “Weekly (piece rate)”; consider “Weekly” with pay type shown separately, after owner/accountant confirmation. No legal entitlement conclusion is made. |
| JO, CR, IR, PE and numeric Step | Search, booklet-number fields, document identifiers and production result | Keep traceable document numbers. Expand labels where the worker chooses an action: job order, collection receipt, invoice record, production entry. Replace unexplained internal step numbers with the step name. |

### Hiding or combining by role, without removing necessary functions

The owner was asked whether encoders also handle supplier payments, attendance, loans and owner/officer money. No answer was received during this report. **No proposed item is declared unnecessary merely because the reviewer is unfamiliar with it.** Available menu count is measured; a “needed menu count” is not established without that responsibility decision.

| Role | Proposed primary view | What stays available / decision needed |
| --- | --- | --- |
| Encoder | Customers/measurements, quotations, JO, collection, release, quick sale; production, expense, cash count and attendance if assigned | Keep exception/history and authorized supplier/money work under clearly named groups. Ask the owner before hiding loans, officer money or purchasing. Current four Home shortcuts are a good starting point. |
| Production | Board, record pieces, route/progress controls; rates/sizers as needed | Keep worker-output and production reports discoverable, preferably from a report group. Do not remove rate lookup or separate completion merely to reduce clicks. Clarify whether workers use paper tickets or need measurements on screen. |
| TV | The read-only production display | Fix A11-003 and make the destination obvious. Keep recovery/sign-in/device setup available when needed; do not add broad staff permissions. |
| Owner | Work needing attention, sales/collections, cash, unpaid balances, production and payroll summary | Keep accounting/tax, users, backups and configuration under the full menu. Owners may legitimately review these; favor a simpler default, not forced removal. |
| Accountant | Full accounting/tax/report functions with distinct names and grouped setup tasks | Preserve journals, books, withholding registers, return worksheets, period-close and correction controls. Consolidate duplicate navigation wording, not statutory/accounting outputs based on an unverified assumption. |

## 4. What works well and should be preserved

- **The whole daily sales chain carries context forward.** Actual quotation conversion retained customer/lines/price/quantity; the JO used a stored measured wearer; deposits and balance collection arrived prefilled; release carried the JO and remaining six pieces and recorded a booklet invoice in the same flow.
- **Plain-language confirmation is useful.** The unusual 400-received/200-applied collection explicitly explained the remaining 200 deposit. Keep that summary and review step even when reducing entry work. The sampled encoder views did not expose debit/credit journals.
- **Small screens have useful adaptations.** The tested phone sale completed with stacked fields and accessible sticky Record controls; the menu overlay closes after choosing a destination. Page-level overflow was absent in the sampled routes. Wide attendance/report content uses internal scrolling rather than making the whole page wider.
- **Production needs little typing once configured.** Board → current step → worker/pieces reused JO, step, line and rate. Multiple-worker rows, rework/rate explanations and the separate Complete action exist. The TV display uses customer initials, readable cards, paging and update/staleness information; preserve these while fixing its default login.
- **There are existing tools for repetition.** Customer search, catalog lookup, quotation conversion, group/wearer selection, roster paste, drafts, batch attendance saving and + New search should be taught and reused before creating parallel features. Roster-paste and QR benefits are source-backed here, not measured camera/paste task times.
- **The app distinguishes normal work from exceptions.** Discounts, changed prices, withholding and rework details are folded when unused. Paid attendance is visibly locked. Cancellation/reissue explanations preserve the history rather than implying deletion.
- **Menus and Home already reduce initial scanning.** Long menus fold and remember state; Needs attention and role-based daily actions appear before deeper work. Suggestions above extend these controls rather than pretending they are missing.
- **Manual receipt work is acknowledged.** Required booklet numbers and “Write these on the booklet” figures match the corrected workflow sampled here. This is a usability observation, not certification of legal document status.

## 5. Gaps, open questions and next validation

The stated sweep and every listed routine task were executed. Remaining depth is explicit:

1. **Real novice performance:** no actual encoder/production worker participated; training estimate, comprehension and preferred wording need user testing. No measured human completion time or error rate exists.
2. **Every variant is not covered:** initial menu/form sweeps do not establish every cancellation, correction, discount, split-tender, withholding, import, financial close, report filter or posting path. Only the named daily samples and reproductions were completed. Rare owner/accountant forms were read/rendered, not fully transacted. A separate transaction-correctness audit is still needed.
3. **Phone depth:** 23 routes and the specified mobile interactions were sampled, not all 409 role/menu combinations on a real phone. Physical keyboards, soft-keyboard occlusion, touch accuracy, screen readers, print quality, QR camera scanning and TV viewing distance remain unassessed.
4. **Scale and connectivity:** the 30-day practice fixture and small A11 additions do not represent years of shop records. No two-client contention, offline/LAN outage, tunnel latency or remote-phone benchmark was performed. Those are the next performance conditions to validate before deployment; the tunnel method is still an owner decision.
5. **Role duties:** decide which purchasing, payroll-preparation and owner/officer-money jobs the encoders actually perform. Then test the proposed favorites/grouping with those users. Also confirm whether production reads measurements on paper tickets or requires a direct on-screen view. No numerical “right” menu count is asserted.
6. **Accountant decisions:** identify who verifies customer/supplier withholding profiles, handles unknown classifications and maintains receipt mode. The supplied contribution toggles, no-discount practice, unregistered-system description and loose-leaf process do not establish legal compliance. No 2026 rates or legal applicability have been guessed.
7. **Environment:** ordinary npm lifecycle installation and the default 10-second test hook were not re-certified; A11 used the verified baseline workaround/longer hook. All final test assertions passed, but Windows test cleanup still prevents a clean full-suite exit. Fix that separately and rerun before treating CI or Windows readiness as green.

Source-backed QR capability was checked in `apps/server/src/modules/PRT/print.ts:30`–`:41`: job-ticket QR generation exists. It is not a missing feature to build again. Physical scan success, time saved and each role's destination experience were not measured, so no QR click-count reduction is promised.

## 6. Outside A11 and publication

- **Test portability:** the full-suite cleanup failure is outside this usability area's product findings. `plain-node.test.ts:27` kills child processes and immediately removes their directory at `:28`; Windows handles still being open is a plausible explanation, not a proved root cause. A fresh short TEMP path did not repair it. The two runtime assertions passed. The earlier CRLF fixture failures disappeared after original LF bytes were restored.
- **Practice health notices:** the seeded shop reported unconfigured/stale backups and a nightly-check warning. These were not promoted into shop-data-corruption or deployment findings from this disposable fixture.
- **Legal/security boundaries:** no legal opinion or security assurance is offered. No restricted security finding was established in A11 and **no private security companion was created**. If reconciliation identifies restricted details later, keep them outside the public repository and share them privately with the owner, A12 and Claude #1.
- **Public artifact:** only `docs/audit/codex2-independent-01/11-ease-repetition-speed.md` belongs in this PR. Application code, databases, credentials, raw evidence and tooling are excluded. Report title: `[AUDIT codex2-independent-01] 11 Ease of use, repetition and speed: findings`; assignee requested: `virtusrickandmorty`. Do not merge as part of this task.

### Exact route manifest

The following manifest records the actual menu destinations captured from this task's rendered role sessions. `E` encoder, `P` production, `T` TV, `O` owner, `A` accountant. A role listed means the initial menu destination was rendered in the laptop sweep, not that every operation on it was tested. `/prd/tv` was additionally attempted directly as T and refused. Document rows marked in the final column also had their `/new` forms rendered for those roles. Role differences are observations of default grants, not recommendations to expand access.

| Route | Screen | Menu roles | New-form roles |
| --- | --- | --- | --- |
| `/` | Home | E, P, T, A, O | — |
| `/acc/chart` | Chart of accounts | A, O | — |
| `/acc/go-live-decisions` | Go-live decisions | A, O | — |
| `/acc/month-end` | Month-end checklist | A, O | — |
| `/acc/opening` | Opening balances | A, O | — |
| `/acc/reversals-due` | Reversals due | A | — |
| `/acc/settings` | Settings | E, P, T, A, O | — |
| `/admin/health` | System health | A, O | — |
| `/admin/practice` | Practice shop | E, P, T, A, O | — |
| `/admin/roles` | Roles and permissions | O | — |
| `/admin/shop-certificate` | Shop certificate | E, P, T, A, O | — |
| `/admin/users` | Users | O | — |
| `/ap/suppliers` | Payables by supplier | E, A, O | — |
| `/aud/integrity` | Integrity check | A, O | — |
| `/aud/log` | Audit log | A, O | — |
| `/aud/nightly` | Nightly checks | A, O | — |
| `/bak` | Backups | A, O | — |
| `/ca/employees` | Cash advances owed | E, A, O | — |
| `/cal` | Calendar | E, P, A, O | — |
| `/cash/accounts` | Cash Accounts | E, A, O | — |
| `/cash/book` | Cash book | E, A, O | — |
| `/cash/recon` | Bank reconciliation | A, O | — |
| `/cat` | Price list | E, P, A, O | — |
| `/col/checks` | Checks on hand | E, A, O | — |
| `/col/pdcs` | Post-dated checks | E, A, O | — |
| `/com` | Customer emails | A, O | — |
| `/com/settings` | Customer email settings | O | — |
| `/cus` | Customers | E, A, O | — |
| `/dash/notifications` | Notifications | E, P, A, O | — |
| `/docs/acc.jv` | Journal Vouchers | A, O | A |
| `/docs/acc.opening` | Opening Balances | A, O | A |
| `/docs/ap.advance` | Supplier Advances | E, A, O | E, O, A |
| `/docs/ap.advance_return` | Supplier Advance Returns | E, A, O | E, O, A |
| `/docs/ap.bill` | Supplier Bills | E, A, O | E, O, A |
| `/docs/ap.opening` | Opening Supplier Bills | A, O | A |
| `/docs/ap.payment` | Supplier Payments | E, A, O | E, O, A |
| `/docs/ca.advance` | Cash Advances | E, A, O | E, O, A |
| `/docs/ca.opening` | Opening Cash Advances | A, O | A |
| `/docs/ca.repayment` | Cash Advance Repayments | E, A, O | E, O, A |
| `/docs/ca.writeoff` | Cash Advance Write-offs | E, A, O | O, A |
| `/docs/cash.bank_adj` | Bank Adjustments | A, O | O, A |
| `/docs/cash.count` | Cash Counts | E, A, O | E, O, A |
| `/docs/cash.other_receipt` | Other Receipts | E, A, O | E, O, A |
| `/docs/cash.transfer` | Fund Transfers | E, A, O | E, O, A |
| `/docs/col.allowance` | Allowance for Credit Losses | E, A, O | A |
| `/docs/col.collection` | Collection Receipts | E, A, O | E, O, A |
| `/docs/col.credit_memo` | Credit Memos | E, A, O | A |
| `/docs/col.cwt_only` | 2307s Received | E, A, O | E, O, A |
| `/docs/col.deposit_transfer` | Deposit Transfers | E, A, O | E, O, A |
| `/docs/col.forfeit` | Deposit Forfeits | E, A, O | O, A |
| `/docs/col.refund` | Customer Refunds | E, A, O | O, A |
| `/docs/col.write_off` | Bad Debt Write-offs | E, A, O | A |
| `/docs/eq.dividend` | Dividend Declarations | A, O | A |
| `/docs/eq.dividend_payment` | Dividend Payments | A, O | O, A |
| `/docs/eq.officer` | Officer Transactions | E, A, O | E, O, A |
| `/docs/eq.opening` | Opening Officer Balances | A, O | A |
| `/docs/eq.owner_money` | Owner Money | E, A, O | E, O, A |
| `/docs/exp.voucher` | Expense Vouchers | E, A, O | E, O, A |
| `/docs/fa.buy` | Fixed Assets | A, O | O, A |
| `/docs/fa.depreciation` | Depreciation Runs | A, O | A |
| `/docs/fa.disposal` | Asset Disposals | A, O | O, A |
| `/docs/fa.opening` | Opening Fixed Assets | A, O | A |
| `/docs/inv.count` | Inventory Counts | E, A, O | E, O, A |
| `/docs/jo.dp_invoice` | Downpayment Invoice Records | E, A, O | E, O, A |
| `/docs/jo.invoice_record` | Invoice Records | E, A, O | E, O, A |
| `/docs/jo.job_order` | Job Orders | E, A, O | E, O, A |
| `/docs/jo.opening` | Opening Job Orders | A, O | A |
| `/docs/jo.release` | Release Slips | E, A, O | E, O, A |
| `/docs/loan.loan` | Loans | E, A, O | O, A |
| `/docs/loan.opening` | Opening Loans | A, O | A |
| `/docs/loan.payment` | Loan Payments | E, A, O | E, O, A |
| `/docs/pay.release` | Payroll Releases | A, O | O, A |
| `/docs/pay.run` | Payroll Runs | A, O | O, A |
| `/docs/pay.thirteenth` | 13th-Month Pay | A, O | A |
| `/docs/prd.entry` | Production Entries | E, P, A, O | E, P, O, A |
| `/docs/pur.po` | Purchase Orders | E, A, O | E, O, A |
| `/docs/pur.rr` | Receiving Reports | E, A, O | E, O, A |
| `/docs/qs.sale` | Quick Sales | E, A, O | E, O, A |
| `/docs/quo.quotation` | Quotations | E, A, O | E, O, A |
| `/docs/stat.opening` | Opening Statutory Payables | A, O | A |
| `/docs/stat.remittance` | Remittances | A, O | O, A |
| `/docs/tax.bir_payment` | BIR Payments | A, O | O, A |
| `/docs/tax.it_provision` | Income Tax Provisions | A, O | A |
| `/docs/tax.it_settlement` | Income Tax Settlements | A, O | A |
| `/docs/tax.opening` | Opening Withholdings | A, O | A |
| `/docs/tax.payable.opening` | Opening Tax Payables | A, O | A |
| `/docs/tax.uncollected_vat` | VAT on Uncollected Receivables | A, O | A |
| `/docs/tax.uncollected_vat_recovery` | VAT on Recovered Receivables | A, O | A |
| `/docs/tax.vat_close` | VAT Closes | A, O | A |
| `/emp/attendance` | Attendance | E, A, O | — |
| `/emp/employees` | Employees | E, A, O | — |
| `/emp/holidays` | Holidays | E, A, O | — |
| `/emp/leave-balances` | Leave balances | E, A, O | — |
| `/eq/people` | Owners and officers | E, A, O | — |
| `/fa/assets` | Fixed assets | A, O | — |
| `/loan/loans` | Loans | E, A, O | — |
| `/mig` | Import old data | O | — |
| `/pay/2316` | 2316 and alphalist | A | — |
| `/pay/loans` | Government loans | A, O | — |
| `/prd/board` | Production board | E, P, A, O | — |
| `/prd/rates` | Piece rates | E, P, A, O | — |
| `/prd/tv` | TV board | P, A, O | — |
| `/prt/company-profile` | Company print details | O | — |
| `/prt/test-pack` | Printer test pack | O | — |
| `/pur/suppliers` | Suppliers | E, A, O | — |
| `/pur/supplies` | Supplies | E, P, A, O | — |
| `/rpt/ap-aging` | Unpaid supplier bills (AP aging) | A, O | — |
| `/rpt/ar-aging` | Unpaid customer balances (AR aging) | A, O | — |
| `/rpt/assets` | Fixed-asset schedule | A, O | — |
| `/rpt/balance-sheet` | Balance sheet | A, O | — |
| `/rpt/bir-books` | BIR books | A, O | — |
| `/rpt/cancellations` | Cancellations and reissues | A, O | — |
| `/rpt/cash-counts` | Cash counts | A, O | — |
| `/rpt/cash-flow` | Cash flow statement | A, O | — |
| `/rpt/cash-position` | Cash position | A, O | — |
| `/rpt/changes-in-equity` | Statement of changes in equity | A, O | — |
| `/rpt/collections-register` | Collections register | A, O | — |
| `/rpt/customer-statement` | Customer statement | A, O | — |
| `/rpt/deposits-crossing-quarter` | Deposits crossing a VAT quarter | A, O | — |
| `/rpt/deposits-held` | Deposits held | A, O | — |
| `/rpt/exceptions` | Exceptions | A, O | — |
| `/rpt/income-statement` | Income statement | A, O | — |
| `/rpt/job-margin` | Job margin | A, O | — |
| `/rpt/job-order-follow-up` | Job order follow-up | A, O | — |
| `/rpt/journal` | General journal | A, O | — |
| `/rpt/labor-cost` | Labor cost by job order | A, O | — |
| `/rpt/late-entries` | Late entries | A, O | — |
| `/rpt/late-jobs` | Late job orders | E, P, A, O | — |
| `/rpt/lead-time` | Job order lead time | E, P, A, O | — |
| `/rpt/ledger` | General ledger | A, O | — |
| `/rpt/monthly-owners-pack` | Monthly owners' pack | A, O | — |
| `/rpt/payroll-register` | Payroll register | A, O | — |
| `/rpt/piece-work` | Piece-work summary | A, O | — |
| `/rpt/production-status` | Production status counts | E, P, A, O | — |
| `/rpt/purchase-orders` | Purchase orders by status | A, O | — |
| `/rpt/purchases` | Purchases by supplier/category | A, O | — |
| `/rpt/received-not-billed` | Received but not billed | A, O | — |
| `/rpt/sales-by-period` | Sales by period | A, O | — |
| `/rpt/sign-ins` | Sign-in history | O | — |
| `/rpt/thirteenth-register` | 13th-month register | A, O | — |
| `/rpt/throughput` | Production throughput | E, P, A, O | — |
| `/rpt/transfers` | Transfers report | A, O | — |
| `/rpt/trial-balance` | Trial balance | A, O | — |
| `/rpt/worker-output` | Worker output | E, P, A, O | — |
| `/stat` | Government remittances | A, O | — |
| `/stat/exposure` | Missing past government contributions | A, O | — |
| `/szr/sets` | Sizer sets | E, P, A, O | — |
| `/tax/0619e` | 0619-E (monthly EWT) | A, O | — |
| `/tax/1601eq` | 1601-EQ (quarterly EWT) | A, O | — |
| `/tax/1604e` | 1604-E (annual EWT) | A, O | — |
| `/tax/1702q` | 1702Q worksheet | A, O | — |
| `/tax/1702rt` | 1702-RT worksheet (annual) | A, O | — |
| `/tax/2307-received` | 2307s received | A, O | — |
| `/tax/2307-to-issue` | 2307s to issue | A, O | — |
| `/tax/2550q` | 2550Q worksheet | A, O | — |
| `/tax/booklets` | Booklets | E, A, O | — |
| `/tax/calendar` | Tax calendar | A, O | — |
| `/tax/changes-after-filing` | Changes after filing | A, O | — |
| `/tax/ewt` | Tax withheld from suppliers (EWT register) | A, O | — |
| `/tax/filed-returns` | Filed returns | A, O | — |
| `/tax/purchases` | Purchases register | A, O | — |
| `/tax/sales` | Sales register | A, O | — |
| `/tax/sawt` | SAWT | A, O | — |
| `/tax/slsp-purchases` | SLSP: purchases | A, O | — |
| `/tax/slsp-sales` | SLSP: sales | A, O | — |
| `/tax/vat` | VAT this quarter | A, O | — |
