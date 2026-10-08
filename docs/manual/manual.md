# Front matter

## What Moonproject is
Moonproject keeps the shop's orders, production, money, payroll and books together. It runs on the shop PC. Staff use a browser on a joined PC, phone or tablet. The shop PC must be on. Ordinary shop work on the local network does not need the internet; outside services such as email and off-site copying do.

This manual is for owners, accountants, encoders and workers. It follows the app on main as checked on 6 October 2026. All screenshot people and transactions are made-up practice data. The screenshots are reused from the owner guides; some show an earlier layout. Follow the current button names and steps in the text. No new screen is pictured.

## How to read this book
Read Quick start before your first day. Use Routines at opening and closing time. The module chapters keep the original guide numbers, so “guide 37” always means Job Orders, Release Slips and Invoices. The contents and guide references are clickable. Use the PDF reader's search for a screen name or message. The screen index is grouped by the menu where you find it; a topic may be explained in a different chapter.

Bold words name buttons, fields, menus or messages. “Click” also means tap on a phone. A numbered step is something you do. Read “Before you start” first and “What the system does” before confirming. A screen may hide a button if your login lacks permission or the record is in the wrong state. Ask the owner when access is missing.

## Who sees what
- **Owner:** shop oversight, users and roles, safety and recovery, plus the business work their permissions allow. Owners handle first setup and emergency decisions.
- **Accountant:** books, tax, payroll, balances, corrections and month-end work. The accountant decides the accounting treatment and checks the paperwork.
- **Encoder:** the accountant's access by default, except users and roles, backups and restores, and shop payment settings. Access does not replace the accountant's review of tax and accounting decisions.
- **Production:** production board, pieces, rates and the production reports allowed to that login. Workers record the job, step, worker and pieces carefully; those entries feed pay.
- **TV:** the wall display of production work. It has no access to the working production board or production entries. It is for viewing, not recording.

The owner can change permissions. Actual screens follow the login's permissions, not just its role name. Use individual logins so the history shows who did the work. Do not share passwords.

## Menu map
- **Sales:** customers, job orders, releases, invoice records, collections, quick sales, quotations, credits, checks, customer emails, POS, website shop, online orders and support inbox.
- **Money:** cash places, cash book, transfers, counts, checks on hand, reconciliation, assets, loans, owners and dividends.
- **Reports:** books, statements, customer and supplier balances, payroll and production reports, exceptions and the owners' pack.
- **Purchases & Expenses:** suppliers, supplies, purchase orders, receiving, bills, payments, expense vouchers and inventory counts.
- **People & Payroll:** employees, attendance, holidays, payroll, advances, leave, government loans, remittances and agency files.
- **Production:** the production board, TV board, entries, piece rates and sizer sets.
- **Accounting & Tax:** journals, chart of accounts, settings, tax registers, booklets, returns, VAT, go-live decisions and month-end.
- **Admin:** users, safety, backups, import, opening balances, company print details and practice shop.
- **Overview:** Home, Notifications and Calendar. Start at **Needs attention** on Home.

On a phone tap **Menu**. Click a group heading to open its items. Use **+ New** and **Search new documents** to find a form. A list's button says **+ New** followed by the document name.

## Words used on every form
- **Document:** a numbered business event, such as a job order, collection or payroll run.
- **Record:** review the confirmation, then save the event. It receives a number and, when money is involved, updates the books.
- **Draft:** unfinished work. **Save draft** keeps it without a number or an entry in the books. Open it again to finish.
- **Cancel:** keep the original and reverse its effect, with a reason. It is not deletion. Read any message about later documents that must be cancelled first.
- **Edit:** for a recorded document, cancel and reissue under a new number. Nothing changes until you record the replacement. Keep the old paper copies marked as cancelled.
- **Cash place:** a cash box, bank account, checks account or e-wallet. Pick the place where money actually went or came from.

Read **What this did** on a recorded document. **Behind the scenes** shows the accounting entries when your login may see them. A warning asks you to check; an error must be fixed before recording. When totals change, review them again.

# Quick start

## First-day route
1. Install on the shop PC with guide 14 below. Create the FIRST owner there, starting at **http://localhost:8080/**. Another device is refused.
2. Join each device with guide 10. Check the certificate code against the shop PC before trusting it.
3. Set the company print details and test printers with guide 44. Use real company details in the live shop; practice screenshots are examples only.
4. The owner adds staff logins with guide 35. Set up backups and do a restore drill with guides 11 and 12 before live work.
5. Rehearse in **Practice shop** (guide 20). Agree the go-live decisions (guide 48), opening balances (guide 17) and switch-over (guide 39) before recording real business.

