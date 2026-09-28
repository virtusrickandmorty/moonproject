# 17. Opening balances

**What it is for:** Record the balances your business had on the exact day you start using this system, so your new books continue seamlessly from the old ones.

**Before you start:** Have the final reports from your old accounting system ready. You need the list of unpaid bills, open job orders, active loans, fixed assets, and the final trial balance.

### Steps
1. On the **Admin** menu, choose **Opening balances**.
2. Pick the **Cut-over date** and click **Set the cut-over date**. This is the last day your old books cover, usually a month end. The books open on this date, and every opening document is dated that day.
3. Record your opening balances in this order:
   - First, record your cash and bank balances using **New opening balances**.
   - Next, record what customers owe you for work in progress using **New opening job order**.
   - Then, record the bills you still owe using **New opening supplier bill**.
   - After that, record your active loans using **New opening loan**.
   - Finally, record your fixed assets using **New opening fixed asset**.
   - For everything else on your old trial balance (like inventory, equity, or prepayments), use **New opening balances** to enter the lines.
4. Check the system's progress under **The checks**.
   - **Opening balance equity (3900)** is a temporary holding area that balances your entries while you type them in, and it must end at zero to prove you entered all your old balances completely and correctly.
   - Look at the **Trial balance on the cut-over date**. It will say "Balances" when your debits and credits match.
   - Look at the accounts kept per customer, supplier or person. The system checks that the **Account total** matches the **Sum of parties**. They must say "Tied".
5. When the checks are all clear and 3900 is zero, click **Close the opening**.

### What the system does for you
It keeps track of everything you enter and shows you exactly what is missing or unbalanced. It automatically builds the opening trial balance from the separate documents you enter. Once you close the opening, it locks the cut-over date and prevents accidental changes to your starting numbers.

### Common mistakes and how to fix them
- **Mistake:** You entered a wrong amount in an opening document after you closed the opening.
- **Fix:** You cannot cancel or edit opening documents after the opening is closed. To fix mistakes from now on, you must record a journal voucher.
- **Mistake:** The cut-over date is wrong, but the system will not let you move it.
- **Fix:** It moves only while no opening document is recorded on it. You must cancel all opening documents first, then click **Move the cut-over date**.
