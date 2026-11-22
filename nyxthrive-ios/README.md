# NyxThrive iOS build pack

This folder is uploaded, as-is, to the cmc-creator/Feed-The-Bear repo at
`nyxthrive-ios/` (through the GitHub web UI, because the connector cannot
push binary files like icon-1024.png, and the workflow file also has to
go through the web UI). The matching workflow is
`.github/workflows/nyxthrive-ios.yml` in that repo; a ready-to-paste copy
is in ../workflows-ready/ in this prep folder.

Why the Feed-The-Bear repo: its GitHub secrets already hold the working
App Store Connect key ("GitHub builds", key CSV5ZTC68U). The .p8 cannot
be re-downloaded, so every new iOS pack lives there.

Signing: the workflow restores the SHARED distribution key and
certificate from the `ios-signing-store` branch (folder `ios-signing/`,
fingerprint checked) and NEVER mints a certificate (Apple caps the
account at 3, and all 3 slots are in use; never revoke the Feed the Bear
or Munchling certificates while those apps are in review). NyxThrive's
own App Store provisioning profile for bundle ID com.nyxthrive.app lives
in a separate folder on the same branch, `ios-signing-nyxthrive/`; the
first run mints only that profile against the shared certificate and
saves it there.

Before the first run, in App Store Connect (browser task):
1. Register the bundle ID com.nyxthrive.app.
2. Create the NyxThrive app record (name NyxThrive, bundle
   com.nyxthrive.app). The signing script refuses to make a profile for
   an unregistered bundle ID, and the upload needs the app record to
   land on.

The app is a server.url shell: www/ is only the placeholder Capacitor
requires, and the app loads https://nyxthrive.com/?shell=store live. The
?shell=store flag makes the web app hide every purchase entry point
(subscriptions are sold on the web only).

Open risk carried from the prep: Google sign in inside the WebView shell
is unproven for NyxThrive (Google can block OAuth in embedded WebViews).
The shell allows navigation to accounts.google.com and the Firebase auth
domains, following the Feed the Bear pattern, but this must be proven on
a real device or in review, not assumed.
