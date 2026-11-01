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
