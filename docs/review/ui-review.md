# UI review: make everyday work easier

Reviewed 3 October 2026, from Moonproject main at `a0f065b3f59d37469aaa0e2b3359283c623a4361`. This is a review only. No application code or plan changes are proposed in this pull request.

The main problem is that routine work and specialist detail often have equal weight. People must read too much before they can find their job, enter the important fields, or decide what to do next.

## How this review was done

- Read AGENTS.md, the relevant plan sections, the frame and menu, shared lists/forms/views/components, and the screens under apps/web/src/modules. Checked the role permissions and the every-screen tour to understand what each person can reach.
- Reviewed the repository's saved guide pictures, including Home, a new and recorded job order, collection, payroll, production entry, TV board, AP aging, employee details, users, bank reconciliation and statutory exposure. These pictures are supporting evidence; current source takes precedence.
- Tried `npm run guide-shots`. The web build succeeded, but the helper could not launch `node_modules/.bin/tsx` on Windows (ENOENT). A fresh live tour and phone screenshots were not completed. Phone findings below come from the layout rules in the source; they need a browser check when implemented.
- Checks: typecheck and web build passed. On an unchanged checkout with Unix line endings, all 1,488 tests passed, but the suite exited with one Windows temporary-folder cleanup error in plain-node.test.ts (EPERM). The initial Windows checkout also had fixture line-ending failures. No source or fixtures were edited to make checks pass.
- Reviewed the left menu as Claude #1's planned folded groups: headings first, one group opened at a time. The old pictures' expanded menu and duplicate invoice labels are not findings against that change.
- Covered owner, accountant, encoder, production and TV use. No other Virtus repository or old application was used.

**Size:** small = mainly words or a local layout; medium = a shared screen pattern or several screens; large = a new connected workflow. These are effort estimates, not promises of dates.

**Screen-only** means apps/web can do the suggested work with existing data. **Also server** means the suggested complete fix needs more data or filtering from the server. No suggested fix changes posting rules, permission checks, the business date or the frozen plan.

## 1. The ten changes that would help most

### 1. Put today's work first on Home

- **Wrong:** the owner's Home begins with period figures, cash/tax/job figures and charts before the work reminders. It then offers a large collection of new-document links. The separate + New menu also lists every available creation link without a height limit. A busy owner has to scan too many choices.
- **Screens:** Home for each role; the shared + New menu.
- **Who:** owner and encoder most; accountant and production staff also need their own starting point.
- **Fix:** first show a short “Needs attention” list with due jobs, ready releases, unpaid balances and warnings, using the existing role widgets. Follow with the few actions that role uses daily. Put owner figures and charts below. Group the full + New list, give it search and a scroll limit, and retain access to everything permitted.
- **Size:** medium.
- **Scope:** screen-only, apps/web. Start with the reminders and figures already returned; richer priorities can be a later server task.
- **Evidence:** App.tsx, shell/Shell.tsx, modules/DASH/Home.tsx.

### 2. Let people find a record inside its own list

- **Wrong:** shared document lists offer All, Recorded and Cancelled, then 25 records and “Show older”. There is no local search, date range or customer/supplier filter. Drafts are identified mainly by type and saved time. Finding last month's payment or a customer's order becomes repeated browsing.
- **Screens:** job orders, collections, quick sales, quotations, releases, purchases, expenses, payroll and all other shared document lists.
- **Who:** encoder, owner and accountant.
- **Fix:** add search by number and person, date filters, useful status counts and a clear page position. Give drafts a person/description and amount where available. Keep 25 rows; search all matching records, rather than just the rows already loaded. Add the logged export required by the plan.
- **Size:** large.
- **Scope:** also server. The shared list route currently supports limit, before and status; complete search/date/person filters and useful counts need server support.
- **Evidence:** generic/DocList.tsx; the document-list contract in AGENTS.md.

### 3. Give every report a deliberate, readable set of columns