{{guide:14}}
{{guide:10}}
{{guide:44}}

## Sign in and change your password
**What it is for:** Use your own login and replace the temporary password the owner gave you.

**Before you start:** Use the joined device's saved Moonproject address. Get your username and temporary password privately from the owner.

**Steps:**
1. Type **Username** and **Password**, then click **Sign in**.
2. At **Change password**, type **Temporary password**, **New passphrase** and **Type the new passphrase again**.
3. Use at least 15 characters, such as several words, without your username. Do not use a password from a screenshot or example.
4. Click **Save new passphrase**.
5. To change it later, open your name menu and choose **Change password**. Use **Current password** instead of the temporary one.
6. When finished, open your name menu and click **Sign out**.

**What the system does:** It requires a new passphrase on first staff sign-in. Changing the password signs out your other devices.

**Common mistakes:** “Wrong username or password.” means check what you typed. If forgotten, ask the owner to use **Reset password** (guide 35). “The two passphrases are not the same.” means retype both new boxes alike.

# Routines

## Every day
1. Keep the shop PC on. Sign in, check the server date and read **Needs attention** on Home (guide 43).
2. The owner checks **System health** and the last backup (guides 25 and 11). Check **Nightly checks** findings with guide 56.
3. Encoders record orders, releases, invoice records, collections, purchases and expenses from the papers. Use the PRINTED DATE on the four forms that ask for it. Attach supporting papers (guide 58).
4. Workers check **Production board**, record pieces against the right worker and step, and complete finished steps (guide 41). Record attendance (guide 42).
5. Check **Online orders** against the actual bank receipts before confirming payments. Follow up customers and due checks (guides 26 and 55).
6. At closing, finish or save drafts. Check the cash book and count each cash box (guides 8 and 7). Explain differences; do not guess an adjustment to make them disappear.

## Every week
1. Review overdue job orders, customer balances, unpaid supplier bills, late loans and sizer sets (guides 26, 38, 36 and 45).
2. Before payroll, check attendance, pieces, rates and advances. Record the run and release only the pay actually given (guides 6, 22 and 42).
3. The owner makes the USB backup copy and swaps Drive A and Drive B; keep the copy away from the shop (guide 11).
4. Check failed customer emails, old drafts and notifications (guides 47 and 43). Review cash and collection totals with the accountant.

## Every month: close the month
1. Finish the month's source papers, releases awaiting invoices, payrolls and corrections. Check the **Exceptions** report (guide 38).
2. Count cash and inventory; reconcile each bank statement (guides 7, 15 and 32).
3. Run depreciation, oldest missing month first (guide 51). Review loans and unpaid balances (guides 36 and 38).
4. Check payroll deductions, government loans and remittances. Download agency files, validate them and pay through the official channels (guides 21, 24 and 34).
5. Check **0619-E (monthly EWT)** for the first two months of a quarter, or **1601-EQ (quarterly EWT)** at quarter end. Record actual BIR payments (guide 18).
6. Open **Month-end checklist** and follow each link. The accountant reviews the evidence, writes the note and signs off (guide 33). Printed-date entries cannot be newly dated in that signed-off month.
7. Print the monthly owners' pack, compare statements and discuss differences (guides 63, 54 and 49).

## Every quarter
1. Check **Tax calendar** for the applicable deadlines; have the accountant confirm current filing requirements.
2. Reconcile sales and purchases registers, classify missing VAT details and mark actual 2307 certificates received. Review **VAT this quarter** and **2550Q worksheet**, then record the VAT close in quarter order (guide 29).
3. Review **1601-EQ (quarterly EWT)** and the earlier monthly EWT payments. Issue supplier 2307s (guide 53).
4. File through the official BIR channel, keep its confirmation, record the filing and actual payment (guide 18 and the Accounting and Tax chapter). A worksheet or download is not a filed return.
5. Review applicable quarterly income tax on **1702Q worksheet**. The accountant checks adjustments and credits before filing.
6. The owner runs a restore drill with guide 12. Use **Run drill** for a test.

## Every year
1. Record all pay and applicable pay from before Moonproject or a previous employer. Review 13th-month pay and release it by the required date (guide 23).
2. Do the December year-end tax adjustment, check 2316 and the 1604-C alphalist (guide 28). Review leave balances (guide 52).
3. Complete the final month's counts, depreciation, reconciliations and sign-off. Review allowance and uncollected VAT if used (guides 61 and 62).
4. The accountant checks **1702-RT worksheet (annual)**, annual EWT and other applicable returns, confirms adjustments, files externally and records evidence.
5. Keep the annual reports, filed confirmations, booklets and yearly backups. Keep the old recovery keys for as long as you keep backups locked with them (guide 11).

