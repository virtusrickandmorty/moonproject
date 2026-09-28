# 19. Calendar and Audit Log

**What it is for:** View upcoming events, deadlines, and birthdays on the calendar, track every change made in the system using the audit log, and check the system's data integrity.

**Before you start:** Be sure you know the details for any events you plan to add to the calendar.

### Steps

**Calendar**
1. On the **Overview** menu, click **Calendar**.
2. The calendar shows different kinds of events like Booked events, Job orders due, Releases, Holidays, Tax deadlines, Customer birthdays, and Employee birthdays.
3. You can use the **Show** drop-down to filter the calendar (for example, pick "Booked events" or "All kinds").
4. To book a fitting or another booking, click **+ New event**.
5. Type a **Title** and select a **Date** and **Time (optional)**.
6. You can also pick a **Find customer (optional)** and a **Job order (optional)**, and type **Notes (optional)** if needed.
7. Click **Save event**.
8. To change an event, click **Manage** on the event in the calendar.
9. To move the event, pick a new **Move to date** and **Time**, then click **Move**.
10. To cancel an event, type a **Cancellation reason** and click **Cancel event**.

**Audit Log**
1. To see who changed what, go to the **Admin** menu and click **Audit log**.
2. Under **Filters**, you can type or select a **From** date, **To** date, **User**, **Action**, **Entity type**, and **Entity ID**.
3. Click **Show** to view the matching entries.
4. If you want a spreadsheet of the log, click **Download CSV**.
5. Every download of the CSV is itself recorded as an action in the audit log.

**Integrity Check**
1. To run a check on your data, go to the **Admin** menu and click **Integrity check**.
2. The system will start checking automatically. You can click **Check again** to re-run it.
3. Under **Audit chain** and **Checks**, a green line means that part of the system is safe and correct.
4. A red line means there is a problem with the data.
5. If you see a red line, stop and call your accountant.

### What the system does for you
The system keeps everything organized. The calendar reminds you of important dates. The audit log saves a secure record of every action. The integrity check constantly checks the database to make sure no records have been tampered with or corrupted.

### Common mistakes and how to fix them
- **Mistake:** You clicked on an event on the calendar to fix a typo in the title or notes, but there is no save button.
- **Fix:** You cannot change the title or notes of an event once saved. To fix a mistake, just cancel and redo it. Open the event, type a **Cancellation reason**, and click **Cancel event**. Then click **+ New event** to create a new one with the correct details.