- **Wrong:** several operational reports turn every returned field into a column. AP aging visibly includes “supplier Id”, a long internal ID, “doc Type” and “balance Cents”, even though the value is displayed in pesos. Such tables look unfinished and bury the answer among technical detail.
- **Screens:** AP aging, purchases, purchase-order status, received but not billed, cash position, transfers, cash counts, asset schedule, late entries, cancellations, exceptions and sign-in history.
- **Who:** owner and accountant; production staff encounter a similar problem with raw stage words in production reports.
- **Fix:** choose columns for each report, with a helpful order and plain headings. Show names and document numbers, hide internal IDs, show money as “Balance” or “Amount”, format statuses, and place technical detail in an optional expansion. Put the question the report answers above the table.
- **Size:** medium.
- **Scope:** screen-only for the operational reports' supplied names and numbers. Where a name is absent, request it rather than display an ID; the separate journal/ledger name gap is listed below.
- **Evidence:** modules/RPT/Operations.tsx, PayrollProduction.tsx; guide picture 38-ap-aging.png.

### 4. Make entry tables usable on a laptop and phone

- **Wrong:** a new job order puts several line fields alongside a fixed summary column. In the 1024-pixel guide picture the description box is almost unusably narrow. Production entry squeezes worker, pieces, rework and rate into the same area. Payroll has ten tightly packed columns; government headings and amounts run together.
- **Screens:** job-order and quick-sale lines, production entries, payroll and 13th-month runs; apply the same check to purchase lines, attendance and inventory counts.
- **Who:** encoder, production staff and accountant; owner checking entries on a phone.
- **Fix:** delay the two-column form layout until there is enough space. On a laptop show the important fields first, with discounts/rate changes underneath each line. On a phone use one card per line or employee. Keep a compact pay total visible and expand deductions on request. For wide read-only tables, keep the name/number visible while scrolling.
- **Size:** large.
- **Scope:** screen-only, apps/web.
- **Evidence:** modules/JO/JobOrderForm.tsx, QS, PRD/EntryForm.tsx, PAY; guide pictures 02, 06 and 41. Phone impact is source-based.

### 5. Ask the ordinary questions before showing exceptions

- **Wrong:** collecting an ordinary cash payment still exposes withholding/2307 details; sales lines show price/discount exceptions repeatedly. Customer, employee, bill and expense forms mix daily entry with tax or policy choices. Long “Details” sections offer little help deciding what can be skipped.
- **Screens:** collections, quick sales, quotations, job orders, customer/employee details, supplier bills and expenses.
- **Who:** encoder and owner; accountant doing repeated entry.
- **Fix:** order sections as who/what, items, payment, then review. Put optional tax, discounts and overrides behind clearly named choices such as “Customer withheld tax (2307)” and “Change the usual price”. Keep required fields and any active exception visible. Group contact details, tax details and pay settings separately.
- **Size:** medium.
- **Scope:** screen-only, apps/web. Keep the same input and validation rules.
- **Evidence:** modules/COL/CollectionForm.tsx, JO, QS, QUO, CUS, EMP, PUR and EXP.

### 6. Keep the main action and a short total easy to find

- **Wrong:** “So far” often sits in a tall, mostly empty right-hand panel while Record remains below a long form. Some confirmation dialogs give journal detail nearly the same prominence as the plain summary. This particularly burdens owners, who are permitted to see journals but do not need them for every entry.
- **Screens:** shared document form and Record dialog; custom sales, collection, production and payroll forms.
- **Who:** everyone entering documents, especially encoder and owner.
- **Fix:** use a compact summary that does not stretch to the full form height. Keep one clear Record action with the total near the end of the work, and a visible bottom action area on phones. In confirmation, show who/what/amount first and let permitted people expand the journal. Keep the final server preview and deliberate confirmation.
- **Size:** medium.
- **Scope:** screen-only, apps/web.
- **Evidence:** generic/DocForm.tsx (RecordDialog) and components/ui.tsx; custom form layouts and guide pictures 02, 04 and 41.

### 7. Use the shop's words, with formal names alongside when needed

