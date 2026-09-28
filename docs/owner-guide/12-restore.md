# 12. Restore from a Backup

**What it is for:** Prove your backups work by running a test (a "drill") every quarter, or put a backup back into the live system if something goes wrong.

**Before you start:** Have your printed Recovery Key A or Key B ready. The system will not let you open any backup without typing one of them. For a drill, nothing changes in the system. For a real restore, know that anything typed into the system after the backup was made will be lost.

### Steps

#### Run the quarterly drill
1. On the **Admin** menu, click **Backups**.
2. Click the **Restore and drill** tab.
3. You will see a list of backups. Pick one and click **Run drill**.
4. Type your **Recovery key A or B** exactly as printed on your sheet.
5. Click **Open the backup**.
6. The system will open the backup, check that it is completely sound, and record that you successfully did your drill. It will change nothing in your live data.

#### Restore a backup (only for emergencies)
1. On the **Admin** menu, click **Backups**.
2. Click the **Restore and drill** tab.
3. Pick the backup you want and click **Restore**.
4. Type your **Recovery key A or B** exactly as printed.
5. Click **Open the backup**.
6. The system checks the backup and shows you exactly what you will lose if you continue. The current data is kept safe for now.
7. To confirm, **Type RESTORE to go ahead** in the box.
8. Click **Restore this backup**.
9. The restore will finish the next time the Moonproject system starts up.

### What the system does for you
It keeps your backups completely safe by asking for the recovery key, and it prevents you from making a mistake by holding the live data to the side while you check the backup. It shows you the trial balance and how many documents are in the backup, so you know exactly what you are restoring.

### Common mistakes and how to fix them
- **Mistake:** You typed your recovery key, but the system says it is wrong.
- **Fix:** Cancel and redo it. Take your time to type the recovery key exactly as printed. The system never saves your key, so you must get it right.
- **Mistake:** You clicked **Restore this backup** but you changed your mind.
- **Fix:** If you change your mind, do not restart Moonproject. The system warns you that it keeps the current data next to the restored one. If you wait more than 30 minutes, or if you open the backup again, you can cancel it.
