# Google Play Console: step by step

Everything below is ready. Files are in `C:\Users\Ccooper\Documents\FeedTheBear-Android\`.

> **Keep `signing.keystore` and `signing-key-info.txt` safe and private.** They prove future updates come from you. Back them up somewhere besides this computer (for example a password manager). Never put them in GitHub or send them to anyone.

## 1. Create the app
Play Console → **Create app**
- App name: **Feed the Bear: Food Diary**
- Default language: English (United States)
- App or game: **App** · Free or paid: **Free**
- Accept the declarations → **Create app**

## 2. Upload the build
**Test and release → Production → Create new release** (or start with **Internal testing** to try it on your own phone first)
- Choose **Use Google-generated key** if asked about Play App Signing (recommended).
- Upload `Feed the Bear_ Food Diary.aab`
- Release name: `1.0.0` · Release notes: copy "What's new" from `store/listing.md`

## 3. After the first upload: one fingerprint for Claude
Google re-signs the app with its own key. Go to **Test and release → App integrity → App signing** and copy the **SHA-256 certificate fingerprint** under "App signing key certificate". Send it to Claude; it gets added to the site's `assetlinks.json`. Without it, the installed app shows a browser address bar at the top.

## 4. Store listing
**Grow users → Store presence → Main store listing**
- Short and full description: from `store/listing.md`
- App icon (512×512): `icon-512.png` in the project folder
- Feature graphic (1024×500): still needed (ask Claude to make one)
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