- **Wrong:** labels such as AR/AP aging, EE/ER shares, CA, EWT, ATC, cost centre, statutory exposure and “needs a route” require accounting or system knowledge. Raw choices such as “full” and “normal” also make recorded pages read like input data.
- **Screens:** menu/report titles, payroll, collections and bills, employees, government reports, production setup and document views.
- **Who:** owner, encoder and production staff. Accountant still needs the formal terms.
- **Fix:** use “Unpaid customer balances (AR aging)”, “Unpaid supplier bills (AP aging)”, “Employee share”, “Company share”, “Cash advance”, “Tax withheld from supplier”, “Tax code (ATC)”, “Pay cost group” and “Choose production steps”. Explain statutory exposure as missing past government contributions. Keep BIR form numbers, legal titles and account codes available where they serve the accountant. Use existing DOC_TITLES for document titles.
- **Size:** small, spread across screens.
- **Scope:** screen-only, apps/web; no renaming of stored fields or accounting rules.
- **Evidence:** shell/menu.ts, generic/fields.ts and DocView.tsx; modules/PAY, STAT, EMP, PRD and RPT.

### 8. Make the TV board work without anyone touching it

- **Wrong:** TV uses the ordinary shell and fixed 320-pixel columns. The saved picture cuts off a later column; longer queues extend below the screen. Nothing automatically brings hidden work into view. “Refreshes every 30 seconds” does not say when the last successful refresh occurred.
- **Screens:** TV production board.
- **Who:** production staff watching the TV from a distance.
- **Fix:** give TV its own full-screen frame, as the plan already calls for. Fit columns to the display or cycle clearly numbered pages automatically, including tall queues. Show last successful update and an obvious stale/offline message, plus readable overdue/RUSH markers and an empty-board message. Keep initials and the absence of prices.
- **Size:** medium.
- **Scope:** screen-only, apps/web; use the existing board response and refresh.
- **Evidence:** App.tsx and modules/PRD/TvBoard.tsx; guide picture 43-tv-board.png.

### 9. Make clicked dates and displayed report dates trustworthy

- **Wrong:** Home's VATable sales and VAT cards link to /tax/sales-register, while the registered sales screen is /tax/sales. Several reports ignore the date query passed by Home and initialise to their own current period. Payroll/production report headings use the dates being edited before Show is pressed, so old results can appear under a new date. Operational reports omit dates from the printed heading.
- **Screens:** owner Home drill-throughs; operational and payroll/production reports.
- **Who:** owner and accountant making decisions or printing reports.
- **Fix:** correct the broken route; honour supplied dates; label results using the period actually loaded. Until Show is pressed, say that the changed dates have not been applied. Print the applied period or “As of” date on every report.
- **Size:** medium.
- **Scope:** screen-only, apps/web; these reports already accept period/date parameters.
- **Evidence:** modules/DASH/Home.tsx, shell/menu.ts, RPT/Operations.tsx and PayrollProduction.tsx.

### 10. Let a recorded order explain the whole job

- **Wrong:** the job-order view shows a plain summary and useful money/next-action information, but not a readable garment-line table or wearer roster. The generic view does not render the line arrays. Related records and changes are scattered across separate screens; there is no shared linked-document timeline or record History tab.
- **Screens:** recorded job orders/opening orders, releases and other shared document views.
- **Who:** owner checking an order, encoder answering a customer, production staff checking what to make, accountant following a correction.
- **Fix:** show garments, quantities and wearer/size details allowed for that person. Add an order-to-release-to-payment trail, with numbers, dates and links; show why a record was cancelled/replaced and who did it in History. Keep the current job-order balance and useful next-action buttons.
- **Size:** large.
- **Scope:** screen-only for readable line/roster detail already supplied; also server for a complete linked trail and permission-checked record history.
- **Evidence:** generic/DocView.tsx and fields.ts, modules/JO/JobOrderView.tsx; PLAN H2; guide picture 03-job-order.png.

## 2. Other findings, by menu group

Each line gives the problem, screens, affected people, suggested fix, size and scope. Shared issues appear once in their most useful group; they also apply wherever that shared component is used. The ten items above are not repeated here.