# Sales
{{guide:1}}
{{guide:2}}
{{guide:37}}
{{guide:3}}
{{guide:4}}
{{guide:5}}
{{guide:40}}
{{guide:55}}
{{guide:27}}
## Customer refunds and moving a deposit
**What it is for:** Return money held for a customer or move a deposit to their replacement job order.

**Before you start:** Check the customer's held balance and the owner's agreed refund or replacement order. A website-order return has its own procedure below.

**Steps:**
1. To refund held money, open **Sales** > **Customer Refunds** > **+ New Customer Refund**.
2. Pick **Who gets money back**, then **What is paid back?**. Choose the actual cash place and amount under **Where did the money come from?**.
3. Fill **Reason (at least 10 characters)**. Click **Record**, check the confirmation, then **Record** again. Keep the actual payment proof.
4. To move a deposit, open **Deposit Transfers** > **+ New Deposit Transfer**. Pick the customer under **Whose money**, the source under **Where is the money now?**, and the destination under **Which job order does it go to?**.
5. Enter **Amount**, or leave it blank to move as much as both allow. Add a **Note**, then **Record**, review and confirm.

**What the system does:** A refund reduces money held and the selected cash place. A deposit transfer moves held money between the customer's orders; it does not receive new cash.

**Common mistakes:** Do not record a second collection to move an existing deposit. Check the replacement order number after an edit. Recording a refund does not itself make a bank transfer.

{{guide:47}}

## Website shop, POS and online orders
**What it is for:** Sell stocked items at the counter and deal with orders placed on the website.

**Before you start:** The owner arranges the public shop setup in guide 14 and the payment settings. Confirm prices, variants and stock before selling. Keep invoice and CR booklets ready.

**Steps:**
1. Open **Sales** > **Website shop**. On **Categories**, type **New category name** and click **Add category** if needed. On **Products and stock**, click **+ New product**. Fill **Name**, **Category**, **Price per piece (₱)**, **Short description**, sizes and colours, then **Save**. Use **Edit** for corrections and **Hide** or **Show** for visibility.
2. Click **Stock** on the product. Use **Pieces came in** and **Add pieces** for a new batch, or **I counted the shelf** and **Record the count** for a count. Type the pieces per size and colour and a note; leave other cells empty.
3. At the counter open **POS**. Use **Search products**, choose the item and its size and colour, and add the pieces. Use **One more** or **One fewer** to correct the quantity; click **Done** after choosing variants.
4. Fill **Invoice no.**, **CR no.** and **Paid by**. For cash fill **Cash received** if change is needed; for a transfer fill **Reference no.**. Check the total and click **Record sale · [amount]**.
5. For a website order open **Online orders**, then the order. Check the actual bank receipt against its payment reference and picture before confirming.
6. Click **Payment found: confirm**, choose the **Customer**, enter **Invoice no.** and **CR no.**, then click **Confirm and record the sale**. If the payment is wrong, use **Reject payment**, give the reason the customer will see, and click **Reject the payment**.
7. After preparing the order use **Ready for pickup** or **Sent out**, then **Handed over: completed** when handed over or finished.

**What the system does:** Confirmation records the quick sale and payment and takes pieces out of stock. The order history keeps its changes. The website payment picture alone does not prove that money arrived.

**Common mistakes:** Do not confirm an unpaid order. Check the bank first. Do not record the same website order again as a separate POS or quick sale. If a recorded order must be cancelled, follow the next section.

## Website payment settings
**What it is for:** Tell customers where to pay and connect that bank or wallet to the books.

**Before you start:** The owner checks the real company account and its QR picture. Encoders cannot change these settings.

**Steps:**
1. Open **Sales** > **Website shop** and its **Online payment** tab.
2. Fill **Bank or wallet**, **Account name**, **Account number shown** and **Money goes into**. Choose the matching cash account in the books.
3. Use **Upload the QR picture**, or **Change QR picture**, and check the preview against the real bank or wallet.
4. If delivering, use **+ Add a delivery area**, enter its places and fee. With no areas, ordering is pickup only.
5. Fill **Instructions for customers** and click **Save**. Check **View the website shop**.

**What the system does:** Online ordering stays closed until payment is set up. The saved QR is what customers see from then on.

