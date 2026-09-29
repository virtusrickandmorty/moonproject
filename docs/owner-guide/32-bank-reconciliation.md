# 32. Bank reconciliation

**What it is for:** Check that your bank accounts in the system match your real bank statements. You do this each month, per bank account, from the bank statement.

**Before you start:** You will need the printed or downloaded bank statement for the month you want to reconcile.

### Steps
1. On the **Money** menu, click **Bank reconciliation**.
2. Under **Start a reconciliation**, pick the **Bank account** from the list.
3. Type the **Statement date** (the last day on the statement) and the **Statement ending balance** exactly as printed.
4. Click **Start**.
5. Under **Cash book items: tick what cleared the bank**, look at your real statement and tick the box for every item that cleared the bank.
6. Click **Save ticks**. You must save your ticks before you can finish.
7. Click **Finish**. This button stays off until the ticks are saved, every statement line is matched, and the **Difference (must be zero to finish)** is zero. The screen lists what is missing after "To finish:".

### What the system does for you
The system helps you find missing money or mistakes. It takes the **Book balance at [date]**, then takes out **Less deposits in transit (in the books, not on the statement)** (money you received but the bank has not cleared yet), and adds back **Add outstanding payments (paid in the books, not cleared)** (checks you gave out but were not cashed yet) to find the **Books adjusted to the statement**. This must equal the **Statement ending balance**.

If you have permission to record them, you will see a **Record a bank adjustment** button. You can click it to record a **Bank charge** or **Interest earned** that is not in your books yet. The system checks that the **Difference (must be zero to finish)** is exactly zero before it lets you finish. Past reconciliations are kept safe under **Past reconciliations**. Clicking **Finish** locks the month, and a finished reconciliation can only be viewed.

### Common mistakes and how to fix them
- **Mistake:** The **Difference (must be zero to finish)** is not zero, but you already ticked everything on the statement.
- **Fix:** You might be missing a bank charge or interest. Click **Record a bank adjustment** to add it. You might have also typed the wrong amount on a collection or payment. If you made a mistake on a document, you must cancel and redo it with the correct amount. You cannot delete documents.
- **Mistake:** You want to change a past reconciliation.
- **Fix:** You cannot change it. **Finish** locks the month, and a finished reconciliation can only be viewed.
