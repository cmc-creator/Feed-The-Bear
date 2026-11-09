# Feed-The-Bear
for foodies

Save the spots you love, remember what to order, and decide where to eat fast.
Live at https://www.feed-the-bear.com.

## Run it locally

It's a static site with serverless functions in `api/` (Vercel).

```sh
python -m http.server 8765      # from the repo root
```

Then open http://127.0.0.1:8765/app.html.

## Photos, videos, sharing and account privacy

- Quick Add, Just Ate, and the full Add form offer **Take photo**, **Record
  video**, and **Gallery**. Recording uses the rear-camera capture intent on
  supported phones; desktop browsers may offer a file picker instead. If
  camera access is denied, allow it in device settings or choose Gallery.
- Saving is disabled while media is being picked or processed. Closing or
  replacing a form discards late picker results rather than attaching them
  to another place. Grizzly videos remain limited to 15 seconds and stay on
  the recording device; their poster photos can be backed up.
- After a new place or meal is saved, choose **Share photo/video**, **Make
  Story card**, or **Done**. Actual files go to the device share sheet, where
  you choose an installed social app. Browsers without file sharing offer a
  download instead. Sharing does not automatically publish a post, and
  blocked sharing is reported explicitly.
- Sign-out immediately hides the account's spots, profile, friends, chats,
  lists and pending sharing UI. Local account copies are kept in IndexedDB
  separately, so signing back into the same account can recover unsynced
  edits. Only a never-signed-in guest diary is automatically adopted on
  first sign-in. Older signed-out diaries with a remembered email are
  restored only when that same email signs in.
- Account deletion waits for local sign-out cleanup before erasing device
  storage. If you explicitly keep your local spots, they become a signed-out
  diary; the deleted account's profile, friends and chats are not kept with it.
- Theme and display preferences remain on the device. Signing into another
  account does not import the previous account's diary. Stale cloud loads,
  uploads, shared-list listeners and chat responses cannot repopulate the
  app after the session changes.
- Cloud failures show **Retry backup** and retain local edits. A failed cloud
  restore blocks uploads until a successful retry; reconnecting retries
  automatically. Signing in is not advertised as proof that backup succeeded.
  Persistent sign-in requires browser/site storage; storage failures are shown.
- Before release, test camera permissions, cancellation, photos/video and
  social share targets on physical Android and iPhone devices. Browser tests
  verify capture input attributes and native-share payloads, not camera hardware.

## Managing places and finding competitions

- The default appearance is the readable **Dark** theme, on phones and web,
  regardless of the phone's system theme. Use the sun/moon button in the
  header to switch instantly, or choose **Settings → Theme → Light**.
  Your choice is saved. **Auto (match my phone)** is opt-in.

- Use **Delete** next to **Edit** on a saved-place card to remove it after
  confirmation (also available inside the place). Use **Mark permanently
  closed** to keep its visits, ratings, notes and photos without suggesting it
  again. **Mark reopened** reverses the closure; the flag syncs with the place.
- Open **Bear Challenges → See all** on Home, or **Bear Challenges** in
  **Play** (phone) / **Discover** (desktop). Filter restaurant challenges
  separately from dated competitions and festivals, choose a state without
  location permission, search a city or restaurant, or browse this weekend.
- **Want to go** keeps challenge details in **Saved on this device**, even
  when an event ends or disappears from discovery. Saves are local, not
  account-synced; clearing browser data removes them. **Invite friends**
  shares a link back to the listing plus its source when available.
- Details show available prize, entry cost, rules, eligibility, source and
  registration links. Unknown facts stay unconfirmed. The discovery date
  means a web search found the listing, **not organizer verification**.
  Confirm availability and rules with the organizer before going. Older
  cached results are labelled; failed discovery offers Refresh and Saved.
- Byte Cub understands requests such as "add the Subway on Waddell to visited
  and note they have the broccoli cheddar soup". He preserves the branch,
  confirms map matches, and saves availability notes without claiming you ate
  the dish. When a branch cannot be verified, he asks instead of substituting
  another place.

- Main search and its mic show matching saved places and restaurants already
  loaded nearby. Nearby matches are labelled **not saved** and offer **Save**;
  **Search nearby** searches further using your current location. Voice also
  understands "find" / "search for" before a restaurant name.
- Friend invites open sharing directly from **Send invite** or **Skip**, so
  iPhone browsers can open the share sheet. If sharing is blocked, choose
  Text message, WhatsApp, Email or Copy. A blocked clipboard leaves the full
  invite selectable on screen instead of relying on a browser prompt.
- Dialogs keep keyboard focus inside and return it to the triggering control
  when closed, including nested sharing dialogs. Sticky filters follow the
  actual header height. Forms and secondary tools reflow at enlarged text sizes,
  including landscape, tablet and short keyboard-sized viewports. Automated
  checks cover up to 200% text; physical Safari, VoiceOver and TalkBack testing
  is still required before declaring every device fully validated.

## Tests

Browser tests drive the app with Playwright against the local server above.

```sh
cd tests
npm install
npm test                        # every *.test.js; keeps going past failures
node run-all.js swipe vote      # only files whose name matches
PW_CHANNEL=msedge npm test      # use an installed browser instead of downloading Chromium
```

## Where things are

- `app.html`, `app.js`, `style.css`: the app
- `api/`: serverless functions (payments, place info, votes, digest)
- `native/`: Android app (Capacitor)
- `tests/`: browser tests
- `CHANGELOG.md`: what changed and when
