const { BASE, check, launch, newPage, finish } = require('./lib');

const spot = (id, name) => ({ id, name, status: 'visited', tags: [], dishes: [], visits: [], updatedAt: 1 });

(async () => {
  const browser = await launch();
  const p = await newPage(browser, { seed: [spot('guest', 'Guest spot')] });
  await p.route('https://www.gstatic.com/firebasejs/**', r => r.fulfill({ contentType: 'text/javascript', body: '' }));
  await p.route(/overpass|nominatim|open-meteo/, r => r.abort());
  // Spots now save through the server (api/save-spots.js), not a direct
  // Firestore batch, so record those calls here to tell a save happened.
  const saveSpotsCalls = [];
  await p.route('**/api/**', r => {
    if (r.request().url().includes('/api/save-spots')) {
      saveSpotsCalls.push(1);
      return r.fulfill({ json: { saved: 1, skipped: 0, removed: 0, limit: 25, plan: 'free' } });
    }
    return r.fulfill({ json: { plan: 'free', following: [], followers: [] } });
  });
  await p.route('**/api/delete-account', r => r.fulfill({ json: { deleted: true } }));
  await p.addInitScript(() => {
    window.__cloud = {};
    window.__writes = [];
    window.__loadError = true;
    window.__deferLoad = false;
    const auth = {
      currentUser: null,
      setPersistence: async () => {},
      onAuthStateChanged (fn) { window.__observer = fn; queueMicrotask(() => fn(null)); return () => {}; },
      async signOut () { this.currentUser = null; window.__observer(null); },
    };
    const db = {
      doc: path => ({
        get: async () => ({ exists: !!window.__cloud[path]?.profile, data: () => window.__cloud[path]?.profile || {} }),
        set: async () => {},
      }),
      collection: path => ({
        get: async () => {
          if (window.__loadError) throw new Error('Test offline');
          if (window.__deferLoad) {
            window.__deferLoad = false;
            return new Promise(resolve => { window.__finishLoad = list => resolve({ docs: list.map(data => ({ data: () => data })) }); });
          }
          return { docs: (window.__cloud[path] || []).map(data => ({ data: () => data })) };
        },
      }),
      batch: () => {
        const paths = [];
        return { set: doc => paths.push(doc), delete: doc => paths.push(doc), commit: async () => window.__writes.push(paths) };
      },
    };
    window.firebase = {
      initializeApp () {},
      auth: Object.assign(() => auth, { GoogleAuthProvider: class {}, Auth: { Persistence: { LOCAL: 'local' } } }),
      firestore: () => db,
    };
    window.__signIn = uid => {
      const user = { uid, email: `${uid}@example.test`, metadata: {}, providerData: [], getIdToken: async () => 'test-token' };
      auth.currentUser = user;
      window.__observer(user);
      return window._sessionTaskForTest();
    };
  });
  await p.goto(`${BASE}/app.html`);
  await p.waitForFunction(() => typeof window.__observer === 'function' && window._ftbAuthReady === true);
  await p.evaluate(() => { window._sessionTaskForTest = () => _sessionTask; });

  await p.evaluate(() => window.__signIn('accountA'));
  check(await p.evaluate(() => state.restaurants.some(r => r.id === 'guest')), 'a never-signed-in guest diary is adopted by the first account');
  check(await p.evaluate(async () => {
    const before = _authGeneration;
    window.__loadError = false;
    window.dispatchEvent(new Event('online'));
    await _sessionTask;
    return _authGeneration === before + 1 && !window._ftbSyncBlocked && window._ftbUid === 'accountA';
  }), 'reconnecting retries even when the first cloud restore never succeeded');
  await p.evaluate(() => {
    window.__photo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=';
    _saveChain = _saveChain.then(() => new Promise(resolve => { window.__releaseSave = resolve; }));
    state.restaurants.push({ id: 'privateA', name: 'Private A', photo: window.__photo, status: 'visited', tags: [], visits: [], dishes: [] });
    state.settings.collections = [{ id: 'collectionA', name: 'Private A list' }];
    state.settings.profileShareId = 'privateAId';
    state.settings.shareLive = true;
    localStorage.setItem('ftb_user_v1', JSON.stringify({ name: 'Person A', phone: '555-0100' }));
    localStorage.setItem('ftb_friends_v1', JSON.stringify([{ key: 'friendA', data: { id: 'friendAId' } }]));
    localStorage.setItem('ftb_deleted_v1', '["deletedA"]');
    localStorage.setItem('ftb_cub_chats_v1', '{"messages":["Private A chat"]}');
    saveData();
    state.settings.onboardingDone = false;
    Cub.welcome();
    state.settings.onboardingDone = true;
    document.querySelector('#cub-welcome .cw-go').click();
    document.querySelector('#cub-welcome .cw-skip').click();
    document.querySelector('#cub-welcome .cw-go').click();
    Cub.close();
    document.getElementById('profile-setup-overlay').classList.remove('hidden');
  });
  await p.evaluate(() => window.__signIn('accountB'));
  const switched = await p.evaluate(() => ({
    spots: state.restaurants.length, friends: getFriends().length, profile: loadUserProfile(),
    deleted: getDeletedRestaurantIds().length, chats: localStorage.getItem('ftb_cub_chats_v1'),
    privateSettings: !!state.settings.profileShareId || !!state.settings.collections?.length,
  }));
  check(switched.spots === 0 && switched.friends === 0 && !switched.profile && !switched.deleted && !switched.chats && !switched.privateSettings,
    `account B never adopts account A's data (${JSON.stringify(switched)})`);
  await p.waitForTimeout(250);
  check(await p.locator('#cub-welcome').isHidden() && await p.locator('#profile-setup-overlay').isHidden(),
    'custom profile dialogs and delayed welcome prompts stay closed after an account switch');
  await p.evaluate(async () => { window.__releaseSave(); await _saveChain; });
  check(await p.evaluate(() => !JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]').some(r => r.id === 'privateA')),
    'a queued photo save cannot overwrite the next account diary');
  const rollback = await p.evaluate(async () => {
    const original = Storage.prototype.setItem;
    let failed = false;
    Storage.prototype.setItem = function (key, value) {
      if (!failed && key === 'ftb_data_owner_v1' && value === 'accountA') {
        failed = true;
        throw new DOMException('Test storage full', 'QuotaExceededError');
      }
      return original.call(this, key, value);
    };
    await window.__signIn('accountA');
    Storage.prototype.setItem = original;
    return failed && window._ftbAccountSwitching && localStorage.getItem('ftb_data_owner_v1') === 'accountB'
      && !JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]').some(r => r.id === 'privateA');
  });
  check(rollback, 'a failed ownership write rolls back both the active diary and its owner');
  await p.evaluate(() => window.__signIn('accountA'));
  check(await p.evaluate(() => state.restaurants.some(r => r.id === 'privateA') && loadUserProfile()?.name === 'Person A'
    && getFriends().length === 1 && getDeletedRestaurantIds().includes('deletedA') && !!state.settings.profileShareId),
  'returning to A restores its local edits, profile, friends, settings and deletion markers');
  await p.evaluate(() => hydrateStoredPhotos());
  check(await p.evaluate(() => state.restaurants.find(r => r.id === 'privateA')?.photo === window.__photo),
    'an unsynced photo survives account switching even when its original save was queued');

  // Start an account load, then sign out before the response arrives.
  await p.evaluate(() => {
    window.__deferLoad = true;
    window.__pending = window.__signIn('accountA');
  });
  await p.waitForFunction(() => !!window.__finishLoad);
  await p.evaluate(async () => { await _auth.signOut(); await _sessionTask; });
  check(await p.evaluate(() => !window._ftbUid && !state.restaurants.length && !loadUserProfile() && !getFriends().length),
    'sign-out clears private data from memory and the active local storage');
  await p.evaluate(async () => { window.__finishLoad([{ id: 'lateA', name: 'Late private A', status: 'visited', tags: [], visits: [], dishes: [] }]); await window.__pending; });
  check(await p.evaluate(() => !state.restaurants.length && !window._ftbUid && window._ftbPlan === 'free'),
    'a delayed load cannot restore private data or entitlements after sign-out');
  check(await p.locator('.restaurant-card').count() === 0, 'no private cards remain in the signed-out UI');

  await p.evaluate(() => window.__signIn('accountA'));
  check(await p.evaluate(() => state.restaurants.some(r => r.id === 'privateA')), 'sign-out keeps the same account diary recoverable on this device');
  await p.evaluate(() => {
    window.__loadError = true;
    window.__cloud['users/accountA/meta/profile'] = { profile: { name: 'Older cloud profile', updatedAt: 1 } };
    saveUserProfile({ ...loadUserProfile(), name: 'New local profile' });
  });
  await p.evaluate(() => window.__signIn('accountA'));
  check(await p.evaluate(() => state.restaurants.some(r => r.id === 'privateA') && window._ftbSyncBlocked),
    'failed cloud loading keeps the local diary and blocks unsafe uploads');
  check(await p.locator('#backup-status').isVisible() && /could not be restored/.test(await p.locator('#backup-status').innerText()),
    'failed loading shows a visible retry action rather than claiming successful backup');
  await p.evaluate(() => { window.__loadError = false; });
  await p.click('#backup-status button');
  await p.evaluate(() => _sessionTask);
  check(await p.evaluate(() => !window._ftbSyncBlocked && window._ftbUid === 'accountA'), 'retry restores backup for the current account');
  check(await p.evaluate(() => loadUserProfile()?.name === 'New local profile'), 'retry does not replace a newer unsynced profile with an older cloud copy');
  await p.evaluate(async () => { await hydrateStoredPhotos(); });
  const beforeSaves = saveSpotsCalls.length;
  await p.evaluate(async () => { await fbSaveRestaurants(window._ftbUid, state.restaurants); });
  check(saveSpotsCalls.length - beforeSaves > 0, 'a successfully restored current account still uploads its diary');

  // Pending debounce must not write the next account's in-memory list.
  const delayed = await p.evaluate(async () => {
    let wrote = false;
    fbSaveRestaurants = async () => { wrote = true; };
    fbDebouncedSync();
    await window.__signIn('accountB');
    clearTimeout(_syncTimer); // only the old timer would indicate a leak
    await new Promise(resolve => setTimeout(resolve, 3200));
    return wrote;
  });
  check(!delayed, 'switching accounts cancels the previous account upload timer');

  await p.reload();
  await p.waitForFunction(() => typeof window.__observer === 'function' && window._ftbAuthReady === true);
  await p.evaluate(() => { window._sessionTaskForTest = () => _sessionTask; return _sessionTask; });
  const cold = await p.evaluate(() => ({ uid: window._ftbUid, spots: state.restaurants.map(r => r.id), profile: loadUserProfile(), switching: window._ftbAccountSwitching }));
  check(!cold.uid && !cold.spots.length && (!cold.profile || (cold.profile.name === 'Foodie' && !cold.profile.phone && !cold.profile.bio)),
    `a cold signed-out launch does not expose the previous account cache (${JSON.stringify(cold)})`);
  await p.evaluate(() => window.__signIn('accountA'));
  check(await p.evaluate(() => state.restaurants.some(r => r.id === 'privateA')), 'the scoped diary survives a browser reload');

  await p.evaluate(() => {
    AI.hasAccess = () => true;
    AI.chat = () => new Promise(resolve => { window.__finishReply = resolve; });
    openChat();
    window.__pendingChat = sendChat('Tell me about my food diary');
  });
  await p.waitForFunction(() => !!window.__finishReply);
  await p.evaluate(() => window.__signIn('accountB'));
  await p.evaluate(async () => { window.__finishReply('Private reply for account A'); await window.__pendingChat; });
  check(await p.evaluate(() => !_cubChatHistory.length && !document.getElementById('chat-messages').children.length
    && !localStorage.getItem('ftb_cub_chats_v1')), 'a delayed chat reply cannot populate the next account or retain the previous conversation');

  // Older sign-out removed the uid but kept an email and the diary.
  await p.evaluate(async () => {
    localStorage.removeItem('ftb_uid_v1');
    localStorage.removeItem('ftb_data_owner_v1');
    localStorage.setItem('ftb_last_account_v1', 'legacyAccountC@example.test');
    localStorage.setItem('ftb_restaurants_v2', JSON.stringify([{ id: 'legacyC', name: 'Legacy C', status: 'visited', tags: [], visits: [], dishes: [] }]));
    window._ftbDataOwner = undefined;
    await handleFirebaseUser(null);
  });
  check(await p.evaluate(() => !state.restaurants.length), 'an older signed-out diary is hidden without being deleted');
  await p.evaluate(() => window.__signIn('unrelatedAccount'));
  check(await p.evaluate(() => !state.restaurants.some(r => r.id === 'legacyC')), 'another email never adopts an older signed-out diary');
  await p.evaluate(() => window.__signIn('legacyAccountC'));
  check(await p.evaluate(() => state.restaurants.some(r => r.id === 'legacyC')), 'the matching signed-in email recovers its older local diary');
  await p.evaluate(async () => {
    _reauthForDelete = async () => {};
    document.getElementById('delete-account-local').checked = false;
    await fbDeleteAccount();
  });
  check(await p.evaluate(() => !window._ftbUid && state.restaurants.some(r => r.id === 'legacyC')
    && !loadUserProfile() && !getFriends().length && !localStorage.getItem('ftb_cub_chats_v1')),
    'explicitly keeping spots during deletion restores only a signed-out diary');
  check(await p.evaluate(async () => {
    let request;
    await photoDbOp('readonly', store => { request = store.get('legacyAccountC'); return request; }, 'accounts');
    return request.result === undefined;
  }), 'the deleted account snapshot is removed after the kept diary is restored');
  await p.evaluate(() => window.__signIn('keptDiaryAccount'));
  check(await p.evaluate(() => state.restaurants.some(r => r.id === 'legacyC') && !loadUserProfile()),
    'an explicitly kept signed-out diary can be adopted without the deleted identity');
  await p.evaluate(async () => {
    document.getElementById('delete-account-local').checked = true;
    await fbDeleteAccount();
  });
  check(await p.evaluate(async () => !window._ftbUid && !state.restaurants.length
    && !Object.keys(localStorage).some(k => k.startsWith('ftb_'))
    && !(await indexedDB.databases()).some(db => db.name === PHOTO_DB)),
    'device erasure waits for sign-out and removes the account/photo database without a late snapshot recreating it');
  await browser.close();
  finish('session-isolation');
})();
