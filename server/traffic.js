// Simulates shoppers clicking smart links and (sometimes) buying.
// The "world" conversion rates live only here; the API has to discover them from outcomes.
const API = process.env.API_URL || 'http://localhost:4000';
const RATE = Number(process.env.RATE || 8);                   // clicks per second
const SHOCK_SECONDS = Number(process.env.SHOCK_SECONDS || 20); // auto event interval

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (a, b) => a + Math.random() * (b - a);
const post = (path, body) =>
  fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then((r) => r.json());

async function waitForApi() {
  for (;;) {
    try { const r = await fetch(`${API}/api/state`); if (r.ok) return r.json(); } catch {}
    console.log(`Waiting for API at ${API}...`);
    await sleep(1000);
  }
}

const { links } = await waitForApi();
const linkById = Object.fromEntries(links.map((l) => [l.id, l]));
const linkIds = links.map((l) => l.id);
const world = {};
for (const l of links) for (const s of l.stores) world[s.id] ??= { name: s.name, cr: rand(0.06, 0.14), out: false };
const storeIds = Object.keys(world);
let autoEvents = true;

// Gentle drift with pull back toward 10%
setInterval(() => {
  for (const s of Object.values(world)) {
    if (!s.out) s.cr = Math.min(0.35, Math.max(0.02, s.cr + rand(-0.004, 0.004) + (0.1 - s.cr) * 0.02));
  }
}, 1000);

function apply(kind, id) {
  const s = world[id];
  if (!s) return;
  if (kind === 'flash') { s.cr = rand(0.3, 0.35); s.out = false; }
  if (kind === 'slump') s.cr = rand(0.02, 0.03);
  if (kind === 'outage') { s.cr = 0; s.out = true; }
  if (kind === 'restock') { s.cr = 0.1; s.out = false; }
  console.log(`Event: ${kind} at ${s.name}`);
}

// Presenter events + auto-event switch from the dashboard
setInterval(async () => {
  try {
    const r = await fetch(`${API}/api/sim/poll`).then((x) => x.json());
    autoEvents = r.autoEvents;
    r.events.forEach((e) => apply(e.kind, e.storeId));
  } catch {}
}, 1000);

// Random events so reroutes happen without a presenter
setInterval(() => {
  if (!autoEvents) return;
  const up = storeIds[Math.floor(Math.random() * storeIds.length)];
  const down = storeIds.filter((s) => s !== up)[Math.floor(Math.random() * (storeIds.length - 1))];
  if (!world[up].out) apply('flash', up);
  if (!world[down].out) apply('slump', down);
}, SHOCK_SECONDS * 1000);

let sent = 0, errors = 0;
async function click() {
  try {
    const linkId = linkIds[Math.floor(Math.random() * linkIds.length)];
    const { clickId, storeId } = await post('/api/click', { linkId });
    sent++;
    // One shopper, one dice roll: the routed store and the fixed store are compared on equal terms
    const u = Math.random();
    const orderValue = +rand(20, 250).toFixed(2);
    const converts = u < world[storeId].cr;
    // What a fixed link (always the first store) would have earned from the same shopper
    const fixedConverts = u < world[linkById[linkId].stores[0].id].cr;
    const delay = rand(300, 2000);
    setTimeout(() => {
      if (converts) post('/api/conversion', { clickId, orderValue }).catch(() => {});
      if (fixedConverts) post('/api/sim/baseline', { linkId, orderValue }).catch(() => {});
    }, delay);
  } catch {
    if (++errors % 20 === 1) console.warn('API unreachable, retrying...');
  }
}

(function loop() { click(); setTimeout(loop, (-Math.log(1 - Math.random()) / RATE) * 1000); })();
setInterval(() => console.log(`${sent} clicks sent`), 10000);
console.log(`Sending ~${RATE} clicks/sec to ${API}`);
