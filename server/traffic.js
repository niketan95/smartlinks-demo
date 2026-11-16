// Simulates shoppers clicking smart links and (sometimes) buying.
// The "world" conversion rates live only here; the API has to discover them from outcomes.
const API = process.env.API_URL || 'http://localhost:4000';
const RATE = Number(process.env.RATE || 8);                   // clicks per second
const SHOCK_SECONDS = Number(process.env.SHOCK_SECONDS || 20); // how often a store spikes or tanks

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v) => Math.min(0.3, Math.max(0.02, v));
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
const linkIds = links.map((l) => l.id);
const world = {};
for (const l of links) for (const s of l.stores) world[s.id] ??= { name: s.name, cr: rand(0.06, 0.14) };
const storeIds = Object.keys(world);

// Gentle drift with pull back toward 10%
setInterval(() => {
  for (const s of Object.values(world)) s.cr = clamp(s.cr + rand(-0.004, 0.004) + (0.1 - s.cr) * 0.02);
}, 1000);

// Periodic shocks so reroutes happen on stage
setInterval(() => {
  const up = storeIds[Math.floor(Math.random() * storeIds.length)];
  const down = storeIds.filter((s) => s !== up)[Math.floor(Math.random() * (storeIds.length - 1))];
  world[up].cr = rand(0.22, 0.3);
  world[down].cr = rand(0.02, 0.04);
  console.log(`Shock: ${world[up].name} now converts well, ${world[down].name} is struggling`);
}, SHOCK_SECONDS * 1000);

let sent = 0, errors = 0;
async function click() {
  try {
    const linkId = linkIds[Math.floor(Math.random() * linkIds.length)];
    const { clickId, storeId } = await post('/api/click', { linkId });
    sent++;
    if (Math.random() < world[storeId].cr) {
      setTimeout(() => post('/api/conversion', { clickId, orderValue: +rand(20, 250).toFixed(2) }).catch(() => {}),
                 rand(300, 2000));
    }
  } catch {
    if (++errors % 20 === 1) console.warn('API unreachable, retrying...');
  }
}

(function loop() { click(); setTimeout(loop, (-Math.log(1 - Math.random()) / RATE) * 1000); })();
setInterval(() => console.log(`${sent} clicks sent`), 10000);
console.log(`Sending ~${RATE} clicks/sec to ${API}`);
