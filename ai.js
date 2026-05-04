/* ════════════════════════════════════════════════════════════
   Feed The Bear — AI Engine  (Gemini 2.0 Flash)
   ════════════════════════════════════════════════════════════
   All AI logic lives here. app.js calls these helpers.
   API key is stored in localStorage under ftb_settings_v1
   as  settings.geminiKey  (never hard-coded or transmitted
   to any server other than Google's official endpoint).
   ════════════════════════════════════════════════════════════ */

'use strict';

/* ── Gemini endpoint ─────────────────────────────────────── */
const GEMINI_MODEL   = 'gemini-2.0-flash';
const GEMINI_BASE    = 'https://generativelanguage.googleapis.com/v1beta/models/';
const GEMINI_GEN     = `${GEMINI_BASE}${GEMINI_MODEL}:generateContent`;
const GEMINI_STREAM  = `${GEMINI_BASE}${GEMINI_MODEL}:streamGenerateContent`;

/* ── Key helpers ─────────────────────────────────────────── */
const AI = {

  /* ── 1 · Key management ──────────────────────────────── */
  getKey () {
    try { return (JSON.parse(localStorage.getItem('ftb_settings_v1') || '{}')).geminiKey || ''; }
    catch { return ''; }
  },

  setKey (key) {
    try {
      const s = JSON.parse(localStorage.getItem('ftb_settings_v1') || '{}');
      s.geminiKey = key.trim();
      localStorage.setItem('ftb_settings_v1', JSON.stringify(s));
      // Keep legacy openAI key field in sync so old code paths still work
      if (typeof state !== 'undefined') state.settings.geminiKey = s.geminiKey;
    } catch { /* ignore */ }
  },

  hasKey () { return !!this.getKey(); },

  /* ── 2 · Low-level call ──────────────────────────────── */
  async _call (parts, systemText = '', opts = {}) {
    const key = this.getKey();
    if (!key) throw new Error('NO_KEY');

    const body = {
      contents: [{ role: 'user', parts }],
      generationConfig: {
        temperature:     opts.temperature  ?? 0.85,
        maxOutputTokens: opts.maxTokens    ?? 512,
        topP:            opts.topP         ?? 0.95,
      },
    };
    if (systemText) {
      body.systemInstruction = { parts: [{ text: systemText }] };
    }

    const resp = await fetch(`${GEMINI_GEN}?key=${encodeURIComponent(key)}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err?.error?.message || `HTTP ${resp.status}`);
    }

    const data = await resp.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  },

  /* ── 3 · Text-only shorthand ─────────────────────────── */
  async call (prompt, systemPrompt = '', opts = {}) {
    return this._call([{ text: prompt }], systemPrompt, opts);
  },

  /* ── 4 · Vision call (image + text) ─────────────────── */
  async callVision (prompt, base64Data, mimeType = 'image/jpeg', opts = {}) {
    return this._call([
      { inline_data: { mime_type: mimeType, data: base64Data } },
      { text: prompt },
    ], opts.system || '', opts);
  },

  /* ── 5 · Streaming call (yields text chunks) ─────────── */
  async *stream (prompt, systemText = '', opts = {}) {
    const key = this.getKey();
    if (!key) throw new Error('NO_KEY');

    const body = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature:     opts.temperature  ?? 0.85,
        maxOutputTokens: opts.maxTokens    ?? 800,
      },
    };
    if (systemText) body.systemInstruction = { parts: [{ text: systemText }] };

    const resp = await fetch(`${GEMINI_STREAM}?key=${encodeURIComponent(key)}&alt=sse`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const reader  = resp.body.getReader();
    const decoder = new TextDecoder();
    let   buffer  = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6).trim();
        if (raw === '[DONE]') return;
        try {
          const chunk = JSON.parse(raw);
          const text  = chunk?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) yield text;
        } catch { /* skip malformed chunk */ }
      }
    }
  },

  /* ═══════════════════════════════════════════════════════
     FEATURE FUNCTIONS
     ═══════════════════════════════════════════════════════ */

  /* ── 6 · Build restaurant context string ────────────── */
  buildContext (restaurants) {
    if (!restaurants?.length) return 'No restaurants saved yet.';
    const visited    = restaurants.filter(r => r.status === 'visited');
    const wantToTry  = restaurants.filter(r => r.status === 'want-to-try');
    const topRated   = [...visited]
      .filter(r => r.myRating)
      .sort((a, b) => b.myRating - a.myRating)
      .slice(0, 8)
      .map(r => `${r.name} (${r.cuisine || '?'}, ${r.myRating}★${r.notes ? ', note: "' + r.notes.slice(0, 60) + '"' : ''})`)
      .join('; ');
    const cuisineMap = {};
    visited.forEach(r => { const c = r.cuisine || 'Other'; cuisineMap[c] = (cuisineMap[c] || 0) + 1; });
    const cuisines   = Object.entries(cuisineMap).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c}(×${n})`).join(', ');
    const tags       = [...new Set(restaurants.flatMap(r => r.tags || []))].slice(0, 12).join(', ');
    const avgRating  = visited.filter(r => r.myRating).reduce((s, r) => s + r.myRating, 0) / (visited.filter(r => r.myRating).length || 1);

    return [
      `Total saved: ${restaurants.length} (${visited.length} visited, ${wantToTry.length} want-to-try).`,
      topRated   ? `Top rated (mine): ${topRated}.`          : '',
      cuisines   ? `Cuisine frequency: ${cuisines}.`         : '',
      tags       ? `Common tags: ${tags}.`                   : '',
      avgRating  ? `Average personal rating: ${avgRating.toFixed(1)}/5.` : '',
    ].filter(Boolean).join(' ');
  },

  /* ── 7 · LLM-powered Byte Cub chat ──────────────────── */
  async chat (userText, history = [], restaurants = []) {
    const context   = this.buildContext(restaurants);
    const systemMsg = `You are Byte Cub 🐻, a warm, witty, expert food guide for the Feed The Bear app.
You know the user's personal restaurant list intimately. Be concise (2-4 sentences usually), enthusiastic, and personal.
Use food emoji naturally. Format lists with bullet points or line breaks when helpful.
Never say you're an AI — you're Byte Cub.
User's restaurant data: ${context}`;

    // Build message history (last 10 turns)
    const historyParts = history.slice(-10).map(m =>
      `${m.role === 'user' ? 'User' : 'Byte Cub'}: ${m.text}`
    ).join('\n');

    const prompt = historyParts
      ? `${historyParts}\nUser: ${userText}`
      : userText;

    return this.call(prompt, systemMsg, { maxTokens: 400 });
  },

  /* ── 8 · Smart form auto-fill ────────────────────────── */
  async smartFill (name, address = '', existingNotes = '') {
    const prompt = `You are a restaurant data assistant. Given the info below, return ONLY a JSON object with these exact keys: cuisine, priceRange (1-4 integer), tags (array of 2-4 lowercase strings), description (one enticing sentence max 120 chars), confidence (0-1).
Rules: priceRange: 1=$budget, 2=$$casual, 3=$$$upscale, 4=$$$$fine dining.
Tags should be things like: date-night, family-friendly, romantic, quick-lunch, outdoor-seating, brunch, vegan-options, etc.
If unsure about something, make a reasonable educated guess based on the name and cuisine.

Restaurant name: ${name}
Address: ${address || 'unknown'}
Notes: ${existingNotes || 'none'}

Respond with ONLY valid JSON, no markdown, no explanation.`;

    const raw = await this.call(prompt, '', { temperature: 0.3, maxTokens: 256 });
    const cleaned = raw.replace(/```json\n?|\n?```/g, '').trim();
    return JSON.parse(cleaned);
  },

  /* ── 9 · Visit notes assistant ───────────────────────── */
  async enrichNotes (restaurant, rawNote = '') {
    const { name, cuisine, myRating, priceRange, address } = restaurant;
    const stars = myRating ? `${myRating}/5` : 'unrated';
    const price = ['', '$', '$$', '$$$', '$$$$'][priceRange || 0] || '?';

    const prompt = `You are a foodie writing assistant. Transform the rough note below into a vivid, personal 2-3 sentence review for a restaurant app. Keep it first-person, warm, and specific. Include any dishes or moments mentioned. No fluff. Max 200 chars.

Restaurant: ${name} (${cuisine || 'cuisine unknown'}, ${price}, ${stars})
Address: ${address || 'unknown'}
Raw note: "${rawNote || 'No notes provided – write something charming based on the restaurant details.'}"

Write ONLY the enriched note, no quotes, no explanation.`;

    return this.call(prompt, '', { temperature: 0.75, maxTokens: 200 });
  },

  /* ── 10 · Dish recommendations ───────────────────────── */
  async dishRecs (restaurant) {
    const { name, cuisine, myRating, notes, tags } = restaurant;
    const prompt = `You are a food expert. For the restaurant below, suggest 4-5 must-try dishes or menu items. Be specific and appetising. Format as a JSON array of objects: [{dish, reason}]. Only return JSON, no markdown.

Restaurant: ${name}
Cuisine: ${cuisine || 'unknown'}
Rating: ${myRating || '?'}/5
Notes: ${notes || 'none'}
Tags: ${(tags || []).join(', ') || 'none'}`;

    const raw = await this.call(prompt, '', { temperature: 0.7, maxTokens: 400 });
    const cleaned = raw.replace(/```json\n?|\n?```/g, '').trim();
    return JSON.parse(cleaned);
  },

  /* ── 11 · Monthly digest / year in review ────────────── */
  async digest (restaurants, monthLabel = '') {
    if (!restaurants.length) throw new Error('NO_DATA');
    const context = this.buildContext(restaurants);
    const period  = monthLabel || 'this period';

    const prompt = `Write a fun, personalised food diary summary for ${period}. Make it feel like a warm letter from a food-loving friend. Include specific restaurant names, cuisine discoveries, rating highlights, and a cheeky observation about their eating patterns. Use emoji naturally. 3-4 paragraphs, max 400 words.

User's data: ${context}`;

    return this.call(prompt, 'You are Byte Cub, a friendly food guide who writes vivid, personal summaries.', { maxTokens: 600 });
  },

  /* ── 12 · Taste profile / personality analysis ───────── */
  async tasteProfile (restaurants) {
    if (!restaurants.length) throw new Error('NO_DATA');
    const context = this.buildContext(restaurants);

    const prompt = `Analyse the user's restaurant history and write a creative "Foodie Personality Profile" with these exact JSON keys:
- title: a catchy 3-4 word foodie archetype (e.g. "The Bold Adventurer", "Comfort Food Devotee")  
- subtitle: one sentence expanding on the title
- traits: array of 4 personality traits (e.g. ["Cuisine Explorer", "Budget Conscious", "Date Night Planner", "Spice Seeker"])
- insight: 2-3 sentence deeper insight about their food habits
- challenge: one fun suggestion to break their pattern
- emoji: single most fitting emoji for their profile

User data: ${context}

Return ONLY valid JSON, no markdown.`;

    const raw = await this.call(prompt, '', { temperature: 0.8, maxTokens: 512 });
    const cleaned = raw.replace(/```json\n?|\n?```/g, '').trim();
    return JSON.parse(cleaned);
  },

  /* ── 13 · Photo caption generator ───────────────────── */
  async captionPhoto (base64Data, mimeType = 'image/jpeg', restaurantName = '') {
    const prompt = `Write a short, punchy food photo caption (max 80 chars) for a foodie app. Identify the dish if possible. Be enthusiastic and personal. No hashtags. Just the caption text.${restaurantName ? ` This was taken at ${restaurantName}.` : ''}`;

    return this.callVision(prompt, base64Data, mimeType, { maxTokens: 100 });
  },

  /* ── 14 · Restaurant AI summary (detail modal) ───────── */
  async restaurantSummary (restaurant) {
    const { name, cuisine, myRating, googleRating, priceRange, notes, tags, address } = restaurant;
    const price = ['', '$', '$$', '$$$', '$$$$'][priceRange || 0] || '';
    const myStars = myRating ? `${myRating}/5 (mine)` : '';
    const gStars  = googleRating ? `${googleRating}/5 (Google)` : '';

    const prompt = `Write a 2-sentence "vibe summary" for this restaurant as if recommending it to a food-loving friend. Be warm, specific, and evocative. No generic filler.

${name} · ${cuisine || 'restaurant'} · ${price}${myStars ? ' · ' + myStars : ''}${gStars ? ' · ' + gStars : ''}
Address: ${address || 'unknown'}
Tags: ${(tags || []).join(', ') || 'none'}
My notes: ${notes || 'none'}

Write ONLY the summary, no quotes.`;

    return this.call(prompt, '', { temperature: 0.75, maxTokens: 150 });
  },

  /* ── 15 · Craving engine (AI-enhanced) ──────────────── */
  async cravingMatch (userInput, restaurants) {
    if (!restaurants.length) throw new Error('NO_DATA');
    const list = restaurants.map(r =>
      `[${r.id}] ${r.name} – ${r.cuisine || '?'}, ${['', '$', '$$', '$$$', '$$$$'][r.priceRange || 0] || '?'}, ${r.status}, rating:${r.myRating || r.googleRating || '?'}, tags:${(r.tags || []).join(',')}`
    ).join('\n');

    const prompt = `The user is craving: "${userInput}"

From the restaurant list below, pick the BEST 1-3 matches. Return ONLY a JSON array of objects: [{id, name, reason}] where reason is ≤15 words. No markdown.

${list}`;

    const raw = await this.call(prompt, 'You are a food matchmaker. Match cravings to restaurant lists precisely.', { temperature: 0.5, maxTokens: 300 });
    const cleaned = raw.replace(/```json\n?|\n?```/g, '').trim();
    return JSON.parse(cleaned);
  },

};

/* ── Export to global scope ──────────────────────────────── */
window.AI = AI;