**Common mistakes:** Do not choose a different ledger cash place from the real account receiving the money. Correct it before taking orders; ask the accountant about any already recorded payments.

## Cancel or return a confirmed website-shop order
**What it is for:** Reverse a whole confirmed online order or a whole order returned after it was ready or completed.

**Before you start:** Check the order, returned pieces and refund arrangements. You need permission to manage online orders and cancel its quick sale. This action is for the whole order, not a partial return.

**Steps:**
1. Open **Sales** > **Online orders** and open the order under **Paid · to prepare**, **Ready / sent**, or **All**.
2. Click **Cancel or return**.
3. Fill **Why (kept with the order; the customer does not see it)** with 10 to 200 characters.
4. Read the notice about the sale, payment and stock. Click **Cancel the order** for a confirmed order, or **Return the order** for a ready or completed order.
5. Arrange any actual customer refund outside the app, with the owner or accountant, and retain its proof.

**What the system does:** It cancels the linked sale and payment once and returns the pieces to stock. The order becomes **Cancelled** or **Returned**. If the quick sale was already cancelled, it only updates the order. The customer sees the status, not the private reason. A cancelled or returned order cannot move on to ready or completed.

**Common mistakes:** “The app does not pay the customer back.” Recording the return is not a bank transfer or cash refund. A second cancellation is refused. Do not repeat it or make another sale to offset it.

## Support inbox
**What it is for:** Follow up enquiries and problems sent through the website.

**Before you start:** Read the customer's message and keep any promised follow-up details.

**Steps:**
1. Open **Sales** > **Support inbox** and choose the enquiry.
2. Read the message and any attachments.
3. Contact the customer through the shop's usual agreed channel.
4. Fill **Note** with what was done, choose **Status**, and click **Save**.

**What the system does:** It keeps the enquiry and the staff notes together.

**Common mistakes:** A note records your follow-up; do not assume it sends a reply to the customer. Check the status before closing the enquiry.

# Production
{{guide:41}}
{{guide:45}}

# People and Payroll
{{guide:42}}
{{guide:6}}
{{guide:22}}
{{guide:23}}
{{guide:52}}
{{guide:24}}
{{guide:21}}
{{guide:34}}

# Money
{{guide:7}}
{{guide:8}}
{{guide:32}}
{{guide:36}}
{{guide:46}}
{{guide:51}}
{{guide:60}}

## Transfers, asset purchases, loans and owner money
**What it is for:** Record money movements from their actual supporting papers.

**Before you start:** Ask the accountant to check whether money is a cost, a loan, capital or an advance. Know which cash place was used.

**Steps:**
1. For a transfer, open **Money** > **Fund Transfers**, then **+ New Fund Transfer**. Pick the sending and receiving places, enter the amounts sent and received, and add a note. The difference is the fee. Click **Record**, review, then **Record** again.
2. For new equipment, open **Fixed assets** and **Record a purchase**. Choose **Kind of asset**, fill **Description**, supplier invoice details, **Invoice total (VAT included)**, **Residual value** and **Useful life in months**. Split how it is paid now, owed to the supplier or financed. Choose the cash place and lender when asked. Check the preview and **Record**.
3. For borrowing, open **Loans** > **Record a loan**. Fill **Lender**, **Loan or promissory note no.**, proceeds destination, **Loan amount (principal)**, fees, interest, term and schedule. For financed equipment select its **Asset purchase**. Check the schedule against the lender's paper and **Record**.
4. For an instalment open the loan and **Record a payment**. Check principal, interest and cash place against the actual payment. **Record** only what was paid. The rest stays owed; guide 36 covers short payments and forgiveness.
5. For an owner investment, open **Owners and officers**, open the person and **Record owner money**. Pick **What is it?** as agreed with the accountant, the cash place and amount, and **Record**.
6. For an officer taking or returning money, use **Record officer money out or back** on that person's page. Choose **In or out?**, the amount, cash place and **What was it for?**. Review and **Record**.

**What the system does:** It records the movement once and updates the balances. Asset cost is charged over time through depreciation; loan principal is money owed, not an expense. Owner advances are different from share capital.

**Common mistakes:** Do not also enter the same equipment as an expense or the same loan receipt as sales. If the preview does not describe the real event, go back and have the accountant check it.

# Purchases and Expenses
{{guide:30}}
{{guide:13}}
{{guide:57}}
## Supplier advances and money returned
**What it is for:** Record a supplier downpayment before the bill arrives and apply or recover it later.

