# 10. Joining a phone or PC

**What it is for:** Add a phone, tablet or PC to the shop's system. This lets the device safely open Moonproject over a secure connection.

**Before you start:** Do this once on each new device in the shop. You need the address of the server PC (ask the owner who set up the server PC for its address).

### Steps
1. On the new device, open a browser.
2. Go to `http://<the server PC's address>/`. If that does not open, try `http://<the server PC's address>:8080/`.
3. Click **Download the certificate**.
4. Check the code shown on the screen. On the server PC, open the address the page tells you (for example, **http://localhost/** or **http://localhost:8080/**) and check that it shows the same code. On a PC that has already joined, you can also open **Admin** > **Shop certificate** to see the code. If it does not match, stop and tell an owner.
5. Install the certificate:
   - **Windows PC:** open the downloaded file, choose **Install Certificate**, then **Current User**, then **Place all certificates in the following store**, **Browse**, **Trusted Root Certification Authorities**. Finish and answer **Yes**. Close the browser and open it again.
   - **Android:** open Settings, search for **CA certificate** (under Security, then Encryption and credentials, then Install a certificate), choose **Install anyway** and pick the downloaded file.
   - **iPhone or iPad:** open the page in Safari and download the file. Then in Settings tap **Profile Downloaded** and **Install**. Finally go to Settings, General, About, Certificate Trust Settings and turn on **Moonproject local CA**.
   - **Mac:** open the downloaded file, then in Keychain Access open the certificate, expand **Trust** and choose **Always Trust**.
6. Back on the page, click **Open Moonproject**.
7. Save that address as a bookmark or on the home screen.

### What the system does for you
It protects your business data. Adding the certificate ensures the device is talking to your real server PC and not a fake one, keeping the connection safe and private.

### Common mistakes and how to fix them
- **Mistake:** The browser still warns that the connection is not private.
- **Fix:** The certificate is not installed yet, or on iPhone the trust switch is off. Check the installation steps again.
- **Mistake:** The codes differ when checking the server.
- **Fix:** Stop and tell an owner immediately.
- **Mistake:** The address changed.
- **Fix:** The shop certificate stays the same, so you do not need to install it again. Just open `https://<new address>/` and save the new bookmark.
