# 14. Installing Moonproject

**What it is for:** Install Moonproject on the shop's server PC.

**Before you start:** Download Moonproject-Setup.exe. To do this, find the "Moonproject-Setup-0.1.<number>" download of the newest "Windows installer" run on GitHub Actions and unzip it.

### Steps
1. Run Moonproject-Setup.exe.
2. If Windows SmartScreen warns you, click "More info" and then "Run anyway".
3. The installer has one choice. It is a time zone box to set this PC's time zone to Manila (UTC+8). Moonproject dates everything in Manila time.
4. Finish the installation.
5. Open http://localhost/ on the server PC to see the "Join this PC" page and the shop certificate code. If another program already uses the web port, the page is at http://localhost:8080/ instead.
6. Then join each device with guide 10.

### What the system does for you
The program runs by itself as a Windows service when the PC starts. Where the data is kept is `C:\ProgramData\Moonproject`, with the `data`, `backups`, and `logs` folders.

### Common mistakes and how to fix them
- **Mistake:** You do not know how to update the system.
- **Fix:** Updating means running a newer Setup.exe. The data is kept safely.
- **Mistake:** You worry about your data when you uninstall.
- **Fix:** Uninstalling keeps the data exactly where it is.
