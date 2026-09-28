# 25. System Health

**What it is for:** Monitor the health of the system and see if anything needs your attention to keep the shop's books safe.

**Before you start:** You must have the `sec.health.view` permission (which is normally given to the owner and accountant) to open the **System health** screen.

### Steps
1. On the **Admin** menu, click **System health**.
2. Look at the top light to see the overall health.
   - **Green**: Everything is in order.
   - **Amber**: Something needs doing soon. See the amber lights below.
   - **Red**: Something needs doing now. See the red lights below.
3. Read the message for any light that is not green, and click its link to fix it.

### What the system does for you
It checks different parts of the system and gives you a traffic light for each:
- **Backups**: Checks if backups are on and running. If not green, click **Open Backups** and back up now or set the recovery keys.
- **Off-site copy**: Checks if backups reach the off-site folder. If not green, click **Open Backups** and check that Google Drive is signed in and syncing.
- **USB copies**: Checks if backups are copied to USB drives. If not green, click **Open Backups** and copy the backups to the USB drive, then swap the drives.
- **Restore drill**: Checks if a restore drill was done recently. If not green, click **Open Backups** and open a backup with a recovery key to prove it can be restored.
- **Disk space**: Checks free space on the drive with the database. If not green, free up space so the books and backups have room.
- **Clock**: Checks if the server's clock is correct and in the right time zone. If not green, fix the time and time zone in the Windows settings.
- **System check**: Checks if a system check ran recently. If not green, press **Run system check**.
- **Database**: Checks if the database file is sound. If not green, stop recording, keep the latest backups and call for help.
- **Books**: Checks if journals and ledgers balance. If not green, click **Open Integrity check** for the details.
- **Audit trail**: Checks if the audit trail is intact. If not green, click **Open Integrity check**, stop recording, keep the latest backups and call for help.
- **Windows**: Checks if Windows is up to date (Windows 11). If not green, plan the move to Windows 11.
- **Practice shop**: Checks if the practice shop is ready. If not green, click **Open Practice shop**.
- **Version**: Shows the Moonproject version and tells you updates come as a new Setup.exe run on this PC.

The **Run system check** button lets you check the database, books, and audit trail right now. A system check runs every night by itself.

The **Download support file** button saves a file with the version, these lights, and some counts. It holds no names, amounts, or file paths of the shop, so it is safe to send to whoever helps with the PC.

### Common mistakes and how to fix them
- **Mistake:** You ignore a red light for a long time.
- **Fix:** Do not wait to fix red lights. Red lights mean something is wrong that puts your data or books at risk.
- **Mistake:** You ignore the warning to swap the USB drive.
- **Fix:** Go to **Open Backups**, copy the backups to the USB drive, and then swap the drives as instructed so you always have a recent offline copy.
