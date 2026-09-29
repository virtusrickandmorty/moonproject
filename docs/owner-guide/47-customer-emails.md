# 47. Customer Emails

**What it is for:** Automatically send updates to your customers about their orders and statements of account. You can track what was sent, failed, or is waiting to go out.

**Before you start:** You will need an App Password from your Google account (with 2-step verification turned on). Only the owner can change the email settings. Only customers who have agreed to receive emails will get them.

### Steps
**To turn on sending emails:**
1. On the **Admin** menu, click **Customer email settings** (or go to **Customer emails** and click the **Settings** tab).
2. Check the box to send emails to customers who agreed to them.
3. Type your **Mail server**, **Port**, **User name**, **Sender name**, and **Sender address**.
4. Type the **App Password**. The App Password is never shown again once you save it.
5. Click **Save**.
6. Click **Send a test email** to check if it works.

**To check the outbox or send again:**
1. On the **Sales** menu, click **Customer emails**.
2. Stay on the **Outbox** tab to see all emails. You can filter them by clicking **Waiting**, **Sent**, or **Failed**.
3. If an email is marked as failed, you can try sending it again by clicking the **Send again** button next to it.

**To email a statement of account:**
1. On the **Reports** menu, click **Customer statement**.
2. Pick a customer and dates, then click **Show**.
3. Click the **Email this statement** button.

### What the system does for you
The system automatically creates and queues emails for "Order received", "Ready for pick-up", and "Picked up" as you process job orders. It also queues "Statement of account" emails when you click the button. In the outbox, it tracks if an email is "Waiting to be sent", successfully "Sent", or "Failed" so you know exactly what the customer has received.

### Common mistakes and how to fix them
- **Mistake:** You fixed a typo in the email address but the email is still failing.
- **Fix:** Once the address on the customer record is fixed, go back to the outbox and click the **Send again** button. The system will use the new address.
