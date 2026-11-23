# NyxGoodbye iOS build pack

This folder is uploaded, as-is, to the cmc-creator/Feed-The-Bear repo at
`nyxgoodbye-ios/` (through the GitHub web UI, because the connector cannot
push binary files like icon-1024.png, and the workflow file also has to
go through the web UI). The matching workflow is
`.github/workflows/nyxgoodbye-ios.yml` in that repo; a ready-to-paste copy
is in ../workflows-ready/ in this prep folder.

Why the Feed-The-Bear repo: its GitHub secrets already hold the working
App Store Connect key ("GitHub builds", key CSV5ZTC68U). The .p8 cannot
be re-downloaded, so every new iOS pack lives there.

Signing: the workflow restores the SHARED distribution key and
certificate from the `ios-signing-store` branch (folder `ios-signing/`,
fingerprint checked) and NEVER mints a certificate (Apple caps the
account at 3, and all 3 slots are in use; never revoke the Feed the Bear
or Munchling certificates while those apps are in review). NyxGoodbye's
own App Store provisioning profile for bundle ID com.nyxgoodbye.app lives
in a separate folder on the same branch, `ios-signing-nyxgoodbye/`; the
first run mints only that profile against the shared certificate and
saves it there. The signing scripts are renamed copies of the NyxThrive
pack scripts; the workflow calls asc-sign.js only in its "setup-profile"
mode (plus the no-op cleanup), never in the certificate-minting "setup"
mode.

Before the first run, in App Store Connect (browser task):
1. Register the bundle ID com.nyxgoodbye.app.
2. Create the NyxGoodbye app record (name NyxGoodbye, bundle
   com.nyxgoodbye.app). The signing script refuses to make a profile for
   an unregistered bundle ID, and the upload needs the app record to
   land on.

The app is a server.url shell: www/ is only the placeholder Capacitor
requires, and the app loads https://nyxgoodbye.com/?shell=store live. The
?shell=store flag makes the web app hide every purchase entry point (the
full plan is sold on the web only; see ../shell-web/). The icon in this
pack is the full bleed opaque 1024 export (PREP.md names it as the Apple
icon source; the plain icon-1024.png has an alpha channel and Apple
rejects transparency).

Open risk carried from the portfolio pattern: Google sign in inside the
WebView shell follows the Feed the Bear allow list (accounts.google.com
and the Firebase auth domains), but Google can block OAuth in embedded
WebViews. Email sign in is the reviewer path; Google sign in must be
proven on a real device or in review, not assumed.
