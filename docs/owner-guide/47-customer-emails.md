# 47. Customer Emails

**What it is for:** Automatically send updates to your customers about their orders and statements of account. You can track what was sent, failed, or is waiting to go out.

**Before you start:** You will need an App Password from your Google account (with 2-step verification turned on). Only the owner can change the email settings. Only customers who have agreed to receive emails will get them.

### Steps
**To turn on sending emails:**
1. On the **Admin** menu, click **Customer email settings** (or go to **Customer emails** and click the **Settings** tab).
2. You will see a notice like "Sending is OFF. No customer is emailed until you turn it on." Check the box to send emails to customers who agreed to them. "Turning it on starts from now: orders recorded while it was off are not emailed later."
3. Type your **Mail server**, **Port**, **User name**, **Sender name**, and **Sender address**. If anything is missing, a message like "Still needed before sending can be on: ..." will show you what.
4. Type the **App Password**. The App Password is never shown again once you save it.
5. Click **Save** and it will open a password box asking to "Save the email settings".
6. Click **Send a test email**. This button stays off until an App Password is saved. The screen will remind you: "The test email goes to the sender address. Save your changes first." This also opens a password box asking to "Send a test email".

**To check the outbox or send again:**
1. On the **Sales** menu, click **Customer emails**.
2. Stay on the **Outbox** tab to see all emails. You can filter them by clicking **All**, **Waiting**, **Sent**, or **Failed**.
3. If an email is marked as failed and you are allowed to resend (like the owner), you can try sending it again by clicking the **Send again** button next to it. If sending is off, it will warn you: "Sending emails is turned off. Turn it on in the email settings first."

**To email a statement of account:**
1. On the **Reports** menu, click **Customer statement**.
2. Pick a customer and dates, then click **Show**.
3. If you have permission to send statements, the **Email this statement** button appears. Click it.
4. On success, you will see "Queued. It goes out with the next batch: see Customer emails." Or, if they did not agree, it will say "This customer has not agreed to get emails."

### What the system does for you
The system automatically creates and queues emails for "Order received", "Ready for pick-up", and "Picked up" as you process job orders. It also queues "Statement of account" emails when you click the button. In the outbox, it tracks if an email is "Waiting to be sent", successfully "Sent", or "Failed" so you know exactly what the customer has received.

### Common mistakes and how to fix them
- **Mistake:** You fixed a typo in the customer's email address and expect a queued email to go to the new address.
- **Fix:** An email keeps the address it had when it was queued, which you can see under the customer's name in the outbox. The **Send again** button tries that same queued address. You must cancel the transaction and redo it so a new email is queued with the updated address.