**Before you start:** Have the supplier, purchase order if any, payment proof and the accountant's EWT instructions.

**Steps:**
1. Open **Purchases & Expenses** > **Supplier Advances** > **+ New Supplier Advance**.
2. Pick the supplier and **Purchase order (if it is a downpayment on one)**. Enter **Advance** before EWT and check **Tax withheld from supplier (EWT)**.
3. Under **Where did the money come from?**, enter the actual cash places and amounts. Add **Note**, then **Record**, review and confirm.
4. When recording the bill, check **Advances paid to this supplier** and **Apply on this bill**. Review the suggested application before recording the bill.
5. If the supplier returns money, open **Supplier Advance Returns** > **+ New Supplier Advance Return**. Choose the supplier and **Advance**, then fill **Where did the money go?** with the money actually returned. Add a note and **Record**, review and confirm.

**What the system does:** It tracks the advance still open. Applying it reduces the bill and avoids withholding EWT again on the part already withheld.

**Common mistakes:** Do not enter the downpayment again as an ordinary expense or pay the full bill without checking the advance. Have the accountant investigate an unexplained supplier balance.

{{guide:15}}

# Accounting and Tax
{{guide:17}}
{{guide:18}}
{{guide:29}}

## Journal vouchers and account-type warnings
**What it is for:** Record an accountant's adjustment that is not covered by an ordinary business form, and maintain the chart of accounts.

**Before you start:** Have the accountant's balanced entry and supporting paper. Do not use a journal voucher just to force two reports to agree.

**Steps:**
1. Open **Accounting & Tax** > **Journal Vouchers** > **+ New Journal Voucher**.
2. Fill **What is the entry for?**. Choose each line's account, debit or credit, and the customer, supplier or other party when asked. Use **+ Add a line** as needed.
3. Check that debits equal credits. For a late entry, fill **Date of the entry** and **Why is it recorded late?** when offered.
4. Click **Record**, review the entries, then **Record** again. Guide 59 explains scheduled reversals.
5. To add an account, open **Chart of accounts** > **Add an account**. Fill **Code**, **Name**, **Type** and the remaining choices, then **Add account**.
6. If a code/type warning appears, check it with the accountant before using the account.

**What the system does:** A mismatched type is a warning, not a refusal; the account is still saved. The warning says: “The statements group accounts by code, not by type. Check the code and the type before you use the account.” The first digit controls where it appears on the statements.

**Common mistakes:** Do not add the same account again because a warning appeared. Review the saved account. If its setup is wrong, ask the accountant to decide the correction before posting to it. Cash places belong in **Cash Accounts**.

{{guide:59}}
{{guide:61}}
{{guide:62}}
{{guide:53}}
{{guide:28}}

## Booklets, tax files and filing evidence
**What it is for:** Register paper booklet numbers and prepare, check and keep tax-return evidence.

**Before you start:** Have the booklet's authority and range. The accountant must confirm the current form, period and tax treatment before filing.

**Steps:**
1. Open **Accounting & Tax** > **Booklets**, click **Register booklet**, and enter **Kind**, **ATP number**, **Printer**, **First serial number**, **Last serial number** and **Date received**. Click **Register booklet**. Open a booklet to inspect used and skipped numbers.
2. Open the appropriate **SLSP: sales**, **SLSP: purchases**, **SAWT**, **0619-E (monthly EWT)**, **1601-EQ (quarterly EWT)**, **1702Q worksheet**, **1702-RT worksheet (annual)** or **1604-E (annual EWT)**. Pick its period and review the figures and warnings.
3. Correct missing IDs and classification from the source records. Use the download offered on that screen and validate it with the current official filing tools. The accountant checks adjustments, credits and prior payments.
4. File and pay through the official channel. Keep the acknowledgement and payment reference.
5. Open **Filed returns** > **Record a filing**. Fill **Form**, **Period**, **Date filed**, **Reference**, and optional note. Click **Record a filing**.
6. Record the actual BIR payment using guide 18. Check **Changes after filing** under **Reports** when later entries affect a filed period.

**What the system does:** Booklets track paper serial numbers separately from system numbers. Filing evidence keeps the form and period on file. The app's worksheet and filing log do not submit a return or move money at the bank.

**Common mistakes:** A wrong filing row is corrected with **Void**, a **Reason** and **Void this row**, then a correct filing row. This does not undo the real BIR filing; the accountant decides whether an amendment is needed. Do not reuse a cancelled paper invoice number.

{{guide:48}}
{{guide:33}}

