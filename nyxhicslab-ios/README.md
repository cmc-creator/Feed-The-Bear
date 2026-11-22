# NyxHICSlab iOS build pack

The NyxHICSlab app's native shell inputs, kept in this repo so the
"NyxHICSlab iPhone app" GitHub Actions workflow (.github/workflows/
hicslab-ios.yml) can build and sign the NyxHICSlab iOS app with THIS
repo's App Store Connect secrets (the working "GitHub builds" key).
The HICS repo (cmc-creator/HICS) has no Apple secrets of its own -
Apple's one-time .p8 key download would not save in the browser
used for setup.

The app is a Capacitor shell that loads the live site: bundle
com.nyxcollective.nyxhicslab, server.url https://www.nyxhicslab.com.
It mirrors the app's own Android pack (store-android/ in the HICS
repo), which ships the same shell on Google Play. Sign-in,
sessions, training records and contracts all live in the server
API, so unlike NyxSurvive this app cannot bundle an offline
snapshot; the www/ folder is just the placeholder Capacitor
requires, and website changes reach the installed app on next load.

Files:
- package.json, package-lock.json - Capacitor 8.5.3 with
  @capacitor/ios and @capacitor/browser (same pins as the Android
  pack, plus @capacitor/ios).
- capacitor.config.json - appId, appName, server.url and the same
  allowNavigation list as Android (nyxhicslab.com plus
  accounts.google.com so Google sign-in redirects work). Any other
  host is handed to the system browser.
- www/index.html - placeholder only. With server.url set,
  Capacitor loads the live site; the www folder just has to exist.
- icon-1024.png - 1024x1024 RGB (no alpha), copied from
  store-android/assets/icons/icon-1024.png in the HICS repo. The
  workflow copies it into the generated Xcode project's AppIcon
  set, same as the other iOS workflows in this repo.
- scripts/asc-check.js, scripts/asc-sign.js - App Store helpers
  (asc-check looks up bundle com.nyxcollective.nyxhicslab; the
  signing script's profiles are named "NyxHICSlab CI").

The generated ios/ Xcode project is NOT kept in the repo. The
workflow runs npx cap add ios, applies the icon, syncs, proves an
unsigned simulator build, then archives signed and uploads to App
Store Connect (TestFlight). Build number: 1000 + workflow run
number. First marketing version: 1.0.

## Signing: shared certificate, own profile

Apple allows 3 distribution certificates per account and all 3
slots are in use. NyxHICSlab gets NO new certificate. It signs
with the shared distribution key + certificate stored on this
repo's ios-signing-store branch (folder ios-signing/, minted for
NyxSurvive on 2026-11-17). Certificates are account-wide; only
provisioning profiles are per bundle ID.

So the workflow restores key.pem and cert.pem from ios-signing/
(fingerprint-checked), and keeps NyxHICSlab's own App Store
profile in a SEPARATE folder on the same branch,
ios-signing-hicslab/ (profile.mobileprovision pieces plus its own
SHA256SUMS and meta.env). The first run mints only that profile,
against the shared certificate, and saves it there; later runs
restore and reuse it. The workflow never writes to ios-signing/ -
the profile stored there belongs to NyxSurvive
(com.nyxcollective.nyxsurvive) and must not be overwritten.

## BEFORE THE FIRST BUILD

a) APP RECORD. The bundle ID com.nyxcollective.nyxhicslab must be
   registered and the App Store Connect app record created before
   a build can land (console work, done with Connie present). The
   signing script refuses to make a profile for an unregistered
   bundle ID, and the key check reports whether the app exists.

b) DEMO ACCOUNT. NyxHICSlab has no public sign up (admin invite
   or Google sign-in only), so App Review needs a store-only demo
   account: the owner creates it by admin invite (email and
   password, not Google), verifies it signs in on
   www.nyxhicslab.com, and puts the credentials ONLY in the App
   Review sign-in fields - never in this repo or this README. The
   review notes must say plainly that accounts are by invite and
   to use the supplied demo login.

c) SCREENSHOTS AND METADATA live in App Store Connect, not in
   this pack: 6.9 inch iPhone screenshots from the live app signed
   in as the demo account, description, keywords, support URL,
   the privacy policy URL, App Privacy and age rating answers.
