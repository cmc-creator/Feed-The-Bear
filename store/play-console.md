# Google Play Console: step by step

The upload key is in `C:\Users\conni\Documents\FeedTheBear-Android\` (`upload.p12` and `signing-key-info.txt`, made 2026-11-03; it replaces the old key on the Ccooper computer, which was never used with Play). The GitHub "Android app" workflow signs the Play bundle with it and saves it under the run's **Artifacts** as `feed-the-bear-play-bundle` (`app-release.aab`).

> **Keep `upload.p12` and `signing-key-info.txt` safe and private.** They prove future updates come from you. Back them up somewhere besides this computer (for example a password manager). Never put them in GitHub or send them to anyone. If they are ever lost, Play Console can reset the upload key (App integrity → App signing → Request upload key reset).

## 1. Create the app
Play Console → **Create app**
- App name: **Feed the Bear: Food Diary**
- Default language: English (United States)
- App or game: **App** · Free or paid: **Free**
- Accept the declarations → **Create app**

## 2. Upload the build
**Test and release → Production → Create new release** (or start with **Internal testing** to try it on your own phone first)
- Choose **Use Google-generated key** if asked about Play App Signing (recommended).
- Upload `app-release.aab` from the latest "Android app" workflow run (Artifacts → `feed-the-bear-play-bundle`)
- Release name: `1.0.0` · Release notes: copy "What's new" from `store/listing.md`

## 2a. Countries and payments (before sending for review)
Grizzly is sold with Stripe inside the app. Google allows that **only for US users**, through its US alternative billing program; everywhere else it requires Google Play Billing.
- **Test and release → Production → Countries/regions:** add **United States only**.
- **Monetize with Play → Alternative billing (US) / External offers:** enroll the app and accept the terms. From October 1, 2026, sales made this way are reported to Google and carry a service fee; check the current rate on that page.
- Current rules: https://support.google.com/googleplay/android-developer/answer/15582165
- The website (www.feed-the-bear.com) is not affected: Stripe there is fine everywhere.

## 3. After the first upload: one fingerprint for Claude
Google re-signs the app with its own key. Go to **Test and release → App integrity → App signing** and copy the **SHA-256 certificate fingerprint** under "App signing key certificate". Send it to Claude; it gets added to the site's `assetlinks.json`. Without it, the installed app shows a browser address bar at the top.

## 4. Store listing
**Grow users → Store presence → Main store listing**
- Short and full description: from `store/listing.md`
- App icon (512×512): `store/icon-512.png`
- Feature graphic (1024×500): `store/feature-graphic.png`
- Phone screenshots: the 5 files in `store/screenshots/android/`

## 5. App content (Policy → App content)
- **Privacy policy:** https://www.feed-the-bear.com/privacy.html
- **App access:** "All functionality is available without special access" (sign-in is optional; nothing is behind a login Google can't create).
- **Ads:** No, the app does not contain ads.
- **Content rating:** fill the questionnaire. Category: Reference/Lifestyle-type utility. Answer No to violence, sexuality, gambling, etc. Users can share content (profile links, shared lists): Yes.
- **Target audience:** 13 and older (do not include under-13 age groups).
- **News app:** No. **Government app:** No. **Financial features:** No. **Health:** No.
- **Account deletion:** Yes, users can create an account. Deletion link: https://www.feed-the-bear.com/delete-account.html

### Data safety form
Does the app collect or share user data? **Yes.** Encrypted in transit? **Yes.** Can users request deletion? **Yes.**

| Data type | Collected | Shared | Optional? | Purposes |
|---|---|---|---|---|
| Location → Approximate and Precise | Yes | No* | Optional | App functionality |
| Personal info → Email address | Yes | No | Optional (only with an account) | App functionality, Account management |
| Personal info → Name | Yes | No | Optional | App functionality, Account management |
| Photos and videos → Photos, Videos | Yes | No | Optional | App functionality |
| App activity → Other user-generated content (spots, ratings, notes) | Yes | No | Optional | App functionality |
| App activity → App interactions | Yes | No | Required | Analytics (anonymous counts) |
| Financial info → Purchase history | Yes | No | Optional (Grizzly only) | App functionality |

\*Google treats service providers that process data for you (Firebase, Vercel, Google Places, Stripe) as not "sharing". Data is never sold.

## 6. Send for review
**Publishing overview → Send changes for review.** First reviews usually take a few days.
