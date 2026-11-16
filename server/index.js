import express from 'express';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 4000;

// Routing knobs
const EPSILON = 0.1;        // share of clicks sent to other stores so we keep measuring them
const DECAY = 0.99;         // recent-window decay per click on a link (~100-click memory)
const PRIOR_CLICKS = 10;    // smoothing so a store isn't judged on a handful of clicks
const PRIOR_CR = 0.1;
const SWITCH_MARGIN = 0.02; // a store must beat the active one by 2 points to take over

const STORES = {
  amazon:  { name: 'Amazon',    commission: 0.04 },
  bestbuy: { name: 'Best Buy',  commission: 0.05 },
  target:  { name: 'Target',    commission: 0.06 },
  walmart: { name: 'Walmart',   commission: 0.045 },
  bh:      { name: 'B&H Photo', commission: 0.07 },
};

const LINKS = [
  { id: 'lnk_lamp',  slug: 'go.creator/arc-lamp',    title: 'Arc desk lamp',   stores: ['amazon', 'target', 'walmart'] },
  { id: 'lnk_cam',   slug: 'go.creator/vlog-cam',    title: 'Vlog camera kit', stores: ['amazon', 'bestbuy', 'bh'] },
  { id: 'lnk_mic',   slug: 'go.creator/podcast-mic', title: 'Podcast mic',     stores: ['amazon', 'bestbuy', 'bh', 'walmart'] },
  { id: 'lnk_chair', slug: 'go.creator/desk-chair',  title: 'Ergonomic chair', stores: ['amazon', 'target', 'walmart'] },
];

let state;
let eventId = 0;
let clickCounter = 0;

function reset() {
  state = {
    pending: new Map(), // clickId -> { linkId, storeId }, awaiting a conversion postback
    totals: { clicks: 0, conversions: 0, earnings: 0, reroutes: 0 },
    series: [],
    links: LINKS.map((def) => ({
      ...def,
      active: def.stores[0],
      stats: Object.fromEntries(def.stores.map((s) => [s, { clicks: 0, conversions: 0, earnings: 0, wClicks: 0, wConv: 0 }])),
    })),
  };
}
reset();

const recentCr = (s) => (s.wConv + PRIOR_CLICKS * PRIOR_CR) / (s.wClicks + PRIOR_CLICKS);

// --- live stream (Server-Sent Events) ---
const clients = new Set();
const send = (msg) => { const d = `data: ${JSON.stringify(msg)}\n\n`; for (const c of clients) c.write(d); };
const emit = (e) => send({ ...e, id: ++eventId, at: Date.now() });

function bucket() {
  const t = Math.floor(Date.now() / 1000) * 1000;
  const last = state.series.at(-1);
  if (last?.t === t) return last;
  const b = { t, clicks: 0, conversions: 0 };
  state.series.push(b);
  if (state.series.length > 60) state.series.shift();
  return b;
}

function snapshot() {
  bucket();
  return {
    type: 'snapshot',
    totals: state.totals,
    series: state.series,
    links: state.links.map((l) => ({
      id: l.id, title: l.title, slug: l.slug, active: l.active,
      stores: l.stores.map((id) => {
        const s = l.stats[id];
        return { id, name: STORES[id].name, clicks: s.clicks, conversions: s.conversions, earnings: s.earnings, recentCr: recentCr(s) };
      }),
    })),
  };
}

// --- dynamic routing ---
function pickStore(link) {
  if (Math.random() < EPSILON) {
    const others = link.stores.filter((s) => s !== link.active);
    return { storeId: others[Math.floor(Math.random() * others.length)], explore: true };
  }
  return { storeId: link.active, explore: false };
}

function evaluate(link) {
  const best = link.stores.reduce((a, b) => (recentCr(link.stats[b]) > recentCr(link.stats[a]) ? b : a));
  const fromCr = recentCr(link.stats[link.active]);
  const toCr = recentCr(link.stats[best]);
  if (best === link.active || toCr - fromCr <= SWITCH_MARGIN) return;
  const from = link.active;
  link.active = best;
  state.totals.reroutes++;
  emit({ type: 'reroute', linkId: link.id, linkTitle: link.title, from, to: best,
         fromName: STORES[from].name, toName: STORES[best].name, fromCr, toCr });
}

// --- API ---
const app = express();
app.use(express.json());

app.get('/api/state', (_req, res) => res.json(snapshot()));

app.get('/api/stream', (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write(`data: ${JSON.stringify(snapshot())}\n\n`);
  clients.add(res);
  req.on('close', () => clients.delete(res));
});

app.post('/api/click', (req, res) => {
  const link = state.links.find((l) => l.id === req.body?.linkId);
  if (!link) return res.status(404).json({ error: 'Unknown linkId' });

  const { storeId, explore } = pickStore(link);
  for (const s of Object.values(link.stats)) { s.wClicks *= DECAY; s.wConv *= DECAY; }
  const st = link.stats[storeId];
  st.clicks++; st.wClicks++;
  state.totals.clicks++; bucket().clicks++;

  const clickId = `c${++clickCounter}`;
  state.pending.set(clickId, { linkId: link.id, storeId });
  if (state.pending.size > 5000) state.pending.delete(state.pending.keys().next().value);

  evaluate(link);
  res.json({ clickId, storeId, explore });
});

app.post('/api/conversion', (req, res) => {
  const click = state.pending.get(req.body?.clickId);
  if (!click) return res.status(404).json({ error: 'Unknown or already converted clickId' });
  state.pending.delete(req.body.clickId);

  const link = state.links.find((l) => l.id === click.linkId);
  const st = link.stats[click.storeId];
  const commission = Math.round(Number(req.body.orderValue || 0) * STORES[click.storeId].commission * 100) / 100;
  st.conversions++; st.wConv++; st.earnings += commission;
  state.totals.conversions++; state.totals.earnings += commission; bucket().conversions++;

  emit({ type: 'conversion', linkId: link.id, linkTitle: link.title, storeId: click.storeId,
         storeName: STORES[click.storeId].name, commission });
  evaluate(link);
  res.json({ ok: true, commission });
});

app.post('/api/reset', (_req, res) => { reset(); emit({ type: 'reset' }); res.json({ ok: true }); });

// Serve the built dashboard (production)
const dist = path.join(__dirname, '../client/dist');
app.use(express.static(dist));
app.get('*', (_req, res, next) => res.sendFile(path.join(dist, 'index.html'), (err) => err && next()));

setInterval(() => send(snapshot()), 1000);
app.listen(PORT, () => {
  console.log(`API on http://localhost:${PORT}`);
  // On a hosted demo, run the mock traffic inside the same service
  if (process.env.DEMO_TRAFFIC === '1') {
    spawn(process.execPath, [path.join(__dirname, 'traffic.js')], {
      stdio: 'inherit',
      env: { ...process.env, API_URL: `http://localhost:${PORT}` },
    });
  }
});
