# 62. VAT on Uncollected Receivables

**What it is for:** Claim output VAT on a credit sale you have not collected yet, and add it back to the books when the customer finally pays. This guide is for the accountant.

**Before you start:** The claim is off. The accountant turns it on in the settings (ACC-27) after deciding Virtus claims it.

### Steps
**To claim output VAT on an uncollected receivable:**
1. On the **Accounting & Tax** menu, click **VAT on Uncollected Receivables**.
2. Click **New**.
3. Under **Invoices whose agreed time to pay ended in an earlier quarter**, pick the invoice you want to claim.
4. **The accountant confirms (the books cannot tell)** the rules set by the BIR. Check all four boxes:
   - **A written agreement sets the time to pay**
   - **The sale is listed on its own in the SLSP**
   - **Its output VAT was declared on time in a filed 2550Q**
   - **This VAT is not claimed as part of a bad debt deduction**
5. Type an optional **Note** if needed.
6. Click **Record**.

**To add back output VAT when the customer pays:**
1. On the **Accounting & Tax** menu, click **VAT on Recovered Receivables**.
2. Click **New**.
3. Under **Claims whose customer has paid since**, pick the claim you want to add back.
4. Type an optional **Note** if needed.
5. Click **Record**.

### What the system does for you
When you record a claim, the system takes the output VAT off this quarter's 2550Q worksheet and defers it. When you record an add-back, it works out how much the customer paid and puts that part of the output VAT back onto the 2550Q.

### Common mistakes and how to fix them
- **Mistake:** You recorded a claim or an add-back with a wrong note, or you picked the wrong invoice.
- **Fix:** You cannot change it once recorded. Cancel the record and make a new one with the right details.
