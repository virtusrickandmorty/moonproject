# 12. Restore from a Backup

**What it is for:** Prove your backups work by running a test (a "drill") every quarter, or put a backup back into the live system if something goes wrong.

**Before you start:** Have your printed Recovery Key A or Key B ready. The system will not let you open any backup without typing one of them. For a drill, nothing changes in the system. For a real restore, know that anything typed into the system after the backup was made will be lost.

### Steps
1. On the **Admin** menu, click **Backups**.
2. Click the **Restore and drill** tab.
3. You will see a list of backups. Pick one and click **Run drill** (or **Restore** for emergencies).
4. Type your **Recovery key A or B** exactly as printed on your sheet.
5. Click **Open the backup**.
6. Type your password in **Enter your password again to continue** and click **Continue**.
7. If you ran a drill, the system checks that the backup is completely sound, changes nothing in your live data, and records that you successfully did your drill.
8. If you chose Restore, the system checks the backup and shows you exactly what you will lose if you continue. The current data is kept safe for now.
9. To confirm the restore, type RESTORE in capital letters in **Type RESTORE to go ahead**.
10. Click **Restore this backup**.
11. Type your password in **Enter your password again to continue** and click **Continue**.
12. Everyone should save their work and sign out first, then restart Moonproject to finish the restore.

### What the system does for you
It keeps your backups completely safe by asking for the recovery key, and it prevents you from making a mistake by holding the live data to the side while you check the backup. It shows you the trial balance and how many documents are in the backup, so you know exactly what you are restoring.

### Common mistakes and how to fix them
- **Mistake:** You typed your recovery key, but the system says it is wrong.
- **Fix:** Correct the key in the box (spaces and small letters do not matter) and click **Open the backup** again. If it still does not open, try the other key. The system never saves your key, so you must get it right.
- **Mistake:** You changed your mind about restoring a backup after clicking **Open the backup**.
- **Fix:** Change your mind before clicking **Restore this backup**: click **Back to the list**, and nothing changes. The system allows 30 minutes between opening the backup and clicking **Restore this backup**. Once **Restore this backup** is clicked, nothing in the app takes it back, and the restore happens at the next restart.
