# 62. VAT on Uncollected Receivables

**What it is for:** Take the output VAT of a credit sale off the 2550Q when the customer has not paid after the agreed time to pay, and add it back when the customer finally pays. This guide is for the accountant.

**Before you start:** The claim is off until the accountant decides Virtus claims it (go-live decision ACC-27). To turn it on, on the **Accounting & Tax** menu, click **Settings**, find the setting **Claim output VAT on uncollected receivables once the agreed time to pay has passed**, and click **New version from a date**.

### Steps
**To claim output VAT on an uncollected receivable:**
1. On the **Accounting & Tax** menu, click **VAT on Uncollected Receivables**.
2. Click **+ New VAT on Uncollected Receivable**.
3. Under **Invoices whose agreed time to pay ended in an earlier quarter**, pick the invoice.
4. Under **The accountant confirms (the books cannot tell)**, tick all four boxes:
   - **A written agreement sets the time to pay**
   - **The sale is listed on its own in the SLSP**
   - **Its output VAT was declared on time in a filed 2550Q**
   - **This VAT is not claimed as part of a bad debt deduction**
5. Type a **Note** if you want (optional).
6. Read the box **What will be recorded**.
7. Click **Record**. Read the box **Record this VAT on Uncollected Receivable?**, then click **Record** again. Click **Go back** if something is wrong.

**To add back output VAT when the customer pays:**
1. On the **Accounting & Tax** menu, click **VAT on Recovered Receivables**.
2. Click **+ New VAT on Recovered Receivable**.
3. Under **Claims whose customer has paid since**, pick the claim.
4. Type a **Note** if you want (optional).
5. Read the box **What will be recorded**.
6. Click **Record**. Read the box **Record this VAT on Recovered Receivable?**, then click **Record** again.

### What the system does for you
It lists only the invoices that can be claimed and the claims whose customer has paid since. It checks the rules it can (the sale date, a time to pay, VAT on the invoice, the quarter closed, not written off). Before you record, the box reads like: "This will take [amount] output VAT off this quarter's 2550Q for [invoice] of [customer] ... It is added back when the customer pays." For an add-back, it works out the VAT on what the customer paid and reads like: "This will add [amount] output VAT back to this quarter's 2550Q".

### Common mistakes and how to fix them
- **Mistake:** You see "Claiming output VAT on uncollected receivables is off."
- **Fix:** The setting is off. The accountant turns it on in **Settings** (ACC-27).
- **Mistake:** You see "No invoice can be claimed" or "No add-back is due".
- **Fix:** Nothing qualifies yet. An invoice shows only in the quarter after its time to pay ended, and a claim shows only after the customer pays.
- **Mistake:** You picked the wrong invoice or claim.
- **Fix:** You cannot delete it. Open it and click **Edit** to record a corrected one, or click **Cancel**, type a reason, and click **Cancel document**. If the claim already has an add-back, cancel the add-back first.