### Overview

- **Phone navigation:** the opened mobile menu still occupies a 224-pixel column beside the page, squeezing the work area even with folded groups; all screens, owner/encoder/accountant/production; use a drawer over the page that closes after choosing a screen; **medium; screen-only**; shell/Shell.tsx, source-based.
- **Global search:** a failed request can look like “No matches”, and an older response can replace a newer search; all screens, owner/encoder/accountant; distinguish searching, no results and connection failure, and keep only the latest response; **small; screen-only**; modules/NAV/Search.tsx.
- **Keyboard and focus:** shared dialogs do not keep keyboard focus inside or reliably return it to the opener; shared menus also need consistent open-state/keyboard handling; all groups, everyone using a keyboard or assistive reader; add focus management and keyboard operation to shared components; **medium; screen-only**; components/ui.tsx and shell.
- **Notifications:** a flat reminder list makes overdue work, new activity and already-read items hard to distinguish; Notifications, owner/encoder/accountant; group by urgency/type and offer unread/all views with readable action links; **medium; screen-only using current reminder data**; DASH.
- **Calendar entry:** a new event starts from the displayed range's first day rather than an explicitly chosen day; Calendar, encoder/owner; open Add event from the selected day, show that date prominently and add Today navigation; **small; screen-only**; CAL.
- **Calendar job choices:** the event's job-order choice comes from a recent limited list, making an older active job hard to link; Calendar, encoder; use a searchable order picker; **medium; also server if existing order-search results cannot cover all eligible jobs**; CAL.
- **Chart meaning:** bar heights use absolute amounts, so reversals can look like positive activity; a negative cash balance can fall outside the chart's drawing area; owner Home charts, owner/accountant; use a signed scale and clearly label negatives/reversals; **small; screen-only**; DASH charts.
- **Loading versus empty:** shared lists initially look empty before the request finishes; document lists throughout the app, all daily users; show Loading, actual empty state and failure separately, with a relevant next action; **small; screen-only**; generic/DocList.tsx.

### Sales

- **Master-detail navigation:** opening or editing a customer adds detail further down the same long page; Customers and wearers, encoder/owner; take focus to the selected detail, keep a clear Back to customers link and preserve the list position; **medium; screen-only**; CUS.
- **Large wearer groups:** group/wearer choices and measurement history get long without a local search or compact current-first view; Customers/measurements, encoder and production; add wearer search, show the current measurements first and fold older revisions; **medium; screen-only**; CUS.
- **Duplicate warning:** a customer duplicate can fall back to an internal ID when its name is outside the loaded customer page; Customers, encoder; show the candidate's name and an Open customer link; **small; also server if the duplicate response lacks the name**; CUS.
- **Price list without prices:** the list shows code, class, unit and status, but the user must open an item to see its price history; Price list, owner/encoder; include today's normal price and keep dated/quantity-based history in detail; **medium; also server for an authoritative current-price list if it is not supplied**; CAT.
- **Repeated search controls:** quotation customer/catalog selection combines a search box with separate long selects, while other forms use a different picker; Quotations, encoder; use the same search-and-pick interaction as everyday sales forms, showing the chosen item clearly; **medium; screen-only**; QUO and shared pickers.
- **Unlabelled line boxes:** descriptions, quantities, discounts and payment parts often depend on placeholders which vanish after typing; sales/quotation/payment line entry, encoder and phone users; retain visible labels or clear column headings at every layout size; **small; screen-only**; JO, QS, QUO and COL.
- **Draft consistency:** JO/quotation forms offer Save draft while several other long custom forms do not; sales and purchasing entry, encoder; extend the existing draft flow to appropriate multi-step forms and make its location consistent; **medium; screen-only where existing draft support accepts that document type**; custom forms versus generic/DocForm.tsx.
- **Checks needing attention:** on-hand/deposited checks and post-dated checks are spread across separate tables without a compact due-soon/overdue starting view; Post-dated checks and Checks on hand, owner/accountant/encoder; add status/date filters and a clearly labelled “Ready to deposit” view with links between the two screens; **medium; screen-only using current check data**; COL.
- **Emails in the wrong context:** the Customer emails screen includes a payslip-email tab, so finding payroll communications requires visiting Sales; Customer emails, accountant; provide a People & Payroll entry to that same authorised view and make the customer/payslip context obvious; **small; screen-only**; COM.

