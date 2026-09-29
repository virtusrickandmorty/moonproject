# 39. Switch-over day

**What it is for:** Move from your old system (the Apps Script and VERSION 2) to the Moonproject on a single switch-over date agreed by all three owners.

**Before you start:**
* The three owners must agree on the date.
* The accountant has made their decisions.
* Test prints are successful.
* You have passed a [restore](12-restore.md) drill.
* Your recovery keys are stored safely (see [Backups](11-backups.md)).
* You have practiced on the [Practice shop](20-practice-shop.md).

### Steps
1. Freeze the old apps. Do not make new entries after closing time the day before.
2. Download each tab of the old Apps Script sheet as a CSV file. On the **Admin** menu, click **Import old data**, review the data, and import it.
3. Record your [Opening balances](17-opening-balances.md) (cash counts, bank balances, open job orders, bills, loans, and fixed assets). The accountant signs the opening trial balance.
4. Re-create the job orders that are still in production as live job orders with their remaining steps.
5. Make the old apps read-only. Turn off the Apps Script web deployment and archive the VERSION 2 database.
6. Start making your first real entries in Moonproject.
7. Do your first [Cash counts](07-cash-count.md) at the end of the day.

### What the system does for you
It brings your old records into the new single ledger so you can continue seamlessly. For the first three days, monitor the system closely. If the trial balance or cash cannot be reconciled, or if a posting defect with money impact is found and not fixed within a day, stop using the new system and go back to paper.

### Common mistakes and how to fix them
- **Mistake:** A money problem is found in the first three days that stops the books balancing.
- **Fix:** Do not delete or force a fix. Pause the new system, keep paper records, and fix the issue. Then, cancel and redo the opening process using the saved import.
