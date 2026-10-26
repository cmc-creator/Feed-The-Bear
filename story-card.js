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
    return withPhoto?.photo || r.photo || '';
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

  async function draw (r) {
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    try { await document.fonts?.load(`800 64px Manrope`); } catch { /* system font is fine */ }

    const picks = pickDishes(r);
    const [hero, cub] = await Promise.all([loadImage(heroPhotoFor(r, picks)), loadImage('assets/cub-avatar.jpg')]);

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
    ctx.fillText('Remember every great bite', PAD, H - 128);
    ctx.fillStyle = GOLD; ctx.font = `800 38px ${FONT}`;
    ctx.fillText(location.host || 'feed-the-bear.vercel.app', PAD, H - 76);

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
      </div>`;
    document.body.appendChild(el);
    el.addEventListener('click', e => { if (e.target === el) close(); });
    el.querySelector('.story-x').addEventListener('click', close);
    el.querySelector('.story-share').addEventListener('click', shareNow);
    el.querySelector('.story-save').addEventListener('click', save);
    el.querySelector('.story-copy').addEventListener('click', copy);
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !el.classList.contains('hidden')) close(); });
    return el;
  }

  function close () {
    overlay?.classList.add('hidden');
    const img = overlay?.querySelector('.story-img');
    if (img?.src) { URL.revokeObjectURL(img.src); img.removeAttribute('src'); }
    if (typeof window.maybeHideOverlay === 'function') window.maybeHideOverlay();
  }

  async function shareNow () {
    if (!current) return;
    track('story_card_shared', {});
    const data = { title: `What to order at ${current.name}`, text: current.text, files: [current.file] };
    if (navigator.share && navigator.canShare?.({ files: [current.file] })) {
      try { await navigator.share(data); return; } catch (err) { if (err?.name === 'AbortError') return; }
    }
    save();
  }

  function save () {
    if (!current) return;
    track('story_card_saved', {});
    const url = URL.createObjectURL(current.blob);
    const a = document.createElement('a');
    a.href = url; a.download = current.file.name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    window.showToast?.('Saved!', 'Post it to your story or send it to a friend.', 'success');
  }

  async function copy () {
    if (!current) return;
    try {
      await navigator.clipboard.writeText(current.text);
      window.showToast?.('Copied!', 'Paste it to a friend who is going.', 'success');
    } catch {
      window.showToast?.('Could not copy', 'Your browser blocked the clipboard here.', 'error');
    }
  }

  // Draws the card for restaurant `r` and opens the preview.
  async function open (r, text) {
    overlay = overlay || buildOverlay();
    const blob = await draw(r);
    if (!blob) throw new Error('Could not draw the card');
    const name = `${String(r.name).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'order'}-what-to-order.png`;
    current = { blob, file: new File([blob], name, { type: 'image/png' }), text, name: r.name };
    overlay.querySelector('.story-img').src = URL.createObjectURL(blob);
    overlay.querySelector('.story-img').alt = `What to order at ${r.name}`;
    const canShare = !!navigator.canShare?.({ files: [current.file] });
    overlay.querySelector('.story-share').textContent = canShare ? 'Share' : 'Download image';
    overlay.querySelector('.story-save').classList.toggle('hidden', !canShare);
    overlay.classList.remove('hidden');
    document.body.classList.add('overlay-open');
    track('story_card_opened', {});
  }

  return { open, draw, close, pickDishes };
})();