### Production

- **Board freshness:** the working production board loads once and after its own changes, while changes from another workstation may remain unseen; Production board, production/encoder; add refresh or polling, an updated time and an explicit stale message; **medium; screen-only**; PRD/Board.tsx.
- **Finding a job:** due/rush filters help but there is no number/customer search within the board; Production board, production/encoder; add a local search and a clear reset while retaining existing filters; **small; screen-only**; PRD.
- **Step detail overload:** opening a production line exposes completion, not-needed and reopening controls for many steps together; Production board dialogs, production; emphasise the current/next step, fold completed steps and group unusual changes separately; **medium; screen-only**; PRD/Board.tsx (LinePanel).
- **Rate changes look routine:** rate/rework choices sit alongside normal piece entry; Production entry, production/encoder; default to normal pieces and show rate override only when requested, with its reason and effect clearly visible; **small; screen-only**; PRD.
- **Piece-rate history:** setting a new rate and browsing many historic rates share one busy view; Piece rates, accountant/owner; show current rates first, filter by garment and step, and open a separate Add/change rate panel; **medium; screen-only using returned history**; RATE.
- **Sizer history:** each selected set's events grow into a long list; Sizer sets, encoder/production; lead with who has the set and the next action, then fold/page the history; **small; screen-only for the current loaded history**; SZR.

### Purchases & Expenses

- **Supplier list density:** registered name, TIN, VAT, EWT and terms compete with the name used to find a supplier; Suppliers, encoder/owner; lead with trading name/contact and move tax detail to expansion, keeping accountant access; **small; screen-only**; PUR.
- **Purchase-order length:** large orders keep every item in a long editable table; Purchase orders, encoder; add item finding, sticky line headings and a running item count/total, with optional line detail folded; **medium; screen-only**; PUR.
- **Receiving context:** the receiving flow has a useful “receive all left” action, but long orders still require scanning many rows; Receiving, encoder/production; show outstanding items first and make remaining quantities and partial receipt unmistakable; **small; screen-only**; PUR.
- **Ambiguous payment shortcut:** “All” beside a supplier bill amount does not say what is being filled; Supplier payment, accountant/encoder; say “Pay remaining” and show the resulting amount and total selected; **small; screen-only**; AP.
- **Advance balance meaning:** supplier advances and the net owed amount can be confused with outstanding bills; Payables by supplier and Supplier payment, owner/accountant; separate “Bills to pay” and “Advance available”, then show the resulting payment; **small; screen-only**; AP.
- **Deactivation inconsistency:** supplies can be deactivated directly while comparable supplier actions ask for confirmation; Supplies/Suppliers, encoder/accountant; use the same confirmation and explain that old documents remain; **small; screen-only**; PUR.
- **Long count sheets:** many count rows make it hard to find an item or keep its headings in view; Inventory count, encoder/accountant; add local item search, sticky headings, clear remaining-to-count status and phone cards; **medium; screen-only**; INV.
- **Receipt attachment timing:** document attachments appear on the recorded view, separate from entering an expense/bill; Expenses and Supplier bills, encoder/accountant; make “Record, then attach the receipt” explicit and lead to the attachment step after success; **small; screen-only**; generic/Attachments.tsx and DocView.tsx.

### Money

