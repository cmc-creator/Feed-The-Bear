/* ════════════════════════════════════════════════════════════
   Feed The Bear - deploy-time minify (Vercel runs `npm run build`)
   Shrinks the app's own scripts in the deploy's copy of the code, so
   phones download and parse less. The repository keeps the readable files.
   Only runs on Vercel (VERCEL=1): run anywhere else it would overwrite
   the source files, so it refuses.
   Function and variable names at the top of each file are kept: the
   scripts call each other's globals and the HTML calls them by name.
   ════════════════════════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');

const FILES = [
  'app.js', 'firebase.js', 'cub.js', 'bear-swipe.js', 'ai.js', 'story-card.js',
  'photo-gallery.js', 'micro-interactions.js', 'trust-layer.js', 'analytics.js', 'errors.js', 'vote.js',
];

(async () => {
  if (process.env.VERCEL !== '1' && process.env.FTB_MINIFY_ANYWAY !== '1') {
    console.log('[minify] skipped: only runs on Vercel deploys (it rewrites files in place).');
    return;
  }
  const { minify } = require('terser');
  const root = process.env.FTB_MINIFY_ROOT || path.join(__dirname, '..');
  let before = 0, after = 0;
  for (const f of FILES) {
    const file = path.join(root, f);
    if (!fs.existsSync(file)) continue;
    const src = fs.readFileSync(file, 'utf8');
    // toplevel: false keeps every global name the other scripts and the HTML rely on.
    const out = await minify(src, { compress: { passes: 1 }, mangle: { toplevel: false }, format: { comments: false } });
    if (!out.code) throw new Error(`minify produced nothing for ${f}`);
    fs.writeFileSync(file, out.code);
    before += src.length;
    after += out.code.length;
  }
  console.log(`[minify] ${FILES.length} scripts: ${Math.round(before / 1024)}KB -> ${Math.round(after / 1024)}KB`);
})().catch(err => {
  // A failed minify must fail the deploy, not ship half-minified files.
  console.error('[minify] failed:', err);
  process.exit(1);
});
