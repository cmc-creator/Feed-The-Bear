// Verify the new ordering/failure-memory logic behaves as expected (browser-free simulation).
const OVERPASS_FAIL_KEY = 'ftb_overpass_failures_v1';
const OVERPASS_FAIL_TTL = 10 * 60 * 1000;

// Minimal localStorage shim
const store = {};
global.localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; },
};

const eps = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

function getOverpassFailures () {
  try { return JSON.parse(global.localStorage.getItem(OVERPASS_FAIL_KEY)) || {}; } catch (_) { return {}; }
}
function markOverpassEndpointFailed (endpoint) {
  const fails = getOverpassFailures();
  fails[endpoint] = Date.now();
  global.localStorage.setItem(OVERPASS_FAIL_KEY, JSON.stringify(fails));
}
function orderOverpassEndpoints (endpoints) {
  const fails = getOverpassFailures();
  const now = Date.now();
  const fresh = [], stale = [];
  for (const ep of endpoints) {
    const failedAt = Number(fails[ep] || 0);
    (failedAt && (now - failedAt) < OVERPASS_FAIL_TTL ? stale : fresh).push(ep);
  }
  return [...fresh, ...stale];
}

// Test 1: no failures → original order
let order = orderOverpassEndpoints(eps);
console.log('no failures:', order[0] === eps[0] ? 'PASS' : 'FAIL');

// Test 2: mark first as failed → it goes to the back
markOverpassEndpointFailed(eps[0]);
order = orderOverpassEndpoints(eps);
console.log('failed first moves back:', order[0] === eps[1] ? 'PASS' : 'FAIL');

// Test 3: all failed → order preserved (degraded but functional)
markOverpassEndpointFailed(eps[1]);
markOverpassEndpointFailed(eps[2]);
order = orderOverpassEndpoints(eps);
console.log('all failed keeps order:', JSON.stringify(order) === JSON.stringify(eps) ? 'PASS' : 'FAIL');

// Test 4: expired failure → returns to fresh
store[OVERPASS_FAIL_KEY] = JSON.stringify({ [eps[0]]: Date.now() - OVERPASS_FAIL_TTL - 1000 });
order = orderOverpassEndpoints(eps);
console.log('expired failure ignored:', order[0] === eps[0] ? 'PASS' : 'FAIL');
