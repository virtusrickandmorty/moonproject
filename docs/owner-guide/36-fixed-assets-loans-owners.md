# 36. Fixed assets, loans and owners

**What it is for:** See your fixed assets (like equipment), your loans, and the people who own or run the business. Check asset values and depreciation, track late loan payments, and record money moving between the company and its owners or officers.

**Before you start:** You will need to know which list you want to look at. For making changes, know the asset you are depreciating or throwing away, the loan you are paying, or the owner/officer bringing in or taking out money.

### Steps
1. On the **Money** menu, click **Fixed assets**, **Loans**, or **Owners and officers**.
2. **For fixed assets:**
   - You can see the list of assets with their cost, accumulated depreciation so far, and book value.
     ![The Fixed assets screen](img/36-fixed-assets.png)
   - Click **Run depreciation** to record the monthly wear and tear. Choose the **Month to depreciate** and click **Record the run**. The system will warn you if a month was missed.
   - To look closer, click an asset. Run the month's depreciation before taking it off the books. Click **Dispose of this asset**, choose **Sold** or **Retired**, and type in **Why is it being taken off?**. For **Sold**, follow guide 46 for the sale details. For **Retired**, nothing is received and the book value left is charged as a loss. Review the details, then click **Record the disposal**.
3. **For loans:**
   - You will see your loans and what is late.
   - Click a loan to see its schedule, payments made, and any late instalments.
   - If you have permission to record them, click **Record a loan** to add a new one, or **Record a payment** to pay one down.
4. **For owners and officers:**
   - You will see the list of stockholders and officers. If you have permission to view balances, you will see what they owe the company, and what the company owes them.
     ![The Owners and officers screen](img/36-owners-and-officers.png)
   - Click a person to see **What is due**, their **Owner money**, **Officer money out and back**, and the **Officer ledger**.
   - If you have permission to record them, click **Record owner money** for owner investments, or **Record officer money out or back** when an officer takes out money or brings it back.

### What the system does for you
It keeps all these records organized and does the math for you. It tracks the exact book value of assets month by month and alerts you if you forget to run the depreciation (the warning shows on the **Fixed assets** list). Late instalments are worked out as of the server's date when you open **Loans** or a loan. If you pay less than an instalment, it is not marked paid: the rest stays due on that instalment (and shows as late once past its due date), and the next payment on it starts from what is left. For owners and officers, it adds up all the money brought in and taken out so you always know exactly who owes what.

### Common mistakes and how to fix them
- **Mistake:** You clicked the wrong month to run depreciation or typed the wrong amount for a loan payment.
- **Fix:** Do not try to delete the record. Instead, find the wrong record, cancel it, and then redo the steps to record it correctly.
- **Mistake:** You want to sell an asset but chose **Retired**.
- **Fix:** Choose **Sold** and follow guide 46. Run the month's depreciation first.

### A short loan payment stays owed

**What it is for:** Record what was actually paid when it is less than the instalment.

**Before you start:** Have the lender's statement showing the principal and interest paid.

**Steps:**
1. Open **Money** > **Loans**, open the loan and click **Record a payment**.
2. Check the instalment offered and choose **Where did the money come from?**.
3. Tick **The amount or split differs (a part payment, or the lender applied it differently)** if needed, then enter **Principal**, **Interest** and **Why is it different?**.
4. Click **Record**, read the confirmation and click **Record** again.

**What the system does:** Only the amount paid reduces the debt. The unpaid rest remains on that instalment, stays on the late list after its due date, and is offered for the next payment.

**Common mistakes:** A short payment is not a settlement. Record the rest when paid. Do not use forgiveness unless the lender actually forgave it.

### Loan Forgiveness

**What it is for:** Close the unpaid rest of an instalment when the lender forgives it.

**Before you start:** Keep the lender's confirmation. Owners, accountants and encoders have permission by default. Nothing is forgiven automatically.

**Steps:**
1. Open **Money** > **Loans**, then the loan.
2. On the schedule or **Late** list, click **Forgive the rest** beside the first unsettled instalment.
3. Read **Principal**, **Interest** and **Amount forgiven**. These are read-only: all the rest is forgiven, never more.
4. Fill **Why did the lender forgive it? (10 to 200 characters)** and, if useful, **Note** with where the letter is kept.
5. Click **Record**, check the confirmation, then click **Record** again.

**What the system does:** It records a Loan Forgiveness with an LFGV number. Forgiven principal lowers the loan and is booked as a gain on debt forgiveness. Forgiven interest posts nothing because interest is expensed only when paid. The instalment shows as forgiven, leaves the late list, and the next due moves on.

**Common mistakes:** Open a mistaken forgiveness document and use **Cancel**, give a reason and click **Cancel document**. Its reversal reopens the instalment. Cancel the forgiveness before cancelling the short payment it depended on. A fully paid or already forgiven instalment cannot be forgiven again.