# Reports
{{guide:9}}
{{guide:16}}
{{guide:54}}
{{guide:49}}
{{guide:26}}
{{guide:38}}
{{guide:50}}
{{guide:63}}

# Admin and Safety
{{guide:35}}
{{guide:11}}
{{guide:12}}
{{guide:25}}
{{guide:56}}
{{guide:58}}
{{guide:20}}
{{guide:31}}
{{guide:39}}
{{guide:43}}
{{guide:19}}

# Troubleshooting

## What to do first in an emergency
1. Stop recording if the database, books or audit trail is red, a restore is being considered, or amounts cannot be explained. Tell staff to keep dated paper records for later checking.
2. Keep the latest backups, offline copies and recovery keys safe. Do not overwrite or discard them while trying fixes.
3. The owner opens **Admin** > **System health** and clicks **Download support file** (guide 25).
4. Tell the owner and accountant what happened, which document numbers were involved, the time and exact message. Give the support file to the person who maintains the shop PC. It contains health information without shop names, amounts or file paths.
5. Resume only after the owner and accountant agree what is correct and how any paper work will be entered once.

## Cannot open the page
Check that the shop PC is on and the device is on the shop network or the approved VPN. Open the saved address. If the address changed, get the new one from the owner. Start the join page as in guide 10. A browser's connection error is not proof that a record failed: after reconnecting, search for the document before trying to record again. Call the owner or PC support if all devices fail.

## Certificate warning
If the browser says the connection is not private, follow guide 10. Check the code against the shop PC, install **Moonproject local CA**, and on iPhone or iPad turn on its trust switch. If the codes differ, stop and tell the owner. Do not ignore the mismatch.

## Forgot password or wrong password
“Wrong username or password.”: check the username and typing. Ask the owner to use **Users** > **Reset password** (guide 35), then sign in with the new temporary password and change it. If the owner cannot sign in, contact another authorized owner or PC support; do not create a second shop or reinstall to clear a password.

## Signed out
“You are signed out.”: sign in again. Password changes, a password reset or deactivation can end a session. Ask the owner if your login no longer works. Reopen the document list and check whether the last entry was recorded before repeating it. Saved drafts can be reopened; text that was never saved may need typing again.

## Button greyed out, hidden or Access denied
“Access denied.”: ask the owner to check **Roles and permissions**. A hidden button often means the role lacks permission. A disabled button often means required information or a prerequisite is missing:
- **Show** on reports needs valid dates; a customer statement also needs a customer (guides 38, 50 and 54).
- **Finish** in bank reconciliation needs saved ticks, matched statement lines and zero **Difference (must be zero to finish)**. Read “To finish:” (guide 32).
- An agency download needs employees and complete IDs. “The SSS file for ... was not made: no SSS number for...” means correct employee IDs; a missing employer number is entered on that month page (guide 34).
- **Make a job order** needs a real customer, not just a prospect (guide 40).
- **Record new answer** needs the required decision fields (guide 48).
- **Add a file** needs permission to create that kind of document (guide 58).
- **Forgive the rest** appears only for the first unsettled instalment with something due. A later instalment cannot skip an earlier one (guide 36).
Ask the accountant for business prerequisites and the owner for access. Do not borrow another person's login.

## Duplicate
For a supplier invoice, open the record named in the refusal and compare the paper. Do not type a different number to hide a duplicate. A permitted exception uses **Reason to go ahead anyway**, 10 to 200 characters, after the accountant checks it (guide 13). For a booklet number already used, inspect the existing record and booklet; never reuse a cancelled invoice. For an inventory count already recorded for that category and day, open and correct the existing count (guide 15).

## Signed-off month
“... is already signed off at month-end, so nothing new is dated ... Check the date printed on the document, or ask the accountant.”: compare the paper date, then stop and ask the accountant. Do not replace it with today's date just to pass the check. A sign-off is not undone. **Changed after sign-off** means the accountant must examine listed changes and **Sign off again** as appropriate (guide 33); that is not permission to falsify a printed date.

## Date refused
“Type the date printed on the document like 2026-09-30, or leave it empty for today.”: enter a real calendar day. “The date printed on the document cannot be after today (...)”: compare the paper with the server date. If the shop PC clock is wrong, tell the owner or PC support. If the date is correct but the month is signed off, ask the accountant. See guides 3, 4 and 13.

