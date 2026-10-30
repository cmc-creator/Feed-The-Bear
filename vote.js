/* Dinner Vote page: vote.html?v=CODE. Talks to api/vote.js. Each browser
   gets a random voter id, so voting again replaces your earlier vote. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const code = String(new URLSearchParams(location.search).get('v') || '').toUpperCase();
  const store = {
    get: k => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
  };
  let voterId = store.get('ftb_voter_id');
  if (!voterId) {
    voterId = Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2, '0')).join('');
    store.set('ftb_voter_id', voterId);
  }
  const VOTED_KEY = `ftb_voted_${code}`;
  let room = null;
  let picks = {};
  let poll = null;

  function showError (msg) {
    $('vote-sub').textContent = msg;
    $('vote-form').classList.add('hidden');
    $('vote-results').classList.add('hidden');
  }

  function renderForm () {
    $('vote-title').textContent = room.host ? `${room.host} wants to know: where should we eat?` : 'Where should we eat?';
    $('vote-sub').textContent = `${room.options.length} spots. Say yes to any you'd go to.`;
    $('vote-options').innerHTML = room.options.map((o, i) => `
      <div class="vote-option">
        <div><strong>${esc(o.name)}</strong><small>${esc([o.cuisine, o.rating ? `${o.rating}★` : '', (o.address || '').split(',')[0]].filter(Boolean).join(' · '))}</small></div>
        <div class="vote-yn" role="group" aria-label="${esc(o.name)}">
          <button type="button" class="yes" data-i="${i}" data-v="1" aria-pressed="${picks[i] === true}">Yes</button>
          <button type="button" class="no" data-i="${i}" data-v="0" aria-pressed="${picks[i] === false}">No</button>
        </div>
      </div>`).join('');
    $('vote-form').classList.remove('hidden');
    $('vote-results').classList.add('hidden');
  }

  function renderResults () {
    const total = room.voters.length;
    const most = Math.max(1, ...room.yes);
    const w = room.winner != null ? room.options[room.winner] : null;
    const maps = o => o.lat != null ? `https://www.google.com/maps/search/?api=1&query=${o.lat},${o.lng}` : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${o.name} ${o.address || ''}`)}`;
    $('vote-winner').innerHTML = w
      ? `🏆 <strong>${esc(w.name)}</strong> is winning<small>${room.yes[room.winner]} of ${total} said yes · <a href="${esc(maps(w))}" target="_blank" rel="noopener">Directions</a></small>`
      : 'No yes votes yet.';
    $('vote-tally').innerHTML = room.options.map((o, i) => `
      <div class="vote-row">
        <div class="vote-row-top"><span>${esc(o.name)}</span><span>${room.yes[i]} yes</span></div>
        <div class="vote-bar"><span style="width:${Math.round((room.yes[i] / most) * 100)}%"></span></div>
      </div>`).join('');
    $('vote-voters').textContent = total ? `Voted so far: ${room.voters.join(', ')}` : '';
    $('vote-title').textContent = room.closed ? 'The vote is over' : 'Here is how it is going';
    $('vote-sub').textContent = room.closed ? '' : 'This updates as friends vote.';
    $('vote-change').classList.toggle('hidden', !!room.closed);
    $('vote-form').classList.add('hidden');
    $('vote-results').classList.remove('hidden');
  }

  async function load () {
    if (!/^[A-Z0-9]{6}$/.test(code)) { showError('This vote link is missing its code. Ask for the link again.'); return; }
    try {
      const resp = await fetch(`/api/vote?code=${code}`);
      const data = await resp.json();
      if (!resp.ok) { showError(data.error || 'That vote was not found.'); return; }
      room = data;
      if (room.closed || store.get(VOTED_KEY)) renderResults();
      else if (!$('vote-form').classList.contains('hidden')) { /* keep their unsent taps */ }
      else renderForm();
    } catch {
      showError('Could not load the vote. Check your connection and try again.');
    }
  }

  $('vote-options').addEventListener('click', e => {
    const b = e.target.closest('button[data-i]');
    if (!b) return;
    picks[b.dataset.i] = b.dataset.v === '1';
    b.parentElement.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  });

  $('vote-submit').addEventListener('click', async () => {
    const name = $('vote-name').value.trim();
    if (!name) { $('vote-name').focus(); $('vote-name').placeholder = 'Add your name first'; return; }
    const yes = Object.keys(picks).filter(i => picks[i]).map(Number);
    const btn = $('vote-submit');
    btn.disabled = true;
    btn.textContent = 'Sending…';
    try {
      const resp = await fetch('/api/vote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'vote', code, voter: { id: voterId, name }, yes }),
      });
      const data = await resp.json();
      if (!resp.ok && !data.options) throw new Error(data.error || 'Your vote did not go through.');
      room = data;
      store.set(VOTED_KEY, '1');
      store.set('ftb_voter_name', name);
      renderResults();
    } catch (err) {
      $('vote-sub').textContent = err.message || 'Your vote did not go through. Try again.';
    } finally {
      btn.disabled = false;
      btn.textContent = 'Send my vote';
    }
  });

  $('vote-change').addEventListener('click', () => { renderForm(); });
  $('vote-name').value = store.get('ftb_voter_name') || '';

  load();
  // Keep the tally fresh while the page is open.
  poll = setInterval(() => { if (!document.hidden && room && !room.closed && !$('vote-results').classList.contains('hidden')) load(); }, 8000);
})();
