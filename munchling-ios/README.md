# Munchling iOS build pack

Copies of the Munchling app's native shell inputs, kept in this repo so
the "Munchling iPhone app" GitHub Actions workflow (.github/workflows/
munchling-ios.yml) can build and sign the Munchling iOS app with THIS
repo's App Store Connect secrets (the working "GitHub builds" key).
The Munchling repo (cmc-creator/Munchling) has its own iOS workflow
parked until its Apple secrets can be set - Apple's one-time .p8 key
download would not save in the browser used for setup.

Files (refresh by re-copying from the Munchling repo when they change):
- package.json, package-lock.json, capacitor.config.json - from native/
- www/index.html - from native/www/
- icon-1024.png - from assets/icons/
- scripts/asc-check.js, scripts/asc-sign.js - App Store signing helpers
  (asc-check looks up bundle com.nyxcollective.munchling)

The built app loads https://www.nyxmunchling.com/app.html, so website
changes never need a new build - only shell/config changes do.
