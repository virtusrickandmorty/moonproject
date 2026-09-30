# 37. Job Orders, Release Slips and Invoices

**What it is for:** Record a customer's order for team jerseys or services, track what they owe, release the finished goods to them, and issue the booklet invoice.

**Before you start:** Know the customer's name, what they are ordering from the price list, their wearers and sizes, and when it is due. When releasing, you need to see the ID of the person who claims the order.

### Steps

**Making a job order:**
1. Open **Job Orders** under **Sales**, then click **+ New Job Order**. The form's heading is **New job order**.
2. In the **Customer** panel, pick the customer from the list or click **+ New customer**. If it's a new customer, type **New customer's name**, pick **Kind of customer** (**Team, school or company** or **Person**) and click **Add customer** (or **Never mind**).
3. Under **What is made**, click **+ Add a line** to add more lines. Type at least two letters to search the price list, and pick the item. The price fills in from the price list for that number of pieces; you can type a different price.
4. Fill in the pieces. If you have a list of wearers, open **Wearers** on the line. Use the **Add a wearer…** or **Pull a whole group…** drop-down, or click **Paste from Excel**, paste the rows, and click **Add these**. For a name that is not on file, click **+ One-off name** and type it in. For each wearer pick the **Size** (or **Measured** for a wearer on file) and type the **Jersey name**, **No.** and **Qty**. Once wearers are listed, the pieces follow them.
5. Under **Terms**, type the **Due in (days)** and pick the **Payment terms**.
6. Check the **Total** and **Downpayment asked** under **So far**, then click **Record**. If you are not ready, click **Save draft** instead: a draft has no number and records nothing until you press **Record**.

**Taking the downpayment:**
1. Open the job order.
2. If a downpayment is still asked and you have permission, click the **Take the downpayment** button. (In mode C, the button opens the downpayment invoice form first, then the collection follows).
3. To take any other payment on the order, click **Take a payment** instead.
4. Finish recording the collection.

**Changing a job order:**
1. Open the job order you want to change.
2. Click **Edit** (or **Cancel** if you only want to cancel it). **Edit** first opens a box "Edit <number>" that says "A recorded document is never changed. <number> will be cancelled and a new one issued with a new number. Nothing changes until you record the replacement." You type a reason and click **Continue to edit**. **Cancel** opens a box "Cancel <number>?" that asks for a reason, then **Cancel document**.
3. Make your changes and click **Record**.
4. If there were deposits, you will see a notice to move them to the replacement job order.

**The release slip:**
1. Open the job order and click **Release**, or open **Release Slips** from the **Sales** menu. The form is **New release slip**. It starts with a **Job order** panel.
2. Under **What goes out**, tick the lines and pieces that are going out now.
3. Under **Who claimed it**, type the **Claimed by** name and pick the **ID seen**. Only the kind of ID is kept, never its number.
4. Under **Not ready yet** (shown only when the job order is not ready for release), the owner types the **Owner's reason to release it now** (at least 10 characters). Anyone else must first mark the order ready, or ask the owner.
5. Under **Still to be paid**, if the job is not paid in full, only the owner or the accountant can release it. They type **Why it goes out before it is paid** and **Pay within (days)** to give credit. Anyone else must take the payment first.
6. Under **Invoice**, type the **Invoice number (from the booklet)**, or tick **Invoice to follow (the booklet is not at hand)**.
7. Click **Record**. In the **Record this release?** box, click **Record** again (or **Go back**).

**Recording the booklet invoice:**
1. If the invoice was not recorded with the release, click **Invoice Records** from the **Sales** menu, or click **Record invoice** on the job order.
2. Pick the release by its number (it starts with REL-).
3. Under **Write these on the booklet**, copy the **VATable sales**, **VAT**, and **Total** exactly as shown to your physical booklet.
4. Type the **Invoice number (from the booklet)** you just wrote. You can also fill the **Note** box.
5. Click **Record**.

### What the system does for you
The system keeps track of the **Balance due** (what the customer still owes) on the job order. It only lets you release what is left, and knows if the invoice is to follow. When a job order is cancelled and reissued, any money already collected is kept as deposits held until you move it or pay it back.

### Common mistakes and how to fix them
- **Mistake:** You cannot add wearers because you forgot the customer.
- **Fix:** The app shows **Pick the customer first.** Pick the customer before you add wearers.
- **Mistake:** You made a mistake on a recorded release slip.
- **Fix:** You cannot edit a release slip. Cancel its invoice record first (if it has one), then cancel the wrong release slip and record a new one with the right details.
