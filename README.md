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

- Open a saved place and use **Delete** to remove it, or **Mark permanently
  closed** to keep its visits, ratings, notes and photos without suggesting it
  again. **Mark reopened** reverses the closure; the flag syncs with the place.
- On a phone, open **Play**; on desktop, open **Discover**. Choose **Eating
  competitions & food challenges**, or search for `competitions` in that hub.
- Byte Cub understands requests such as "add the Subway on Waddell to visited
  and note they have the broccoli cheddar soup". He preserves the branch,
  confirms map matches, and saves availability notes without claiming you ate
  the dish. When a branch cannot be verified, he asks instead of substituting
  another place.

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