- **Cash names versus account codes:** the cash-place register puts ledger account detail alongside everyday cash choices; Cash Accounts, owner/encoder; show place name/type first and keep account codes in accountant detail; **small; screen-only**; CASH.
- **Reconciliation actions compete:** saving ticks and finishing a reconciliation have similar primary emphasis; Bank reconciliation, accountant; make Save progress secondary and Finish primary only when the remaining difference is resolved, with the reason beside it when unavailable; **small; screen-only**; CASH.
- **Long loan schedules:** generated/manual schedules can expose many instalment rows at once; Loans, accountant/owner; show next payment and totals first, with a paged/folded full schedule and separate edit controls; **medium; screen-only**; LOAN.
- **Asset terminology:** accumulated depreciation, residual and useful-life fields are prominent before the owner can identify an asset; Fixed assets and asset forms, owner/encoder; lead with asset/location/cost and add short explanations beside accountant fields; **small; screen-only**; FA.
- **Owner balance direction:** a signed running net is less clear than who owes whom; Owners and officers ledger, owner/accountant; display “Company owes [name]” or “[name] owes company” alongside the amount; **small; screen-only**; EQ.
- **Sensitive action placement:** asset disposal and other exceptional money actions need more separation from ordinary viewing/adding; Fixed assets and owner-money forms, owner/accountant; group them as specific actions with the existing preview/reason, rather than competing with the usual task; **small; screen-only**; FA and EQ.

### People & Payroll

- **Employee page length:** contact details, government settings, pay history, previous employer data and loans accumulate on one page; Employees, encoder/accountant/owner; divide into Personal details, Pay, Government details and History, with clear save boundaries; **medium; screen-only**; EMP.
- **Attendance overload:** the wide date grid and repeated overtime/night fields are hard to scan or tap; Attendance, encoder/accountant; keep the useful single-day view for phones, show overtime detail only for the selected employee/day and retain the status legend; **medium; screen-only**; EMP.
- **Technical payroll explanation:** “Pay worked out by server” describes the system rather than the result; Payroll run, owner/accountant; say “Calculated pay” and explain which attendance, piece work and adjustments were included; **small; screen-only**; PAY.
- **Manual pay adjustments:** routine calculated pay and optional manual additions share substantial space; Payroll run, accountant; open allowances/adjustments only when needed and show their total separately in the review; **small; screen-only**; PAY.
- **13th-month comparison:** accrued, due, paid and one-twelfth amounts are hard to compare without a clear main result; 13th-month run/register, owner/accountant; lead with “To pay now”, show a compact reconciliation beneath and leave calculation detail expandable; **small; screen-only**; PAY and RPT.
- **Government-loan wording:** “Monthly amortization” is unfamiliar to the person entering a deduction; Government loans, encoder/owner; say “Monthly deduction” and show balance/next deduction together; **small; screen-only**; PAY.
- **Period controls vary:** government remittances and 2307-related entry ask for typed period strings while other payroll screens use month controls; Remittances, government loans and tax-credit forms, accountant/encoder; use month/quarter pickers with the same readable period format; **medium; screen-only**; STAT, PAY and COL.
- **Statutory exposure wall of text:** large notices and an ACC-05 reference precede an actionable result; Statutory exposure, owner/accountant; start with whether data is available, affected months/people and the accountant's next step; fold calculation limits and policy references into Help; **medium; screen-only using current exposure data**; STAT, guide picture 34.
- **Permission codes in explanations:** year-end government-ID availability can name `emp.view_ids`; 2316 and alphalist, owner/accountant; say “Your role cannot view government numbers” and give the owner a clear access-management direction; **small; screen-only**; PAY.

### Accounting & Tax