## Printer window blocked or print cut off
“Allow pop-ups for this site, then try Print again.”: allow pop-ups for the saved shop address and try again. “An owner must complete the company profile before printing.”: the owner follows guide 44. Check the selected printer, paper size and page preview. Run **Printer test pack** and leave **Printed well** unticked for a bad sample. Call PC support for printer problems and the owner for company details (guides 44 and 50).

## Backup light amber or red
Open **System health** and read the light's message. **Open Backups** leads to the fix: check **Status** > **Last runs**, recovery keys, folders, off-site syncing and USB rotation. After fixing the cause use **Back up now**. With no recovery keys, backups are off. Keep old keys while their backups are kept. “Backups and restores are not part of the practice shop.” means open the real shop. The owner handles this; call PC support for failed drives or copies (guides 11 and 25).

## Restore will not open or numbers are reused
Recheck the recovery key from its saved copy; spaces and small letters do not matter. Try the other key for that backup. **Back to the list** stops before confirmation. If the 30-minute restore window expires, open the backup again. Review **Last number now**, **Last in the backup** and **Issued again** with the accountant. Set aside affected old copies. Call the owner and PC support; a real restore is not a routine fix or a drill (guide 12).

## Numbers do not match
Use the same period, **As of** date and filters on both reports. Check whether a number is a booklet serial or an internal document number. Open source document links and check cancellations, reissues, deposits and entries after filing. “Closing cash does not equal the cash accounts on the balance sheet. Tell the accountant.” means do exactly that (guide 49). If books or audit checks are red, use the emergency steps. Never delete or make a balancing entry without the accountant's explanation.

## Cash count differs
Recount bills and coins. Check quantities and denominations, then compare **Cash book** for the same cash place. Look for a payment put in GCash instead of cash, a missing transfer or an unrecorded expense. Have the accountant check the difference before recording the count; it can adjust the books. If already recorded wrongly, cancel and redo with a reason (guides 7 and 8).

## Nightly check found something
A red cross with “found”, or “Last night's checks (...) found ... to look at”, means open the finding or **Open the report**. Use **Run the checks now** after resolving the cause. “No nightly check has run yet. The first one runs at the next 2:00 AM.” means it has no result yet. Tell the accountant about money or document findings, and PC support about backup, database or clock findings (guide 56).

## Shop PC off, slow or board not updating
Turn on the shop PC and check its power and network. **Not updated since** means production cards may be old; **Not updated yet** means the first update did not finish. Recheck the connection before relying on the board. The owner checks **System health**, especially **Disk space**, **Clock** and backups. Do not repeatedly click **Record** or switch off the PC while it is recording or restoring. Call PC support if several devices are slow (guides 25, 41 and 43).

# Glossary

## Plain words
- **2307:** certificate of tax withheld. A customer gives one for tax withheld from the shop; the shop issues one when withholding from a supplier.
- **2316:** the employee's compensation and tax-withheld certificate data for the year.
- **2550Q:** quarterly VAT return. **1601-EQ:** quarterly expanded withholding tax return. **0619-E:** monthly EWT remittance for the first two months of a quarter. **1601-C:** compensation withholding return.
- **ATC:** Alphanumeric Tax Code. It tells the BIR what kind of payment or withholding is being reported.
- **EWT:** expanded withholding tax deducted from a supplier's payment. **CWT:** creditable withholding tax, such as tax a customer withheld that the shop may claim with the supporting certificate.
- **Input VAT:** VAT on qualifying purchases. **Output VAT:** VAT on sales. VAT included means the stated price already includes it.
- **Accrual:** record an amount earned or owed in its proper period before cash is received or paid. **Reversal:** an opposite entry that undoes an earlier entry's effect.
- **Write-off:** remove a balance that will not be collected, with the required reason and accounting treatment. It does not erase the old document.
- **Forfeit:** keep an abandoned order's deposit under the agreed rules. It is different from a customer payment or refund.
- **Allowance:** may mean a price reduction on a credit memo, an estimate for credit losses, or an addition to pay. Check the screen's meaning.
- **SIL:** service incentive leave. The leave balance shows earned, used, paid in cash and left.
- **Sizer set:** sample sizes lent to a customer for fitting, then returned and checked.
- **JO:** job order. **CR:** collection receipt. **PO:** purchase order. **JV:** journal voucher.
- **Receivable / AR:** money customers owe the shop. **Payable / AP:** money the shop owes suppliers or others.
- **Deposit / downpayment:** money held against a customer's order before the sale is invoiced under the chosen rules. It is not automatically sales income.
- **Principal:** the borrowed amount still owed. **Interest:** the borrowing charge. **Forgiveness:** the lender agrees not to collect the remaining amount; never assumed from a short payment.
- **Fixed asset:** equipment or another lasting business asset. **Depreciation:** charge its cost over its useful life. **Book value:** cost less accumulated depreciation.
- **Reconciliation:** explain and match two sets of records, such as bank statement and cash book.
- **Cut-over date:** the date used for the opening balances when moving from the old books. **Sign-off:** the recorded review of a month; printed-date entries cannot newly use that month.
- **Draft:** saved unfinished work with no document number or posting. **Posted / recorded:** saved as a numbered event in the system. **Ledger:** the accounting entries behind balances.
- **Cash place:** a cash box, bank account, checks account or e-wallet. **Split payment:** one payment divided among cash places.
- **Pakyawan:** per-piece pay. **Bale:** cash advance. **Pasubra / rework:** work done to fix or redo pieces.
- **SLSP:** summary lists of sales and purchases. **SAWT:** summary alphalist of withholding taxes. **ATP:** authority to print the paper forms.
- **CSV:** a table file that a spreadsheet program can open. **PDF:** a fixed-layout document for reading or printing. **Support file:** the app's health information for the person helping with the PC.
- **Restore drill:** test opening a backup without replacing the live books. **Restore:** replace live data with an earlier backup; later work is lost and later numbers can be issued again.

