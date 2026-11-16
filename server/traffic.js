// Simulates shoppers clicking smart links and (sometimes) buying.
// The "world" conversion rates live only here; the API has to discover them from outcomes.
const API = process.env.API_URL || 'http://localhost:4000';
const RATE = Number(process.env.RATE || 8);                   // clicks per second
const SHOCK_SECONDS = Number(process.env.SHOCK_SECONDS || 20); // auto event interval

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const post = (path, body) =>
  fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then((r) => r.json());

let links = [];            // [{ id, stores: [storeId] }], refreshed every second
let orderRange = [20, 250];
let region = null;
let names = {};
let world = {};            // storeId -> { cr, out }
let autoEvents = true;

const rate = (id) => (world[id] ??= { cr: rand(0.06, 0.14), out: false });

async function poll() {
  const r = await fetch(`${API}/api/sim/poll`).then((x) => x.json());
  if (r.region !== region) { world = {}; region = r.region; }
  links = r.links; orderRange = r.orderRange; autoEvents = r.autoEvents; names = r.storeNames;
  r.events.forEach((e) => apply(e.kind, e.storeId));
}

function apply(kind, id) {
  const s = rate(id);
  if (kind === 'flash') { s.cr = rand(0.3, 0.35); s.out = false; }
  if (kind === 'slump') s.cr = rand(0.02, 0.03);
  if (kind === 'outage') { s.cr = 0; s.out = true; }
  if (kind === 'restock') { s.cr = 0.1; s.out = false; }
  console.log(`Event: ${kind} at ${names[id] || id}`);
}

for (;;) {
  try { await poll(); break; } catch {}
  console.log(`Waiting for API at ${API}...`);
  await sleep(1000);
}
setInterval(() => poll().catch(() => {}), 1000);

// Gentle drift with pull back toward 10%
setInterval(() => {
  for (const s of Object.values(world)) {
    if (!s.out) s.cr = Math.min(0.35, Math.max(0.02, s.cr + rand(-0.004, 0.004) + (0.1 - s.cr) * 0.02));
  }
}, 1000);

// Random events so reroutes happen without a presenter
setInterval(() => {
  const ids = [...new Set(links.flatMap((l) => l.stores))];
  if (!autoEvents || ids.length < 2) return;
  const up = pick(ids), down = pick(ids.filter((s) => s !== up));
  if (!rate(up).out) apply('flash', up);
  if (!rate(down).out) apply('slump', down);
}, SHOCK_SECONDS * 1000);

let sent = 0, errors = 0;
async function click() {
  if (!links.length) return;
  try {
    const link = pick(links);
    const { clickId, storeId } = await post('/api/click', { linkId: link.id });
    if (!storeId) return;
    sent++;
    // One shopper, one dice roll: the routed store and the fixed store are compared on equal terms
    const u = Math.random();
    const orderValue = Math.round(rand(...orderRange) * 100) / 100;
    const converts = u < rate(storeId).cr;
    const fixedConverts = u < rate(link.stores[0]).cr;
    setTimeout(() => {
      if (converts) post('/api/conversion', { clickId, orderValue }).catch(() => {});
      if (fixedConverts) post('/api/sim/baseline', { linkId: link.id, orderValue }).catch(() => {});
    }, rand(300, 2000));
  } catch {
    if (++errors % 20 === 1) console.warn('API unreachable, retrying...');
  }
}

(function loop() { click(); setTimeout(loop, (-Math.log(1 - Math.random()) / RATE) * 1000); })();
setInterval(() => console.log(`${sent} clicks sent`), 10000);
console.log(`Sending ~${RATE} clicks/sec to ${API}`);
