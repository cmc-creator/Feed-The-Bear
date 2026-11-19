/* ============================================================
   NyxSurvive V1 - offline-first tactical survival management
   All data lives on-device in localStorage:
     nyxsurvive-v1     -> app state (gear, stores, comms, crew, lists)
     nyxsurvive-vault  -> encrypted vault blob (ciphertext only)
   No external libraries. No network calls.
   ============================================================ */

(function () {
  "use strict";

  /* ---------------- helpers ---------------- */
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function uid() { return "id" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
  function fmt(n, digits) {
    var d = (digits == null ? 1 : digits);
    return Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  function showMsg(el, text, kind) {
    if (!el) return;
    el.textContent = text || "";
    el.className = "nx-msg" + (text ? " nx-show" : "") + (kind === "err" ? " nx-err" : kind === "good" ? " nx-good" : "");
  }

  /* ---------------- constants ---------------- */
  var STATE_KEY = "nyxsurvive-v1";
  // Set by loadState when this device already held a save before
  // this boot - the welcome screen's "genuine first run" test.
  var bootHadSave = false;
  var VAULT_KEY = "nyxsurvive-vault";
  var CATEGORIES = ["Water", "Food", "Shelter", "Fire", "Medical", "Comms", "Tools", "Clothing", "Defense", "Other"];
  var TIERS = { T1: "T1 - On Body", T2: "T2 - Bug-Out Bag", T3: "T3 - Cache / Home" };
  var ENV_TAGS = ["Desert", "Cold", "Wet", "Urban"];
  var STORE_KINDS = ["Water", "Food", "Meds", "Batteries"];
  var WATER_GOAL_GAL = 14;   // dashboard reference: 2 people x 7 days at 1 gal/day
  var CORE_GOAL_LB = 25;     // dashboard reference for on-body weight blocks

  /* ---------------- platform (iOS App Store rule) ----------------
     Inside the iPhone wrapper nothing may be sold, and nothing
     may point out of the app to a sale (Guideline 3.1.1) - the
     tier is sold on the website only, and Apple requires its own
     in-app purchase for anything sold in-app. So on iOS every
     buy surface hides (the .nx-buy-ui CSS rule), checkout entry
     points refuse with a neutral message, and members who
     already hold Operator keep full use of it after sign-in -
     only the selling is gone. Android keeps its approved route
     out to the website pricing and the web keeps its checkout;
     both are untouched by this. Mirrors the Munchling setup. */
  var CAP_PLATFORM = "web";
  try {
    if (window.Capacitor && window.Capacitor.getPlatform) CAP_PLATFORM = window.Capacitor.getPlatform() || "web";
  } catch (e) {}
  var IS_IOS_APP = CAP_PLATFORM === "ios";
  if (IS_IOS_APP) document.documentElement.classList.add("ios-app");

  /* ---------------- plan gating (Phase 2 scaffolding) ----------------
     Pricing is locked: Free $0; Operator $6.99/mo or $49.99/yr;
     Lifetime $149 one-time (Founding Operator launch $99.99).
     Free keeps Days Ready, 1 loadout, rotation, the vault, compass,
     checklists and alerts fully working. Operator removes every cap
     and unlocks ICS, broadcasts, the need calculators and GO-Book.
     The plan record is server-authoritative (see api/): since
     Phase 3A, state.plan is the local cache of the tier the server
     last proved for the signed-in account, refreshed at sign-in
     by the accounts module below. Offline, the cached tier stands
     (see refreshPlanStatus). The localhost test hook at the bottom
     can also move it, on localhost only. */
  var PLAN_CAPS = { crew: 4, vault: 10, gear: 60 };
  // Intel (saved social posts) has its own free cap: 10 cards.
  // Kept out of PLAN_CAPS, whose shape the Phase 2 suite pins.
  var INTEL_FREE_CAP = 10;
  // Paid add-ons (money build D): one-time purchases that live
  // BESIDE the plan tier, never inside it - Operator does not
  // include them. The entitlement is server-owned exactly like
  // the plan: the user doc carries an addons array the server
  // alone writes (api/webhook.js), /api/subscription-status
  // reports it, and state.addons is only this device's cache of
  // the last proven list (see refreshPlanStatus). The owner
  // unlock implies every add-on, derived at check time.
  var KNOWN_ADDONS = ["qr-sync"];
  /* Money build E: the Offline Map Packs live beside qr-sync
   * in the same server-owned addons array - "map-pack-us" for
   * the all-50 bundle and "map-pack-<code>" per state. The
   * client mirror of the server's isKnownAddon (api/_admin.js)
   * validates the same way: fixed ids, or the pattern with the
   * code checked against the 50-state list, so a forged id in
   * a synced save is dropped, never honored. */
  var MAP_STATE_CODES = [
    "al", "ak", "az", "ar", "ca", "co", "ct", "de", "fl", "ga",
    "hi", "id", "il", "in", "ia", "ks", "ky", "la", "me", "md",
    "ma", "mi", "mn", "ms", "mo", "mt", "ne", "nv", "nh", "nj",
    "nm", "ny", "nc", "nd", "oh", "ok", "or", "pa", "ri", "sc",
    "sd", "tn", "tx", "ut", "vt", "va", "wa", "wv", "wi", "wy"
  ];
  var MAP_STATES = [
    ["al", "Alabama"], ["ak", "Alaska"], ["az", "Arizona"], ["ar", "Arkansas"],
    ["ca", "California"], ["co", "Colorado"], ["ct", "Connecticut"], ["de", "Delaware"],
    ["fl", "Florida"], ["ga", "Georgia"], ["hi", "Hawaii"], ["id", "Idaho"],
    ["il", "Illinois"], ["in", "Indiana"], ["ia", "Iowa"], ["ks", "Kansas"],
    ["ky", "Kentucky"], ["la", "Louisiana"], ["me", "Maine"], ["md", "Maryland"],
    ["ma", "Massachusetts"], ["mi", "Michigan"], ["mn", "Minnesota"], ["ms", "Mississippi"],
    ["mo", "Missouri"], ["mt", "Montana"], ["ne", "Nebraska"], ["nv", "Nevada"],
    ["nh", "New Hampshire"], ["nj", "New Jersey"], ["nm", "New Mexico"], ["ny", "New York"],
    ["nc", "North Carolina"], ["nd", "North Dakota"], ["oh", "Ohio"], ["ok", "Oklahoma"],
    ["or", "Oregon"], ["pa", "Pennsylvania"], ["ri", "Rhode Island"], ["sc", "South Carolina"],
    ["sd", "South Dakota"], ["tn", "Tennessee"], ["tx", "Texas"], ["ut", "Utah"],
    ["vt", "Vermont"], ["va", "Virginia"], ["wa", "Washington"], ["wv", "West Virginia"],
    ["wi", "Wisconsin"], ["wy", "Wyoming"]
  ];
  function isKnownAddonId(id) {
    if (typeof id !== "string") return false;
    if (KNOWN_ADDONS.indexOf(id) !== -1) return true;
    if (id === "map-pack-us") return true;
    var m = /^map-pack-([a-z]{2})$/.exec(id);
    return !!m && MAP_STATE_CODES.indexOf(m[1]) !== -1;
  }
  // Map-pack entitlement (money build E): the owner derivation
  // inside hasAddon covers the owner; the bundle implies every
  // state; a state grant opens only its own state.
  function hasMapPack(code) {
    return hasAddon("map-pack-us") || hasAddon("map-pack-" + code);
  }
  // Owner list mirrors Munchling's api/_admin.js OWNER_EMAILS.
  var OWNER_EMAILS = [
    'icequeen42426@gmail.com',
    'cmc@conniemichelleconsulting.com',
    'nyxcollectivellc@gmail.com',
    'info@nyxcollectivellc.com',
    'conniemconsulting@outlook.com',
    'conniemcooper@hotmail.com'
  ];
  // AUTH_USER is fed by the accounts module (Phase 3A) from
  // Firebase Auth's onAuthStateChanged: { email, emailVerified }
  // for the signed-in user, or null when signed out / local-only.
  // isOwner() / isOperator() read it at check time - ownership is
  // derived, never stored in the save.
  var AUTH_USER = null;
  function isOwnerEmail(email, emailVerified) {
    // Ownership rides on the Firebase-authenticated email alone.
    // Firebase issues the session only to whoever holds the
    // account credentials and enforces one account per email, so
    // the signed-in email IS the proof of ownership. The
    // emailVerified parameter is accepted (and ignored) so the
    // call sites keep their shape: a verification email goes out
    // at sign-up for hygiene, but an owner who never clicks it
    // must not be locked out of their own app.
    return !!email &&
      OWNER_EMAILS.indexOf(String(email).toLowerCase()) !== -1;
  }
  function isOwner() {
    return !!AUTH_USER && isOwnerEmail(AUTH_USER.email, AUTH_USER.emailVerified);
  }
  /* Email verification gate (2026-11-17, Connie's call after a
   * user signed up with a typo'd address - gmail.con - and the
   * account worked anyway): a signed-in account whose email is
   * not verified gets NO account features - no cloud sync, no
   * plan refresh, no checkout - until the address owner clicks
   * the verification link Firebase emailed at sign-up. The app
   * itself keeps working locally; accounts are never a hard
   * gate on the survival tools. Google sign-ins arrive with
   * their address verified by Google, and owner accounts are
   * exempt so the owner can never be locked out of her own app. */
  function emailGateApplies() {
    if (!authUser || !AUTH_USER) return false;
    if (isOwner()) return false;
    return AUTH_USER.emailVerified !== true;
  }
  function planTier() {
    var p = state.plan;
    return (p === "operator" || p === "lifetime") ? p : "free";
  }
  function isOperator() { return isOwner() || planTier() !== "free"; }
  function sanitizeAddons(a) {
    if (!Array.isArray(a)) return [];
    var out = [];
    a.forEach(function (x) {
      if (isKnownAddonId(x) && out.indexOf(x) === -1) out.push(x);
    });
    return out;
  }
  function hasAddon(id) {
    if (isOwner()) return true; // owner unlock covers every add-on
    return Array.isArray(state.addons) && state.addons.indexOf(id) !== -1;
  }
  function capBlocked(kind) {
    if (isOperator()) return false;
    if (kind === "crew") return state.crew.length >= PLAN_CAPS.crew;
    if (kind === "gear") return state.gear.length >= PLAN_CAPS.gear;
    if (kind === "vault") return Vault.entries.length >= PLAN_CAPS.vault;
    if (kind === "intel") return state.intel.length >= INTEL_FREE_CAP;
    return false;
  }
  function upsellHtml(feature) {
    return "<div class=\"nx-upsell\">" +
      "<p class=\"nx-upsell-tag\">OPERATOR TIER</p>" +
      "<h3 class=\"nx-upsell-title\">" + esc(feature) + " IS AN OPERATOR FEATURE</h3>" +
      "<p class=\"nx-upsell-body\">Free covers Days Ready, one loadout, rotation, the vault, compass, checklists and alerts - no caps on any of those. Operator removes every cap and unlocks Incident Command, broadcasts, the need calculators and the GO-Book.</p>" +
      "<p class=\"nx-upsell-prices nx-buy-ui\">OPERATOR $6.99/MO - $49.99/YR // LIFETIME $149 ONE TIME // FOUNDING OPERATOR $99.99</p>" +
      "<button type=\"button\" class=\"nx-btn nx-btn-accent nx-go-operator nx-buy-ui\">GO OPERATOR</button>" +
      "<p class=\"nx-h-note nx-ios-note\">OPERATOR MEMBERS: SIGN IN AND YOUR TIER WORKS HERE AUTOMATICALLY.</p>" +
      "</div>";
  }

  var CHECKLISTS = [
    { id: "kit72", title: "72-Hour Kit", items: [
      "Water - 1 gal per person per day, 3 days",
      "3 days of shelf-stable food",
      "First aid kit checked and stocked",
      "Flashlight plus spare batteries",
      "Phone charger and power bank",
      "Cash in small bills",
      "Copies of ID and insurance cards",
      "Medications - 3 day supply",
      "Warm layer and rain gear",
      "Local paper map of the area"
    ]},
    { id: "bugout", title: "Bug Out", items: [
      "Bug-out bag packed and staged by the door",
      "Vehicle fueled / go-route planned",
      "Primary rally point sealed in the vault",
      "Pet carrier, food and leash ready",
      "Important documents noted in the vault",
      "Comms check-in plan shared with crew",
      "Water filter packed in the bag",
      "Shelter and sleep system complete",
      "Fire kit packed and tested",
      "Personal safety items per local law"
    ]},
    { id: "shelter", title: "Shelter In Place", items: [
      "Two weeks of water stored",
      "Two weeks of shelf-stable food",
      "Backup heat source and fuel",
      "Backup lighting for every room",
      "Battery or solar radio",
      "CO detector batteries checked",
      "Sanitation supplies stocked",
      "Trash bags and sanitation plan",
      "Neighbor check-in plan",
      "Board games / morale kit for long waits"
    ]}
  ];

  /* Kit locations (Ready.gov build): every gear item and store
     carries one tag - where that kit lives. Home is the default
     and the migration target for anything saved before the tag
     existed. The Gear view filters on it; stores just wear the
     label. */
  var KIT_LOCS = ["Home", "Car", "Work", "Go-Bag"];
  function kitLoc(v) { return KIT_LOCS.indexOf(v) >= 0 ? v : "Home"; }

  /* ---------------- weight + date utils ---------------- */
  function toLb(value, unit) {
    var v = Number(value) || 0;
    switch (unit) {
      case "oz": return v / 16;
      case "g": return v / 453.59237;
      case "kg": return v * 2.2046226;
      default: return v; // lb
    }
  }
  function itemWeightLb(item) { return toLb(item.weightValue, item.weightUnit) * (Number(item.qty) || 1); }

  function parseDateLocal(str) {
    if (!str) return null;
    var p = String(str).split("-");
    if (p.length !== 3) return null;
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    return isNaN(d.getTime()) ? null : d;
  }
  function todayStart() { var d = new Date(); d.setHours(0, 0, 0, 0); return d; }
  function daysLeft(str) {
    var d = parseDateLocal(str);
    if (!d) return null;
    return Math.round((d.getTime() - todayStart().getTime()) / 86400000);
  }
  function datePlusMonthsStr(months) {
    var d = todayStart();
    d.setMonth(d.getMonth() + months);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function rotatedDateStr(currentStr) {
    var cur = parseDateLocal(currentStr);
    var base = (cur && cur.getTime() > todayStart().getTime()) ? cur : todayStart();
    base.setMonth(base.getMonth() + 6);
    return base.getFullYear() + "-" + String(base.getMonth() + 1).padStart(2, "0") + "-" + String(base.getDate()).padStart(2, "0");
  }

  /* ---------------- state ---------------- */
  function emptyState() {
    return {
      version: 1, gear: [], stores: [], buyLater: [], comms: [], crew: [], checklists: {},
      settings: { homeLat: 33.4484, homeLng: -112.0740, callsign: "", effects: true, theme: "command", sounds: true, dashDisplay: "level" },
      outbox: [],
      icsRoles: {},
      incident: null,
      pastIncidents: [],
      drillBest: null,  // { seconds, grade, at } - best completed evac drill
      sitrepLog: [],    // weekly readiness snapshots: [{ date, daysReady, waterDays, foodDays }] - last 8, one per 7 days (money build B)
      lastExpirySeen: [], // store ids that were DUE SOON / OVERDUE at the last boot check - drives the one-shot rotation notification
      assessment: null, // readiness check-in answers (sanitizeAssessment shape); null until first run
      firstOrders: [],  // generated action list from the check-in: [{ text, done, shopKey }] - rendered in Lists, outside checklistStats
      resupplyTarget: 14, // days the Resupply panel in Lists plans against (7/14/30/60/90)
      tourDone: false,  // guided walkthrough finished or skipped - once true it never auto-starts again
      welcomeSeen: false, // welcome screen dismissed (any button) or a sign-in landed - once true it never auto-shows again
      intel: [],        // saved social posts: { id, url, host, title, summary, items: [{ kind, name, detail, converted }], addedAt }
      intelTasks: [],   // task strings converted from intel cards - the "Intel" checklist in Lists
      plan: "free",
      addons: [],       // server-proven add-on ids (["qr-sync"]) - cache only; the server record rules (money build D)
      advisorLog: [],   // tactical advisor chat: [{ role: "user" | "advisor", text }] - last 40 (AI build)
      aiUse: { day: "", ask: 0, photo: 0 }, // free-tier AI day counters, keyed by local day (AI build)
      meds: [],         // per-person medication log (Ready.gov build): [{ id, person, name, dose, supplyDays, refillBy, expiry }]
      familyPlan: { outName: "", outPhone: "", rally2: "" }, // out-of-town contact + secondary meeting place, names only (Ready.gov build)
      homeSystems: { water: "", gas: "", electric: "", propane: "" }, // shutoff location notes for this house (Ready.gov build)
      cash: [],         // cash on hand (Ready.gov build): [{ id, amount, where }] - display only, never in Days Ready math
      _savedAt: 0,      // ms timestamp of the last local save (sync recency)
      ownerUid: null    // Firebase uid that owns this save, once claimed
    };
  }

  /* The app ships EMPTY - no starter seed, no sample loadout. The
     first-run experience is the readiness check-in (further down):
     the user's own answers become their crew, stores and first
     orders. blankState is the factory for a fresh start and for
     the Settings reset; existing users' saved data is never
     touched by this change - only first-run behavior differs. */
  function blankState() {
    var s = emptyState();
    s.assessment = defaultAssessment();
    s.firstOrders = [];
    return s;
  }

  function defaultAssessment() {
    return {
      done: false,
      adults: 1, children: 0, pets: 0,
      climate: "",   // Desert | Cold | Wet | Urban
      water: "",     // none | g3 | g10 | g25 | g55 (gallons)
      food: "",      // none | few | week | twoWeeks | month (days)
      cook: null,    // true | false | null (unanswered)
      medical: "",   // trauma | basic | none
      gobag: "",     // packed | partial | none
      comms: "",     // radios | phones | neither
      concern: ""    // Power outage | Storms | Earthquake | Wildfire | Unrest | All of them
    };
  }

  /* Runs inside normalizeState, which loadState() calls before the
     check-in module's lookup tables exist - literals only here,
     never the CHECKIN_* vars. */
  function sanitizeAssessment(a) {
    var d = defaultAssessment();
    if (!a || typeof a !== "object") return d;
    function num(v, lo, hi, fb) { v = Math.round(Number(v)); return isNaN(v) ? fb : clamp(v, lo, hi); }
    function pick(v, list, fb) { return list.indexOf(v) >= 0 ? v : fb; }
    return {
      done: a.done === true,
      adults: num(a.adults, 0, 30, 1),
      children: num(a.children, 0, 30, 0),
      pets: num(a.pets, 0, 30, 0),
      climate: pick(a.climate, ["Desert", "Cold", "Wet", "Urban"], ""),
      water: pick(a.water, ["none", "g3", "g10", "g25", "g55"], ""),
      food: pick(a.food, ["none", "few", "week", "twoWeeks", "month"], ""),
      cook: a.cook === true ? true : (a.cook === false ? false : null),
      medical: pick(a.medical, ["trauma", "basic", "none"], ""),
      gobag: pick(a.gobag, ["packed", "partial", "none"], ""),
      comms: pick(a.comms, ["radios", "phones", "neither"], ""),
      concern: pick(a.concern, ["Power outage", "Storms", "Earthquake", "Wildfire", "Unrest", "All of them"], "")
    };
  }

  var state = loadState();

  // Intel cards are ordinary app data (never vault material):
  // keep only well-formed cards, with well-formed items, so a
  // hand-edited or half-migrated save can never break the board.
  function sanitizeIntel(list) {
    if (!Array.isArray(list)) return [];
    return list.filter(function (c) { return c && typeof c === "object" && typeof c.url === "string" && /^https?:\/\//i.test(c.url); })
      .map(function (c) {
        return {
          id: typeof c.id === "string" && c.id ? c.id : uid(),
          url: c.url.slice(0, 2000),
          host: typeof c.host === "string" ? c.host.slice(0, 120) : "",
          title: typeof c.title === "string" ? c.title.slice(0, 200) : "",
          summary: typeof c.summary === "string" ? c.summary.slice(0, 1200) : "",
          degraded: c.degraded === true,
          items: (Array.isArray(c.items) ? c.items : []).filter(function (it) { return it && typeof it.name === "string" && it.name; })
            .map(function (it) {
              var kind = String(it.kind || "").toLowerCase();
              if (kind !== "gear" && kind !== "supply" && kind !== "task") kind = "gear";
              return {
                kind: kind,
                name: it.name.slice(0, 120),
                detail: typeof it.detail === "string" ? it.detail.slice(0, 200) : "",
                converted: it.converted === true
              };
            }).slice(0, 24),
          addedAt: typeof c.addedAt === "number" ? c.addedAt : 0
        };
      }).slice(0, 500);
  }

  // Weekly SITREP snapshots (money build B). An entry is kept
  // only when its date parses as a local date and every reading
  // is null or a finite number - daysReady() legitimately returns
  // null components (no water stores yet is a real state, not
  // corruption), while strings / NaN / objects are garbage from a
  // hand-edited save and the entry is dropped. Last 8 win.
  function sanitizeSitrepLog(list) {
    if (!Array.isArray(list)) return [];
    function numOrNull(v) { return typeof v === "number" && isFinite(v) ? v : null; }
    return list.filter(function (e) {
      if (!e || typeof e !== "object") return false;
      if (typeof e.date !== "string" || !parseDateLocal(e.date)) return false;
      return [e.daysReady, e.waterDays, e.foodDays].every(function (v) {
        return v === null || (typeof v === "number" && isFinite(v));
      });
    }).map(function (e) {
      return { date: e.date, daysReady: numOrNull(e.daysReady), waterDays: numOrNull(e.waterDays), foodDays: numOrNull(e.foodDays) };
    }).slice(-8);
  }

  // Tactical advisor chat (AI build): only well-formed turns
  // survive, capped at the last 40, so a hand-edited save can
  // never break the panel. The log is ordinary app data - it
  // syncs like everything else and never touches the vault.
  function sanitizeAdvisorLog(list) {
    if (!Array.isArray(list)) return [];
    return list.filter(function (m) {
      return m && typeof m === "object" && (m.role === "user" || m.role === "advisor") &&
        typeof m.text === "string" && m.text;
    }).map(function (m) { return { role: m.role, text: m.text.slice(0, 4000) }; }).slice(-40);
  }

  // Free-tier AI day counters (AI build): a local day string
  // plus two bounded counts. A stale day is kept as-is here -
  // aiUseToday() treats any day that is not today as zero.
  function sanitizeAiUse(u) {
    function count(v) { var n = Math.round(Number(v)); return isFinite(n) ? clamp(n, 0, 9999) : 0; }
    if (!u || typeof u !== "object") return { day: "", ask: 0, photo: 0 };
    return {
      day: typeof u.day === "string" ? u.day.slice(0, 10) : "",
      ask: count(u.ask), photo: count(u.photo)
    };
  }

  // Ready.gov build sanitizers. Meds: only well-formed entries
  // survive - a name is required, dates must parse as local
  // dates or become null, supply is a bounded day count. The
  // family plan and home systems are plain bounded strings.
  // Cash: positive amounts only, rounded to cents.
  function sanitizeDateOrNull(v) {
    return typeof v === "string" && parseDateLocal(v) ? v : null;
  }
  function sanitizeMeds(list) {
    if (!Array.isArray(list)) return [];
    return list.filter(function (m) { return m && typeof m === "object" && typeof m.name === "string" && m.name; })
      .map(function (m) {
        var sup = Math.round(Number(m.supplyDays));
        return {
          id: typeof m.id === "string" && m.id ? m.id : uid(),
          person: typeof m.person === "string" ? m.person.slice(0, 60) : "",
          name: m.name.slice(0, 80),
          dose: typeof m.dose === "string" ? m.dose.slice(0, 80) : "",
          supplyDays: isFinite(sup) ? clamp(sup, 0, 3650) : 0,
          refillBy: sanitizeDateOrNull(m.refillBy),
          expiry: sanitizeDateOrNull(m.expiry)
        };
      }).slice(0, 200);
  }
  function sanitizeFamilyPlan(p) {
    function str(v, n) { return typeof v === "string" ? v.slice(0, n) : ""; }
    if (!p || typeof p !== "object") return { outName: "", outPhone: "", rally2: "" };
    return { outName: str(p.outName, 80), outPhone: str(p.outPhone, 40), rally2: str(p.rally2, 120) };
  }
  function sanitizeHomeSystems(hs) {
    function str(v) { return typeof v === "string" ? v.slice(0, 240) : ""; }
    if (!hs || typeof hs !== "object") return { water: "", gas: "", electric: "", propane: "" };
    return { water: str(hs.water), gas: str(hs.gas), electric: str(hs.electric), propane: str(hs.propane) };
  }
  function sanitizeCash(list) {
    if (!Array.isArray(list)) return [];
    return list.filter(function (c) { return c && typeof c === "object" && isFinite(Number(c.amount)) && Number(c.amount) > 0; })
      .map(function (c) {
        return {
          id: typeof c.id === "string" && c.id ? c.id : uid(),
          amount: Math.round(Number(c.amount) * 100) / 100,
          where: typeof c.where === "string" ? c.where.slice(0, 80) : ""
        };
      }).slice(0, 100);
  }

  // Shared shape check + default fill, used for the localStorage
  // save AND for a state arriving from the cloud doc, so both paths
  // accept exactly the same documents. Returns null when the value
  // is not a NyxSurvive state at all.
  function normalizeState(parsed) {
    if (!parsed || !Array.isArray(parsed.gear)) return null;
    parsed.stores = Array.isArray(parsed.stores) ? parsed.stores : [];
    parsed.comms = Array.isArray(parsed.comms) ? parsed.comms : [];
    parsed.crew = Array.isArray(parsed.crew) ? parsed.crew : [];
    parsed.checklists = parsed.checklists || {};
    if (!parsed.settings) parsed.settings = { homeLat: 33.4484, homeLng: -112.0740, callsign: "" };
    if (typeof parsed.settings.homeLat !== "number") parsed.settings.homeLat = 33.4484;
    if (typeof parsed.settings.homeLng !== "number") parsed.settings.homeLng = -112.0740;
    if (typeof parsed.settings.effects !== "boolean") parsed.settings.effects = true;
    if (["command", "nightvision", "desert", "whiteout", "blackout", "brassworks", "neonglass", "fullmetal", "woodland", "bunker", "schematic"].indexOf(parsed.settings.theme) === -1) parsed.settings.theme = "command";
    if (typeof parsed.settings.sounds !== "boolean") parsed.settings.sounds = true;
    if (["level", "days", "both"].indexOf(parsed.settings.dashDisplay) === -1) parsed.settings.dashDisplay = "level";
    if (!Array.isArray(parsed.outbox)) parsed.outbox = [];
    parsed.buyLater = Array.isArray(parsed.buyLater)
      ? parsed.buyLater.filter(function (b) { return b && typeof b.url === "string" && /^https:\/\//i.test(b.url); }).map(function (b) {
          return {
            id: typeof b.id === "string" && b.id ? b.id : uid(),
            title: String(b.title || "Amazon item").slice(0, 120),
            url: b.url.slice(0, 2000),
            asin: typeof b.asin === "string" ? b.asin.slice(0, 10) : "",
            added: typeof b.added === "string" ? b.added : "",
            got: !!b.got
          };
        }).slice(0, 200)
      : [];
    if (!parsed.icsRoles || typeof parsed.icsRoles !== "object") parsed.icsRoles = {};
    if (parsed.incident === undefined) parsed.incident = null;
    if (!Array.isArray(parsed.pastIncidents)) parsed.pastIncidents = [];
    if (!parsed.drillBest || typeof parsed.drillBest !== "object" || typeof parsed.drillBest.seconds !== "number") parsed.drillBest = null;
    parsed.intel = sanitizeIntel(parsed.intel);
    parsed.intelTasks = Array.isArray(parsed.intelTasks)
      ? parsed.intelTasks.filter(function (t) { return typeof t === "string" && t; }).map(function (t) { return t.slice(0, 300); })
      : [];
    parsed.assessment = sanitizeAssessment(parsed.assessment);
    parsed.firstOrders = Array.isArray(parsed.firstOrders)
      ? parsed.firstOrders.filter(function (o) { return o && typeof o.text === "string" && o.text; })
          .map(function (o) {
            return {
              text: o.text.slice(0, 300), done: o.done === true,
              shopKey: typeof o.shopKey === "string" && o.shopKey ? o.shopKey.slice(0, 40) : null
            };
          }).slice(0, 8)
      : [];
    parsed.resupplyTarget = [7, 14, 30, 60, 90].indexOf(Number(parsed.resupplyTarget)) >= 0 ? Number(parsed.resupplyTarget) : 14;
    parsed.tourDone = parsed.tourDone === true;
    parsed.welcomeSeen = parsed.welcomeSeen === true;
    parsed.sitrepLog = sanitizeSitrepLog(parsed.sitrepLog);
    parsed.lastExpirySeen = Array.isArray(parsed.lastExpirySeen)
      ? parsed.lastExpirySeen.filter(function (x) { return typeof x === "string" && x; }).slice(0, 500)
      : [];
    if (parsed.plan !== "operator" && parsed.plan !== "lifetime") parsed.plan = "free";
    parsed.addons = sanitizeAddons(parsed.addons);
    parsed.advisorLog = sanitizeAdvisorLog(parsed.advisorLog);
    parsed.aiUse = sanitizeAiUse(parsed.aiUse);
    parsed.meds = sanitizeMeds(parsed.meds);
    parsed.familyPlan = sanitizeFamilyPlan(parsed.familyPlan);
    parsed.homeSystems = sanitizeHomeSystems(parsed.homeSystems);
    parsed.cash = sanitizeCash(parsed.cash);
    // Kit location migration: anything saved before the tag
    // existed lands on Home, for gear and stores alike.
    parsed.gear = parsed.gear.map(function (g) { if (g && typeof g === "object") g.loc = kitLoc(g.loc); return g; });
    parsed.stores = parsed.stores.map(function (s) { if (s && typeof s === "object") s.loc = kitLoc(s.loc); return s; });
    if (typeof parsed._savedAt !== "number") parsed._savedAt = 0;
    if (typeof parsed.ownerUid !== "string") parsed.ownerUid = null;
    return parsed;
  }

  function loadState() {
    try {
      var raw = localStorage.getItem(STATE_KEY);
      if (!raw) {
        var fresh = blankState();
        localStorage.setItem(STATE_KEY, JSON.stringify(fresh));
        return fresh;
      }
      var loaded = normalizeState(JSON.parse(raw));
      if (loaded) bootHadSave = true;
      return loaded || blankState();
    } catch (e) {
      return blankState();
    }
  }
  // Write the state exactly as it stands (no timestamp bump) - used
  // when a cloud copy is applied, so loading it does not make this
  // device look "newer" than the copy it just took.
  function persistLocal() {
    try { localStorage.setItem(STATE_KEY, JSON.stringify(state)); } catch (e) { /* storage full/blocked */ }
  }
  function saveState() {
    state._savedAt = Date.now();
    persistLocal();
    scheduleCloudSync();
  }

  /* ---------------- derived data ---------------- */
  function tierWeight(tier) {
    return state.gear.filter(function (g) { return g.tier === tier; })
      .reduce(function (sum, g) { return sum + itemWeightLb(g); }, 0);
  }
  function totalWeight() {
    return state.gear.reduce(function (sum, g) { return sum + itemWeightLb(g); }, 0);
  }
  function storeGallons(s) {
    var u = String(s.unit || "").toLowerCase();
    if (u === "gal" || u === "gallon" || u === "gallons") return Number(s.amount) || 0;
    if (u === "l" || u === "liter" || u === "liters" || u === "litre" || u === "litres") return (Number(s.amount) || 0) / 3.78541;
    return 0;
  }
  function waterGallons() {
    return state.stores.filter(function (s) { return s.kind === "Water"; })
      .reduce(function (sum, s) { return sum + storeGallons(s); }, 0);
  }
  function checklistStats() {
    var done = 0, total = 0;
    CHECKLISTS.forEach(function (list) {
      var saved = state.checklists[list.id] || {};
      list.items.forEach(function (_, i) { total++; if (saved[i]) done++; });
    });
    return { done: done, total: total, pct: total ? Math.round((done / total) * 100) : 0 };
  }
  function allExpiries() {
    var rows = [];
    state.gear.forEach(function (g) {
      if (g.expiry) rows.push({ kind: "gear", refId: g.id, name: g.name, source: "GEAR // " + g.category.toUpperCase(), expiry: g.expiry });
    });
    state.stores.forEach(function (s) {
      if (s.expiry) rows.push({ kind: "store", refId: s.id, name: s.name, source: "STORE // " + s.kind.toUpperCase(), expiry: s.expiry });
    });
    rows.forEach(function (r) { r.days = daysLeft(r.expiry); });
    rows.sort(function (a, b) { return (a.days == null ? 99999 : a.days) - (b.days == null ? 99999 : b.days); });
    return rows;
  }
  function expiryState(days) {
    if (days == null) return { label: "NO DATE", cls: "nx-badge-ok" };
    if (days < 0) return { label: "OVERDUE", cls: "nx-badge-over" };
    if (days <= 30) return { label: "DUE SOON", cls: "nx-badge-soon" };
    return { label: "OK", cls: "nx-badge-ok" };
  }
  /* Money build B shares ONE expiry computation across the
     rotation tracker, the Expiry Radar, the Command Expiry Watch
     and the Weekly Sitrep: allExpiries() above (daysLeft math +
     soonest-first sort). storeExpiries() is that same list cut
     to stores, with the store kind riding along. */
  function storeExpiries() {
    return allExpiries().filter(function (r) { return r.kind === "store"; }).map(function (r) {
      var s = state.stores.filter(function (x) { return x.id === r.refId; })[0];
      return { kind: "store", refId: r.refId, id: r.refId, name: r.name, source: r.source,
        storeKind: s ? s.kind : "", expiry: r.expiry, days: r.days };
    });
  }
  function daysLeftText(days) {
    if (days == null) return "NO DATE";
    if (days < 0) return "OVERDUE BY " + Math.abs(days) + " DAY" + (Math.abs(days) === 1 ? "" : "S");
    if (days === 0) return "DUE TODAY";
    return "IN " + days + " DAY" + (days === 1 ? "" : "S");
  }
  // Radar palette: red at a week or less (or overdue), amber
  // inside the 30-day DUE SOON window, green beyond it.
  function radarDaysClass(days) {
    if (days == null) return "nx-radar-warn";
    if (days < 0 || days <= 7) return "nx-radar-alert";
    if (days <= 30) return "nx-radar-warn";
    return "nx-radar-ok";
  }
  function todayKeyLocal() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function crewName(id) {
    if (!id) return "UNASSIGNED";
    var m = state.crew.filter(function (c) { return c.id === id; })[0];
    return m ? m.name.toUpperCase() : "UNASSIGNED";
  }
  function segHtml(pct, plain) {
    var on = Math.round(clamp(pct, 0, 100) / 10);
    var out = "";
    for (var i = 0; i < 10; i++) out += "<i class=\"" + (i < on ? "nx-on" + (plain ? " nx-plain" : "") : "") + "\"></i>";
    return out;
  }

  /* ---------------- schematic art ----------------
     One consistent icon set in the equipment-manual line style:
     stroke-only inline SVG in currentColor, so the CSS paints
     them from the theme variables and all five themes recolor
     the same drawings. No raster, no external assets, no text
     inside the drawings. Big set on a 48 grid (illustrations),
     small set on a 24 grid (row / area markers). Purely
     presentational - nothing here touches data, flow or copy. */
  function nxSvg(viewBox, sw, paths, cls) {
    return "<svg class=\"" + cls + "\" viewBox=\"" + viewBox + "\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"" + sw +
      "\" stroke-linecap=\"square\" stroke-linejoin=\"miter\" aria-hidden=\"true\" focusable=\"false\">" + paths + "</svg>";
  }
  var ART_BIG = {
    household: "<circle cx=\"12\" cy=\"11\" r=\"4\"/><circle cx=\"25\" cy=\"11\" r=\"4\"/><circle cx=\"37\" cy=\"17.5\" r=\"3.2\"/>" +
      "<path d=\"M12 15v15M12 30l-5 12M12 30l5 12M5 21h14M25 15v15M25 30l-5 12M25 30l5 12M18 21h14M37 21v11M37 32l-4 10M37 32l4 10M31.5 25.5h11M3 44h42\"/>",
    climate: "<circle cx=\"34\" cy=\"12\" r=\"4.6\"/>" +
      "<path d=\"M34 3.5v2.6M34 17.9v2.6M25.5 12h2.6M39.9 12h2.6M28 6l1.8 1.8M40 6l-1.8 1.8M4 9h10M6 14h7M10 34h24a6 6 0 0 0-1.2-11.9A10 10 0 0 0 15.5 20 8.5 8.5 0 0 0 10 34Z M4 40h40M9 44h30\"/>",
    water: "<path d=\"M15 9h18v31H15Z M20 9V5h8v4 M15 17l18 18M33 17L15 35\"/>",
    food: "<path d=\"M8 19h32v21H8Z M8 26.5h32M8 34h32 M13 40v4M35 40v4 M14 9h6v10h-6Z\"/><circle cx=\"29\" cy=\"13.5\" r=\"4.5\"/><path d=\"M29 9V6\"/>",
    cook: "<path d=\"M24 5c4.5 6 7.5 9.8 7.5 15a7.5 7.8 0 0 1-15 0C16.5 14.8 19.5 11 24 5Z\"/>" +
      "<path d=\"M24 16c2 2.8 3.2 4.3 3.2 6.7a3.2 3.4 0 0 1-6.4 0C20.8 20.3 22 18.8 24 16Z M6 37h36M11 37v5M37 37v5M7 44h34\"/>",
    medical: "<path d=\"M8 15h32v25H8Z M18 15V9h12v6 M24 21v12M18 27h12\"/>",
    gobag: "<path d=\"M15 42V17a9 7 0 0 1 18 0v25Z M20 10.5a4 3.4 0 0 1 8 0 M19.5 26h9v10h-9Z M19.5 30.5h9 M15 21h-4v13h4M33 21h4v13h-4\"/>",
    comms: "<path d=\"M17 15h15v26H17Z M21 15L14 4 M28 15v-1.5 M20 21h9M20 25h9 M20.5 30h8v5h-8Z M31 5.5a5 5 0 0 1 5 5 M31 1a9.5 9.5 0 0 1 9.5 9.5\"/><circle cx=\"28\" cy=\"11\" r=\"2.4\"/>",
    concern: "<path d=\"M24 7l20 34H4Z M24 19v10\"/><circle cx=\"24\" cy=\"35\" r=\"1.7\" fill=\"currentColor\" stroke=\"none\"/>"
  };
  var ART_SM = {
    droplet: "<path d=\"M12 3c0 0-6 6.6-6 10.5a6 6.5 0 0 0 12 0C18 9.6 12 3 12 3Z\"/>",
    crate: "<path d=\"M4 10h16v9H4Z M4 14.5h16 M7.5 10V5.5H11V10\"/><circle cx=\"16\" cy=\"7.5\" r=\"2.2\"/>",
    tent: "<path d=\"M12 4l9 15H3Z M12 11l4.5 8h-9Z\"/>",
    flame: "<path d=\"M12 3c2.5 3.5 4.5 5.8 4.5 9.3a4.5 4.8 0 0 1-9 0C7.5 8.8 9.5 6.5 12 3Z\"/>",
    medical: "<path d=\"M4 5.5h16V19H4Z M12 9v7M8.5 12.5h7\"/>",
    comms: "<path d=\"M9 8.5h7V20H9Z M11 8.5L8.5 3.5 M17.8 5.2a4.6 4.6 0 0 1 4.6 4.6 M11 12h3M11 15h3\"/>",
    wrench: "<path d=\"M15.2 4.3a4.3 4.3 0 0 0-5.8 5.5L4.3 15a2.2 2.2 0 1 0 3.1 3.1l5.2-5.1a4.3 4.3 0 0 0 5.5-5.8l-2.8 2.8-2.3-.7-.7-2.3Z\"/>",
    shirt: "<path d=\"M8.6 4L4 7.6 6.4 11 9 9.9V20h6V9.9l2.6 1.1L20 7.6 15.4 4a3.4 3.4 0 0 1-6.8 0Z\"/>",
    shield: "<path d=\"M12 3l7 2.4V11c0 4.8-2.9 8.2-7 9.9C7.9 19.2 5 15.8 5 11V5.4Z M9.2 11.6l2 2 3.6-3.8\"/>",
    pack: "<path d=\"M7.5 20V9.8a4.5 4.5 0 0 1 9 0V20Z M10.3 5.6a1.8 1.8 0 0 1 3.4 0 M10 13.5h4V17h-4Z\"/>",
    intel: "<path d=\"M5 6h14v13H5Z M8.6 15.4a4.8 4.8 0 0 1 0-6.8 M15.4 8.6a4.8 4.8 0 0 1 0 6.8\"/><circle cx=\"12\" cy=\"12\" r=\"1.3\" fill=\"currentColor\" stroke=\"none\"/>",
    lists: "<path d=\"M6 5h12v15H6Z M9 3.8h6V7H9Z M9.2 11h5.6M9.2 14.2h5.6 M9.2 17.4l1.6 1.6 2.8-3\"/>"
  };
  function artBig(name) { return nxSvg("0 0 48 48", 2.4, ART_BIG[name] || "", "nx-art-big"); }
  function artSm(name) { return nxSvg("0 0 24 24", 1.7, ART_SM[name] || "", "nx-art-sm"); }
  var GEAR_ICONS = { Water: "droplet", Food: "crate", Shelter: "tent", Fire: "flame", Medical: "medical", Comms: "comms", Tools: "wrench", Clothing: "shirt", Defense: "shield", Other: "pack" };
  var AREA_ICONS = { WATER: "droplet", FOOD: "crate", MEDICAL: "medical", COMMS: "comms", MOBILITY: "pack" };

  /* ---------------- navigation + clock ---------------- */
  var currentView = "command";
  function showView(name) {
    closeScanner(); // never leak a live camera across a view switch
    closePhotoConfirm(); // a half-confirmed photo list never follows the user around
    currentView = name;
    document.querySelectorAll(".nx-view").forEach(function (v) { v.classList.remove("nx-on"); });
    var el = $("view-" + name);
    if (el) el.classList.add("nx-on");
    document.querySelectorAll(".nx-tab").forEach(function (t) {
      t.classList.toggle("nx-active", t.getAttribute("data-view") === name);
    });
    if (el && fxAnimate()) {
      el.classList.remove("nx-redraw");
      void el.offsetWidth;
      el.classList.add("nx-redraw");
      setTimeout(function () { el.classList.remove("nx-redraw"); }, 240);
    }
    renderAll();
  }
  function tickClock() {
    var el = $("nx-clock");
    if (el) el.textContent = new Date().toLocaleTimeString("en-GB", { hour12: false });
    var z = $("nx-zulu");
    if (z) z.textContent = new Date().toISOString().slice(11, 19) + " ZULU";
  }

  /* ---------------- days ready (flagship metric) ---------------- */
  function householdSize() {
    var n = state.crew.filter(function (c) { return c.role === "Adult" || c.role === "Child"; }).length;
    return n === 0 ? 1 : n;
  }
  function petCount() {
    return state.crew.filter(function (c) { return c.role === "Pet"; }).length;
  }
  function daysReady() {
    var hh = householdSize();
    var waterGal = 0, waterExpired = 0, waterStores = 0;
    var foodKcal = 0, foodExpired = 0, foodHasKcal = false;
    state.stores.forEach(function (s) {
      var expired = !!(s.expiry && daysLeft(s.expiry) < 0);
      if (s.kind === "Water") {
        if (expired) waterExpired++;
        else { waterGal += storeGallons(s); waterStores++; }
      } else if (s.kind === "Food") {
        if (expired) foodExpired++;
        else if (Number(s.kcal) > 0) { foodKcal += Number(s.kcal); foodHasKcal = true; }
      }
    });
    var waterDays = waterStores > 0 ? waterGal / (hh * 1.0) : null;
    var foodDays = foodHasKcal ? foodKcal / (hh * 2000) : null;
    var headline = null, limiting = null;
    if (waterDays != null && foodDays != null) {
      headline = Math.min(waterDays, foodDays);
      limiting = foodDays <= waterDays ? "food" : "water";
    } else if (waterDays != null) { headline = waterDays; limiting = "water"; }
    else if (foodDays != null) { headline = foodDays; limiting = "food"; }

    var gap = "";
    if (headline != null) {
      var milestones = [7, 14, 30];
      var target = null;
      for (var i = 0; i < milestones.length; i++) { if (headline < milestones[i]) { target = milestones[i]; break; } }
      if (target == null) {
        gap = "ALL MILESTONES MET - 30+ DAYS READY";
      } else if (limiting === "water") {
        gap = "TO " + target + " DAYS: +" + fmt((target * hh * 1.0) - waterGal, 1) + " GAL WATER";
      } else {
        gap = "TO " + target + " DAYS: +" + fmt((target * hh * 2000) - foodKcal, 0) + " KCAL FOOD";
      }
    }
    return {
      household: hh, pets: petCount(),
      waterGal: waterGal, waterDays: waterDays, waterExpired: waterExpired,
      foodKcal: foodKcal, foodDays: foodDays, foodExpired: foodExpired,
      headline: headline, limiting: limiting, gap: gap
    };
  }

  /* ---------------- readiness levels (calmer headline) ----------------
     User feedback: the raw day count reads like a countdown and
     stresses people out. The dashboard headline can instead show
     a readiness LEVEL with progress toward the next one and the
     single next step that gets there. The exact count never goes
     away - it stays in the breakdown, the SITREP and the reports,
     and Settings can put it back on the headline (dashDisplay). */
  var READY_LEVELS = [
    { at: 0, name: "GETTING STARTED" },
    { at: 3, name: "WEEKEND READY" },
    { at: 7, name: "WEEK READY" },
    { at: 14, name: "TWO-WEEK READY" },
    { at: 30, name: "MONTH READY" }
  ];
  function readinessLevel(d) {
    if (!d || d.headline == null) return null;
    var cur = READY_LEVELS[0], next = null;
    for (var i = 0; i < READY_LEVELS.length; i++) {
      if (d.headline >= READY_LEVELS[i].at) cur = READY_LEVELS[i];
      else { next = READY_LEVELS[i]; break; }
    }
    var pct = next ? ((d.headline - cur.at) / (next.at - cur.at)) * 100 : 100;
    var hint = "";
    if (next) {
      if (d.limiting === "water") hint = "ADD " + fmt((next.at * d.household * 1.0) - d.waterGal, 1) + " GAL WATER";
      else hint = "ADD " + fmt((next.at * d.household * 2000) - d.foodKcal, 0) + " KCAL FOOD";
    }
    return { name: cur.name, next: next, pct: pct, hint: hint };
  }
  function dashDisplayMode() {
    var m = state.settings && state.settings.dashDisplay;
    return (m === "days" || m === "both") ? m : "level";
  }

  /* ---------------- pets + cash (Ready.gov build) ----------------
     Pets eat too, but they are NOT people: pet readiness is its
     own line and never touches the human Days Ready headline.
     Pet food is logged as stores of kind "PetFood", in pounds.
     The planning ration is 1.0 lb per pet per day - a large-dog
     rate, deliberately conservative: smaller pets stretch the
     same pounds further, never shorter. Pet count comes from
     the check-in answers (pets live in the assessment, not the
     crew list), falling back to crew members with the Pet role. */
  var PET_FOOD_LB_PER_PET_DAY = 1.0;
  function petHouseholdCount() {
    var a = state.assessment;
    if (a && typeof a.pets === "number" && a.pets > 0) return a.pets;
    return petCount();
  }
  function petFoodLb() {
    var lb = 0;
    state.stores.forEach(function (s) {
      if (s.kind !== "PetFood") return;
      if (s.expiry && daysLeft(s.expiry) < 0) return; // expired pet food counts for nothing, same rule as people food
      var u = String(s.unit || "").toLowerCase();
      var amt = Number(s.amount) || 0;
      if (u === "lb" || u === "lbs") lb += amt;
      else if (u === "kg") lb += amt * 2.2046226;
    });
    return lb;
  }
  function petReadiness() {
    var pets = petHouseholdCount();
    var lb = petFoodLb();
    return { pets: pets, lb: lb, days: pets > 0 ? lb / (pets * PET_FOOD_LB_PER_PET_DAY) : null };
  }
  /* Cash on hand: a readiness display, never a Days Ready
     input. Cards and ATMs die with the grid; this is the money
     that still moves. */
  function cashTotal() {
    return (Array.isArray(state.cash) ? state.cash : []).reduce(function (sum, c) { return sum + (Number(c.amount) || 0); }, 0);
  }

  function renderDaysReady(fxA) {
    var d = daysReady();
    var mode = dashDisplayMode();
    var lvl = readinessLevel(d);
    var big = $("nx-days-ready"), unit = $("nx-days-unit"), label = $("nx-days-label");
    if (mode === "level" && lvl) {
      big.textContent = lvl.name;
      big.style.fontSize = "clamp(30px, 8.5vw, 46px)";
      big.style.letterSpacing = "1px";
      if (unit) unit.style.display = "none";
      if (label) label.textContent = "Readiness Level // Household Sustainment";
      if (fxA) segAnimate($("nx-days-seg"), lvl.pct, false);
      else $("nx-days-seg").innerHTML = segHtml(lvl.pct, false);
    } else {
      if (fxA && d.headline != null) countUp(big, d.headline, 1);
      else big.textContent = d.headline == null ? "--" : fmt(d.headline, 1);
      big.style.fontSize = "clamp(84px, 26vw, 104px)";
      big.style.letterSpacing = "";
      if (unit) unit.style.display = "";
      if (label) label.textContent = "Days Ready // Household Sustainment";
      if (fxA) segAnimate($("nx-days-seg"), d.headline == null ? 0 : (d.headline / 30) * 100, false);
      else $("nx-days-seg").innerHTML = segHtml(d.headline == null ? 0 : (d.headline / 30) * 100, false);
    }
    var wLine = "WATER <b>" + (d.waterDays == null ? "--" : fmt(d.waterDays, 1) + " DAYS") + "</b>" +
      (d.waterDays == null ? " - NO WATER STORES" : " (" + fmt(d.waterGal, 1) + " GAL)") +
      (d.waterExpired ? " <span class=\"nx-heavy\">// " + d.waterExpired + " STORE" + (d.waterExpired > 1 ? "S" : "") + " EXPIRED - NOT COUNTED</span>" : "");
    var fLine = "FOOD <b>" + (d.foodDays == null ? "--" : fmt(d.foodDays, 1) + " DAYS") + "</b>" +
      (d.foodDays == null ? " - ADD CALORIES TO A FOOD STORE" : " (" + fmt(d.foodKcal, 0) + " KCAL)") +
      (d.foodExpired ? " <span class=\"nx-heavy\">// " + d.foodExpired + " STORE" + (d.foodExpired > 1 ? "S" : "") + " EXPIRED - NOT COUNTED</span>" : "");
    // Pets get their own line, only when the household has
    // them - and it never feeds the headline above.
    var pr = petReadiness();
    var pLine = pr.pets > 0
      ? "<br>PETS <b>" + (pr.lb > 0 ? fmt(pr.days, 1) + " DAYS" : "--") + "</b>" +
        (pr.lb > 0
          ? " (" + fmt(pr.lb, 1) + " LB PET FOOD // " + pr.pets + " PET" + (pr.pets > 1 ? "S" : "") + " AT " + fmt(PET_FOOD_LB_PER_PET_DAY, 1) + " LB/PET/DAY)"
          : " - NO PET FOOD STORED FOR " + pr.pets + " PET" + (pr.pets > 1 ? "S" : ""))
      : "";
    var cLine = "<br>CASH ON HAND <b>$" + fmt(cashTotal(), 0) + "</b>";
    $("nx-days-breakdown").innerHTML = wLine + "<br>" + fLine + pLine + cLine;
    if (d.headline == null) {
      $("nx-days-gap").innerHTML = mode === "level"
        ? "ADD WATER AND FOOD STORES IN THE ROTATE TAB TO SET YOUR LEVEL."
        : "ADD WATER AND FOOD STORES IN THE ROTATE TAB TO COMPUTE YOUR NUMBER.";
    } else if (mode === "level" && lvl) {
      $("nx-days-gap").innerHTML = lvl.next
        ? "NEXT LEVEL // <b>" + esc(lvl.next.name) + "</b> - " + esc(lvl.hint) + " // WEAKEST LINK: <b>" + esc((d.limiting || "").toUpperCase()) + "</b>"
        : "TOP LEVEL // <b>MONTH READY</b> - ALL MILESTONES MET // WEAKEST LINK: <b>" + esc((d.limiting || "").toUpperCase()) + "</b>";
    } else if (mode === "both" && lvl) {
      $("nx-days-gap").innerHTML = "LEVEL // <b>" + esc(lvl.name) + "</b> // GAP // <b>" + esc(d.gap) + "</b> // WEAKEST LINK: <b>" + esc((d.limiting || "").toUpperCase()) + "</b>";
    } else {
      $("nx-days-gap").innerHTML = "GAP // <b>" + esc(d.gap) + "</b> // WEAKEST LINK: <b>" + esc((d.limiting || "").toUpperCase()) + "</b>";
    }
    var crewSet = state.crew.some(function (c) { return c.role === "Adult" || c.role === "Child"; });
    $("nx-days-household").textContent = "HOUSEHOLD: " + d.household + (crewSet ? " PERSONS" : " (SOLO - NO CREW SET)") +
      " // WATER AT 1.0 GAL/PERSON/DAY // FOOD AT 2,000 KCAL/PERSON/DAY" +
      (d.pets ? " // +" + d.pets + " PET" + (d.pets > 1 ? "S" : "") + " (NOT IN THE DIVISOR)" : "");
  }

  /* ---------------- dashboard ---------------- */
  function renderDashboard() {
    var fxA = fxAnimate() && !nxDashAnimated;
    renderDaysReady(fxA);
    // Water
    var gal = waterGallons();
    if (fxA) { countUp($("nx-stat-water"), gal, 1); segAnimate($("nx-stat-water-seg"), (gal / WATER_GOAL_GAL) * 100, false); }
    else { $("nx-stat-water").textContent = fmt(gal, 1); $("nx-stat-water-seg").innerHTML = segHtml((gal / WATER_GOAL_GAL) * 100, false); }
    $("nx-stat-water-sub").textContent = gal > 0
      ? "GOAL " + WATER_GOAL_GAL + " GAL // " + Math.round((gal / WATER_GOAL_GAL) * 100) + "% STAGED"
      : "NO WATER STORES LOGGED";

    // Core loadout (Tier 1)
    var core = tierWeight("T1");
    if (fxA) { countUp($("nx-stat-core"), core, 1); segAnimate($("nx-stat-core-seg"), (core / CORE_GOAL_LB) * 100, core > CORE_GOAL_LB); }
    else { $("nx-stat-core").textContent = fmt(core, 1); $("nx-stat-core-seg").innerHTML = segHtml((core / CORE_GOAL_LB) * 100, core > CORE_GOAL_LB); }
    $("nx-stat-core-sub").textContent = core > 0
      ? "TOTAL ALL TIERS " + fmt(totalWeight(), 1) + " LB // REF " + CORE_GOAL_LB + " LB"
      : "ON-BODY TIER EMPTY";

    // Readiness
    var cs = checklistStats();
    if (fxA) { countUp($("nx-stat-ready"), cs.pct, 0); segAnimate($("nx-stat-ready-seg"), cs.pct, false); }
    else { $("nx-stat-ready").textContent = cs.pct; $("nx-stat-ready-seg").innerHTML = segHtml(cs.pct, false); }
    $("nx-stat-ready-sub").textContent = cs.done + " / " + cs.total + " ITEMS CONFIRMED";

    // Heaviest Tier 1 items
    var heavy = state.gear.filter(function (g) { return g.tier === "T1"; })
      .map(function (g) { return { name: g.name, lb: itemWeightLb(g) }; })
      .sort(function (a, b) { return b.lb - a.lb; }).slice(0, 3);
    $("nx-heavy-list").innerHTML = heavy.length
      ? heavy.map(function (h, i) {
          return "<div class=\"nx-row\"><div class=\"nx-row-main\"><p class=\"nx-row-title\">" +
            "<span class=\"nx-heavy\">#" + (i + 1) + "</span> " + esc(h.name) + "</p>" +
            "<p class=\"nx-row-meta\">TIER 1 // ON BODY</p></div>" +
            "<div class=\"nx-row-side\"><span class=\"nx-row-weight\">" + fmt(h.lb, 2) + "</span> <span class=\"nx-dim\">LB</span></div></div>";
        }).join("")
      : "<div class=\"nx-empty\">NO TIER 1 ITEMS. ADD ON-BODY GEAR IN THE GEAR TAB.</div>";

    // Next expirations
    var exps = allExpiries().slice(0, 3);
    $("nx-next-exp").innerHTML = exps.length
      ? exps.map(function (r) {
          var st = expiryState(r.days);
          return "<div class=\"nx-row\"><div class=\"nx-row-main\"><p class=\"nx-row-title\">" + esc(r.name) + "</p>" +
            "<p class=\"nx-row-meta\">" + esc(r.source) + " // EXP " + esc(r.expiry) + " // " +
            (r.days < 0 ? Math.abs(r.days) + " DAYS PAST" : r.days + " DAYS LEFT") + "</p></div>" +
            "<div class=\"nx-row-side\"><span class=\"nx-badge " + st.cls + "\">" + st.label + "</span></div></div>";
        }).join("")
      : "<div class=\"nx-empty\">NOTHING WITH AN EXPIRY DATE. ADD DATES IN GEAR OR ROTATE.</div>";

    renderHomeCards();
    renderRallyBox();
    renderStatusBoard();
    renderExpiryWatch();
    renderWeeklySitrep();
    renderAdvisor();
    if (fxA) nxDashAnimated = true;
  }

  /* ---------------- command-center status board ----------------
     Presentational only: five station cells colored from the same
     state the rest of the app already renders - Days Ready math,
     the alerts cache, the broadcast outbox and the vault. No new
     stored data; the board is recomputed on every render pass. */
  function boardDays(days) {
    if (days == null) return { cls: "nx-st-dim", val: "NO DATA" };
    if (days <= 0) return { cls: "nx-st-alert", val: "EMPTY" };
    if (days < 3) return { cls: "nx-st-alert", val: fmt(days, 1) + " DAYS" };
    if (days < 7) return { cls: "nx-st-warn", val: fmt(days, 1) + " DAYS" };
    return { cls: "nx-st-ok", val: fmt(days, 1) + " DAYS" };
  }
  function setCell(id, st) {
    var cell = $(id);
    if (!cell) return;
    cell.className = "nx-station " + st.cls;
    var v = cell.querySelector(".nx-station-val");
    if (v) v.textContent = st.val;
  }
  // The alerts station logic, shared verbatim by the status
  // board and the Weekly Sitrep's alerts line (money build B).
  function alertsBoardState() {
    if (!alertsCache || !alertsCache.alerts) return { cls: "nx-st-dim", val: "NO DATA" };
    if (alertsCache.alerts.length) return { cls: "nx-st-alert nx-pulse-led", val: alertsCache.alerts.length + " ACTIVE" };
    if (Date.now() - alertsCache.fetchedAt > STALE_MS) return { cls: "nx-st-warn", val: "STALE" };
    return { cls: "nx-st-ok", val: "CLEAR" };
  }
  function renderStatusBoard() {
    if (!$("nx-board")) return;
    var d = daysReady();
    setCell("nx-cell-water", boardDays(d.waterDays));
    setCell("nx-cell-food", boardDays(d.foodDays));
    setCell("nx-cell-alerts", alertsBoardState());
    setCell("nx-cell-comms", state.outbox.length
      ? { cls: "nx-st-data", val: state.outbox.length + " SENT" }
      : { cls: "nx-st-dim", val: "NONE" });
    setCell("nx-cell-vault", Vault.unlocked
      ? { cls: "nx-st-ok", val: "OPEN" }
      : Vault.blob ? { cls: "nx-st-warn", val: "SEALED" } : { cls: "nx-st-dim", val: "NOT SET" });
  }

  function primaryRally() {
    if (!Vault.unlocked) return null;
    return Vault.entries.filter(function (e) { return e.type === "Rally Point"; })[0] || null;
  }

  function renderRallyBox() {
    var box = $("nx-rally-box");
    if (!box) return;
    var rally = primaryRally();
    if (rally) {
      box.innerHTML = "<p class=\"nx-row-title\" style=\"font-size:19px;\">" + esc(rally.title) + "</p>" +
        "<p class=\"nx-row-meta\">PRIMARY RALLY POINT // COORDS " +
        (rally.lat != null && rally.lng != null ? fmt(rally.lat, 4) + ", " + fmt(rally.lng, 4) : "NOT SET") +
        " // DETAIL IN VAULT</p>";
    } else if (Vault.blob) {
      box.innerHTML = "<p class=\"nx-h-note\" style=\"margin:0;\">VAULT SEALED - UNLOCK THE VAULT TO SEE THE PRIMARY RALLY POINT. COORDINATES STAY ENCRYPTED.</p>";
    } else {
      box.innerHTML = "<p class=\"nx-h-note\" style=\"margin:0;\">NO RALLY POINT SET. CREATE THE VAULT AND SEAL A RALLY POINT ENTRY TO PUT ONE HERE.</p>";
    }
    renderRallyNav();
  }

  /* ---------------- sync toggle ---------------- */
  function bindSyncToggle() {
    var t = $("nx-sync-toggle");
    if (!t) return;
    t.addEventListener("click", function () {
      showMsg($("nx-sync-note"),
        "GRID SYNC UNAVAILABLE IN V1. CLOUD SYNC ARRIVES WITH ACCOUNTS - UNTIL THEN EVERYTHING STAYS ON THIS DEVICE, ENCRYPTED WHERE IT MATTERS.");
      t.classList.remove("nx-on");
      $("nx-sync-state").textContent = "OFF // LOCAL ENCRYPTED STORAGE";
    });
  }

  /* ---------------- gear catalog ---------------- */
  var gearTierFilter = "ALL";
  var gearCatFilter = "ALL";
  var gearLocFilter = "ALL";

  function gearRowHtml(g, heaviestIds) {
    var lb = itemWeightLb(g);
    var tags = (g.env || []).map(function (t) { return "<span class=\"nx-tag\">" + esc(t) + "</span>"; }).join("");
    var meta = esc(g.category.toUpperCase()) + " // " + esc(TIERS[g.tier] || g.tier) + " // QTY " + (Number(g.qty) || 1) +
      " // " + fmt(Number(g.weightValue) || 0, 2) + " " + esc(g.weightUnit) + " EACH" +
      (g.location ? " // " + esc(g.location.toUpperCase()) : "") +
      " // KIT: " + esc(kitLoc(g.loc).toUpperCase()) +
      " // CREW: " + esc(crewName(g.assignedTo)) +
      (g.expiry ? " // EXP " + esc(g.expiry) : "");
    return "<div class=\"nx-row\" data-gear-row=\"" + g.id + "\">" +
      "<div class=\"nx-row-ic\">" + artSm(GEAR_ICONS[g.category] || "pack") + "</div>" +
      "<div class=\"nx-row-main\"><p class=\"nx-row-title\">" + esc(g.name) +
      (heaviestIds[g.id] ? " <span class=\"nx-heavy\">// HEAVIEST</span>" : "") + "</p>" +
      "<p class=\"nx-row-meta\">" + meta + "</p><div>" + tags + "</div></div>" +
      "<div class=\"nx-row-side\"><span class=\"nx-row-weight\">" + fmt(lb, 2) + "</span> <span class=\"nx-dim\">LB</span>" +
      "<div class=\"nx-btn-row\" style=\"justify-content:flex-end;\">" +
      "<button type=\"button\" class=\"nx-btn nx-btn-small\" data-gear-edit=\"" + g.id + "\">Edit</button>" +
      "<button type=\"button\" class=\"nx-btn nx-btn-small nx-btn-danger\" data-gear-del=\"" + g.id + "\">Del</button>" +
      "</div></div></div>";
  }

  function renderGear() {
    // category select + filter options (built once per render is fine)
    var catSel = $("nx-g-category");
    if (catSel && !catSel.options.length) {
      catSel.innerHTML = CATEGORIES.map(function (c) { return "<option value=\"" + c + "\">" + c + "</option>"; }).join("");
    }
    var catFilter = $("nx-gear-catfilter");
    if (catFilter && catFilter.options.length <= 1) {
      catFilter.innerHTML = "<option value=\"ALL\">ALL CATEGORIES</option>" + CATEGORIES.map(function (c) {
        return "<option value=\"" + c + "\">" + c.toUpperCase() + "</option>";
      }).join("");
    }
    var envWrap = $("nx-g-env");
    if (envWrap && !envWrap.children.length) {
      envWrap.innerHTML = ENV_TAGS.map(function (t) {
        return "<label class=\"nx-chip-check\"><input type=\"checkbox\" name=\"nx-g-env\" value=\"" + t + "\"><span>" + t + "</span></label>";
      }).join("");
    }
    // assigned-to options
    var asSel = $("nx-g-assigned");
    if (asSel) {
      var cur = asSel.value;
      asSel.innerHTML = "<option value=\"\">Unassigned</option>" + state.crew.map(function (c) {
        return "<option value=\"" + c.id + "\">" + esc(c.name) + "</option>";
      }).join("");
      asSel.value = cur || "";
    }

    var t1 = tierWeight("T1"), t2 = tierWeight("T2"), t3 = tierWeight("T3");
    $("nx-gear-totals").innerHTML =
      "T1 ON BODY <b>" + fmt(t1, 1) + " LB</b> // T2 BUG-OUT <b>" + fmt(t2, 1) + " LB</b> // T3 CACHE <b>" + fmt(t3, 1) + " LB</b> // GRAND TOTAL <b>" + fmt(t1 + t2 + t3, 1) + " LB</b> // " + state.gear.length + " ITEMS";

    var filtered = state.gear.filter(function (g) {
      if (gearTierFilter !== "ALL" && g.tier !== gearTierFilter) return false;
      if (gearCatFilter !== "ALL" && g.category !== gearCatFilter) return false;
      if (gearLocFilter !== "ALL" && kitLoc(g.loc) !== gearLocFilter) return false;
      return true;
    });

    // heaviest item per visible tier group gets flagged
    var html = "";
    ["T1", "T2", "T3"].forEach(function (tier) {
      var group = filtered.filter(function (g) { return g.tier === tier; });
      if (!group.length) return;
      var heaviestIds = {};
      var maxLb = -1, maxId = null;
      group.forEach(function (g) { var lb = itemWeightLb(g); if (lb > maxLb) { maxLb = lb; maxId = g.id; } });
      if (maxId) heaviestIds[maxId] = true;
      html += "<h3 class=\"nx-section-sub\">" + esc(TIERS[tier]) + " - " + fmt(tierWeight(tier), 1) + " LB</h3>";
      group.slice().sort(function (a, b) { return itemWeightLb(b) - itemWeightLb(a); })
        .forEach(function (g) { html += gearRowHtml(g, heaviestIds); });
    });
    $("nx-gear-list").innerHTML = html || "<div class=\"nx-empty\"><span class=\"nx-empty-art\">" + artSm("pack") + "</span>NO GEAR MATCHES. ADD AN ITEM ABOVE OR CLEAR THE FILTERS.</div>";
  }

  function resetGearForm() {
    $("nx-gear-form").reset();
    $("nx-g-id").value = "";
    $("nx-g-qty").value = 1;
    $("nx-gear-form-title").textContent = "Add Gear Item";
    $("nx-gear-save").textContent = "Add Item";
    $("nx-gear-cancel-edit").style.display = "none";
  }

  function bindGear() {
    $("nx-gear-form").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var id = $("nx-g-id").value;
      var env = Array.prototype.slice.call(document.querySelectorAll("input[name='nx-g-env']:checked"))
        .map(function (c) { return c.value; });
      var data = {
        name: $("nx-g-name").value.trim(),
        category: $("nx-g-category").value,
        tier: $("nx-g-tier").value,
        weightValue: Number($("nx-g-weight").value) || 0,
        weightUnit: $("nx-g-unit").value,
        qty: Math.max(1, Number($("nx-g-qty").value) || 1),
        expiry: $("nx-g-expiry").value || null,
        assignedTo: $("nx-g-assigned").value || "",
        location: $("nx-g-location").value.trim(),
        loc: kitLoc($("nx-g-loc").value),
        env: env
      };
      if (!data.name) return;
      if (id) {
        state.gear.forEach(function (g) { if (g.id === id) Object.assign(g, data); });
      } else {
        if (capBlocked("gear")) {
          showMsg($("nx-gear-msg"),
            "FREE TIER GEAR CAP: " + PLAN_CAPS.gear + " ITEMS. OPERATOR REMOVES EVERY CAP - SEE SYSTEM // PLAN.", "err");
          return;
        }
        data.id = uid();
        state.gear.push(data);
      }
      saveState();
      resetGearForm();
      renderAll();
      sfxConfirm();
    });
    $("nx-gear-cancel-edit").addEventListener("click", resetGearForm);

    $("nx-gear-list").addEventListener("click", function (ev) {
      var editBtn = ev.target.closest("[data-gear-edit]");
      var delBtn = ev.target.closest("[data-gear-del]");
      if (editBtn) {
        var g = state.gear.filter(function (x) { return x.id === editBtn.getAttribute("data-gear-edit"); })[0];
        if (!g) return;
        $("nx-g-id").value = g.id;
        $("nx-g-name").value = g.name;
        $("nx-g-category").value = g.category;
        $("nx-g-tier").value = g.tier;
        $("nx-g-weight").value = g.weightValue;
        $("nx-g-unit").value = g.weightUnit;
        $("nx-g-qty").value = g.qty;
        $("nx-g-expiry").value = g.expiry || "";
        $("nx-g-location").value = g.location || "";
        $("nx-g-loc").value = kitLoc(g.loc);
        renderGear(); // refresh assigned options before setting value
        $("nx-g-assigned").value = g.assignedTo || "";
        document.querySelectorAll("input[name='nx-g-env']").forEach(function (c) {
          c.checked = (g.env || []).indexOf(c.value) >= 0;
        });
        $("nx-gear-form-title").textContent = "Edit Gear Item";
        $("nx-gear-save").textContent = "Save Changes";
        $("nx-gear-cancel-edit").style.display = "";
        $("nx-g-name").focus();
      }
      if (delBtn) {
        var delId = delBtn.getAttribute("data-gear-del");
        var item = state.gear.filter(function (x) { return x.id === delId; })[0];
        if (item && window.confirm("Delete gear item: " + item.name + "?")) {
          state.gear = state.gear.filter(function (x) { return x.id !== delId; });
          saveState();
          renderAll();
        }
      }
    });

    document.querySelectorAll("[data-tier-filter]").forEach(function (b) {
      b.addEventListener("click", function () {
        gearTierFilter = b.getAttribute("data-tier-filter");
        document.querySelectorAll("[data-tier-filter]").forEach(function (x) {
          x.classList.toggle("nx-on", x === b);
        });
        renderGear();
      });
    });
    document.querySelectorAll("[data-loc-filter]").forEach(function (b) {
      b.addEventListener("click", function () {
        gearLocFilter = b.getAttribute("data-loc-filter");
        document.querySelectorAll("[data-loc-filter]").forEach(function (x) {
          x.classList.toggle("nx-on", x === b);
        });
        renderGear();
      });
    });
    $("nx-gear-catfilter").addEventListener("change", function () {
      gearCatFilter = this.value;
      renderGear();
    });
  }

  /* ---------------- expiry radar, expiry watch, weekly sitrep ----------------
     Money build B - retention plumbing. One expiry computation
     (allExpiries / storeExpiries) feeds three surfaces: the
     Expiry Radar on top of Rotate, a compact Expiry Watch strip
     on Command when something is overdue or inside 14 days, and
     the Weekly Sitrep panel with its 7-day snapshot history.
     Plus a best-effort rotation notification: permission is
     never auto-prompted, a store alerts at most once (tracked
     in state.lastExpirySeen), and every unsupported platform
     degrades to silence. Free for all tiers. */

  // The REPLACE button for a rotation row, shared by the tracker
  // table and the radar so the two can never drift: a store row
  // flagged DUE SOON or OVERDUE gets a shop button matched by
  // store type; gear rows and other kinds get none.
  function replaceBtnHtml(r) {
    var st = expiryState(r.days);
    if (r.kind !== "store" || (st.label !== "DUE SOON" && st.label !== "OVERDUE")) return "";
    var sObj = state.stores.filter(function (x) { return x.id === r.refId; })[0];
    if (sObj && sObj.kind === "Water") return shopBtnHtml("water-storage", "REPLACE");
    if (sObj && sObj.kind === "Food") return shopBtnHtml("food-bucket", "REPLACE");
    return "";
  }

  /* Meds on the radar (Ready.gov build): a med earns a row
     when its expiry is inside the 30-day DUE SOON window (or
     past it) OR its supply runs out within 14 days. The row's
     day count is whichever deadline lands first. */
  function medRadarRows() {
    var rows = [];
    (Array.isArray(state.meds) ? state.meds : []).forEach(function (m) {
      var cands = [];
      if (m.expiry) {
        var ed = daysLeft(m.expiry);
        if (ed != null && ed <= 30) cands.push({ days: ed, why: "EXP " + m.expiry });
      }
      if (typeof m.supplyDays === "number" && m.supplyDays <= 14) {
        cands.push({ days: m.supplyDays, why: "SUPPLY RUNS OUT" });
      }
      if (!cands.length) return;
      cands.sort(function (a, b) { return a.days - b.days; });
      rows.push({
        kind: "med", refId: m.id, name: m.name, days: cands[0].days,
        meta: "MED" + (m.person ? " // " + String(m.person).toUpperCase() : "") + " // " + cands[0].why
      });
    });
    return rows;
  }

  function renderRadar() {
    var list = $("nx-radar-list");
    if (!list) return;
    // One merged, soonest-first list: store expiries plus the
    // meds that qualify (medRadarRows). With no meds logged the
    // rows are exactly the store rows the radar has always had.
    var rows = storeExpiries().map(function (r) {
      return { kind: "store", refId: r.refId, name: r.name, days: r.days, storeRow: r,
        meta: (r.storeKind || "STORE").toUpperCase() + " // EXP " + r.expiry };
    }).concat(medRadarRows());
    rows.sort(function (a, b) { return (a.days == null ? 99999 : a.days) - (b.days == null ? 99999 : b.days); });
    var anyReplace = false;
    if (!rows.length) {
      list.innerHTML = "<div class=\"nx-empty\">NO EXPIRY DATES SET - ADD DATES IN ROTATE TO ARM THE RADAR.</div>";
    } else {
      list.innerHTML = rows.slice(0, 5).map(function (r) {
        var btn = r.storeRow ? replaceBtnHtml(r.storeRow) : "";
        if (btn) anyReplace = true;
        return "<div class=\"nx-row\"><div class=\"nx-row-main\"><p class=\"nx-row-title\">" + esc(r.name) + "</p>" +
          "<p class=\"nx-row-meta\">" + esc(r.meta) + "</p></div>" +
          "<div class=\"nx-row-side\"><span class=\"nx-radar-days " + radarDaysClass(r.days) + "\">" + esc(daysLeftText(r.days)) + "</span>" +
          (btn ? "<div class=\"nx-btn-row\" style=\"justify-content:flex-end; margin-top:6px;\">" + btn + "</div>" : "") + "</div></div>";
      }).join("");
    }
    var note = $("nx-radar-note");
    if (note) note.innerHTML = anyReplace ? shopDisclosureHtml() : "";
    // Notification opt-in: rendered only while permission is
    // undecided. Granted hides it (alerts just work), denied
    // hides it (the browser owns that answer), and platforms
    // without the API render nothing at all.
    var opt = $("nx-radar-alerts");
    if (opt) {
      var undecided = false;
      try { undecided = typeof Notification !== "undefined" && Notification.permission === "default"; } catch (e) { undecided = false; }
      opt.innerHTML = undecided
        ? "<div class=\"nx-radar-optin\"><span class=\"nx-radar-optin-text\">GET ALERTED BEFORE STORES EXPIRE</span>" +
          "<button type=\"button\" class=\"nx-btn nx-btn-small\" id=\"nx-radar-alerts-btn\">Enable Alerts</button></div>"
        : "";
    }
  }

  function renderExpiryWatch() {
    var strip = $("nx-expiry-watch");
    if (!strip) return;
    var due = storeExpiries().filter(function (r) { return r.days != null && r.days <= 14; });
    if (!due.length) { strip.style.display = "none"; return; }
    var soonest = due[0];
    var anyOver = due.some(function (r) { return r.days < 0; });
    strip.style.display = "";
    strip.style.borderColor = anyOver ? "var(--nx-alert)" : "var(--nx-warn)";
    var txt = $("nx-expiry-watch-text");
    txt.textContent = "EXPIRY WATCH // " + due.length + (due.length === 1 ? " STORE" : " STORES") +
      " DUE - SOONEST: " + String(soonest.name).toUpperCase() + ", " + daysLeftText(soonest.days);
    txt.style.color = anyOver ? "var(--nx-alert)" : "var(--nx-warn)";
  }

  /* Weekly snapshots: one per 7 days, taken at boot, only when
     there is a number worth recording. The log is the report's
     memory - the panel itself always reads live state. */
  function maybeSnapshotSitrep() {
    var d = daysReady();
    if (d.headline == null) return false;
    var log = Array.isArray(state.sitrepLog) ? state.sitrepLog : [];
    if (log.length) {
      var lastDate = parseDateLocal(log[log.length - 1].date);
      if (lastDate) {
        var age = Math.round((todayStart().getTime() - lastDate.getTime()) / 86400000);
        if (age < 7) { state.sitrepLog = log; return false; }
      }
    }
    log.push({ date: todayKeyLocal(), daysReady: d.headline, waterDays: d.waterDays, foodDays: d.foodDays });
    state.sitrepLog = log.slice(-8);
    return true;
  }

  /* The previous report to delta against: when the newest
     snapshot is today's (taken at this boot or an earlier one),
     the previous is the one before it; mid-week, the newest
     snapshot IS the last report. A lone first snapshot has no
     previous - that is the baseline case. */
  function weeklySitrepData() {
    var d = daysReady();
    var today = todayKeyLocal();
    var log = Array.isArray(state.sitrepLog) ? state.sitrepLog : [];
    var prev = null;
    if (log.length) {
      var last = log[log.length - 1];
      if (last.date === today) { if (log.length >= 2) prev = log[log.length - 2]; }
      else prev = last;
    }
    var delta = null;
    if (prev && d.headline != null && prev.daysReady != null) {
      delta = Math.round((d.headline - prev.daysReady) * 10) / 10;
    }
    var lines = resupplyLines();
    var expiring = storeExpiries().filter(function (r) { return r.days != null && r.days <= 30; });
    return {
      d: d, today: today, prev: prev, delta: delta,
      resupply: lines, resupplyTicked: lines.filter(function (l) { return l.done; }).length,
      expiring: expiring, overdueCount: expiring.filter(function (r) { return r.days < 0; }).length,
      alertsVal: alertsBoardState().val
    };
  }
  function sitrepResupplyText(w) {
    if (!w.resupply.length) {
      return "RESUPPLY: ALL CLEAR // DAYS READY " + (w.d.headline == null ? "--" : fmt(w.d.headline, 1)) +
        " VS TARGET " + resupplyTarget() + " DAYS";
    }
    return "RESUPPLY: " + w.resupplyTicked + " OF " + w.resupply.length + " LINES TICKED // TARGET " + resupplyTarget() + " DAYS";
  }
  function sitrepExpiringText(w) {
    if (!w.expiring.length) return "EXPIRING: NONE DUE WITHIN 30 DAYS";
    return "EXPIRING: " + w.expiring.length + (w.expiring.length === 1 ? " STORE" : " STORES") +
      " DUE WITHIN 30 DAYS" + (w.overdueCount ? " (" + w.overdueCount + " OVERDUE)" : "");
  }
  function sitrepDeltaText(delta) {
    return (delta > 0 ? "+" : "") + fmt(delta, 1) + " VS LAST REPORT";
  }
  function buildWeeklySitrepText() {
    var w = weeklySitrepData();
    var d = w.d;
    var lines = [];
    lines.push("NYXSURVIVE // WEEKLY SITREP - " + w.today);
    lines.push("DAYS READY: " + (d.headline == null ? "--" : fmt(d.headline, 1)) +
      (w.delta != null ? " (" + sitrepDeltaText(w.delta) + ")" : " (BASELINE - FIRST REPORT)"));
    lines.push("WATER: " + (d.waterDays == null ? "--" : fmt(d.waterDays, 1) + " DAYS") +
      " // FOOD: " + (d.foodDays == null ? "--" : fmt(d.foodDays, 1) + " DAYS"));
    lines.push(sitrepResupplyText(w));
    lines.push(sitrepExpiringText(w));
    if (state.drillBest) lines.push("BEST DRILL: GRADE " + state.drillBest.grade + " (" + fmtClock(state.drillBest.seconds) + ")");
    lines.push("ALERTS: " + w.alertsVal);
    return lines.join("\n");
  }
  function renderWeeklySitrep() {
    var body = $("nx-weekly-body");
    if (!body) return;
    var w = weeklySitrepData();
    var d = w.d;
    var h = "<p class=\"nx-kv\" style=\"margin:0 0 2px 0;\">REPORT // " + esc(w.today) + "</p>";
    h += "<p class=\"nx-kv\" style=\"margin:2px 0;\">DAYS READY <b>" + (d.headline == null ? "--" : fmt(d.headline, 1)) + "</b>";
    if (w.delta != null) {
      var cls = w.delta > 0 ? "nx-delta-ok" : w.delta < 0 ? "nx-delta-alert" : "nx-delta-dim";
      h += " <span class=\"nx-weekly-delta " + cls + "\">" + esc(sitrepDeltaText(w.delta)) + "</span>";
    }
    h += "</p>";
    if (w.delta == null) {
      h += "<p class=\"nx-kv\" style=\"margin:2px 0;\">BASELINE SET - YOUR FIRST REPORT. THE NEXT ONE LANDS IN 7 DAYS.</p>";
    }
    h += "<p class=\"nx-kv\" style=\"margin:2px 0;\">WATER <b>" + (d.waterDays == null ? "--" : fmt(d.waterDays, 1) + " DAYS") +
      "</b> // FOOD <b>" + (d.foodDays == null ? "--" : fmt(d.foodDays, 1) + " DAYS") + "</b></p>";
    h += "<p class=\"nx-kv\" style=\"margin:2px 0;\">" + esc(sitrepResupplyText(w)) + "</p>";
    h += "<p class=\"nx-kv\" style=\"margin:2px 0;\">" + esc(sitrepExpiringText(w)) + "</p>";
    if (state.drillBest) {
      h += "<p class=\"nx-kv\" style=\"margin:2px 0;\">BEST DRILL: GRADE <b>" + esc(state.drillBest.grade) + "</b> (" + fmtClock(state.drillBest.seconds) + ")</p>";
    }
    h += "<p class=\"nx-kv\" style=\"margin:2px 0;\">ALERTS: <b>" + esc(w.alertsVal) + "</b></p>";
    body.innerHTML = h;
  }
  async function copyWeeklySitrep() {
    var msg = buildWeeklySitrepText();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(msg);
        showMsg($("nx-weekly-msg"), "WEEKLY SITREP COPIED TO CLIPBOARD - PASTE IT ANYWHERE.", "good");
      } catch (e) {
        showMsg($("nx-weekly-msg"), "CLIPBOARD BLOCKED ON THIS DEVICE - NOTHING COPIED.", "err");
      }
      return;
    }
    showMsg($("nx-weekly-msg"), "NO CLIPBOARD ON THIS DEVICE - NOTHING COPIED.", "err");
  }

  /* Rotation notifications, best-effort: at boot, stores that
     are DUE SOON or OVERDUE and were not in lastExpirySeen are
     newly due. Only an already-granted permission fires (never
     an auto-prompt), exactly one notification names the count
     and the soonest, and lastExpirySeen always advances so the
     same store never alerts twice. iOS shells and old browsers
     have no usable Notification / service worker path here and
     stay silent by design. */
  function checkExpiryNotifications() {
    var due = storeExpiries().filter(function (r) { return r.days != null && r.days <= 30; });
    var dueIds = due.map(function (r) { return r.id; });
    var seen = Array.isArray(state.lastExpirySeen) ? state.lastExpirySeen : [];
    var fresh = due.filter(function (r) { return seen.indexOf(r.id) < 0; });
    var changed = seen.length !== dueIds.length || dueIds.some(function (id, i) { return seen[i] !== id; });
    state.lastExpirySeen = dueIds;
    if (fresh.length) {
      try {
        if (typeof Notification !== "undefined" && Notification.permission === "granted" && "serviceWorker" in navigator) {
          var soonest = fresh[0];
          var body = fresh.length + (fresh.length === 1 ? " STORE" : " STORES") + " NEWLY DUE - SOONEST: " +
            String(soonest.name).toUpperCase() + ", " + daysLeftText(soonest.days);
          navigator.serviceWorker.ready.then(function (reg) {
            if (reg && reg.showNotification) reg.showNotification("NYXSURVIVE // ROTATION ALERT", { body: body });
          }).catch(function () { /* no active worker - stay silent */ });
        }
      } catch (e) { /* notifications are a bonus, never a boot risk */ }
    }
    return changed;
  }

  function bindSitrep() {
    var watch = $("nx-expiry-watch");
    if (watch) watch.addEventListener("click", function () { showView("rotate"); });
    var copyBtn = $("nx-weekly-copy");
    if (copyBtn) copyBtn.addEventListener("click", function () { copyWeeklySitrep(); });
    var radarPanel = $("nx-radar-panel");
    if (radarPanel) radarPanel.addEventListener("click", function (ev) {
      if (!ev.target.closest("#nx-radar-alerts-btn")) return;
      if (typeof Notification === "undefined") return;
      try {
        var p = Notification.requestPermission(function () { renderAll(); });
        if (p && typeof p.then === "function") p.then(function () { renderAll(); });
      } catch (e) { /* denied or unsupported - the row resolves on the next render */ }
    });
  }

  /* ---------------- stores + rotation ---------------- */
  function renderStores() {
    var wrap = $("nx-store-list");
    if (!state.stores.length) {
      wrap.innerHTML = "<div class=\"nx-empty\">NO STORES LOGGED. ADD WATER, FOOD, MEDS, BATTERIES OR PET FOOD ABOVE.</div>";
      return;
    }
    wrap.innerHTML = state.stores.map(function (s) {
      var kcalRow = s.kind === "Food"
        ? "<p class=\"nx-row-meta\">TOTAL KCAL <input type=\"number\" min=\"0\" step=\"1\" class=\"nx-cell\" style=\"width:110px; display:inline-block; font-family:var(--nx-mono);\" value=\"" + (s.kcal ? String(s.kcal) : "") + "\" placeholder=\"SET KCAL\" data-store-kcal=\"" + s.id + "\"></p>"
        : "";
      var kindLabel = s.kind === "PetFood" ? "PET FOOD" : String(s.kind).toUpperCase();
      return "<div class=\"nx-row\"><div class=\"nx-row-main\"><p class=\"nx-row-title\">" + esc(s.name) + "</p>" +
        "<p class=\"nx-row-meta\">" + esc(kindLabel) + " // EXP " + esc(s.expiry || "NO DATE") + " // AT " + esc(kitLoc(s.loc).toUpperCase()) + "</p>" + kcalRow + "</div>" +
        "<div class=\"nx-row-side\"><span class=\"nx-row-weight\">" + fmt(s.amount, 1) + "</span> <span class=\"nx-dim\">" + esc(s.unit) + "</span>" +
        "<div class=\"nx-btn-row\" style=\"justify-content:flex-end;\">" +
        "<button type=\"button\" class=\"nx-btn nx-btn-small nx-btn-danger\" data-store-del=\"" + s.id + "\">Del</button>" +
        "</div></div></div>";
    }).join("");
  }

  function renderRotation() {
    renderStores();
    renderRadar();
    renderMeds();
    renderCash();
    var rows = allExpiries();
    var body = $("nx-rotation-body");
    var anyReplace = false;
    if (!rows.length) {
      body.innerHTML = "<tr><td colspan=\"6\" class=\"nx-dim\" style=\"font-family:var(--nx-mono); font-size:12px;\">NOTHING WITH AN EXPIRY DATE YET.</td></tr>";
    } else {
      body.innerHTML = rows.map(function (r) {
        var st = expiryState(r.days);
        var daysTxt = r.days == null ? "-" : (r.days < 0 ? r.days + " (PAST)" : String(r.days));
        // A store flagged DUE SOON or OVERDUE gets a REPLACE shop
        // button matched by store type (replaceBtnHtml, shared
        // with the Expiry Radar); gear rows and healthy stores
        // render exactly as before.
        var replaceBtn = replaceBtnHtml(r);
        if (replaceBtn) anyReplace = true;
        return "<tr data-rot-row=\"" + r.kind + ":" + r.refId + "\">" +
          "<td>" + esc(r.name) + "</td>" +
          "<td class=\"nx-num\" style=\"color:var(--nx-dim);\">" + esc(r.source) + "</td>" +
          "<td><input type=\"date\" class=\"nx-cell\" style=\"width:auto; font-family:var(--nx-mono);\" value=\"" + esc(r.expiry) + "\" data-rot-date=\"" + r.kind + ":" + r.refId + "\"></td>" +
          "<td class=\"nx-num\">" + daysTxt + "</td>" +
          "<td><span class=\"nx-badge " + st.cls + "\">" + st.label + "</span></td>" +
          "<td style=\"white-space:nowrap;\"><button type=\"button\" class=\"nx-btn nx-btn-small\" data-rot-plus=\"" + r.kind + ":" + r.refId + "\">Rotate +6MO</button>" +
          (replaceBtn ? " " + replaceBtn : "") + "</td>" +
          "</tr>";
      }).join("");
    }
    var shopNote = $("nx-rotate-shop-note");
    if (shopNote) {
      shopNote.textContent = anyReplace ? shopDisclosureText() : "";
      shopNote.style.display = anyReplace ? "" : "none";
    }
  }

  function setExpiry(kind, id, dateStr) {
    var coll = kind === "gear" ? state.gear : state.stores;
    coll.forEach(function (x) { if (x.id === id) x.expiry = dateStr || null; });
    saveState();
    renderAll();
  }

  function bindRotation() {
    // Pet food is counted in pounds (the readiness ration is
    // lb per pet per day), so picking the Pet Food kind snaps
    // the unit field to lbs instead of leaving a unit the pet
    // math would ignore.
    $("nx-s-kind").addEventListener("change", function () {
      if ($("nx-s-kind").value === "PetFood") $("nx-s-unit").value = "lbs";
    });
    $("nx-store-form").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var name = $("nx-s-name").value.trim();
      if (!name) return;
      state.stores.push({
        id: uid(),
        kind: $("nx-s-kind").value,
        name: name,
        amount: Number($("nx-s-amount").value) || 0,
        unit: $("nx-s-unit").value.trim() || "units",
        expiry: $("nx-s-expiry").value || null,
        kcal: Number($("nx-s-kcal").value) || 0,
        loc: kitLoc($("nx-s-loc").value)
      });
      saveState();
      ev.target.reset();
      renderAll();
    });
    $("nx-store-list").addEventListener("click", function (ev) {
      var del = ev.target.closest("[data-store-del]");
      if (!del) return;
      var id = del.getAttribute("data-store-del");
      var s = state.stores.filter(function (x) { return x.id === id; })[0];
      if (s && window.confirm("Delete store: " + s.name + "?")) {
        state.stores = state.stores.filter(function (x) { return x.id !== id; });
        saveState();
        renderAll();
      }
    });
    $("nx-store-list").addEventListener("change", function (ev) {
      var kcalInput = ev.target.closest("[data-store-kcal]");
      if (!kcalInput) return;
      var st = state.stores.filter(function (x) { return x.id === kcalInput.getAttribute("data-store-kcal"); })[0];
      if (st) { st.kcal = Number(kcalInput.value) || 0; saveState(); renderAll(); }
    });
    $("nx-rotation-body").addEventListener("click", function (ev) {
      var btn = ev.target.closest("[data-rot-plus]");
      if (!btn) return;
      var parts = btn.getAttribute("data-rot-plus").split(":");
      var coll = parts[0] === "gear" ? state.gear : state.stores;
      var item = coll.filter(function (x) { return x.id === parts[1]; })[0];
      if (item) setExpiry(parts[0], parts[1], rotatedDateStr(item.expiry));
    });
    $("nx-rotation-body").addEventListener("change", function (ev) {
      var input = ev.target.closest("[data-rot-date]");
      if (!input) return;
      var parts = input.getAttribute("data-rot-date").split(":");
      setExpiry(parts[0], parts[1], input.value || null);
    });
  }

  /* ---------------- medications + cash on hand (Ready.gov build) ----------------
     Meds: a per-person prescription log riding the Rotate view.
     Half of adults take a daily prescription and an emergency
     is exactly when a refill is hardest - so supply days and
     expiry dates are tracked here and surfaced on the Expiry
     Radar (medRadarRows). Factual log only: names, doses,
     dates. No advice, no recommendations. Free for all tiers.
     Cash: stashes of small bills by location, summed onto the
     Command readiness breakdown. Display only - cash never
     enters the Days Ready math. */
  function medState(m) {
    var days = null;
    if (m.expiry) { var ed = daysLeft(m.expiry); if (ed != null) days = ed; }
    if (typeof m.supplyDays === "number") days = days == null ? m.supplyDays : Math.min(days, m.supplyDays);
    return { days: days, st: expiryState(days) };
  }

  function renderMeds() {
    var list = $("nx-med-list");
    if (!list) return;
    var dl = $("nx-med-person-list");
    if (dl) dl.innerHTML = state.crew.map(function (c) { return "<option value=\"" + esc(c.name) + "\"></option>"; }).join("");
    var meds = Array.isArray(state.meds) ? state.meds : [];
    if (!meds.length) {
      list.innerHTML = "<div class=\"nx-empty\">NO MEDS LOGGED. ADD THE HOUSEHOLD'S PRESCRIPTIONS ABOVE - WHO THEY BELONG TO, HOW MANY DAYS OF SUPPLY ARE ON HAND, AND THE DATES THAT MATTER.</div>";
      return;
    }
    list.innerHTML = meds.map(function (m) {
      var ms = medState(m);
      var meta = (m.person ? esc(String(m.person).toUpperCase()) : "UNASSIGNED") +
        (m.dose ? " // " + esc(String(m.dose).toUpperCase()) : "") +
        " // SUPPLY " + (Number(m.supplyDays) || 0) + " DAYS" +
        (m.refillBy ? " // REFILL BY " + esc(m.refillBy) : "") +
        (m.expiry ? " // EXP " + esc(m.expiry) : "");
      return "<div class=\"nx-row\"><div class=\"nx-row-main\"><p class=\"nx-row-title\">" + esc(m.name) + "</p>" +
        "<p class=\"nx-row-meta\">" + meta + "</p></div>" +
        "<div class=\"nx-row-side\"><span class=\"nx-badge " + ms.st.cls + "\">" + ms.st.label + "</span>" +
        "<div class=\"nx-btn-row\" style=\"justify-content:flex-end;\">" +
        "<button type=\"button\" class=\"nx-btn nx-btn-small\" data-med-edit=\"" + m.id + "\">Edit</button>" +
        "<button type=\"button\" class=\"nx-btn nx-btn-small nx-btn-danger\" data-med-del=\"" + m.id + "\">Del</button>" +
        "</div></div></div>";
    }).join("");
  }

  function resetMedForm() {
    $("nx-med-form").reset();
    $("nx-med-id").value = "";
    $("nx-med-form-title").textContent = "Medications";
    $("nx-med-save").textContent = "Add Medication";
    $("nx-med-cancel-edit").style.display = "none";
  }

  function bindMeds() {
    $("nx-med-form").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var name = $("nx-med-name").value.trim();
      if (!name) return;
      var data = {
        person: $("nx-med-person").value.trim(),
        name: name,
        dose: $("nx-med-dose").value.trim(),
        supplyDays: Math.max(0, Math.round(Number($("nx-med-supply").value) || 0)),
        refillBy: $("nx-med-refill").value || null,
        expiry: $("nx-med-expiry").value || null
      };
      var id = $("nx-med-id").value;
      if (id) {
        state.meds.forEach(function (m) { if (m.id === id) Object.assign(m, data); });
      } else {
        data.id = uid();
        state.meds.push(data);
      }
      saveState();
      resetMedForm();
      renderAll();
      sfxConfirm();
    });
    $("nx-med-cancel-edit").addEventListener("click", resetMedForm);
    $("nx-med-list").addEventListener("click", function (ev) {
      var editBtn = ev.target.closest("[data-med-edit]");
      var delBtn = ev.target.closest("[data-med-del]");
      if (editBtn) {
        var m = state.meds.filter(function (x) { return x.id === editBtn.getAttribute("data-med-edit"); })[0];
        if (!m) return;
        $("nx-med-id").value = m.id;
        $("nx-med-person").value = m.person || "";
        $("nx-med-name").value = m.name;
        $("nx-med-dose").value = m.dose || "";
        $("nx-med-supply").value = m.supplyDays;
        $("nx-med-refill").value = m.refillBy || "";
        $("nx-med-expiry").value = m.expiry || "";
        $("nx-med-form-title").textContent = "Edit Medication";
        $("nx-med-save").textContent = "Save Changes";
        $("nx-med-cancel-edit").style.display = "";
        $("nx-med-name").focus();
      }
      if (delBtn) {
        var delId = delBtn.getAttribute("data-med-del");
        var item = state.meds.filter(function (x) { return x.id === delId; })[0];
        if (item && window.confirm("Delete medication: " + item.name + "?")) {
          state.meds = state.meds.filter(function (x) { return x.id !== delId; });
          saveState();
          renderAll();
        }
      }
    });
  }

  function renderCash() {
    var list = $("nx-cash-list");
    if (!list) return;
    var entries = Array.isArray(state.cash) ? state.cash : [];
    list.innerHTML = entries.length
      ? entries.map(function (c) {
          return "<div class=\"nx-row\"><div class=\"nx-row-main\"><p class=\"nx-row-title\">" + esc(c.where || "UNMARKED STASH") + "</p>" +
            "<p class=\"nx-row-meta\">CASH ON HAND</p></div>" +
            "<div class=\"nx-row-side\"><span class=\"nx-row-weight\">$" + fmt(c.amount, 0) + "</span>" +
            "<div class=\"nx-btn-row\" style=\"justify-content:flex-end;\">" +
            "<button type=\"button\" class=\"nx-btn nx-btn-small nx-btn-danger\" data-cash-del=\"" + c.id + "\">Del</button>" +
            "</div></div></div>";
        }).join("")
      : "<div class=\"nx-empty\">NO CASH LOGGED. SMALL BILLS IN THE GO-BAG AND AT HOME - LOG THEM HERE.</div>";
    var total = $("nx-cash-total");
    if (total) total.innerHTML = "TOTAL CASH ON HAND <b>$" + fmt(cashTotal(), 0) + "</b>";
  }

  function bindCash() {
    $("nx-cash-form").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var amount = Math.round((Number($("nx-cash-amount").value) || 0) * 100) / 100;
      if (!(amount > 0)) {
        showMsg($("nx-cash-msg"), "ENTER AN AMOUNT ABOVE ZERO.", "err");
        return;
      }
      state.cash.push({ id: uid(), amount: amount, where: $("nx-cash-where").value.trim() });
      saveState();
      ev.target.reset();
      renderAll();
      sfxConfirm();
    });
    $("nx-cash-list").addEventListener("click", function (ev) {
      var del = ev.target.closest("[data-cash-del]");
      if (!del) return;
      var id = del.getAttribute("data-cash-del");
      var c = state.cash.filter(function (x) { return x.id === id; })[0];
      if (c && window.confirm("Delete cash entry: $" + fmt(c.amount, 0) + (c.where ? " (" + c.where + ")" : "") + "?")) {
        state.cash = state.cash.filter(function (x) { return x.id !== id; });
        saveState();
        renderAll();
      }
    });
  }

  /* ---------------- barcode scanning (money build C) ----------------
     Point the camera at a barcode and the add form prefills - the
     form stays the confirmation, exactly like the photo-AI pattern
     in Munchling: prefill, the user edits, the user saves. Nothing
     ever auto-saves, and the gear cap still bites because a scan
     only fills the same form a manual add submits through.
     Live path: getUserMedia + the platform BarcodeDetector.
     Everywhere else (Safari / iOS, WebViews without the detector,
     a denied camera) the overlay swaps to a type-the-number panel,
     so scanning never dead-ends. The lookup itself is one function
     against Open Food Facts - a data call made only on a scan, so
     the offline-first shell never depends on it. */
  // One scanner, two modes (money build D): "barcode" is the
  // Build C flow above (target "store" | "gear"); "qr" is Squad
  // Sync (target "squad") reading qr_code frames through the
  // same overlay, the same camera discipline and the same
  // detect loop - only the format list, the copy and what a
  // decoded code does differ.
  var scan = { target: null, mode: "barcode", stream: null, detector: null, timer: 0, active: false, busy: false };

  function parseOffProduct(json) {
    // Defensive parse of an Open Food Facts v2 response into the
    // flat shape the prefill rules consume. Anything missing comes
    // back null, never undefined, never a throw.
    var out = { found: false, name: null, kcalPer100g: null, kcalServing: null, quantityGrams: null };
    if (!json || json.status !== 1 || !json.product) return out;
    var p = json.product;
    var brand = typeof p.brands === "string" ? p.brands.split(",")[0].trim() : "";
    var pname = typeof p.product_name === "string" ? p.product_name.trim() : "";
    if (pname && brand && pname.toLowerCase().indexOf(brand.toLowerCase()) !== 0) {
      out.name = (brand + " " + pname).replace(/\s+/g, " ").trim();
    } else {
      out.name = pname || brand || null;
    }
    var n = p.nutriments || {};
    var k100 = Number(n["energy-kcal_100g"]);
    if (isFinite(k100) && k100 > 0) out.kcalPer100g = k100;
    var kserv = Number(n["energy-kcal_serving"]);
    if (isFinite(kserv) && kserv > 0) out.kcalServing = kserv;
    // Package size in grams: prefer the structured quantity fields,
    // fall back to parsing the display string ("500 g", "1.5 kg").
    var qty = Number(p.product_quantity), unit = String(p.product_quantity_unit || "").toLowerCase();
    if (isFinite(qty) && qty > 0) {
      if (unit === "g") out.quantityGrams = qty;
      else if (unit === "kg") out.quantityGrams = qty * 1000;
    }
    if (out.quantityGrams == null && typeof p.quantity === "string") {
      var m = p.quantity.match(/(\d+(?:[.,]\d+)?)\s*(kg|g)\b/i);
      if (m) {
        var v = parseFloat(m[1].replace(",", "."));
        if (isFinite(v) && v > 0) out.quantityGrams = m[2].toLowerCase() === "kg" ? v * 1000 : v;
      }
    }
    out.found = true;
    return out;
  }

  function lookupBarcode(code) {
    // The one lookup function. Resolves to a result object on every
    // path - found, not found, HTTP error, network throw - and
    // never rejects, so the scan flow can always land on a prefill.
    var url = "https://world.openfoodfacts.org/api/v2/product/" + encodeURIComponent(code) + ".json";
    return fetch(url, { headers: { "Accept": "application/json" } }).then(function (res) {
      if (!res.ok) return { found: false, name: null, kcalPer100g: null, kcalServing: null, quantityGrams: null };
      return res.json();
    }).then(function (json) {
      return parseOffProduct(json);
    }).catch(function () {
      return { found: false, name: null, kcalPer100g: null, kcalServing: null, quantityGrams: null };
    });
  }

  function scanMsgEl(target) { return $(target === "gear" ? "nx-gear-msg" : "nx-store-msg"); }

  function prefillFromBarcode(target, code, res) {
    // The prefill rules. Store form, Food kind, gets the full
    // treatment because its kcal field drives Food Days:
    //   1. Package math when the pack size and per-100g energy are
    //      both known - kcal = per-100g x grams / 100, amount 1,
    //      unit "package". The most defensible single number: it
    //      is the whole pack the user is logging.
    //   2. Else the per-serving energy, which is also a whole-unit
    //      figure the user can sanity-check against the label.
    //   3. Else per-100g energy on its own - filled, but flagged
    //      in the message as per-100g so the user scales it.
    //   4. Found with no nutrition: name only, kcal left empty.
    // Water / Meds / Batteries stores and gear take the name only.
    // Not found (or offline): the name field carries
    // "BARCODE <code>" so the code is never lost and the user
    // edits it into the real name.
    var msgEl = scanMsgEl(target);
    if (target === "gear") {
      var gName = $("nx-g-name");
      if (res.found && res.name) {
        gName.value = res.name.slice(0, 80);
        showMsg(msgEl, "FILLED FROM BARCODE - CHECK THE DETAILS, THEN SAVE.", "good");
      } else {
        gName.value = ("BARCODE " + code).slice(0, 80);
        showMsg(msgEl, "NOT IN THE DATABASE - DETAILS LEFT FOR YOU.", "err");
      }
      gName.focus();
      return;
    }
    var sName = $("nx-s-name");
    if (!res.found || !res.name) {
      sName.value = ("BARCODE " + code).slice(0, 70);
      showMsg(msgEl, "NOT IN THE DATABASE - DETAILS LEFT FOR YOU.", "err");
      sName.focus();
      return;
    }
    sName.value = res.name.slice(0, 70);
    if ($("nx-s-kind").value !== "Food") {
      showMsg(msgEl, "FILLED FROM BARCODE - CHECK THE DETAILS, THEN SAVE.", "good");
      sName.focus();
      return;
    }
    if (res.quantityGrams != null && res.kcalPer100g != null) {
      $("nx-s-kcal").value = Math.round(res.kcalPer100g * res.quantityGrams / 100);
      $("nx-s-amount").value = 1;
      $("nx-s-unit").value = "package";
      showMsg(msgEl, "FILLED FROM BARCODE - CHECK THE DETAILS, THEN SAVE.", "good");
    } else if (res.kcalServing != null) {
      $("nx-s-kcal").value = Math.round(res.kcalServing);
      showMsg(msgEl, "FILLED FROM BARCODE - CHECK THE DETAILS, THEN SAVE.", "good");
    } else if (res.kcalPer100g != null) {
      $("nx-s-kcal").value = Math.round(res.kcalPer100g);
      showMsg(msgEl, "FILLED FROM BARCODE - KCAL IS PER 100G - CHECK THE PACK SIZE BEFORE YOU SAVE.", "good");
    } else {
      showMsg(msgEl, "FILLED FROM BARCODE - NO CALORIE DATA FOUND - ADD KCAL BY HAND, THEN SAVE.", "good");
    }
    sName.focus();
  }

  function stopScanCamera() {
    if (scan.timer) { clearTimeout(scan.timer); scan.timer = 0; }
    if (scan.stream) {
      scan.stream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} });
      scan.stream = null;
    }
    var v = $("nx-scan-video");
    if (v) { try { v.srcObject = null; } catch (e) {} }
    scan.detector = null;
    scan.busy = false;
  }

  function closeScanner() {
    stopScanCamera();
    scan.active = false;
    scan.target = null;
    scan.mode = "barcode";
    var ov = $("nx-scan");
    if (ov) ov.style.display = "none";
  }

  function showScanFallback(note) {
    stopScanCamera();
    $("nx-scan-frame").style.display = "none";
    $("nx-scan-fallback").style.display = "";
    var isQr = scan.mode === "qr";
    // The type-the-number row is a barcode affordance; a squad
    // code is far too long to type, so QR mode points at the
    // paste box in the Squad Sync panel instead.
    var inp = $("nx-scan-manual"), lookupBtn = $("nx-scan-lookup"), fbLabel = $("nx-scan-fallback-label");
    if (inp) inp.style.display = isQr ? "none" : "";
    if (lookupBtn) lookupBtn.style.display = isQr ? "none" : "";
    if (fbLabel) fbLabel.textContent = isQr ? "PASTE THE CODE TEXT IN THE SQUAD SYNC PANEL INSTEAD." : "TYPE THE NUMBER, THEN LOOK UP:";
    $("nx-scan-status").textContent = note || (isQr
      ? "NO CAMERA SCAN HERE - USE THE PASTE BOX IN THE SQUAD SYNC PANEL."
      : "NO CAMERA SCAN HERE - TYPE THE NUMBER UNDER THE BARCODE.");
    if (inp && !isQr) { inp.value = ""; setTimeout(function () { inp.focus(); }, 60); }
  }

  function onScanCode(code) {
    if (scan.mode === "qr") {
      // Squad codes are payload text: never whitespace-stripped
      // (frame chunks split the JSON at arbitrary offsets) and
      // the scanner stays open across frames - onScanSquad
      // decides when the set is complete.
      onScanSquad(String(code || ""));
      return;
    }
    code = String(code || "").replace(/\s+/g, "");
    if (!code) return;
    var target = scan.target;
    closeScanner();
    lookupBarcode(code).then(function (res) { prefillFromBarcode(target, code, res); });
  }

  function startScanDetect() {
    var video = $("nx-scan-video");
    var tick = function () {
      if (!scan.active || !scan.detector) return;
      scan.timer = setTimeout(tick, 250);
      if (scan.busy) return;
      scan.busy = true;
      scan.detector.detect(video).then(function (codes) {
        scan.busy = false;
        if (!scan.active) return;
        if (codes && codes.length && codes[0].rawValue) onScanCode(codes[0].rawValue);
      }).catch(function () { scan.busy = false; });
    };
    tick();
  }

  function openScanner(target, mode) {
    scan.target = target;
    scan.mode = mode === "qr" ? "qr" : "barcode";
    scan.active = true;
    $("nx-scan").style.display = "";
    $("nx-scan-frame").style.display = "";
    $("nx-scan-fallback").style.display = "none";
    var title = $("nx-scan-title");
    if (title) title.textContent = scan.mode === "qr" ? "SCAN A SQUAD CODE" : "POINT AT A BARCODE";
    var kicker = $("nx-scan-kicker");
    if (kicker) kicker.textContent = scan.mode === "qr" ? "Squad Sync" : "Barcode Scan";
    $("nx-scan-status").textContent = "STARTING CAMERA...";
    var canDetect = typeof window.BarcodeDetector === "function";
    var canCamera = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    if (!canDetect || !canCamera) { showScanFallback(); return; }
    try {
      scan.detector = new window.BarcodeDetector({
        formats: scan.mode === "qr" ? ["qr_code"] : ["upc_a", "upc_e", "ean_13", "ean_8", "code_128"]
      });
    } catch (e) { scan.detector = null; showScanFallback(); return; }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } }).then(function (stream) {
      if (!scan.active) { // cancelled while the permission prompt was up
        stream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} });
        return;
      }
      scan.stream = stream;
      var video = $("nx-scan-video");
      try { video.srcObject = stream; } catch (e) {}
      if (video.play) { var p = video.play(); if (p && p.catch) p.catch(function () {}); }
      $("nx-scan-status").textContent = scan.mode === "qr" ? "POINT THE CAMERA AT A SQUAD CODE." : "POINT THE CAMERA AT A BARCODE.";
      startScanDetect();
    }).catch(function () {
      if (scan.active) showScanFallback(scan.mode === "qr"
        ? "CAMERA UNAVAILABLE - USE THE PASTE BOX IN THE SQUAD SYNC PANEL."
        : "CAMERA UNAVAILABLE - TYPE THE NUMBER UNDER THE BARCODE.");
    });
  }

  function bindBarcode() {
    $("nx-store-scan").addEventListener("click", function () { openScanner("store"); });
    $("nx-gear-scan").addEventListener("click", function () { openScanner("gear"); });
    $("nx-scan-cancel").addEventListener("click", closeScanner);
    var runManual = function () { onScanCode($("nx-scan-manual").value); };
    $("nx-scan-lookup").addEventListener("click", runManual);
    $("nx-scan-manual").addEventListener("keydown", function (ev) { if (ev.key === "Enter") { ev.preventDefault(); runManual(); } });
  }

  /* ---------------- squad sync (money build D) ----------------
     QR Squad Sync, a $9.99 one-time add-on (entitlement:
     hasAddon("qr-sync"), server-owned - see the plan section).
     One user shows a code carrying their crew + loadout; a
     second user scans it and imports the lot with fresh ids.
     The payload is crew + gear ONLY - never vault data, never
     home-base coordinates, never emails or account ids (gear
     assignments travel as an index into the payload's own crew
     list, and entry ids are dropped entirely).
     Payload: <8-hex FNV-1a checksum> ":" <compact JSON>
       { v: 1,
         c: [[name, role, notes], ...],
         g: [[name, category, tier, weightValue, weightUnit,
              qty, expiryOrNull, assignedCrewIndexOr-1,
              location, envCsv], ...] }
     A payload up to 1800 chars travels as ONE code. Bigger
     loadouts split into frames of about 1780 payload chars,
     each shown code carrying the text "NXS1 <i>/<n> " before
     its chunk; the importer collects frames in any order until
     the set completes, then the same checksum + version gate
     runs. Corrupt or foreign codes are rejected with a clear
     message and nothing is imported. */
  var SQUAD_FRAME_MAX = 1800; // chars in a single code
  var SQUAD_CHUNK = 1780;     // payload chars per frame
  var SQUAD_MAX_FRAMES = 40;

  function squadChecksum(s) {
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return ("0000000" + (h >>> 0).toString(16)).slice(-8);
  }

  function squadPayloadText() {
    var idxById = {};
    var c = state.crew.map(function (m, i) {
      idxById[m.id] = i;
      return [m.name || "", m.role || "Other", m.notes || ""];
    });
    var g = state.gear.map(function (it) {
      var ai = (it.assignedTo && Object.prototype.hasOwnProperty.call(idxById, it.assignedTo)) ? idxById[it.assignedTo] : -1;
      return [
        it.name || "", it.category || "Other", it.tier || "T2",
        Number(it.weightValue) || 0, it.weightUnit || "lb",
        Math.max(1, Number(it.qty) || 1), it.expiry || null,
        ai, it.location || "", (Array.isArray(it.env) ? it.env : []).join(",")
      ];
    });
    var body = JSON.stringify({ v: 1, c: c, g: g });
    return squadChecksum(body) + ":" + body;
  }

  function squadFrames() {
    var full = squadPayloadText();
    if (full.length <= SQUAD_FRAME_MAX) return [full];
    var n = Math.ceil(full.length / SQUAD_CHUNK);
    var frames = [];
    for (var i = 0; i < n; i++) {
      frames.push("NXS1 " + (i + 1) + "/" + n + " " + full.slice(i * SQUAD_CHUNK, (i + 1) * SQUAD_CHUNK));
    }
    return frames;
  }

  function squadParse(full) {
    // The gate every completed payload passes before anything
    // is imported: shape, checksum, version, structure.
    if (typeof full !== "string" || full.indexOf(":") !== 8) return { error: "NOT A SQUAD CODE." };
    var sum = full.slice(0, 8), body = full.slice(9);
    if (!/^[0-9a-f]{8}$/.test(sum)) return { error: "NOT A SQUAD CODE." };
    if (squadChecksum(body) !== sum) return { error: "CODE DAMAGED - THE CHECKSUM DOES NOT MATCH. SCAN IT AGAIN." };
    var data = null;
    try { data = JSON.parse(body); } catch (e) { return { error: "CODE DAMAGED - IT COULD NOT BE READ." }; }
    if (!data || typeof data !== "object") return { error: "NOT A SQUAD CODE." };
    if (data.v !== 1) return { error: "THIS CODE IS FROM A DIFFERENT VERSION OF SQUAD SYNC." };
    if (!Array.isArray(data.c) || !Array.isArray(data.g)) return { error: "NOT A SQUAD CODE." };
    return { complete: true, data: data };
  }

  /* Frame collector, shared by the camera path and the paste
   * box. feed() answers { complete, data } when a payload is
   * whole and validated, { partial, got, n } while frames are
   * still missing, or { error } for anything else. A frame
   * naming a different set size restarts the set - the newest
   * export wins. */
  var squadRx = { n: 0, parts: {} };
  function squadCollectReset() { squadRx = { n: 0, parts: {} }; }
  function squadCollect(text) {
    text = String(text == null ? "" : text).trim();
    if (!text) return { error: "NO CODE THERE - SCAN OR PASTE ONE FIRST." };
    var m = text.match(/^NXS1\s+(\d+)\s*\/\s*(\d+)\s+([\s\S]+)$/);
    if (m) {
      var idx = Number(m[1]), n = Number(m[2]);
      if (!(idx >= 1 && idx <= n) || n < 2 || n > SQUAD_MAX_FRAMES) {
        return { error: "THAT FRAME DOES NOT LOOK RIGHT - SCAN IT AGAIN." };
      }
      if (squadRx.n !== n) squadRx = { n: n, parts: {} };
      squadRx.parts[idx] = m[3];
      var got = Object.keys(squadRx.parts).length;
      if (got < n) return { partial: true, got: got, n: n };
      var full = "";
      for (var i = 1; i <= n; i++) full += squadRx.parts[i];
      squadCollectReset();
      return squadParse(full);
    }
    if (/^NXS1\b/.test(text)) return { error: "THAT SQUAD FRAME IS DAMAGED - SCAN IT AGAIN." };
    return squadParse(text);
  }

  function squadSanitize(data) {
    // Untrusted input: every field is re-clamped to the same
    // shapes the crew / gear forms themselves produce.
    function str(v, max) { return typeof v === "string" ? v.slice(0, max) : ""; }
    function num(v, lo, hi, fb) { v = Number(v); return isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fb; }
    var crew = [];
    data.c.forEach(function (row) {
      if (!Array.isArray(row)) return;
      var name = str(row[0], 50);
      if (!name) return;
      crew.push({
        name: name,
        role: ["Adult", "Child", "Pet", "Other"].indexOf(row[1]) !== -1 ? row[1] : "Other",
        notes: str(row[2], 140)
      });
    });
    var gear = [];
    data.g.forEach(function (row) {
      if (!Array.isArray(row)) return;
      var name = str(row[0], 80);
      if (!name) return;
      var env = typeof row[9] === "string"
        ? row[9].split(",").filter(function (t) { return ENV_TAGS.indexOf(t) !== -1; })
        : [];
      gear.push({
        name: name,
        category: CATEGORIES.indexOf(row[1]) !== -1 ? row[1] : "Other",
        tier: ["T1", "T2", "T3"].indexOf(row[2]) !== -1 ? row[2] : "T2",
        weightValue: num(row[3], 0, 100000, 0),
        weightUnit: ["lb", "oz", "kg", "g"].indexOf(row[4]) !== -1 ? row[4] : "lb",
        qty: Math.round(num(row[5], 1, 9999, 1)),
        expiry: typeof row[6] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(row[6]) ? row[6] : null,
        assignedIdx: Math.round(num(row[7], -1, 100000, -1)),
        location: str(row[8], 60),
        env: env
      });
    });
    return { crew: crew, gear: gear };
  }

  function importSquadData(data) {
    // MERGE, never replace: existing entries are untouched and
    // every imported entry gets a fresh id. The free plan caps
    // still bite (crew / gear) for non-Operators; whatever does
    // not fit is counted and reported, never silently dropped.
    var clean = squadSanitize(data);
    var capped = !isOperator();
    var crewRoom = capped ? Math.max(0, PLAN_CAPS.crew - state.crew.length) : Infinity;
    var gearRoom = capped ? Math.max(0, PLAN_CAPS.gear - state.gear.length) : Infinity;
    var idByIdx = {};
    var addedCrew = 0, skippedCrew = 0, addedGear = 0, skippedGear = 0;
    clean.crew.forEach(function (m, i) {
      if (addedCrew >= crewRoom) { skippedCrew++; idByIdx[i] = null; return; }
      var nm = { id: uid(), name: m.name, role: m.role, notes: m.notes };
      state.crew.push(nm);
      idByIdx[i] = nm.id;
      addedCrew++;
    });
    clean.gear.forEach(function (g) {
      if (addedGear >= gearRoom) { skippedGear++; return; }
      state.gear.push({
        id: uid(), name: g.name, category: g.category, tier: g.tier,
        weightValue: g.weightValue, weightUnit: g.weightUnit, qty: g.qty,
        expiry: g.expiry,
        assignedTo: (g.assignedIdx >= 0 && idByIdx[g.assignedIdx]) ? idByIdx[g.assignedIdx] : "",
        location: g.location, env: g.env
      });
      addedGear++;
    });
    saveState();
    renderAll();
    return { crew: addedCrew, gear: addedGear, skippedCrew: skippedCrew, skippedGear: skippedGear };
  }

  function squadImportMessage(r) {
    var msg = "IMPORTED " + r.crew + " CREW, " + r.gear + " GEAR.";
    var sk = [];
    if (r.skippedCrew) sk.push(r.skippedCrew + " CREW SKIPPED AT THE FREE CAP");
    if (r.skippedGear) sk.push(r.skippedGear + " GEAR SKIPPED AT THE FREE CAP");
    if (sk.length) msg = "IMPORTED " + r.crew + " CREW, " + r.gear + " GEAR - " + sk.join(" - ") + ".";
    return msg;
  }

  /* One feed for both import paths: feed a decoded code (or a
   * pasted line) and the panel message reports the outcome -
   * progress while frames are missing, the import summary on
   * completion, the rejection reason otherwise. */
  function feedSquadText(text) {
    var res = squadCollect(text);
    var msgEl = $("nx-squad-msg");
    if (res.complete) {
      var r = importSquadData(res.data);
      if (msgEl) showMsg(msgEl, squadImportMessage(r), "good");
    } else if (res.partial) {
      if (msgEl) showMsg(msgEl, "GOT " + res.got + " OF " + res.n + " - KEEP SCANNING.", "");
    } else if (msgEl) {
      showMsg(msgEl, res.error || "NOT A SQUAD CODE.", "err");
    }
    return res;
  }

  /* The camera path: partial sets and foreign codes keep the
   * scanner open with the status line as the report; only a
   * completed, validated payload closes it and imports. */
  function onScanSquad(text) {
    var res = squadCollect(text);
    if (res.complete) {
      closeScanner();
      var r = importSquadData(res.data);
      var msgEl = $("nx-squad-msg");
      if (msgEl) showMsg(msgEl, squadImportMessage(r), "good");
    } else if (res.partial) {
      $("nx-scan-status").textContent = "GOT " + res.got + " OF " + res.n + " - KEEP SCANNING.";
    } else {
      $("nx-scan-status").textContent = res.error || "NOT A SQUAD CODE.";
    }
  }

  /* ---------------- squad sync panel ---------------- */
  var squadUi = { frames: [], idx: 0 };

  function drawSquadFrame() {
    var cv = $("nx-squad-canvas");
    if (!cv || !squadUi.frames.length) return;
    if (window.NXQR) window.NXQR.draw(cv, squadUi.frames[squadUi.idx]);
    var line = $("nx-squad-frame-line");
    if (line) {
      line.textContent = squadUi.frames.length > 1
        ? "CODE " + (squadUi.idx + 1) + " OF " + squadUi.frames.length + " - THE OTHER PHONE SCANS EACH ONE IN ANY ORDER"
        : "ONE CODE CARRIES THE WHOLE SQUAD";
    }
    var prev = $("nx-squad-prev"), next = $("nx-squad-next");
    if (prev) prev.disabled = squadUi.idx <= 0;
    if (next) next.disabled = squadUi.idx >= squadUi.frames.length - 1;
  }

  function showSquadCode() {
    squadUi.frames = squadFrames();
    squadUi.idx = 0;
    var wrap = $("nx-squad-codewrap");
    if (wrap) wrap.style.display = "";
    drawSquadFrame();
  }

  function renderSquad() {
    // Toggles + counts only: the panel markup is static and the
    // canvas / paste box must survive renderAll untouched.
    var locked = $("nx-squad-locked"), open = $("nx-squad-open");
    if (!locked || !open) return;
    var has = hasAddon("qr-sync");
    locked.style.display = has ? "none" : "";
    open.style.display = has ? "" : "none";
    if (has) {
      var line = $("nx-squad-counts");
      if (line) line.textContent = state.crew.length + " CREW - " + state.gear.length + " GEAR";
    }
  }

  function bindSquad() {
    var show = $("nx-squad-show");
    if (show) show.addEventListener("click", showSquadCode);
    var prev = $("nx-squad-prev");
    if (prev) prev.addEventListener("click", function () {
      if (squadUi.idx > 0) { squadUi.idx--; drawSquadFrame(); }
    });
    var next = $("nx-squad-next");
    if (next) next.addEventListener("click", function () {
      if (squadUi.idx < squadUi.frames.length - 1) { squadUi.idx++; drawSquadFrame(); }
    });
    var imp = $("nx-squad-import");
    if (imp) imp.addEventListener("click", function () {
      squadCollectReset();
      openScanner("squad", "qr");
    });
    var pasteBtn = $("nx-squad-paste-btn");
    if (pasteBtn) pasteBtn.addEventListener("click", function () {
      var ta = $("nx-squad-paste");
      var lines = String(ta && ta.value || "").split(/\r?\n/);
      squadCollectReset();
      var last = null;
      for (var i = 0; i < lines.length; i++) {
        if (lines[i].trim()) last = feedSquadText(lines[i]);
      }
      if (!last) showMsg($("nx-squad-msg"), "PASTE A SQUAD CODE FIRST.", "err");
      else if (last.complete && ta) ta.value = "";
    });
  }

  /* ---------------- offline map packs (money build E) ----------------
     Offline Map Packs, a per-state add-on: $9.99 per state or
     $29.99 for all 50 (entitlement: hasMapPack(code),
     server-owned - see the plan section). A pack is one small
     static JSON on the site (maps/<code>.json: a simplified
     state outline plus major-city POIs, generated at build
     time from public-domain Census / GeoNames data by
     scripts/gen-maps.js). It is NOT precached by the service
     worker and NOT part of the native bundle: the add-on
     unlocks a DOWNLOAD, the pack lands in IndexedDB on this
     device, and from then on the map screen renders it with
     zero connection. No external map tiles anywhere - the map
     is an inline SVG schematic and the copy says so:
     SCHEMATIC STATE MAP - NOT FOR NAVIGATION.
     Viewing a downloaded pack needs no account and no
     connection; downloading needs a connection, once. */

  var MAP_DB_NAME = "nyxsurvive-maps";
  var mapLocal = {};      // code -> true: packs present in IndexedDB (loaded async)
  var mapOpenCode = null; // state code currently on the map screen

  function mapDb() {
    return new Promise(function (resolve, reject) {
      if (!window.indexedDB) { reject(new Error("no-indexeddb")); return; }
      var req = window.indexedDB.open(MAP_DB_NAME, 1);
      req.onupgradeneeded = function () {
        req.result.createObjectStore("packs", { keyPath: "code" });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error("idb-open")); };
    });
  }
  function mapStore(db, mode) {
    return db.transaction("packs", mode).objectStore("packs");
  }
  function mapPackGet(code) {
    return mapDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var req = mapStore(db, "readonly").get(code);
        req.onsuccess = function () { resolve(req.result || null); };
        req.onerror = function () { reject(req.error || new Error("idb-get")); };
      });
    }).catch(function () { return null; });
  }
  function mapPackPut(pack) {
    return mapDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var req = mapStore(db, "readwrite").put(pack);
        req.onsuccess = function () { resolve(true); };
        req.onerror = function () { reject(req.error || new Error("idb-put")); };
      });
    });
  }
  function mapPackRemove(code) {
    return mapDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var req = mapStore(db, "readwrite").delete(code);
        req.onsuccess = function () { resolve(true); };
        req.onerror = function () { reject(req.error || new Error("idb-del")); };
      });
    });
  }
  function mapPackCodes() {
    return mapDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var req = mapStore(db, "readonly").getAllKeys();
        req.onsuccess = function () { resolve(req.result || []); };
        req.onerror = function () { reject(req.error || new Error("idb-keys")); };
      });
    }).catch(function () { return []; });
  }
  async function refreshMapLocal() {
    var codes = await mapPackCodes();
    var next = {};
    codes.forEach(function (c) { next[c] = true; });
    mapLocal = next;
    return mapLocal;
  }

  function mapStateName(code) {
    for (var i = 0; i < MAP_STATES.length; i++) {
      if (MAP_STATES[i][0] === code) return MAP_STATES[i][1];
    }
    return String(code || "").toUpperCase();
  }
  function mapPackUrl(code) { return apiUrl("/maps/" + code + ".json"); }

  async function downloadMapPack(code) {
    var msg = $("nx-maps-msg");
    if (!hasMapPack(code)) {
      showMsg(msg, mapStateName(code).toUpperCase() + " IS NOT UNLOCKED - BUY THE PACK OR THE ALL-50 BUNDLE FIRST.", "err");
      return false;
    }
    showMsg(msg, "DOWNLOADING " + mapStateName(code).toUpperCase() + " PACK...", "");
    try {
      var res = await fetch(mapPackUrl(code));
      if (!res.ok) throw new Error("http " + res.status);
      var pack = await res.json();
      if (!pack || pack.code !== code || !Array.isArray(pack.rings) || !pack.rings.length ||
          !Array.isArray(pack.bbox) || !Array.isArray(pack.pois)) {
        throw new Error("bad pack");
      }
      await mapPackPut(pack);
      mapLocal[code] = true;
      renderMaps();
      showMsg(msg, mapStateName(code).toUpperCase() + " PACK ON DEVICE - IT NOW WORKS FULLY OFFLINE.", "good");
      return true;
    } catch (e) {
      showMsg(msg, "DOWNLOAD FAILED - CHECK YOUR CONNECTION AND TRY AGAIN. DOWNLOADING IS THE ONLY STEP THAT NEEDS ONE.", "err");
      return false;
    }
  }

  async function deleteMapPack(code) {
    try { await mapPackRemove(code); } catch (e) { /* the local flag drops either way */ }
    delete mapLocal[code];
    if (mapOpenCode === code) closeMapScreen();
    renderMaps();
    showMsg($("nx-maps-msg"), mapStateName(code).toUpperCase() + " PACK REMOVED FROM THIS DEVICE. THE ADD-ON IS STILL YOURS - DOWNLOAD IT AGAIN ANY TIME.", "");
    return true;
  }

  /* The schematic renderer: an equirectangular projection of
   * the pack bbox (longitude scaled by cos of the mid latitude
   * so shapes stay honest), outline paths, POI dots with
   * labels, the capital marked, and - only from this device's
   * own settings - the home-base marker when it falls inside
   * the state. Pure string building: no tiles, no network, no
   * libraries. */
  function mapSvg(pack) {
    var bb = pack.bbox;
    var midLat = (bb[1] + bb[3]) / 2 * Math.PI / 180;
    var kx = Math.cos(midLat);
    var spanX = Math.max(0.01, (bb[2] - bb[0]) * kx);
    var spanY = Math.max(0.01, bb[3] - bb[1]);
    var W = 1000, H = Math.max(200, Math.round(W * spanY / spanX));
    function X(lng) { return ((lng - bb[0]) * kx / spanX * W).toFixed(1); }
    function Y(lat) { return ((bb[3] - lat) / spanY * H).toFixed(1); }
    var out = ['<svg class="nx-map-svg" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="' + esc(pack.name) + ' schematic map">'];
    pack.rings.forEach(function (ring) {
      var d = "";
      ring.forEach(function (p, i) { d += (i ? "L" : "M") + X(p[0]) + " " + Y(p[1]); });
      out.push('<path class="nx-map-land" d="' + d + 'Z"/>');
    });
    (pack.pois || []).forEach(function (poi) {
      var x = Number(X(poi.lng)), y = Number(Y(poi.lat));
      out.push('<circle class="nx-map-poi' + (poi.cap ? " nx-map-cap" : "") + '" cx="' + x + '" cy="' + y + '" r="' + (poi.cap ? 9 : 6) + '"/>');
    });
    // Labels declutter: at state scale a metro cluster (the
    // Phoenix valley cities, say) piles every name onto the
    // same few pixels. Every city keeps its dot; a name is
    // drawn only when it clears the names already placed.
    // Capitals always label and claim their space first;
    // the rest go largest-first (the pack order).
    var labeled = [];
    function labelFits(x, y) {
      for (var i = 0; i < labeled.length; i++) {
        if (Math.abs(labeled[i][0] - x) < 115 && Math.abs(labeled[i][1] - y) < 38) return false;
      }
      labeled.push([x, y]);
      return true;
    }
    var poiOrder = (pack.pois || []).slice().sort(function (a, b) {
      if (!!a.cap !== !!b.cap) return a.cap ? -1 : 1;
      return (b.pop || 0) - (a.pop || 0);
    });
    poiOrder.forEach(function (poi) {
      var x = Number(X(poi.lng)), y = Number(Y(poi.lat));
      if (poi.cap) labeled.push([x, y]);
      else if (!labelFits(x, y)) return;
      out.push('<text class="nx-map-label' + (poi.cap ? " nx-map-cap-label" : "") + '" x="' + (x + 13) + '" y="' + (y + 5) + '">' + esc(poi.n) + "</text>");
    });
    var hLat = state.settings.homeLat, hLng = state.settings.homeLng;
    if (typeof hLat === "number" && typeof hLng === "number" &&
        hLng >= bb[0] && hLng <= bb[2] && hLat >= bb[1] && hLat <= bb[3]) {
      var hx = Number(X(hLng)), hy = Number(Y(hLat));
      out.push('<path class="nx-map-home" d="M' + hx + " " + (hy - 14) + " L" + (hx + 11) + " " + hy + " L" + hx + " " + (hy + 14) + " L" + (hx - 11) + " " + hy + 'Z"/>');
      // The home base is usually IN the capital city, so its
      // label would land exactly on that city's name. When a
      // placed label sits where the home label wants to go,
      // the home label drops below the diamond instead.
      var homeLabelY = hy + 5;
      for (var li = 0; li < labeled.length; li++) {
        if (Math.abs(labeled[li][0] - hx) < 120 && Math.abs(labeled[li][1] - hy) < 40) { homeLabelY = hy + 40; break; }
      }
      out.push('<text class="nx-map-home-label" x="' + (hx + 16) + '" y="' + homeLabelY + '">HOME BASE</text>');
    }
    out.push("</svg>");
    return out.join("");
  }

  async function openMapState(code) {
    var pack = await mapPackGet(code);
    if (!pack) {
      showMsg($("nx-maps-msg"), mapStateName(code).toUpperCase() + " IS NOT ON THIS DEVICE - DOWNLOAD IT FIRST.", "err");
      return false;
    }
    mapOpenCode = code;
    var title = $("nx-map-screen-title");
    if (title) title.textContent = pack.name + " - Offline Pack";
    var box = $("nx-map-screen");
    if (box) box.innerHTML = mapSvg(pack);
    var panel = $("nx-map-screen-panel");
    if (panel) {
      panel.style.display = "";
      if (panel.scrollIntoView) panel.scrollIntoView();
    }
    return true;
  }
  function closeMapScreen() {
    mapOpenCode = null;
    var panel = $("nx-map-screen-panel");
    if (panel) panel.style.display = "none";
    var box = $("nx-map-screen");
    if (box) box.innerHTML = "";
  }

  function renderMaps() {
    var locked = $("nx-maps-locked"), counts = $("nx-maps-counts");
    if (!locked || !counts) return;
    var bundle = $("nx-maps-bundle");
    var owned = 0, onDevice = 0;
    MAP_STATES.forEach(function (s) {
      if (hasMapPack(s[0])) owned++;
      if (mapLocal[s[0]]) onDevice++;
    });
    locked.style.display = owned ? "none" : "";
    if (bundle) bundle.style.display = (hasAddon("map-pack-us") || isOwner()) ? "none" : "";
    counts.textContent = owned + " OF 50 STATES UNLOCKED - " + onDevice + " ON THIS DEVICE";
    var list = $("nx-maps-list");
    if (!list) return;
    var html = "";
    MAP_STATES.forEach(function (s) {
      var code = s[0], name = s[1];
      var has = hasMapPack(code), local = !!mapLocal[code];
      html += '<div class="nx-map-row" data-map-code="' + code + '">';
      html += '<span class="nx-map-name">' + esc(name) + "</span>";
      if (has && local) {
        html += '<span class="nx-map-chip nx-map-chip-on">ON DEVICE</span>';
        html += '<span class="nx-map-actions"><button type="button" class="nx-btn nx-btn-accent" data-map-open="' + code + '">Open</button>';
        html += '<button type="button" class="nx-btn" data-map-delete="' + code + '">Delete</button></span>';
      } else if (has) {
        html += '<span class="nx-map-chip nx-map-chip-owned">OWNED</span>';
        html += '<span class="nx-map-actions"><button type="button" class="nx-btn nx-btn-accent" data-map-download="' + code + '">Download</button></span>';
      } else {
        html += '<span class="nx-map-chip">$9.99</span>';
        html += '<span class="nx-map-actions"><button type="button" class="nx-btn nx-buy-ui" data-map-buy="' + code + '">Buy</button></span>';
      }
      html += "</div>";
    });
    list.innerHTML = html;
    if (mapOpenCode && !mapLocal[mapOpenCode]) closeMapScreen();
  }

  function bindMaps() {
    var list = $("nx-maps-list");
    if (list) list.addEventListener("click", function (ev) {
      var t = ev.target;
      if (!t.closest) return;
      var buy = t.closest("[data-map-buy]");
      if (buy) { startCheckout("map-pack-state", { state: buy.getAttribute("data-map-buy") }); return; }
      var dl = t.closest("[data-map-download]");
      if (dl) { downloadMapPack(dl.getAttribute("data-map-download")); return; }
      var op = t.closest("[data-map-open]");
      if (op) { openMapState(op.getAttribute("data-map-open")); return; }
      var del = t.closest("[data-map-delete]");
      if (del) { deleteMapPack(del.getAttribute("data-map-delete")); return; }
    });
    var bundleBtn = $("nx-maps-buy-us");
    if (bundleBtn) bundleBtn.addEventListener("click", function () { startCheckout("map-pack-us"); });
    var close = $("nx-map-close");
    if (close) close.addEventListener("click", closeMapScreen);
    // The on-device set is device storage, not save state:
    // load it once at bind time, then keep the list honest.
    refreshMapLocal().then(function () { renderMaps(); });
  }

  /* ---------------- field guide (offline reference) ----------------
     First aid and survival reference library, bundled whole
     into app.js: no network, no account, no plan gate - free
     for every tier, riding the shell precache and the native
     bundle like every other core asset. The content is a
     memory aid for lay responders, written in-house as short
     field steps: DO, DO NOT, and a GET HELP IF red-flag line.
     It is not a substitute for training or professional care. */
  var GUIDE_CATS = [
    { name: "Bleeding and Wounds", topics: [
      { t: "Severe bleeding and tourniquets",
        "do": ["Call 911, or send a specific person to call and come back.", "Press hard on the wound with a clean cloth, pad or clothing. Use both hands and lean in.", "If blood soaks through, add more cloth on top and keep pressing - do not lift to check.", "For a deep wound, pack cloth tightly into it, then press on top.", "If trained and hard pressure is not stopping limb bleeding, place a tourniquet 2 to 3 inches above the wound, tighten until bleeding stops, and note the time.", "Keep the person lying down, warm and still until help arrives."],
        "dont": ["Do not remove soaked cloth - add more on top.", "Do not loosen or remove a tourniquet once it is on.", "Do not use a thin cord or wire as a tourniquet - it cuts without stopping flow.", "Do not give food or drink - surgery may be needed."],
        help: "Bleeding that will not slow after 10 minutes of hard pressure, blood spurting or pooling, or the person turning pale, sweaty, confused or faint. These are 911 signs - keep pressure on and do not leave them." },
      { t: "Cleaning a wound",
        "do": ["Wash your own hands first if you can.", "Rinse the wound under clean running water for several minutes to wash dirt out.", "Wash the skin around the wound with soap, keeping soap out of the cut itself.", "Pick out visible dirt or gravel with clean tweezers.", "Cover with a clean dressing or bandage and change it daily, or sooner if it gets wet or dirty.", "Ask a clinician about a tetanus shot if the wound is dirty and the last shot was over 5 years ago."],
        "dont": ["Do not scrub inside a deep wound.", "Do not pour peroxide, alcohol or iodine into the wound - they damage healing tissue.", "Do not close a dirty wound with tape or glue - trapped dirt breeds infection."],
        help: "You cannot get the dirt out, the wound is deep, gaping or on the face, or it came from a bite - animal or human bites always need medical care." },
      { t: "Signs of wound infection",
        "do": ["Check the wound daily for spreading redness, swelling, warmth or rising pain.", "Watch for pus, red streaks running away from the wound, and fever.", "Keep the wound clean and dry, and change dressings on schedule.", "Mark the edge of the redness with a pen and note the time - spreading past the line means it is getting worse.", "Seek care early - infections are far easier to treat in the first day."],
        "dont": ["Do not wait and see on red streaks or fever - that is the infection moving.", "Do not squeeze or lance a swollen wound yourself."],
        help: "Red streaks, fever over 100.4 F, swelling that keeps growing, or any infected wound in a person with diabetes or a weak immune system. Face, hand and joint infections are urgent too." }
    ]},
    { name: "CPR and Choking", topics: [
      { t: "Adult CPR basics",
        "do": ["Check response: shout and tap the shoulders. No response and no normal breathing means start.", "Call 911 on speakerphone, or send someone. Send a second person for an AED if one is nearby.", "Place the heel of one hand in the center of the chest, the other hand on top, arms straight.", "Push hard and fast: about 2 inches deep, 100 to 120 pushes a minute - the beat of a fast song.", "Let the chest come fully back up between pushes. Do not lean on it.", "If trained, give 2 breaths after every 30 pushes. If not, keep pushing without stopping.", "Use the AED the moment it arrives: turn it on and follow its voice prompts."],
        "dont": ["Do not stop for more than a few seconds - every pause drops survival odds.", "Do not spend more than 10 seconds checking for a pulse.", "Do not be afraid of pushing hard - broken ribs heal, a stopped heart does not restart itself."],
        help: "Always - CPR means 911 is on the way. Keep going until responders take over, an AED says to stop, or the person breathes normally and moves." },
      { t: "Child CPR basics",
        "do": ["Call 911 on speakerphone. If you are alone with no phone, do about 2 minutes of CPR first, then call.", "Push in the center of the chest about 2 inches deep, 100 to 120 a minute. Use one hand for a small child, two for a bigger one.", "For a baby, use two fingers in the center of the chest, about 1.5 inches deep.", "If trained, give 2 gentle breaths after every 30 pushes - just enough to make the chest rise.", "Use an AED when it arrives - child pads if available, adult pads are fine if not."],
        "dont": ["Do not use full adult force on a small child.", "Do not leave a child to find a phone if you can call on speaker while you work.", "Do not blow hard into a baby - small puffs only."],
        help: "Always - a child who needs CPR needs 911 and hospital care even if they revive. Keep going until responders take over." },
      { t: "Choking - adult and child",
        "do": ["Ask: are you choking? If they can speak and cough hard, let them cough and stay close.", "If they cannot speak or the cough is weak, lean them forward and give 5 firm blows between the shoulder blades with the heel of your hand.", "Then stand behind them, fist above the navel, and give 5 sharp inward and upward thrusts.", "Alternate 5 blows and 5 thrusts until the object clears or they go limp.", "For a baby under 1: face-down along your forearm, 5 back blows, then turn over and give 5 chest thrusts with two fingers.", "If they go limp, lower them to the ground, call 911 and start CPR. Look in the mouth before breaths and remove only what you can see."],
        "dont": ["Do not do abdominal thrusts on a baby under 1 year old.", "Do not reach blindly into the mouth - you can push the object deeper.", "Do not slap the back of someone standing upright and coughing well - let the cough work."],
        help: "The object will not clear, the person goes limp, or breathing stays noisy or strained after it clears - that needs 911 and a hospital check." }
    ]},
    { name: "Fractures, Sprains, Dislocations", topics: [
      { t: "Broken bone basics",
        "do": ["Keep the limb still and support it in the position you found it.", "Splint it: padding first, then something rigid - a board, rolled magazine or stick - tied above and below the break, not over it.", "Put ice wrapped in cloth on it for 15 to 20 minutes at a time to slow swelling.", "Check fingers or toes past the injury often: they should stay warm, pink and able to feel.", "For an arm, a sling made from a shirt or cloth keeps it supported against the body."],
        "dont": ["Do not try to straighten a bent limb.", "Do not let the person put weight on a broken leg or foot.", "Do not tie a splint tight - tingling or color change means loosen it."],
        help: "Bone poking through skin, a limb that is blue, cold or numb, heavy bleeding, or any injury to the head, neck, back or pelvis. Those are 911 calls." },
      { t: "Sprains and strains",
        "do": ["Rest the joint - stop using it.", "Ice it 15 to 20 minutes at a time, several times in the first two days.", "Wrap it snug with an elastic bandage, starting away from the heart and working toward it.", "Raise it above heart level when you can to drain swelling.", "Recheck in 48 hours - steady improvement is a good sign."],
        "dont": ["Do not wrap so tight that fingers or toes tingle, pale or throb.", "Do not apply heat on the first day - it feeds swelling.", "Do not push through sharp pain to test it."],
        help: "You cannot bear weight on it, the joint looks crooked, there is numbness, or it is no better after 2 to 3 days - that can be a break hiding as a sprain." },
      { t: "Dislocation",
        "do": ["Keep the joint completely still and support it with pillows or padding.", "Put ice wrapped in cloth on the joint.", "Check feeling, color and pulse in the hand or foot beyond the joint, and recheck often.", "Get to medical care - a dislocated joint needs to be put back by a professional."],
        "dont": ["Do not try to pop the joint back in yourself.", "Do not let the person eat or drink much - sedation may be needed to fix it."],
        help: "Always - every dislocation needs medical care. A hand or foot beyond the joint that is pale, cold or numb is an emergency." }
    ]},
    { name: "Burns", topics: [
      { t: "Thermal burns",
        "do": ["Cool the burn under cool running water for at least 20 minutes. This is the single most useful step.", "Remove rings, watches and loose clothing near the burn before swelling starts - unless fabric is stuck to the burn.", "Cover loosely with a clean non-stick dressing, or clean plastic wrap laid on, not wrapped tight.", "Treat pain with an over-the-counter pain reliever as directed.", "Keep the person warm overall - a large burn loses body heat fast."],
        "dont": ["Do not use ice or iced water - it deepens the injury.", "Do not pop blisters - they are a sterile cover.", "Do not put butter, oils, toothpaste or creams on a fresh burn.", "Do not peel off clothing stuck to the burn."],
        help: "A burn bigger than the person's palm, any burn on the face, hands, feet, joints or genitals, white, brown or charred skin, or a burn that circles a limb. Electrical and chemical burns always need care." },
      { t: "Sunburn",
        "do": ["Get out of the sun and stay out.", "Cool the skin with a cool shower or damp cloths.", "After cooling, use a plain moisturizer or aloe to keep skin from drying out.", "Drink extra water - burned skin pulls fluid from the body.", "Wear loose, soft clothing over the burn."],
        "dont": ["Do not pop sunburn blisters.", "Do not go back out the next day thinking a base burn protects you.", "Do not use numbing sprays with benzocaine on small children."],
        help: "Blistering over a large area, fever, chills, confusion, dizziness or signs of dehydration. A sunburned baby under 1 year old should be seen the same day." },
      { t: "When a burn is serious",
        "do": ["Treat burns from a fire in an enclosed space as an airway emergency - soot around the nose or mouth and a hoarse voice are danger signs.", "Cover a serious burn with a clean, dry cloth and get moving toward care.", "Keep the person warm and lying down for large burns.", "Call 911 for any burn larger than the person's palm that is deep, or any burn with trouble breathing."],
        "dont": ["Do not delay care to finish dressing a serious burn - cover and go.", "Do not give a person with a large burn lots to drink - sips only."],
        help: "Trouble breathing, burns on the face or airway, skin that looks white, brown, black or leathery, burns circling an arm or leg, or a burn in a baby, an older adult, or someone with diabetes." }
    ]},
    { name: "Heat and Cold", topics: [
      { t: "Heat exhaustion",
        "do": ["Stop all activity and move to shade or the coolest place available.", "Loosen or remove extra clothing.", "Cool the skin: wet cloths on the neck, armpits and groin, and fan them.", "Give small, steady sips of water or an electrolyte drink.", "Know the picture: heavy sweating, pale or clammy skin, nausea, cramps, headache, dizziness."],
        "dont": ["Do not give drinks to someone who is vomiting or confused.", "Do not leave them alone - exhaustion can tip into heatstroke.", "Do not send them back out to finish the job."],
        help: "Vomiting, confusion, fainting, or no clear improvement within 30 minutes of cooling and fluids. Those can be the start of heatstroke." },
      { t: "Heatstroke",
        "do": ["Call 911 first - heatstroke kills and minutes matter.", "Cool them fast, any way you can: cold water over the whole body is best. A tub, a hose, wet towels replaced constantly, plus fanning.", "Put ice packs wrapped in cloth at the neck, armpits and groin if water is limited.", "Know the picture: very hot skin, confusion or slurred speech, staggering, seizure, or passing out. Skin may be dry or sweaty.", "Keep cooling until help arrives or their thinking clears."],
        "dont": ["Do not give fluids to someone confused or barely awake.", "Do not wait to see if they cool down on their own.", "Do not wrap them in dry blankets to stop shivering during cooling."],
        help: "This is the emergency itself. Confusion, collapse or a seizure in the heat means 911 and aggressive cooling, right now." },
      { t: "Hypothermia",
        "do": ["Get them out of wind, rain and cold, and off cold ground.", "Remove wet clothing and wrap them in dry blankets, covering the head.", "Warm the core first - chest, neck and groin - with wrapped warm water bottles or body heat.", "Give warm, sweet drinks only if they are fully awake and can swallow.", "Know the picture: shivering, then shivering that stops, slurred speech, clumsiness, drowsiness, cold pale skin.", "Handle them gently - a very cold heart is irritable and rough handling can stop it."],
        "dont": ["Do not use a hot bath, heating pads on high, or direct fire heat on cold skin.", "Do not rub arms and legs to warm them - it pushes cold blood to the core.", "Do not give alcohol."],
        help: "Confusion, drowsiness, shivering that has stopped, or anyone found cold and unresponsive. That is 911 - keep handling gentle and keep warming the core." },
      { t: "Frostbite",
        "do": ["Get indoors and out of the wind.", "Rewarm the part in warm water - comfortable to your own uninjured hand, never hot - for 15 to 30 minutes until skin softens and color returns.", "Expect rewarming to hurt; pain relievers help.", "After rewarming, dress loosely and dry, with soft cloth between fingers or toes.", "Raise the part and protect it from pressure and cold."],
        "dont": ["Do not rub the part, and never rub it with snow.", "Do not rewarm if the part could freeze again - refreezing does far worse damage. Walk out on frostbitten feet instead if you must.", "Do not use fire, a stove or engine heat to rewarm - numb skin burns without warning."],
        help: "Skin that is white, gray or waxy, hard or wooden feeling, blisters after rewarming, or numbness that does not ease. Frostbite needs medical care the same day." }
    ]},
    { name: "Bites and Stings", topics: [
      { t: "Snake bite",
        "do": ["Move away from the snake. Do not try to catch or kill it - a photo from a safe distance helps medics.", "Keep the person still and calm - movement spreads venom faster.", "Keep the bitten limb still and at about heart level. Splint it like a fracture.", "Remove rings, watches and tight clothing near the bite before swelling starts.", "Note the time of the bite and mark the edge of swelling with a pen every 15 minutes.", "Get to a hospital as fast as you safely can - antivenom is the real treatment and only hospitals have it."],
        "dont": ["Do not cut the bite or suck on it.", "Do not apply a tourniquet or a tight band.", "Do not put ice on it, and do not use electric shock.", "Do not give alcohol or painkillers with blood thinners unless medics say so."],
        help: "Always - treat every snake bite as an emergency until a hospital clears it. Spreading swelling, trouble breathing, drooping eyelids, or a bite to the face or neck means 911." },
      { t: "Spider bite",
        "do": ["Wash the bite with soap and water.", "Put an ice pack wrapped in cloth on it, 15 minutes at a time.", "Keep the limb raised if it swells.", "Note what the spider looked like only if you saw it clearly and safely.", "Watch the bite for 24 to 48 hours for spreading redness or growing pain."],
        "dont": ["Do not cut the bite or apply a tourniquet.", "Do not assume every bite is dangerous - most spider bites are minor and heal like any bug bite."],
        help: "Spreading redness, muscle pain or stiffness, belly pain, fever, sweating, or trouble breathing - or a bite you believe came from a black widow or brown recluse." },
      { t: "Bee and wasp stings",
        "do": ["Scrape a bee stinger out sideways with a card edge or fingernail - speed matters more than method.", "Wash the area with soap and water.", "Ice it, wrapped in cloth, to slow swelling and pain.", "Use an antihistamine for itching and swelling if available.", "Watch the person for at least 30 minutes for allergy signs: widespread hives, swelling lips or tongue, wheezing, dizziness."],
        "dont": ["Do not ignore a sting in the mouth or throat - swelling there blocks air. Get care fast.", "Do not wait out breathing trouble - that is anaphylaxis, see the Poisoning and Allergic Reaction section."],
        help: "Any trouble breathing, swelling of the lips, tongue or face, widespread hives, dizziness or collapse after a sting. That is 911 and an epinephrine auto-injector if one is available." },
      { t: "Tick removal",
        "do": ["Use fine-tipped tweezers and grasp the tick as close to the skin as you can.", "Pull upward with steady, even pressure. Do not twist or jerk.", "If the mouthparts stay in, remove them with clean tweezers; if you cannot, leave them and see a clinician.", "Clean the bite and your hands with soap and water or alcohol.", "Note the date and keep the tick in a sealed container with a damp cotton ball, or take a clear photo, in case illness follows."],
        "dont": ["Do not burn the tick, or coat it with oil, polish or alcohol gel to back it out - those do not work and waste time.", "Do not squeeze the tick's body while pulling."],
        help: "A bullseye-shaped rash in the days or weeks after, fever, joint pain or a spreading rash. Tell the clinician about the tick and the date - early Lyme treatment works well." }
    ]},
    { name: "Water and Food Safety", topics: [
      { t: "Purifying water",
        "do": ["Best method: bring water to a rolling boil for 1 full minute - 3 minutes above about 6,500 feet.", "If it looks cloudy, strain it through a clean cloth or coffee filter first, whatever method you use.", "Chemical method: add 8 drops of plain unscented household bleach per gallon of clear water, stir, and wait 30 minutes. Double the drops for cloudy water and wait the same 30.", "A good filter plus disinfection beats either one alone - filters miss viruses, chemicals miss some parasites.", "Store treated water in clean, covered containers and mark the date."],
        "dont": ["Do not drink from stagnant, oily or chemical-smelling water - treatment does not remove chemicals or fuel.", "Do not use scented bleach or bleach with added cleaners.", "Do not trust clear mountain water - looks mean nothing with germs."],
        help: "Signs of severe dehydration - very dry mouth, no urination, dizziness on standing - or bloody diarrhea or high fever after drinking suspect water. Those need medical care." },
      { t: "Storing food safely",
        "do": ["Keep cold food at or below 40 F. Without power, a closed fridge holds cold about 4 hours, a full freezer about 48.", "Use the 2-hour rule: perishable food left out over 2 hours goes in the trash - 1 hour if it is over 90 F out.", "Store food sealed, off the ground, away from chemicals and fuel.", "Rotate stock: first in, first out. Write dates on cans and packages.", "When in doubt, throw it out - taste-testing suspect food is how people get sick."],
        "dont": ["Do not eat from bulging, leaking or deeply dented cans.", "Do not refreeze thawed raw meat.", "Do not trust the smell test alone - the germs that cause food poisoning often have no smell."],
        help: "Food poisoning symptoms that turn severe - see the food poisoning topic. In a long outage, err on the side of throwing food away." },
      { t: "Food poisoning",
        "do": ["Sip water or an electrolyte drink steadily - small sips if nausea is bad.", "Rest, and return to plain, bland food only when you feel able.", "Know the usual picture: cramps, nausea, vomiting, diarrhea, low fever, starting hours to a few days after the meal.", "Wash hands well and do not prepare food for others while sick.", "Most cases clear in 1 to 3 days with fluids and rest."],
        "dont": ["Do not take anti-diarrhea medicine if there is blood in the stool or a high fever - it can trap the infection.", "Do not push big meals or alcohol while recovering."],
        help: "Blood in stool or vomit, fever over 102 F, vomiting that will not let fluids stay down for 24 hours, signs of dehydration, or illness in a baby, an older adult, or someone pregnant or with a weak immune system." }
    ]},
    { name: "Shelter and Fire", topics: [
      { t: "Emergency shelter",
        "do": ["Pick dry ground out of the wind, away from dead standing trees, cliff edges and dry creek beds that can flash flood.", "Insulate from the ground first - branches, leaves, a pack, anything. Cold ground steals more heat than cold air.", "Build small: a shelter just big enough to lie in stays far warmer than a big one.", "Slope the rain layer so water runs off away from where you sleep, and dig no ditches in fragile ground - use natural drainage.", "If rescue is possible, mark the site: bright items, cleared patterns, anything that stands out from the air."],
        "dont": ["Do not sleep directly on bare ground or rock.", "Do not shelter under a lone tall tree in a thunderstorm.", "Do not use a sealed tent with a flame inside - see carbon monoxide."],
        help: "Shelter is treatment: if someone shows hypothermia signs - shivering that stops, confusion, slurred speech - shelter, dry wrapping and core warming come before everything else, and 911 if reachable." },
      { t: "Fire safety",
        "do": ["Clear a circle about 10 feet across down to bare dirt, and ring the fire with rocks.", "Keep the fire small - you need warmth and light, not a bonfire.", "Have water and loose dirt within reach before you light anything.", "Keep a clear space above the fire - no low branches or overhangs.", "When done: drown it, stir the ashes, drown again, then feel with the back of your hand. If it is too hot to touch, it is too hot to leave."],
        "dont": ["Do not leave a fire unattended, even for a few minutes.", "Do not burn trash, plastic or treated wood - the smoke is toxic.", "Do not build a fire on peat, thick leaf litter or dry grass roots - it can smolder underground and spread."],
        help: "A fire that escapes its ring is a 911 call made early, not late. Burns go to the Burns section - cool running water for 20 minutes is the first move." },
      { t: "Carbon monoxide",
        "do": ["Know the sources: generators, grills, camp stoves, heaters and engines. Carbon monoxide is invisible and has no smell.", "Run generators and grills outside only, well away from windows - never in a garage, tent or vehicle.", "If a CO alarm sounds, or several people indoors get headache, nausea and dizziness at the same time, get everyone out to fresh air and call 911.", "Vent any space where fuel burns, and keep vents clear of snow and debris.", "Wait for the fire department to clear the building before going back in."],
        "dont": ["Do not ignore a headache that hits everyone in the house during an outage - that pattern is the warning.", "Do not sleep in a running vehicle for warmth.", "Do not re-enter a building that set off a CO alarm to grab belongings."],
        help: "Confusion, fainting, chest pain or anyone found unresponsive in a space with a fuel-burning appliance. That is 911 - get them to fresh air if you can do it without entering the same air yourself." }
    ]},
    { name: "Signaling and Rescue", topics: [
      { t: "SOS signals",
        "do": ["Three of anything means distress, worldwide: 3 whistle blasts, 3 flashes, 3 shots, 3 fires in a triangle. Repeat with a pause between sets.", "By day, make smoke: green leaves or a little oil on a fire makes dark smoke that carries for miles.", "By night, a bright fire is the signal - have fuel ready to make it flare when you hear an engine.", "Build ground signals where they can be seen from the air: rocks, logs or gear forming SOS letters at least 10 feet tall, in open ground with contrast against the surface.", "Save phone battery: a text often gets through on a signal too weak for a call, and airplane mode between attempts saves power."],
        "dont": ["Do not wander away from your signal site to look for help - rescuers search where signals were seen.", "Do not burn through all your fire fuel on the first night if rescue may take days."],
        help: "If any call or text can reach 911, send your location first and signal second. Injuries and exposure come before signaling - treat, shelter, then signal." },
      { t: "Signal mirror and whistle",
        "do": ["A mirror flash can be seen 10 miles or more in sun. Hold the mirror near your eye, stretch your other hand out and make a V with two fingers, put the target in the V, and tilt the mirror until the light spot crosses your fingers.", "Sweep the flash slowly across aircraft or distant people, in bursts of three.", "A whistle carries much farther than a voice and costs no strength. Blow in sets of three, then listen.", "At night, flash a light in sets of three the same way."],
        "dont": ["Do not shout for hours - you will lose your voice and your water. The whistle does the work.", "Do not flash a mirror randomly - aim each burst at something that might see it."],
        help: "Signaling is how help finds you, but it is second in line: stop bleeding, treat for cold or heat, and get shelter first, then settle in to signal in a steady rhythm." },
      { t: "Staying found when lost",
        "do": ["Use STOP: Sit down. Think. Observe. Plan. Panic walking is how lost people get more lost.", "Once you realize you are lost, stay put. Searchers start from your last known point and work outward.", "Make yourself easy to find: bright clothing out, noise in sets of three, a cleared visible spot.", "Ration energy and food - water matters more. Drink when thirsty rather than saving it all.", "If you truly must move, leave clear markers of your direction: arrows of sticks, notes, anything dated and obvious."],
        "dont": ["Do not keep walking on hope - most lost people are found within a few miles of where they were last seen.", "Do not split a group. More people together are warmer, calmer and easier to spot."],
        help: "Before any trip: tell someone your route and when to expect you, and agree that overdue means they call for help. That one habit starts more successful rescues than any gear." }
    ]},
    { name: "Poisoning and Allergic Reaction", topics: [
      { t: "Anaphylaxis and epinephrine",
        "do": ["Know the picture: trouble breathing, tight throat, swelling lips or tongue, widespread hives, dizziness or collapse after a food, sting or medicine.", "Use an epinephrine auto-injector immediately - press it firmly into the outer thigh, through clothing if needed, and hold for the time printed on the device.", "Call 911 right after the injection, or send someone while you inject.", "Lay the person down with legs raised. If breathing is easier sitting up, let them sit - but do not let them stand or walk.", "If there is no improvement in 5 to 15 minutes and you have a second injector, use it.", "Even if they recover fully, they still need a hospital - reactions can rebound hours later."],
        "dont": ["Do not wait to see if it passes - epinephrine early is what saves lives in anaphylaxis.", "Do not give an antihistamine instead of epinephrine. Antihistamines are for itching, not airways.", "Do not let the person drive themselves."],
        help: "Always 911. Anaphylaxis is the emergency - injector first, call second, hospital every time, even when the person feels fine afterward." },
      { t: "Common poisons",
        "do": ["Call Poison Control in the US at 1-800-222-1222 for guidance - free, 24 hours. Call 911 instead if the person is unconscious, seizing or struggling to breathe.", "Keep the container or label - knowing exactly what it was changes the treatment.", "For fumes, get to fresh air without breathing the fumes yourself.", "For poison on skin or in eyes, rinse with running water for 15 to 20 minutes and remove contaminated clothing.", "For a swallowed pill mix-up, note what, how much and when, and have it ready to tell Poison Control."],
        "dont": ["Do not make the person vomit unless Poison Control or 911 tells you to - some poisons burn worse coming back up.", "Do not give food, drink or home antidotes unless directed.", "Do not mix cleaning chemicals when cleaning up a spill - bleach plus ammonia or acids makes poison gas."],
        help: "Unconsciousness, seizures, trouble breathing, blue lips, or a child who swallowed unknown pills, button batteries or magnets. Batteries and magnets are time-critical emergencies - 911, do not wait for symptoms." }
    ]}
  ];
  var guideQuery = "";
  var guideOpenKey = null; // "catIdx:topicIdx" while a topic is open

  function guideTopicTotal() {
    var n = 0;
    GUIDE_CATS.forEach(function (c) { n += c.topics.length; });
    return n;
  }
  function renderGuide() {
    var list = $("nx-guide-list"), count = $("nx-guide-count");
    if (!list) return;
    var q = guideQuery.trim().toLowerCase();
    var shown = 0;
    var html = "";
    GUIDE_CATS.forEach(function (cat, ci) {
      var rows = "";
      cat.topics.forEach(function (topic, ti) {
        if (q && (cat.name + " " + topic.t).toLowerCase().indexOf(q) === -1) return;
        shown++;
        rows += '<button type="button" class="nx-guide-row" data-guide-open="' + ci + ":" + ti + '">'
          + '<span class="nx-guide-row-t">' + esc(topic.t) + "</span>"
          + '<span class="nx-guide-row-go">Open</span></button>';
      });
      if (rows) {
        html += '<div class="nx-panel nx-guide-cat"><h3 class="nx-guide-cat-h">' + esc(cat.name) + "</h3>" + rows + "</div>";
      }
    });
    if (!shown) {
      html = '<div class="nx-panel"><p class="nx-h-note" style="margin:0;">NO TOPICS MATCH THAT SEARCH. CLEAR THE SEARCH TO SEE THE FULL GUIDE.</p></div>';
    }
    list.innerHTML = html;
    if (count) count.textContent = shown + " OF " + guideTopicTotal() + " TOPICS - " + GUIDE_CATS.length + " SECTIONS - FULLY OFFLINE, FREE FOR EVERYONE";
    var detail = $("nx-guide-topic");
    if (detail) detail.style.display = guideOpenKey ? "" : "none";
    list.style.display = guideOpenKey ? "none" : "";
  }
  function openGuideTopic(key) {
    var parts = String(key || "").split(":");
    var cat = GUIDE_CATS[Number(parts[0])];
    var topic = cat && cat.topics[Number(parts[1])];
    if (!topic) return false;
    guideOpenKey = key;
    var body = $("nx-guide-topic-body");
    if (body) {
      var html = '<p class="nx-guide-crumb">' + esc(cat.name) + "</p>";
      html += '<h3 class="nx-guide-topic-h">' + esc(topic.t) + "</h3>";
      html += '<h4 class="nx-guide-sub nx-guide-sub-do">Do</h4><ol class="nx-guide-steps">';
      topic["do"].forEach(function (s) { html += "<li>" + esc(s) + "</li>"; });
      html += "</ol>";
      html += '<h4 class="nx-guide-sub nx-guide-sub-dont">Do Not</h4><ul class="nx-guide-steps">';
      topic["dont"].forEach(function (s) { html += "<li>" + esc(s) + "</li>"; });
      html += "</ul>";
      html += '<div class="nx-guide-help"><span class="nx-guide-help-h">Get Help If</span>' + esc(topic.help) + "</div>";
      html += '<p class="nx-h-note" style="margin:12px 0 0 0;">REFERENCE ONLY - CALL 911 FIRST WHEN YOU CAN. A FIRST AID COURSE IS WORTH MORE THAN ANY PAGE, THIS ONE INCLUDED.</p>';
      body.innerHTML = html;
    }
    renderGuide();
    var panel = $("nx-guide-topic");
    if (panel && panel.scrollIntoView) panel.scrollIntoView({ block: "start" });
    return true;
  }
  function closeGuideTopic() {
    guideOpenKey = null;
    renderGuide();
  }
  function bindGuide() {
    var search = $("nx-guide-search");
    if (search) search.addEventListener("input", function () {
      guideQuery = search.value;
      guideOpenKey = null;
      renderGuide();
    });
    var list = $("nx-guide-list");
    if (list) list.addEventListener("click", function (ev) {
      var t = ev.target;
      if (!t.closest) return;
      var row = t.closest("[data-guide-open]");
      if (row) openGuideTopic(row.getAttribute("data-guide-open"));
    });
    var back = $("nx-guide-back");
    if (back) back.addEventListener("click", closeGuideTopic);
  }

  /* ---------------- encrypted vault (WebCrypto AES-GCM) ---------------- */
  function bufToB64(buf) {
    var bytes = new Uint8Array(buf);
    var bin = "";
    for (var i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(bin);
  }
  function b64ToBuf(b64) {
    var bin = atob(b64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  }

  var Vault = {
    blob: null,
    key: null,
    entries: [],
    unlocked: false,

    load: function () {
      try {
        var raw = localStorage.getItem(VAULT_KEY);
        this.blob = raw ? JSON.parse(raw) : null;
      } catch (e) { this.blob = null; }
      this.key = null;
      this.entries = [];
      this.unlocked = false;
    },
    persist: function () {
      try { localStorage.setItem(VAULT_KEY, JSON.stringify(this.blob)); } catch (e) { /* ignore */ }
    },
    derive: async function (passphrase, saltBuf) {
      var base = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]);
      return crypto.subtle.deriveKey(
        { name: "PBKDF2", salt: saltBuf, iterations: 210000, hash: "SHA-256" },
        base,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
      );
    },
    encryptObj: async function (key, obj) {
      var iv = crypto.getRandomValues(new Uint8Array(12));
      var data = new TextEncoder().encode(JSON.stringify(obj));
      var cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, key, data);
      return { iv: bufToB64(iv.buffer), data: bufToB64(cipher) };
    },
    decryptObj: async function (key, rec) {
      var plain = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: new Uint8Array(b64ToBuf(rec.iv)) }, key, b64ToBuf(rec.data));
      return JSON.parse(new TextDecoder().decode(plain));
    },

    create: async function (passphrase) {
      var salt = crypto.getRandomValues(new Uint8Array(16));
      var key = await this.derive(passphrase, salt.buffer);
      var verifier = await this.encryptObj(key, { check: "NYXSURVIVE-VAULT-V1" });
      this.blob = { v: 1, salt: bufToB64(salt.buffer), verifier: verifier, entries: [] };
      this.persist();
      this.key = key;
      this.entries = [];
      this.unlocked = true;
    },
    unlock: async function (passphrase) {
      if (!this.blob) throw new Error("NO VAULT EXISTS ON THIS DEVICE.");
      var key = await this.derive(passphrase, b64ToBuf(this.blob.salt));
      var check;
      try {
        check = await this.decryptObj(key, this.blob.verifier);
      } catch (e) {
        throw new Error("WRONG PASSPHRASE. THE VAULT STAYS SEALED.");
      }
      if (!check || check.check !== "NYXSURVIVE-VAULT-V1") {
        throw new Error("WRONG PASSPHRASE. THE VAULT STAYS SEALED.");
      }
      var entries = [];
      for (var i = 0; i < this.blob.entries.length; i++) {
        try { entries.push(await this.decryptObj(key, this.blob.entries[i])); }
        catch (e) { /* skip undecryptable entry */ }
      }
      this.key = key;
      this.entries = entries;
      this.unlocked = true;
    },
    lock: function () {
      this.key = null;
      this.entries = [];
      this.unlocked = false;
    },
    addEntry: async function (entry) {
      if (!this.unlocked || !this.key) throw new Error("VAULT IS SEALED.");
      entry.id = uid();
      entry.created = new Date().toISOString();
      var rec = await this.encryptObj(this.key, entry);
      rec.id = entry.id;
      this.blob.entries.push(rec);
      this.persist();
      this.entries.push(entry);
    },
    removeEntry: function (id) {
      this.blob.entries = this.blob.entries.filter(function (r) { return r.id !== id; });
      this.persist();
      this.entries = this.entries.filter(function (e) { return e.id !== id; });
    }
  };

  function renderVault() {
    var has = !!Vault.blob;
    $("nx-vault-setup").style.display = !has ? "" : "none";
    $("nx-vault-locked").style.display = (has && !Vault.unlocked) ? "" : "none";
    $("nx-vault-open").style.display = (has && Vault.unlocked) ? "" : "none";
    if (has) $("nx-vault-count").textContent = Vault.blob.entries.length;

    if (Vault.unlocked) {
      var wrap = $("nx-vault-entries");
      if (vaultFxActive) {
        wrap.innerHTML = "<div class=\"nx-log-line\"><b>KEY DERIVED ... OK</b></div>" +
          "<div class=\"nx-log-line\"><b>AUTH TAG ... VERIFIED</b></div>" +
          "<div class=\"nx-log-line\">DECRYPTING ENTRIES ...</div>" +
          "<div class=\"nx-seg\" id=\"nx-vault-fx-seg\" style=\"margin-top:10px;\"></div>";
        segAnimate($("nx-vault-fx-seg"), 100, false);
      } else if (!Vault.entries.length) {
        wrap.innerHTML = "<div class=\"nx-empty\">VAULT IS EMPTY. SEAL YOUR FIRST ENTRY ABOVE.</div>";
      } else {
        wrap.innerHTML = Vault.entries.map(function (e, i) {
          var isPrimary = e.type === "Rally Point" && Vault.entries.findIndex(function (x) { return x.type === "Rally Point"; }) === i;
          var coord = (e.type === "Rally Point" && e.lat != null && e.lng != null)
            ? "<p class=\"nx-row-meta\">COORDS " + fmt(e.lat, 6) + ", " + fmt(e.lng, 6) + "</p>" : "";
          return "<div class=\"nx-row\"><div class=\"nx-row-main\">" +
            "<p class=\"nx-row-title\">" + esc(e.title) + (isPrimary ? " <span class=\"nx-heavy\">// PRIMARY</span>" : "") + "</p>" +
            "<p class=\"nx-row-meta\">" + esc(e.type.toUpperCase()) + "</p>" + coord +
            (e.body ? "<p style=\"margin:6px 0 0 0; color:var(--nx-dim); white-space:pre-wrap;\">" + esc(e.body) + "</p>" : "") +
            "</div><div class=\"nx-row-side\">" +
            "<button type=\"button\" class=\"nx-btn nx-btn-small nx-btn-danger\" data-vault-del=\"" + e.id + "\">Del</button>" +
            "</div></div>";
        }).join("");
      }
    }
    renderRallyBox();
    renderStatusBoard();
  }

  function bindVault() {
    // Load the blob once at startup (renderVault must not wipe an unlocked session)
    Vault.load();

    $("nx-vault-set-form").addEventListener("submit", async function (ev) {
      ev.preventDefault();
      var p1 = $("nx-v-set-pass").value, p2 = $("nx-v-set-pass2").value;
      if (p1 !== p2) { showMsg($("nx-vault-msg"), "PASSPHRASES DO NOT MATCH.", "err"); return; }
      if (p1.length < 6) { showMsg($("nx-vault-msg"), "PASSPHRASE TOO SHORT - 6 CHARACTERS MINIMUM.", "err"); return; }
      try {
        await Vault.create(p1);
        ev.target.reset();
        showMsg($("nx-vault-msg"), "VAULT CREATED AND OPEN. IT SEALS ITSELF ON EVERY APP LOAD.", "good");
      } catch (e) {
        showMsg($("nx-vault-msg"), "VAULT CREATE FAILED: " + e.message, "err");
      }
      renderVault();
    });

    $("nx-vault-unlock-form").addEventListener("submit", async function (ev) {
      ev.preventDefault();
      var pass = $("nx-v-unlock-pass").value;
      var justUnlocked = false;
      try {
        await Vault.unlock(pass);
        ev.target.reset();
        justUnlocked = true;
        showMsg($("nx-vault-msg"), "VAULT OPEN.", "good");
      } catch (e) {
        showMsg($("nx-vault-msg"), e.message, "err");
      }
      if (justUnlocked && fxAnimate()) {
        // Brief unseal sequence; locking, by contrast, snaps shut instantly.
        vaultFxActive = true;
        renderVault();
        setTimeout(function () {
          vaultFxActive = false;
          renderVault();
          renderDashboard();
          renderBroadcast();
        }, 800);
        return;
      }
      renderVault();
      renderDashboard();
    });

    $("nx-vault-lock").addEventListener("click", function () {
      Vault.lock();
      showMsg($("nx-vault-msg"), "VAULT SEALED. KEY WIPED FROM MEMORY.", "good");
      renderVault();
      renderDashboard();
      renderBroadcast();
    });

    $("nx-ve-type").addEventListener("change", function () {
      var rally = this.value === "Rally Point";
      $("nx-ve-lat-wrap").style.display = rally ? "" : "none";
      $("nx-ve-lng-wrap").style.display = rally ? "" : "none";
    });

    $("nx-vault-entry-form").addEventListener("submit", async function (ev) {
      ev.preventDefault();
      var type = $("nx-ve-type").value;
      var title = $("nx-ve-title").value.trim();
      if (!title) return;
      if (capBlocked("vault")) {
        showMsg($("nx-vault-msg"),
          "FREE TIER VAULT CAP: " + PLAN_CAPS.vault + " ENTRIES. OPERATOR REMOVES EVERY CAP - SEE SYSTEM // PLAN.", "err");
        return;
      }
      var entry = { type: type, title: title, body: $("nx-ve-body").value.trim(), lat: null, lng: null };
      if (type === "Rally Point") {
        var lat = $("nx-ve-lat").value, lng = $("nx-ve-lng").value;
        entry.lat = lat === "" ? null : Number(lat);
        entry.lng = lng === "" ? null : Number(lng);
      }
      try {
        await Vault.addEntry(entry);
        ev.target.reset();
        $("nx-ve-lat-wrap").style.display = "none";
        $("nx-ve-lng-wrap").style.display = "none";
        showMsg($("nx-vault-msg"), "ENTRY SEALED: " + title.toUpperCase(), "good");
      } catch (e) {
        showMsg($("nx-vault-msg"), e.message, "err");
      }
      renderVault();
      renderDashboard();
      renderBroadcast();
    });

    $("nx-vault-entries").addEventListener("click", function (ev) {
      var del = ev.target.closest("[data-vault-del]");
      if (!del) return;
      var id = del.getAttribute("data-vault-del");
      var entry = Vault.entries.filter(function (x) { return x.id === id; })[0];
      if (entry && window.confirm("Delete vault entry: " + entry.title + "? This cannot be undone.")) {
        Vault.removeEntry(id);
        renderVault();
        renderDashboard();
        renderBroadcast();
      }
    });
  }

  /* ---------------- comms plan ---------------- */
  /* ---------------- family plan (Ready.gov build) ----------------
     The household plan on one card: where you meet, and who
     outside the area everyone checks in with when local lines
     fail. Names only - no coordinates ever live in this data.
     The primary rally point itself stays sealed in the vault;
     this panel shows its name when the vault is open and says
     so plainly when it is not. */
  function renderFamilyPlan() {
    var line = $("nx-family-primary");
    if (!line) return;
    var rally = primaryRally();
    line.innerHTML = "PRIMARY RALLY POINT: <b>" + (rally
      ? esc(String(rally.title).toUpperCase())
      : (Vault.blob ? "SEALED IN THE VAULT - UNLOCK IT TO SEE THE NAME" : "NOT SET - SEAL ONE IN THE VAULT")) + "</b>";
    var r2 = $("nx-fam-rally2"), on = $("nx-fam-outname"), op = $("nx-fam-outphone");
    if (r2 && document.activeElement !== r2 && document.activeElement !== on && document.activeElement !== op) {
      var fp = state.familyPlan || { outName: "", outPhone: "", rally2: "" };
      r2.value = fp.rally2 || "";
      on.value = fp.outName || "";
      op.value = fp.outPhone || "";
    }
  }

  function bindFamilyPlan() {
    var form = $("nx-family-form");
    if (!form) return;
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      state.familyPlan = {
        rally2: $("nx-fam-rally2").value.trim(),
        outName: $("nx-fam-outname").value.trim(),
        outPhone: $("nx-fam-outphone").value.trim()
      };
      saveState();
      renderAll();
      showMsg($("nx-family-msg"), "FAMILY PLAN SAVED. IT PRINTS IN THE GO-BOOK.", "good");
      sfxConfirm();
    });
  }

  function renderComms() {
    var body = $("nx-comms-body");
    if (!state.comms.length) {
      body.innerHTML = "<tr><td colspan=\"6\" class=\"nx-dim\" style=\"font-family:var(--nx-mono); font-size:12px;\">NO CHANNELS. ADD ONE BELOW.</td></tr>";
    } else {
      body.innerHTML = state.comms.map(function (c) {
        function cell(field, val) {
          return "<td><input class=\"nx-cell\" data-comms-id=\"" + c.id + "\" data-comms-field=\"" + field + "\" value=\"" + esc(val) + "\"></td>";
        }
        return "<tr>" + cell("label", c.label) + cell("freq", c.freq) + cell("callsign", c.callsign) +
          cell("purpose", c.purpose) + cell("checkin", c.checkin) +
          "<td class=\"nx-no-print\"><button type=\"button\" class=\"nx-btn nx-btn-small nx-btn-danger\" data-comms-del=\"" + c.id + "\">Del</button></td></tr>";
      }).join("");
    }
    renderBroadcastMeta();
    renderFamilyPlan();
  }

  function bindComms() {
    $("nx-comms-body").addEventListener("change", function (ev) {
      var input = ev.target.closest("[data-comms-id]");
      if (!input) return;
      var row = state.comms.filter(function (c) { return c.id === input.getAttribute("data-comms-id"); })[0];
      if (row) { row[input.getAttribute("data-comms-field")] = input.value; saveState(); }
    });
    $("nx-comms-body").addEventListener("click", function (ev) {
      var del = ev.target.closest("[data-comms-del]");
      if (!del) return;
      state.comms = state.comms.filter(function (c) { return c.id !== del.getAttribute("data-comms-del"); });
      saveState();
      renderComms();
    });
    $("nx-comms-add").addEventListener("click", function () {
      state.comms.push({ id: uid(), label: "New Channel", freq: "", callsign: "", purpose: "", checkin: "" });
      saveState();
      renderComms();
    });
    $("nx-comms-print").addEventListener("click", function () {
      $("nx-print-date").textContent = new Date().toLocaleDateString("en-US") + " " + new Date().toLocaleTimeString("en-GB", { hour12: false });
      document.body.classList.add("nx-print-comms");
      window.print();
      document.body.classList.remove("nx-print-comms");
    });
  }

  /* ---------------- broadcast ---------------- */
  var BC_TEMPLATES = {
    "RALLY UP": "RALLY UP - MOVE TO THE RALLY POINT NOW",
    "CHECK IN": "CHECK IN - ALL OK AT THIS POSITION",
    "ALL CLEAR": "ALL CLEAR - STAND DOWN"
  };
  var bcTemplate = "RALLY UP";

  function callSign() {
    if (state.settings.callsign) return state.settings.callsign;
    var row = state.comms.filter(function (c) { return c.callsign && c.callsign !== "-"; })[0];
    return row ? row.callsign : "NYX-1";
  }

  function buildBroadcast() {
    var msg = "[" + callSign() + "] " + BC_TEMPLATES[bcTemplate];
    var extra = $("nx-bc-text").value.trim();
    if (extra) msg += " // " + extra.toUpperCase();
    var rally = primaryRally();
    if (rally) msg += " // RALLY: " + rally.title.toUpperCase();
    return msg;
  }

  function renderBroadcastMeta() {
    var meta = $("nx-bc-meta");
    if (!meta) return;
    var rally = primaryRally();
    meta.innerHTML = "CALL SIGN: <b>" + esc(callSign()) + "</b> // RALLY APPEND: <b>" +
      (rally ? esc(rally.title.toUpperCase()) : (Vault.blob ? "VAULT SEALED" : "NONE SET")) + "</b>";
    var preview = $("nx-bc-preview");
    if (preview) preview.textContent = buildBroadcast();
  }

  function renderBroadcast() {
    renderBroadcastMeta();
    var sig = $("nx-bc-sig");
    if (sig) sig.classList.toggle("nx-live", state.outbox.length > 0);
    var wrap = $("nx-outbox-list");
    if (!wrap) return;
    if (!state.outbox.length) {
      wrap.innerHTML = "<div class=\"nx-empty\">NO BROADCASTS LOGGED YET.</div>";
      return;
    }
    wrap.innerHTML = state.outbox.slice().reverse().map(function (o) {
      var when = new Date(o.ts).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
      var badge = o.status === "QUEUED"
        ? "<span class=\"nx-badge nx-badge-over\">QUEUED</span>"
        : "<span class=\"nx-badge nx-badge-ok\">SENT // " + esc(o.route || "") + "</span>";
      return "<div class=\"nx-row\"><div class=\"nx-row-main\"><p class=\"nx-row-title\" style=\"font-size:15px;\">" + esc(o.template) + "</p>" +
        "<p class=\"nx-row-meta\">" + esc(when) + " // " + esc(o.preview) + "</p></div>" +
        "<div class=\"nx-row-side\">" + badge + "</div></div>";
    }).join("");
  }

  function logBroadcast(template, msg, status, route) {
    state.outbox.push({ id: uid(), ts: new Date().toISOString(), template: template, preview: msg.slice(0, 60), status: status, route: route || "" });
    if (state.outbox.length > 50) state.outbox = state.outbox.slice(-50);
    saveState();
    renderBroadcast();
    if (status === "SENT") sfxSquelch();
  }

  function bindBroadcast() {
    $("nx-bc-templates").addEventListener("click", function (ev) {
      var b = ev.target.closest("[data-template]");
      if (!b) return;
      bcTemplate = b.getAttribute("data-template");
      document.querySelectorAll("#nx-bc-templates .nx-fbtn").forEach(function (x) {
        x.classList.toggle("nx-on", x === b);
      });
      renderBroadcastMeta();
    });
    $("nx-bc-text").addEventListener("input", renderBroadcastMeta);

    $("nx-bc-send").addEventListener("click", async function () {
      var msg = buildBroadcast();
      // Offline: never claim a send. Compose + queue honestly.
      if (navigator.onLine === false) {
        logBroadcast(bcTemplate, msg, "QUEUED", "OFFLINE");
        showMsg($("nx-bc-msg"), "NO SIGNAL - BROADCAST LOGGED AS QUEUED. IT STILL NEEDS A MANUAL SEND WHEN SIGNAL RETURNS:\n" + msg, "err");
        return;
      }
      if (navigator.share) {
        try {
          await navigator.share({ title: "NyxSurvive Broadcast", text: msg });
          logBroadcast(bcTemplate, msg, "SENT", "SHARE");
          showMsg($("nx-bc-msg"), "BROADCAST HANDED TO THE SHARE SHEET AND LOGGED.", "good");
        } catch (e) {
          showMsg($("nx-bc-msg"), "SHARE CANCELLED - NOTHING SENT, NOTHING LOGGED.", "err");
        }
        return;
      }
      var isTouch = ("ontouchstart" in window) || navigator.maxTouchPoints > 0;
      if (isTouch) {
        var a = document.createElement("a");
        a.href = "sms:?&body=" + encodeURIComponent(msg);
        document.body.appendChild(a);
        a.click();
        a.remove();
        logBroadcast(bcTemplate, msg, "SENT", "SMS");
        showMsg($("nx-bc-msg"), "OPENED YOUR SMS APP WITH THE BROADCAST LOADED. LOGGED AS SENT VIA SMS.", "good");
        return;
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        try {
          await navigator.clipboard.writeText(msg);
          logBroadcast(bcTemplate, msg, "SENT", "CLIPBOARD");
          showMsg($("nx-bc-msg"), "COPIED TO CLIPBOARD - PASTE IT INTO YOUR RADIO APP OR MESSENGER. LOGGED.", "good");
        } catch (e) {
          logBroadcast(bcTemplate, msg, "QUEUED", "MANUAL");
          showMsg($("nx-bc-msg"), "CLIPBOARD BLOCKED. COPY MANUALLY - LOGGED AS QUEUED:\n" + msg, "err");
        }
        return;
      }
      logBroadcast(bcTemplate, msg, "QUEUED", "MANUAL");
      showMsg($("nx-bc-msg"), "NO SEND ROUTE ON THIS DEVICE. COPY MANUALLY - LOGGED AS QUEUED:\n" + msg, "err");
    });
  }

  /* ---------------- crew ---------------- */
  function renderCrew() {
    var wrap = $("nx-crew-list");
    if (!state.crew.length) {
      wrap.innerHTML = "<div class=\"nx-empty\">NO CREW YET. ADD HOUSEHOLD MEMBERS ABOVE, THEN ASSIGN GEAR TO THEM IN THE GEAR TAB.</div>";
      return;
    }
    wrap.innerHTML = state.crew.map(function (m) {
      var items = state.gear.filter(function (g) { return g.assignedTo === m.id; });
      var lb = items.reduce(function (s, g) { return s + itemWeightLb(g); }, 0);
      return "<div class=\"nx-panel\" style=\"margin-bottom:10px;\"><div class=\"nx-switch-row\" style=\"justify-content:space-between;\">" +
        "<div><p class=\"nx-row-title\" style=\"font-size:20px;\">" + esc(m.name) + "</p>" +
        "<p class=\"nx-row-meta\">" + esc((m.role || "Adult").toUpperCase()) +
        (m.notes ? " // " + esc(m.notes.toUpperCase()) : "") + "</p></div>" +
        "<div style=\"text-align:right;\"><span class=\"nx-row-weight\">" + fmt(lb, 1) + "</span> <span class=\"nx-dim\">LB ASSIGNED</span>" +
        "<p class=\"nx-row-meta\">" + items.length + " ITEMS</p></div></div>" +
        "<div class=\"nx-btn-row\"><button type=\"button\" class=\"nx-btn nx-btn-small nx-btn-danger\" data-crew-del=\"" + m.id + "\">Remove Member</button></div></div>";
    }).join("");
  }

  function bindCrew() {
    $("nx-crew-form").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var name = $("nx-c-name").value.trim();
      if (!name) return;
      if (capBlocked("crew")) {
        showMsg($("nx-crew-msg"),
          "FREE TIER CREW CAP: " + PLAN_CAPS.crew + " MEMBERS. OPERATOR REMOVES EVERY CAP - SEE SYSTEM // PLAN.", "err");
        return;
      }
      state.crew.push({ id: uid(), name: name, role: $("nx-c-role").value, notes: $("nx-c-notes").value.trim() });
      saveState();
      ev.target.reset();
      renderAll();
    });
    $("nx-crew-list").addEventListener("click", function (ev) {
      var del = ev.target.closest("[data-crew-del]");
      if (!del) return;
      var id = del.getAttribute("data-crew-del");
      var m = state.crew.filter(function (c) { return c.id === id; })[0];
      if (m && window.confirm("Remove crew member " + m.name + "? Their gear becomes unassigned.")) {
        state.crew = state.crew.filter(function (c) { return c.id !== id; });
        state.gear.forEach(function (g) { if (g.assignedTo === id) g.assignedTo = ""; });
        saveState();
        renderAll();
      }
    });
  }

  /* ---------------- compass + rally nav ---------------- */
  var compassStarted = false;
  var lastHeading = null;
  var lastPos = null;

  function toRad(d) { return d * Math.PI / 180; }
  function haversineMi(lat1, lon1, lat2, lon2) {
    var R = 3958.8;
    var dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.sqrt(a));
  }
  function bearingTo(lat1, lon1, lat2, lon2) {
    var y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
    var x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
      Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }
  function cardinal(deg) {
    var pts = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
    return pts[Math.round(deg / 45) % 8];
  }

  function renderRallyNav() {
    var el = $("nx-rally-nav");
    if (!el) return;
    var rally = primaryRally();
    if (!rally) {
      el.textContent = Vault.blob ? "RALLY NAV: VAULT SEALED" : "RALLY NAV: NO RALLY POINT SET";
      return;
    }
    if (rally.lat == null || rally.lng == null) { el.textContent = "RALLY NAV: RALLY POINT HAS NO COORDS"; return; }
    if (!lastPos) { el.textContent = "RALLY NAV: WAITING FOR POSITION - TAP ENABLE SENSORS"; return; }
    var dist = haversineMi(lastPos.lat, lastPos.lng, rally.lat, rally.lng);
    var brg = bearingTo(lastPos.lat, lastPos.lng, rally.lat, rally.lng);
    el.innerHTML = "RALLY NAV: <b>" + fmt(brg, 0) + "&deg; " + cardinal(brg) + "</b> // <b>" + fmt(dist, 2) + " MI</b> TO " + esc(rally.title.toUpperCase());
  }

  function onOrientation(e) {
    var heading = null;
    if (typeof e.webkitCompassHeading === "number") heading = e.webkitCompassHeading;
    else if (e.alpha != null) heading = (360 - e.alpha) % 360;
    if (heading == null) return;
    lastHeading = heading;
    $("nx-compass-deg").textContent = String(Math.round(heading)).padStart(3, "0");
    $("nx-compass-card").textContent = cardinal(heading);
    $("nx-compass-needle").style.transform = "rotate(" + (-heading) + "deg)";
  }

  function bindCompass() {
    $("nx-compass-btn").addEventListener("click", async function () {
      var note = $("nx-compass-note");
      if (!("DeviceOrientationEvent" in window) && !("geolocation" in navigator)) {
        showMsg(note, "COMPASS NEEDS A PHONE WITH SENSORS AND PERMISSION GRANTED - THIS DEVICE REPORTS NONE.", "err");
        return;
      }
      try {
        if (typeof DeviceOrientationEvent !== "undefined" &&
            typeof DeviceOrientationEvent.requestPermission === "function") {
          var res = await DeviceOrientationEvent.requestPermission();
          if (res !== "granted") { showMsg(note, "SENSOR PERMISSION DENIED - HEADING UNAVAILABLE.", "err"); return; }
        }
      } catch (e) { /* non-iOS path: no permission API */ }
      if (!compassStarted) {
        window.addEventListener("deviceorientation", onOrientation, true);
        compassStarted = true;
      }
      if ("geolocation" in navigator) {
        navigator.geolocation.watchPosition(function (p) {
          lastPos = { lat: p.coords.latitude, lng: p.coords.longitude };
          renderRallyNav();
        }, function () {
          showMsg(note, "POSITION UNAVAILABLE - CHECK LOCATION PERMISSION. HEADING MAY STILL WORK.", "err");
        }, { enableHighAccuracy: true, maximumAge: 15000 });
      }
      showMsg(note, "SENSORS LIVE. HEADING UPDATES AS THE DEVICE TURNS.", "good");
    });
  }

  /* ---------------- checklists ---------------- */
  function renderLists() {
    var cs = checklistStats();
    $("nx-lists-total").innerHTML = (cs.done === 0 ? "<span class=\"nx-empty-art\">" + artSm("lists") + "</span>" : "") +
      "OVERALL READINESS <b>" + cs.pct + "%</b> // " + cs.done + " OF " + cs.total + " ITEMS CONFIRMED ACROSS ALL LISTS";
    $("nx-lists-wrap").innerHTML = CHECKLISTS.map(function (list) {
      var saved = state.checklists[list.id] || {};
      var done = list.items.filter(function (_, i) { return saved[i]; }).length;
      var items = list.items.map(function (text, i) {
        var checked = !!saved[i];
        return "<label class=\"nx-check-item" + (checked ? " nx-done" : "") + "\">" +
          "<input type=\"checkbox\" data-list=\"" + list.id + "\" data-idx=\"" + i + "\"" + (checked ? " checked" : "") + ">" +
          "<span class=\"nx-check-text\">" + esc(text) + "</span></label>";
      }).join("");
      return "<h3 class=\"nx-section-sub\">" + esc(list.title) + " - " + done + "/" + list.items.length + "</h3>" +
        "<div class=\"nx-seg\" style=\"margin:0 0 10px 0;\">" + segHtml((done / list.items.length) * 100, false) + "</div>" + items;
    }).join("") + intelChecklistHtml() + shutoffsChecklistHtml() + firstOrdersChecklistHtml();
  }

  /* The fourth checklist is not a constant like the other
   * three: its items are the tasks converted from saved intel
   * cards (state.intelTasks), checked off in the same
   * state.checklists shape under the id "intel". It renders
   * only once a task has been filed here, and it stays out of
   * checklistStats - Readiness keeps measuring the three
   * scenario lists it has always measured. */
  function intelChecklistHtml() {
    if (!state.intelTasks.length) return "";
    var saved = state.checklists["intel"] || {};
    var done = state.intelTasks.filter(function (_, i) { return saved[i]; }).length;
    var items = state.intelTasks.map(function (text, i) {
      var checked = !!saved[i];
      return "<label class=\"nx-check-item" + (checked ? " nx-done" : "") + "\">" +
        "<input type=\"checkbox\" data-list=\"intel\" data-idx=\"" + i + "\"" + (checked ? " checked" : "") + ">" +
        "<span class=\"nx-check-text\">" + esc(text) + "</span></label>";
    }).join("");
    return "<h3 class=\"nx-section-sub\">Intel - " + done + "/" + state.intelTasks.length + "</h3>" +
      "<p class=\"nx-h-note\" style=\"margin:0 0 10px 0;\">STEPS FILED FROM SAVED POSTS IN THE INTEL TAB.</p>" +
      "<div class=\"nx-seg\" style=\"margin:0 0 10px 0;\">" + segHtml((done / state.intelTasks.length) * 100, false) + "</div>" + items;
  }

  /* Know Your Shutoffs (Ready.gov build): a standing list in
   * the same special-list shape as Intel - ticks live in
   * state.checklists under "shutoffs" and stay out of
   * checklistStats, so Readiness keeps measuring the three
   * scenario lists it has always measured. The location notes
   * themselves live in the Home Systems panel in System. */
  var SHUTOFF_ITEMS = [
    "Locate the main water shutoff and tag the valve",
    "Locate the gas shutoff at the meter",
    "Keep a wrench or pliers with the kit that fits the valves",
    "Locate the electric breaker panel and label the main breaker",
    "Locate the propane tank valve (if this house has one)",
    "Walk every adult in the house through all the shutoffs"
  ];
  function shutoffsChecklistHtml() {
    var saved = state.checklists["shutoffs"] || {};
    var done = SHUTOFF_ITEMS.filter(function (_, i) { return saved[i]; }).length;
    var items = SHUTOFF_ITEMS.map(function (text, i) {
      var checked = !!saved[i];
      return "<label class=\"nx-check-item" + (checked ? " nx-done" : "") + "\">" +
        "<input type=\"checkbox\" data-list=\"shutoffs\" data-idx=\"" + i + "\"" + (checked ? " checked" : "") + ">" +
        "<span class=\"nx-check-text\">" + esc(text) + "</span></label>";
    }).join("");
    return "<h3 class=\"nx-section-sub\">Know Your Shutoffs - " + done + "/" + SHUTOFF_ITEMS.length + "</h3>" +
      "<p class=\"nx-h-note\" style=\"margin:0 0 10px 0;\">WHERE THE VALVES AND PANELS LIVE IN THIS HOUSE IS LOGGED IN SYSTEM // HOME SYSTEMS.</p>" +
      "<div class=\"nx-seg\" style=\"margin:0 0 10px 0;\">" + segHtml((done / SHUTOFF_ITEMS.length) * 100, false) + "</div>" + items;
  }

  function bindLists() {
    $("nx-lists-wrap").addEventListener("change", function (ev) {
      var box = ev.target.closest("[data-list]");
      if (!box) return;
      var listId = box.getAttribute("data-list");
      var idx = box.getAttribute("data-idx");
      if (!state.checklists[listId]) state.checklists[listId] = {};
      state.checklists[listId][idx] = box.checked;
      if (listId === "firstOrders" && Array.isArray(state.firstOrders) && state.firstOrders[idx]) state.firstOrders[idx].done = box.checked;
      if (box.checked) sfxConfirm();
      saveState();
      renderLists();
      renderDashboard();
    });
  }

  /* ---------------- shopping links + resupply orders ----------------
     One link layer for every "go buy the thing that closes this
     gap" surface: First Orders rows, Rotate REPLACE buttons and
     the Resupply panel. Links are Amazon SEARCH links built from
     curated queries - never a specific product page, never a
     price. When Connie has an Amazon Associates tag it goes in
     NX_SHOP_TAG and every link starts carrying it; empty means
     plain links and the plainer disclosure. Free for all tiers:
     the links are the monetization, so nothing here is capped.
     On iOS the buttons carry .nx-buy-ui and hide with every other
     buy surface, and openShop refuses outright (Guideline 3.1.1,
     same rule as checkout). */
  var NX_SHOP_TAG = "nyxcollective-20"; // Connie's Amazon Associates tag (set 2026-11-18); empty = plain links.
  var SHOP_CATALOG = {
    "water-storage":    { label: "Water storage containers", query: "WaterBrick 3 gallon water storage" },
    "water-barrel":     { label: "55 gallon water barrel", query: "55 gallon water storage barrel" },
    "water-filter":     { label: "Water filter", query: "Sawyer MINI water filter" },
    "water-filter-home": { label: "Home water filter system", query: "Berkey water filter system" },
    "food-bucket":      { label: "Freeze-dried food bucket", query: "Mountain House freeze dried food bucket" },
    "food-supply":      { label: "Emergency food supply", query: "Augason Farms emergency food supply" },
    "power-station":    { label: "Portable power station", query: "Jackery portable power station" },
    "lantern":          { label: "Solar lantern", query: "solar lantern LED rechargeable" },
    "headlamp":         { label: "Headlamp", query: "LED headlamp rechargeable" },
    "trauma-kit":       { label: "Trauma kit (IFAK)", query: "trauma kit IFAK first aid" },
    "tourniquet":       { label: "Tourniquet", query: "CAT tourniquet" },
    "radios":           { label: "GMRS radios", query: "Midland GMRS two way radios" },
    "fire":             { label: "Fire starter kit", query: "ferro rod fire starter kit" },
    "tent":             { label: "Tent", query: "2 person camping tent" },
    "sleeping-bag":     { label: "Sleeping bag", query: "20 degree sleeping bag" },
    "multitool":        { label: "Multitool", query: "multitool pocket knife" },
    "gobag":            { label: "Survival backpack kit", query: "emergency survival backpack kit" },
    "stove":            { label: "Camp stove", query: "portable camping stove" },
    "batteries":        { label: "Lithium AA batteries", query: "AA lithium batteries" },
    "pet-food":         { label: "Pet food", query: "dry pet food bulk bag" }
  };
  // tagOverride exists so the suites can prove the tag path
  // without editing the shipped (empty) tag.
  function shopUrl(query, tagOverride) {
    var tag = tagOverride === undefined ? NX_SHOP_TAG : tagOverride;
    return "https://www.amazon.com/s?k=" + encodeURIComponent(query) + (tag ? "&tag=" + encodeURIComponent(tag) : "");
  }
  function openShop(query) {
    if (IS_IOS_APP) return; // iOS shell: no pointers out to a sale, same as checkout
    window.open(shopUrl(query), "_blank", "noopener");
  }
  function shopBtnHtml(shopKey, label) {
    var entry = SHOP_CATALOG[shopKey];
    if (!entry) return "";
    return "<button type=\"button\" class=\"nx-btn nx-btn-small nx-shop-btn nx-buy-ui\" data-shop-key=\"" + esc(shopKey) +
      "\" title=\"" + esc(entry.label) + "\">" + esc(label || "FIND IT") + "</button>";
  }
  function shopDisclosureText() {
    return NX_SHOP_TAG
      ? "Shopping links open Amazon. Buying through them supports NyxSurvive at no extra cost to you."
      : "Shopping links open Amazon search for the named item.";
  }
  function shopDisclosureHtml() {
    return "<p class=\"nx-shop-note nx-buy-ui\">" + esc(shopDisclosureText()) + "</p>";
  }

  /* Resupply Orders: First Orders made permanent. Same math
     (calcNeeds / calcGap over Days Ready), planned against the
     user's own target instead of the fixed 14 days. Lines tick
     in state.checklists["resupply"] keyed by line id and mirror
     onto the generated line objects, exactly the First Orders
     mechanism, and stay out of checklistStats the same way. */
  var RESUPPLY_TARGETS = [7, 14, 30, 60, 90];
  function resupplyTarget() {
    return RESUPPLY_TARGETS.indexOf(state.resupplyTarget) >= 0 ? state.resupplyTarget : 14;
  }
  function gearText() {
    return state.gear.map(function (g) { return String(g.name || "") + " " + String(g.category || ""); }).join(" | ").toLowerCase();
  }
  function hasFiltration() {
    var re = /filter|purif|sawyer|berkey|lifestraw|steripen/;
    if (re.test(gearText())) return true;
    return state.stores.some(function (s) { return re.test(String(s.name || "").toLowerCase()); });
  }
  function hasMedicalKit() {
    if (state.gear.some(function (g) { return g.category === "Medical"; })) return true;
    return /ifak|trauma|first[- ]?aid|med[- ]?kit|tourniquet/.test(gearText());
  }
  function hasRadios() {
    if (state.comms.length > 0) return true;
    if (state.gear.some(function (g) { return g.category === "Comms"; })) return true;
    return /radio|gmrs|walkie|ham/.test(gearText());
  }
  function hasGoBag() {
    if (state.gear.some(function (g) { return g.tier === "T2"; })) return true;
    if (/go[- ]?bag|bug[- ]?out/.test(gearText())) return true;
    return !!(state.assessment && state.assessment.done && state.assessment.gobag === "packed");
  }
  function hasLightSource() {
    return /lantern|headlamp|flashlight|torch|lamp/.test(gearText());
  }
  function resupplyLines() {
    var target = resupplyTarget();
    var hh = householdSize();
    var gap = calcGap(calcNeeds(hh, target));
    var saved = state.checklists["resupply"] || {};
    var lines = [];
    function line(id, text, shopKey, add) {
      lines.push({ id: id, text: text, shopKey: shopKey || null, add: add || null, done: !!saved[id] });
    }
    if (gap.shortWater > 0) {
      var big = gap.shortWater >= 40;
      var barrels = Math.ceil(gap.shortWater / 55);
      var cont = big
        ? "about " + barrels + " x 55-gal barrel" + (barrels > 1 ? "s" : "")
        : "about " + Math.ceil(gap.shortWater / 3) + " x 3-gal water bricks";
      line("water", "Store " + fmt(gap.shortWater, 1) + " more gallons of water to hold " + target + " days - " + cont,
        big ? "water-barrel" : "water-storage", "water");
    }
    if (gap.shortFoodKcal > 0) {
      var buckets = Math.max(1, Math.ceil((gap.shortFoodKcal / 2000) / 30));
      line("food", "Add food - about " + Math.ceil(gap.shortFoodKcal / (hh * 2000)) + " more days of calories for your household (" +
        fmt(gap.shortFoodKcal, 0) + " kcal) - roughly " + buckets + " x 30-day freeze-dried bucket" + (buckets > 1 ? "s" : "") +
        ", estimate only, check label calories", "food-bucket", "food");
    }
    if (!hasFiltration()) line("filter", "Add water filtration - a filter turns found water into drinking water", "water-filter");
    if (!hasMedicalKit()) line("trauma", "Add a trauma kit - bleeding control, not just bandages", "trauma-kit");
    if (!hasRadios()) line("radios", "Get two GMRS radios and pick a family channel", "radios");
    if (!hasGoBag()) line("gobag", "Pack a go-bag for each adult - one packed bag per adult, staged by the door", "gobag");
    if (!hasLightSource()) line("light", "Add a light source - a lantern or headlamp for grid-down nights", "lantern");
    // Pets (Ready.gov build): a pet line rides the same target
    // math - pounds needed for the target window minus pounds
    // on hand. Only when the household actually has pets.
    var pr = petReadiness();
    if (pr.pets > 0) {
      var needLb = pr.pets * PET_FOOD_LB_PER_PET_DAY * target;
      if (pr.lb < needLb) {
        line("petfood", "Add pet food - about " + Math.ceil(needLb - pr.lb) + " lb to hold " + pr.pets +
          " pet" + (pr.pets > 1 ? "s" : "") + " for " + target + " days", "pet-food", "petfood");
      }
    }
    return lines;
  }

  /* + ADD STORE on the water/food lines files the shortfall as a
     real store, in the exact shapes the check-in writes (amount +
     unit for water, amount in days + total kcal for food, expiry
     null). A repeat tap tops the same resupply store up instead
     of stacking duplicates. */
  function addResupplyStore(kind) {
    var target = resupplyTarget();
    var hh = householdSize();
    var gap = calcGap(calcNeeds(hh, target));
    if (kind === "water") {
      var gal = Math.ceil(gap.shortWater);
      if (gal <= 0) return;
      var w = state.stores.filter(function (s) { return s.kind === "Water" && s.name === "Stored water - resupply"; })[0];
      if (w) { w.amount = (Number(w.amount) || 0) + gal; w.unit = "gal"; w.kcal = 0; }
      else state.stores.push({ id: uid(), kind: "Water", name: "Stored water - resupply", amount: gal, unit: "gal", expiry: null, kcal: 0 });
    } else if (kind === "food") {
      var kcal = Math.round(gap.shortFoodKcal);
      if (kcal <= 0) return;
      var f = state.stores.filter(function (s) { return s.kind === "Food" && s.name === "Stored food - resupply"; })[0];
      if (f) {
        f.kcal = (Number(f.kcal) || 0) + kcal;
        f.amount = Math.round((f.kcal / (hh * 2000)) * 10) / 10;
        f.unit = "days";
      } else {
        state.stores.push({ id: uid(), kind: "Food", name: "Stored food - resupply", amount: Math.round((kcal / (hh * 2000)) * 10) / 10, unit: "days", expiry: null, kcal: kcal });
      }
    } else if (kind === "petfood") {
      var pr = petReadiness();
      if (pr.pets <= 0) return;
      var shortLb = Math.ceil(pr.pets * PET_FOOD_LB_PER_PET_DAY * target - pr.lb);
      if (shortLb <= 0) return;
      var pf = state.stores.filter(function (s) { return s.kind === "PetFood" && s.name === "Stored pet food - resupply"; })[0];
      if (pf) { pf.amount = (Number(pf.amount) || 0) + shortLb; pf.unit = "lbs"; }
      else state.stores.push({ id: uid(), kind: "PetFood", name: "Stored pet food - resupply", amount: shortLb, unit: "lbs", expiry: null, kcal: 0, loc: "Home" });
    } else return;
    saveState();
    renderAll();
  }

  function renderResupply() {
    var wrap = $("nx-resupply-wrap");
    if (!wrap) return;
    var target = resupplyTarget();
    var d = daysReady();
    var lines = resupplyLines();
    var h = "<div class=\"nx-resupply-sel\">" + RESUPPLY_TARGETS.map(function (t) {
      return "<button type=\"button\" class=\"nx-fbtn" + (t === target ? " nx-on" : "") + "\" data-resupply-target=\"" + t + "\">" + t + " DAYS</button>";
    }).join("") + "</div>" +
      "<p class=\"nx-kv\" style=\"margin:12px 0 4px 0;\">DAYS READY <b>" + (d.headline == null ? "--" : fmt(d.headline, 1)) + "</b> // TARGET <b>" + target + " DAYS</b></p>";
    if (!lines.length) {
      h += "<p class=\"nx-kv\" style=\"margin:6px 0 0 0;\">STANDING STRONG - NOTHING DUE. YOUR NUMBER MEETS YOUR TARGET.</p>";
    } else {
      h += lines.map(function (ln) {
        var btns = "";
        if (ln.add) btns += "<button type=\"button\" class=\"nx-btn nx-btn-small\" data-resupply-add=\"" + ln.add + "\">+ ADD STORE</button>";
        if (ln.shopKey) btns += shopBtnHtml(ln.shopKey, "FIND IT");
        return "<label class=\"nx-check-item" + (ln.done ? " nx-done" : "") + "\">" +
          "<input type=\"checkbox\" data-list=\"resupply\" data-idx=\"" + ln.id + "\"" + (ln.done ? " checked" : "") + ">" +
          "<span class=\"nx-check-text\">" + esc(ln.text) + "</span>" +
          (btns ? "<span class=\"nx-check-btns\">" + btns + "</span>" : "") + "</label>";
      }).join("");
      if (lines.some(function (l) { return !!l.shopKey; })) h += shopDisclosureHtml();
    }
    wrap.innerHTML = h;
    renderBuyLater();
    renderPicks();
  }

  function bindResupply() {
    // One delegated click path for every shopping surface plus
    // the Resupply controls. Shop and add buttons live inside
    // checklist <label>s, so their clicks are preventDefaulted:
    // a FIND IT tap must never tick the row's checkbox.
    document.addEventListener("click", function (ev) {
      var shopBtn = ev.target.closest("[data-shop-key]");
      if (shopBtn) {
        ev.preventDefault();
        ev.stopPropagation();
        var entry = SHOP_CATALOG[shopBtn.getAttribute("data-shop-key")];
        if (entry) openShop(entry.query);
        return;
      }
      var addBtn = ev.target.closest("[data-resupply-add]");
      if (addBtn) {
        ev.preventDefault();
        ev.stopPropagation();
        addResupplyStore(addBtn.getAttribute("data-resupply-add"));
        return;
      }
      var tBtn = ev.target.closest("[data-resupply-target]");
      if (tBtn) {
        var t = Number(tBtn.getAttribute("data-resupply-target"));
        if (RESUPPLY_TARGETS.indexOf(t) >= 0 && t !== state.resupplyTarget) {
          state.resupplyTarget = t;
          saveState();
          renderResupply();
        }
      }
    });
    var panel = $("nx-resupply-panel");
    if (panel) panel.addEventListener("change", function (ev) {
      var box = ev.target.closest("[data-list=\"resupply\"]");
      if (!box) return;
      if (!state.checklists["resupply"]) state.checklists["resupply"] = {};
      state.checklists["resupply"][box.getAttribute("data-idx")] = box.checked;
      if (box.checked) sfxConfirm();
      saveState();
      renderResupply();
      renderDashboard();
    });
  }

  /* ---------------- buy later: the Amazon parking lot ----------------
     Connie's ask (2026-11-18): people find gear on Amazon before
     they can afford it - let them park the link in the app and
     buy it when the money is right. Amazon offers no wish-list
     connection, so the link itself is the import: paste any
     Amazon product link and it becomes a saved card with a BUY
     button (carrying the Associates tag once NX_SHOP_TAG is set)
     and a GOT IT tick. Lives in state.buyLater, so it syncs and
     exports with everything else. */
  function parseAmazonLink(raw) {
    var url = String(raw || "").trim();
    if (!url) return null;
    if (!/^https?:\/\//i.test(url)) url = "https://" + url;
    var host = "";
    try { host = new URL(url).hostname.toLowerCase(); } catch (e) { return null; }
    if (!/(^|\.)amazon\.[a-z.]+$/.test(host) && host !== "amzn.to" && host !== "a.co") return null;
    var asin = "";
    var am = url.match(/\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})/i);
    if (am) asin = am[1].toUpperCase();
    var title = "";
    var slug = url.match(/amazon\.[a-z.]+\/([^\/\?#]+)\/(?:dp|gp\/)/i);
    if (slug) {
      try { title = decodeURIComponent(slug[1]).replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim(); } catch (e) { title = ""; }
    }
    return { url: url, asin: asin, title: title };
  }
  function findBuyLater(id) {
    return (Array.isArray(state.buyLater) ? state.buyLater : []).filter(function (b) { return b.id === id; })[0] || null;
  }
  function buyLaterOpenUrl(item) {
    var url = item.url;
    if (NX_SHOP_TAG && !/[?&]tag=/.test(url)) url += (url.indexOf("?") === -1 ? "?" : "&") + "tag=" + encodeURIComponent(NX_SHOP_TAG);
    return url;
  }
  function renderBuyLater() {
    var wrap = $("nx-buylater-wrap");
    if (!wrap) return;
    var items = Array.isArray(state.buyLater) ? state.buyLater : [];
    if (!items.length) {
      wrap.innerHTML = "<p class=\"nx-kv\" style=\"margin:8px 0 0 0;\">NOTHING PARKED YET. FIND GEAR ON AMAZON, COPY THE LINK, SAVE IT HERE FOR WHEN THE MONEY IS RIGHT.</p>";
      return;
    }
    var h = items.map(function (b) {
      var btns = "<button type=\"button\" class=\"nx-btn nx-btn-small nx-shop-btn nx-buy-ui\" data-buylater-buy=\"" + esc(b.id) + "\">BUY</button>" +
        "<button type=\"button\" class=\"nx-btn nx-btn-small\" data-buylater-got=\"" + esc(b.id) + "\">" + (b.got ? "UNDO" : "GOT IT") + "</button>" +
        "<button type=\"button\" class=\"nx-btn nx-btn-small\" data-buylater-del=\"" + esc(b.id) + "\">REMOVE</button>";
      return "<div class=\"nx-check-item" + (b.got ? " nx-done" : "") + "\"><span class=\"nx-check-text\">" + esc(b.title) + "</span><span class=\"nx-check-btns\">" + btns + "</span></div>";
    }).join("");
    wrap.innerHTML = h + shopDisclosureHtml();
  }
  function bindBuyLater() {
    var form = $("nx-buylater-form");
    if (form) form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var msg = $("nx-buylater-msg");
      var parsed = parseAmazonLink($("nx-buylater-url").value);
      if (!parsed) { showMsg(msg, "THAT DOES NOT LOOK LIKE AN AMAZON LINK.", "err"); return; }
      var items = Array.isArray(state.buyLater) ? state.buyLater : (state.buyLater = []);
      var dupe = items.some(function (b) { return (parsed.asin && b.asin === parsed.asin) || b.url === parsed.url; });
      if (dupe) { showMsg(msg, "ALREADY ON YOUR LIST.", "err"); return; }
      var name = $("nx-buylater-name").value.trim();
      var title = name || parsed.title || (parsed.asin ? "Amazon item " + parsed.asin : "Amazon item");
      items.unshift({ id: uid(), title: title.slice(0, 120), url: parsed.url, asin: parsed.asin, added: todayKeyLocal(), got: false });
      saveState();
      form.reset();
      showMsg(msg, "SAVED. IT WAITS HERE UNTIL YOU ARE READY.", "good");
      sfxConfirm();
      renderBuyLater();
    });
    document.addEventListener("click", function (ev) {
      var buy = ev.target.closest("[data-buylater-buy]");
      if (buy) {
        ev.preventDefault();
        var it = findBuyLater(buy.getAttribute("data-buylater-buy"));
        if (it && !IS_IOS_APP) window.open(buyLaterOpenUrl(it), "_blank", "noopener");
        return;
      }
      var got = ev.target.closest("[data-buylater-got]");
      if (got) {
        var g = findBuyLater(got.getAttribute("data-buylater-got"));
        if (g) { g.got = !g.got; if (g.got) sfxConfirm(); saveState(); renderBuyLater(); }
        return;
      }
      var del = ev.target.closest("[data-buylater-del]");
      if (del) {
        state.buyLater = (Array.isArray(state.buyLater) ? state.buyLater : []).filter(function (b) { return b.id !== del.getAttribute("data-buylater-del"); });
        saveState();
        renderBuyLater();
        return;
      }
      var pbuy = ev.target.closest("[data-pick-buy]");
      if (pbuy) {
        ev.preventDefault();
        var pk = NX_PICKS[Number(pbuy.getAttribute("data-pick-buy"))];
        if (pk && !IS_IOS_APP) window.open(buyLaterOpenUrl(pk), "_blank", "noopener");
        return;
      }
      var psave = ev.target.closest("[data-pick-save]");
      if (psave) {
        var sp = NX_PICKS[Number(psave.getAttribute("data-pick-save"))];
        if (sp) {
          var parsed = parseAmazonLink(sp.url);
          var items = Array.isArray(state.buyLater) ? state.buyLater : (state.buyLater = []);
          var dupe = !!parsed && items.some(function (b) { return (parsed.asin && b.asin === parsed.asin) || b.url === parsed.url; });
          var msg = $("nx-buylater-msg");
          if (dupe) { showMsg(msg, "ALREADY ON YOUR LIST.", "err"); }
          else {
            items.unshift({ id: uid(), title: sp.t.slice(0, 120), url: sp.url, asin: parsed ? parsed.asin : "", added: todayKeyLocal(), got: false });
            saveState();
            showMsg(msg, "SAVED TO YOUR BUY LATER LIST.", "good");
            sfxConfirm();
            renderBuyLater();
          }
        }
      }
    });
  }

  /* ---------------- operator picks: the curated gear list ----------------
     Connie's hand-built favorites (rounds 1-7, 2026-11-18), shipped
     inside the app so every user browses the same list: BUY opens
     the exact product on Amazon with the Associates tag riding
     along (buyLaterOpenUrl appends it), SAVE parks the item on
     the user's own Buy Later list. Static data - no state, no
     sync. On iOS the BUY buttons hide with every other buy
     surface (nx-buy-ui) and the handler refuses outright. */
  var NX_PICKS = [
    { c: "WATER", t: "LifeStraw, 5-pack", url: "https://www.amazon.com/dp/B087D7K48X" },
    { c: "WATER", t: "WaterBOB bathtub bladder, 100 gal", url: "https://www.amazon.com/dp/B001AXLUX2" },
    { c: "WATER", t: "Sawyer MINI filter", url: "https://www.amazon.com/dp/B00FA2RLX2" },
    { c: "WATER", t: "Datrex water pouches, 18-pack", url: "https://www.amazon.com/dp/B0134DAXJ2" },
    { c: "FOOD SUPPLY", t: "Augason Farms 30-day bucket, 200 servings", url: "https://www.amazon.com/dp/B071KPGLBK" },
    { c: "FOOD SUPPLY", t: "Mountain House Expedition Bucket, 30 servings", url: "https://www.amazon.com/dp/B082WZZ6SN" },
    { c: "POWER & LIGHT", t: "Luci Outdoor 2.0 solar lantern", url: "https://www.amazon.com/dp/B074NQLRTF" },
    { c: "POWER & LIGHT", t: "Black Diamond Spot 400 headlamp", url: "https://www.amazon.com/dp/B09NQK2581" },
    { c: "COMMS", t: "Midland GXT1000VP4 GMRS pair", url: "https://www.amazon.com/dp/B001WMFYH4" },
    { c: "COMMS", t: "Baofeng UV-5R", url: "https://www.amazon.com/dp/B007H4VT7A" },
    { c: "SHELTER & WARMTH", t: "SOL Escape Bivvy with hood", url: "https://www.amazon.com/dp/B0CYTKW4JH" },
    { c: "SHELTER & WARMTH", t: "Swiss Safe mylar blankets, 10-pack", url: "https://www.amazon.com/dp/B08MHGKMBH" },
    { c: "SHELTER & WARMTH", t: "HotHands hand and toe warmers combo", url: "https://www.amazon.com/dp/B06ZYW6HDK" },
    { c: "MEDICAL", t: "CAT tourniquet Gen 7", url: "https://www.amazon.com/dp/B07CP6Z1C4" },
    { c: "MEDICAL", t: "3M Aura 9205+ N95, 10-pack", url: "https://www.amazon.com/dp/B095DVPTCT" },
    { c: "TOOLS & FIRE", t: "Morakniv Companion", url: "https://www.amazon.com/dp/B005EOJAKI" },
    { c: "TOOLS & FIRE", t: "Bushcraft Survival ferro rod kit", url: "https://www.amazon.com/dp/B08G1Z91MH" },
    { c: "VEHICLE", t: "NOCO Boost GB40 jump starter", url: "https://www.amazon.com/dp/B015TKUPIC" },
    { c: "VEHICLE", t: "VIAIR 88P tire inflator", url: "https://www.amazon.com/dp/B005ASY23I" },
    { c: "VEHICLE", t: "resqme keychain escape tool", url: "https://www.amazon.com/dp/B000IE0EZO" },
    { c: "VEHICLE", t: "SOG XL Entrenching Tool folding shovel", url: "https://www.amazon.com/dp/B0DVJBGF1F" },
    { c: "MEDICAL", t: "Adventure Medical Kits Trauma Pak with QuikClot", url: "https://www.amazon.com/dp/B003BS2PW4" },
    { c: "MEDICAL", t: "QuikClot Advanced Clotting Gauze", url: "https://www.amazon.com/dp/B0CYDY6ZC5" },
    { c: "MEDICAL", t: "Israeli emergency bandage 6 inch, 2-pack", url: "https://www.amazon.com/dp/B01M3R6A6J" },
    { c: "MEDICAL", t: "HyFin Vent Chest Seal twin pack", url: "https://www.amazon.com/dp/B00KQS2NGK" },
    { c: "SHELTER & SLEEP", t: "Go Time Gear Life Bivy", url: "https://www.amazon.com/dp/B09WSN3DTX" },
    { c: "SHELTER & SLEEP", t: "Arcturus military wool blanket", url: "https://www.amazon.com/dp/B01IJWUYLK" },
    { c: "SHELTER & SLEEP", t: "Therm-a-Rest Z Lite Sol sleeping pad", url: "https://www.amazon.com/dp/B005I6R0WC" },
    { c: "SHELTER & SLEEP", t: "Coleman Sundome 4-person tent", url: "https://www.amazon.com/dp/B09HN1W5K9" },
    { c: "HOME & HEAT", t: "Mr. Heater Buddy 9,000 BTU propane heater", url: "https://www.amazon.com/dp/B002G51BZU" },
    { c: "HOME & HEAT", t: "Kidde smoke and CO detector, AA battery", url: "https://www.amazon.com/dp/B0BZT85TLG" },
    { c: "WATER", t: "Sawyer Squeeze filter SP129", url: "https://www.amazon.com/dp/B00B1OSU4W" },
    { c: "TOOLS & FIRE", t: "Leatherman Wave+ multitool", url: "https://www.amazon.com/dp/B079MJ6MLV" },
    { c: "TOOLS & FIRE", t: "Fenix PD36R Pro flashlight, 2800 lumen", url: "https://www.amazon.com/dp/B0BGMZ4YNC" },
    { c: "KIDS & GRANDBABY", t: "Pedialyte electrolyte powder, 24-pack variety", url: "https://www.amazon.com/dp/B01JO4KWAU" },
    { c: "KIDS & GRANDBABY", t: "Earth's Best organic baby food pouches, 12-pack", url: "https://www.amazon.com/Earths-Best-Organic-Banana-Raspberry/dp/B0083ZZG2G" },
    { c: "KIDS & GRANDBABY", t: "Little Remedies New Baby Essentials Kit", url: "https://www.amazon.com/dp/B075G6XMSF" },
    { c: "KIDS & GRANDBABY", t: "Foxelli USB-C rechargeable headlamp", url: "https://www.amazon.com/dp/B07B51FWLP" },
    { c: "KIDS & GRANDBABY", t: "Dysaim dinosaur headlamp for kids", url: "https://www.amazon.com/dp/B0CYGJRB9T" },
    { c: "PETS", t: "Vittles Vault airtight pet food container, 15 lb", url: "https://www.amazon.com/dp/B000A6UF4U" },
    { c: "PETS", t: "EVERLIT Pet Medic first aid kit, 95 pc", url: "https://www.amazon.com/dp/B0DDXFZC4B" },
    { c: "PETS", t: "SLSON collapsible travel bowls with lids, 2-pack", url: "https://www.amazon.com/dp/B0DXN7X5TS" },
    { c: "PETS", t: "Amazon Basics soft-sided pet carrier, airline approved", url: "https://www.amazon.com/dp/B00QHC0050" },
    { c: "PETS", t: "Critter Concepts 5-gallon gravity pet water dispenser", url: "https://www.amazon.com/dp/B00HZSOMPO" },
    { c: "HOME FOOD STORAGE", t: "Mylar bags 1-gallon kit, 120 bags + oxygen absorbers", url: "https://www.amazon.com/dp/B09XN6TQLY" },
    { c: "HOME FOOD STORAGE", t: "5-gallon mylar bags, 15-pack + 2000cc absorbers", url: "https://www.amazon.com/dp/B09XN6MQWP" },
    { c: "HOME FOOD STORAGE", t: "Gamma Seal lid", url: "https://www.amazon.com/dp/B007KAY4S2" },
    { c: "HOME FOOD STORAGE", t: "FoodSaver FM2100 vacuum sealer", url: "https://www.amazon.com/dp/B00LUGK5QW" },
    { c: "HOME FOOD STORAGE", t: "Ball wide mouth mason jars 32 oz, 12-pack", url: "https://www.amazon.com/dp/B0DVLPR6CT" },
    { c: "HOME FOOD STORAGE", t: "Freeze-dried strawberries, 1 lb resealable bucket", url: "https://www.amazon.com/dp/B0F21JXFS4" },
    { c: "HOME FOOD STORAGE", t: "Augason Farms Country Fresh instant dry milk pouch", url: "https://www.amazon.com/dp/B0B44L28LN" },
    { c: "HOME FOOD STORAGE", t: "Augason Farms Butter Powder #10 can", url: "https://www.amazon.com/dp/B0096I6XSU" },
    { c: "HOME FOOD STORAGE", t: "Bucket lid opener wrench, aluminum", url: "https://www.amazon.com/dp/B0D1D7SYVB" },
    { c: "VEHICLE", t: "Wykodra tire plug repair kit, 36 pc", url: "https://www.amazon.com/dp/B0FS21YHWT" },
    { c: "VEHICLE", t: "METOWARE tow strap kit 3\" x 20 ft with D-ring shackles", url: "https://www.amazon.com/dp/B0BRN2FNB7" },
    { c: "VEHICLE", t: "First Alert AUTO5 car fire extinguisher", url: "https://www.amazon.com/dp/B000P0DPGQ" },
    { c: "VEHICLE", t: "XOOL warning triangle kit with vests and gloves", url: "https://www.amazon.com/dp/B07DCPWX99" },
    { c: "VEHICLE", t: "TOPDC jumper cables, 4 gauge x 20 ft", url: "https://www.amazon.com/dp/B073VHBRFC" },
    { c: "VEHICLE", t: "Foldable windshield sun shade, universal fit", url: "https://www.amazon.com/dp/B0GS8KL2PJ" },
    { c: "ARIZONA HEAT", t: "Liquid I.V. Hydration Multiplier, lemon lime, 16 ct", url: "https://www.amazon.com/dp/B01IT9NLHW" },
    { c: "ARIZONA HEAT", t: "Cooling towels, 4-pack", url: "https://www.amazon.com/dp/B0CBPBZGQV" },
    { c: "ARIZONA HEAT", t: "RUNTOP rechargeable camping fan with LED light", url: "https://www.amazon.com/dp/B0BWJL49SL" },
    { c: "ARIZONA HEAT", t: "BUZIO 64 oz insulated bottle, cold 48 hrs", url: "https://www.amazon.com/dp/B07SMGMRC1" },
    { c: "MORALE & FUN", t: "Hoyle waterproof playing cards", url: "https://www.amazon.com/dp/B000J3Z7TC" },
    { c: "MORALE & FUN", t: "Exploding Kittens, collectible tin edition", url: "https://www.amazon.com/dp/B0D9C251D4" },
    { c: "MORALE & FUN", t: "JBL Flip 6 waterproof Bluetooth speaker", url: "https://www.amazon.com/dp/B09GJZKQ3K" },
    { c: "MORALE & FUN", t: "Wise Owl Outfitters double hammock with tree straps", url: "https://www.amazon.com/dp/B01E3EHRVS" },
    { c: "KITCHEN & COFFEE", t: "Lodge 12-inch cast iron skillet, pre-seasoned", url: "https://www.amazon.com/dp/B00006JSUB" },
    { c: "KITCHEN & COFFEE", t: "Instant Pot Duo 7-in-1, 8 quart, with glass lid", url: "https://www.amazon.com/dp/B08F31T7MH" },
    { c: "KITCHEN & COFFEE", t: "Ninja Air Fryer Pro 5-in-1, 5 quart", url: "https://www.amazon.com/dp/B0DW4KG8VM" },
    { c: "KITCHEN & COFFEE", t: "ThermoPro TP03 instant read thermometer", url: "https://www.amazon.com/dp/B07Y51PCW7" },
    { c: "KITCHEN & COFFEE", t: "Swing-A-Way portable can opener", url: "https://www.amazon.com/dp/B001CDEFK0" },
    { c: "KITCHEN & COFFEE", t: "ESPRO P7 stainless French press, 32 oz", url: "https://www.amazon.com/dp/B011WTMV1I" },
    { c: "KITCHEN & COFFEE", t: "Bialetti Moka Express, 6 cup", url: "https://www.amazon.com/dp/B00004RFRU" },
    { c: "KITCHEN & COFFEE", t: "Bonavita 1L digital gooseneck kettle", url: "https://www.amazon.com/dp/B005YR0F40" },
    { c: "KIDS & GRANDBABY", t: "One Fire rechargeable night light, 10 colors", url: "https://www.amazon.com/dp/B09ZX4TDTZ" },
    { c: "KIDS & GRANDBABY", t: "iFunLong glow in the dark stars, 200 pc + moons", url: "https://www.amazon.com/dp/B0F174GRBC" },
    { c: "KIDS & GRANDBABY", t: "Scotamalone kids binoculars, shock proof", url: "https://www.amazon.com/dp/B08QTQCQGR" },
    { c: "KIDS & GRANDBABY", t: "Fimibuke kids insulated bottle 18 oz, 2-pack", url: "https://www.amazon.com/dp/B0DYJCJND7" },
    { c: "FOOD SUPPLY", t: "Survival Garden Seeds home garden 30-pack, 18,500+ heirloom seeds", url: "https://www.amazon.com/dp/B08TB3T43F" },
    { c: "POWER & LIGHT", t: "MPOWERD Luci Original inflatable solar lantern", url: "https://www.amazon.com/dp/B00DQ1RDWS" },
    { c: "POWER & LIGHT", t: "BigBlue 28W foldable solar panel charger", url: "https://www.amazon.com/dp/B01EXWCPLC" },
    { c: "GEAR & HOME DEFENSE", t: "Amazon Basics 550 paracord, 100 ft", url: "https://www.amazon.com/dp/B08HNZB3PZ" },
    { c: "GEAR & HOME DEFENSE", t: "Darn Tough merino wool socks, 6-pack", url: "https://www.amazon.com/dp/B013WKUXP6" },
    { c: "GEAR & HOME DEFENSE", t: "HotHands hand warmers, bulk 50 pairs", url: "https://www.amazon.com/dp/B0CM4H724R" },
    { c: "GEAR & HOME DEFENSE", t: "Master Lock door security bar, 2-pack", url: "https://www.amazon.com/dp/B0BJ12T27J" },
    { c: "GEAR & HOME DEFENSE", t: "FunOwlet fireproof document bags, 3-pack", url: "https://www.amazon.com/dp/B08PBCP6PG" },
    { c: "GEAR & HOME DEFENSE", t: "SAS Survival Handbook, 3rd edition paperback", url: "https://www.amazon.com/dp/0062378074" },
    { c: "SANITATION", t: "Camco bucket toilet seat with lid", url: "https://www.amazon.com/dp/B07NM39V51" },
    { c: "SANITATION", t: "Solar shower bag, 5 gallon, temp display", url: "https://www.amazon.com/dp/B0FB3PP17Z" },
    { c: "SANITATION", t: "MedPride nitrile exam gloves, 100 count", url: "https://www.amazon.com/dp/B00GS8VGP6" },
    { c: "HEALTH & HOME", t: "3M 8210 N95 respirators, 20-pack", url: "https://www.amazon.com/dp/B008MCUZZS" },
    { c: "HEALTH & HOME", t: "Where There Is No Doctor", url: "https://www.amazon.com/dp/0942364155" },
    { c: "HEALTH & HOME", t: "Battery Daddy organizer with tester, holds 150", url: "https://www.amazon.com/dp/B0B4576YTZ" },
    { c: "SKILLS & COMFORT", t: "Ball Complete Book of Home Preserving", url: "https://www.amazon.com/dp/0778801314" },
    { c: "SKILLS & COMFORT", t: "ESTINGO heated throw blanket 50x60", url: "https://www.amazon.com/dp/B0FCLRY37L" }
  ];
  function renderPicks() {
    var wrap = $("nx-picks-wrap");
    if (!wrap) return;
    var cats = [];
    NX_PICKS.forEach(function (p) { if (cats.indexOf(p.c) < 0) cats.push(p.c); });
    var h = cats.map(function (c) {
      var rows = NX_PICKS.map(function (p, i) { return { p: p, i: i }; })
        .filter(function (x) { return x.p.c === c; })
        .map(function (x) {
          return "<div class=\"nx-check-item\"><span class=\"nx-check-text\">" + esc(x.p.t) + "</span><span class=\"nx-check-btns\">" +
            "<button type=\"button\" class=\"nx-btn nx-btn-small nx-shop-btn nx-buy-ui\" data-pick-buy=\"" + x.i + "\">BUY</button>" +
            "<button type=\"button\" class=\"nx-btn nx-btn-small\" data-pick-save=\"" + x.i + "\">SAVE</button></span></div>";
        }).join("");
      return "<p class=\"nx-kv\" style=\"margin:16px 0 4px 0;\">" + esc(c) + "</p>" + rows;
    }).join("");
    wrap.innerHTML = h + shopDisclosureHtml();
  }

  /* ---------------- readiness check-in + first orders ----------------
     The first-run experience. The app ships empty; on first run
     this questionnaire opens on its own and finds out how
     prepared the user actually is. The answers are the user's
     own data, not sample data: household counts become real
     crew entries (tagged checkinRole so a retake updates them
     in place instead of duplicating), stored water and food
     become real stores named "Stored water - check-in" and
     "Stored food - check-in", and the gaps become FIRST ORDERS
     - a generated action checklist (state.firstOrders) rendered
     in Lists alongside the scenario lists but kept OUT of
     checklistStats, exactly like the Intel checklist. Skipping
     leaves the app empty and a persistent card on Command until
     the check-in is completed. */
  var CHECKIN_WATER_GAL = { none: 0, g3: 3, g10: 10, g25: 25, g55: 55 };
  var CHECKIN_FOOD_DAYS = { none: 0, few: 3, week: 7, twoWeeks: 14, month: 30 };
  var CHECKIN_STORE_WATER = "Stored water - check-in";
  var CHECKIN_STORE_FOOD = "Stored food - check-in";
  var FIRST_ORDERS_TARGET_DAYS = 14;

  var CHECKIN_STEPS = [
    { key: "household", title: "Your Household", sub: "WHO RIDES OUT THE EMERGENCY WITH YOU? DAYS READY IS COMPUTED PER PERSON - THESE COUNTS BECOME YOUR CREW." },
    { key: "climate", title: "Home Climate", sub: "THE GROUND YOUR GEAR HAS TO WORK IN. PICK THE DOMINANT ONE." },
    { key: "water", title: "Stored Water", sub: "DRINKING WATER ON HAND RIGHT NOW - BOTTLES, JUGS, BARRELS, ALL OF IT." },
    { key: "food", title: "Stored Food", sub: "FOOD SET ASIDE BEYOND THE EVERYDAY PANTRY. BE HONEST - THE MATH USES IT." },
    { key: "cook", title: "Cook Without Power", sub: "GRID DOWN, STOVE DEAD. CAN YOU STILL MAKE A HOT MEAL?" },
    { key: "medical", title: "Medical", sub: "YOUR MEDICAL COVERAGE AT HOME RIGHT NOW." },
    { key: "gobag", title: "Go-Bag", sub: "A PACKED BAG YOU CAN GRAB ON THE WAY OUT. ONE PER ADULT IS THE STANDARD." },
    { key: "comms", title: "Comms", sub: "WHEN THE PHONES DIE, HOW DOES YOUR CREW TALK?" },
    { key: "concern", title: "Biggest Concern", sub: "THE SCENARIO YOU LOSE SLEEP OVER. IT GOES ON YOUR RECORD." }
  ];
  var CHECKIN_OPTIONS = {
    climate: ["Desert", "Cold", "Wet", "Urban"].map(function (c) { return { v: c, label: c.toUpperCase() }; }),
    water: [
      { v: "none", label: "NONE" },
      { v: "g3", label: "ABOUT 3 GAL" },
      { v: "g10", label: "ABOUT 10 GAL" },
      { v: "g25", label: "ABOUT 25 GAL" },
      { v: "g55", label: "55 GAL OR MORE" }
    ],
    food: [
      { v: "none", label: "NONE SET ASIDE" },
      { v: "few", label: "A FEW DAYS" },
      { v: "week", label: "ABOUT A WEEK" },
      { v: "twoWeeks", label: "ABOUT 2 WEEKS" },
      { v: "month", label: "A MONTH OR MORE" }
    ],
    cook: [
      { v: "yes", label: "YES" },
      { v: "no", label: "NO" }
    ],
    medical: [
      { v: "trauma", label: "TRAUMA KIT" },
      { v: "basic", label: "BASIC FIRST AID" },
      { v: "none", label: "NONE" }
    ],
    gobag: [
      { v: "packed", label: "PACKED" },
      { v: "partial", label: "PARTIAL" },
      { v: "none", label: "NONE" }
    ],
    comms: [
      { v: "radios", label: "RADIOS - GMRS OR HAM" },
      { v: "phones", label: "PHONES ONLY" },
      { v: "neither", label: "NEITHER" }
    ],
    concern: ["Power outage", "Storms", "Earthquake", "Wildfire", "Unrest", "All of them"].map(function (c) { return { v: c, label: c.toUpperCase() }; })
  };

  var checkin = { open: false, step: 0, answers: null, hadDone: false };

  function openCheckin() {
    // Remember whether this run is a retake: the walkthrough only
    // auto-starts after a FIRST completion, never after a retake.
    checkin.hadDone = !!(state.assessment && state.assessment.done);
    if (!checkin.answers || (state.assessment && state.assessment.done)) {
      checkin.answers = sanitizeAssessment(state.assessment);
    }
    checkin.step = 0;
    checkin.open = true;
    showView("checkin");
    renderCheckin();
  }
  function closeCheckin() {
    if (!checkin.open) return;
    checkin.open = false;
    if (currentView === "checkin") showView("command");
  }
  function maybeOpenCheckin() {
    if (!state.assessment || !state.assessment.done) openCheckin();
  }

  /* Crew: entries the check-in created carry checkinRole
     ("Adult" / "Child"). A retake keeps the first N of them
     (renames and notes survive), drops extras, and appends new
     ones named "Adult 1..n" / "Child 1..n". Crew the user added
     by hand is never touched. Pets stay out of the crew list -
     they are recorded in the assessment only, per the model. */
  function checkinCrewSync(a) {
    var created = [];
    ["Adult", "Child"].forEach(function (role) {
      var want = role === "Adult" ? a.adults : a.children;
      var mine = state.crew.filter(function (c) { return c.checkinRole === role; });
      var keepIds = {};
      mine.slice(0, want).forEach(function (c) { keepIds[c.id] = true; });
      for (var i = mine.length; i < want; i++) {
        created.push({ id: uid(), name: role + " " + (i + 1), role: role, notes: "", checkinRole: role });
      }
      state.crew.forEach(function (c) {
        if (c.checkinRole === role && !keepIds[c.id]) {
          state.gear.forEach(function (g) { if (g.assignedTo === c.id) g.assignedTo = ""; });
        }
      });
      state.crew = state.crew.filter(function (c) { return c.checkinRole !== role || keepIds[c.id]; });
    });
    state.crew = state.crew.concat(created);
  }

  /* Stores: exactly one water and one food store carry the
     check-in names. A retake updates them in place (or removes
     them when the new answer is zero) - never duplicates. */
  function checkinStoreSync(a) {
    var hh = Math.max(1, a.adults + a.children);
    syncOne("Water", CHECKIN_STORE_WATER, CHECKIN_WATER_GAL[a.water] || 0, function (gal) {
      return { amount: gal, unit: "gal", kcal: 0 };
    });
    syncOne("Food", CHECKIN_STORE_FOOD, (CHECKIN_FOOD_DAYS[a.food] || 0) * hh * 2000, function (kcal, days) {
      return { amount: days, unit: "days", kcal: kcal };
    });
    function syncOne(kind, name, value, fields) {
      var idx = -1;
      state.stores.forEach(function (s, i) { if (idx < 0 && s.name === name && s.kind === kind) idx = i; });
      if (value > 0) {
        var f = fields(value, CHECKIN_FOOD_DAYS[a.food] || 0);
        if (idx >= 0) {
          var s = state.stores[idx];
          Object.keys(f).forEach(function (k) { s[k] = f[k]; });
          s.expiry = null;
        } else {
          var ns = { id: uid(), kind: kind, name: name, expiry: null };
          Object.keys(f).forEach(function (k) { ns[k] = f[k]; });
          state.stores.push(ns);
        }
      } else if (idx >= 0) state.stores.splice(idx, 1);
    }
  }

  /* First Orders: the teaching step. Every order closes a real
     gap, computed with the need-calculator math against a
     14-day target, in fix-first order. Capped at 8. */
  function firstOrdersList(a) {
    var orders = [];
    var hh = Math.max(1, a.adults + a.children);
    var gap = calcGap(calcNeeds(hh, FIRST_ORDERS_TARGET_DAYS));
    if (gap.shortWater > 0) orders.push({ text: "Store " + fmt(gap.shortWater, 1) + " more gallons of water - 1 gal per person per day for 14 days", shopKey: gap.shortWater >= 40 ? "water-barrel" : "water-storage" });
    if (gap.shortFoodKcal > 0) orders.push({ text: "Add food - about " + Math.ceil(gap.shortFoodKcal / (hh * 2000)) + " more days of calories for your household (" + fmt(gap.shortFoodKcal, 0) + " kcal)", shopKey: "food-bucket" });
    if (a.cook === false) orders.push({ text: "Get a way to cook without power - a camp stove and fuel", shopKey: "stove" });
    if (a.medical === "none") orders.push({ text: "Add a trauma kit - bleeding control, not just bandages", shopKey: "trauma-kit" });
    else if (a.medical === "basic") orders.push({ text: "Upgrade basic first aid to a trauma kit", shopKey: "trauma-kit" });
    if (a.gobag === "none") orders.push({ text: "Pack a go-bag for each adult", shopKey: "gobag" });
    else if (a.gobag === "partial") orders.push({ text: "Finish the go-bags - one packed bag per adult, staged by the door", shopKey: "gobag" });
    if (a.comms && a.comms !== "radios") orders.push({ text: "Get two GMRS radios and pick a family channel", shopKey: "radios" });
    if (state.settings.homeLat === 33.4484 && state.settings.homeLng === -112.0740) {
      orders.push({ text: "Set your home base in System so weather alerts cover your area", shopKey: null });
    }
    var hasRealNames = state.crew.some(function (c) { return !c.checkinRole; });
    var hasRally = state.comms.length > 0 || !!primaryRally();
    if (!hasRealNames || !hasRally) orders.push({ text: "Add names and a rally point for your crew", shopKey: null });
    // Pets last (Ready.gov build): a real gap, but it queues
    // behind the human orders and yields to the standing cap
    // of 8 when a household has bigger holes to fill first.
    if (a.pets > 0 && petFoodLb() <= 0) {
      orders.push({ text: "Stock pet food - " + a.pets + " pet" + (a.pets > 1 ? "s" : "") + " eat too - about " +
        Math.ceil(a.pets * PET_FOOD_LB_PER_PET_DAY * FIRST_ORDERS_TARGET_DAYS) + " lb covers " + FIRST_ORDERS_TARGET_DAYS + " days", shopKey: "pet-food" });
    }
    return orders.slice(0, 8);
  }

  function applyCheckin(a) {
    checkinCrewSync(a);
    checkinStoreSync(a);
    a.done = true;
    state.assessment = a;
    var prevDone = {};
    (Array.isArray(state.firstOrders) ? state.firstOrders : []).forEach(function (o) { if (o && o.done) prevDone[o.text] = true; });
    state.firstOrders = firstOrdersList(a).map(function (o) { return { text: o.text, done: !!prevDone[o.text], shopKey: o.shopKey || null }; });
    // Ticks recorded against the old list carry over by text.
    var saved = state.checklists["firstOrders"] || {};
    var fresh = {};
    state.firstOrders.forEach(function (o, i) { if (o.done) fresh[i] = true; });
    state.checklists["firstOrders"] = fresh;
    saveState();
  }

  function assessmentAreas(a) {
    var d = daysReady();
    function area(label, pct, line) { return { label: label, pct: pct, line: line }; }
    var areas = [
      area("WATER", d.waterDays == null ? 0 : clamp((d.waterDays / FIRST_ORDERS_TARGET_DAYS) * 100, 0, 100),
        d.waterDays == null ? "NO WATER STORED" : fmt(d.waterDays, 1) + " DAYS ON HAND"),
      area("FOOD", d.foodDays == null ? 0 : clamp((d.foodDays / FIRST_ORDERS_TARGET_DAYS) * 100, 0, 100),
        d.foodDays == null ? "NO FOOD COUNTED" : fmt(d.foodDays, 1) + " DAYS ON HAND"),
      area("MEDICAL", a.medical === "trauma" ? 100 : a.medical === "basic" ? 50 : 0,
        a.medical === "trauma" ? "TRAUMA KIT ON HAND" : a.medical === "basic" ? "BASIC FIRST AID ONLY" : a.medical === "none" ? "NO MEDICAL KIT" : "NOT ANSWERED"),
      area("COMMS", a.comms === "radios" ? 100 : a.comms === "phones" ? 40 : 0,
        a.comms === "radios" ? "RADIOS ON HAND" : a.comms === "phones" ? "PHONES ONLY - DEAD WHEN THE GRID IS" : a.comms === "neither" ? "NO COMMS PLAN" : "NOT ANSWERED"),
      area("MOBILITY", a.gobag === "packed" ? 100 : a.gobag === "partial" ? 50 : 0,
        a.gobag === "packed" ? "GO-BAG PACKED" : a.gobag === "partial" ? "GO-BAG PARTIAL" : a.gobag === "none" ? "NO GO-BAG" : "NOT ANSWERED")
    ];
    // A sixth area appears only for pet households (Ready.gov
    // build) - pet-less households keep the original five.
    if (a.pets > 0) {
      var pr = petReadiness();
      areas.push(area("PETS", pr.lb > 0 ? clamp((pr.days / FIRST_ORDERS_TARGET_DAYS) * 100, 0, 100) : 0,
        pr.lb > 0 ? fmt(pr.days, 1) + " DAYS OF PET FOOD" : "NO PET FOOD STORED"));
    }
    return areas;
  }

  function checkinStepHtml() {
    var a = checkin.answers;
    var step = CHECKIN_STEPS[checkin.step];
    var key = step.key;
    var h = "<p class=\"nx-stat-label\">Readiness Check-In // Step " + (checkin.step + 1) + " of " + CHECKIN_STEPS.length + "</p>" +
      "<div class=\"nx-seg\">" + segHtml(((checkin.step + 1) / CHECKIN_STEPS.length) * 100, false) + "</div>" +
      "<div class=\"nx-checkin-art\">" + artBig(key) + "</div>" +
      "<h2 class=\"nx-h\" style=\"margin-top:14px;\">" + esc(step.title) + "</h2>" +
      "<p class=\"nx-h-note\">" + esc(step.sub) + "</p>";
    if (key === "household") {
      h += [["adults", "ADULTS"], ["children", "CHILDREN"], ["pets", "PETS - RECORDED, NOT IN THE DAYS MATH"]].map(function (row) {
        return "<div class=\"nx-switch-row\" style=\"justify-content:space-between; margin:12px 0;\">" +
          "<div style=\"font-weight:700; letter-spacing:2px;\">" + row[1] + "</div>" +
          "<div class=\"nx-btn-row\" style=\"margin:0;\">" +
          "<button type=\"button\" class=\"nx-btn nx-btn-small\" data-checkin-step=\"" + row[0] + "\" data-delta=\"-1\">-</button>" +
          "<span class=\"nx-row-weight\" id=\"nx-checkin-n-" + row[0] + "\" style=\"min-width:36px; text-align:center;\">" + a[row[0]] + "</span>" +
          "<button type=\"button\" class=\"nx-btn nx-btn-small\" data-checkin-step=\"" + row[0] + "\" data-delta=\"1\">+</button>" +
          "</div></div>";
      }).join("") +
      "<p class=\"nx-h-note\" style=\"margin-top:10px;\">CREW ENTRIES ARE CREATED FROM THESE COUNTS - RENAME THEM IN THE CREW TAB.</p>";
    } else {
      var cur = key === "cook" ? (a.cook === true ? "yes" : a.cook === false ? "no" : "") : a[key];
      h += "<div class=\"nx-checkin-opts\">" + CHECKIN_OPTIONS[key].map(function (o) {
        return "<button type=\"button\" class=\"nx-fbtn" + (cur === o.v ? " nx-on" : "") + "\" data-checkin-opt=\"" + esc(o.v) + "\">" + esc(o.label) + "</button>";
      }).join("") + "</div>";
    }
    var last = checkin.step === CHECKIN_STEPS.length - 1;
    h += "<div class=\"nx-btn-row\" style=\"margin-top:18px;\">" +
      (checkin.step > 0 ? "<button type=\"button\" class=\"nx-btn\" id=\"nx-checkin-back\">Back</button>" : "") +
      "<button type=\"button\" class=\"nx-btn nx-btn-accent\" id=\"nx-checkin-next\">" + (last ? "See Assessment" : "Next") + "</button>" +
      "<button type=\"button\" class=\"nx-btn\" id=\"nx-checkin-skipq\">Skip Question</button>" +
      "<button type=\"button\" class=\"nx-btn\" id=\"nx-checkin-exit\">Skip for Now</button>" +
      "</div>";
    return h;
  }

  function checkinAssessmentHtml() {
    var a = checkin.answers;
    var d = daysReady();
    var h = "<p class=\"nx-stat-label\">Assessment // Readiness Check-In Complete</p>" +
      "<div style=\"display:flex; align-items:baseline; gap:14px; flex-wrap:wrap; margin-top:4px;\">" +
      "<span style=\"font-family:var(--nx-mono); font-size:62px; font-weight:700; line-height:1;\">" + (d.headline == null ? "--" : fmt(d.headline, 1)) + "</span>" +
      "<span style=\"font-family:var(--nx-mono); font-size:16px; color:var(--nx-dim);\">DAYS READY</span></div>" +
      "<p class=\"nx-kv\" style=\"margin:6px 0 0 0;\">HOUSEHOLD: <b>" + d.household + "</b>" +
      (a.pets ? " // +" + a.pets + " PET" + (a.pets > 1 ? "S" : "") : "") +
      (a.climate ? " // CLIMATE: <b>" + esc(a.climate.toUpperCase()) + "</b>" : "") +
      (a.concern ? " // BIGGEST CONCERN: <b>" + esc(a.concern.toUpperCase()) + "</b>" : "") + "</p>";
    h += assessmentAreas(a).map(function (ar) {
      return "<div style=\"margin-top:12px;\"><div class=\"nx-switch-row\" style=\"justify-content:space-between;\">" +
        "<span style=\"display:inline-flex; align-items:center; gap:8px;\"><span class=\"nx-area-ic\">" + artSm(AREA_ICONS[ar.label] || "pack") + "</span>" +
        "<span class=\"nx-stat-label\">" + ar.label + "</span></span><span class=\"nx-row-meta\">" + esc(ar.line) + "</span></div>" +
        "<div class=\"nx-seg\" style=\"margin-top:4px;\">" + segHtml(ar.pct, false) + "</div></div>";
    }).join("");
    var orders = state.firstOrders || [];
    h += "<h3 class=\"nx-section-sub\" style=\"margin-top:18px;\">First Orders - Your Gaps, In Order</h3>";
    h += orders.length
      ? "<p class=\"nx-h-note\">FILED AS A CHECKLIST IN THE LISTS TAB. WORK THEM TOP DOWN - EACH ONE CLOSES A REAL GAP.</p>" +
        orders.map(function (o, i) { return "<p class=\"nx-kv\" style=\"margin:2px 0;\"><b>" + (i + 1) + ".</b> " + esc(o.text) + "</p>"; }).join("")
      : "<p class=\"nx-kv\">NO GAPS FOUND AGAINST THE 14-DAY TARGET. HOLD THE LINE - ROTATE STORES AND KEEP THE CREW DRILLED.</p>";
    h += "<div class=\"nx-btn-row\" style=\"margin-top:16px;\"><button type=\"button\" class=\"nx-btn nx-btn-accent\" id=\"nx-checkin-done\">Enter Command</button></div>";
    return h;
  }

  function renderCheckin() {
    if (!checkin.open) return;
    var body = $("nx-checkin-body");
    if (!body) return;
    body.innerHTML = checkin.step >= CHECKIN_STEPS.length ? checkinAssessmentHtml() : checkinStepHtml();
  }

  function renderHomeCards() {
    var cCard = $("nx-checkin-card");
    if (cCard) cCard.style.display = (!state.assessment || !state.assessment.done) ? "" : "none";
    var pCard = $("nx-priority-card");
    if (!pCard) return;
    var orders = Array.isArray(state.firstOrders) ? state.firstOrders : [];
    var next = null;
    for (var i = 0; i < orders.length; i++) { if (!orders[i].done) { next = orders[i]; break; } }
    if (!orders.length || !next) { pCard.style.display = "none"; return; }
    var doneCount = orders.filter(function (o) { return o.done; }).length;
    pCard.style.display = "";
    $("nx-priority-text").textContent = next.text;
    $("nx-priority-count").textContent = "FIRST ORDERS // " + doneCount + " OF " + orders.length + " COMPLETE";
  }

  /* First Orders render in Lists next to the scenario lists,
     ticked in state.checklists under "firstOrders" and mirrored
     onto state.firstOrders[i].done (the dashboard priority card
     reads the mirror). Kept out of checklistStats, same as
     Intel: Readiness measures the original 30 scenario items. */
  function firstOrdersChecklistHtml() {
    var orders = Array.isArray(state.firstOrders) ? state.firstOrders : [];
    if (!orders.length) return "";
    var saved = state.checklists["firstOrders"] || {};
    function isDone(o, i) { return saved[i] !== undefined ? !!saved[i] : !!o.done; }
    var done = orders.filter(isDone).length;
    var items = orders.map(function (o, i) {
      var checked = isDone(o, i);
      return "<label class=\"nx-check-item" + (checked ? " nx-done" : "") + "\">" +
        "<input type=\"checkbox\" data-list=\"firstOrders\" data-idx=\"" + i + "\"" + (checked ? " checked" : "") + ">" +
        "<span class=\"nx-check-text\">" + esc(o.text) + "</span>" +
        (o.shopKey ? "<span class=\"nx-check-btns\">" + shopBtnHtml(o.shopKey, "FIND IT") + "</span>" : "") + "</label>";
    }).join("");
    return "<h3 class=\"nx-section-sub\">First Orders - " + done + "/" + orders.length + "</h3>" +
      "<p class=\"nx-h-note\" style=\"margin:0 0 10px 0;\">GENERATED FROM YOUR READINESS CHECK-IN AGAINST A 14-DAY TARGET. RETAKE THE CHECK-IN IN SYSTEM TO REGENERATE.</p>" +
      "<div class=\"nx-seg\" style=\"margin:0 0 10px 0;\">" + segHtml((done / orders.length) * 100, false) + "</div>" + items +
      (orders.some(function (o) { return !!o.shopKey; }) ? shopDisclosureHtml() : "");
  }

  function bindCheckin() {
    var body = $("nx-checkin-body");
    if (body) body.addEventListener("click", function (ev) {
      var stepBtn = ev.target.closest("[data-checkin-step]");
      if (stepBtn) {
        var field = stepBtn.getAttribute("data-checkin-step");
        var delta = Number(stepBtn.getAttribute("data-delta")) || 0;
        checkin.answers[field] = clamp((Number(checkin.answers[field]) || 0) + delta, 0, field === "adults" ? 20 : 15);
        var n = $("nx-checkin-n-" + field);
        if (n) n.textContent = checkin.answers[field];
        return;
      }
      var opt = ev.target.closest("[data-checkin-opt]");
      if (opt) {
        var key = CHECKIN_STEPS[checkin.step].key;
        var v = opt.getAttribute("data-checkin-opt");
        if (key === "cook") checkin.answers.cook = v === "yes";
        else checkin.answers[key] = v;
        renderCheckin();
        return;
      }
      if (ev.target.closest("#nx-checkin-next") || ev.target.closest("#nx-checkin-skipq")) {
        if (ev.target.closest("#nx-checkin-next")) sfxConfirm();
        if (checkin.step >= CHECKIN_STEPS.length - 1) {
          applyCheckin(checkin.answers);
          checkin.step = CHECKIN_STEPS.length;
          renderAll();
        } else checkin.step++;
        renderCheckin();
        return;
      }
      if (ev.target.closest("#nx-checkin-back")) { if (checkin.step > 0) checkin.step--; renderCheckin(); return; }
      if (ev.target.closest("#nx-checkin-exit")) { closeCheckin(); renderAll(); return; }
      if (ev.target.closest("#nx-checkin-done")) {
        var firstCompletion = !checkin.hadDone;
        closeCheckin(); renderAll();
        if (firstCompletion && !state.tourDone) startTour();
        return;
      }
    });
    var startBtn = $("nx-checkin-start");
    if (startBtn) startBtn.addEventListener("click", function () { openCheckin(); });
    var priBtn = $("nx-priority-btn");
    if (priBtn) priBtn.addEventListener("click", function () { showView("lists"); });
    var retake = $("nx-checkin-retake");
    if (retake) retake.addEventListener("click", function () { openCheckin(); });
  }

  /* ---------------- guided walkthrough ----------------
     A nine-stop tour that teaches the app itself, right after the
     readiness check-in has taught the user's situation. It
     auto-starts once - when a first-run user taps Enter Command
     on the check-in assessment - and FINISH or SKIP TOUR sets
     state.tourDone so it never auto-starts again. Two manual
     doors stay open: TAKE THE WALKTHROUGH on the dashboard
     check-in card (for users who skipped the check-in) and
     REPLAY WALKTHROUGH in System (anyone, any time). Each step
     switches to the real view, scrolls the real element into
     view and brackets it with an accent frame that tracks the
     element on a rAF loop; the briefing card rides at the bottom
     of the screen. The layer is pointer-events-none except the
     card, so the tour never traps the app. */
  var tour = { active: false, step: 0, raf: 0, targetEl: null };

  var TOUR_STEPS = [
    {
      title: "COMMAND // YOUR NUMBER",
      body: "This is Days Ready - how long your household lasts on the water and food you have stored. The app works out water days and food days separately, and the smaller number wins. Expired stores never count, so the number only trusts what is still good.",
      resolve: function () { return { view: "command", el: $("nx-hero-panel") }; }
    },
    {
      title: "FIRST ORDERS // YOUR STARTER LIST",
      body: "Your check-in answers became a starter checklist: the gaps between what you have and a 14-day target, in the order to close them. It lives in the Lists tab - tick items off as you do them. The card here on Command always shows your next order.",
      resolve: function () {
        var card = $("nx-priority-card");
        if (card && card.style.display !== "none") return { view: "command", el: card };
        return { view: "lists", el: $("nx-lists-panel") };
      }
    },
    {
      title: "GEAR // WHAT YOU OWN",
      body: "Log the gear you actually own. Give it a category, an honest weight and a tier - on your body, in your bug-out bag, or cached at home. The form on this tab is where it starts: fill it in and hit Add Item.",
      resolve: function () { return { view: "gear", el: $("nx-gear-panel") }; }
    },
    {
      title: "ROTATE // STORES AND EXPIRY DATES",
      body: "Bulk stores live here: water, food, meds, batteries. Log each one with its expiry date - this is the data Days Ready runs on. The rotation tracker below flags anything due inside 30 days, and anything past its date, so nothing quietly expires on the shelf.",
      resolve: function () { return { view: "rotate", el: $("nx-rotate-panel") }; }
    },
    {
      title: "ALERTS // WEATHER AND EARTHQUAKES",
      body: "Real National Weather Service alerts and USGS earthquakes near your home base. Tap Refresh Alerts when you have signal. Offline, the last good fetch stays on screen - and once it is over 3 hours old it is marked STALE, so old data never poses as live.",
      resolve: function () { return { view: "alerts", el: $("nx-alerts-panel") }; }
    },
    {
      title: "VAULT // SEALED STORAGE",
      body: "The vault holds plans, rally points and document notes, encrypted on this device with a passphrase only you know. It seals itself every time the app loads. Choose a passphrase you will not forget - there is no reset and no recovery if it is lost.",
      resolve: function () { return { view: "vault", el: $("nx-vault-panel") }; }
    },
    {
      title: "CREW AND COMMS // YOUR PEOPLE",
      body: "Add everyone in your household here. Crew size drives the Days Ready math, so every adult and child counts. Your rally point is a vault entry, kept sealed; your radio channels and crew broadcasts live one tab over, in Comms.",
      resolve: function () { return { view: "crew", el: $("nx-crew-panel") }; }
    },
    {
      title: "INTEL // IDEAS FROM THE FEED",
      body: "See a loadout, a storage trick or a drill in a post? Share it into NyxSurvive, or paste the link here. The post is saved as a field note, and the gear and steps it names can be filed into your catalog or a checklist with one tap.",
      resolve: function () { return { view: "intel", el: $("nx-intel-panel") }; }
    },
    {
      title: "SYSTEM // YOUR STATION",
      body: "Themes, effects and sounds live on this tab, along with the Retake Readiness Check-In and a Replay Walkthrough button if you want this tour again. Accounts are optional - everything core works fully offline, no sign-in required.",
      resolve: function () { return { view: "system", el: $("nx-settings-panel") }; }
    }
  ];

  function tourPlaceFrame() {
    var frame = $("nx-tour-frame");
    if (!frame) return;
    var el = tour.targetEl;
    if (!tour.active || !el || !el.getClientRects().length) { frame.style.display = "none"; return; }
    var r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) { frame.style.display = "none"; return; }
    frame.style.display = "block";
    frame.style.left = (r.left - 7) + "px";
    frame.style.top = (r.top - 7) + "px";
    frame.style.width = (r.width + 14) + "px";
    frame.style.height = (r.height + 14) + "px";
  }

  function tourTrack() {
    if (!tour.active) return;
    tourPlaceFrame();
    tour.raf = requestAnimationFrame(tourTrack);
  }

  function tourShowStep(i) {
    tour.step = clamp(i, 0, TOUR_STEPS.length - 1);
    var s = TOUR_STEPS[tour.step];
    var r = s.resolve();
    tour.targetEl = r.el;
    if (currentView !== r.view) showView(r.view);
    $("nx-tour-kicker").textContent = "Walkthrough // Step " + (tour.step + 1) + " of " + TOUR_STEPS.length;
    $("nx-tour-title").textContent = s.title;
    $("nx-tour-body").textContent = s.body;
    $("nx-tour-seg").innerHTML = segHtml(((tour.step + 1) / TOUR_STEPS.length) * 100, false);
    $("nx-tour-back").disabled = tour.step === 0;
    $("nx-tour-next").textContent = tour.step === TOUR_STEPS.length - 1 ? "Finish" : "Next";
    var card = $("nx-tour-card");
    if (card && fxAnimate()) {
      card.classList.remove("nx-tour-in");
      void card.offsetWidth;
      card.classList.add("nx-tour-in");
    }
    if (tour.targetEl) tour.targetEl.scrollIntoView({ block: "center", behavior: fxAnimate() ? "smooth" : "auto" });
    tourPlaceFrame();
  }

  function startTour() {
    if (tour.active) return;
    if (checkin.open) closeCheckin();
    tour.active = true;
    var layer = $("nx-tour-layer");
    if (layer) layer.style.display = "";
    tourShowStep(0);
    tourTrack();
  }

  function endTour() {
    if (!tour.active) return;
    tour.active = false;
    cancelAnimationFrame(tour.raf);
    var layer = $("nx-tour-layer");
    if (layer) layer.style.display = "none";
    if (!state.tourDone) { state.tourDone = true; saveState(); }
  }

  function bindTour() {
    var next = $("nx-tour-next");
    if (next) next.addEventListener("click", function () {
      if (tour.step >= TOUR_STEPS.length - 1) { endTour(); showView("command"); }
      else tourShowStep(tour.step + 1);
    });
    var back = $("nx-tour-back");
    if (back) back.addEventListener("click", function () { if (tour.step > 0) tourShowStep(tour.step - 1); });
    var skip = $("nx-tour-skip");
    if (skip) skip.addEventListener("click", function () { endTour(); });
    var start = $("nx-tour-start");
    if (start) start.addEventListener("click", function () { startTour(); });
    var replay = $("nx-tour-replay");
    if (replay) replay.addEventListener("click", function () { startTour(); });
    window.addEventListener("resize", function () { if (tour.active) tourPlaceFrame(); });
  }

  /* ---------------- intel: saved social posts ----------------
     Field notes from the feed. A post link (pasted, or shared
     straight into the app via the manifest share target) goes
     to /api/link-intel, which reads the post and extracts the
     gear, supplies and tasks it names. The card saves
     immediately - degraded link-only cards included - and each
     extracted item files into the real gear catalog or the
     Intel checklist with one tap. Cards are ordinary app data:
     they ride the normal save, export/import and zero-knowledge
     cloud sync like gear and crew, and never touch the vault.
     Reading needs a sign-in (the endpoint is authenticated);
     signed out or offline, the link still saves link-only so
     nothing spotted is ever lost. */
  var INTEL_KIND_LABEL = { gear: "GEAR", supply: "SUPPLY", task: "TASK" };

  function intelHostOf(url) {
    try { return new URL(url).hostname.toLowerCase().replace(/^www\.|^m\./, ""); } catch (e) { return ""; }
  }
  function intelUrlFromText(text) {
    var m = String(text || "").match(/https?:\/\/[^\s"'<>]+/);
    if (!m) return "";
    return m[0].replace(/[)\].,;!?]+$/, "");
  }
  function makeLinkOnlyCard(url) {
    return { id: uid(), url: url, host: intelHostOf(url), title: "", summary: "", degraded: true, items: [], addedAt: Date.now() };
  }
  function saveIntelCard(card) {
    state.intel.unshift(card);
    saveState();
    renderIntel();
  }

  var INTEL_CAT_HINTS = [
    ["Water", /water|filter|purif|hydration|bladder|canteen/],
    ["Food", /food|rice|bean|oat|mre|ration|freeze.?dried|peanut|grain/],
    ["Shelter", /tent|shelter|hammock|tarp|sleeping bag|bivvy|bivy/],
    ["Fire", /fire|ferro|lighter|match|stove|tinder/],
    ["Medical", /first aid|ifak|medical|bandage|tourniquet|trauma/],
    ["Comms", /radio|comms|antenna|gmrs|ham|baofeng/],
    ["Tools", /knife|multitool|axe|saw|shovel|tool|paracord|rope/],
    ["Clothing", /jacket|boot|clothing|glove|sock|layer|rain gear/],
    ["Defense", /defense|defence|safety|alarm|lock/]
  ];
  function intelCategoryFor(item) {
    var hay = (item.name + " " + (item.detail || "")).toLowerCase();
    for (var i = 0; i < INTEL_CAT_HINTS.length; i++) {
      if (INTEL_CAT_HINTS[i][1].test(hay)) return INTEL_CAT_HINTS[i][0];
    }
    return "Other";
  }

  var intelBusy = false;
  async function readIntelPost(rawText) {
    var msg = $("nx-intel-msg");
    var url = intelUrlFromText(rawText);
    if (!url) { showMsg(msg, "PASTE A FULL LINK TO THE POST FIRST.", "err"); return; }
    if (capBlocked("intel")) {
      showMsg(msg, "FREE TIER INTEL CAP: " + INTEL_FREE_CAP + " SAVED POSTS. OPERATOR REMOVES EVERY CAP - SEE SYSTEM // PLAN.", "err");
      return;
    }
    if (intelBusy) return;
    // No account on this deployment, or signed out: the reader
    // endpoint is signed-in only, so the link files link-only.
    if (!authUser) {
      saveIntelCard(makeLinkOnlyCard(url));
      showMsg(msg, "SAVED LINK-ONLY - SIGN IN (SYSTEM TAB) TO READ POST CONTENT NEXT TIME.", "good");
      sfxConfirm();
      return;
    }
    intelBusy = true;
    var btn = $("nx-intel-read");
    if (btn) { btn.disabled = true; btn.textContent = "Reading..."; }
    showMsg(msg, "READING POST...", "");
    try {
      var token = await authUser.getIdToken();
      var res = await fetch(apiUrl("/api/link-intel"), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify({ url: url })
      });
      var out = null;
      try { out = await res.json(); } catch (e) { out = null; }
      if (res.status === 429) {
        showMsg(msg, String((out && out.error) || "Daily intel read cap reached - try again tomorrow.").toUpperCase(), "err");
        return;
      }
      if (!res.ok || !out || !out.ok) throw new Error((out && out.error) || ("HTTP " + res.status));
      var card = {
        id: uid(), url: url,
        host: String(out.host || intelHostOf(url)),
        title: String(out.title || ""), summary: String(out.summary || ""),
        degraded: out.degraded === true,
        items: (Array.isArray(out.items) ? out.items : []).map(function (it) {
          var kind = String((it && it.kind) || "").toLowerCase();
          if (kind !== "gear" && kind !== "supply" && kind !== "task") kind = "gear";
          return { kind: kind, name: String((it && it.name) || ""), detail: String((it && it.detail) || ""), converted: false };
        }).filter(function (it) { return it.name; }),
        addedAt: Date.now()
      };
      saveIntelCard(card);
      showMsg(msg, card.degraded
        ? "THAT POST WOULD NOT OPEN ITS TEXT - SAVED LINK-ONLY SO IT IS NOT LOST."
        : "INTEL FILED: " + (card.title || card.host).toUpperCase(), "good");
      sfxConfirm();
    } catch (e) {
      // Offline, or the reader is unreachable: the link still
      // saves, link-only, so nothing the user spotted is lost.
      saveIntelCard(makeLinkOnlyCard(url));
      showMsg(msg, "READER UNREACHABLE (OFFLINE?) - SAVED LINK-ONLY SO IT IS NOT LOST.", "good");
    } finally {
      intelBusy = false;
      if (btn) { btn.disabled = false; btn.textContent = "Read Post"; }
    }
  }

  function intelCardHtml(card) {
    var when = card.addedAt ? fmtTime(card.addedAt) : "";
    var title = card.title || card.host || card.url;
    var meta = esc((card.host || "").toUpperCase()) + (when ? " // SAVED " + esc(String(when).toUpperCase()) : "") +
      (card.degraded ? " // LINK ONLY - POST TEXT NOT READ" : "");
    var items = "";
    if (card.items.length) {
      items = "<div class=\"nx-intel-items\">" + card.items.map(function (it, idx) {
        var btn = it.converted
          ? "<button type=\"button\" class=\"nx-btn nx-btn-small\" disabled>Filed</button>"
          : "<button type=\"button\" class=\"nx-btn nx-btn-small\" data-intel-add=\"" + card.id + ":" + idx + "\">" +
            (it.kind === "task" ? "Add to List" : "Add to Gear") + "</button>";
        return "<div class=\"nx-intel-item" + (it.converted ? " nx-converted" : "") + "\">" +
          "<span class=\"nx-badge nx-intel-kind\">" + (INTEL_KIND_LABEL[it.kind] || "GEAR") + "</span>" +
          "<div class=\"nx-intel-item-main\"><p class=\"nx-intel-item-name\">" + esc(it.name) + "</p>" +
          (it.detail ? "<p class=\"nx-intel-item-detail\">" + esc(it.detail.toUpperCase()) + "</p>" : "") + "</div>" +
          btn + "</div>";
      }).join("") + "</div>";
    }
    return "<div class=\"nx-panel nx-intel-card\" data-intel-card=\"" + card.id + "\">" +
      "<p class=\"nx-row-title\">" + esc(title) + "</p>" +
      "<p class=\"nx-row-meta\">" + meta + "</p>" +
      (card.summary ? "<p class=\"nx-intel-summary\">" + esc(card.summary) + "</p>" : "") +
      items +
      "<div class=\"nx-btn-row\" style=\"margin-top:12px;\">" +
      "<a class=\"nx-btn nx-btn-small\" href=\"" + esc(card.url) + "\" target=\"_blank\" rel=\"noopener\">Open Post</a>" +
      "<button type=\"button\" class=\"nx-btn nx-btn-small nx-btn-danger\" data-intel-del=\"" + card.id + "\">Delete</button>" +
      "</div></div>";
  }

  function renderIntel() {
    var count = $("nx-intel-count");
    if (count) {
      count.innerHTML = "<b>" + state.intel.length + "</b> POST" + (state.intel.length === 1 ? "" : "S") + " FILED" +
        (isOperator() ? " // OPERATOR - NO CAP" : " // FREE CAP " + INTEL_FREE_CAP);
    }
    var wrap = $("nx-intel-list");
    if (!wrap) return;
    wrap.innerHTML = state.intel.length
      ? state.intel.map(intelCardHtml).join("")
      : "<div class=\"nx-empty\"><span class=\"nx-empty-art\">" + artSm("intel") + "</span>NO INTEL YET. PASTE A POST LINK ABOVE - TIKTOK, INSTAGRAM, YOUTUBE, FACEBOOK OR ANY PAGE.</div>";
  }

  function convertIntelItem(card, idx) {
    var msg = $("nx-intel-msg");
    var it = card.items[idx];
    if (!it || it.converted) return;
    if (it.kind === "task") {
      state.intelTasks.push((it.name + (it.detail ? " - " + it.detail : "")).slice(0, 300));
      it.converted = true;
      saveState();
      renderAll();
      showMsg(msg, "FILED TO THE INTEL CHECKLIST IN LISTS: " + it.name.toUpperCase(), "good");
      sfxConfirm();
      return;
    }
    // Gear and supplies both land in the gear catalog, through
    // the same cap the gear form enforces - never around it.
    if (capBlocked("gear")) {
      showMsg(msg, "FREE TIER GEAR CAP: " + PLAN_CAPS.gear + " ITEMS. OPERATOR REMOVES EVERY CAP - SEE SYSTEM // PLAN.", "err");
      return;
    }
    state.gear.push({
      id: uid(),
      name: it.name.slice(0, 80),
      category: intelCategoryFor(it),
      weightValue: 0, weightUnit: "lb", qty: 1,
      tier: it.kind === "supply" ? "T3" : "T2",
      env: [], assignedTo: "",
      location: (it.detail || "Filed from Intel").slice(0, 60),
      expiry: null
    });
    it.converted = true;
    saveState();
    renderAll();
    showMsg(msg, "FILED TO GEAR: " + it.name.toUpperCase(), "good");
    sfxConfirm();
  }

  function bindIntel() {
    var form = $("nx-intel-form");
    if (form) form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var input = $("nx-intel-url");
      var raw = input.value;
      var before = state.intel.length;
      readIntelPost(raw).then(function () {
        if (state.intel.length > before && input.value === raw) input.value = "";
      });
    });
    var list = $("nx-intel-list");
    if (list) list.addEventListener("click", function (ev) {
      var add = ev.target.closest("[data-intel-add]");
      if (add) {
        var parts = add.getAttribute("data-intel-add").split(":");
        var card = state.intel.filter(function (c) { return c.id === parts[0]; })[0];
        if (card) convertIntelItem(card, Number(parts[1]));
        return;
      }
      var del = ev.target.closest("[data-intel-del]");
      if (del) {
        var id = del.getAttribute("data-intel-del");
        var card2 = state.intel.filter(function (c) { return c.id === id; })[0];
        if (card2 && window.confirm("Delete intel card: " + (card2.title || card2.url) + "?")) {
          state.intel = state.intel.filter(function (c) { return c.id !== id; });
          saveState();
          renderIntel();
        }
      }
    });
  }

  /* Web Share Target: the manifest points shares at
   * app.html?title=&text=&url= (GET). Consume them once on
   * load: land on the Intel tab with the link in the box and
   * the read already running, then clean the address bar so a
   * reload does not file the same post twice. */
  function handleShareParams() {
    var params;
    try { params = new URLSearchParams(window.location.search); } catch (e) { return; }
    var shared = params.get("url") || "";
    if (!shared) shared = intelUrlFromText(params.get("text") || "");
    if (!shared) return;
    try {
      window.history.replaceState(null, "", window.location.pathname + window.location.hash);
    } catch (e) { /* address-bar cleanup is cosmetic */ }
    showView("intel");
    var input = $("nx-intel-url");
    if (input) input.value = shared;
    // A share can land on a cold start, before Firebase has
    // restored the session: give sign-in a brief moment to
    // resolve so a signed-in user's post gets read instead of
    // filed link-only. A genuinely signed-out share still
    // files link-only once the wait runs out.
    (async function () {
      try {
        await ensureFirebase();
        for (var i = 0; i < 25 && !authUser; i++) {
          await new Promise(function (r) { setTimeout(r, 100); });
        }
      } catch (e) { /* local-only deployment - no wait applies */ }
      readIntelPost(shared);
    })();
  }

  /* ---------------- tactical advisor + AI quick-add ----------------
     The AI build. Two surfaces, one Gemini connection (the key
     that already powers Intel, server-side only):
       1. The Tactical Advisor on Command: a chat panel that
          answers from the user's own readiness numbers. The
          context it sends is built from counts and categories
          ONLY - days ready, water / food days, household size,
          expiring store names + kinds, gear counts by category,
          the gap lists, open First Orders and Resupply lines.
          Vault contents, home-base coordinates, crew names,
          emails and account ids are never read into it (the
          route re-whitelists server-side as a second wall).
          Answers can carry supply orders, filed into First
          Orders on one tap, and a log offer when the user says
          they bought something - a LOG IT tap files the real
          store entry, nothing is written before the tap.
       2. AI Quick-Add: a PHOTO button on the store and gear
          forms. The photo goes to /api/photo-id; what comes
          back renders as a confirm-each list of prefilled rows
          in an overlay. Estimate, prefill, confirm or edit -
          nothing ever auto-saves (the Munchling pattern, same
          as Build C's barcode prefill).
     Tiers: free gets 5 advisor questions and 5 photo IDs a day
     (client counters in state.aiUse; the routes hold a higher
     soft cap as a backstop). Operator and owner are unlimited.
     Signed out or offline, both surfaces say so plainly and the
     manual paths are untouched. */
  var AI_FREE_DAILY = 5;
  var advisorBusy = false;
  var advisorPending = { orders: [], logOffer: null };

  function aiUseToday() {
    var today = todayKeyLocal();
    var u = state.aiUse;
    if (!u || u.day !== today) return { day: today, ask: 0, photo: 0 };
    return { day: today, ask: u.ask || 0, photo: u.photo || 0 };
  }
  function aiCanUse(kind) {
    if (isOperator()) return true;
    var u = aiUseToday();
    return (kind === "photo" ? u.photo : u.ask) < AI_FREE_DAILY;
  }
  function aiRecordUse(kind) {
    var u = aiUseToday();
    if (kind === "photo") u.photo += 1; else u.ask += 1;
    state.aiUse = u;
    saveState();
  }
  function aiLeft(kind) {
    var u = aiUseToday();
    return Math.max(0, AI_FREE_DAILY - (kind === "photo" ? u.photo : u.ask));
  }

  /* The ONLY thing the advisor ever sees: counts and categories
     computed from the same helpers the dashboard runs on. Store
     names appear solely in the expiring list (the user's own
     item names, per spec); gear travels as category counts. */
  function advisorContext() {
    var d = daysReady();
    var byCat = {};
    CATEGORIES.forEach(function (c) { byCat[c] = 0; });
    state.gear.forEach(function (g) {
      if (byCat[g.category] != null) byCat[g.category] += Math.max(1, Number(g.qty) || 1);
    });
    var gaps = [];
    if (!hasFiltration()) gaps.push("water filtration");
    if (!hasMedicalKit()) gaps.push("trauma / medical kit");
    if (!hasRadios()) gaps.push("radios / comms");
    if (!hasGoBag()) gaps.push("go-bag");
    if (!hasLightSource()) gaps.push("light source");
    return {
      daysReady: d.headline,
      waterDays: d.waterDays,
      foodDays: d.foodDays,
      waterGal: Math.round(d.waterGal * 10) / 10,
      foodKcal: Math.round(d.foodKcal),
      household: d.household,
      expiring: storeExpiries().filter(function (r) { return r.days != null && r.days <= 90; }).slice(0, 6)
        .map(function (r) { return { name: r.name, kind: r.storeKind, daysLeft: r.days }; }),
      gearByCategory: byCat,
      gearTotal: state.gear.length,
      gearGaps: gaps,
      firstOrders: (state.firstOrders || []).filter(function (o) { return !o.done; })
        .map(function (o) { return o.text; }).slice(0, 8),
      resupply: resupplyLines().map(function (l) { return l.text; }).slice(0, 8)
    };
  }

  function advisorCountText() {
    if (isOperator()) return isOwner() ? "OWNER - UNLIMITED QUESTIONS" : "OPERATOR - UNLIMITED QUESTIONS";
    return "FREE TIER: " + aiLeft("ask") + " OF " + AI_FREE_DAILY + " QUESTIONS LEFT TODAY // " +
      aiLeft("photo") + " OF " + AI_FREE_DAILY + " PHOTO IDS LEFT TODAY - OPERATOR IS UNLIMITED, SEE SYSTEM // PLAN";
  }

  function renderAdvisor() {
    var log = $("nx-adv-log");
    if (!log) return;
    var msgs = Array.isArray(state.advisorLog) ? state.advisorLog : [];
    log.innerHTML = msgs.length
      ? msgs.map(function (m) {
          return "<div class=\"nx-adv-turn nx-adv-" + m.role + "\">" +
            "<p class=\"nx-adv-who\">" + (m.role === "user" ? "You" : "Advisor") + "</p>" +
            "<p class=\"nx-adv-text\">" + esc(m.text) + "</p></div>";
        }).join("")
      : "<p class=\"nx-h-note\" style=\"margin:0;\">NO QUESTIONS YET. TRY A QUICK ASK BELOW, OR TYPE YOUR OWN - INCLUDING WHAT YOU JUST BOUGHT.</p>";
    var act = $("nx-adv-actions");
    if (act) {
      var h = "";
      if (advisorPending.orders.length) {
        h += "<div class=\"nx-adv-offer\"><p class=\"nx-adv-offer-text\">THE ADVISOR SUGGESTED " +
          advisorPending.orders.length + " ORDER" + (advisorPending.orders.length === 1 ? "" : "S") + ":</p>" +
          advisorPending.orders.map(function (o) { return "<p class=\"nx-adv-offer-line\">- " + esc(o) + "</p>"; }).join("") +
          "<div class=\"nx-btn-row\"><button type=\"button\" class=\"nx-btn nx-btn-small nx-btn-accent\" id=\"nx-adv-add-orders\">Add to First Orders</button></div></div>";
      }
      if (advisorPending.logOffer) {
        var o = advisorPending.logOffer;
        h += "<div class=\"nx-adv-offer\"><p class=\"nx-adv-offer-text\">LOG THIS PURCHASE?</p>" +
          "<p class=\"nx-adv-offer-line\">" + esc(o.name) + " - " + fmt(o.amount, 1) + " " + esc(o.unit) +
          " (" + esc(o.kind.toUpperCase()) + (o.kcal ? ", " + fmt(o.kcal, 0) + " KCAL" : "") + ")</p>" +
          "<div class=\"nx-btn-row\"><button type=\"button\" class=\"nx-btn nx-btn-small nx-btn-accent\" id=\"nx-adv-log-it\">Log It</button>" +
          "<button type=\"button\" class=\"nx-btn nx-btn-small\" id=\"nx-adv-log-skip\">Skip</button></div></div>";
      }
      act.innerHTML = h;
    }
    var count = $("nx-adv-count");
    if (count) count.textContent = advisorCountText();
  }

  /* File the advisor's suggested orders into First Orders -
     append-only through the same shape the check-in writes, so
     existing ticks (keyed by index) stay aligned; capped at 8
     like check-in generation, duplicates by text skipped. */
  function addAdvisorOrders() {
    var msg = $("nx-adv-msg");
    if (!advisorPending.orders.length) return;
    var existing = {};
    state.firstOrders.forEach(function (o) { existing[o.text] = true; });
    var added = 0;
    advisorPending.orders.forEach(function (text) {
      text = String(text || "").slice(0, 300);
      if (!text || existing[text]) return;
      if (state.firstOrders.length >= 8) return;
      state.firstOrders.push({ text: text, done: false, shopKey: null });
      existing[text] = true;
      added += 1;
    });
    advisorPending.orders = [];
    saveState();
    renderAll();
    if (added) showMsg(msg, "ADDED " + added + " ORDER" + (added === 1 ? "" : "S") + " TO FIRST ORDERS - FIND THEM IN LISTS.", "good");
    else showMsg(msg, "NOTHING NEW TO ADD - THOSE ORDERS ARE ALREADY FILED, OR FIRST ORDERS IS FULL AT 8.", "err");
    if (added) sfxConfirm();
  }

  /* File the log offer as a real store entry - the same shape
     the store form submits. Only ever runs on the LOG IT tap. */
  function logAdvisorOffer() {
    var msg = $("nx-adv-msg");
    var o = advisorPending.logOffer;
    if (!o) return;
    state.stores.push({
      id: uid(), kind: o.kind, name: o.name, amount: o.amount,
      unit: o.unit, expiry: null, kcal: o.kcal || 0
    });
    advisorPending.logOffer = null;
    saveState();
    renderAll();
    showMsg(msg, "LOGGED: " + o.name.toUpperCase() + " - " + fmt(o.amount, 1) + " " + o.unit.toUpperCase() + ".", "good");
    sfxConfirm();
  }

  async function askAdvisor(rawQuestion) {
    var msg = $("nx-adv-msg");
    var question = String(rawQuestion || "").trim().slice(0, 500);
    if (!question || advisorBusy) return;
    if (!authUser) {
      showMsg(msg, "SIGN IN (SYSTEM TAB) TO ASK THE ADVISOR - IT RUNS ON YOUR ACCOUNT.", "err");
      return;
    }
    if (!aiCanUse("ask")) {
      showMsg(msg, "FREE TIER: " + AI_FREE_DAILY + " ADVISOR QUESTIONS A DAY - YOURS RESET TOMORROW. OPERATOR IS UNLIMITED - SEE SYSTEM // PLAN.", "err");
      return;
    }
    advisorBusy = true;
    var btn = $("nx-adv-send");
    if (btn) { btn.disabled = true; btn.textContent = "Thinking..."; }
    showMsg(msg, "ADVISOR IS READING YOUR NUMBERS...", "");
    state.advisorLog.push({ role: "user", text: question });
    state.advisorLog = state.advisorLog.slice(-40);
    saveState();
    renderAdvisor();
    try {
      var token = await authUser.getIdToken();
      var res = await fetch(apiUrl("/api/ask"), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify({ question: question, context: advisorContext() })
      });
      var out = null;
      try { out = await res.json(); } catch (e) { out = null; }
      if (res.status === 429) {
        showMsg(msg, String((out && out.error) || "Daily advisor cap reached - try again tomorrow.").toUpperCase(), "err");
        return;
      }
      if (!res.ok || !out || !out.ok) throw new Error((out && out.error) || ("HTTP " + res.status));
      if (out.degraded || !out.reply) {
        showMsg(msg, "ADVISOR OFFLINE - THE AI SERVICE DID NOT ANSWER. YOUR NUMBERS ARE SAFE; TRY AGAIN IN A BIT.", "err");
        return;
      }
      aiRecordUse("ask");
      state.advisorLog.push({ role: "advisor", text: String(out.reply).slice(0, 4000) });
      state.advisorLog = state.advisorLog.slice(-40);
      advisorPending = {
        orders: (Array.isArray(out.orders) ? out.orders : []).filter(function (o) { return typeof o === "string" && o; }).slice(0, 5),
        logOffer: (out.logOffer && typeof out.logOffer === "object" && STORE_KINDS.indexOf(out.logOffer.kind) >= 0 &&
          typeof out.logOffer.name === "string" && out.logOffer.name) ? {
            kind: out.logOffer.kind, name: out.logOffer.name.slice(0, 70),
            amount: Math.max(0, Number(out.logOffer.amount) || 0) || 1,
            unit: typeof out.logOffer.unit === "string" && out.logOffer.unit ? out.logOffer.unit.slice(0, 16) : "units",
            kcal: Math.max(0, Math.round(Number(out.logOffer.kcal) || 0))
          } : null
      };
      saveState();
      renderAdvisor();
      showMsg(msg, "", "");
      sfxConfirm();
    } catch (e) {
      showMsg(msg, "ADVISOR OFFLINE - CHECK YOUR CONNECTION AND TRY AGAIN.", "err");
    } finally {
      advisorBusy = false;
      if (btn) { btn.disabled = false; btn.textContent = "Ask"; }
    }
  }

  /* ---------------- AI quick-add: photo ID ---------------- */
  var photoBusy = false;
  var photoItems = []; // identified items awaiting per-row confirm

  /* Downscale on-device before anything ships: longest side
     1024px, JPEG. Falls back to the raw file if the platform
     cannot decode it - the route caps the size either way. */
  function fileToPhotoPayload(file) {
    return new Promise(function (resolve) {
      var fallback = function () {
        var reader = new FileReader();
        reader.onload = function () {
          var s = String(reader.result || "");
          var comma = s.indexOf(",");
          resolve({ image: comma >= 0 ? s.slice(comma + 1) : s, mime: file.type || "image/jpeg" });
        };
        reader.onerror = function () { resolve(null); };
        reader.readAsDataURL(file);
      };
      var url;
      try { url = URL.createObjectURL(file); } catch (e) { fallback(); return; }
      var img = new Image();
      img.onload = function () {
        try {
          var scale = Math.min(1, 1024 / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
          var w = Math.max(1, Math.round((img.naturalWidth || 1) * scale));
          var h = Math.max(1, Math.round((img.naturalHeight || 1) * scale));
          var canvas = document.createElement("canvas");
          canvas.width = w; canvas.height = h;
          canvas.getContext("2d").drawImage(img, 0, 0, w, h);
          URL.revokeObjectURL(url);
          var data = canvas.toDataURL("image/jpeg", 0.82);
          resolve({ image: data.slice(data.indexOf(",") + 1), mime: "image/jpeg" });
        } catch (e) { URL.revokeObjectURL(url); fallback(); }
      };
      img.onerror = function () { URL.revokeObjectURL(url); fallback(); };
      img.src = url;
    });
  }

  function photoRowHtml(it, idx) {
    if (it.kind === "gear") {
      return "<div class=\"nx-photo-row\" data-photo-row=\"" + idx + "\">" +
        "<p class=\"nx-adv-who\">Gear // " + esc(it.category) + "</p>" +
        "<label class=\"nx-field\"><span class=\"nx-label\">Name</span>" +
          "<input class=\"nx-input\" data-photo-name maxlength=\"70\" value=\"" + esc(it.name) + "\"></label>" +
        "<div class=\"nx-photo-grid\">" +
        "<label class=\"nx-field\"><span class=\"nx-label\">Qty</span>" +
          "<input class=\"nx-input\" data-photo-qty type=\"number\" min=\"1\" step=\"1\" value=\"" + it.qty + "\"></label>" +
        "<label class=\"nx-field\"><span class=\"nx-label\">Category</span>" +
          "<select class=\"nx-select\" data-photo-cat>" + CATEGORIES.map(function (c) {
            return "<option value=\"" + c + "\"" + (c === it.category ? " selected" : "") + ">" + c + "</option>";
          }).join("") + "</select></label></div>" +
        "<div class=\"nx-btn-row\"><button type=\"button\" class=\"nx-btn nx-btn-small nx-btn-accent\" data-photo-add=\"" + idx + "\">Add Gear</button></div></div>";
    }
    return "<div class=\"nx-photo-row\" data-photo-row=\"" + idx + "\">" +
      "<p class=\"nx-adv-who\">Store // " + esc(it.storeKind) + "</p>" +
      "<label class=\"nx-field\"><span class=\"nx-label\">Name</span>" +
        "<input class=\"nx-input\" data-photo-name maxlength=\"70\" value=\"" + esc(it.name) + "\"></label>" +
      "<div class=\"nx-photo-grid\">" +
      "<label class=\"nx-field\"><span class=\"nx-label\">Type</span>" +
        "<select class=\"nx-select\" data-photo-skind>" + STORE_KINDS.map(function (k) {
          return "<option value=\"" + k + "\"" + (k === it.storeKind ? " selected" : "") + ">" + k + "</option>";
        }).join("") + "</select></label>" +
      "<label class=\"nx-field\"><span class=\"nx-label\">Amount</span>" +
        "<input class=\"nx-input\" data-photo-amount type=\"number\" min=\"0\" step=\"0.1\" value=\"" + it.amount + "\"></label>" +
      "<label class=\"nx-field\"><span class=\"nx-label\">Unit</span>" +
        "<input class=\"nx-input\" data-photo-unit maxlength=\"16\" value=\"" + esc(it.unit) + "\"></label>" +
      "<label class=\"nx-field\"><span class=\"nx-label\">Total kcal (food)</span>" +
        "<input class=\"nx-input\" data-photo-kcal type=\"number\" min=\"0\" step=\"1\" value=\"" + (it.kcal || "") + "\" placeholder=\"0\"></label></div>" +
      "<div class=\"nx-btn-row\"><button type=\"button\" class=\"nx-btn nx-btn-small nx-btn-accent\" data-photo-add=\"" + idx + "\">Add Store</button></div></div>";
  }

  function renderPhotoItems() {
    var wrap = $("nx-photo-list");
    if (!wrap) return;
    wrap.innerHTML = photoItems.length
      ? photoItems.map(function (it, i) { return photoRowHtml(it, i); }).join("")
      : "<p class=\"nx-h-note\" style=\"margin:0;\">NOTHING LEFT TO CONFIRM.</p>";
  }

  function openPhotoConfirm(items) {
    photoItems = items;
    renderPhotoItems();
    showMsg($("nx-photo-msg"), "", "");
    $("nx-photo").style.display = "";
  }
  function closePhotoConfirm() {
    photoItems = [];
    var ov = $("nx-photo");
    if (ov) ov.style.display = "none";
  }

  /* File one confirmed row through the real add paths - the
     store shape the store form writes, the gear shape the gear
     form writes, gear cap enforced exactly like the form. */
  function addPhotoItem(idx, rowEl) {
    var msg = $("nx-photo-msg");
    var it = photoItems[idx];
    if (!it || !rowEl) return;
    var name = rowEl.querySelector("[data-photo-name]").value.trim().slice(0, 70);
    if (!name) { showMsg(msg, "THE NAME IS EMPTY - FIX IT OR CLOSE AND SKIP THE ITEM.", "err"); return; }
    if (it.kind === "gear") {
      if (capBlocked("gear")) {
        showMsg(msg, "FREE TIER GEAR CAP: " + PLAN_CAPS.gear + " ITEMS. OPERATOR REMOVES EVERY CAP - SEE SYSTEM // PLAN.", "err");
        return;
      }
      state.gear.push({
        id: uid(), name: name,
        category: rowEl.querySelector("[data-photo-cat]").value,
        tier: "T3", weightValue: 0, weightUnit: "lb",
        qty: Math.max(1, Number(rowEl.querySelector("[data-photo-qty]").value) || 1),
        expiry: null, assignedTo: "", location: "", env: []
      });
    } else {
      state.stores.push({
        id: uid(),
        kind: rowEl.querySelector("[data-photo-skind]").value,
        name: name,
        amount: Number(rowEl.querySelector("[data-photo-amount]").value) || 0,
        unit: rowEl.querySelector("[data-photo-unit]").value.trim().slice(0, 16) || "units",
        expiry: null,
        kcal: Number(rowEl.querySelector("[data-photo-kcal]").value) || 0
      });
    }
    photoItems.splice(idx, 1);
    saveState();
    renderAll();
    renderPhotoItems();
    showMsg(msg, "FILED: " + name.toUpperCase() + ".", "good");
    sfxConfirm();
  }

  async function runPhotoId(file, target) {
    var msg = $(target === "gear" ? "nx-gear-msg" : "nx-store-msg");
    if (!file || photoBusy) return;
    if (!authUser) {
      showMsg(msg, "SIGN IN (SYSTEM TAB) TO USE PHOTO ID - IT RUNS ON YOUR ACCOUNT.", "err");
      return;
    }
    if (!aiCanUse("photo")) {
      showMsg(msg, "FREE TIER: " + AI_FREE_DAILY + " PHOTO IDS A DAY - YOURS RESET TOMORROW. OPERATOR IS UNLIMITED - SEE SYSTEM // PLAN.", "err");
      return;
    }
    photoBusy = true;
    showMsg(msg, "PHOTO ID IS READING THE PHOTO...", "");
    try {
      var payload = await fileToPhotoPayload(file);
      if (!payload) throw new Error("unreadable photo");
      var token = await authUser.getIdToken();
      var res = await fetch(apiUrl("/api/photo-id"), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify({ image: payload.image, mime: payload.mime, target: target })
      });
      var out = null;
      try { out = await res.json(); } catch (e) { out = null; }
      if (res.status === 429) {
        showMsg(msg, String((out && out.error) || "Daily photo ID cap reached - try again tomorrow.").toUpperCase(), "err");
        return;
      }
      if (!res.ok || !out || !out.ok) throw new Error((out && out.error) || ("HTTP " + res.status));
      if (out.degraded) {
        showMsg(msg, "PHOTO ID OFFLINE - THE AI SERVICE DID NOT ANSWER. THE FORM STILL WORKS BY HAND.", "err");
        return;
      }
      aiRecordUse("photo");
      var items = (Array.isArray(out.items) ? out.items : []).map(function (raw) {
        if (!raw || typeof raw !== "object" || typeof raw.name !== "string" || !raw.name) return null;
        return {
          kind: raw.kind === "gear" ? "gear" : "store",
          storeKind: STORE_KINDS.indexOf(raw.storeKind) >= 0 ? raw.storeKind : "Food",
          category: CATEGORIES.indexOf(raw.category) >= 0 ? raw.category : "Other",
          name: raw.name.slice(0, 70),
          amount: Math.max(0, Number(raw.amount) || 0) || 1,
          unit: typeof raw.unit === "string" && raw.unit ? raw.unit.slice(0, 16) : "units",
          kcal: Math.max(0, Math.round(Number(raw.kcal) || 0)),
          qty: Math.max(1, Math.round(Number(raw.qty) || 1))
        };
      }).filter(Boolean).slice(0, 12);
      if (!items.length) {
        showMsg(msg, "PHOTO ID FOUND NOTHING LOGGABLE IN THAT PHOTO - ENTER IT BY HAND.", "err");
        return;
      }
      showMsg(msg, "PHOTO ID FOUND " + items.length + " ITEM" + (items.length === 1 ? "" : "S") + " - CONFIRM EACH ONE.", "good");
      openPhotoConfirm(items);
      sfxConfirm();
    } catch (e) {
      showMsg(msg, "PHOTO ID OFFLINE - CHECK YOUR CONNECTION. THE FORM STILL WORKS BY HAND.", "err");
    } finally {
      photoBusy = false;
    }
  }

  function bindAdvisor() {
    var form = $("nx-adv-form");
    if (form) form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var input = $("nx-adv-input");
      var q = input.value;
      input.value = "";
      askAdvisor(q);
    });
    document.querySelectorAll("[data-adv-q]").forEach(function (b) {
      b.addEventListener("click", function () { askAdvisor(b.getAttribute("data-adv-q")); });
    });
    var actions = $("nx-adv-actions");
    if (actions) actions.addEventListener("click", function (ev) {
      if (ev.target.closest("#nx-adv-add-orders")) { addAdvisorOrders(); return; }
      if (ev.target.closest("#nx-adv-log-it")) { logAdvisorOffer(); return; }
      if (ev.target.closest("#nx-adv-log-skip")) {
        advisorPending.logOffer = null;
        renderAdvisor();
      }
    });
    var storeBtn = $("nx-store-photo-btn"), gearBtn = $("nx-gear-photo-btn");
    if (storeBtn) storeBtn.addEventListener("click", function () { $("nx-store-photo").click(); });
    if (gearBtn) gearBtn.addEventListener("click", function () { $("nx-gear-photo").click(); });
    var storeInput = $("nx-store-photo"), gearInput = $("nx-gear-photo");
    if (storeInput) storeInput.addEventListener("change", function () {
      var f = storeInput.files && storeInput.files[0];
      storeInput.value = "";
      if (f) runPhotoId(f, "store");
    });
    if (gearInput) gearInput.addEventListener("change", function () {
      var f = gearInput.files && gearInput.files[0];
      gearInput.value = "";
      if (f) runPhotoId(f, "gear");
    });
    var photoList = $("nx-photo-list");
    if (photoList) photoList.addEventListener("click", function (ev) {
      var addBtn = ev.target.closest("[data-photo-add]");
      if (!addBtn) return;
      var rowEl = addBtn.closest("[data-photo-row]");
      addPhotoItem(Number(addBtn.getAttribute("data-photo-add")), rowEl);
    });
    var closeBtn = $("nx-photo-close");
    if (closeBtn) closeBtn.addEventListener("click", closePhotoConfirm);
  }

  /* ---------------- emergency alerts (NWS + USGS) ---------------- */
  var ALERTS_CACHE_KEY = "nyxsurvive-alerts-cache";
  var STALE_MS = 3 * 60 * 60 * 1000; // 3 hours
  var alertsCache = null;   // { fetchedAt, alerts: [], quakes: [] }
  var alertsLive = false;   // true only when data came from a fetch this session
  var stungFetchAt = 0;     // fetchedAt of the last warning fetch the sound pack stung for

  try {
    var rawCache = localStorage.getItem(ALERTS_CACHE_KEY);
    alertsCache = rawCache ? JSON.parse(rawCache) : null;
  } catch (e) { alertsCache = null; }

  function persistAlertsCache() {
    try { localStorage.setItem(ALERTS_CACHE_KEY, JSON.stringify(alertsCache)); } catch (e) { /* ignore */ }
  }
  function severityRank(s) {
    return { Extreme: 4, Severe: 3, Moderate: 2, Minor: 1 }[s] || 0;
  }
  function alertKind(a) {
    if (/warning/i.test(a.event)) return "WARNING";
    if (/watch/i.test(a.event)) return "WATCH";
    return "ADVISORY";
  }
  function fmtTime(ts) {
    return new Date(ts).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
  }

  function renderAlertBanner() {
    renderStatusBoard();
    var banner = $("nx-alert-banner");
    var text = $("nx-alert-banner-text");
    if (!banner || !text) return;
    if (!alertsCache || !alertsCache.alerts) { banner.style.display = "none"; return; }
    var alerts = alertsCache.alerts;
    var warnings = alerts.filter(function (a) { return alertKind(a) === "WARNING"; }).length;
    banner.style.display = "";
    if (!alerts.length) {
      banner.classList.remove("nx-pulse");
      banner.style.borderColor = "var(--nx-line)";
      text.style.color = "var(--nx-dim)";
      text.textContent = "ALERTS: NONE ACTIVE FOR HOME COORDS - TAP TO OPEN ALERTS";
      return;
    }
    text.textContent = "ACTIVE ALERTS: " + alerts.length + " // WARNINGS: " + warnings +
      (alertsLive ? "" : " // CACHED " + fmtTime(alertsCache.fetchedAt)) + " - TAP TO VIEW";
    banner.classList.toggle("nx-pulse", warnings > 0);
    if (warnings > 0) {
      banner.style.borderColor = "var(--nx-warn)";
      text.style.color = "var(--nx-warn)";
      // One low sting per distinct warning fetch - an appearance,
      // never a loop. A later fetch with warnings stings again.
      if (alertsCache.fetchedAt && alertsCache.fetchedAt !== stungFetchAt) {
        stungFetchAt = alertsCache.fetchedAt;
        sfxSting();
      }
    } else {
      banner.style.borderColor = "var(--nx-line2)";
      text.style.color = "var(--nx-text)";
    }
  }

  function renderAlerts() {
    var status = $("nx-alerts-status");
    var list = $("nx-alerts-list");
    var quakes = $("nx-quakes-list");
    if (!status || !list || !quakes) return;
    var mapEl = $("nx-alerts-map");
    if (mapEl) mapEl.classList.toggle("nx-live", !!(alertsCache && alertsCache.alerts && alertsCache.alerts.length > 0));

    if (!alertsCache) {
      status.textContent = "NO ALERT DATA - OFFLINE WITH NO CACHE, OR NOT FETCHED YET. CONNECT AND REFRESH.";
      list.innerHTML = "<div class=\"nx-empty\">NO CACHED ALERTS ON THIS DEVICE.</div>";
      quakes.innerHTML = "<div class=\"nx-empty\">NO CACHED SEISMIC DATA.</div>";
      renderAlertBanner();
      return;
    }

    var age = Date.now() - alertsCache.fetchedAt;
    var stale = age > STALE_MS;
    if (alertsLive) {
      status.innerHTML = "LIVE // UPDATED <b>" + fmtTime(alertsCache.fetchedAt) + "</b> // HOME " +
        fmt(state.settings.homeLat, 4) + "," + fmt(state.settings.homeLng, 4);
    } else {
      status.innerHTML = "LAST UPDATED <b>" + fmtTime(alertsCache.fetchedAt) + "</b> - SHOWING CACHED ALERTS" +
        (stale ? " // <span class=\"nx-heavy\">STALE - REFRESH WHEN SIGNAL RETURNS</span>" : "");
    }

    if (!alertsCache.alerts.length) {
      list.innerHTML = "<div class=\"nx-empty\">NO ACTIVE ALERTS FOR HOME COORDS.</div>";
    } else {
      list.innerHTML = alertsCache.alerts.map(function (a) {
        var kind = alertKind(a);
        var titleCls = kind === "WARNING" ? "nx-heavy" : "";
        var badge = kind === "WARNING"
          ? "<span class=\"nx-badge nx-badge-over\">WARNING</span>"
          : kind === "WATCH"
            ? "<span class=\"nx-badge nx-badge-soon\">WATCH</span>"
            : "<span class=\"nx-badge nx-badge-ok\">ADVISORY</span>";
        return "<div class=\"nx-row\"><div class=\"nx-row-main\">" +
          "<p class=\"nx-row-title\"><span class=\"" + titleCls + "\">" + esc(a.event) + "</span></p>" +
          "<p class=\"nx-row-meta\">SEVERITY " + esc(a.severity || "UNKNOWN") + " // CERTAINTY " + esc(a.certainty || "UNKNOWN") +
          " // EXPIRES " + (a.expires ? esc(fmtTime(a.expires)) : "N/A") + "</p>" +
          (a.headline ? "<p style=\"margin:7px 0 0 0;\">" + esc(a.headline) + "</p>" : "") +
          (a.instruction ? "<p style=\"margin:7px 0 0 0; color:var(--nx-dim); white-space:pre-wrap;\">INSTRUCTION: " + esc(a.instruction) + "</p>" : "") +
          "</div><div class=\"nx-row-side\">" + badge + "</div></div>";
      }).join("");
    }

    if (!alertsCache.quakes || !alertsCache.quakes.length) {
      quakes.innerHTML = "<div class=\"nx-empty\">NO QUAKES M2.5+ WITHIN 500 KM IN THE LAST 24H.</div>";
    } else {
      quakes.innerHTML = alertsCache.quakes.map(function (q) {
        return "<div class=\"nx-row\"><div class=\"nx-row-main\"><p class=\"nx-row-title\" style=\"font-size:16px;\">" +
          "<span class=\"nx-mono\">M" + fmt(q.mag, 1) + "</span> - " + esc(q.place) + "</p>" +
          "<p class=\"nx-row-meta\">" + esc(fmtTime(q.time)) + " // " + fmt(q.distKm, 0) + " KM FROM HOME</p></div></div>";
      }).join("");
    }
    renderAlertBanner();
  }

  function fetchWithTimeout(url, ms) {
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, ms);
    return fetch(url, { signal: ctrl.signal, headers: { "Accept": "application/geo+json" } })
      .finally(function () { clearTimeout(timer); });
  }

  async function refreshAlerts() {
    var lat = state.settings.homeLat, lng = state.settings.homeLng;
    var status = $("nx-alerts-status");
    if (status) status.textContent = "FETCHING ALERTS FOR " + fmt(lat, 4) + "," + fmt(lng, 4) + " ...";
    var gotLive = false;
    try {
      var res = await fetchWithTimeout("https://api.weather.gov/alerts/active?point=" + lat + "," + lng, 10000);
      if (!res.ok) throw new Error("NWS HTTP " + res.status);
      var data = await res.json();
      var alerts = (data.features || []).map(function (f) {
        var p = f.properties || {};
        return {
          event: p.event || "Alert",
          severity: p.severity || "Unknown",
          certainty: p.certainty || "Unknown",
          headline: p.headline || "",
          expires: p.expires || p.ends || null,
          instruction: p.instruction || ""
        };
      }).sort(function (a, b) { return severityRank(b.severity) - severityRank(a.severity); });

      var quakes = alertsCache ? (alertsCache.quakes || []) : [];
      try {
        var qres = await fetchWithTimeout("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson", 10000);
        if (qres.ok) {
          var qdata = await qres.json();
          quakes = (qdata.features || []).map(function (f) {
            var c = (f.geometry && f.geometry.coordinates) || [];
            var distKm = (c.length >= 2) ? haversineMi(lat, lng, c[1], c[0]) * 1.60934 : 99999;
            return { mag: f.properties.mag || 0, place: f.properties.place || "Unknown", time: f.properties.time, distKm: distKm };
          }).filter(function (q) { return q.distKm <= 500; })
            .sort(function (a, b) { return b.time - a.time; }).slice(0, 10);
        }
      } catch (e) { /* seismic is a bonus feed - keep prior data */ }

      alertsCache = { fetchedAt: Date.now(), alerts: alerts, quakes: quakes };
      persistAlertsCache();
      alertsLive = true;
      gotLive = true;
    } catch (e) {
      alertsLive = false;
    }
    renderAlerts();
    return gotLive;
  }

  function bindAlerts() {
    $("nx-alerts-refresh").addEventListener("click", function () { refreshAlerts(); });
    $("nx-alert-banner").addEventListener("click", function () { showView("alerts"); });
  }

  /* ---------------- system: settings, export, import, reset, wipe ---------------- */
  function renderSettings() {
    var lat = $("nx-set-lat"), lng = $("nx-set-lng"), cs = $("nx-set-callsign");
    if (lat && document.activeElement !== lat && document.activeElement !== lng && document.activeElement !== cs) {
      lat.value = state.settings.homeLat;
      lng.value = state.settings.homeLng;
      cs.value = state.settings.callsign || "";
    }
    var fxT = $("nx-effects-toggle");
    if (fxT) {
      var on = state.settings.effects !== false;
      fxT.classList.toggle("nx-on", on);
      $("nx-effects-state").textContent = !on ? "OFF"
        : (REDUCED_MOTION ? "ON // HELD OFF BY SYSTEM REDUCED-MOTION" : "ON");
    }
    var sndT = $("nx-sounds-toggle");
    if (sndT) {
      var sOn = state.settings.sounds !== false;
      sndT.classList.toggle("nx-on", sOn);
      $("nx-sounds-state").textContent = !sOn ? "OFF"
        : (state.settings.effects === false ? "ON // HELD OFF BY TERMINAL EFFECTS" : "ON");
    }
    renderDashDisplay();
    renderThemePicker();
    renderHomeSystems();
  }

  function renderDashDisplay() {
    var wrap = $("nx-dash-display-picker");
    if (!wrap) return;
    var mode = dashDisplayMode();
    wrap.querySelectorAll("[data-dash-display]").forEach(function (b) {
      b.classList.toggle("nx-btn-accent", b.getAttribute("data-dash-display") === mode);
    });
  }

  /* Home Systems (Ready.gov build): the shutoff location
     notes form in System. Filled from state on every render
     unless the user is mid-edit in one of its fields - the
     same focus guard Station Settings uses. */
  function renderHomeSystems() {
    var w = $("nx-hs-water"), g = $("nx-hs-gas"), e = $("nx-hs-electric"), p = $("nx-hs-propane");
    if (!w) return;
    if (document.activeElement === w || document.activeElement === g || document.activeElement === e || document.activeElement === p) return;
    var hs = state.homeSystems || { water: "", gas: "", electric: "", propane: "" };
    w.value = hs.water || "";
    g.value = hs.gas || "";
    e.value = hs.electric || "";
    p.value = hs.propane || "";
  }

  function buildExport() {
    var vaultRaw = null;
    try {
      var raw = localStorage.getItem(VAULT_KEY);
      vaultRaw = raw ? JSON.parse(raw) : null;
    } catch (e) { vaultRaw = null; }
    return {
      app: "nyxsurvive",
      version: 1,
      exportedAt: new Date().toISOString(),
      note: "Vault exports stay encrypted - the blob below is ciphertext and needs the vault passphrase on import.",
      state: state,
      vault: vaultRaw,
      alertsCache: alertsCache
    };
  }

  function bindSystem() {
    var fxToggle = $("nx-effects-toggle");
    if (fxToggle) fxToggle.addEventListener("click", function () {
      state.settings.effects = !(state.settings.effects !== false);
      saveState();
      applyFxClass();
      renderSettings();
    });

    var sndToggle = $("nx-sounds-toggle");
    if (sndToggle) sndToggle.addEventListener("click", function () {
      state.settings.sounds = !(state.settings.sounds !== false);
      saveState();
      renderSettings();
      if (state.settings.sounds !== false) sfxConfirm();
    });

    var picker = $("nx-theme-picker");
    if (picker) picker.addEventListener("click", function (ev) {
      var b = ev.target.closest("[data-theme-pick]");
      if (b) setTheme(b.getAttribute("data-theme-pick"));
    });

    var dashPicker = $("nx-dash-display-picker");
    if (dashPicker) dashPicker.addEventListener("click", function (ev) {
      var b = ev.target.closest("[data-dash-display]");
      if (!b) return;
      state.settings.dashDisplay = b.getAttribute("data-dash-display");
      saveState();
      renderSettings();
      renderDaysReady(false);
      sfxConfirm();
    });

    $("nx-settings-form").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var lat = Number($("nx-set-lat").value), lng = Number($("nx-set-lng").value);
      if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        showMsg($("nx-settings-msg"), "COORDINATES OUT OF RANGE.", "err");
        return;
      }
      state.settings.homeLat = lat;
      state.settings.homeLng = lng;
      state.settings.callsign = $("nx-set-callsign").value.trim();
      saveState();
      sfxConfirm();
      showMsg($("nx-settings-msg"), "SETTINGS SAVED. ALERTS REFETCHING FOR THE NEW HOME COORDS.", "good");
      renderBroadcast();
      refreshAlerts();
    });

    var hsForm = $("nx-homesys-form");
    if (hsForm) hsForm.addEventListener("submit", function (ev) {
      ev.preventDefault();
      state.homeSystems = {
        water: $("nx-hs-water").value.trim(),
        gas: $("nx-hs-gas").value.trim(),
        electric: $("nx-hs-electric").value.trim(),
        propane: $("nx-hs-propane").value.trim()
      };
      saveState();
      sfxConfirm();
      showMsg($("nx-homesys-msg"), "HOME SYSTEMS SAVED. WORK THE KNOW YOUR SHUTOFFS LIST IN THE LISTS TAB.", "good");
    });

    $("nx-export-btn").addEventListener("click", function () {
      var payload = JSON.stringify(buildExport(), null, 2);
      var blob = new Blob([payload], { type: "application/json" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = "nyxsurvive-export.json";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      showMsg($("nx-system-msg"), "EXPORT DOWNLOADED. VAULT CONTENTS STAY ENCRYPTED IN THE FILE.", "good");
    });

    $("nx-import-file").addEventListener("change", function () {
      var file = this.files && this.files[0];
      this.value = "";
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var parsed = JSON.parse(String(reader.result));
          if (!parsed || !parsed.state || !Array.isArray(parsed.state.gear)) {
            showMsg($("nx-system-msg"), "IMPORT FAILED - THAT FILE IS NOT A NYXSURVIVE EXPORT.", "err");
            return;
          }
          if (!window.confirm("Import this file? It REPLACES all current NyxSurvive data on this device.")) return;
          localStorage.setItem(STATE_KEY, JSON.stringify(parsed.state));
          if (parsed.vault) localStorage.setItem(VAULT_KEY, JSON.stringify(parsed.vault));
          else localStorage.removeItem(VAULT_KEY);
          if (parsed.alertsCache) localStorage.setItem(ALERTS_CACHE_KEY, JSON.stringify(parsed.alertsCache));
          window.location.reload();
        } catch (e) {
          showMsg($("nx-system-msg"), "IMPORT FAILED - FILE COULD NOT BE PARSED.", "err");
        }
      };
      reader.readAsText(file);
    });

    $("nx-reset-btn").addEventListener("click", function () {
      if (!window.confirm("Reset to a blank slate? Your gear, stores, comms, crew and lists are erased and the terminal starts empty. The vault is NOT touched.")) return;
      state = blankState();
      saveState();
      renderAll();
      showMsg($("nx-system-msg"), "BLANK SLATE. RUN THE READINESS CHECK-IN FROM COMMAND TO BEGIN AGAIN.", "good");
    });

    var wipeArmed = false, wipeTimer = null;
    $("nx-wipe-btn").addEventListener("click", function () {
      var btn = this;
      if (!wipeArmed) {
        wipeArmed = true;
        btn.textContent = "Confirm Wipe - Tap Again";
        btn.classList.add("nx-armed");
        showMsg($("nx-system-msg"), "ARMED. TAP AGAIN TO ERASE EVERYTHING - GEAR, STORES, CREW, LISTS, OUTBOX AND THE ENCRYPTED VAULT BLOB.", "err");
        wipeTimer = setTimeout(function () {
          wipeArmed = false;
          btn.textContent = "Wipe Everything";
          btn.classList.remove("nx-armed");
        }, 5000);
        return;
      }
      clearTimeout(wipeTimer);
      wipeArmed = false;
      btn.textContent = "Wipe Everything";
      btn.classList.remove("nx-armed");
      state = blankState();
      saveState();
      try { localStorage.removeItem(VAULT_KEY); localStorage.removeItem(ALERTS_CACHE_KEY); } catch (e) { /* ignore */ }
      alertsCache = null;
      alertsLive = false;
      Vault.load();
      resetGearForm();
      renderAll();
      showMsg($("nx-system-msg"), "WIPED. EMPTY TERMINAL - ADD GEAR AND STORES TO BEGIN AGAIN.", "good");
    });
  }

  /* ---------------- ICS: org chart + incident mode ---------------- */
  var ICS_ROLES = [
    { key: "ic", label: "Incident Commander", group: "top" },
    { key: "deputy", label: "Deputy", group: "command" },
    { key: "safety", label: "Safety + Medical Officer", group: "command" },
    { key: "comms_officer", label: "Comms Officer", group: "command" },
    { key: "liaison", label: "Liaison", group: "command" },
    { key: "ops", label: "Operations Lead", group: "general" },
    { key: "planning", label: "Planning Lead", group: "general" },
    { key: "logistics", label: "Logistics Lead", group: "general" }
  ];
  var INCIDENT_TYPES = ["Fire", "Flood", "Storm", "Grid Down", "Medical", "Evacuation", "Other"];

  function icsHolderName(roleKey) {
    var id = state.icsRoles[roleKey];
    if (!id) return null;
    var m = state.crew.filter(function (c) { return c.id === id; })[0];
    return m ? m.name : null;
  }

  function icsRoleRow(role, treePrefix) {
    var holderId = state.icsRoles[role.key] || "";
    var holderValid = holderId && state.crew.some(function (c) { return c.id === holderId; });
    var vacant = !holderValid;
    var options = "<option value=\"\">VACANT</option>" + state.crew.map(function (c) {
      return "<option value=\"" + c.id + "\"" + (holderId === c.id ? " selected" : "") + ">" + esc(c.name) + "</option>";
    }).join("");
    return "<div class=\"nx-ics-role" + (role.group === "top" ? " nx-ics-ic" : "") + (vacant ? " nx-vacant" : "") + "\">" +
      (treePrefix ? "<span class=\"nx-ics-tree\">" + treePrefix + "</span>" : "") +
      "<span class=\"nx-ics-role-name\">" + esc(role.label) + (vacant && role.group === "top" ? " // VACANT" : "") + "</span>" +
      "<select class=\"nx-select nx-ics-select\" data-ics-role=\"" + role.key + "\">" + options + "</select>" +
      "</div>";
  }

  function renderICS() {
    var chart = $("nx-ics-chart");
    if (!chart) return;
    var top = ICS_ROLES.filter(function (r) { return r.group === "top"; });
    var command = ICS_ROLES.filter(function (r) { return r.group === "command"; });
    var general = ICS_ROLES.filter(function (r) { return r.group === "general"; });
    function staffRows(roles) {
      return roles.map(function (r, i) {
        return icsRoleRow(r, i === roles.length - 1 ? "&#9492;&#9472;" : "&#9500;&#9472;");
      }).join("");
    }
    chart.innerHTML =
      top.map(function (r) { return icsRoleRow(r, ""); }).join("") +
      "<div class=\"nx-ics-branch\">Command Staff // report to IC</div><div class=\"nx-ics-staff\">" + staffRows(command) + "</div>" +
      "<div class=\"nx-ics-branch\">General Staff // report to IC</div><div class=\"nx-ics-staff\">" + staffRows(general) + "</div>";

    renderIncident();

    var past = $("nx-past-incidents");
    if (!state.pastIncidents.length) {
      past.innerHTML = "<div class=\"nx-empty\">NO CLOSED INCIDENTS ON RECORD.</div>";
    } else {
      past.innerHTML = state.pastIncidents.slice().reverse().map(function (p) {
        return "<div class=\"nx-row\"><div class=\"nx-row-main\"><p class=\"nx-row-title\" style=\"font-size:16px;\">" + esc(p.name) + "</p>" +
          "<p class=\"nx-row-meta\">" + esc(p.type.toUpperCase()) + " // OPENED " + esc(fmtTime(p.startedAt)) + " // CLOSED " + esc(fmtTime(p.closedAt)) + "</p></div></div>";
      }).join("");
    }
  }

  function renderIncident() {
    var none = $("nx-incident-none");
    var live = $("nx-incident-live");
    var inc = state.incident;
    none.style.display = inc ? "none" : "";
    live.style.display = inc ? "" : "none";
    if (!inc) { renderIncidentBanner(); return; }

    var openObj = inc.objectives.filter(function (o) { return !o.done; }).length;
    var crewOptions = "<option value=\"\">UNASSIGNED</option>" + state.crew.map(function (c) {
      return "<option value=\"" + c.id + "\">" + esc(c.name) + "</option>";
    }).join("");

    live.innerHTML =
      "<div class=\"nx-switch-row\" style=\"justify-content:space-between;\">" +
        "<div><p class=\"nx-row-title\" style=\"font-size:21px;\">" + esc(inc.name) + "</p>" +
        "<p class=\"nx-row-meta\">" + esc(inc.type.toUpperCase()) + " // OPENED " + esc(fmtTime(inc.startedAt)) +
        " // IC: " + esc(icsHolderName("ic") || "VACANT") + "</p></div>" +
        "<button type=\"button\" class=\"nx-btn nx-btn-danger\" id=\"nx-inc-close\">Close Incident</button>" +
      "</div>" +

      "<h3 class=\"nx-section-sub\">Objectives - ICS-202 // " + openObj + " OPEN</h3>" +
      (inc.objectives.length
        ? inc.objectives.map(function (o) {
            return "<label class=\"nx-check-item" + (o.done ? " nx-done" : "") + "\">" +
              "<input type=\"checkbox\" data-obj-id=\"" + o.id + "\"" + (o.done ? " checked" : "") + ">" +
              "<span class=\"nx-check-text\">" + esc(o.text) + "</span></label>";
          }).join("")
        : "<div class=\"nx-empty\">NO OBJECTIVES YET.</div>") +
      "<form id=\"nx-obj-form\" style=\"margin-top:8px;\"><div style=\"display:flex; gap:8px; flex-wrap:wrap;\">" +
        "<input class=\"nx-input\" id=\"nx-obj-text\" required maxlength=\"140\" placeholder=\"New objective\" style=\"flex:1 1 220px;\">" +
        "<button type=\"submit\" class=\"nx-btn nx-btn-small\">Add Objective</button></div></form>" +

      "<h3 class=\"nx-section-sub\">Assignments - ICS-204</h3>" +
      (inc.assignments.length
        ? inc.assignments.map(function (a) {
            var who = a.assignee ? crewName(a.assignee) : "UNASSIGNED";
            return "<div class=\"nx-row\"><div class=\"nx-row-main\"><p class=\"nx-row-title\" style=\"font-size:16px;\">" + esc(a.task) + "</p>" +
              "<p class=\"nx-row-meta\">ASSIGNED: " + esc(who) + "</p></div>" +
              "<div class=\"nx-row-side\"><button type=\"button\" class=\"nx-btn nx-btn-small\" data-asn-toggle=\"" + a.id + "\">" + (a.status === "DONE" ? "DONE" : "TO DO") + "</button> " +
              "<button type=\"button\" class=\"nx-btn nx-btn-small nx-btn-danger\" data-asn-del=\"" + a.id + "\">Del</button></div></div>";
          }).join("")
        : "<div class=\"nx-empty\">NO ASSIGNMENTS YET.</div>") +
      "<form id=\"nx-asn-form\" style=\"margin-top:8px;\"><div style=\"display:flex; gap:8px; flex-wrap:wrap;\">" +
        "<input class=\"nx-input\" id=\"nx-asn-task\" required maxlength=\"140\" placeholder=\"Task\" style=\"flex:1 1 200px;\">" +
        "<select class=\"nx-select\" id=\"nx-asn-who\" style=\"width:auto;\">" + crewOptions + "</select>" +
        "<button type=\"submit\" class=\"nx-btn nx-btn-small\">Add Assignment</button></div></form>" +

      "<h3 class=\"nx-section-sub\">Activity Log - ICS-214</h3>" +
      "<div id=\"nx-inc-log\">" +
      (inc.log.length
        ? inc.log.map(function (l) {
            return "<div class=\"nx-log-line\"><b>[" + esc(new Date(l.ts).toLocaleTimeString("en-GB", { hour12: false })) + "]</b> " + esc(l.text) + "</div>";
          }).join("")
        : "<div class=\"nx-empty\">LOG IS EMPTY.</div>") +
      "</div>" +
      "<form id=\"nx-log-form\" style=\"margin-top:8px;\"><div style=\"display:flex; gap:8px; flex-wrap:wrap;\">" +
        "<input class=\"nx-input\" id=\"nx-log-text\" required maxlength=\"240\" placeholder=\"Log entry - what happened, who, where\" style=\"flex:1 1 220px;\">" +
        "<button type=\"submit\" class=\"nx-btn nx-btn-small\">Append Log</button></div></form>";

    bindIncidentDynamic();
    renderIncidentBanner();
  }

  function renderIncidentBanner() {
    var banner = $("nx-incident-banner");
    var text = $("nx-incident-banner-text");
    if (!banner || !text) return;
    var inc = state.incident;
    if (!inc) { banner.style.display = "none"; return; }
    var openObj = inc.objectives.filter(function (o) { return !o.done; }).length;
    banner.style.display = "";
    text.textContent = "ACTIVE INCIDENT: " + inc.name.toUpperCase() + " // " + inc.type.toUpperCase() +
      " // IC: " + (icsHolderName("ic") || "VACANT").toUpperCase() + " // OBJECTIVES OPEN: " + openObj + " - TAP TO OPEN ICS";
  }

  function bindIncidentDynamic() {
    var live = $("nx-incident-live");
    if (!live || !state.incident) return;

    var closeBtn = $("nx-inc-close");
    if (closeBtn) closeBtn.addEventListener("click", function () {
      var inc = state.incident;
      if (!inc) return;
      if (!window.confirm("Close incident \"" + inc.name + "\"? It moves to Past Incidents.")) return;
      state.pastIncidents.push({ id: inc.id, name: inc.name, type: inc.type, startedAt: inc.startedAt, closedAt: new Date().toISOString() });
      state.incident = null;
      saveState();
      renderAll();
    });

    var objForm = $("nx-obj-form");
    if (objForm) objForm.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var text = $("nx-obj-text").value.trim();
      if (!text) return;
      state.incident.objectives.push({ id: uid(), text: text, done: false });
      saveState();
      renderICS();
      renderIncidentBanner();
    });

    var asnForm = $("nx-asn-form");
    if (asnForm) asnForm.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var task = $("nx-asn-task").value.trim();
      if (!task) return;
      state.incident.assignments.push({ id: uid(), task: task, assignee: $("nx-asn-who").value || "", status: "TO DO" });
      saveState();
      renderICS();
    });

    var logForm = $("nx-log-form");
    if (logForm) logForm.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var text = $("nx-log-text").value.trim();
      if (!text) return;
      state.incident.log.push({ ts: new Date().toISOString(), text: text });
      saveState();
      renderICS();
    });
  }

  function bindICS() {
    $("nx-ics-chart").addEventListener("change", function (ev) {
      var sel = ev.target.closest("[data-ics-role]");
      if (!sel) return;
      state.icsRoles[sel.getAttribute("data-ics-role")] = sel.value || "";
      saveState();
      renderICS();
      renderIncidentBanner();
    });

    $("nx-incident-form").addEventListener("submit", function (ev) {
      ev.preventDefault();
      if (state.incident) return;
      var name = $("nx-inc-name").value.trim();
      if (!name) return;
      state.incident = {
        id: uid(),
        name: name,
        type: $("nx-inc-type").value,
        startedAt: new Date().toISOString(),
        objectives: [],
        assignments: [],
        log: [{ ts: new Date().toISOString(), text: "Incident opened." }]
      };
      saveState();
      ev.target.reset();
      renderAll();
    });

    $("nx-incident-live").addEventListener("change", function (ev) {
      var box = ev.target.closest("[data-obj-id]");
      if (!box || !state.incident) return;
      var obj = state.incident.objectives.filter(function (o) { return o.id === box.getAttribute("data-obj-id"); })[0];
      if (obj) { obj.done = box.checked; saveState(); renderICS(); renderIncidentBanner(); }
    });
    $("nx-incident-live").addEventListener("click", function (ev) {
      if (!state.incident) return;
      var tog = ev.target.closest("[data-asn-toggle]");
      if (tog) {
        var a = state.incident.assignments.filter(function (x) { return x.id === tog.getAttribute("data-asn-toggle"); })[0];
        if (a) { a.status = a.status === "DONE" ? "TO DO" : "DONE"; saveState(); renderICS(); }
        return;
      }
      var del = ev.target.closest("[data-asn-del]");
      if (del) {
        state.incident.assignments = state.incident.assignments.filter(function (x) { return x.id !== del.getAttribute("data-asn-del"); });
        saveState();
        renderICS();
      }
    });

    $("nx-incident-banner").addEventListener("click", function () { showView("ics"); });
  }

  /* ---------------- plan gating: view locks + settings row ---------------- */
  function applyGate(bodyId, lockId, feature) {
    var body = $(bodyId), lock = $(lockId);
    if (!body || !lock) return;
    var locked = !isOperator();
    body.style.display = locked ? "none" : "";
    lock.innerHTML = locked ? upsellHtml(feature) : "";
    lock.style.display = locked ? "" : "none";
  }

  function renderPlan() {
    applyGate("nx-ics-body", "nx-ics-lock", "INCIDENT COMMAND");
    applyGate("nx-bc-inner", "nx-bc-lock", "BROADCAST");
    applyGate("nx-calc-body", "nx-calc-lock", "NEED CALCULATORS");
    var name = $("nx-plan-name");
    if (name) {
      name.textContent = isOwner() ? "OWNER" : planTier().toUpperCase();
      var note = $("nx-plan-note");
      if (note) {
        note.textContent = isOperator()
          ? "Operator tier active: every cap removed, ICS, broadcasts, calculators and GO-Book unlocked. The tier attaches to your account and is proved server-side at sign-in; offline, the last proven tier stands."
          : "Free covers Days Ready, one loadout, rotation, the vault, compass, checklists and alerts. Operator removes every cap and unlocks ICS, broadcasts, the need calculators and the GO-Book. Free caps: " +
            PLAN_CAPS.crew + " crew // " + PLAN_CAPS.vault + " vault entries // " + PLAN_CAPS.gear + " gear items.";
      }
      var cta = $("nx-plan-cta");
      if (cta) {
        if (isOperator()) {
          cta.style.display = "none";
          cta.innerHTML = "";
        } else {
          cta.style.display = "";
          if (authUser) {
            // Signed in: the tier picker checks out directly
            // against this account (see startCheckout).
            cta.innerHTML =
              "<button type=\"button\" class=\"nx-btn nx-btn-accent\" data-checkout-plan=\"monthly\">OPERATOR - $6.99/MO</button>" +
              "<button type=\"button\" class=\"nx-btn\" data-checkout-plan=\"yearly\">OPERATOR - $49.99/YR</button>" +
              "<button type=\"button\" class=\"nx-btn\" data-checkout-plan=\"lifetime\">LIFETIME - $149</button>" +
              "<button type=\"button\" class=\"nx-btn\" data-checkout-plan=\"founding\">FOUNDING LIFETIME - $99.99</button>";
          } else {
            cta.innerHTML =
              "<button type=\"button\" class=\"nx-btn nx-btn-accent nx-go-operator\">GO OPERATOR</button>" +
              "<a class=\"nx-btn\" href=\"index.html#pricing\">See Plans</a>";
          }
        }
      }
    }
  }

  /* ---------------- need calculators (Operator) ----------------
     Same sustainment math as Days Ready: 1.0 gal water and
     2,000 kcal food per person per day. The staple table is a
     dry-goods backbone: each staple carries a fixed share of the
     total kcal target, converted to pounds via kcal-per-lb. */
  var STAPLES = [
    { name: "White rice", kcalPerLb: 1650, share: 0.35 },
    { name: "Rolled oats", kcalPerLb: 1750, share: 0.20 },
    { name: "Dry beans", kcalPerLb: 1550, share: 0.25 },
    { name: "Peanut butter", kcalPerLb: 2650, share: 0.20 }
  ];
  function calcNeeds(household, days) {
    var hh = Math.max(1, Math.round(Number(household) || 1));
    var dd = Math.max(1, Math.round(Number(days) || 1));
    var waterGal = hh * dd * 1.0;
    var foodKcal = hh * dd * 2000;
    var staples = STAPLES.map(function (s) {
      var kcal = foodKcal * s.share;
      return { name: s.name, kcalPerLb: s.kcalPerLb, share: s.share, kcal: kcal, lb: kcal / s.kcalPerLb };
    });
    return { household: hh, days: dd, waterGal: waterGal, foodKcal: foodKcal, staples: staples };
  }
  function calcGap(needs) {
    // HAVE comes from the same non-expired totals Days Ready uses.
    var d = daysReady();
    var haveWater = d.waterGal;
    var haveFood = d.foodKcal;
    var staples = needs.staples.map(function (s) {
      // Assume the pantry is stocked in the same proportions as the
      // target split, so the food on hand offsets each staple by its
      // share before any shortfall is reported.
      var shortKcal = Math.max(0, s.kcal - haveFood * s.share);
      return { name: s.name, shortKcal: shortKcal, shortLb: shortKcal / s.kcalPerLb };
    });
    return {
      haveWater: haveWater, haveFood: haveFood,
      shortWater: Math.max(0, needs.waterGal - haveWater),
      shortFoodKcal: Math.max(0, needs.foodKcal - haveFood),
      staples: staples
    };
  }

  var calcDefaultsDone = false;
  function renderCalc() {
    var out = $("nx-calc-out");
    if (!out) return;
    if (!isOperator()) { out.innerHTML = ""; return; }
    var hhInput = $("nx-calc-hh"), daysInput = $("nx-calc-days");
    if (!calcDefaultsDone) {
      hhInput.value = householdSize();
      daysInput.value = 30;
      calcDefaultsDone = true;
    }
    var needs = calcNeeds(hhInput.value, daysInput.value);
    var gap = calcGap(needs);
    var rows = needs.staples.map(function (s) {
      return "<tr><td>" + esc(s.name) + "</td>" +
        "<td class=\"nx-num\">" + Math.round(s.share * 100) + "%</td>" +
        "<td class=\"nx-num\">" + fmt(s.kcal, 0) + "</td>" +
        "<td class=\"nx-num\">" + fmt(s.lb, 1) + " LB</td></tr>";
    }).join("");
    var shortLines = "";
    if (gap.shortWater > 0) shortLines += "<p class=\"nx-kv nx-short-line\">SHORT " + fmt(gap.shortWater, 1) + " GAL WATER</p>";
    gap.staples.forEach(function (s) {
      if (s.shortLb > 0) shortLines += "<p class=\"nx-kv nx-short-line\">SHORT " + fmt(s.shortLb, 1) + " LB " + esc(s.name.toUpperCase()) + "</p>";
    });
    out.innerHTML =
      "<p class=\"nx-totals-line\" style=\"margin-top:14px;\">TARGET // <b>" + needs.days + " DAYS</b> // HOUSEHOLD <b>" + needs.household + "</b></p>" +
      "<div class=\"nx-grid nx-grid-2\">" +
        "<div class=\"nx-stat\"><p class=\"nx-stat-label\">Water Needed</p>" +
          "<p class=\"nx-stat-value\">" + fmt(needs.waterGal, 1) + " <span class=\"nx-unit\">GAL</span></p>" +
          "<p class=\"nx-stat-sub\">HAVE " + fmt(gap.haveWater, 1) + " GAL // " +
          (gap.shortWater > 0 ? "SHORT " + fmt(gap.shortWater, 1) + " GAL" : "COVERED") + "</p></div>" +
        "<div class=\"nx-stat\"><p class=\"nx-stat-label\">Food Needed</p>" +
          "<p class=\"nx-stat-value\">" + fmt(needs.foodKcal, 0) + " <span class=\"nx-unit\">KCAL</span></p>" +
          "<p class=\"nx-stat-sub\">HAVE " + fmt(gap.haveFood, 0) + " KCAL // " +
          (gap.shortFoodKcal > 0 ? "SHORT " + fmt(gap.shortFoodKcal, 0) + " KCAL" : "COVERED") + "</p></div>" +
      "</div>" +
      "<h3 class=\"nx-section-sub\">Staple Shopping List - " + fmt(needs.foodKcal, 0) + " KCAL</h3>" +
      "<div style=\"overflow-x:auto;\"><table class=\"nx-table\"><thead><tr><th>Staple</th><th>Share</th><th>Kcal</th><th>Amount</th></tr></thead>" +
      "<tbody>" + rows + "</tbody></table></div>" +
      "<h3 class=\"nx-section-sub\">Gap Analysis - Have vs Need</h3>" +
      (shortLines
        ? shortLines
        : "<p class=\"nx-kv\">TARGET COVERED - STORES MEET THE " + needs.days + "-DAY NEED FOR A HOUSEHOLD OF " + needs.household + ".</p>");
  }

  function bindCalc() {
    var presets = $("nx-calc-presets");
    if (presets) presets.addEventListener("click", function (ev) {
      var b = ev.target.closest("[data-calc-days]");
      if (!b) return;
      $("nx-calc-days").value = b.getAttribute("data-calc-days");
      presets.querySelectorAll(".nx-fbtn").forEach(function (x) {
        x.classList.toggle("nx-on", x === b);
      });
      renderCalc();
    });
    ["nx-calc-hh", "nx-calc-days"].forEach(function (id) {
      var el = $(id);
      if (el) el.addEventListener("input", function () {
        calcDefaultsDone = true;
        renderCalc();
      });
    });
  }

  /* ---------------- GO-Book print export (Operator) ----------------
     Paper backup of the whole operation. Rally OPSEC rule: names
     and notes print ONLY while the vault is unlocked in this
     session; coordinates NEVER print, in any state. No other vault
     entry bodies print at all - rally points are the only vault
     content in the book. */
  function buildGoBook() {
    var d = daysReady();
    var printed = new Date().toLocaleDateString("en-US") + " " +
      new Date().toLocaleTimeString("en-GB", { hour12: false });
    var h = "";
    h += "<h1>NyxSurvive // GO-BOOK</h1>";
    h += "<p class=\"nx-gb-cover\">HOUSEHOLD: <b>" + d.household + " PERSONS</b>" +
      (d.pets ? " + " + d.pets + " PET" + (d.pets > 1 ? "S" : "") : "") +
      " // DAYS READY: <b>" + (d.headline == null ? "--" : fmt(d.headline, 1)) + "</b>" +
      " // CALL SIGN: <b>" + esc(callSign()) + "</b>" +
      " // PRINTED: <b>" + esc(printed) + "</b></p>";
    h += "<p>WATER ON HAND: " + fmt(d.waterGal, 1) + " GAL (" + (d.waterDays == null ? "--" : fmt(d.waterDays, 1)) + " DAYS)" +
      " // FOOD ON HAND: " + fmt(d.foodKcal, 0) + " KCAL (" + (d.foodDays == null ? "--" : fmt(d.foodDays, 1)) + " DAYS)" +
      (d.gap ? " // GAP: " + esc(d.gap) : "") + "</p>";

    h += "<h2>Incident Organization - ICS</h2>";
    h += "<table><thead><tr><th>Role</th><th>Holder</th></tr></thead><tbody>" +
      ICS_ROLES.map(function (r) {
        return "<tr><td>" + esc(r.label) + "</td><td>" + esc(icsHolderName(r.key) || "VACANT") + "</td></tr>";
      }).join("") + "</tbody></table>";
    if (state.incident) {
      var inc = state.incident;
      h += "<p>ACTIVE INCIDENT: <b>" + esc(inc.name) + "</b> // " + esc(inc.type.toUpperCase()) +
        " // OPENED " + esc(fmtTime(inc.startedAt)) + "</p>";
      if (inc.objectives.length) {
        h += "<p>OBJECTIVES - ICS-202:</p><ul>" + inc.objectives.map(function (o) {
          return "<li>" + (o.done ? "[X] " : "[ ] ") + esc(o.text) + "</li>";
        }).join("") + "</ul>";
      }
      if (inc.assignments.length) {
        h += "<p>ASSIGNMENTS - ICS-204:</p><ul>" + inc.assignments.map(function (a) {
          return "<li>" + esc(a.task) + " - " + esc(a.assignee ? crewName(a.assignee) : "UNASSIGNED") + " - " + esc(a.status) + "</li>";
        }).join("") + "</ul>";
      }
    }

    h += "<h2>Comms Plan - ICS-205</h2>";
    h += state.comms.length
      ? "<table><thead><tr><th>Label</th><th>Frequency / Channel</th><th>Call Sign</th><th>Purpose</th><th>Check-In Times</th></tr></thead><tbody>" +
        state.comms.map(function (c) {
          return "<tr><td>" + esc(c.label) + "</td><td>" + esc(c.freq) + "</td><td>" + esc(c.callsign) +
            "</td><td>" + esc(c.purpose) + "</td><td>" + esc(c.checkin) + "</td></tr>";
        }).join("") + "</tbody></table>"
      : "<p>NO CHANNELS IN THE COMMS PLAN.</p>";

    /* Family Plan (Ready.gov build): the household card -
       who is in the house, where you meet, who outside the
       area you check in with, the meds that matter and the
       cash on hand. Names and places only: coordinates never
       print, in this section or any other. */
    h += "<h2>Family Plan</h2>";
    h += state.crew.length
      ? "<table><thead><tr><th>Household Member</th><th>Role</th></tr></thead><tbody>" +
        state.crew.map(function (c) {
          return "<tr><td>" + esc(c.name) + "</td><td>" + esc(c.role) + "</td></tr>";
        }).join("") + "</tbody></table>"
      : "<p>NO CREW LOGGED.</p>";
    var fp = state.familyPlan || { outName: "", outPhone: "", rally2: "" };
    var primaryRallyEntry = Vault.unlocked ? primaryRally() : null;
    h += "<p>PRIMARY MEETING PLACE: <b>" + (primaryRallyEntry
      ? esc(primaryRallyEntry.title)
      : (Vault.blob ? "SEALED IN VAULT - UNLOCK IN APP" : "NOT SET")) + "</b></p>";
    h += "<p>SECONDARY MEETING PLACE: <b>" + (fp.rally2 ? esc(fp.rally2) : "NOT SET") + "</b></p>";
    h += "<p>OUT-OF-TOWN CONTACT: <b>" + (fp.outName
      ? esc(fp.outName) + (fp.outPhone ? " // " + esc(fp.outPhone) : "")
      : "NOT SET") + "</b></p>";
    h += "<p>COMMS CHANNELS: " + (state.comms.length
      ? state.comms.map(function (c) { return esc(c.label); }).join(", ")
      : "NONE SET") + "</p>";
    var meds = Array.isArray(state.meds) ? state.meds : [];
    h += "<h3>Medications</h3>";
    h += meds.length
      ? "<ul>" + meds.map(function (m) {
          return "<li>" + esc(m.person || "UNASSIGNED") + " - " + esc(m.name) +
            (m.dose ? " (" + esc(m.dose) + ")" : "") + " - " + (Number(m.supplyDays) || 0) + " DAYS SUPPLY" +
            (m.expiry ? " // EXP " + esc(m.expiry) : "") + "</li>";
        }).join("") + "</ul>"
      : "<p>NO MEDS LOGGED.</p>";
    var cashEntries = Array.isArray(state.cash) ? state.cash : [];
    h += "<p>CASH ON HAND: <b>$" + fmt(cashTotal(), 0) + "</b>" + (cashEntries.length
      ? " - " + cashEntries.map(function (c) { return esc(c.where || "UNMARKED") + ": $" + fmt(c.amount, 0); }).join(" // ")
      : "") + "</p>";

    h += "<h2>Scenario Checklists</h2>";
    CHECKLISTS.forEach(function (list) {
      var saved = state.checklists[list.id] || {};
      var done = list.items.filter(function (_, i) { return saved[i]; }).length;
      h += "<h3>" + esc(list.title) + " - " + done + "/" + list.items.length + "</h3><ul>" +
        list.items.map(function (text, i) {
          return "<li>" + (saved[i] ? "[X] " : "[ ] ") + esc(text) + "</li>";
        }).join("") + "</ul>";
    });

    h += "<h2>Gear Summary by Tier</h2>";
    ["T1", "T2", "T3"].forEach(function (tier) {
      var items = state.gear.filter(function (g) { return g.tier === tier; });
      h += "<h3>" + esc(TIERS[tier]) + " - " + items.length + " ITEMS // " + fmt(tierWeight(tier), 1) + " LB</h3>";
      h += items.length
        ? "<table><thead><tr><th>Item</th><th>Category</th><th>Qty</th><th>Weight</th></tr></thead><tbody>" +
          items.map(function (g) {
            return "<tr><td>" + esc(g.name) + "</td><td>" + esc(g.category) + "</td><td>" +
              (Number(g.qty) || 1) + "</td><td>" + fmt(itemWeightLb(g), 2) + " LB</td></tr>";
          }).join("") + "</tbody></table>"
        : "<p>NO ITEMS IN THIS TIER.</p>";
    });
    h += "<p>GRAND TOTAL: <b>" + fmt(totalWeight(), 1) + " LB</b> // " + state.gear.length + " ITEMS</p>";

    h += "<h2>Rotation - Due Soon and Overdue</h2>";
    var due = allExpiries().filter(function (r) { return r.days != null && r.days <= 30; });
    h += due.length
      ? "<table><thead><tr><th>Item</th><th>Source</th><th>Expiry</th><th>Days Left</th><th>State</th></tr></thead><tbody>" +
        due.map(function (r) {
          var st = expiryState(r.days);
          return "<tr><td>" + esc(r.name) + "</td><td>" + esc(r.source) + "</td><td>" + esc(r.expiry) +
            "</td><td>" + r.days + "</td><td>" + st.label + "</td></tr>";
        }).join("") + "</tbody></table>"
      : "<p>NOTHING DUE WITHIN 30 DAYS. ROTATION IS CLEAN.</p>";

    h += "<h2>Rally Points</h2>";
    if (Vault.unlocked) {
      var rallies = Vault.entries.filter(function (e) { return e.type === "Rally Point"; });
      h += rallies.length
        ? rallies.map(function (e, i) {
            return "<p><b>" + esc(e.title) + "</b>" + (i === 0 ? " (PRIMARY)" : "") +
              (e.body ? "<br>" + esc(e.body) : "") + "</p>";
          }).join("")
        : "<p>NO RALLY POINTS IN THE VAULT.</p>";
    } else if (Vault.blob) {
      h += "<p>RALLY DETAILS SEALED IN VAULT - UNLOCK IN APP</p>";
    } else {
      h += "<p>NO VAULT ON THIS DEVICE - NO RALLY DETAILS ON FILE.</p>";
    }
    h += "<p class=\"nx-gb-foot\">NyxSurvive&#8482; // &copy; 2026 Nyx Collective LLC // nyxcollectivellc.com</p>";
    return h;
  }

  function printGoBook() {
    var book = $("nx-gobook");
    if (!book) return;
    book.innerHTML = buildGoBook();
    document.body.classList.add("nx-print-gobook");
    window.print();
    document.body.classList.remove("nx-print-gobook");
  }

  function bindGoBook() {
    var btn = $("nx-gobook-btn");
    if (btn) btn.addEventListener("click", printGoBook);
    window.addEventListener("afterprint", function () {
      document.body.classList.remove("nx-print-gobook");
      document.body.classList.remove("nx-print-comms");
    });
  }

  /* ---------------- terminal effects ---------------- */
  var REDUCED_MOTION = false;
  try { REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { REDUCED_MOTION = false; }
  var nxDashAnimated = false;
  var vaultFxActive = false;

  function effectsOn() { return !REDUCED_MOTION && state.settings.effects !== false; }
  /* Blackout posture: in the Blackout theme the animation layer
     is minimized no matter what the effects toggle says - no
     sweep, no pulses, no count-ups, no boot show. fxAnimate() is
     the gate every animation call site uses. */
  function fxAnimate() { return effectsOn() && currentTheme() !== "blackout"; }
  function applyFxClass() { document.body.classList.toggle("nx-fx", fxAnimate()); }

  function countUp(el, to, decimals) {
    if (!el) return;
    var dur = 650, start = null;
    function frame(ts) {
      if (!start) start = ts;
      var p = Math.min(1, (ts - start) / dur);
      var eased = 1 - Math.pow(1 - p, 3);
      el.textContent = fmt(to * eased, decimals);
      if (p < 1 && el.isConnected) requestAnimationFrame(frame);
      else el.textContent = fmt(to, decimals);
    }
    requestAnimationFrame(frame);
  }

  function segAnimate(el, pct, plain) {
    if (!el) return;
    var on = Math.round(clamp(pct, 0, 100) / 10);
    el.innerHTML = segHtml(0, plain);
    var blocks = el.children, i = 0;
    var timer = setInterval(function () {
      if (i >= on || !el.isConnected) { clearInterval(timer); return; }
      blocks[i].className = "nx-on" + (plain ? " nx-plain" : "");
      i++;
    }, 45);
  }

  function runBoot(onDone) {
    var overlay = $("nx-boot");
    var finished = false;
    function finish() {
      if (finished) return;
      finished = true;
      if (overlay) overlay.style.display = "none";
      if (onDone) onDone();
    }
    if (!overlay || !fxAnimate()) { finish(); return; }
    var lines = [
      "NYXSURVIVE OS <b>v1.0</b>",
      "LOCAL VAULT ... <b>SEALED</b>",
      "GRID ... <b>OFFLINE</b>",
      "CREW MANIFEST ... <b>LOADED</b>",
      "ALERT CACHE ... <b>READY</b>",
      "COMMAND ... <b>READY</b>"
    ];
    var box = $("nx-boot-lines");
    var seg = $("nx-boot-seg");
    seg.innerHTML = segHtml(0, false);
    var blocks = seg.children;
    var i = 0;
    var timer = setInterval(function () {
      if (i < lines.length) {
        var div = document.createElement("div");
        div.className = "nx-boot-line" + (i === lines.length - 1 ? " nx-boot-final" : "");
        div.innerHTML = lines[i];
        box.appendChild(div);
        var onCount = Math.round(((i + 1) / lines.length) * blocks.length);
        for (var b = 0; b < blocks.length; b++) blocks[b].className = b < onCount ? "nx-on" : "";
        i++;
      } else {
        clearInterval(timer);
        setTimeout(finish, 150);
      }
    }, 120);
    overlay.addEventListener("click", finish);
    setTimeout(finish, 1500); // hard cap - boot never holds the app hostage
  }

  /* ---------------- accounts + cloud sync (Phase 3A) ----------------
     Accounts are OPTIONAL, always. NyxSurvive is offline-first:
     signed out (or on a deployment where /api/config is not
     configured) the app runs local-only, exactly as V1 did - no
     gate, no nag, data on device. An account adds two things:
     an encrypted-backup sync of the save, and the server-proven
     Operator/Lifetime tier.

     ZERO-KNOWLEDGE SYNC: the Firestore doc users/{uid} holds
     client-writable fields - `state` (the whole nyxsurvive-v1
     object), `vault` (the RAW nyxsurvive-vault localStorage
     string), and `email` (the account's own address, for the
     owner portal's lookup). The vault string is AES-GCM
     ciphertext produced on this device; sync copies it byte for
     byte and never decrypts it, and the passphrase never leaves
     the device at all. The server can see the operational state
     (gear, stores, crew) - it cannot read a single vault entry.

     The doc's `plan` field is server-owned (Stripe webhook /
     owner grants; the Firestore rules refuse client writes to
     it). syncPayload() therefore has NO top-level plan key - the
     plan value inside the synced state blob is only this device's
     display cache, and subscription-status is the only authority
     that can move it (see refreshPlanStatus). */
  /* API base: on the web the app and its /api routes share an
   * origin, so calls stay relative. In the bundled native app
   * (native/) the origin is https://localhost (Capacitor), where a
   * relative /api path would hit the bundle itself - so native
   * shells call the production site cross-origin instead. The api
   * routes answer CORS for exactly these app origins (see
   * api/_cors.js); no other site gets cross-origin access. */
  var API_BASE = (function () {
    try {
      if (window.Capacitor && window.Capacitor.getPlatform) {
        var p = window.Capacitor.getPlatform();
        if (p === "ios" || p === "android") return "https://www.nyxsurvive.com";
      }
    } catch (e) {}
    var o = "";
    try { o = window.location.origin || ""; } catch (e) {}
    if (o === "https://localhost" || o === "capacitor://localhost") return "https://www.nyxsurvive.com";
    return "";
  })();
  function apiUrl(path) { return API_BASE + path; }
  /* Open a page in the system browser (native) or a new tab
   * (web): the Capacitor Browser plugin when the shell provides
   * it, window.open otherwise. Used for the things that must
   * happen on the real website - checkout and the owner portal. */
  function openExternal(url) {
    try {
      var br = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Browser;
      if (br && br.open) { br.open({ url: url }); return; }
    } catch (e) {}
    window.open(url, "_blank");
  }
  var FIREBASE_CONFIG = (typeof window !== "undefined" && window.__NXS_FIREBASE_CONFIG) || null;
  var PLAN_CACHE_KEY = "nyxsurvive-plan"; // { uid, tier } - last server-proven tier for that account
  var STASH_KEY = "nyxsurvive-stash";     // { uid, state, vault } - a save set aside for its owner
  var firebaseReady = null;               // promise for the lazy SDK load
  var authUser = null;                    // Firebase user object, or null
  /* Bumped whenever the signed-in identity changes. Async auth
   * work captures it before awaiting and refuses to apply results
   * once it has moved on, so a slow response can never resurrect
   * a signed-in state after sign-out. */
  var authSession = 0;
  /* Set by an explicit sign-out and cleared by the next explicit
   * sign-in (or handleSignedIn). While set, an auth-listener fire
   * carrying a user is treated as a stale persisted session, not
   * a sign-in: it is signed straight back out instead of
   * resurrecting the session. In-memory only - a fresh boot with
   * a persisted session is still a normal sign-in. */
  var explicitSignOut = false;
  var cloudSyncTimer = null;
  var lastSyncAt = 0;
  var syncState = "local"; // local | pending | syncing | synced | error
  /* Inside an installed-app WebView there is no popup window for
   * Google sign-in to complete in, so native shells use a
   * full-page redirect (see signInWithGoogle). Detected via the
   * Capacitor bridge when present, or the Android WebView UA
   * token - NyxSurvive ships as a plain PWA, so the UA is the
   * common case. */
  var IS_NATIVE_APP = (function () {
    try {
      if (window.Capacitor && window.Capacitor.getPlatform) {
        var p = window.Capacitor.getPlatform();
        if (p === "ios" || p === "android") return true;
      }
    } catch (e) {}
    return /; wv\)/.test(navigator.userAgent || "");
  })();

  function firebaseConfigured() {
    return !!(FIREBASE_CONFIG && FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.projectId);
  }
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = src; s.onload = resolve; s.onerror = function () { reject(new Error("Failed to load " + src)); };
      document.head.appendChild(s);
    });
  }
  function ensureFirebase() {
    if (firebaseReady) return firebaseReady;
    firebaseReady = (async function () {
      if (!FIREBASE_CONFIG) {
        try {
          var res = await fetch(apiUrl("/api/config"));
          if (res.ok) { var cfg = await res.json(); if (cfg && cfg.apiKey) FIREBASE_CONFIG = cfg; }
        } catch (e) { /* no config endpoint - stay local-only */ }
      }
      if (!firebaseConfigured()) return null;
      if (!window.firebase) {
        await loadScript("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js");
        await loadScript("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js");
        await loadScript("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-compat.js");
      }
      if (!window.firebase.apps.length) window.firebase.initializeApp(FIREBASE_CONFIG);
      return window.firebase;
    })();
    return firebaseReady;
  }
  function nxAuth() { return (window.firebase && window.firebase.apps.length) ? window.firebase.auth() : null; }
  function nxDb() { return (window.firebase && window.firebase.apps.length) ? window.firebase.firestore() : null; }

  function friendlyAuthError(e) {
    var code = (e && e.code) || "";
    if (code.indexOf("email-already-in-use") !== -1) return "That email already has an account - try signing in instead.";
    if (code.indexOf("wrong-password") !== -1 || code.indexOf("invalid-credential") !== -1) return "That email or password does not match - try again.";
    if (code.indexOf("weak-password") !== -1) return "Pick a password with at least 6 characters.";
    if (code.indexOf("invalid-email") !== -1) return "That email does not look right - check it and try again.";
    if (code.indexOf("user-not-found") !== -1) return "No account for that email yet - create one first.";
    if (code.indexOf("popup-closed") !== -1) return "The Google window closed before signing in - try again.";
    if (code.indexOf("network-request-failed") !== -1) return "Sign-in could not reach the internet - check your connection and try again.";
    if (code.indexOf("too-many-requests") !== -1) return "Too many tries in a row - wait a minute and try again.";
    if (code.indexOf("unauthorized-domain") !== -1) return "This site is not approved for sign-in yet - tell the NyxSurvive team so they can fix it.";
    return (e && e.message) || "Something went wrong signing in - try again.";
  }
  function noteAuthError(e) {
    var msg = friendlyAuthError(e);
    showMsg($("nx-acct-error"), msg.toUpperCase(), "err");
    return msg;
  }

  /* ---------------- cloud sync ---------------- */
  function scheduleCloudSync() {
    if (!authUser || !firebaseConfigured()) return;
    if (cloudSyncTimer) clearTimeout(cloudSyncTimer);
    syncState = "pending";
    renderAccount();
    cloudSyncTimer = setTimeout(syncToCloud, 5000);
  }
  // The exact document body a client write sends. Keys are state,
  // vault, email, updatedAt - never plan (server-owned,
  // rules-enforced). The top-level email is the account's own
  // address, copied from the verified sign-in: the owner
  // portal's email lookup queries it (in bot mode the server
  // has no Auth user list to search instead).
  function syncPayload() {
    var vaultRaw = null;
    try { vaultRaw = localStorage.getItem(VAULT_KEY); } catch (e) { vaultRaw = null; }
    var ts = null;
    try {
      if (window.firebase && window.firebase.firestore && window.firebase.firestore.FieldValue) {
        ts = window.firebase.firestore.FieldValue.serverTimestamp();
      }
    } catch (e) { ts = null; }
    return { state: state, vault: vaultRaw, email: (AUTH_USER && AUTH_USER.email) || "", updatedAt: ts };
  }
  async function syncToCloud() {
    var user = authUser;
    if (!user) return;
    if (emailGateApplies()) { syncState = "local"; return; }
    syncState = "syncing";
    renderAccount();
    try {
      var fb = await ensureFirebase();
      if (!fb || authUser !== user) return;
      await nxDb().collection("users").doc(user.uid).set(syncPayload(), { merge: true });
      if (authUser !== user) return;
      lastSyncAt = Date.now();
      syncState = "synced";
    } catch (e) {
      // Offline or rules refusal: the local copy is the fallback
      // and the next save retries. Never lose data over a sync.
      syncState = "error";
    }
    renderAccount();
  }
  async function loadFromCloud() {
    var user = authUser;
    if (!user) return false;
    try {
      var fb = await ensureFirebase();
      if (!fb) return false;
      var snap = await nxDb().collection("users").doc(user.uid).get();
      // Signed out (or a different account signed in) while the
      // read was in flight: the snapshot belongs to the old
      // session, so none of it may be applied now.
      if (!authUser || authUser.uid !== user.uid) return false;
      if (!snap.exists) return false;
      var doc = snap.data() || {};
      if (!doc.state) return true; // doc exists (e.g. plan only) but holds no save yet
      var cloud = normalizeState(JSON.parse(JSON.stringify(doc.state)));
      if (!cloud) return true;
      var cloudSavedAt = typeof cloud._savedAt === "number" ? cloud._savedAt : 0;
      /* Recency: never silently discard local progress that is
       * newer than the cloud copy - the classic case is working
       * offline or signed out, then signing in. When this
       * device's save belongs to this account and is newer (2
       * minutes of grace for clock jitter), keep it and let the
       * caller push it up instead. */
      if (state.ownerUid === user.uid && (state._savedAt || 0) > cloudSavedAt + 120000) {
        return "local";
      }
      state = cloud;
      state.ownerUid = user.uid;
      state._savedAt = cloudSavedAt; // pin: loading must not make this device look newer
      /* The plan inside a synced state blob is only a display
       * cache. A server-proven tier cached on THIS device for
       * THIS account outranks whatever the blob carried in, and
       * refreshPlanStatus re-proves it right after. */
      var cached = readPlanCache(user.uid);
      if (cached) state.plan = cached;
      var cachedObj = readPlanCacheObj(user.uid);
      if (cachedObj && Array.isArray(cachedObj.addons)) state.addons = sanitizeAddons(cachedObj.addons);
      persistLocal();
      // A completed check-in in the cloud copy ends any first-run
      // overlay this fresh device opened before the sync landed.
      if (state.assessment && state.assessment.done) closeCheckin();
      /* The vault follows the same winner as the state. The
       * cloud value is ciphertext, copied byte for byte; it is
       * never decrypted here - Vault.load() just re-reads the
       * sealed blob from localStorage. */
      try {
        if (typeof doc.vault === "string" && doc.vault) {
          localStorage.setItem(VAULT_KEY, doc.vault);
          Vault.load();
        } else if ("vault" in doc && doc.vault === null) {
          localStorage.removeItem(VAULT_KEY);
          Vault.load();
        }
      } catch (e) { /* ignore */ }
      lastSyncAt = Date.now();
      syncState = "synced";
      return true;
    } catch (e) { return false; }
  }

  /* ---------------- plan proof ---------------- */
  function readPlanCacheObj(uid) {
    try {
      var raw = localStorage.getItem(PLAN_CACHE_KEY);
      if (!raw) return null;
      var c = JSON.parse(raw);
      if (c && c.uid === uid) return c;
    } catch (e) {}
    return null;
  }
  function readPlanCache(uid) {
    var c = readPlanCacheObj(uid);
    if (c && (c.tier === "operator" || c.tier === "lifetime")) return c.tier;
    return null;
  }
  function writePlanCache(uid, tier, addons) {
    try {
      var c = { uid: uid, tier: tier };
      // The add-on list rides the same cache entry (money build
      // D): written whenever the server proves it, read back on
      // a cloud load exactly like the tier. Older entries simply
      // have no addons key and read as none proven yet.
      if (Array.isArray(addons)) c.addons = sanitizeAddons(addons);
      else {
        var prev = readPlanCacheObj(uid);
        if (prev && Array.isArray(prev.addons)) c.addons = sanitizeAddons(prev.addons);
      }
      localStorage.setItem(PLAN_CACHE_KEY, JSON.stringify(c));
    } catch (e) {}
  }
  /* The tier is server-authoritative: only a successful
   * /api/subscription-status answer (or the locally derived
   * owner unlock) may move state.plan. OFFLINE RULE: a failed or
   * unreachable refresh changes NOTHING - the last proven tier,
   * cached in state.plan / PLAN_CACHE_KEY, stands on later boots
   * with no connection. A paying user is never downgraded just
   * because they are offline; only a proven "free" answer from
   * the server downgrades. */
  async function refreshPlanStatus() {
    var user = authUser;
    if (!user) return;
    if (emailGateApplies()) return;
    var session = authSession;
    if (isOwner()) {
      // Owner unlock is derived from the verified email at check
      // time; the server reports lifetime for owners too, but the
      // local derivation needs no round-trip.
      state.plan = "lifetime";
      writePlanCache(user.uid, "lifetime");
      persistLocal();
      renderSquad();
      return;
    }
    try {
      var token = await user.getIdToken();
      var res = await fetch(apiUrl("/api/subscription-status?uid=" + encodeURIComponent(user.uid)), {
        headers: { Authorization: "Bearer " + token }
      });
      if (!res.ok) return; // unconfigured / offline - keep the cached tier
      var out = await res.json();
      if (!authUser || authUser !== user || session !== authSession) return;
      var tier = (out.plan === "operator" || out.plan === "lifetime") ? out.plan : "free";
      state.plan = tier;
      // Add-ons are proven by the same answer (money build D).
      // A response without an addons array (an older deployment)
      // leaves the cached list standing, same offline rule as
      // the tier: only a proven answer moves it.
      if (Array.isArray(out.addons)) state.addons = sanitizeAddons(out.addons);
      writePlanCache(user.uid, tier, state.addons);
      persistLocal();
      // A refresh can land outside the sign-in render path
      // (e.g. returning from checkout): re-gate the Squad Sync
      // panel against the newly proven add-on list right away.
      renderSquad();
    } catch (e) { /* keep the cached tier */ }
  }

  /* ---------------- sign-in / sign-out ---------------- */
  async function handleSignedIn(user) {
    explicitSignOut = false;
    authUser = user;
    AUTH_USER = { email: user.email || "", emailVerified: user.emailVerified === true };
    var session = ++authSession;
    syncState = "syncing";
    renderAccount();
    if (emailGateApplies()) {
      /* Verification gate: no cloud touch at all until the
       * address is proven - no save claim, no sync, no plan
       * refresh. Local state stays exactly as it was, the app
       * keeps working on this device, and the verify wall in
       * the account panel carries the next step. The welcome
       * still settles: the user DID sign in. */
      syncState = "local";
      renderAccount();
      renderAll();
      welcomeSettled = true;
      markWelcomeSeen();
      closeWelcome();
      runDeferredCheckin();
      return;
    }
    /* Whose save is on this device? A save left behind by a
     * DIFFERENT account must never bleed into this one: set it
     * aside (state AND its vault blob) and start clean. An
     * unclaimed save (ownerUid null - never signed in here) is
     * claimed by this account instead; that claim is the
     * first-sign-in migration that keeps local progress. */
    if (state.ownerUid && state.ownerUid !== user.uid) {
      try {
        localStorage.setItem(STASH_KEY, JSON.stringify({
          uid: state.ownerUid, state: state, vault: localStorage.getItem(VAULT_KEY)
        }));
      } catch (e) {}
      state = blankState();
      state.ownerUid = user.uid;
      persistLocal();
      try { localStorage.removeItem(VAULT_KEY); } catch (e) {}
      Vault.load();
    } else if (!state.ownerUid) {
      state.ownerUid = user.uid;
      persistLocal();
    }
    var hadCloud = await loadFromCloud();
    if (session !== authSession || !authUser || authUser.uid !== user.uid) return;
    if (!hadCloud) {
      /* First sign-in with this account here: if an earlier
       * sign-in by someone else set THIS account's save aside,
       * restore it now; then push the local save up so nothing
       * the user already has is lost. */
      try {
        var stashRaw = localStorage.getItem(STASH_KEY);
        if (stashRaw) {
          var stash = JSON.parse(stashRaw);
          if (stash && stash.uid === user.uid && stash.state) {
            var restored = normalizeState(stash.state);
            if (restored) {
              state = restored;
              state.ownerUid = user.uid;
              persistLocal();
              if (typeof stash.vault === "string" && stash.vault) {
                try { localStorage.setItem(VAULT_KEY, stash.vault); } catch (e) {}
                Vault.load();
              }
              localStorage.removeItem(STASH_KEY);
            }
          }
        }
      } catch (e) {}
      await syncToCloud();
    } else if (hadCloud === "local") {
      /* The cloud doc exists but this device's save was newer
       * and was kept - push it up so the cloud catches up. */
      await syncToCloud();
    }
    if (session !== authSession || !authUser || authUser.uid !== user.uid) return;
    await refreshPlanStatus();
    if (session !== authSession || !authUser || authUser.uid !== user.uid) return;
    renderAccount();
    renderAll();
    // The welcome question settles with the sign-in: a signed-in
    // user never sees the welcome, it counts as seen from now
    // on (on the final, possibly cloud-loaded state), and the
    // deferred first-run check-in gets its turn. This also
    // closes a welcome that is open in front of a sign-in that
    // completes by any path, Google included.
    welcomeSettled = true;
    markWelcomeSeen();
    closeWelcome();
    runDeferredCheckin();
  }
  async function signUpWithEmail(email, password) {
    explicitSignOut = false;
    var fb = await ensureFirebase();
    if (!fb) throw new Error("Accounts are not switched on yet.");
    var cred = await nxAuth().createUserWithEmailAndPassword(email, password);
    /* Ask Firebase to verify the new email address. Since
     * 2026-11-17 the account features stay gated until the
     * address is verified (see emailGateApplies): a typo'd
     * address (gmail.con) otherwise sails through sign-up and
     * the account silently works with an email that does not
     * exist. A failed send must never fail the sign-up itself,
     * so errors are swallowed on purpose; the account panel's
     * Resend button is the recovery. */
    try {
      if (cred.user && typeof cred.user.sendEmailVerification === "function") {
        cred.user.sendEmailVerification().catch(function () {});
      }
    } catch (e) {}
    await handleSignedIn(cred.user);
    return cred.user;
  }
  async function signInWithEmail(email, password) {
    explicitSignOut = false;
    var fb = await ensureFirebase();
    if (!fb) throw new Error("Accounts are not switched on yet.");
    var cred = await nxAuth().signInWithEmailAndPassword(email, password);
    await handleSignedIn(cred.user);
    return cred.user;
  }
  /* Google sign-in. The account picker is forced (without it,
   * Google silently reuses the device's active Google account
   * and can land the user in the wrong NyxSurvive account).
   * Inside native WebView shells there is no popup window, so
   * Google uses a full-page redirect there - the result (user or
   * error) is picked up by getRedirectResult + the auth listener
   * in initAuth. On the web the popup is tried first; when the
   * browser kills it, fall back to the redirect instead of
   * dead-ending. Returns the user, or null when a redirect is
   * taking the page away. */
  async function signInWithGoogle() {
    explicitSignOut = false;
    var fb = await ensureFirebase();
    if (!fb) throw new Error("Accounts are not switched on yet.");
    var provider = new window.firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    if (IS_NATIVE_APP) {
      await nxAuth().signInWithRedirect(provider);
      return null;
    }
    try {
      var cred = await nxAuth().signInWithPopup(provider);
      await handleSignedIn(cred.user);
      return cred.user;
    } catch (e) {
      var code = (e && e.code) || "";
      if (code.indexOf("popup-blocked") !== -1 || code.indexOf("operation-not-supported") !== -1 ||
          code.indexOf("internal-error") !== -1 || code.indexOf("cancelled-popup") !== -1) {
        await nxAuth().signInWithRedirect(provider);
        return null;
      }
      throw e;
    }
  }
  async function signOutUser() {
    /* Clear the local signed-in state FIRST, before any network
     * call, and bump authSession so in-flight sign-in work cannot
     * resurrect the session. Unlike a gated app, NyxSurvive does
     * NOT wipe local data or redirect anywhere on sign-out: the
     * save on this device stays fully usable signed out.
     *
     * The cached tier does NOT stand through an explicit
     * sign-out: PLAN_CACHE_KEY is dropped and state.plan /
     * state.addons fall back to free, so the device reads as
     * fully signed out - a paid tier standing after sign-out
     * reads as "still signed in". The offline rule still
     * protects a SIGNED-IN user's cached tier across boots and
     * offline use (see refreshPlanStatus); an explicit sign-out
     * ends the session AND its cached tier on this device. The
     * server-side plan in Firestore is untouched and re-proves
     * on the next sign-in - state.plan here is only a display
     * cache. */
    explicitSignOut = true;
    authSession++;
    authUser = null;
    AUTH_USER = null;
    try { localStorage.removeItem(PLAN_CACHE_KEY); } catch (e) {}
    state.plan = "free";
    state.addons = [];
    persistLocal();
    if (cloudSyncTimer) { clearTimeout(cloudSyncTimer); cloudSyncTimer = null; }
    syncState = "local";
    renderAccount();
    renderAll();
    try {
      var fb = await ensureFirebase();
      if (fb && nxAuth()) {
        // Awaited directly: the compat SDK clears its local
        // persistence before resolving, no network needed - a
        // timeout race here could leave the persisted session
        // alive to resurrect the sign-in on the next boot.
        await nxAuth().signOut();
      }
    } catch (e) { /* session may already be gone - local state is cleared regardless */ }
    authUser = null;
    AUTH_USER = null;
    renderAccount();
    renderAll();
  }

  /* ---------------- checkout ---------------- */
  /* planKey: monthly | yearly | lifetime | founding for plans,
   * or an add-on key (qr-sync, money build D; map-pack-us and
   * map-pack-state, money build E) - the exact keys
   * api/checkout.js prices server-side. The client never names
   * an amount, and every key rides this same flow, iOS refusal
   * and native hand-off included. extra carries the one
   * server-validated parameter a SKU may need (the state code
   * for map-pack-state) and nothing else. */
  async function startCheckout(planKey, extra) {
    if (IS_IOS_APP) {
      // App Store Guideline 3.1.1: no selling inside the iPhone
      // app and no route out of the app to a sale. Refuse with a
      // neutral message that points nowhere.
      showView("system");
      showMsg($("nx-plan-msg"), "NOT AVAILABLE IN THIS VERSION.", "");
      return;
    }
    if (IS_NATIVE_APP) {
      // Store policy posture (mirrors the approved Munchling
      // setup): the tier is sold on the website, never inside the
      // app. Open the pricing section in the system browser and
      // say plainly that the tier attaches to the account - sign
      // in there with the same email and it unlocks in the app
      // after sign-in. Web behavior below is unchanged.
      showView("system");
      showMsg($("nx-plan-msg"), "OPERATOR IS SOLD ON NYXSURVIVE.COM - IT ATTACHES TO YOUR ACCOUNT, SO SIGN IN THERE WITH THE SAME EMAIL AND IT UNLOCKS HERE TOO.", "");
      openExternal("https://www.nyxsurvive.com/#pricing");
      return;
    }
    if (!firebaseConfigured()) {
      // Accounts are not switched on for this deployment yet:
      // the landing pricing section is the fallback, exactly
      // what the old "See Plans" link did.
      window.location.href = "index.html#pricing";
      return;
    }
    if (!authUser) {
      showView("system");
      showMsg($("nx-acct-note"), "SIGN IN FIRST - YOUR TIER ATTACHES TO YOUR ACCOUNT.", "err");
      var panel = $("nx-account-panel");
      if (panel && panel.scrollIntoView) panel.scrollIntoView();
      return;
    }
    if (emailGateApplies()) {
      showView("system");
      showMsg($("nx-plan-msg"), "VERIFY YOUR EMAIL FIRST - YOUR TIER ATTACHES TO YOUR ACCOUNT. THE ACCOUNT PANEL ABOVE HAS THE RESEND AND CHECK BUTTONS.", "err");
      var apanel = $("nx-account-panel");
      if (apanel && apanel.scrollIntoView) apanel.scrollIntoView();
      return;
    }
    var msg = $("nx-plan-msg");
    try {
      var token = await authUser.getIdToken();
      var res = await fetch(apiUrl("/api/checkout"), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify(Object.assign({ plan: planKey, uid: authUser.uid }, extra || {}))
      });
      var out = await res.json().catch(function () { return {}; });
      if (!res.ok) { showMsg(msg, String(out.error || "Checkout did not start - try again in a bit.").toUpperCase(), "err"); return; }
      if (out.url) { window.location.href = out.url; return; }
      showMsg(msg, "CHECKOUT DID NOT RETURN A LINK - TRY AGAIN IN A BIT.", "err");
    } catch (e) {
      showMsg(msg, "CHECKOUT DID NOT START - CHECK YOUR CONNECTION AND TRY AGAIN.", "err");
    }
  }

  /* ---------------- welcome screen ----------------
     The in-app front door (2026-11-16): a signed-out first run
     lands on a welcome with SIGN IN up front instead of dropping
     straight into Command with sign-in buried in the System tab
     - the same direction the website landing page took, applied
     inside the app itself (and the standing rule from now on:
     sign in / sign up easy to see at the top, on every surface).
     Accounts stay OPTIONAL, as designed: Continue dismisses the
     welcome and the app works fully signed out.
     The decision is made ONCE, when the first auth state settles:
       - a signed-in boot never shows it and counts it as seen
         (settled inside handleSignedIn, on the final state);
       - a ?join= visit routes to the account panel itself, so
         the welcome never stacks on top of it;
       - a local-only deployment (no accounts backend) has
         nothing to sign in to, so it never shows;
       - the first-run check-in auto-open is DEFERRED until the
         welcome question settles, so the welcome always comes
         first: it opens after Continue, or after a sign-in
         completes. Backing out of the account panel does not
         bring the welcome (or the check-in) back - the header
         chip and the Command check-in card are the standing
         paths from there. */
  var welcomeOpen = false;
  var welcomeSettled = false;
  var checkinPending = false; // deferred first-run check-in auto-open
  var joinVisit = false;

  function welcomeShouldShow() {
    if (!firebaseConfigured()) return false;
    if (state.welcomeSeen) return false;
    if (joinVisit) return false;
    if (IS_NATIVE_APP || window.Capacitor) return true; // installed app: every fresh install gets a front door
    // Web: a genuine first run only - no earlier save on this
    // device and the readiness check-in never completed.
    return !bootHadSave && !(state.assessment && state.assessment.done);
  }
  function showWelcome() {
    var w = $("nx-welcome");
    if (!w) return;
    w.style.display = "";
    welcomeOpen = true;
  }
  function closeWelcome() {
    var w = $("nx-welcome");
    if (w) w.style.display = "none";
    welcomeOpen = false;
  }
  function markWelcomeSeen() {
    if (!state.welcomeSeen) { state.welcomeSeen = true; saveState(); }
  }
  function runDeferredCheckin() {
    if (!checkinPending) return;
    checkinPending = false;
    maybeOpenCheckin();
  }
  /* Signed-out settle point: called on the first auth-listener
   * fire without a user, and when there is no auth backend to
   * wait for. The signed-in path settles in handleSignedIn. */
  function settleWelcome() {
    if (welcomeSettled) return;
    welcomeSettled = true;
    if (authUser) { closeWelcome(); runDeferredCheckin(); return; }
    if (welcomeShouldShow()) { showWelcome(); return; }
    runDeferredCheckin();
  }
  /* The one route to the account panel, shared by the landing
   * deep link, the welcome buttons and the header chip: land on
   * System with the panel scrolled into view, in the requested
   * mode (signin is the panel default). */
  function goToAccountPanel(mode) {
    if (mode) setAccountMode(mode);
    showView("system");
    var scrollPanel = function () {
      var panel = $("nx-account-panel");
      if (panel && panel.scrollIntoView) panel.scrollIntoView({ block: "start" });
    };
    if (window.requestAnimationFrame) requestAnimationFrame(scrollPanel);
    setTimeout(scrollPanel, 500); // again once any overlay has lifted
  }
  function bindWelcome() {
    var signin = $("nx-welcome-signin"), signup = $("nx-welcome-signup"), cont = $("nx-welcome-continue");
    if (signin) signin.addEventListener("click", function () {
      markWelcomeSeen(); closeWelcome();
      // checkinPending is left standing on purpose: if the
      // sign-in completes, handleSignedIn runs the deferred
      // check-in on the final state; if the user backs out,
      // nothing re-opens it this visit.
      goToAccountPanel("signin");
    });
    if (signup) signup.addEventListener("click", function () {
      markWelcomeSeen(); closeWelcome();
      goToAccountPanel("signup");
    });
    if (cont) cont.addEventListener("click", function () {
      markWelcomeSeen(); closeWelcome();
      runDeferredCheckin();
    });
    var chip = $("nx-acct-chip");
    if (chip) chip.addEventListener("click", function () { goToAccountPanel(); });
  }

  /* ---------------- account panel ---------------- */
  function syncStatusText() {
    if (!authUser) return "LOCAL ONLY";
    if (syncState === "synced" && lastSyncAt) {
      return "SYNCED " + new Date(lastSyncAt).toLocaleTimeString("en-GB", { hour12: false });
    }
    if (syncState === "error") return "OFFLINE - LOCAL ONLY, RETRIES ON NEXT SAVE";
    if (syncState === "pending") return "SYNC PENDING";
    return "SYNCING";
  }
  /* Header chip label for a signed-in non-owner: the email,
   * truncated hard so the masthead never wraps on a phone, with
   * the tier appended when the account holds one. Owners get
   * the standing OWNER - LIFETIME label instead. */
  function accountChipLabel() {
    var em = (authUser && authUser.email) || "ACCOUNT";
    if (em.length > 18) em = em.slice(0, 17) + "...";
    var tier = planTier();
    return tier === "free" ? em : em + " - " + tier.toUpperCase();
  }
  function renderAccount() {
    var local = $("nx-acct-local"), out = $("nx-acct-out"), inBox = $("nx-acct-in");
    if (!local || !out || !inBox) return;
    var configured = firebaseConfigured();
    local.style.display = configured ? "none" : "";
    out.style.display = (configured && !authUser) ? "" : "none";
    inBox.style.display = (configured && authUser) ? "" : "none";
    if (configured && authUser) {
      var em = $("nx-acct-email-line");
      if (em) em.innerHTML = "ACCOUNT: <b>" + esc(authUser.email || "") + "</b>";
      var pl = $("nx-acct-plan-line");
      if (pl) pl.innerHTML = "PLAN: <b>" + esc(isOwner() ? "OWNER - LIFETIME" : planTier().toUpperCase()) + "</b>";
      var sy = $("nx-acct-sync-line");
      if (sy) sy.innerHTML = "SYNC: <b>" + esc(syncStatusText()) + "</b>";
      var ownerBox = $("nx-acct-owner");
      if (ownerBox) ownerBox.style.display = isOwner() ? "" : "none";
      var verifyBox = $("nx-acct-verify");
      if (verifyBox) {
        var gated = emailGateApplies();
        verifyBox.style.display = gated ? "" : "none";
        if (gated) {
          var ve = $("nx-acct-verify-email");
          if (ve) ve.textContent = authUser.email || "";
        }
      }
    }
    // The header chip renders from here so it can never drift
    // out of sync with the panel: accent SIGN IN while signed
    // out, the account identity while signed in.
    var chip = $("nx-acct-chip");
    if (chip) {
      if (authUser) {
        chip.textContent = isOwner() ? "OWNER - LIFETIME" : accountChipLabel();
        chip.classList.remove("nx-chip-accent");
        chip.title = (authUser.email || "") + " - " + (isOwner() ? "OWNER - LIFETIME" : planTier().toUpperCase());
      } else {
        chip.textContent = "SIGN IN";
        chip.classList.add("nx-chip-accent");
        chip.title = "Sign in or create an account";
      }
    }
  }
  function bindAccount() {
    // The owner portal stays web-only (admin.html is not part of
    // the bundled app), so in a native shell the portal link
    // points at the live portal instead of the missing page.
    if (IS_NATIVE_APP) {
      var portalLinks = document.querySelectorAll('a[href="admin.html"]');
      for (var pi = 0; pi < portalLinks.length; pi++) {
        portalLinks[pi].href = "https://www.nyxsurvive.com/admin.html";
      }
    }
    // Upsell + tier-picker buttons are re-rendered by innerHTML
    // all over the app, so clicks are delegated at the document.
    document.addEventListener("click", function (ev) {
      var go = ev.target.closest(".nx-go-operator");
      if (go) {
        if (IS_IOS_APP) {
          // The buttons themselves are hidden on iOS; anything
          // that still lands here gets the same neutral refusal
          // as every other checkout entry point.
          startCheckout("monthly");
          return;
        }
        if (authUser) {
          // Signed in: land on the tier picker in System.
          showView("system");
          var cta = $("nx-plan-cta");
          if (cta && cta.scrollIntoView) cta.scrollIntoView();
        } else {
          // Signed out routes inside startCheckout: unconfigured
          // deployments go to the pricing page; configured ones
          // land on the account panel with the sign-in note.
          startCheckout("monthly");
        }
        return;
      }
      var buy = ev.target.closest("[data-checkout-plan]");
      if (buy) startCheckout(buy.getAttribute("data-checkout-plan"));
    });
    var signinBtn = $("nx-acct-signin");
    if (signinBtn) signinBtn.addEventListener("click", async function () {
      var email = ($("nx-acct-email").value || "").trim();
      var pw = $("nx-acct-password").value || "";
      if (!email || !pw) { showMsg($("nx-acct-error"), "ENTER YOUR EMAIL AND PASSWORD.", "err"); return; }
      showMsg($("nx-acct-error"), "");
      try { await signInWithEmail(email, pw); }
      catch (e) { noteAuthError(e); }
    });
    var signupBtn = $("nx-acct-signup");
    if (signupBtn) signupBtn.addEventListener("click", async function () {
      var email = ($("nx-acct-email").value || "").trim();
      var pw = $("nx-acct-password").value || "";
      if (!email || !pw) { showMsg($("nx-acct-error"), "ENTER YOUR EMAIL AND A PASSWORD.", "err"); return; }
      if (pw.length < 6) { showMsg($("nx-acct-error"), "PICK A PASSWORD WITH AT LEAST 6 CHARACTERS.", "err"); return; }
      showMsg($("nx-acct-error"), "");
      try { await signUpWithEmail(email, pw); }
      catch (e) { noteAuthError(e); }
    });
    var googleBtn = $("nx-acct-google");
    if (googleBtn) googleBtn.addEventListener("click", async function () {
      showMsg($("nx-acct-error"), "");
      try { await signInWithGoogle(); }
      catch (e) { noteAuthError(e); }
    });
    var pwToggleBtn = $("nx-acct-pw-toggle");
    if (pwToggleBtn) pwToggleBtn.addEventListener("click", function () {
      var pwInput = $("nx-acct-password");
      if (!pwInput) return;
      var show = pwInput.type === "password";
      pwInput.type = show ? "text" : "password";
      pwToggleBtn.textContent = show ? "HIDE" : "SHOW";
    });
    var forgotBtn = $("nx-acct-forgot");
    if (forgotBtn) forgotBtn.addEventListener("click", async function () {
      var email = ($("nx-acct-email").value || "").trim();
      if (!email) { showMsg($("nx-acct-error"), "ENTER YOUR EMAIL ABOVE FIRST, THEN TAP FORGOT PASSWORD.", "err"); return; }
      showMsg($("nx-acct-error"), "");
      try {
        var fb = await ensureFirebase();
        if (!fb || !nxAuth()) throw new Error("Accounts are not switched on yet.");
        await nxAuth().sendPasswordResetEmail(email);
        showMsg($("nx-acct-note"), "PASSWORD RESET EMAIL SENT TO " + email + " - CHECK YOUR INBOX TO SET A NEW ONE.", "good");
      } catch (e) { noteAuthError(e); }
    });
    var signoutBtn = $("nx-acct-signout");
    if (signoutBtn) signoutBtn.addEventListener("click", function () { signOutUser(); });
    var verifyResendBtn = $("nx-acct-verify-resend");
    if (verifyResendBtn) verifyResendBtn.addEventListener("click", async function () {
      if (!authUser) return;
      try {
        await authUser.sendEmailVerification();
        showMsg($("nx-acct-verify-msg"), "VERIFICATION EMAIL SENT TO " + (authUser.email || "") + " - OPEN THE LINK IN IT, THEN TAP CHECK AGAIN.", "good");
      } catch (e) {
        showMsg($("nx-acct-verify-msg"), "THAT SEND DID NOT GO OUT - WAIT A MINUTE AND TRY AGAIN.", "err");
      }
    });
    var verifyCheckBtn = $("nx-acct-verify-check");
    if (verifyCheckBtn) verifyCheckBtn.addEventListener("click", async function () {
      if (!authUser) return;
      try { await authUser.reload(); } catch (e) {}
      if (authUser && authUser.emailVerified) {
        // The gate lifts inside handleSignedIn, which re-reads
        // emailVerified and runs the full sign-in flow (cloud
        // sync + plan refresh) that the gate held back.
        handleSignedIn(authUser);
      } else {
        showMsg($("nx-acct-verify-msg"), "NOT VERIFIED YET - THE LINK IN THE EMAIL HAS TO BE OPENED FIRST. CHECK THE SPAM FOLDER TOO.", "err");
      }
    });
  }
  function initAuth() {
    renderAccount();
    ensureFirebase().then(function (fb) {
      renderAccount();
      if (!fb || !nxAuth()) { settleWelcome(); return; } // local-only deployment - no auth state to wait for
      // A Google redirect sign-in (native shells) lands back
      // here: surface its error instead of letting it vanish.
      try {
        var rr = nxAuth().getRedirectResult();
        if (rr && typeof rr.catch === "function") rr.catch(function (e) { noteAuthError(e); });
      } catch (e) { /* no redirect in flight */ }
      nxAuth().onAuthStateChanged(function (user) {
        if (user) {
          if (explicitSignOut) {
            // The user explicitly signed out but a persisted
            // session still fired: do NOT resurrect the sign-in.
            // Sign it straight back out and keep the signed-out
            // UI standing.
            try { nxAuth().signOut(); } catch (e) {}
            renderAccount();
            renderPlan();
            return;
          }
          if (!authUser || authUser.uid !== user.uid) {
            handleSignedIn(user);
          } else {
            AUTH_USER = { email: user.email || "", emailVerified: user.emailVerified === true };
            renderAccount();
            settleWelcome();
          }
        } else {
          if (authUser) {
            authSession++;
            authUser = null;
            AUTH_USER = null;
            syncState = "local";
          }
          renderAccount();
          renderPlan();
          settleWelcome();
        }
      });
    }).catch(function () { renderAccount(); settleWelcome(); });
  }

  /* ---------------- Phase 3B: themes ----------------
     Eleven structural variants keyed off data-theme on <html>
     (stamped pre-paint by the inline script in app.html, then
     owned here). The landing page and admin page never set the
     attribute, so they always render Command. */
  var THEMES = [
    { id: "command", name: "Command", desc: "Gunmetal terminal, hazard orange, faint scanlines. Standard issue." },
    { id: "nightvision", name: "Night Vision", desc: "Phosphor green through the NVG lens - glow, vignette, heavy scanlines." },
    { id: "desert", name: "Desert Ops", desc: "Sun-bleached sand, stencil type, dust grain. Built for glare." },
    { id: "whiteout", name: "Whiteout", desc: "Arctic light, flat panels. Maximum readability in full daylight." },
    { id: "blackout", name: "Blackout", desc: "True black, dim red, effects minimized. Maximum battery, minimum signature." },
    { id: "brassworks", name: "Brassworks", desc: "Steampunk brass and copper - cogs, pipe trim, amber gauges. The machine room." },
    { id: "neonglass", name: "Neon Glass", desc: "Frosted glass over a dark grid, edges lit cyan and magenta. Night city." },
    { id: "fullmetal", name: "Full Metal", desc: "Raw machined steel, heavy bevels, smoked glass. Nothing painted - everything milled." },
    { id: "woodland", name: "Woodland", desc: "Camo pattern under olive drab, khaki stencil type. Issued for the treeline." },
    { id: "bunker", name: "Bunker", desc: "Poured concrete, hazard stripes, safety yellow. Built to take a hit." },
    { id: "schematic", name: "Schematic", desc: "Blueprint drafting plate - white line work on engineering blue. Every dimension marked." }
  ];
  var THEME_IDS = THEMES.map(function (t) { return t.id; });
  var THEME_META = { command: "#0a0b0c", nightvision: "#020503", desert: "#e6dbc2", whiteout: "#eef1f4", blackout: "#000000", brassworks: "#171008", neonglass: "#04060f", fullmetal: "#0b0c0d", woodland: "#232a1e", bunker: "#17181a", schematic: "#0d2c4c" };
  function currentTheme() {
    var t = state.settings && state.settings.theme;
    return THEME_IDS.indexOf(t) !== -1 ? t : "command";
  }
  function applyTheme() {
    var t = currentTheme();
    document.documentElement.setAttribute("data-theme", t);
    var meta = document.querySelector("meta[name=\"theme-color\"]");
    if (meta) meta.setAttribute("content", THEME_META[t]);
    applyFxClass();
  }
  function setTheme(id) {
    if (THEME_IDS.indexOf(id) === -1) return;
    state.settings.theme = id;
    saveState();
    applyTheme();
    renderSettings();
    renderGridDown();
  }
  function renderThemePicker() {
    var wrap = $("nx-theme-picker");
    if (!wrap) return;
    var cur = currentTheme();
    wrap.innerHTML = THEMES.map(function (t) {
      return "<button type=\"button\" class=\"nx-theme-btn" + (t.id === cur ? " nx-on" : "") + "\" data-theme-pick=\"" + t.id + "\">" +
        "<span class=\"nx-theme-name\">" + esc(t.name) + "</span>" +
        "<span class=\"nx-theme-desc\">" + esc(t.desc) + "</span></button>";
    }).join("");
  }

  /* ---------------- Phase 3B: terminal sound pack ----------------
     Pure Web Audio synthesis - no audio files, nothing to load
     offline. Volumes stay low; every call is wrapped so a device
     without audio (or a suspended context) just stays silent.
     The pack answers to two switches: its own Terminal Sounds
     toggle, and the Terminal Effects toggle as master. */
  var audioCtx = null;
  function soundsOn() { return state.settings.effects !== false && state.settings.sounds !== false; }
  function ensureAudio() {
    try {
      if (!audioCtx) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        audioCtx = new AC();
      }
      if (audioCtx.state === "suspended") audioCtx.resume();
      return audioCtx;
    } catch (e) { return null; }
  }
  function tone(freq, durSec, type, vol, delaySec, endFreq) {
    var ctx = ensureAudio();
    if (!ctx) return;
    try {
      var t0 = ctx.currentTime + (delaySec || 0);
      var osc = ctx.createOscillator();
      var g = ctx.createGain();
      osc.type = type || "square";
      osc.frequency.setValueAtTime(freq, t0);
      if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, t0 + durSec);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol || 0.04, t0 + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + durSec);
      osc.connect(g);
      g.connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + durSec + 0.02);
    } catch (e) { /* audio is garnish, never a failure */ }
  }
  function sfxClick() { if (!soundsOn()) return; tone(1900, 0.03, "square", 0.022, 0, 900); }
  function sfxConfirm() { if (!soundsOn()) return; tone(880, 0.07, "sine", 0.045, 0); tone(1318, 0.09, "sine", 0.04, 0.07); }
  function sfxSting() { if (!soundsOn()) return; tone(196, 0.16, "sawtooth", 0.032, 0); tone(147, 0.22, "sawtooth", 0.032, 0.16); }
  function sfxSquelch() {
    if (!soundsOn()) return;
    var ctx = ensureAudio();
    if (!ctx) return;
    try {
      var dur = 0.13;
      var buf = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * dur)), ctx.sampleRate);
      var data = buf.getChannelData(0);
      for (var i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
      var src = ctx.createBufferSource();
      src.buffer = buf;
      var f = ctx.createBiquadFilter();
      f.type = "bandpass"; f.frequency.value = 1300; f.Q.value = 0.8;
      var g = ctx.createGain();
      g.gain.value = 0.05;
      src.connect(f); f.connect(g); g.connect(ctx.destination);
      src.start();
      tone(1500, 0.03, "square", 0.018, dur); // squelch tail click
    } catch (e) { /* garnish */ }
  }

  /* ---------------- Phase 3B: SITREP ----------------
     A shareable situation report. Numbers and status only:
     no coordinates, no vault contents, no crew notes - safe to
     drop into any group chat. */
  var MONTHS_SHORT = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  function fmtDtg(d) {
    function p2(n) { return String(n).padStart(2, "0"); }
    return d.getDate() + " " + MONTHS_SHORT[d.getMonth()] + " " + d.getFullYear() +
      " // " + p2(d.getHours()) + ":" + p2(d.getMinutes()) + " LOCAL";
  }
  function buildSitrep() {
    var d = daysReady();
    var lines = [];
    lines.push("NYXSURVIVE SITREP // " + callSign());
    lines.push("DTG: " + fmtDtg(new Date()));
    lines.push("HOUSEHOLD: " + d.household + " PERSON" + (d.household > 1 ? "S" : "") +
      (d.pets ? " + " + d.pets + " PET" + (d.pets > 1 ? "S" : "") : ""));
    lines.push("DAYS READY: " + (d.headline == null ? "--" : fmt(d.headline, 1)) +
      " // WATER " + (d.waterDays == null ? "--" : fmt(d.waterDays, 1) + " DAYS") +
      " // FOOD " + (d.foodDays == null ? "--" : fmt(d.foodDays, 1) + " DAYS"));
    if (d.gap) lines.push("GAP: " + d.gap);
    var inc = state.incident;
    lines.push(inc
      ? "INCIDENT: ACTIVE - " + String(inc.name || "UNNAMED").toUpperCase() + " (" + String(inc.type || "Other").toUpperCase() + ")"
      : "INCIDENT: NONE ACTIVE");
    var exps = allExpiries();
    if (exps.length) {
      var r = exps[0];
      lines.push("NEXT ROTATION: " + String(r.name).toUpperCase() + " - EXP " + r.expiry +
        " (" + (r.days < 0 ? Math.abs(r.days) + " DAYS PAST" : r.days + " DAYS LEFT") + ")");
    } else {
      lines.push("NEXT ROTATION: NOTHING TRACKED");
    }
    if (alertsCache && alertsCache.alerts) {
      var warns = alertsCache.alerts.filter(function (a) { return alertKind(a) === "WARNING"; }).length;
      lines.push("ALERTS: " + alertsCache.alerts.length + " ACTIVE // " + warns + " WARNING" + (warns === 1 ? "" : "S") +
        (alertsLive ? "" : " // CACHED " + fmtTime(alertsCache.fetchedAt)));
    } else {
      lines.push("ALERTS: NO DATA - NOT FETCHED YET");
    }
    return lines.join("\n");
  }
  function openSitrep() {
    var p = $("nx-sitrep-panel");
    if (!p) return;
    $("nx-sitrep-text").textContent = buildSitrep();
    showMsg($("nx-sitrep-msg"), "");
    p.style.display = "";
    if (p.scrollIntoView) p.scrollIntoView({ block: "nearest" });
  }
  async function shareSitrep() {
    var msg = buildSitrep();
    if (navigator.share) {
      try {
        await navigator.share({ title: "NyxSurvive Sitrep", text: msg });
        showMsg($("nx-sitrep-msg"), "SITREP HANDED TO THE SHARE SHEET.", "good");
      } catch (e) {
        showMsg($("nx-sitrep-msg"), "SHARE CANCELLED - NOTHING SENT.", "err");
      }
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(msg);
        showMsg($("nx-sitrep-msg"), "SITREP COPIED TO CLIPBOARD - PASTE IT INTO THE CREW CHANNEL.", "good");
      } catch (e) {
        showMsg($("nx-sitrep-msg"), "CLIPBOARD BLOCKED. THE REPORT ABOVE IS SELECTABLE - COPY IT MANUALLY.", "err");
      }
      return;
    }
    showMsg($("nx-sitrep-msg"), "NO SHARE ROUTE ON THIS DEVICE - COPY THE REPORT ABOVE MANUALLY.", "err");
  }
  /* The PNG card is a document, not a screen: it always renders
     in the Command palette so it reads the same in every chat
     it lands in, whatever theme the sender runs. */
  function sitrepPngDataUrl() {
    var d = daysReady();
    var cv = document.createElement("canvas");
    cv.width = 1200; cv.height = 630;
    var c = cv.getContext("2d");
    c.fillStyle = "#0a0b0c"; c.fillRect(0, 0, 1200, 630);
    c.fillStyle = "#ff7300"; c.fillRect(0, 0, 1200, 12);
    c.strokeStyle = "#3a3f48"; c.lineWidth = 3; c.strokeRect(20, 20, 1160, 590);
    c.fillStyle = "#d8dbe0";
    c.font = "700 46px Rajdhani, 'Arial Narrow', sans-serif";
    c.fillText("NYXSURVIVE SITREP", 58, 100);
    c.font = "17px 'JetBrains Mono', monospace";
    c.fillStyle = "#8b9099";
    c.fillText(fmtDtg(new Date()) + "  //  " + callSign() + "  //  HOUSEHOLD " + d.household, 58, 134);
    c.fillStyle = "#d8dbe0";
    c.font = "700 200px 'JetBrains Mono', monospace";
    c.fillText(d.headline == null ? "--" : fmt(d.headline, 1), 54, 348);
    c.font = "700 32px Rajdhani, 'Arial Narrow', sans-serif";
    c.fillStyle = "#ff7300";
    c.fillText("DAYS READY", 60, 392);
    c.font = "24px 'JetBrains Mono', monospace";
    c.fillStyle = "#d8dbe0";
    var rows = [
      "WATER  " + (d.waterDays == null ? "--" : fmt(d.waterDays, 1) + " DAYS") + "     FOOD  " + (d.foodDays == null ? "--" : fmt(d.foodDays, 1) + " DAYS"),
      d.gap ? "GAP  " + d.gap : "GAP  -",
      state.incident ? "INCIDENT  ACTIVE - " + String(state.incident.name || "UNNAMED").toUpperCase() : "INCIDENT  NONE ACTIVE"
    ];
    rows.forEach(function (line, i) { c.fillText(line, 58, 452 + i * 38); });
    c.font = "16px 'JetBrains Mono', monospace";
    c.fillStyle = "#5c6169";
    c.fillText("NYXSURVIVE(TM) // (C) 2026 NYX COLLECTIVE LLC // NYXSURVIVE.COM", 58, 580);
    return cv.toDataURL("image/png");
  }
  function downloadSitrepPng() {
    var url;
    try { url = sitrepPngDataUrl(); }
    catch (e) { showMsg($("nx-sitrep-msg"), "CARD GENERATION FAILED ON THIS DEVICE.", "err"); return; }
    function save() {
      var a = document.createElement("a");
      a.href = url;
      a.download = "nyxsurvive-sitrep.png";
      document.body.appendChild(a);
      a.click();
      a.remove();
      showMsg($("nx-sitrep-msg"), "SITREP CARD DOWNLOADED.", "good");
    }
    try {
      if (navigator.canShare && navigator.share) {
        fetch(url).then(function (r) { return r.blob(); }).then(function (blob) {
          var file = new File([blob], "nyxsurvive-sitrep.png", { type: "image/png" });
          if (navigator.canShare({ files: [file] })) {
            navigator.share({ files: [file], title: "NyxSurvive Sitrep" }).then(function () {
              showMsg($("nx-sitrep-msg"), "SITREP CARD SHARED.", "good");
            }, save);
          } else save();
        }).catch(save);
      } else save();
    } catch (e) { save(); }
  }

  /* ---------------- Phase 3B: grid-down mode ----------------
     Operator tier (a $9.99 add-on for free accounts, included
     in Operator). A stripped essentials screen for the night
     the grid actually goes: the number, the rally name, the
     battery, a light. Nothing else competes for power. */
  var batteryObj = null;
  function renderBattery() {
    var el = $("nx-grid-batt");
    if (!el) return;
    if (batteryObj) {
      el.innerHTML = "BATTERY: <b>" + Math.round(batteryObj.level * 100) + "%</b>" + (batteryObj.charging ? " // CHARGING" : "");
    } else {
      el.textContent = "BATTERY: --";
    }
  }
  function ensureBattery() {
    try {
      if (batteryObj || !navigator.getBattery) return;
      navigator.getBattery().then(function (b) {
        batteryObj = b;
        b.addEventListener("levelchange", renderBattery);
        b.addEventListener("chargingchange", renderBattery);
        renderBattery();
      }).catch(function () { /* no battery API - the blank stays honest */ });
    } catch (e) { /* honest blank */ }
  }
  function renderGridDown() {
    var daysEl = $("nx-grid-days");
    if (!daysEl) return;
    var d = daysReady();
    daysEl.textContent = d.headline == null ? "--" : fmt(d.headline, 1);
    $("nx-grid-breakdown").innerHTML =
      "WATER <b>" + (d.waterDays == null ? "--" : fmt(d.waterDays, 1) + " DAYS") + "</b>" +
      " // FOOD <b>" + (d.foodDays == null ? "--" : fmt(d.foodDays, 1) + " DAYS") + "</b>" +
      " // HOUSEHOLD <b>" + d.household + "</b>" +
      " // CASH <b>$" + fmt(cashTotal(), 0) + "</b>";
    var cashNote = $("nx-grid-cash-note");
    if (cashNote) {
      var ct = cashTotal();
      cashNote.innerHTML = ct > 0
        ? "WHEN THE GRID IS DOWN, CARD READERS AND ATMS ARE DOWN WITH IT. CASH ON HAND: <b>$" + fmt(ct, 0) + "</b> - THE ONLY MONEY THAT STILL MOVES."
        : "WHEN THE GRID IS DOWN, CARD READERS AND ATMS ARE DOWN WITH IT. CASH ON HAND IS THE ONLY MONEY THAT STILL MOVES - LOG YOURS IN ROTATE.";
    }
    var rally = primaryRally();
    $("nx-grid-rally").innerHTML = "RALLY: <b>" + (rally
      ? esc(String(rally.title).toUpperCase())
      : (Vault.blob ? "VAULT SEALED" : "NOT SET")) + "</b>";
    var bo = $("nx-grid-blackout-row");
    if (bo) bo.style.display = currentTheme() === "blackout" ? "none" : "";
    renderBattery();
  }
  function enterGridDown() {
    if (!isOperator()) {
      var lock = $("nx-grid-lock");
      if (lock) {
        lock.innerHTML = upsellHtml("GRID-DOWN MODE");
        if (lock.scrollIntoView) lock.scrollIntoView({ block: "nearest" });
      }
      return;
    }
    var lock2 = $("nx-grid-lock");
    if (lock2) lock2.innerHTML = "";
    ensureBattery();
    renderGridDown();
    showView("grid");
  }
  /* SOS strobe: a slow 600ms toggle - bright enough to signal,
     far under the flash rates that endanger photosensitive
     people. Reduced-motion devices get a steady light instead. */
  var sosTimer = null;
  function startSos() {
    var el = $("nx-sos");
    if (!el) return;
    el.classList.add("nx-on");
    el.style.background = "#ffffff";
    var lab = $("nx-sos-label");
    if (lab) lab.style.color = "#0a0b0c";
    if (REDUCED_MOTION) return; // steady light - no flashing at all
    var lit = true;
    if (sosTimer) clearInterval(sosTimer);
    sosTimer = setInterval(function () {
      lit = !lit;
      el.style.background = lit ? "#ffffff" : "#000000";
      var l2 = $("nx-sos-label");
      if (l2) l2.style.color = lit ? "#0a0b0c" : "#ffffff";
    }, 600);
  }
  function stopSos() {
    var el = $("nx-sos");
    if (el) el.classList.remove("nx-on");
    if (sosTimer) { clearInterval(sosTimer); sosTimer = null; }
  }

  /* ---------------- Phase 3B: evac drill ----------------
     One drill, free: the taste of the Drill Pack. Runtime lives
     in memory (a drill is an event, not data); only the best
     completed run persists, in state.drillBest. */
  var DRILL_STEPS = [
    "Grab bug-out bags",
    "Water staged in the vehicle",
    "Documents folder in hand",
    "Pet carrier and pet loaded",
    "Vehicle keys and wallet",
    "Rally point confirmed with crew"
  ];
  var DRILL_SECONDS = 15 * 60;
  var drill = { active: false, startedAt: 0, checks: {}, timer: null };
  function fmtClock(totalSec) {
    var s = Math.max(0, Math.round(totalSec));
    return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
  }
  function drillGrade(seconds, complete) {
    if (!complete) return "INCOMPLETE";
    if (seconds <= 300) return "S";
    if (seconds <= 480) return "A";
    if (seconds <= 660) return "B";
    return "C";
  }
  function drillStepsDone() {
    return DRILL_STEPS.filter(function (_, i) { return drill.checks[i]; }).length;
  }
  function renderDrill() {
    var best = $("nx-drill-best");
    if (best) {
      best.innerHTML = state.drillBest
        ? "BEST: <b>" + fmtClock(state.drillBest.seconds) + "</b> - GRADE <b>" + esc(state.drillBest.grade) + "</b>"
        : "BEST: NO RUN LOGGED";
    }
    var idle = $("nx-drill-idle"), live = $("nx-drill-live");
    if (!idle || !live) return;
    idle.style.display = drill.active ? "none" : "";
    live.style.display = drill.active ? "" : "none";
    if (drill.active) {
      $("nx-drill-steps").innerHTML = DRILL_STEPS.map(function (text, i) {
        var checked = !!drill.checks[i];
        return "<label class=\"nx-check-item" + (checked ? " nx-done" : "") + "\">" +
          "<input type=\"checkbox\" data-drill-idx=\"" + i + "\"" + (checked ? " checked" : "") + ">" +
          "<span class=\"nx-check-text\">" + esc(text) + "</span></label>";
      }).join("");
      $("nx-drill-progress").textContent = drillStepsDone() + " / " + DRILL_STEPS.length + " STEPS";
      tickDrillClock();
    }
  }
  function tickDrillClock() {
    var el = $("nx-drill-clock");
    if (!el || !drill.active) return;
    var remain = DRILL_SECONDS - Math.floor((Date.now() - drill.startedAt) / 1000);
    el.textContent = fmtClock(remain);
    if (remain <= 0) finishDrill(false); // the clock died first
  }
  function startDrill() {
    drill.active = true;
    drill.startedAt = Date.now();
    drill.checks = {};
    var res = $("nx-drill-result");
    if (res) res.innerHTML = "";
    if (drill.timer) clearInterval(drill.timer);
    drill.timer = setInterval(tickDrillClock, 250);
    renderDrill();
  }
  function drillSetStep(i, checked) {
    if (!drill.active) return;
    drill.checks[i] = !!checked;
    if (DRILL_STEPS.every(function (_, j) { return drill.checks[j]; })) { finishDrill(true); return; }
    renderDrill();
  }
  function finishDrill(complete) {
    if (!drill.active) return;
    var used = Math.min(DRILL_SECONDS, Math.floor((Date.now() - drill.startedAt) / 1000));
    var stepsDone = drillStepsDone();
    var grade = drillGrade(used, complete);
    drill.active = false;
    if (drill.timer) { clearInterval(drill.timer); drill.timer = null; }
    var isBest = false;
    if (complete && (!state.drillBest || used < state.drillBest.seconds)) {
      state.drillBest = { seconds: used, grade: grade, at: Date.now() };
      isBest = true;
      saveState();
    }
    var res = $("nx-drill-result");
    if (res) {
      res.innerHTML = "<p class=\"nx-drill-grade\">" + (complete
        ? "DRILL COMPLETE - GRADE " + grade
        : "TIME EXPIRED - GRADE " + grade) + "</p>" +
        "<p class=\"nx-kv\">TIME USED: <b>" + fmtClock(used) + "</b> // STEPS: <b>" + stepsDone + " / " + DRILL_STEPS.length + "</b>" +
        (isBest ? " // <b>NEW BEST</b>" : "") + "</p>";
    }
    if (complete) sfxConfirm();
    renderDrill();
  }
  function abortDrill() {
    if (!drill.active) return;
    var used = Math.floor((Date.now() - drill.startedAt) / 1000);
    var stepsDone = drillStepsDone();
    drill.active = false;
    if (drill.timer) { clearInterval(drill.timer); drill.timer = null; }
    var res = $("nx-drill-result");
    if (res) {
      res.innerHTML = "<p class=\"nx-drill-grade\">DRILL ABORTED</p>" +
        "<p class=\"nx-kv\">STOPPED AT <b>" + fmtClock(used) + "</b> // STEPS: <b>" + stepsDone + " / " + DRILL_STEPS.length + "</b> // NO SCORE LOGGED</p>";
    }
    renderDrill();
  }

  function bindPhase4() {
    var gb = $("nx-grid-btn");
    if (gb) gb.addEventListener("click", enterGridDown);
    var ge = $("nx-grid-exit");
    if (ge) ge.addEventListener("click", function () { showView("command"); });
    var gc = $("nx-grid-compass");
    if (gc) gc.addEventListener("click", function () {
      showView("command");
      var dial = document.querySelector(".nx-compass-dial");
      if (dial && dial.scrollIntoView) setTimeout(function () { dial.scrollIntoView({ block: "center" }); }, 60);
    });
    var gbl = $("nx-grid-blackout");
    if (gbl) gbl.addEventListener("click", function () { setTheme("blackout"); renderGridDown(); });
    var sos = $("nx-grid-sos");
    if (sos) sos.addEventListener("click", startSos);
    var sosStop = $("nx-sos-stop");
    if (sosStop) sosStop.addEventListener("click", stopSos);

    var sb = $("nx-sitrep-btn");
    if (sb) sb.addEventListener("click", openSitrep);
    var sc = $("nx-sitrep-close");
    if (sc) sc.addEventListener("click", function () { $("nx-sitrep-panel").style.display = "none"; });
    var ss = $("nx-sitrep-share");
    if (ss) ss.addEventListener("click", shareSitrep);
    var sp = $("nx-sitrep-png");
    if (sp) sp.addEventListener("click", downloadSitrepPng);

    var ds = $("nx-drill-start");
    if (ds) ds.addEventListener("click", startDrill);
    var da = $("nx-drill-abort");
    if (da) da.addEventListener("click", abortDrill);
    var dsteps = $("nx-drill-steps");
    if (dsteps) dsteps.addEventListener("change", function (ev) {
      var box = ev.target.closest("[data-drill-idx]");
      if (box) drillSetStep(Number(box.getAttribute("data-drill-idx")), box.checked);
    });

    // Sound pack wiring: a key click rides primary controls, and
    // the first tap anywhere wakes the audio context (browsers
    // refuse to start one before a user gesture).
    document.addEventListener("click", function (ev) {
      if (ev.target.closest && ev.target.closest(".nx-btn-accent, .nx-tab")) sfxClick();
    });
    document.addEventListener("pointerdown", function () { if (soundsOn()) ensureAudio(); });
  }

  /* ---------------- render orchestration + init ---------------- */
  function renderAll() {
    renderDashboard();
    renderGear();
    renderRotation();
    renderVault();
    renderComms();
    renderBroadcast();
    renderCrew();
    renderSquad();
    renderMaps();
    renderGuide();
    renderLists();
    renderResupply();
    renderIntel();
    renderAlerts();
    renderSettings();
    renderICS();
    renderPlan();
    renderCalc();
    renderAccount();
    renderGridDown();
    renderDrill();
    renderCheckin();
  }

  /* Account panel mode: the panel carries one shared email +
     password form with two actions, so the "mode" is which
     action is primary. Sign-in is the default (and the shipped
     markup); sign-up promotes Create Account to the accent
     button and switches the password field to new-password
     autocomplete so password managers offer to save it. */
  var acctMode = "signin";
  function setAccountMode(mode) {
    acctMode = mode === "signup" ? "signup" : "signin";
    var panel = $("nx-account-panel");
    if (panel) panel.setAttribute("data-acct-mode", acctMode);
    var signinBtn = $("nx-acct-signin"), signupBtn = $("nx-acct-signup");
    if (signinBtn && signupBtn) {
      signinBtn.classList.toggle("nx-btn-accent", acctMode === "signin");
      signupBtn.classList.toggle("nx-btn-accent", acctMode === "signup");
    }
    var pw = $("nx-acct-password");
    if (pw) pw.setAttribute("autocomplete", acctMode === "signup" ? "new-password" : "current-password");
  }
  /* Landing deep link: app.html?join=signup / ?join=signin.
     Lands on the System view with the account panel in the
     matching mode and scrolls it into view; the param is
     stripped via replaceState so a reload boots normally.
     Returns true when a join was handled - a join visit skips
     the first-run check-in auto-open for that visit only (the
     check-in card still waits on Command and the check-in
     itself works normally afterward). No param, no change. */
  function handleJoinParam() {
    var join = null;
    try { join = new URLSearchParams(window.location.search).get("join"); } catch (e) { join = null; }
    if (join !== "signup" && join !== "signin") return false;
    try {
      var u = new URL(window.location.href);
      u.searchParams.delete("join");
      window.history.replaceState(null, "", u.pathname + u.search + u.hash);
    } catch (e) { /* the mode still applies even if the URL cannot be rewritten */ }
    goToAccountPanel(join);
    return true;
  }

  /* A post shared into the app carries ?url= / ?text= params;
   * handleShareParams (below in init order) files it in Intel
   * and its view switch lands last on purpose. Detecting the
   * visit here lets init keep the check-in behavior for shares
   * exactly as it was: the check-in opens, the share lands on
   * top - the welcome deferral does not apply to shares. */
  function shareVisit() {
    try {
      var params = new URLSearchParams(window.location.search);
      if (params.get("url")) return true;
      return !!intelUrlFromText(params.get("text") || "");
    } catch (e) { return false; }
  }

  function init() {
    document.querySelectorAll(".nx-tab").forEach(function (t) {
      t.addEventListener("click", function () { showView(t.getAttribute("data-view")); });
    });
    bindSyncToggle();
    bindGear();
    bindRotation();
    bindMeds();
    bindCash();
    bindBarcode();
    bindSquad();
    bindMaps();
    bindGuide();
    bindVault();
    bindComms();
    bindFamilyPlan();
    bindBroadcast();
    bindCrew();
    bindCompass();
    bindLists();
    bindResupply();
    bindBuyLater();
    bindCheckin();
    bindSitrep();
    bindTour();
    bindIntel();
    bindAdvisor();
    bindAlerts();
    bindICS();
    bindCalc();
    bindGoBook();
    bindSystem();
    bindAccount();
    bindWelcome();
    bindPhase4();
    tickClock();
    setInterval(tickClock, 1000);
    applyTheme(); // stamps data-theme + meta color; also applies the fx gate
    nxDashAnimated = true; // hold the count-ups until the boot lifts
    // Money build B boot duties: take the weekly snapshot if one
    // is due, and run the rotation-notification check. Both are
    // silent when there is nothing to do; persist only on change.
    var sitrepDirty = maybeSnapshotSitrep();
    var expiryDirty = checkExpiryNotifications();
    if (sitrepDirty || expiryDirty) saveState();
    renderAll();
    initAuth(); // resolves async; local-only deployments stay silent
    refreshAlerts(); // one fetch attempt per app load; cache covers offline
    joinVisit = handleJoinParam(); // a landing sign-up / sign-in deep link beats the check-in auto-open for this visit only
    if (!joinVisit) {
      if (shareVisit()) maybeOpenCheckin(); // a share keeps the old order: check-in opens, the share switch lands on top
      else checkinPending = true; // first run: the check-in auto-open waits until the welcome question settles (see settleWelcome)
    }
    handleShareParams(); // a post shared into the app files itself in Intel - its view switch lands last on purpose, so a share beats the check-in auto-open
    runBoot(function () { nxDashAnimated = false; renderDashboard(); });
    if ("serviceWorker" in navigator && /^https?:$/.test(window.location.protocol)) {
      navigator.serviceWorker.register("sw.js").catch(function () { /* offline shell is a bonus, not a requirement */ });
    }
  }

  // Test/debug handle (read-only helpers used by the smoke suite)
  window.NXS = {
    getState: function () { return state; },
    buildExport: buildExport,
    daysReady: daysReady,
    vault: Vault,
    calcNeeds: calcNeeds,
    calcGap: calcGap,
    planTier: planTier,
    accountMode: function () { return acctMode; },
    isOperator: isOperator,
    isOwner: isOwner,
    capBlocked: capBlocked,
    caps: PLAN_CAPS,
    intelCap: INTEL_FREE_CAP,
    buildGoBook: buildGoBook,
    // Readiness check-in surface for the suites: open/close the
    // flow, read the answers and the generated orders.
    checkin: {
      open: openCheckin,
      close: closeCheckin,
      flow: function () { return checkin; },
      answers: function () { return state.assessment; },
      orders: function () { return state.firstOrders; },
      areas: function () { return assessmentAreas(sanitizeAssessment(state.assessment)); }
    },
    // Guided walkthrough surface for the suites.
    tour: {
      start: startTour,
      end: endTour,
      active: function () { return tour.active; },
      step: function () { return tour.step; },
      steps: function () { return TOUR_STEPS.length; }
    },
    // Shopping links + Resupply surface for the suites: the URL
    // builder (with the tag override the tag test needs), the
    // catalog, the generated lines and the quick-add.
    shop: {
      url: shopUrl,
      open: openShop,
      catalog: SHOP_CATALOG,
      disclosure: shopDisclosureText
    },
    // Buy Later surface for the suites: the Amazon link parser,
    // the tagged open URL and the saved list.
    buyLater: {
      parse: parseAmazonLink,
      openUrl: buyLaterOpenUrl,
      list: function () { return state.buyLater; }
    },
    resupply: {
      lines: resupplyLines,
      addStore: addResupplyStore,
      target: resupplyTarget
    },
    // Money build B surface: the shared store-expiry list, the
    // watch subset, the weekly snapshot log and report text, and
    // the notification check, so the suites can drive them.
    weekly: {
      text: buildWeeklySitrepText,
      log: function () { return state.sitrepLog; },
      radar: storeExpiries,
      watch: function () { return storeExpiries().filter(function (r) { return r.days != null && r.days <= 14; }); },
      notifyCheck: checkExpiryNotifications,
      snapshot: maybeSnapshotSitrep
    },
    // Money build C surface: the barcode lookup + parse (one
    // function, always resolves), the prefill rules and the
    // scanner controls, so the suites can drive them with the
    // camera and the OFF fetch stubbed.
    barcode: {
      lookup: lookupBarcode,
      parse: parseOffProduct,
      prefill: prefillFromBarcode,
      open: openScanner,
      close: closeScanner,
      active: function () { return scan.active; }
    },
    // Money build D surface: the squad payload + frames, the
    // shared collector, the import and the add-on gate, so the
    // suites can drive export/import without a camera.
    squad: {
      payload: squadPayloadText,
      frames: squadFrames,
      collect: squadCollect,
      feed: feedSquadText,
      importData: importSquadData,
      hasAddon: hasAddon,
      addons: function () { return state.addons.slice(); },
      reset: squadCollectReset,
      show: showSquadCode,
      frame: function () { return { idx: squadUi.idx, count: squadUi.frames.length }; }
    },
    // Money build E surface: Offline Map Packs - the
    // entitlement helper, the on-device (IndexedDB) store and
    // the download / open / delete flow, so the suites can
    // drive the whole lifecycle without a network.
    maps: {
      states: MAP_STATES,
      has: hasMapPack,
      url: mapPackUrl,
      download: downloadMapPack,
      remove: deleteMapPack,
      open: openMapState,
      close: closeMapScreen,
      openCode: function () { return mapOpenCode; },
      get: mapPackGet,
      codes: mapPackCodes,
      refreshLocal: refreshMapLocal,
      local: function () { return Object.keys(mapLocal).sort(); },
      svg: mapSvg
    },
    // Field Guide surface: the bundled offline reference -
    // category and topic counts, open/back, and the search
    // filter, so the suites can drive it like a user.
    guide: {
      cats: function () { return GUIDE_CATS.length; },
      topics: guideTopicTotal,
      data: function () { return GUIDE_CATS; },
      open: openGuideTopic,
      close: closeGuideTopic,
      openKey: function () { return guideOpenKey; },
      search: function (q) { guideQuery = String(q || ""); guideOpenKey = null; renderGuide(); }
    },
    // Ready.gov build surface: pet readiness, the med radar
    // rows, cash, and the new state shapes, so the suites can
    // prove the math and the sanitizers directly.
    readygov: {
      pet: petReadiness,
      petDays: function () { return petReadiness().days; },
      petLbPerDay: PET_FOOD_LB_PER_PET_DAY,
      medRadar: medRadarRows,
      medState: medState,
      cashTotal: cashTotal,
      familyPlan: function () { return state.familyPlan; },
      homeSystems: function () { return state.homeSystems; },
      shutoffItems: SHUTOFF_ITEMS,
      kitLoc: kitLoc,
      kitLocs: KIT_LOCS,
      stats: checklistStats
    },
    // AI build surface: the advisor context (so the suites can
    // prove the privacy rule against the real builder), the ask
    // flow, the pending orders / log offer, the day counters and
    // the photo confirm list.
    advisor: {
      context: advisorContext,
      ask: askAdvisor,
      canUse: aiCanUse,
      left: aiLeft,
      useToday: aiUseToday,
      pending: function () { return advisorPending; },
      addOrders: addAdvisorOrders,
      logIt: logAdvisorOffer,
      freeDaily: AI_FREE_DAILY,
      photoItems: function () { return photoItems.slice(); },
      openPhoto: openPhotoConfirm,
      closePhoto: closePhotoConfirm,
      photoOpen: function () { var ov = $("nx-photo"); return !!ov && ov.style.display !== "none"; }
    },
    // Phase 3B surface: themes, sitrep, sound pack state and the
    // evac drill controls, so the suites can drive them directly.
    themes: THEME_IDS,
    currentTheme: currentTheme,
    buildSitrep: buildSitrep,
    sitrepPngDataUrl: sitrepPngDataUrl,
    soundsOn: soundsOn,
    enterGridDown: enterGridDown,
    drill: {
      start: startDrill,
      abort: abortDrill,
      setStep: drillSetStep,
      active: function () { return drill.active; },
      steps: DRILL_STEPS.length
    },
    // Welcome screen surface for the suites: whether the front
    // door is on screen, whether it has been seen for good, and
    // whether the boot decision has been made yet.
    welcome: {
      visible: function () { return welcomeOpen; },
      seen: function () { return state.welcomeSeen === true; },
      settled: function () { return welcomeSettled; }
    },
    // Phase 3A accounts surface for the test suites: configured
    // flag, the live auth user, the exact sync payload (so tests
    // can prove no top-level plan key ever ships and the vault
    // rides as untouched ciphertext), and the auth actions.
    isNativeApp: function () { return IS_NATIVE_APP; },
    isIosApp: function () { return IS_IOS_APP; },
    accounts: {
      configured: firebaseConfigured,
      apiBase: function () { return API_BASE; },
      apiUrl: apiUrl,
      user: function () { return authUser; },
      authUser: function () { return AUTH_USER; },
      syncState: function () { return syncState; },
      syncPayload: syncPayload,
      signInWithEmail: signInWithEmail,
      signUpWithEmail: signUpWithEmail,
      signInWithGoogle: signInWithGoogle,
      signOut: signOutUser,
      explicitSignOut: function () { return explicitSignOut; },
      startCheckout: startCheckout,
      refreshPlanStatus: refreshPlanStatus
    }
  };
  // Localhost-only plan hook (mirrors the Munchling pattern): the
  // Phase 2 suite flips the tier here. On any real host this hook
  // does not exist and the plan can only move server-side.
  if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname)) {
    window.NXS.setPlan = function (p) {
      state.plan = (p === "operator" || p === "lifetime") ? p : "free";
      saveState();
      renderAll();
      return state.plan;
    };
    window.NXS.setAddons = function (a) {
      state.addons = sanitizeAddons(a);
      saveState();
      renderAll();
      return state.addons;
    };
    window.NXS.setTheme = function (t) {
      setTheme(t);
      return currentTheme();
    };
  }

  init();
})();
