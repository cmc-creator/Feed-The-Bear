/* ════════════════════════════════════════════════════════════
   Feed The Bear - the Cub: quick add + buddy
   1. Quick Add: type a name (or paste a Maps, TikTok or Instagram link), pick a match,
      tap "Been there" or "Want to try", done. The cub fills in cuisine,
      address, and location; Grizzly members can let AI fill the rest.
      The full form is still one tap away ("More details").
   2. Buddy: a cub in the corner with quick actions and, at most once a
      visit, one tip that fits what you've been doing.
   Only window.Cub is global, and app.js functions are only called at run
   time (classic scripts share one scope; a load-time clash once stopped
   app.js from starting).
   ════════════════════════════════════════════════════════════ */

window.Cub = (() => {
  'use strict';

  const AVATAR = 'assets/cub-avatar.jpg';
  const HIDE_KEY = 'ftb_cub_hidden_until';
  const TIP_KEY = 'ftb_cub_tip_session';
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const track = (n, d) => { try { window.trackProductEvent?.(n, d); } catch { /* optional */ } };
  // app.js/firebase.js functions live on window; their let/const values
  // (state, FREE_RESTAURANT_LIMIT, _homeDiscCache) are read by name at run time.
  const app = () => window;

  /* ── Cuisine from a name or OpenStreetMap tag ─────────────── */
  const CUISINE_WORDS = [
    [/taco|taquer|burrito|cantina|mexic|birria|tamal|pozole/i, 'Mexican'], [/sushi|ramen|izakaya|japan|udon|teriyaki|hibachi/i, 'Japanese'],
    [/pho|banh|viet|saigon/i, 'Vietnamese'], [/thai|siam|bangkok/i, 'Thai'], [/korea|seoul|bulgogi|bibim|kbbq/i, 'Korean'],
    [/china|chinese|wok|dim sum|szechuan|sichuan|dumpling|panda|hunan/i, 'Chinese'], [/india|curry|tandoor|masala|biryani|punjab|tikka/i, 'Indian'],
    [/pizz|trattoria|osteria|ristorante|italia|pasta/i, 'Italian'], [/greek|gyro|souvlaki|mediterr/i, 'Mediterranean'],
    [/shawarma|falafel|kebab|lebanes|persian|turk|halal/i, 'Middle Eastern'], [/bbq|barbecue|smokehouse|brisket/i, 'BBQ'],
    [/burger|diner|grill|american|wings/i, 'American'], [/steak|chophouse/i, 'Steakhouse'], [/seafood|fish|oyster|crab|lobster|poke/i, 'Seafood'],
    [/cafe|café|coffee|espresso|roaster/i, 'Cafe'], [/bakery|bakehouse|patisserie|donut|doughnut|bagel/i, 'Bakery'],
    [/breakfast|brunch|pancake|waffle/i, 'Breakfast'], [/ice cream|gelato|dessert|frozen yogurt|creamery/i, 'Dessert'],
    [/french|bistro|brasserie/i, 'French'], [/spanish|tapas|paella/i, 'Spanish'], [/cuban|peru|colomb|venez|empanad|arepa|brazil/i, 'Latin American'],
    [/jamaic|caribbean|jerk/i, 'Caribbean'], [/ethiop|nigeria|african|moroc/i, 'African'], [/vegan|vegetarian|salad|juice|bowl/i, 'Healthy'],
  ];
  function guessCuisine (name = '', tag = '', amenity = '') {
    const fromTag = String(tag || '').split(';')[0].replace(/_/g, ' ').trim();
    if (fromTag) return fromTag.replace(/\b\w/g, c => c.toUpperCase());
    for (const [re, label] of CUISINE_WORDS) if (re.test(name)) return label;
    if (/cafe/.test(amenity)) return 'Cafe';
    if (/ice_cream/.test(amenity)) return 'Dessert';
    return '';
  }

  // A post on social media: the server reads its caption to find the restaurant.
  const SOCIAL_LINK = /https?:\/\/(?:[\w-]+\.)*(?:tiktok\.com|instagram\.com|youtube\.com|youtu\.be|facebook\.com|fb\.watch|x\.com|twitter\.com|threads\.net|yelp\.com)\/\S*/i;
  const isSocialLink = text => SOCIAL_LINK.test(String(text || ''));

  // Pull a place name (and coordinates if present) out of a Google Maps link.
  function parseMapsLink (text) {
    try {
      const u = new URL(String(text).trim());
      if (!/google\.|goo\.gl|maps\.app/.test(u.hostname)) return null;
      const place = u.pathname.match(/\/place\/([^/@?]+)/);
      const at = u.pathname.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
      const name = place ? decodeURIComponent(place[1]).replace(/\+/g, ' ') : (u.searchParams.get('q') || '');
      if (!name) return null;
      return { name, lat: at ? Number(at[1]) : null, lng: at ? Number(at[2]) : null, address: '', cuisine: guessCuisine(name), source: 'maps' };
    } catch { return null; }
  }

  /* ── Quick Add ───────────────────────────────────────────── */
  let sheet = null;
  let pick = null;          // the chosen place
  let status = null;        // 'visited' | 'want-to-try'
  let stars = 0;
  let verdict = null;
  let photo = '';
  let video = '';
  let searchTimer = null;
  let searchSeq = 0;

  function say (text) {
    const bubble = sheet?.querySelector('.qa-say');
    if (!bubble) return;
    bubble.textContent = text;
    bubble.classList.remove('pop');
    void bubble.offsetWidth;
    bubble.classList.add('pop');
  }

  function nearbyPlaces () {
    const cache = (typeof _homeDiscCache !== 'undefined' && _homeDiscCache) ? _homeDiscCache.elements || [] : [];
    return cache.map(el => {
      const t = el.tags || {};
      const lat = el.lat ?? el.center?.lat;
      const lng = el.lon ?? el.center?.lon;
      const street = [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ');
      const city = t['addr:city'] || '';
      return {
        name: t.name || '', lat: Number.isFinite(lat) ? lat : null, lng: Number.isFinite(lng) ? lng : null,
        address: [street, city].filter(Boolean).join(', '), cuisine: guessCuisine(t.name, t.cuisine, t.amenity),
        website: t.website || t['contact:website'] || '', dist: el._dist, source: 'nearby',
      };
    }).filter(p => p.name);
  }

  function savedMatch (name) {
    const key = app().normalizeName(name);
    return (state.restaurants || []).find(r => app().normalizeName(r.name) === key) || null;
  }

  function suggestionHtml (p, i) {
    const dist = Number.isFinite(p.dist) ? app().fmtDist(p.dist) : '';
    const meta = [p.cuisine, dist || p.address].filter(Boolean).join(' · ');
    return `<button type="button" class="qa-sugg" data-i="${i}"><strong>${esc(p.name)}</strong>${meta ? `<span>${esc(meta)}</span>` : ''}</button>`;
  }

  let suggestions = [];
  function renderSuggestions (typed, extra = []) {
    const box = sheet.querySelector('.qa-suggs');
    const q = typed.trim().toLowerCase();
    const near = nearbyPlaces();
    const matches = q ? near.filter(p => p.name.toLowerCase().includes(q)) : near.slice(0, 6);
    const seen = new Set();
    suggestions = [...matches, ...extra].filter(p => {
      const k = app().normalizeName(p.name);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }).slice(0, 7);
    box.innerHTML = suggestions.map(suggestionHtml).join('') +
      (q ? `<button type="button" class="qa-sugg qa-sugg-new" data-typed="1"><strong>Add “${esc(typed.trim())}”</strong><span>Not listed? Use this name</span></button>` : '');
    if (!q && !near.length) box.innerHTML = '<div class="qa-hint">Type a name, or paste a TikTok, Instagram or Google Maps link.</div>';
  }

  // Nominatim for places not in the nearby list (one request at a time, debounced).
  function searchMore (typed) {
    clearTimeout(searchTimer);
    const q = typed.trim();
    if (q.length < 3) return;
    const seq = ++searchSeq;
    searchTimer = setTimeout(async () => {
      try {
        const s = state;
        const near = Number.isFinite(s.userLat) ? `&viewbox=${s.userLng - 0.4},${s.userLat + 0.3},${s.userLng + 0.4},${s.userLat - 0.3}` : '';
        const resp = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&addressdetails=1&extratags=1${near}&q=${encodeURIComponent(q)}`, { headers: { 'Accept-Language': 'en' } });
        const list = resp.ok ? await resp.json() : [];
        if (seq !== searchSeq || !sheet) return;
        const extra = list.filter(x => ['amenity', 'shop'].includes(x.category || x.class)).map(x => {
          const a = x.address || {};
          const lat = Number(x.lat), lng = Number(x.lon);
          return {
            name: x.name || q, lat, lng,
            address: [[a.house_number, a.road].filter(Boolean).join(' '), a.city || a.town || a.suburb].filter(Boolean).join(', '),
            cuisine: guessCuisine(x.name, x.extratags?.cuisine, x.type), website: x.extratags?.website || '',
            dist: Number.isFinite(s.userLat) ? app().haversine(s.userLat, s.userLng, lat, lng) : undefined, source: 'search',
          };
        });
        renderSuggestions(sheet.querySelector('.qa-input').value, extra);
      } catch { /* offline: nearby suggestions still work */ }
    }, 600);
  }

  let linkSeq = 0;
  async function lookupLink (text) {
    clearTimeout(searchTimer);
    const seq = ++linkSeq;
    const box = sheet.querySelector('.qa-suggs');
    box.innerHTML = '<div class="qa-hint qa-link-wait">Watching that post for the restaurant… 🍿</div>';
    say('Ooh, a food post! Let me see where that is.');
    track('quick_add_link_pasted', { site: (String(text).match(/tiktok|instagram|youtube|youtu\.be|facebook|fb\.watch|x\.com|twitter|threads|yelp/i) || [''])[0].toLowerCase() });
    try {
      const s = state;
      const q = new URLSearchParams({ q: String(text).slice(0, 600) });
      if (Number.isFinite(s.userLat)) { q.set('lat', s.userLat); q.set('lng', s.userLng); }
      const resp = await fetch(`/api/link-spot?${q}`);
      const data = await resp.json().catch(() => ({}));
      if (seq !== linkSeq || !sheet) return;
      const dish = data.guess?.dish || '';
      suggestions = (data.places || []).slice(0, 3).map(pl => ({
        name: pl.name, address: pl.address || '', lat: Number(pl.lat), lng: Number(pl.lng), website: pl.website || '',
        cuisine: guessCuisine(pl.name, '', pl.type), dish, source: 'social',
        dist: Number.isFinite(s.userLat) && Number.isFinite(Number(pl.lat)) ? app().haversine(s.userLat, s.userLng, Number(pl.lat), Number(pl.lng)) : undefined,
      }));
      if (!suggestions.length) {
        box.innerHTML = `<div class="qa-hint">${esc(data.error || 'We could not tell which restaurant that is. Try typing its name.')}</div>`;
        say("Hmm, I couldn't spot the restaurant in that one. Type its name?");
        sheet.querySelector('.qa-input').value = '';
        return;
      }
      box.innerHTML = suggestions.map(suggestionHtml).join('');
      say(suggestions.length === 1 ? `Found it! Is it ${suggestions[0].name}?` : `I think it's one of these. Which one?`);
      track('quick_add_link_found', { results: suggestions.length });
    } catch {
      if (seq !== linkSeq || !sheet) return;
      box.innerHTML = '<div class="qa-hint">Could not read that link right now. Try typing the restaurant name.</div>';
    }
  }

  function choose (place) {
    const existing = savedMatch(place.name);
    if (existing) {
      say(`${existing.name} is already in your den! Opening it for you.`);
      setTimeout(() => { close(); app().openDetailModal(existing.id); }, 900);
      return;
    }
    pick = { ...place };
    sheet.classList.add('step-2');
    sheet.querySelector('.qa-place-name').textContent = pick.name;
    sheet.querySelector('.qa-cuisine').value = pick.cuisine || '';
    sheet.querySelector('.qa-place-meta').textContent = [pick.address, Number.isFinite(pick.dist) ? app().fmtDist(pick.dist) + ' away' : ''].filter(Boolean).join(' · ');
    const flavor = pick.cuisine ? `${pick.cuisine}! ` : '';
    say(`${flavor}Have you been, or is it on your hit list?`);
    // From a food post: you haven't been yet, so default to Want to Try with the dish from the video.
    if (pick.source === 'social') {
      setStatus('want-to-try');
      if (pick.dish) sheet.querySelector('.qa-dish').value = pick.dish;
      say(pick.dish ? `Saving it to Want to Try, with the ${pick.dish} on your Crave List.` : 'Saving it to your Want to Try list. Been already? Tap Been there.');
    }
    track('quick_add_place_picked', { source: pick.source, hasCuisine: !!pick.cuisine });
  }

  function setStatus (s) {
    status = s;
    sheet.querySelectorAll('.qa-status').forEach(b => b.classList.toggle('active', b.dataset.status === s));
    sheet.classList.toggle('been', s === 'visited');
    sheet.classList.toggle('want', s === 'want-to-try');
    sheet.querySelector('.qa-dish').placeholder = s === 'visited' ? 'What did you have? (optional)' : 'Heard about a must-order dish? (optional)';
    say(s === 'visited' ? 'Nice! How was it? Tap the stars.' : 'Good call. Any dish you have to try there?');
    sheet.querySelector('.qa-save').disabled = false;
  }

  function setStars (n) {
    stars = n;
    sheet.querySelectorAll('.qa-star').forEach((b, i) => b.classList.toggle('on', i < n));
    say(['', 'Oof. Noted, we will steer clear.', 'Meh. Good to know.', 'Solid spot.', 'Ooh, a keeper!', 'Five stars! The bear approves.'][n]);
  }

  async function aiFill () {
    if (!pick) return;
    if (!app().hasGrizzly()) { app().showGrizzlyUpsell('smartfill'); return; }
    say('Sniffing out the details…');
    try {
      const data = await app().AI.smartFill(pick.name, pick.address || '');
      if (data.cuisine) sheet.querySelector('.qa-cuisine').value = data.cuisine;
      if (data.priceRange) pick.priceRange = Number(data.priceRange) || 0;
      if (data.description) pick.notes = data.description;
      if (Array.isArray(data.tags)) pick.tags = data.tags.slice(0, 6);
      say(`Filled in: ${[data.cuisine, data.priceRange ? '$'.repeat(Number(data.priceRange)) : '', data.tags?.length ? 'tags' : ''].filter(Boolean).join(', ') || 'what I could find'}.`);
    } catch (err) {
      say("I couldn't find more just now. You can still save it.");
    }
  }

  let saving = false;
  function save () {
    if (!pick || !status) return;
    const a = app();
    if (typeof a.isPremium === 'function' && !a.isPremium() && state.restaurants.length >= FREE_RESTAURANT_LIMIT) {
      a.showGrizzlyUpsell('limit');
      return;
    }
    const today = a.iso();
    const cuisine = sheet.querySelector('.qa-cuisine').value.trim().slice(0, 40);
    const dish = sheet.querySelector('.qa-dish').value.trim().slice(0, 80);
    const r = {
      id: a.uid(), name: pick.name.slice(0, 80), cuisine, priceRange: pick.priceRange || 0,
      address: pick.address || '', lat: Number.isFinite(pick.lat) ? pick.lat : null, lng: Number.isFinite(pick.lng) ? pick.lng : null,
      website: pick.website || '', photo: '', googleRating: 0, googleReviews: 0,
      myRating: status === 'visited' ? stars : 0, notes: pick.notes || '', tags: pick.tags || [],
      collectionId: null, priority: '', status, dateAdded: today,
      dateVisited: status === 'visited' ? today : null, updatedAt: Date.now(), visits: [],
    };
    if (status === 'visited') r.visits.push({ date: today, note: '', rating: stars, dish, photo, ...(video ? { video } : {}) });
    if (photo) r.photo = photo;
    state.restaurants.unshift(r);
    if (dish) a.upsertDish(r, { name: dish, verdict: status === 'visited' ? (verdict || (stars >= 4 ? 'again' : stars && stars <= 2 ? 'skip' : 'ok')) : 'want', photo, video });
    else a.saveData();
    if (!Number.isFinite(r.lat) && r.address && typeof a.geocodeAddress === 'function') a.geocodeAddress(r.id, r.address);
    a.renderAll();
    track('quick_add_saved', { status, source: pick.source, stars, hasDish: !!dish, hasPhoto: !!photo });
    saving = true;
    close();
    saving = false;
    if (photo) a.photoReveal(photo, dish || r.name);
    a.showToast(status === 'visited' ? `${r.name} logged` : `${r.name} saved`, status === 'visited' ? 'In your den, with your rating.' : 'On your Want to Try list.', 'success');
    if (typeof a.celebrateMilestones === 'function') a.celebrateMilestones();
    if (welcomeActive) { resumeWelcome(true); return; }
    buddyTip(status === 'want-to-try' && !dish ? `Tip: open ${r.name} and add a must-try dish to your Crave List.` : '', true);
  }

  function moreDetails () {
    if (!pick) return;
    const p = pick;
    close();
    app().openAddModalPreFilled(p.name, sheet?.querySelector('.qa-cuisine')?.value || p.cuisine || '', {
      name: p.name, address: p.address || '', website: p.website || '', lat: p.lat, lon: p.lng,
    });
  }

  function build () {
    const el = document.createElement('div');
    el.id = 'quick-add-overlay';
    el.className = 'modal-overlay hidden';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'qa-title');
    el.innerHTML = `
      <div class="modal-card qa-card">
        <div class="qa-head">
          <img class="qa-avatar" src="${AVATAR}" alt="" />
          <div class="qa-say" aria-live="polite"></div>
          <button type="button" class="icon-btn qa-close" aria-label="Close">✕</button>
        </div>
        <h2 id="qa-title" class="qa-title">Add a spot</h2>
        <div class="qa-step-1">
          <input class="form-input qa-input" type="text" maxlength="120" autocomplete="off" enterkeyhint="search"
            placeholder="Name, or paste a TikTok, Instagram or Maps link" aria-label="Restaurant name, or a TikTok, Instagram or Google Maps link" />
          <div class="qa-suggs"></div>
        </div>
        <div class="qa-step-2">
          <div class="qa-place">
            <div class="qa-place-name"></div>
            <div class="qa-place-meta"></div>
            <div class="qa-row">
              <input class="form-input qa-cuisine" type="text" maxlength="40" placeholder="Cuisine" aria-label="Cuisine" />
              <button type="button" class="qa-ai">Let Cub fill the rest${'<span class="gz-badge qa-ai-badge">GRIZZLY</span>'}</button>
            </div>
            <button type="button" class="qa-change">Not it? Search again</button>
          </div>
          <div class="qa-statuses">
            <button type="button" class="qa-status" data-status="visited">Been there</button>
            <button type="button" class="qa-status" data-status="want-to-try">Want to try</button>
          </div>
          <div class="qa-been">
            <div class="qa-stars" role="radiogroup" aria-label="Your rating">${[1, 2, 3, 4, 5].map(n => `<button type="button" class="qa-star" data-n="${n}" aria-label="${n} star${n > 1 ? 's' : ''}">★</button>`).join('')}</div>
          </div>
          <div class="qa-extra">
            <div class="qa-row">
              <input class="form-input qa-dish" type="text" maxlength="80" autocomplete="off" />
              <button type="button" class="qa-photo" aria-label="Add a photo or video"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg></button>
            </div>
            <img class="qa-photo-preview hidden" alt="Your photo" />
          </div>
          <button type="button" class="btn-primary qa-save" disabled>Add to my den</button>
          <button type="button" class="qa-more">More details</button>
        </div>
      </div>`;
    document.body.appendChild(el);

    const input = el.querySelector('.qa-input');
    input.addEventListener('input', () => {
      const link = parseMapsLink(input.value);
      if (link) { choose(link); return; }
      if (isSocialLink(input.value)) { lookupLink(input.value); return; }
      linkSeq++;
      renderSuggestions(input.value);
      searchMore(input.value);
    });
    input.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      if (suggestions[0]) choose(suggestions[0]);
      else if (input.value.trim()) choose({ name: input.value.trim(), cuisine: guessCuisine(input.value), source: 'typed' });
    });
    el.querySelector('.qa-suggs').addEventListener('click', e => {
      const btn = e.target.closest('.qa-sugg');
      if (!btn) return;
      if (btn.dataset.typed) choose({ name: input.value.trim(), cuisine: guessCuisine(input.value), source: 'typed' });
      else choose(suggestions[Number(btn.dataset.i)]);
    });
    el.querySelector('.qa-change').addEventListener('click', () => { el.classList.remove('step-2', 'been', 'want'); pick = null; status = null; input.focus(); say('Who are we looking for?'); });
    el.querySelectorAll('.qa-status').forEach(b => b.addEventListener('click', () => setStatus(b.dataset.status)));
    el.querySelectorAll('.qa-star').forEach(b => b.addEventListener('click', () => setStars(Number(b.dataset.n))));
    el.querySelector('.qa-ai').addEventListener('click', aiFill);
    el.querySelector('.qa-photo').addEventListener('click', async () => {
      const media = await app().pickFoodMedia();
      if (!media) return;
      photo = media.photo;
      video = media.video || '';
      const prev = el.querySelector('.qa-photo-preview');
      prev.src = app().safeUrl(photo);
      prev.classList.remove('hidden');
      say(video ? 'Ooh, a video! That looks amazing.' : 'Looks delicious.');
    });
    el.querySelector('.qa-save').addEventListener('click', save);
    el.querySelector('.qa-more').addEventListener('click', moreDetails);
    el.querySelector('.qa-close').addEventListener('click', close);
    el.addEventListener('click', e => { if (e.target === el) close(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !el.classList.contains('hidden')) close(); });
    return el;
  }

  function openAdd (prefill = '') {
    sheet = sheet || build();
    pick = null; status = null; stars = 0; verdict = null; photo = ''; video = '';
    sheet.classList.remove('step-2', 'been', 'want');
    sheet.querySelector('.qa-input').value = '';
    sheet.querySelector('.qa-dish').value = '';
    sheet.querySelector('.qa-save').disabled = true;
    sheet.querySelector('.qa-photo-preview').classList.add('hidden');
    sheet.querySelectorAll('.qa-star').forEach(b => b.classList.remove('on'));
    sheet.querySelectorAll('.qa-status').forEach(b => b.classList.remove('active'));
    sheet.querySelector('.qa-ai-badge').classList.toggle('hidden', app().hasGrizzly());
    renderSuggestions('');
    say(nearbyPlaces().length ? "Where'd you find a good bite? Here's what's near you." : "Where'd you find a good bite? Type a name or paste a Maps link.");
    sheet.classList.remove('hidden');
    document.body.classList.add('overlay-open');
    hideBubble();
    track('quick_add_opened', {});
    setTimeout(() => sheet.querySelector('.qa-input').focus(), 60);
    // Shared to the app or pasted in: look it up right away.
    const shared = String(prefill || '').trim();
    if (shared) {
      const input = sheet.querySelector('.qa-input');
      const maps = parseMapsLink((shared.match(/https?:\/\/\S+/) || [shared])[0]);
      if (maps) { choose(maps); return; }
      input.value = isSocialLink(shared) ? (shared.match(SOCIAL_LINK) || [shared])[0] : shared;
      if (isSocialLink(shared)) lookupLink(shared);
      else input.dispatchEvent(new Event('input'));
    }
  }

  function close () {
    const wasOpen = sheet && !sheet.classList.contains('hidden');
    sheet?.classList.add('hidden');
    clearTimeout(searchTimer);
    if (typeof app().maybeHideOverlay === 'function') app().maybeHideOverlay();
    if (wasOpen && welcomeActive && !saving) resumeWelcome(false);
  }

  /* ── First-run welcome ───────────────────────────────────────
     Replaces five read-only slides with three things to actually do:
     turn on location, add a first spot, swipe a few dishes. Every step can
     be skipped. Quick Add hands back here when it saves or closes. */
  let welcomeEl = null;
  let welcomeStep = 0;
  let welcomeActive = false;
  const welcomeDid = new Set();

  const WELCOME_STEPS = [
    { key: 'hi', title: "Hi! I'm Cub.", body: "I'll help you remember every great bite, and find the next one.", go: "Let's go", skip: 'Skip setup' },
    { key: 'location', title: 'Can I sniff around where you are?', body: "I'll show restaurants near you and give you a nudge when something you're craving is close.", go: 'Use my location', skip: 'Not now' },
    { key: 'spot', title: "What's a spot you love?", body: 'Or one you are dying to try. It takes about ten seconds.', go: 'Add my first spot', skip: 'Skip for now' },
    { key: 'swipe', title: 'Last thing: teach me your taste', body: "Swipe a few real dishes. Right if you'd eat it, left if not.", go: 'Show me the dishes', skip: "I'm all set" },
  ];

  function buildWelcome () {
    const el = document.createElement('div');
    el.id = 'cub-welcome';
    el.className = 'cub-welcome hidden';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'cub-welcome-title');
    el.innerHTML = `
      <div class="cw-card">
        <img class="cw-avatar" src="${AVATAR}" alt="Cub the bear cub" />
        <div class="cw-dots" aria-hidden="true">${WELCOME_STEPS.map(() => '<i></i>').join('')}</div>
        <h2 id="cub-welcome-title" class="cw-title"></h2>
        <p class="cw-body"></p>
        <button type="button" class="btn-primary cw-go"></button>
        <button type="button" class="cw-skip"></button>
      </div>`;
    document.body.appendChild(el);
    el.querySelector('.cw-go').addEventListener('click', welcomeGo);
    el.querySelector('.cw-skip').addEventListener('click', () => {
      track('welcome_step_skipped', { step: WELCOME_STEPS[welcomeStep].key });
      if (welcomeStep === 0) finishWelcome(true); else showWelcomeStep(welcomeStep + 1);
    });
    return el;
  }

  function showWelcomeStep (i) {
    if (i >= WELCOME_STEPS.length) { finishWelcome(false); return; }
    welcomeStep = i;
    const s = WELCOME_STEPS[i];
    welcomeEl.querySelector('.cw-title').textContent = s.title;
    welcomeEl.querySelector('.cw-body').textContent = s.body;
    welcomeEl.querySelector('.cw-go').textContent = s.go;
    welcomeEl.querySelector('.cw-skip').textContent = s.skip;
    welcomeEl.querySelectorAll('.cw-dots i').forEach((d, n) => d.classList.toggle('on', n <= i));
    welcomeEl.dataset.step = s.key;
    welcomeEl.classList.remove('hidden');
    document.body.classList.add('overlay-open');
    const card = welcomeEl.querySelector('.cw-card');
    card.classList.remove('cw-in'); void card.offsetWidth; card.classList.add('cw-in');
    track('welcome_step_shown', { step: s.key });
  }

  function welcomeGo () {
    const key = WELCOME_STEPS[welcomeStep].key;
    welcomeDid.add(key);
    track('welcome_step_done', { step: key });
    if (key === 'location') {
      try { app().enableLocation?.(); } catch { /* the browser asks; we move on either way */ }
      showWelcomeStep(welcomeStep + 1);
    } else if (key === 'spot') {
      welcomeEl.classList.add('hidden');
      openAdd();
    } else if (key === 'swipe') {
      finishWelcome(false);
      setTimeout(() => document.getElementById('bear-swipe-home')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 250);
    } else {
      showWelcomeStep(welcomeStep + 1);
    }
  }

  // Quick Add calls this when it saves or closes during the welcome.
  function resumeWelcome (saved) {
    if (!welcomeActive || WELCOME_STEPS[welcomeStep]?.key !== 'spot') return;
    if (!saved) welcomeDid.delete('spot');
    setTimeout(() => showWelcomeStep(welcomeStep + 1), saved ? 900 : 150);
  }

  function finishWelcome (skippedAll) {
    welcomeActive = false;
    welcomeEl?.classList.add('hidden');
    try { app().dismissOnboarding?.(); } catch { /* keeps working without it */ }
    if (typeof app().maybeHideOverlay === 'function') app().maybeHideOverlay();
    track(skippedAll ? 'welcome_skipped' : 'welcome_done', { did: [...welcomeDid].join(',') });
    if (!skippedAll) app().showToast?.("You're all set!", 'Tap me any time for quick actions.', 'success');
  }

  function welcome () {
    if (state?.settings?.onboardingDone) return false;
    welcomeEl = welcomeEl || buildWelcome();
    welcomeActive = true;
    welcomeDid.clear();
    showWelcomeStep(0);
    return true;
  }

  /* ── Buddy ───────────────────────────────────────────────── */
  let buddy = null;
  let bubbleTimer = null;

  const ACTIONS = [
    ['ask', 'Chat with Byte Cub', () => (app().hasGrizzly() ? app().openAiPanel?.() : app().showGrizzlyUpsell('byte-cub'))],
    ['add', 'Add a spot', () => openAdd()],
    ['ate', 'I just ate', () => app().openJustAte?.()],
    ['pick', 'Pick for me', () => app().openDecisionMode?.()],
    ['swipe', 'Bear Swipe', () => { const m = document.getElementById('bear-swipe-home'); m?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }],
    ['hide', 'Hide the cub for a week', () => hideBuddy()],
  ];

  function hiddenNow () {
    try { return Date.now() < Number(localStorage.getItem(HIDE_KEY) || 0); } catch { return false; }
  }

  function buildBuddy () {
    const el = document.createElement('div');
    el.id = 'cub-buddy';
    el.className = 'cub-buddy';
    el.innerHTML = `
      <div class="cub-bubble hidden" role="status"><span class="cub-bubble-text"></span><button type="button" class="cub-bubble-x" aria-label="Dismiss tip">✕</button></div>
      <div class="cub-menu hidden" role="menu" aria-label="Cub quick actions">${ACTIONS.map(([k, label]) => `<button type="button" role="menuitem" data-act="${k}" class="${k === 'hide' ? 'cub-menu-quiet' : ''}">${esc(label)}</button>`).join('')}</div>
      <button type="button" class="cub-btn" aria-label="Your bear cub buddy" aria-expanded="false"><img src="${AVATAR}" alt="" /></button>`;
    document.body.appendChild(el);
    const btn = el.querySelector('.cub-btn');
    const menu = el.querySelector('.cub-menu');
    btn.addEventListener('click', () => {
      hideBubble();
      const open = menu.classList.toggle('hidden') === false;
      btn.setAttribute('aria-expanded', String(open));
      if (open) track('cub_menu_opened', {});
    });
    menu.addEventListener('click', e => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      menu.classList.add('hidden');
      btn.setAttribute('aria-expanded', 'false');
      track('cub_action', { act: b.dataset.act });
      ACTIONS.find(([k]) => k === b.dataset.act)?.[2]();
    });
    document.addEventListener('click', e => {
      if (!el.contains(e.target)) { menu.classList.add('hidden'); btn.setAttribute('aria-expanded', 'false'); }
    });
    el.querySelector('.cub-bubble-x').addEventListener('click', e => { e.stopPropagation(); hideBubble(); });
    el.querySelector('.cub-bubble').addEventListener('click', e => {
      if (e.target.closest('.cub-bubble-x')) return;
      const act = el.querySelector('.cub-bubble').dataset.act;
      hideBubble();
      if (act) ACTIONS.find(([k]) => k === act)?.[2]();
      else if (el.querySelector('.cub-bubble').dataset.restaurant) app().openDetailModal(el.querySelector('.cub-bubble').dataset.restaurant);
    });
    return el;
  }

  function hideBuddy () {
    try { localStorage.setItem(HIDE_KEY, String(Date.now() + 7 * 864e5)); } catch { /* storage blocked */ }
    buddy?.remove();
    buddy = null;
    app().showToast?.('See you soon', 'The cub will be back in a week. You can still add spots with +.', 'info');
  }

  function hideBubble () {
    clearTimeout(bubbleTimer);
    buddy?.querySelector('.cub-bubble')?.classList.add('hidden');
  }

  // One relevant tip, based on what you've been doing.
  function pickTip () {
    const list = state?.restaurants || [];
    if (!list.length) return { text: "Let's add your first spot! Tap here.", act: 'add' };
    const visitedNoDish = list.find(r => r.status === 'visited' && !(r.dishes || []).length);
    if (visitedNoDish) return { text: `What did you order at ${visitedNoDish.name}? Tell me so I remember.`, restaurant: visitedNoDish.id };
    const wantNoDish = list.find(r => r.status === 'want-to-try' && !(r.dishes || []).length);
    if (wantNoDish) return { text: `Heard what to order at ${wantNoDish.name}? Save it to your Crave List.`, restaurant: wantNoDish.id };
    return { text: "Hungry? Let's swipe some dishes.", act: 'swipe' };
  }

  function buddyTip (text = '', force = false) {
    if (!buddy) return;
    let shown = false;
    try { shown = sessionStorage.getItem(TIP_KEY) === '1'; } catch { /* private mode */ }
    if (shown && !force) return;
    const tip = text ? { text } : pickTip();
    if (!tip?.text) return;
    const bubble = buddy.querySelector('.cub-bubble');
    bubble.querySelector('.cub-bubble-text').textContent = tip.text;
    bubble.dataset.act = tip.act || '';
    bubble.dataset.restaurant = tip.restaurant || '';
    bubble.classList.remove('hidden');
    try { sessionStorage.setItem(TIP_KEY, '1'); } catch { /* private mode */ }
    clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(hideBubble, 9000);
  }

  function init () {
    if (!hiddenNow() && !document.getElementById('cub-buddy')) {
      buddy = buildBuddy();
      setTimeout(() => {
        // Not over another screen, and not before onboarding is done.
        if (welcomeActive || document.body.classList.contains('overlay-open') || !state?.settings?.onboardingDone) return;
        buddyTip();
      }, 8000);
    }
  }

  return { init, openAdd, close, welcome, guessCuisine, parseMapsLink, tip: buddyTip };
})();

document.addEventListener('DOMContentLoaded', () => window.Cub.init());
