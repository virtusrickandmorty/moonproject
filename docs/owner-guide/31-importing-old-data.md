# 31. Importing the old data

**What it is for:** Bring your customers, measurements, employees, and the rest from the old Google sheet into the system. This is done once, by the owner, with the accountant, before the switch-over to the new system.

**Before you start:** Prepare the old Google sheet. You need to save each tab of the old sheet as a separate CSV file on your computer.

### Steps
1. On the **Admin** menu, choose **Import old data**.
2. Click on an existing upload, or use **Upload a file from the old sheet** to start a new one. Pick what the file holds, choose the **CSV file**, and click **Upload and stage the rows**. The system reads the file but does not import anything yet.
3. Review the staged rows. Each row must be checked:
   - If the row is good, click **Accept**.
   - If there is a problem, click **Fix**, type the correction, and click **Save the fix and accept**.
   - If a row is a duplicate, click **Merge**, pick the row to keep, and click **Merge into that row**.
   - If a row should be left out, click **Exclude**, provide a reason, and click **Exclude the row**.
4. When all rows are accepted, merged, or excluded, look at the **Dry run** section.
   - Click **Run the dry run**.
   - The system checks what would go in. It gives you the total counts and the sum of the measurement cells.
   - Compare these totals to your old Google sheet. If they do not match, stop and fix the problems.
5. Once the dry run totals are correct, look at the **Commit** section.
   - Click **Commit the import**. The system brings the rows into your live database.
6. After you check the imported records, you must clean up.
   - Look at the **Clear the staged values** section.
   - Click **Clear the staged values** and then **Clear them**. This wipes the temporary staging area.

### What the system does for you
It holds the uploaded rows in a staging area so you can review and fix them safely. The dry run checks the math and duplicates without touching your real books. It only commits the records when everything balances and is confirmed.

### Common mistakes and how to fix them
- **Mistake:** You uploaded the wrong CSV file or chose the wrong kind of data.
- **Fix:** Do not commit it. You can exclude all its rows or simply ignore it and upload the right file.
- **Mistake:** The dry run measurement total does not match the old sheet.
- **Fix:** Go back to the review. Find the row with the wrong measurement, use **Fix** to type the correct number, and run the dry run again.
