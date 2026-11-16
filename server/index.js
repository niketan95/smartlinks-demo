import express from 'express';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import crypto from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 4000;
const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'smartlinks';
if (!process.env.DEMO_PASSWORD) console.warn('DEMO_PASSWORD not set, using the default "smartlinks"');

// Routing knobs
const EPSILON = 0.1;        // share of clicks sent to other stores so we keep measuring them
const DECAY = 0.99;         // recent-window decay per click on a link (~100-click memory)
const PRIOR_CLICKS = 10;    // smoothing so a store isn't judged on a handful of clicks
const PRIOR_CR = 0.1;
const SWITCH_MARGIN = 0.02; // a store must beat the active one by 2 points to take over
const MIN_STORE_CLICKS = 3; // ...and have enough recent clicks to trust the number

const STORES = {
  amazon:  { name: 'Amazon',    commission: 0.04 },
  bestbuy: { name: 'Best Buy',  commission: 0.05 },
  target:  { name: 'Target',    commission: 0.06 },
  walmart: { name: 'Walmart',   commission: 0.045 },
  bh:      { name: 'B&H Photo', commission: 0.07 },
};

// The first store in each list is the "fixed link" default used for the without-routing comparison.
const LINKS = [
  { id: 'lnk_lamp',  slug: 'go.creator/arc-lamp',    title: 'Arc desk lamp',   stores: ['amazon', 'target', 'walmart'] },
  { id: 'lnk_cam',   slug: 'go.creator/vlog-cam',    title: 'Vlog camera kit', stores: ['amazon', 'bestbuy', 'bh'] },
  { id: 'lnk_mic',   slug: 'go.creator/podcast-mic', title: 'Podcast mic',     stores: ['amazon', 'bestbuy', 'bh', 'walmart'] },
  { id: 'lnk_chair', slug: 'go.creator/desk-chair',  title: 'Ergonomic chair', stores: ['amazon', 'target', 'walmart'] },
];

let state;
let eventId = 0;
let clickCounter = 0;
let autoEvents = true; // random flash sales / slumps from the traffic script
let simQueue = [];     // presenter events waiting for the traffic script

function reset() {
  state = {
    pending: new Map(),
    unavailable: {}, // storeId -> true while out of stock
    totals: { clicks: 0, conversions: 0, earnings: 0, baseline: 0, reroutes: 0 },
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
const round2 = (n) => Math.round(n * 100) / 100;

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
    autoEvents,
    stores: Object.entries(STORES).map(([id, s]) => ({ id, name: s.name, outOfStock: !!state.unavailable[id] })),
    links: state.links.map((l) => ({
      id: l.id, title: l.title, slug: l.slug, active: l.active,
      stores: l.stores.map((id) => {
        const s = l.stats[id];
        return { id, name: STORES[id].name, clicks: s.clicks, conversions: s.conversions, earnings: s.earnings,
                 recentCr: recentCr(s), outOfStock: !!state.unavailable[id] };
      }),
    })),
  };
}

// --- dynamic routing ---
const available = (link) => link.stores.filter((s) => !state.unavailable[s]);

function pickStore(link) {
  const others = available(link).filter((s) => s !== link.active);
  if (others.length && Math.random() < EPSILON) return { storeId: others[Math.floor(Math.random() * others.length)], explore: true };
  return { storeId: link.active, explore: false };
}

function reroute(link, to, reason) {
  const from = link.active;
  link.active = to;
  state.totals.reroutes++;
  emit({ type: 'reroute', reason, linkId: link.id, linkTitle: link.title, from, to,
         fromName: STORES[from].name, toName: STORES[to].name,
         fromCr: recentCr(link.stats[from]), toCr: recentCr(link.stats[to]) });
}

function evaluate(link) {
  const avail = available(link);
  if (!avail.length) return;
  const best = avail.reduce((a, b) => (recentCr(link.stats[b]) > recentCr(link.stats[a]) ? b : a));
  if (state.unavailable[link.active]) return reroute(link, best, 'stock');
  if (best !== link.active && link.stats[best].wClicks >= MIN_STORE_CLICKS &&
      recentCr(link.stats[best]) - recentCr(link.stats[link.active]) > SWITCH_MARGIN) {
    reroute(link, best, 'rate');
  }
}

// --- API ---
const app = express();
app.set('trust proxy', 1);
app.use(express.json());

