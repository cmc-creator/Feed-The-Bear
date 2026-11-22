# NyxEcho iOS build pack

The NyxEcho app's native shell inputs, kept in this repo so the
"NyxEcho iPhone app" GitHub Actions workflow (.github/workflows/
nyxecho-ios.yml) can build and sign the NyxEcho iOS app with THIS
repo's App Store Connect secrets (the working "GitHub builds" key,
CSV5ZTC68U). The NyxEcho repo (cmc-creator/NyxEcho) has no Apple
secrets of its own - Apple's one-time .p8 key download would not
save in the browser used for setup.

The app is a Capacitor shell that loads the live site: bundle
com.nyxcollective.nyxecho, server.url https://www.nyxecho.com. It
mirrors the NyxEcho repo's own native/ shell (the one that ships on
Android and in the Microsoft Store). Sign-in, recordings,
transcripts and billing all live in the web app and its server API,
so this app cannot bundle an offline snapshot; the www/ folder is
just the redirect stub Capacitor requires, and website changes
reach the installed app on next load. Pro is bought on
nyxecho.com and unlocks in-app after sign-in; buying UI is hidden
inside the shell (the standing store rule).

Files:
- package.json, package-lock.json - Capacitor 8.5.3 with
  @capacitor/ios, @capacitor/android, @capacitor/browser and the
  CLI (the NyxEcho repo's native/ pins, plus @capacitor/ios).
- capacitor.config.json - appId, appName, server.url and the
  allowNavigation list (nyxecho.com and www.nyxecho.com), copied
  from the NyxEcho repo's native/ config.
- www/index.html - the redirect stub, identical to the NyxEcho
  repo's native/www/index.html.
- icon-1024.png - 1024x1024 RGB (no alpha), Cipher's orb, the same
  master the favicon set was built from. The workflow copies it
  into the generated Xcode project's AppIcon set, same as the
  other iOS workflows in this repo. NOTE: this file is binary, so
  it could not come through the GitHub connector; it is added to
  this folder through the GitHub web UI (see the prep notes in
  ~/workspace/store-submissions/nyxecho-apple/).
- scripts/asc-check.js, scripts/asc-sign.js - App Store helpers
  (asc-check looks up bundle com.nyxcollective.nyxecho; the
  signing script's profiles are named "NyxEcho CI", and it has a
  setup-profile mode described below).

The generated ios/ Xcode project is NOT kept in the repo. The
workflow runs npx cap add ios, injects the microphone usage
description (below), applies the icon, syncs, proves an unsigned
simulator build, then archives signed and uploads to App Store
Connect (TestFlight). Build number: 1000 + workflow run number.
First marketing version: 1.0.

## The microphone declaration

Right after cap add ios, the workflow edits the generated
Info.plist with PlistBuddy: it adds NSMicrophoneUsageDescription
("NyxEcho records your meetings so it can transcribe them and
draft your notes.") if the key is missing, and sets
ITSAppUsesNonExemptEncryption to false (the app uses only
standard HTTPS encryption). Without the microphone string, iOS
kills the app the first time the site requests the microphone -
it is the direct twin of the RECORD_AUDIO injection in the
NyxEcho Android workflow. No other usage strings are needed:
transcription runs server side, so there is no on-device speech
recognition, camera, or photo library access.

## Signing: shared certificate, own profile

Apple allows 3 distribution certificates per account and all 3
slots are in use. NyxEcho gets NO new certificate while a saved
identity exists. Certificates are account-wide; only
provisioning profiles are per bundle ID. Certificates are never
deleted after a build (revoking breaks the uploaded binary at
review, ITMS-90035).

The workflow restores from this repo's ios-signing-store branch,
in order:
1. ios-signing-nyxecho/ - this app's own saved key + certificate
   + profile (written by the save step on the first successful
   run; the save step writes ONLY that folder).
2. ios-signing/ - the shared key + certificate saved by the
   NyxSurvive workflow (fingerprint-checked). The sign step then
   runs asc-sign.js in its new setup-profile mode to mint ONLY a
   NyxEcho profile against that shared certificate (it fails
   closed if the restored CERT_ID is missing).

Only if neither folder exists does the workflow mint a fresh
certificate, and the save step then stores the identity under
ios-signing-nyxecho/. The workflow never writes to ios-signing/
(the profile stored there belongs to NyxSurvive,
com.nyxcollective.nyxsurvive) or to ios-signing-hicslab/
(NyxHICSlab's profile folder).

## BEFORE THE FIRST BUILD

a) APP RECORD. The bundle ID com.nyxcollective.nyxecho must be
   registered in Certificates, Identifiers & Profiles and the
   App Store Connect app record created (name NyxEcho, SKU
   nyxecho-ios) before a build can land (console work, done with
   Connie present). The signing script refuses to make a profile
   for an unregistered bundle ID, and the key check reports
   whether the app exists.

b) DEMO ACCOUNT. NyxEcho needs sign-in, so App Review needs a
   store-only demo account: create it in NyxEcho itself, complete
   its email verification (unverified accounts cannot transcribe
   or check out), make sure the free tier's 120 minutes covers a
   review session or grant the account Pro from the owner side,
   verify a real sign-in plus a short test recording end to end,
   and put the credentials ONLY in the App Store Connect App
   Review fields - never in this repo or this README. The Play
   demo account's credentials live only in Play Console and are
   not reusable here; Apple gets its own account.

c) ICON. icon-1024.png must be in this folder before the first
   run (the workflow's icon step copies it). It lands through
   the GitHub web UI; see the note under Files above.

d) SCREENSHOTS AND METADATA live in App Store Connect, not in
   this pack: iPhone 6.9 inch (1320x2868) screenshots (the build
   is restricted to iPhone for 1.0), description, keywords,
   support URL https://www.nyxecho.com, privacy policy URL
   https://www.nyxecho.com/privacy, App Privacy answers and the
   age rating questionnaire.

e) TESTFLIGHT CHECK before submitting: install the first build
   on a real iPhone and verify sign-in with the demo account,
   the microphone prompt showing the usage string, a short
   recording transcribing, and NO purchase or upgrade path
   visible anywhere in the shell. If a buy path shows, fix the
   shell detection on the site before submitting (guideline
   3.1.1 is the most likely rejection cause).
