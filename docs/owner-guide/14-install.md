# 14. Installing Moonproject

**What it is for:** Install Moonproject on the shop's server PC.

**Before you start:** You will need to download the newest setup file from the internet.

### Steps
1. On GitHub, open **Actions**, then **Windows installer**. Pick the newest run on the **main** branch that has a green tick.
2. Under **Artifacts**, download **Moonproject-Setup-0.1.<number>**. It comes as a zip file: unzip it.
3. Run the `Moonproject-Setup.exe` file inside.
4. If Windows SmartScreen warns you, click "More info" and then "Run anyway".
5. When Windows asks if you want to allow this app to make changes to your device, click **Yes**. You need a Windows administrator account.
6. The installer has a time zone box. Make sure it is checked.
7. Leave **Open the "Join this PC" page** ticked and click **Finish**. The program now runs by itself as a Windows service when the PC starts.
8. The browser opens the page. If it does not open, go to **http://localhost:8080/**.
9. You will see the "Join this PC" page. This shows the shop certificate code.
10. Leave this open. Then join each device with guide 10.
11. Create the owner account **on this shop PC**, in its own browser. Moonproject refuses to create the first owner from any other device on the network and shows "Create the owner account on the shop PC itself".

### Before putting the website shop on the internet
1. Create the owner account in the browser **on the shop PC** and finish setup privately.
2. Turn on automatic backups, keep an off-machine copy, and complete a restore drill (guides 11 and 12).
3. Ask the installer to put trusted HTTPS in front of the public shop. Check that its certificate is trusted by an outside browser.
4. Give the public shop pages their own address. Ask the installer to allow only the shop pages and their shop/support requests there, keeping accounting, staff sign-in, setup, device joining and practice pages on the LAN or VPN. Check from outside that only the approved public pages are reachable before opening the shop to customers.

### What the system does for you
It installs the system and runs it in the background. It keeps all your records in `C:\ProgramData\Moonproject`. Inside are the `data`, `backups`, and `logs` folders.

### Common mistakes and how to fix them
- **Mistake:** You want to update or uninstall, but worry about losing data.
- **Fix:** Updating means running a newer `Moonproject-Setup.exe`. The data is kept. Uninstalling also keeps the data safe.