- **Settings scan poorly:** several effective-dated settings and their histories form a long specialist page; Settings, owner/accountant; group by Sales, Tax and Payroll, show today's value first and fold history/change forms; **medium; screen-only**; ACC.
- **Decision backlog:** open history and repeated decision forms obscure which go-live decisions still need agreement; Go-live decisions, owner/accountant; show unresolved decisions first, then agreed choices with closed histories; **small; screen-only**; ACC.
- **Chart implementation detail:** role keys sit beside account names/codes; Chart of accounts, owner/accountant; keep codes and formal account types but hide locked internal role keys under Advanced details; **small; screen-only**; ACC.
- **Tax screen naming:** many nearly identical form-number menu entries make the purpose hard to remember even with folded menu groups; tax worksheets/registers, owner/accountant; add a short business-purpose subtitle and keep the official form number, with links between related monthly/quarterly work; **small; screen-only**; TAX.
- **Filing entry prominence:** “Add a row” is a weak name for recording a filed return, and free-text periods invite inconsistent entry; Filed returns, accountant; make “Record a filing” the clear action and use form-specific month/quarter/year choices; **small; screen-only**; TAX.
- **Calendar next steps:** the tax calendar links to worksheets but recording the filing and payment remains a separate navigation task; Tax calendar/Filed returns/tax payment, accountant; offer permitted “Record filing” and “Record payment” links with the form/period carried forward, clearly distinguishing filed from paid; **medium; screen-only with existing forms**; TAX.
- **Tax form consistency:** range, quarter and year controls plus Show/automatic refresh differ across tax reports; tax registers and worksheets, accountant; use the same control placement, applied-period heading, export/print area and loading state; **medium; screen-only**; TAX/ReportParts.tsx and reports.
- **Booklet history length:** used, skipped and unused number detail can dominate a booklet page; Booklets, encoder/accountant; lead with booklet range/current status and next available number, then filter/page the number history; **medium; screen-only for existing history**; TAX.
- **Internal decision references:** references such as ACC-27 appear in routine explanatory text; uncollected VAT and related exception forms, owner/accountant; put the practical rule first and move decision IDs to an optional policy note; **small; screen-only**; TAX.

### Reports

- **Journal/ledger parties are IDs:** account detail prints a party type followed by its internal ID; General journal/General ledger, accountant and owner; return the permitted person/business name and render it as a useful link; **medium; also server**, because the current row contract supplies party type/ID rather than name; RPT/Books.tsx.
- **Customer statement selection:** all customers, including historical inactive/merged records, share one long select with no search; Customer statement, accountant/owner; add search to this existing historical customer list, clearly labelling inactive records; **small; screen-only**; RPT/Receivables.tsx and CUS/public.ts.
- **Print completeness:** shared Print calls browser printing of the displayed report, which can contain just one loaded page; paged reports, owner/accountant; label that action “Print this page” and provide an explicit full-report print or download with row count and period; **medium; also server for a reliable full-report print where no print endpoint exists**; RPT/Books.tsx.
- **Money alignment:** payroll/production report amounts use the ordinary left-aligned cell style, unlike journal money; Payroll register, piece work, labor cost, 13th-month register and job margin, owner/accountant; right-align money, use equal-width digits and make totals easy to distinguish; **small; screen-only**; RPT/PayrollProduction.tsx.
- **Rows without an answer:** many reports start with “N rows” and a table rather than their main amount/count; operational and production reports, owner/production/accountant; show a small result summary and an explicit no-records explanation before detail; **small; screen-only**; RPT.
- **Default report density:** shared paged reports use 100 rows, while the standard document pattern is 25; long reports on laptops/phones, owner/accountant; offer 25/50/100 rows and keep full export separate from the visible page; **small; screen-only**; components/ui.tsx PAGE_ROWS and RPT/Books.tsx.
- **Overdue status emphasis:** late-job reports show due dates and raw stages without a strong “how late” cue; Late job orders and follow-up, production/owner; add days overdue and a text marker, with colour as extra help; **small; screen-only using dates already returned**; RPT.
- **Owner report guidance:** formal financial statements and government books lack a consistent short explanation of what to use them for; Reports menu, owner; put a one-sentence purpose above each and distinguish everyday summaries from formal accountant layouts without removing the latter; **small; screen-only**; RPT.
- **Reissued-record navigation:** cancellations/exceptions show technical record detail more readily than a plain before/replacement story; Cancellations and reissues/Changes after filing, owner/accountant; show old number, replacement number, reason and date together with readable links; **medium; screen-only for fields supplied, also server if the reason/name is absent**; RPT and TAX.

### Admin

