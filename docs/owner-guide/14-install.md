# 14. Installing Moonproject

**What it is for:** Install Moonproject on the shop's server PC.

**Before you start:** You will need to download the newest setup file from the internet.

### Steps
1. Go to GitHub Actions and find the newest "Windows installer" run.
2. Download the "Moonproject-Setup-0.1.<number>" download. Unzip it.
3. Run the `Moonproject-Setup.exe` file inside.
4. If Windows SmartScreen warns you, click "More info" and then "Run anyway".
5. The installer has one choice, the time zone box. Make sure it is checked and finish the setup. The program now runs by itself as a Windows service when the PC starts.
6. Open a web browser on the server PC and go to **http://localhost/**. (If another program already uses the web port, the page is at **http://localhost:8080/** instead).
7. You will see the "Join this PC" page. This shows the shop certificate code.
8. Leave this open. Then join each device with guide 10.

### What the system does for you
It installs the system and runs it in the background. It keeps all your records in `C:\ProgramData\Moonproject`. Inside are the `data`, `backups`, and `logs` folders.

### Common mistakes and how to fix them
- **Mistake:** You want to update or uninstall, but worry about losing data.
- **Fix:** Updating means running a newer `Moonproject-Setup.exe`. The data is kept. Uninstalling also keeps the data safe.
