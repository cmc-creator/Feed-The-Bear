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
    return !!email && emailVerified === true &&
      OWNER_EMAILS.indexOf(String(email).toLowerCase()) !== -1;
  }
  function isOwner() {
    return !!AUTH_USER && isOwnerEmail(AUTH_USER.email, AUTH_USER.emailVerified);
  }
  function planTier() {
    var p = state.plan;
    return (p === "operator" || p === "lifetime") ? p : "free";
  }
  function isOperator() { return isOwner() || planTier() !== "free"; }
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
      version: 1, gear: [], stores: [], comms: [], crew: [], checklists: {},
      settings: { homeLat: 33.4484, homeLng: -112.0740, callsign: "", effects: true, theme: "command", sounds: true },
      outbox: [],
      icsRoles: {},
      incident: null,
      pastIncidents: [],
      drillBest: null,  // { seconds, grade, at } - best completed evac drill
      intel: [],        // saved social posts: { id, url, host, title, summary, items: [{ kind, name, detail, converted }], addedAt }
      intelTasks: [],   // task strings converted from intel cards - the "Intel" checklist in Lists
      plan: "free",
      _savedAt: 0,      // ms timestamp of the last local save (sync recency)
      ownerUid: null    // Firebase uid that owns this save, once claimed
    };
  }

  function starterState() {
    var s = emptyState();
    var exp = function (months) { return datePlusMonthsStr(months); };
    s.gear = [
      { id: uid(), name: "Pocket IFAK - trauma kit", category: "Medical", weightValue: 0.6, weightUnit: "lb", qty: 1, tier: "T1", env: ["Desert", "Urban"], assignedTo: "", location: "Belt pouch", expiry: exp(5) },
      { id: uid(), name: "Multitool", category: "Tools", weightValue: 0.5, weightUnit: "lb", qty: 1, tier: "T1", env: ["Desert", "Cold", "Wet", "Urban"], assignedTo: "", location: "Pocket", expiry: null },
      { id: uid(), name: "Hydration bladder 3L (full)", category: "Water", weightValue: 6.6, weightUnit: "lb", qty: 1, tier: "T2", env: ["Desert"], assignedTo: "", location: "BOB - main", expiry: null },
      { id: uid(), name: "Squeeze water filter", category: "Water", weightValue: 0.2, weightUnit: "lb", qty: 1, tier: "T2", env: ["Wet", "Cold"], assignedTo: "", location: "BOB - front pouch", expiry: null },
      { id: uid(), name: "2-person tent", category: "Shelter", weightValue: 4.8, weightUnit: "lb", qty: 1, tier: "T2", env: ["Cold", "Wet"], assignedTo: "", location: "BOB - bottom", expiry: null },
      { id: uid(), name: "Sleeping bag 20F", category: "Shelter", weightValue: 2.9, weightUnit: "lb", qty: 1, tier: "T2", env: ["Cold"], assignedTo: "", location: "BOB - bottom", expiry: null },
      { id: uid(), name: "Fire starter kit", category: "Fire", weightValue: 0.4, weightUnit: "lb", qty: 1, tier: "T2", env: ["Cold", "Wet"], assignedTo: "", location: "BOB - front pouch", expiry: null },
      { id: uid(), name: "Change of clothes - sealed", category: "Clothing", weightValue: 1.8, weightUnit: "lb", qty: 1, tier: "T2", env: ["Desert", "Cold", "Wet", "Urban"], assignedTo: "", location: "BOB - main", expiry: null }
    ];
    s.stores = [
      { id: uid(), kind: "Water", name: "Water brick - garage", amount: 10, unit: "gal", expiry: exp(8) },
      { id: uid(), kind: "Food", name: "Rice bucket - pantry", amount: 25, unit: "lbs", expiry: exp(14), kcal: 41250 }
    ];
    s.comms = [
      { id: uid(), label: "Family Net", freq: "GMRS CH 16", callsign: "NYX-1", purpose: "Primary crew check-in", checkin: "07:00 / 19:00" },
      { id: uid(), label: "Weather", freq: "NOAA 162.400 MHz", callsign: "-", purpose: "Weather and alerts - receive only", checkin: "As needed" },
      { id: uid(), label: "Ham Simplex", freq: "146.520 MHz", callsign: "NYX-1", purpose: "Regional simplex fallback", checkin: "20:00" }
    ];
    s.crew = [];
    return s;
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
    if (["command", "nightvision", "desert", "whiteout", "blackout"].indexOf(parsed.settings.theme) === -1) parsed.settings.theme = "command";
    if (typeof parsed.settings.sounds !== "boolean") parsed.settings.sounds = true;
    if (!Array.isArray(parsed.outbox)) parsed.outbox = [];
    if (!parsed.icsRoles || typeof parsed.icsRoles !== "object") parsed.icsRoles = {};
    if (parsed.incident === undefined) parsed.incident = null;
    if (!Array.isArray(parsed.pastIncidents)) parsed.pastIncidents = [];
    if (!parsed.drillBest || typeof parsed.drillBest !== "object" || typeof parsed.drillBest.seconds !== "number") parsed.drillBest = null;
    parsed.intel = sanitizeIntel(parsed.intel);
    parsed.intelTasks = Array.isArray(parsed.intelTasks)
      ? parsed.intelTasks.filter(function (t) { return typeof t === "string" && t; }).map(function (t) { return t.slice(0, 300); })
      : [];
    if (parsed.plan !== "operator" && parsed.plan !== "lifetime") parsed.plan = "free";
    if (typeof parsed._savedAt !== "number") parsed._savedAt = 0;
    if (typeof parsed.ownerUid !== "string") parsed.ownerUid = null;
    return parsed;
  }

  function loadState() {
    try {
      var raw = localStorage.getItem(STATE_KEY);
      if (!raw) {
        var seed = starterState();
        localStorage.setItem(STATE_KEY, JSON.stringify(seed));
        return seed;
      }
      return normalizeState(JSON.parse(raw)) || starterState();
    } catch (e) {
      return starterState();
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

  /* ---------------- navigation + clock ---------------- */
  var currentView = "command";
  function showView(name) {
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

  function renderDaysReady(fxA) {
    var d = daysReady();
    if (fxA && d.headline != null) countUp($("nx-days-ready"), d.headline, 1);
    else $("nx-days-ready").textContent = d.headline == null ? "--" : fmt(d.headline, 1);
    if (fxA) segAnimate($("nx-days-seg"), d.headline == null ? 0 : (d.headline / 30) * 100, false);
    else $("nx-days-seg").innerHTML = segHtml(d.headline == null ? 0 : (d.headline / 30) * 100, false);
    var wLine = "WATER <b>" + (d.waterDays == null ? "--" : fmt(d.waterDays, 1) + " DAYS") + "</b>" +
      (d.waterDays == null ? " - NO WATER STORES" : " (" + fmt(d.waterGal, 1) + " GAL)") +
      (d.waterExpired ? " <span class=\"nx-heavy\">// " + d.waterExpired + " STORE" + (d.waterExpired > 1 ? "S" : "") + " EXPIRED - NOT COUNTED</span>" : "");
    var fLine = "FOOD <b>" + (d.foodDays == null ? "--" : fmt(d.foodDays, 1) + " DAYS") + "</b>" +
      (d.foodDays == null ? " - ADD CALORIES TO A FOOD STORE" : " (" + fmt(d.foodKcal, 0) + " KCAL)") +
      (d.foodExpired ? " <span class=\"nx-heavy\">// " + d.foodExpired + " STORE" + (d.foodExpired > 1 ? "S" : "") + " EXPIRED - NOT COUNTED</span>" : "");
    $("nx-days-breakdown").innerHTML = wLine + "<br>" + fLine;
    $("nx-days-gap").innerHTML = d.headline == null
      ? "ADD WATER AND FOOD STORES IN THE ROTATE TAB TO COMPUTE YOUR NUMBER."
      : "GAP // <b>" + esc(d.gap) + "</b> // WEAKEST LINK: <b>" + esc((d.limiting || "").toUpperCase()) + "</b>";
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

    renderRallyBox();
    if (fxA) nxDashAnimated = true;
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

  function gearRowHtml(g, heaviestIds) {
    var lb = itemWeightLb(g);
    var tags = (g.env || []).map(function (t) { return "<span class=\"nx-tag\">" + esc(t) + "</span>"; }).join("");
    var meta = esc(g.category.toUpperCase()) + " // " + esc(TIERS[g.tier] || g.tier) + " // QTY " + (Number(g.qty) || 1) +
      " // " + fmt(Number(g.weightValue) || 0, 2) + " " + esc(g.weightUnit) + " EACH" +
      (g.location ? " // " + esc(g.location.toUpperCase()) : "") +
      " // CREW: " + esc(crewName(g.assignedTo)) +
      (g.expiry ? " // EXP " + esc(g.expiry) : "");
    return "<div class=\"nx-row\" data-gear-row=\"" + g.id + "\">" +
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
    $("nx-gear-list").innerHTML = html || "<div class=\"nx-empty\">NO GEAR MATCHES. ADD AN ITEM ABOVE OR CLEAR THE FILTERS.</div>";
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
    $("nx-gear-catfilter").addEventListener("change", function () {
      gearCatFilter = this.value;
      renderGear();
    });
  }

  /* ---------------- stores + rotation ---------------- */
  function renderStores() {
    var wrap = $("nx-store-list");
    if (!state.stores.length) {
      wrap.innerHTML = "<div class=\"nx-empty\">NO STORES LOGGED. ADD WATER, FOOD, MEDS OR BATTERIES ABOVE.</div>";
      return;
    }
    wrap.innerHTML = state.stores.map(function (s) {
      var kcalRow = s.kind === "Food"
        ? "<p class=\"nx-row-meta\">TOTAL KCAL <input type=\"number\" min=\"0\" step=\"1\" class=\"nx-cell\" style=\"width:110px; display:inline-block; font-family:var(--nx-mono);\" value=\"" + (s.kcal ? String(s.kcal) : "") + "\" placeholder=\"SET KCAL\" data-store-kcal=\"" + s.id + "\"></p>"
        : "";
      return "<div class=\"nx-row\"><div class=\"nx-row-main\"><p class=\"nx-row-title\">" + esc(s.name) + "</p>" +
        "<p class=\"nx-row-meta\">" + esc(s.kind.toUpperCase()) + " // EXP " + esc(s.expiry || "NO DATE") + "</p>" + kcalRow + "</div>" +
        "<div class=\"nx-row-side\"><span class=\"nx-row-weight\">" + fmt(s.amount, 1) + "</span> <span class=\"nx-dim\">" + esc(s.unit) + "</span>" +
        "<div class=\"nx-btn-row\" style=\"justify-content:flex-end;\">" +
        "<button type=\"button\" class=\"nx-btn nx-btn-small nx-btn-danger\" data-store-del=\"" + s.id + "\">Del</button>" +
        "</div></div></div>";
    }).join("");
  }

  function renderRotation() {
    renderStores();
    var rows = allExpiries();
    var body = $("nx-rotation-body");
    if (!rows.length) {
      body.innerHTML = "<tr><td colspan=\"6\" class=\"nx-dim\" style=\"font-family:var(--nx-mono); font-size:12px;\">NOTHING WITH AN EXPIRY DATE YET.</td></tr>";
      return;
    }
    body.innerHTML = rows.map(function (r) {
      var st = expiryState(r.days);
      var daysTxt = r.days == null ? "-" : (r.days < 0 ? r.days + " (PAST)" : String(r.days));
      return "<tr data-rot-row=\"" + r.kind + ":" + r.refId + "\">" +
        "<td>" + esc(r.name) + "</td>" +
        "<td class=\"nx-num\" style=\"color:var(--nx-dim);\">" + esc(r.source) + "</td>" +
        "<td><input type=\"date\" class=\"nx-cell\" style=\"width:auto; font-family:var(--nx-mono);\" value=\"" + esc(r.expiry) + "\" data-rot-date=\"" + r.kind + ":" + r.refId + "\"></td>" +
        "<td class=\"nx-num\">" + daysTxt + "</td>" +
        "<td><span class=\"nx-badge " + st.cls + "\">" + st.label + "</span></td>" +
        "<td style=\"white-space:nowrap;\"><button type=\"button\" class=\"nx-btn nx-btn-small\" data-rot-plus=\"" + r.kind + ":" + r.refId + "\">Rotate +6MO</button></td>" +
        "</tr>";
    }).join("");
  }

  function setExpiry(kind, id, dateStr) {
    var coll = kind === "gear" ? state.gear : state.stores;
    coll.forEach(function (x) { if (x.id === id) x.expiry = dateStr || null; });
    saveState();
    renderAll();
  }

  function bindRotation() {
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
        kcal: Number($("nx-s-kcal").value) || 0
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
    $("nx-lists-total").innerHTML = "OVERALL READINESS <b>" + cs.pct + "%</b> // " + cs.done + " OF " + cs.total + " ITEMS CONFIRMED ACROSS ALL LISTS";
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
    }).join("") + intelChecklistHtml();
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

  function bindLists() {
    $("nx-lists-wrap").addEventListener("change", function (ev) {
      var box = ev.target.closest("[data-list]");
      if (!box) return;
      var listId = box.getAttribute("data-list");
      var idx = box.getAttribute("data-idx");
      if (!state.checklists[listId]) state.checklists[listId] = {};
      state.checklists[listId][idx] = box.checked;
      if (box.checked) sfxConfirm();
      saveState();
      renderLists();
      renderDashboard();
    });
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
      : "<div class=\"nx-empty\">NO INTEL YET. PASTE A POST LINK ABOVE - TIKTOK, INSTAGRAM, YOUTUBE, FACEBOOK OR ANY PAGE.</div>";
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
    renderThemePicker();
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
      if (!window.confirm("Reset to starter data? Your gear, stores, comms, crew and lists are replaced by the starter set. The vault is NOT touched.")) return;
      state = starterState();
      saveState();
      renderAll();
      showMsg($("nx-system-msg"), "STARTER DATA RESTORED.", "good");
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
      state = emptyState();
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
      persistLocal();
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
  function readPlanCache(uid) {
    try {
      var raw = localStorage.getItem(PLAN_CACHE_KEY);
      if (!raw) return null;
      var c = JSON.parse(raw);
      if (c && c.uid === uid && (c.tier === "operator" || c.tier === "lifetime")) return c.tier;
    } catch (e) {}
    return null;
  }
  function writePlanCache(uid, tier) {
    try { localStorage.setItem(PLAN_CACHE_KEY, JSON.stringify({ uid: uid, tier: tier })); } catch (e) {}
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
    var session = authSession;
    if (isOwner()) {
      // Owner unlock is derived from the verified email at check
      // time; the server reports lifetime for owners too, but the
      // local derivation needs no round-trip.
      state.plan = "lifetime";
      writePlanCache(user.uid, "lifetime");
      persistLocal();
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
      writePlanCache(user.uid, tier);
      persistLocal();
    } catch (e) { /* keep the cached tier */ }
  }

  /* ---------------- sign-in / sign-out ---------------- */
  async function handleSignedIn(user) {
    authUser = user;
    AUTH_USER = { email: user.email || "", emailVerified: user.emailVerified === true };
    var session = ++authSession;
    syncState = "syncing";
    renderAccount();
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
      state = emptyState();
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
  }
  async function signUpWithEmail(email, password) {
    var fb = await ensureFirebase();
    if (!fb) throw new Error("Accounts are not switched on yet.");
    var cred = await nxAuth().createUserWithEmailAndPassword(email, password);
    await handleSignedIn(cred.user);
    return cred.user;
  }
  async function signInWithEmail(email, password) {
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
     * save on this device stays fully usable signed out, and the
     * cached tier stands (see the offline rule in
     * refreshPlanStatus). */
    authSession++;
    authUser = null;
    AUTH_USER = null;
    if (cloudSyncTimer) { clearTimeout(cloudSyncTimer); cloudSyncTimer = null; }
    syncState = "local";
    renderAccount();
    renderAll();
    try {
      var fb = await ensureFirebase();
      if (fb && nxAuth()) {
        await Promise.race([
          nxAuth().signOut(),
          new Promise(function (resolve) { setTimeout(resolve, 4000); })
        ]);
      }
    } catch (e) { /* session may already be gone - local state is cleared regardless */ }
    authUser = null;
    AUTH_USER = null;
    renderAccount();
    renderAll();
  }

  /* ---------------- checkout ---------------- */
  /* planKey: monthly | yearly | lifetime | founding - the exact
   * keys api/checkout.js prices server-side. The client never
   * names an amount. */
  async function startCheckout(planKey) {
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
    var msg = $("nx-plan-msg");
    try {
      var token = await authUser.getIdToken();
      var res = await fetch(apiUrl("/api/checkout"), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify({ plan: planKey, uid: authUser.uid })
      });
      var out = await res.json().catch(function () { return {}; });
      if (!res.ok) { showMsg(msg, String(out.error || "Checkout did not start - try again in a bit.").toUpperCase(), "err"); return; }
      if (out.url) { window.location.href = out.url; return; }
      showMsg(msg, "CHECKOUT DID NOT RETURN A LINK - TRY AGAIN IN A BIT.", "err");
    } catch (e) {
      showMsg(msg, "CHECKOUT DID NOT START - CHECK YOUR CONNECTION AND TRY AGAIN.", "err");
    }
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
  }
  function initAuth() {
    renderAccount();
    ensureFirebase().then(function (fb) {
      renderAccount();
      if (!fb || !nxAuth()) return; // local-only deployment - nothing else to do
      // A Google redirect sign-in (native shells) lands back
      // here: surface its error instead of letting it vanish.
      try {
        var rr = nxAuth().getRedirectResult();
        if (rr && typeof rr.catch === "function") rr.catch(function (e) { noteAuthError(e); });
      } catch (e) { /* no redirect in flight */ }
      nxAuth().onAuthStateChanged(function (user) {
        if (user) {
          if (!authUser || authUser.uid !== user.uid) {
            handleSignedIn(user);
          } else {
            AUTH_USER = { email: user.email || "", emailVerified: user.emailVerified === true };
            renderAccount();
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
        }
      });
    }).catch(function () { renderAccount(); });
  }

  /* ---------------- Phase 3B: themes ----------------
     Five structural variants keyed off data-theme on <html>
     (stamped pre-paint by the inline script in app.html, then
     owned here). The landing page and admin page never set the
     attribute, so they always render Command. */
  var THEMES = [
    { id: "command", name: "Command", desc: "Gunmetal terminal, hazard orange, faint scanlines. Standard issue." },
    { id: "nightvision", name: "Night Vision", desc: "Phosphor green through the NVG lens - glow, vignette, heavy scanlines." },
    { id: "desert", name: "Desert Ops", desc: "Sun-bleached sand, stencil type, dust grain. Built for glare." },
    { id: "whiteout", name: "Whiteout", desc: "Arctic light, flat panels. Maximum readability in full daylight." },
    { id: "blackout", name: "Blackout", desc: "True black, dim red, effects minimized. Maximum battery, minimum signature." }
  ];
  var THEME_IDS = THEMES.map(function (t) { return t.id; });
  var THEME_META = { command: "#0a0b0c", nightvision: "#020503", desert: "#e6dbc2", whiteout: "#eef1f4", blackout: "#000000" };
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
      " // HOUSEHOLD <b>" + d.household + "</b>";
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
    renderLists();
    renderIntel();
    renderAlerts();
    renderSettings();
    renderICS();
    renderPlan();
    renderCalc();
    renderAccount();
    renderGridDown();
    renderDrill();
  }

  function init() {
    document.querySelectorAll(".nx-tab").forEach(function (t) {
      t.addEventListener("click", function () { showView(t.getAttribute("data-view")); });
    });
    bindSyncToggle();
    bindGear();
    bindRotation();
    bindVault();
    bindComms();
    bindBroadcast();
    bindCrew();
    bindCompass();
    bindLists();
    bindIntel();
    bindAlerts();
    bindICS();
    bindCalc();
    bindGoBook();
    bindSystem();
    bindAccount();
    bindPhase4();
    tickClock();
    setInterval(tickClock, 1000);
    applyTheme(); // stamps data-theme + meta color; also applies the fx gate
    nxDashAnimated = true; // hold the count-ups until the boot lifts
    renderAll();
    initAuth(); // resolves async; local-only deployments stay silent
    refreshAlerts(); // one fetch attempt per app load; cache covers offline
    handleShareParams(); // a post shared into the app files itself in Intel
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
    isOperator: isOperator,
    isOwner: isOwner,
    capBlocked: capBlocked,
    caps: PLAN_CAPS,
    intelCap: INTEL_FREE_CAP,
    buildGoBook: buildGoBook,
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
    window.NXS.setTheme = function (t) {
      setTheme(t);
      return currentTheme();
    };
  }

  init();
})();
