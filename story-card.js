/* ════════════════════════════════════════════════════════════
   Feed The Bear - "What to order" story cards
   A 1080x1920 image (the size Instagram and Snapchat stories use) of a
   restaurant's best dishes, drawn on a canvas. Tapping Share on Your Order
   shows a preview with Share / Save image / Copy text.
   Only window.StoryCard is global; app.js functions are called at run time.
   ════════════════════════════════════════════════════════════ */

window.StoryCard = (() => {
  'use strict';

  const W = 1080, H = 1920, PAD = 84;
  const FONT = 'Manrope, system-ui, sans-serif';
  const GOLD = '#e7b44a', CREAM = '#fff6e6', DIM = 'rgba(255, 246, 230, .72)';
  const track = (n, d) => { try { window.trackProductEvent?.(n, d); } catch { /* optional */ } };

  let overlay = null;
  let current = null; // { blob, file, text, name }

  // Local photos (data:/blob:/same-origin) always draw. Remote ones only
  // with CORS; without it the canvas could not be exported, so they're skipped.
  function loadImage (src) {
    return new Promise(resolve => {
      if (!src) { resolve(null); return; }
      const img = new Image();
      if (/^https?:/i.test(src) && !src.startsWith(location.origin)) img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
      setTimeout(() => resolve(null), 4000);
    });
  }

  // Which dishes go on the card, best first.
  function pickDishes (r) {
    const all = window.dishesOf ? window.dishesOf(r) : (r.dishes || []);
    const by = v => all.filter(d => d.verdict === v).sort((a, b) => (b.rating || 0) - (a.rating || 0));
    const again = by('again');
    return {
      get: (again.length ? again : by('ok')).slice(0, 4),
      want: by('want').slice(0, 2),
      skip: by('skip').slice(0, 2),
    };
  }

  function heroPhotoFor (r, picks) {
    const withPhoto = [...picks.get, ...picks.want].find(d => d.photo);
    return withPhoto?.photo || photosFor(r)[0] || '';
  }

  function photosFor (r, preferred = '') {
    const media = obj => window.mediaOf ? window.mediaOf(obj) : [{ photo: obj?.photo }, ...(obj?.media || [])];
    const sources = [preferred, ...[r, ...(r.visits || []), ...(r.dishes || [])].flatMap(obj => media(obj).map(m => m.photo))];
    return [...new Set(sources.filter(src => src && (!window.safeUrl || window.safeUrl(src))))].slice(0, 3);
  }

  function cover (ctx, img, x, y, w, h) {
    const s = Math.max(w / img.naturalWidth, h / img.naturalHeight);
    const iw = img.naturalWidth * s, ih = img.naturalHeight * s;
    ctx.drawImage(img, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
  }

  // Splits text into at most `max` lines that fit `width`; the last gets an ellipsis.
  function wrap (ctx, text, width, max) {
    const words = String(text).split(/\s+/);
    const lines = [];
    let line = '';
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (ctx.measureText(next).width <= width || !line) line = next;
      else { lines.push(line); line = w; }
    }
    if (line) lines.push(line);
    if (lines.length > max) {
      lines.length = max;
      let last = lines[max - 1];
      while (last && ctx.measureText(`${last}…`).width > width) last = last.slice(0, -1);
      lines[max - 1] = `${last.trimEnd()}…`;
    }
    return lines.map(l => {
      if (ctx.measureText(l).width <= width) return l;
      let t = l;
      while (t && ctx.measureText(`${t}…`).width > width) t = t.slice(0, -1);
      return `${t}…`;
    });
  }

  function pill (ctx, text, x, y, bg, fg) {
    ctx.font = `800 30px ${FONT}`;
    const w = ctx.measureText(text).width + 44;
    ctx.fillStyle = bg;
    ctx.beginPath(); ctx.roundRect(x, y, w, 56, 28); ctx.fill();
    ctx.fillStyle = fg;
    ctx.fillText(text, x + 22, y + 39);
    return w;
  }

  function stars (n) { return n ? '★'.repeat(n) + '☆'.repeat(5 - n) : ''; }

  // Your link (feed-the-bear.com/@you when your page is public), never more than 2s to find.
  function shareLink () {
    const site = 'feed-the-bear.com';
    const ask = window.myShareLink ? window.myShareLink().catch(() => site) : Promise.resolve(site);
    return Promise.race([ask, new Promise(r => setTimeout(() => r(site), 2000))]);
  }

  // Bottom of every share image: your link on the left, a "Get it on Google
  // Play" badge on the right, so each share works as a small ad for the app.
  // `s` scales it (1 on the 1080-wide cards).
  function brand (ctx, { x, y, w, link, s = 1, font = FONT, gold = GOLD }) {
    const bw = 292 * s, bh = 86 * s, bx = x + w - bw, by = y - bh / 2;
    ctx.save();
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = gold;
    let size = 38 * s;
    ctx.font = `800 ${size}px ${font}`;
    while (ctx.measureText(link).width > w - bw - 30 * s && size > 20 * s) { size -= 2 * s; ctx.font = `800 ${size}px ${font}`; }
    ctx.fillText(link, x, y);
    // No Google Play badge from the iPhone app (Apple's rules).
    if (window.FTB_IOS_APP) { ctx.restore(); return; }
    // The badge
    const r = 16 * s;
    ctx.beginPath();
    ctx.moveTo(bx + r, by); ctx.arcTo(bx + bw, by, bx + bw, by + bh, r); ctx.arcTo(bx + bw, by + bh, bx, by + bh, r);
    ctx.arcTo(bx, by + bh, bx, by, r); ctx.arcTo(bx, by, bx + bw, by, r); ctx.closePath();
    ctx.fillStyle = '#000'; ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, .45)'; ctx.lineWidth = 2 * s; ctx.stroke();
    const tx = bx + 26 * s, ty = y;
    ctx.beginPath(); ctx.moveTo(tx, ty - 22 * s); ctx.lineTo(tx + 34 * s, ty); ctx.lineTo(tx, ty + 22 * s); ctx.closePath();
    const g = ctx.createLinearGradient(tx, ty - 22 * s, tx + 34 * s, ty + 22 * s);
    g.addColorStop(0, '#00d7fe'); g.addColorStop(0.4, '#00f076'); g.addColorStop(0.7, '#ffd400'); g.addColorStop(1, '#ff3a44');
    ctx.fillStyle = g; ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = `600 ${17 * s}px ${font}`;
    ctx.fillText('GET IT ON', tx + 52 * s, ty - 15 * s);
    ctx.font = `700 ${32 * s}px ${font}`;
    ctx.fillText('Google Play', tx + 52 * s, ty + 14 * s);
    ctx.restore();
  }

  async function draw (r) {
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    try { await document.fonts?.load(`800 64px Manrope`); } catch { /* system font is fine */ }

    const picks = pickDishes(r);
    const [hero, cub] = await Promise.all([loadImage(heroPhotoFor(r, picks)), loadImage('assets/cub-avatar.jpg')]);
    if (heroPhotoFor(r, picks) && !hero) throw new Error('Your photo could not load. Reattach it before sharing.');

    // Background: the food photo fading into warm brown, or just the brown.
    const BASE = '#1c120b';
    const bg = ctx.createLinearGradient(0, 0, 0, H * .6);
    bg.addColorStop(0, '#3a2414'); bg.addColorStop(1, BASE);
    ctx.fillStyle = BASE; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H * .6);
    // Room for the dish sections decides how high the title sits (and how tall the photo is).
    const FLOOR = H - 250;
    const rows = [picks.get, picks.want, picks.skip].filter(d => d.length);
    const need = rows.reduce((n, d) => n + 50 + 56 + 78 * d.length, 0);
    ctx.font = `800 92px ${FONT}`;
    const titleLines = wrap(ctx, r.name, W - PAD * 2, 2);
    const titleH = 104 * titleLines.length + (r.cuisine || r.myRating ? 62 : 0) + 56;
    const titleY = Math.max(380, Math.min(hero ? 860 : 820, FLOOR - need - titleH));
    const heroH = titleY + 160;
    if (hero) {
      cover(ctx, hero, 0, 0, W, heroH);
      const fade = ctx.createLinearGradient(0, heroH * .35, 0, heroH);
      fade.addColorStop(0, 'rgba(28, 18, 11, 0)'); fade.addColorStop(1, BASE);
      ctx.fillStyle = fade; ctx.fillRect(0, 0, W, heroH);
      const top = ctx.createLinearGradient(0, 0, 0, 260);
      top.addColorStop(0, 'rgba(0, 0, 0, .55)'); top.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = top; ctx.fillRect(0, 0, W, 260);
    } else {
      ctx.globalAlpha = .14; ctx.font = '400px serif'; ctx.textAlign = 'center';
      ctx.fillText(window.cuisineEmoji?.(r.cuisine) || '🍽️', W / 2, Math.min(600, titleY - 80));
      ctx.globalAlpha = 1; ctx.textAlign = 'left';
    }

    // Brand
    if (cub) {
      ctx.save(); ctx.beginPath(); ctx.arc(PAD + 40, 130, 40, 0, Math.PI * 2); ctx.clip();
      cover(ctx, cub, PAD, 90, 80, 80); ctx.restore();
      ctx.strokeStyle = '#e7c48a'; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(PAD + 40, 130, 40, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.fillStyle = CREAM; ctx.font = `800 34px ${FONT}`;
    ctx.fillText('FEED THE BEAR', PAD + (cub ? 104 : 0), 143);

    // Title
    let y = titleY;
    ctx.fillStyle = GOLD; ctx.font = `800 36px ${FONT}`;
    ctx.fillText('WHAT TO ORDER AT', PAD, y);
    ctx.fillStyle = CREAM; ctx.font = `800 92px ${FONT}`;
    titleLines.forEach(l => { y += 104; ctx.fillText(l, PAD, y); });
    if (r.cuisine || r.myRating) {
      y += 62; ctx.font = `700 40px ${FONT}`;
      let x = PAD;
      if (r.cuisine) { ctx.fillStyle = DIM; ctx.fillText(r.cuisine, x, y); x += ctx.measureText(r.cuisine).width + 28; }
      if (r.myRating) { ctx.fillStyle = GOLD; ctx.fillText(stars(r.myRating), x, y); }
    }
    y += 56;

    // Dish sections
    const section = (title, dishes, bgc, fg, rowFont) => {
      if (!dishes.length || y + 50 + 56 + 78 > FLOOR) return;
      y += 50;
      pill(ctx, title, PAD, y, bgc, fg);
      y += 56;
      dishes.forEach(d => {
        if (y + 78 > FLOOR) return;
        y += 78;
        ctx.fillStyle = CREAM; ctx.font = rowFont;
        const st = stars(d.rating);
        ctx.font = `700 40px ${FONT}`;
        const stW = st ? ctx.measureText(st).width + 24 : 0;
        ctx.font = rowFont;
        ctx.fillText(wrap(ctx, d.name, W - PAD * 2 - stW, 1)[0], PAD, y);
        if (st) { ctx.fillStyle = GOLD; ctx.font = `700 40px ${FONT}`; ctx.textAlign = 'right'; ctx.fillText(st, W - PAD, y); ctx.textAlign = 'left'; }
      });
    };
    section(picks.get[0]?.verdict === 'again' ? 'GET THIS' : 'WORTH IT', picks.get, GOLD, '#1b130b', `800 60px ${FONT}`);
    section('NEXT TIME', picks.want, 'rgba(255, 246, 230, .16)', CREAM, `700 50px ${FONT}`);
    section('SKIP', picks.skip, 'rgba(207, 109, 99, .3)', '#ffd9d3', `600 46px ${FONT}`);

    // Footer
    ctx.fillStyle = 'rgba(255, 246, 230, .14)'; ctx.fillRect(PAD, H - 196, W - PAD * 2, 2);
    ctx.fillStyle = DIM; ctx.font = `700 34px ${FONT}`;
    ctx.fillText('Remember every great bite', PAD, H - 140);
    brand(ctx, { x: PAD, y: H - 82, w: W - PAD * 2, link: await shareLink() });

    return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  }

  function buildOverlay () {
    const el = document.createElement('div');
    el.id = 'story-card-overlay';
    el.className = 'story-overlay hidden';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', 'Share card');
    el.innerHTML = `
      <div class="story-sheet">
        <button type="button" class="story-x" aria-label="Close">✕</button>
        <img class="story-img" alt="" />
        <div class="story-actions">
          <button type="button" class="btn-primary story-share">Share</button>
          <button type="button" class="story-save">Save image</button>
          <button type="button" class="story-copy">Copy text</button>
        </div>
        <details class="story-caption"><summary>Edit caption</summary>
          <label>Your social caption<textarea class="form-input story-caption-text" rows="3" maxlength="2000"></textarea></label>
          <span class="story-caption-status" role="status"></span>
        </details>
        <div class="story-share-help hidden" role="status">
          <strong>Post your card to TikTok, Instagram or Facebook</strong>
          <p class="story-share-message"></p>
          <p>Choose Save image, open your social app and upload the card as a post or Story. Use Copy text to paste your caption. Nothing posts automatically.</p>
        </div>
        <details class="story-collection hidden"><summary>Your original photos &amp; video</summary>
          <p>Share the cover and originals together when supported, or save individual files to upload in your social app. Apps decide what they accept.</p>
          <button type="button" class="btn-primary story-share-all">Share card + originals</button>
          <div class="story-files"></div>
          <span class="story-collection-status" role="status"></span>
        </details>
      </div>`;
    document.body.appendChild(el);
    el.addEventListener('click', e => { if (e.target === el) close(); });
    el.querySelector('.story-x').addEventListener('click', close);
    el.querySelector('.story-share').addEventListener('click', shareNow);
    el.querySelector('.story-save').addEventListener('click', save);
    el.querySelector('.story-copy').addEventListener('click', copy);
    el.querySelector('.story-caption-text').addEventListener('input', e => {
      if (current) current.text = e.target.value;
    });
    el.querySelector('.story-share-all').addEventListener('click', async () => {
      if (!current) return;
      const snapshot = current;
      try { await navigator.share({ title: snapshot.name, text: snapshot.text, files: [snapshot.file, ...snapshot.originals] }); }
      catch (err) {
        if (err?.name === 'AbortError' || current !== snapshot || el.classList.contains('hidden')) return;
        console.warn('[FTB] Collection sharing failed:', err);
        el.querySelector('.story-collection-status').textContent = 'Sharing was blocked. Save the individual files below and upload them in your social app.';
      }
    });
    el.querySelector('.story-files').addEventListener('click', e => {
      const button = e.target.closest('[data-file]');
      const file = button && current?.originals[Number(button.dataset.file)];
      if (!file) return;
      const url = URL.createObjectURL(file);
      const a = document.createElement('a'); a.href = url; a.download = file.name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      el.querySelector('.story-collection-status').textContent = 'Download requested. Upload this file in your social app.';
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !el.classList.contains('hidden')) close(); });
    return el;
  }

  function close () {
    overlay?.classList.add('hidden');
    const img = overlay?.querySelector('.story-img');
    if (img?.src) { URL.revokeObjectURL(img.src); img.removeAttribute('src'); }
    current = null;
    if (typeof window.maybeHideOverlay === 'function') window.maybeHideOverlay();
  }

  async function shareNow () {
    if (!current) return;
    const snapshot = current;
    overlay.querySelector('.story-share-help').classList.add('hidden');
    track('story_card_shared', {});
    const data = { title: current.name, text: current.text, files: [current.file] };
    if (navigator.share && navigator.canShare?.({ files: [current.file] })) {
      try { await navigator.share(data); return; }
      catch (err) {
        if (err?.name === 'AbortError') return;
        if (current !== snapshot || overlay.classList.contains('hidden')) return;
        console.warn('[FTB] Story sharing failed:', err);
        showShareHelp('Your browser blocked image sharing. Your card is still ready to save and post.');
        return;
      }
    }
    showShareHelp('This browser cannot open a share sheet for image files. You can still post your card using the steps below.');
  }

  function showShareHelp (message) {
    const help = overlay.querySelector('.story-share-help');
    help.querySelector('.story-share-message').textContent = message;
    help.classList.remove('hidden');
    help.scrollIntoView({ block: 'nearest' });
  }

  function save () {
    if (!current) return;
    track('story_card_saved', {});
    const url = URL.createObjectURL(current.blob);
    const a = document.createElement('a');
    a.href = url; a.download = current.file.name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    window.showToast?.('Download requested', 'Once saved, upload it in your social app or send it to a friend.', 'info');
  }

  async function copy () {
    if (!current) return;
    const snapshot = current;
    const status = overlay.querySelector('.story-caption-status');
    status.textContent = '';
    try {
      await navigator.clipboard.writeText(snapshot.text);
      if (current !== snapshot || overlay.classList.contains('hidden')) return;
      window.showToast?.('Copied!', 'Paste it to a friend who is going.', 'success');
    } catch (err) {
      if (current !== snapshot || overlay.classList.contains('hidden')) return;
      console.warn('[FTB] Story caption copy failed:', err);
      overlay.querySelector('.story-caption').open = true;
      const caption = overlay.querySelector('.story-caption-text');
      caption.focus(); caption.select();
      status.textContent = 'Copying was blocked. Select the caption above and copy it manually.';
    }
  }

  /* ── Any story: a meal you just ate, your month in food, a trip guide ──
     spec: { kicker, title, sub, stars, photo, stats: [{ n, label }],
             sections: [{ label, items: [text], tone: 'gold'|'soft'|'skip' }] } */
  async function drawStory (spec) {
    if (spec.kind === 'meal' || spec.kind === 'spot') return drawPlaceStory(spec);
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    try { await document.fonts?.load(`800 64px Manrope`); } catch { /* system font is fine */ }
    const [hero, cub] = await Promise.all([loadImage(spec.photo || ''), loadImage('assets/cub-avatar.jpg')]);

    const BASE = '#1c120b';
    ctx.fillStyle = BASE; ctx.fillRect(0, 0, W, H);
    const bg = ctx.createLinearGradient(0, 0, 0, H * .6);
    bg.addColorStop(0, '#3a2414'); bg.addColorStop(1, BASE);
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H * .6);

    const heroH = hero ? 980 : 0;
    if (hero) {
      cover(ctx, hero, 0, 0, W, heroH);
      const fade = ctx.createLinearGradient(0, heroH * .4, 0, heroH);
      fade.addColorStop(0, 'rgba(28, 18, 11, 0)'); fade.addColorStop(1, BASE);
      ctx.fillStyle = fade; ctx.fillRect(0, 0, W, heroH);
      const top = ctx.createLinearGradient(0, 0, 0, 260);
      top.addColorStop(0, 'rgba(0, 0, 0, .55)'); top.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = top; ctx.fillRect(0, 0, W, 260);
    }
    if (cub) {
      ctx.save(); ctx.beginPath(); ctx.arc(PAD + 40, 130, 40, 0, Math.PI * 2); ctx.clip();
      cover(ctx, cub, PAD, 90, 80, 80); ctx.restore();
      ctx.strokeStyle = '#e7c48a'; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(PAD + 40, 130, 40, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.fillStyle = CREAM; ctx.font = `800 34px ${FONT}`;
    ctx.fillText('FEED THE BEAR', PAD + (cub ? 104 : 0), 143);

    const FLOOR = H - 250;
    let y = hero ? heroH - 120 : 420;
    ctx.fillStyle = GOLD; ctx.font = `800 36px ${FONT}`;
    ctx.fillText(String(spec.kicker || '').toUpperCase(), PAD, y);
    ctx.fillStyle = CREAM; ctx.font = `800 88px ${FONT}`;
    wrap(ctx, spec.title || '', W - PAD * 2, 2).forEach(l => { y += 100; ctx.fillText(l, PAD, y); });
    if (spec.sub || spec.stars) {
      y += 60; ctx.font = `700 40px ${FONT}`;
      let x = PAD;
      if (spec.sub) { ctx.fillStyle = DIM; const t = wrap(ctx, spec.sub, W - PAD * 2 - (spec.stars ? 260 : 0), 1)[0]; ctx.fillText(t, x, y); x += ctx.measureText(t).width + 28; }
      if (spec.stars) { ctx.fillStyle = GOLD; ctx.fillText(stars(spec.stars), x, y); }
    }

    // Stat tiles: big numbers in a row of up to three.
    const stats = (spec.stats || []).slice(0, 3);
    if (stats.length) {
      y += 60;
      const gap = 24, tw = (W - PAD * 2 - gap * (stats.length - 1)) / stats.length;
      stats.forEach((s, i) => {
        const x = PAD + i * (tw + gap);
        ctx.fillStyle = 'rgba(255, 246, 230, .09)';
        ctx.beginPath(); ctx.roundRect(x, y, tw, 190, 28); ctx.fill();
        ctx.fillStyle = GOLD; ctx.font = `800 84px ${FONT}`; ctx.textAlign = 'center';
        ctx.fillText(String(s.n), x + tw / 2, y + 100);
        ctx.fillStyle = DIM; ctx.font = `700 30px ${FONT}`;
        ctx.fillText(wrap(ctx, s.label, tw - 30, 1)[0], x + tw / 2, y + 152);
        ctx.textAlign = 'left';
      });
      y += 190;
    }

    const TONES = { gold: [GOLD, '#1b130b'], soft: ['rgba(255, 246, 230, .16)', CREAM], skip: ['rgba(207, 109, 99, .3)', '#ffd9d3'] };
    (spec.sections || []).forEach(sec => {
      const items = (sec.items || []).filter(Boolean);
      if (!items.length || y + 50 + 56 + 72 > FLOOR) return;
      y += 50;
      const [bgc, fg] = TONES[sec.tone] || TONES.gold;
      pill(ctx, String(sec.label).toUpperCase(), PAD, y, bgc, fg);
      y += 56;
      items.forEach(t => {
        if (y + 72 > FLOOR) return;
        y += 72;
        ctx.fillStyle = CREAM; ctx.font = `700 48px ${FONT}`;
        ctx.fillText(wrap(ctx, t, W - PAD * 2, 1)[0], PAD, y);
      });
    });

    ctx.fillStyle = 'rgba(255, 246, 230, .14)'; ctx.fillRect(PAD, H - 196, W - PAD * 2, 2);
    ctx.fillStyle = DIM; ctx.font = `700 34px ${FONT}`;
    ctx.fillText(spec.footer || 'Remember every great bite', PAD, H - 140);
    brand(ctx, { x: PAD, y: H - 82, w: W - PAD * 2, link: await shareLink() });
    return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  }

  async function drawPlaceStory (spec) {
    const sources = [...new Set([...(spec.photos || []), spec.photo].filter(Boolean))].slice(0, 3);
    const images = await Promise.all(sources.map(loadImage));
    if (images.some(img => !img)) throw new Error('Your photo could not load. Reattach it or choose another photo before sharing.');
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    try { await document.fonts?.load(`800 64px Manrope`); } catch { /* system font is fine */ }
    ctx.fillStyle = '#fff6e6'; ctx.fillRect(0, 0, W, H);
    const photo = (img, x, y, w, h) => {
      ctx.save(); ctx.beginPath(); ctx.roundRect(x, y, w, h, 32); ctx.clip();
      cover(ctx, img, x, y, w, h); ctx.restore();
    };
    ctx.fillStyle = '#79542d'; ctx.font = `800 30px ${FONT}`;
    ctx.fillText(wrap(ctx, String(spec.kicker || 'My food find').toUpperCase(), W - PAD * 2, 1)[0], PAD, 130);
    ctx.fillStyle = '#21170f'; ctx.font = `800 76px ${FONT}`;
    let y = 158;
    wrap(ctx, spec.place || spec.title || '', W - PAD * 2, 2).forEach(line => { y += 86; ctx.fillText(line, PAD, y); });
    ctx.fillStyle = '#79542d'; ctx.font = `600 32px ${FONT}`;
    wrap(ctx, spec.location || spec.sub || '', W - PAD * 2, 1).forEach(line => { y += 48; ctx.fillText(line, PAD, y); });
    const top = y + 40;
    const bottom = 1450;
    if (images.length) {
      const extras = images.length - 1;
      const heroH = bottom - top - (extras ? 290 : 0);
      photo(images[0], PAD, top, W - PAD * 2, heroH);
      if (extras) {
        const gap = 20, width = (W - PAD * 2 - gap * (extras - 1)) / extras;
        images.slice(1).forEach((img, i) => photo(img, PAD + i * (width + gap), top + heroH + gap, width, 270));
      }
    } else {
      ctx.fillStyle = '#efe1ca'; ctx.beginPath(); ctx.roundRect(PAD, top, W - PAD * 2, bottom - top, 32); ctx.fill();
      ctx.fillStyle = '#79542d'; ctx.font = `700 40px ${FONT}`;
      ctx.fillText('A place on my food map', PAD + 40, top + 100);
    }
    y = 1520;
    ctx.fillStyle = '#21170f'; ctx.font = `800 46px ${FONT}`;
    if (spec.place && spec.title !== spec.place) {
      wrap(ctx, spec.title, W - PAD * 2, 1).forEach(line => ctx.fillText(line, PAD, y));
      y += 64;
    }
    if (spec.stars) { ctx.fillStyle = '#79542d'; ctx.fillText(stars(spec.stars), PAD, y); y += 64; }
    for (const section of spec.sections || []) {
      for (const item of section.items || []) {
        if (!item || y > 1740) continue;
        ctx.fillStyle = '#79542d'; ctx.font = `600 34px ${FONT}`;
        wrap(ctx, item, W - PAD * 2, 2).forEach(line => { if (y <= 1740) { ctx.fillText(line, PAD, y); y += 46; } });
      }
    }
    ctx.fillStyle = '#d7c2a1'; ctx.fillRect(PAD, 1800, W - PAD * 2, 2);
    ctx.fillStyle = '#79542d'; ctx.font = `700 26px ${FONT}`;
    ctx.fillText('FEED THE BEAR', PAD, 1850);
    ctx.textAlign = 'right';
    ctx.fillText(wrap(ctx, await shareLink(), 560, 1)[0], W - PAD, 1850);
    return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  }

  function showCard (blob, text, title, fileBase, originals = [], collectionError = '') {
    overlay = overlay || buildOverlay();
    if (!blob) throw new Error('Could not draw the card');
    const name = `${String(fileBase || 'feed-the-bear').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'feed-the-bear'}.png`;
    current = { blob, file: new File([blob], name, { type: 'image/png' }), text, name: title, originals };
    const img = overlay.querySelector('.story-img');
    if (img.src) URL.revokeObjectURL(img.src);
    img.src = URL.createObjectURL(blob);
    img.alt = title;
    overlay.querySelector('.story-share').textContent = 'Share card';
    overlay.querySelector('.story-save').classList.remove('hidden');
    overlay.querySelector('.story-share-help').classList.add('hidden');
    overlay.querySelector('.story-caption').open = false;
    overlay.querySelector('.story-caption-text').value = text || '';
    overlay.querySelector('.story-caption-status').textContent = '';
    const collection = overlay.querySelector('.story-collection');
    collection.classList.toggle('hidden', !originals.length && !collectionError);
    collection.open = false;
    overlay.querySelector('.story-collection-status').textContent = collectionError;
    overlay.querySelector('.story-files').replaceChildren();
    originals.forEach((file, i) => {
      const button = document.createElement('button'); button.type = 'button'; button.dataset.file = i;
      button.textContent = file.type.startsWith('video/') ? 'Save video clip' : `Save photo ${i + 1}`;
      overlay.querySelector('.story-files').appendChild(button);
    });
    const shareAll = overlay.querySelector('.story-share-all');
    shareAll.disabled = !navigator.share || !navigator.canShare?.({ files: [current.file, ...originals] });
    if (shareAll.disabled && !collectionError && originals.length) {
      overlay.querySelector('.story-collection-status').textContent = 'This device cannot share the whole collection at once. Save individual files below.';
    }
    overlay.classList.remove('hidden');
    document.body.classList.add('overlay-open');
  }

  // Draws the card for restaurant `r` and opens the preview.
  async function open (r, text) {
    const generation = _dataGeneration;
    const blob = await draw(r);
    if (generation !== _dataGeneration) return;
    showCard(blob, text, `What to order at ${r.name}`, `${r.name}-what-to-order`);
    track('story_card_opened', { kind: 'order' });
  }

  async function openStory (spec, text, fileBase) {
    const generation = _dataGeneration;
    const blob = await drawStory(spec);
    const originals = [];
    let collectionError = '';
    const sources = window.mergeFoodMedia ? window.mergeFoodMedia([], spec.media || [], { notify: false }) : [];
    for (const [i, item] of sources.entries()) {
      try {
        const response = await fetch(item.photo);
        if (!response.ok) throw new Error(`Photo ${i + 1} could not load`);
        const photo = await response.blob();
        if (!photo.type.startsWith('image/')) throw new Error(`Photo ${i + 1} is not a readable image`);
        // A video's poster is used on the cover; the original clip is a separate file.
        if (!item.video) originals.push(new File([photo], `food-photo-${i + 1}.${photo.type.includes('png') ? 'png' : 'jpg'}`, { type: photo.type }));
        if (item.video) {
          const video = await window.getFoodVideo(item.video);
          if (!video) throw new Error('The video clip is not on this device');
          originals.push(new File([video], `food-video.${video.type.includes('mp4') ? 'mp4' : video.type.includes('quicktime') ? 'mov' : 'webm'}`, { type: video.type }));
        }
      } catch (err) {
        console.warn('[FTB] Original media preparation failed:', err);
        collectionError = `${err.message}. Your cover is ready; unavailable originals cannot be shared.`;
      }
      if (generation !== _dataGeneration) return;
    }
    if (generation !== _dataGeneration) return;
    showCard(blob, text, spec.title || 'Feed The Bear', fileBase || spec.title, originals, collectionError);
    track('story_card_opened', { kind: spec.kind || 'story' });
  }

  return { open, openStory, draw, drawStory, close, pickDishes, photosFor, brand, shareLink };
})();