// --- auth (one shared demo password, sessions kept in memory) ---
const sessions = new Map(); // token -> { email }
const COOKIE = 'sl_session';
const readCookie = (req) =>
  (req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).find(([k]) => k === COOKIE)?.[1];
const sameSecret = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
function requireAuth(req, res, next) {
  const session = sessions.get(readCookie(req));
  if (!session) return res.status(401).json({ error: 'Sign in to continue' });
  req.user = session;
  next();
}
// Visitors can watch; only password users can reset or trigger events
function requireOwner(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'owner') return res.status(403).json({ error: 'Visitors can’t change the demo' });
    next();
  });
}
function startSession(req, res, user) {
  const token = crypto.randomUUID();
  sessions.set(token, user);
  res.setHeader('Set-Cookie',
    `${COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${7 * 24 * 3600}${req.secure ? '; Secure' : ''}`);
  res.json(user);
}

app.post('/api/login', (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (!sameSecret(req.body?.password || '', DEMO_PASSWORD)) return res.status(401).json({ error: 'That password isn’t right.' });
  startSession(req, res, { email, role: 'owner' });
});
app.post('/api/login/visitor', (req, res) => startSession(req, res, { email: null, role: 'visitor' }));
app.get('/api/me', requireAuth, (req, res) => res.json(req.user));
app.post('/api/logout', (req, res) => {
  sessions.delete(readCookie(req));
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
  res.json({ ok: true });
});

app.get('/api/state', (_req, res) => res.json(snapshot()));

app.get('/api/stream', requireAuth, (req, res) => {
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
  const commission = round2(Number(req.body.orderValue || 0) * STORES[click.storeId].commission);
  st.conversions++; st.wConv++; st.earnings += commission;
  state.totals.conversions++; state.totals.earnings += commission; bucket().conversions++;

  emit({ type: 'conversion', linkId: link.id, linkTitle: link.title, storeId: click.storeId,
         storeName: STORES[click.storeId].name, commission });
  evaluate(link);
  res.json({ ok: true, commission });
});

app.post('/api/reset', requireOwner, (_req, res) => { reset(); simQueue = []; emit({ type: 'reset' }); res.json({ ok: true }); });

// --- demo simulation controls ---
// What a fixed link (always the first store) would have earned for the same click.
app.post('/api/sim/baseline', (req, res) => {
  const link = state.links.find((l) => l.id === req.body?.linkId);
  if (!link) return res.status(404).json({ error: 'Unknown linkId' });
  state.totals.baseline += round2(Number(req.body.orderValue || 0) * STORES[link.stores[0]].commission);
  res.json({ ok: true });
});

// Presenter events: flash | slump | outage | restock
app.post('/api/sim/event', requireOwner, (req, res) => {
  const { kind, storeId } = req.body || {};
  if (!STORES[storeId] || !['flash', 'slump', 'outage', 'restock'].includes(kind)) {
    return res.status(400).json({ error: 'Need kind (flash, slump, outage, restock) and a valid storeId' });
  }
  simQueue.push({ kind, storeId });
  if (kind === 'outage') {
    state.unavailable[storeId] = true;
    state.links.filter((l) => l.stores.includes(storeId)).forEach(evaluate);
  }
  if (kind === 'restock') delete state.unavailable[storeId];
  send(snapshot());
  res.json({ ok: true });
});

app.post('/api/sim/auto', requireOwner, (req, res) => { autoEvents = !!req.body?.on; send(snapshot()); res.json({ autoEvents }); });

// Polled by traffic.js
app.get('/api/sim/poll', (_req, res) => { res.json({ events: simQueue, autoEvents }); simQueue = []; });

// --- serve the built dashboard (production) ---
const dist = path.join(__dirname, '../client/dist');
app.use(express.static(dist));
app.get('*', (_req, res, next) => res.sendFile(path.join(dist, 'index.html'), (err) => err && next()));

setInterval(() => send(snapshot()), 1000);
app.listen(PORT, () => {
  console.log(`API on http://localhost:${PORT}`);
  if (process.env.DEMO_TRAFFIC === '1') {
    spawn(process.execPath, [path.join(__dirname, 'traffic.js')], {
      stdio: 'inherit',
      env: { ...process.env, API_URL: `http://localhost:${PORT}` },
    });
  }
});
