# 31. Importing the old data

**What it is for:** Bring your customers, measurements, employees, and the rest from the old Google sheet into the system. Nothing goes in until you have reviewed the rows and run a dry run. Only an owner can commit the import.

**Before you start:** Prepare the old Google sheet. In the old sheet, open a tab and choose File, Download, Comma-separated values (.csv). Save each tab as its own CSV file on your computer, as downloaded. The Labor Rates tab is not needed.

### Steps
1. On the **Admin** menu, choose **Import old data**.
2. To start a new upload, use **Upload a file from the old sheet**. (To go back to an earlier upload, click **Review** on its line under **Uploads**.) Under **What is in the file?**, pick what the file holds, choose the **CSV file**, and click **Upload and stage the rows**. The system reads the file but does not import anything yet.
3. Review the staged rows. Only rows with something wrong are listed; rows with nothing wrong go in as they are. Each listed row must be dealt with:
   - If the row is good, click **Accept**. (Accept is only available when nothing is wrong with the row.)
   - If there is a problem, click **Fix**, type the correction, and click **Save the fix and accept**. The system checks the row again.
   - If a row is a duplicate, click **Merge**, pick the row to keep, and click **Merge into that row**.
   - If a row should be left out, click **Exclude**, type a reason, and click **Exclude the row**. The reason is shown on the screen while you work, but the system does not keep it.
4. When no row still needs review, look at the **Dry run** section.
   - Click **Run the dry run**.
   - The system counts what would go in and shows **Totals to check against the old sheet**, including what the measurement cells add up to. Nothing is imported.
   - Compare these totals to your old Google sheet. If they do not match, stop and fix the problems. If you change any row, run the dry run again.
5. Once the dry run totals are correct, look at the **Commit** section. You can only commit after the dry run, and only an owner can commit.
   - Click **Commit the import**.
   - A "Commit the import?" box opens, showing the measurement cell total again. Click **Commit the import** again to proceed, or click **Go back** if you need to recheck. The system may ask for your password again. The system then creates the customers, wearers, measurements, employees and piece rates in one step. It cannot be undone.
6. After you check the imported records, clear the staged values.
   - Look at the **Clear the staged values** section.
   - Click **Clear the staged values** and then **Clear them**. This wipes the names and rates in the staged rows. The imported records are not touched.

### What the system does for you
It holds the uploaded rows in a staging area so you can review and fix them safely. The dry run counts what would go in and checks that every row of the file is counted once, without importing anything. Nothing is deleted, and a row already imported from an earlier file is not created twice.

### Common mistakes and how to fix them
- **Mistake:** You uploaded the wrong CSV file or chose the wrong kind of data.
- **Fix:** Do not commit it. You can simply leave it and upload the right file.
- **Mistake:** The dry run measurement total does not match the old sheet.
- **Fix:** Go back to the review. Find the row with the wrong measurement, use **Fix** to type the correct number, and run the dry run again.