# What to write on the booklet

## Keep this page beside the invoice booklet
1. Open the correct release's invoice record, downpayment invoice form, quick sale, or asset sale. Check the customer or buyer and the goods being invoiced.
2. Use the correct registered physical booklet and its next usable serial number. An internal JO, REL or INV-REC number is not the paper invoice number.
3. Under **Write these on the booklet**, copy **VATable sales**, **VAT** and **Total** exactly. Do not work out a second VAT figure yourself. Follow the accountant's rules for the customer's details and any other required particulars on the paper form.
4. Type **Invoice number (from the booklet)** exactly as written. On the separate invoice-record form, fill **Date on the invoice** with the paper's printed date. A blank date means today, not “unknown”.
5. Click **Record**, read the confirmation, then confirm with **Record**. Keep the paper and system record together for checking.
6. For collections, enter the CR booklet number when asked and **Date on the CR** on the collection form. Record the actual cash places and any 2307 tax separately. A deposit is not the same thing as a final sale.
7. If the booklet is unavailable at release, use **Invoice to follow (the booklet is not at hand)** and follow up through **Invoice Records**. Do not invent a number.
8. If wrong, stop and ask the accountant about the paper correction. In the app cancel and reissue as allowed. Mark the old paper “cancelled (all copies kept)”. Never reuse its number.

The app's quotation, job order, release slip or statement is not your BIR booklet invoice. The legend **THIS DOCUMENT IS NOT VALID FOR CLAIM OF INPUT TAX.** does not replace the paper invoice.

See guides 3 and 37 for releases and invoice records, 4 for collections, 5 for quick sales, 46 for asset sales, and 44 for print details. A future, impossible or signed-off-month printed date is refused; ask the accountant instead of changing the true date.

# Index of screens by menu

{{screens}}

# Quick Reference

## Common tasks and guide numbers
- New customer or measurement revision — [guide 1](guide:1).
- New order and downpayment — [guide 2](guide:2), full flow [guide 37](guide:37).
- Release goods and record the booklet invoice — [guide 3](guide:3).
- Receive money or split cash and GCash — [guide 4](guide:4).
- Walk-in quick sale — [guide 5](guide:5).
- Run payroll and release pay — [guide 6](guide:6).
- Count cash or inspect the cash book — [guide 7](guide:7), [guide 8](guide:8).
- Join a device — [guide 10](guide:10).
- Back up or run a restore drill — [guide 11](guide:11), [guide 12](guide:12).
- Supplier bill, payment or expense — [guide 13](guide:13); split payment [guide 57](guide:57).
- Bank reconciliation — [guide 32](guide:32).
- Close the month — [guide 33](guide:33).
- Reset a password or change access — [guide 35](guide:35).
- Short loan payment or Loan Forgiveness — [guide 36](guide:36).
- Record pieces and change production steps — [guide 41](guide:41).
- Attendance and holidays — [guide 42](guide:42).
- Test the printer — [guide 44](guide:44).
- Attach a photo or PDF — [guide 58](guide:58).
- Reverse an accrual — [guide 59](guide:59).
- Print the owners' meeting pack — [guide 63](guide:63).
- Emergency or red health light — [guide 25](guide:25), [guide 56](guide:56), and the Troubleshooting chapter.