- **Permissions wall:** the role editor shows a large permission matrix even when the owner wants to change one person's job; Roles and permissions/Users, owner; start from role/person, allow capability search and fold permission groups while retaining precise controls and last-owner safeguards; **medium; screen-only**; SEC.
- **User table on phones:** action buttons occupy much of each row and force name/username wrapping; Users, owner; use a person card on small screens and a compact action menu, with destructive actions clearly named; **small; screen-only**, source-based; SEC, guide picture 35.
- **Audit log reads like a database:** Entity type/Entity ID filters and raw action/data fields require technical knowledge; Audit log, owner/accountant; use document/person search, readable action summaries and an expandable raw-detail view; **large; also server** for meaningful entity names and before/after descriptions; AUD.
- **Integrity results need a destination:** technical check results require the owner to work out where to fix a problem; Integrity check/Nightly checks/System health detail, owner/accountant; translate each result into what is wrong, who should act and an Open relevant screen link, leaving check IDs in detail; **medium; also server where results lack entity links**; AUD and SEC.
- **Backup setup burden:** folder paths and tier detail are prominent during backup setup; Backups, owner; lead with last successful shop/off-site copy, clear next action and guided folder instructions, folding technical settings; **medium; screen-only for instructions/layout; also server if adding a folder chooser**; BAK.
- **Import words:** Stage, Dry run and Commit describe technical operations rather than the owner's decision; Import old data, owner/accountant; use “Load a copy”, “Check the import” and “Import these approved rows”, preserving the existing checks and explicit confirmation; **small; screen-only**; MIG.
- **Opening/setup progress:** large setup/import panels ask the owner to track several stages mentally; Opening balances and Import old data, owner/accountant; keep a numbered current-step summary, completed checks and one next action visible; **medium; screen-only**; ACC and MIG.
- **Certificate instructions:** the shop-code fingerprint, thumbprint and multiple joining addresses need technical reading; Shop certificate, owner/encoder; lead with numbered device-joining steps and one recommended address, put Windows thumbprint in advanced detail and add copy controls; **small; screen-only**; SEC/ShopCertificate.tsx.
- **Email setup jargon:** host, port and credential settings assume someone understands mail setup; Customer email settings, owner/accountant; add provider examples, a plain setup sequence and a clear test-result message without exposing passwords; **small; screen-only**; COM.
- **Company profile password layout:** repeated password fields in the profile form differ from the shared password-confirmation dialog; Company print details, owner; use one consistent confirmation step at Save, preserving server checks; **small; screen-only**; PRT.
- **Technical print-pack messages:** a not-yet-built print can expose implementation status inside the printer test flow; Printer test pack, owner; show ready print samples first and clearly list unavailable samples with plain next steps; **small; screen-only**; PRT.
- **Sign-in readability:** long passphrases have no common show/hide control across sign-in and password-entry screens; login, first-owner and confirmation screens, everyone; offer a clearly labelled Show password control and consistent requirement hints; **small; screen-only**; Auth and shared password components.

## 3. What already works well and should stay

- The nine menu groups and permission-based access make sense. Keep Claude #1's folded-group approach.
- Plain “What this did” summaries, named cash-place buttons, peso formatting and server-confirmed totals already translate accounting into useful shop questions.
- Record confirmation, clear cancellation/reissue explanations and required reasons protect the books. Keep these deliberate steps while simplifying their presentation.
- Job-order balances and next-action links are valuable. Keep the collected/deposit/balance distinctions and prefilled collection/release links.
- Wearer groups, measurement revisions, previous-value hints and spreadsheet paste suit a garment shop. Preserve them when shortening the pages.
- Production's due/rush filters and the TV board's initials/no-price presentation are useful. Keep privacy protections when making the board fill the display.
- Calendar's small-screen agenda and attendance's single-day entry are good alternatives to wide grids.
- Month-end checks with links, financial comparison views, logged exports, printed document copies and clear practice/restored-data banners support careful work.
- Keep formal account names, BIR form numbers, history, detailed calculations and full official print layouts accessible to the accountant. Simplify the everyday view around them.
