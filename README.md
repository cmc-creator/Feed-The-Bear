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
