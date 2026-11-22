# NyxSurvive iOS build pack

Copies of the NyxSurvive app's native shell inputs, kept in this repo so
the "NyxSurvive iPhone app" GitHub Actions workflow (.github/workflows/
nyxsurvive-ios.yml) can build and sign the NyxSurvive iOS app with THIS
repo's App Store Connect secrets (the working "GitHub builds" key).
The NyxSurvive repo (cmc-creator/NyxSurvive) has no Apple secrets of
its own - Apple's one-time .p8 key download would not save in the
browser used for setup.

Files (refresh from the NyxSurvive repo when they change):
- package.json, package-lock.json - from native/, plus @capacitor/ios
  (the repo's own native/ folder ships Android only; the versions here
  mirror the sister app's proven pack, Capacitor 8.5.3)
- capacitor.config.json - from native/ (bundle com.nyxcollective.nyxsurvive)
- www/ - the assembled bundle: run `node native/prepare-www.js` in the
  NyxSurvive repo, then copy native/www/ here
- icon-1024.png - from assets/icons/
- scripts/asc-check.js, scripts/asc-sign.js - App Store signing helpers
  (asc-check looks up bundle com.nyxcollective.nyxsurvive; the signing
  script's per-build certificates and profiles are named "NyxSurvive CI")

Unlike the sister app whose shell loads its live site, NyxSurvive
BUNDLES its web assets (offline-first is the product's core promise):
the built app ships the www/ snapshot in this pack and works fully
offline from install. Website changes do NOT reach the installed iOS
app - only a new build with a refreshed www/ snapshot does.

Assumption carried from the proven sister-app workflow: the perl
pbxproj edit in the workflow targets the stock Capacitor 8 Xcode
project template (the Release build-settings block it rewrites).
Both apps generate the project with the same Capacitor version
(8.5.3), so the same edit applies; if a future Capacitor template
changes that block, the signing step fails loudly rather than
shipping an unsigned build.

## BEFORE THE FIRST BUILD

a) CERTIFICATE SLOT + DURABLE SIGNING. The workflow no longer
   mints a fresh certificate per build. It reuses ONE shared
   distribution identity (key + certificate + App Store profile)
   stored as numbered base64 pieces on the "ios-signing-store"
   branch of this repo (folder ios-signing/, with a SHA256SUMS
   fingerprint file and meta.env). A run first checks that branch:
   if the store is there, the pieces are reassembled, the
   fingerprints verified, and that identity signs - no new
   certificate is made. If the store is absent, the run mints one
   certificate and saves the identity to the branch for every
   later run. Apple's cap is 3 distribution certificates for the
   whole account; the first NyxSurvive mint needs one free slot,
   which comes from retiring NyxPrism's original certificate
   (Connie approved 2026-11-17; NyxPrism is live, and retiring a
   live app's certificate does not affect the store app - see
   BUILD-RUN-SHEET.md in this pack for the exact browser steps).
   Feed the Bear's and Munchling's certificates must NOT be
   touched. NEVER revoke a certificate whose
   app is in review - revoking invalidates that app's submitted
   binary (ITMS-90035). The signing script's 409 fallback only
   removes leftover "NyxSurvive CI" certificates, never the other
   apps'.

b) WWW FRESHNESS. The pack's www/ is a snapshot (refreshed
   2026-11-22 from the NyxSurvive web shell v32 source - the
   Share My Number card and Operator Picks visibility included,
   plus nx-qr.js). If the app code changed since, re-snapshot
   before building: in the NyxSurvive repo run
   `node native/prepare-www.js`, then replace this pack's
   nyxsurvive-ios/www/ with the fresh native/www/.

c) APP RECORD. The bundle ID com.nyxcollective.nyxsurvive is
   registered and the App Store Connect app record exists
   (app ID 6835149508, SKU nyxsurvive-ios, listing approved by
   Connie). The signing script refuses to make a profile for an
   unregistered bundle ID, and the key check reports the app it
   finds for this bundle ID.

d) DEMO ACCOUNT. App Review gets a demo account created during the
   submission session in the NyxSurvive Firebase project. Its
   password goes ONLY into the App Store Connect review sign-in
   fields - never into this repo, this README, or any note. The app
   is fully functional signed out (accounts are optional), so the
   demo account is a courtesy for the reviewer, not a key.
