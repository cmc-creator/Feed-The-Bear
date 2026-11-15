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

a) CERTIFICATE SLOT. The workflow creates a fresh distribution
   certificate for each build and keeps it (deleting it would revoke
   the signature on the uploaded binary). This Apple account holds
   at most 3 distribution certificates, and all 3 slots are
   currently taken by the apps in review (NyxPrism, Feed the Bear,
   Munchling). While all 3 stand, Apple rejects the new certificate
   (409) and the build fails at the signing step. NEVER revoke a
   certificate whose app is in review - revoking invalidates that
   app's submitted binary (ITMS-90035). Run the first NyxSurvive
   build only once a slot is free (an app approved and released,
   or its certificate legitimately retired). The signing script's
   409 fallback only removes leftover "NyxSurvive CI" certificates,
   never the other apps'.

b) WWW FRESHNESS. The pack's www/ is a snapshot (made 2026-11-15
   from the source that includes the iOS purchase-hiding change,
   commit ed6df2f). If the app code changed since, re-snapshot
   before building: in the NyxSurvive repo run
   `node native/prepare-www.js`, then replace this pack's
   nyxsurvive-ios/www/ with the fresh native/www/.

c) APP RECORD. There is no NyxSurvive record in App Store Connect
   yet. At submission time, first register the bundle ID
   com.nyxcollective.nyxsurvive in the developer portal
   (Certificates, Identifiers & Profiles) and create the app record
   in App Store Connect; the signing script refuses to make a
   profile for an unregistered bundle ID, and the key check reports
   "no app with bundle ID com.nyxcollective.nyxsurvive exists yet"
   until the record is there. The listing copy lives in the
   NyxSurvive goal folder (IOS-LISTING-DRAFT.md) until Connie
   approves it at submission time.

d) DEMO ACCOUNT. App Review gets a demo account created during the
   submission session in the NyxSurvive Firebase project. Its
   password goes ONLY into the App Store Connect review sign-in
   fields - never into this repo, this README, or any note. The app
   is fully functional signed out (accounts are optional), so the
   demo account is a courtesy for the reviewer, not a key.
