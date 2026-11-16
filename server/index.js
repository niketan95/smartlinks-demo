import express from 'express';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import crypto from 'node:crypto';
import { REGIONS } from './catalog.js';

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

let state;
let eventId = 0;
let clickCounter = 0;
let linkCounter = 0;
let autoEvents = true; // random flash sales / slumps from the traffic script
let simQueue = [];     // presenter events waiting for the traffic script

const region = () => REGIONS[state.region];
const store = (id) => region().stores[id];
const emptyStats = () => ({ clicks: 0, conversions: 0, earnings: 0, wClicks: 0, wConv: 0 });

function makeLink({ title, slug, stores }) {
  return {
    id: `lnk_${++linkCounter}`, title, slug,
    stores: stores.map((s) => s.id),
    urls: Object.fromEntries(stores.map((s) => [s.id, s.url])),
    active: stores[0].id, // first store = the "fixed link" default for the comparison
    stats: Object.fromEntries(stores.map((s) => [s.id, emptyStats()])),
  };
}

function resetStats() {
  state.pending = new Map();
  state.unavailable = {};
  state.totals = { clicks: 0, liveClicks: 0, conversions: 0, earnings: 0, baseline: 0, reroutes: 0 };
  state.series = [];
  for (const l of state.links) {
    l.active = l.stores[0];
    l.stats = Object.fromEntries(l.stores.map((s) => [s, emptyStats()]));
  }
}

function seedRegion(id) {
  const r = REGIONS[id];
  state = { region: id, links: r.seed.map(makeLink), connections: {}, linkOut: {} }; // linkOut: linkId -> { storeId: true }
  for (const l of state.links) for (const s of l.stores) state.connections[s] = r.stores[s].sampleTag;
  resetStats();
}
seedRegion('us');

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

const usedStoreIds = () => [...new Set(state.links.flatMap((l) => l.stores))];

function snapshot() {
  bucket();
  return {
    type: 'snapshot',
    region: state.region, currency: region().currency, locale: region().locale, simulated: process.env.DEMO_TRAFFIC === '1',
    totals: state.totals,
    series: state.series,
    autoEvents,
    stores: usedStoreIds().map((id) => ({ id, name: store(id).name, outOfStock: !!state.unavailable[id] })),
    links: state.links.map((l) => ({
      id: l.id, title: l.title, slug: l.slug, active: l.active,
      stores: l.stores.map((id) => {
        const s = l.stats[id];
        return { id, name: store(id).name, clicks: s.clicks, conversions: s.conversions, earnings: s.earnings,
                 recentCr: recentCr(s), outOfStock: isOut(l, id) };
      }),
    })),
  };
}

// --- dynamic routing ---
const isOut = (link, s) => !!(state.unavailable[s] || state.linkOut[link.id]?.[s]);
const available = (link) => link.stores.filter((s) => !isOut(link, s));
// Rate-based learning needs sales data. Until a link has reported sales, it simply uses
// the first in-stock store in the creator's order, so real clicks never flip-flop on noise.
const learning = (link) => Object.values(link.stats).some((s) => s.conversions > 0);

function pickStore(link) {
  if (!learning(link)) return { storeId: link.active, explore: false };
  const others = available(link).filter((s) => s !== link.active);
  if (others.length && Math.random() < EPSILON) return { storeId: others[Math.floor(Math.random() * others.length)], explore: true };
  return { storeId: link.active, explore: false };
}

function reroute(link, to, reason) {
  const from = link.active;
  link.active = to;
  state.totals.reroutes++;
  emit({ type: 'reroute', reason, linkId: link.id, linkTitle: link.title, from, to,
         fromName: store(from).name, toName: store(to).name,
         fromCr: recentCr(link.stats[from]), toCr: recentCr(link.stats[to]) });
}

function evaluate(link) {
  const avail = available(link);
  if (!avail.length) return;
  if (!learning(link)) {
    if (isOut(link, link.active)) return reroute(link, avail[0], 'stock');
    if (link.active !== avail[0]) return reroute(link, avail[0], 'restock');
    return;
  }
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
const sessions = new Map();
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
// Visitors can watch; only password users can change anything
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

function recordClick(link, live) {
  evaluate(link); // make sure stock changes apply before choosing
  const { storeId, explore } = pickStore(link);
  for (const s of Object.values(link.stats)) { s.wClicks *= DECAY; s.wConv *= DECAY; }
  const st = link.stats[storeId];
  st.clicks++; st.wClicks++;
  state.totals.clicks++; bucket().clicks++;
  if (live) state.totals.liveClicks++;

  const clickId = `c${++clickCounter}`;
  state.pending.set(clickId, { linkId: link.id, storeId });
  if (state.pending.size > 5000) state.pending.delete(state.pending.keys().next().value);
  evaluate(link);
  return { clickId, storeId, explore };
}

// The creator's own ID goes on plain Amazon and Flipkart pages. Network links
// (Cuelinks, Impact, CJ) and affiliate short links are passed through unchanged.
function destination(link, storeId) {
  const raw = link.urls[storeId];
  const def = store(storeId), tag = state.connections[storeId];
  try {
    const u = new URL(raw);
    const mainDomain = def.domains[0];
    const onStore = u.hostname === mainDomain || u.hostname.endsWith(`.${mainDomain}`);
    if (def.tagParam && tag && onStore && !u.searchParams.has(def.tagParam)) u.searchParams.set(def.tagParam, tag);
    return u.toString();
  } catch { return raw; }
}

app.post('/api/click', (req, res) => {
  const link = state.links.find((l) => l.id === req.body?.linkId);
  if (!link) return res.status(404).json({ error: 'Unknown linkId' });
  const { clickId, storeId, explore } = recordClick(link, false);
  res.json({ clickId, storeId, explore, url: destination(link, storeId) });
});

app.post('/api/conversion', (req, res) => {
  const click = state.pending.get(req.body?.clickId);
  if (!click) return res.status(404).json({ error: 'Unknown or already converted clickId' });
  state.pending.delete(req.body.clickId);

  const link = state.links.find((l) => l.id === click.linkId);
  if (!link || !link.stats[click.storeId]) return res.status(410).json({ error: 'Link was changed or removed' });
  const st = link.stats[click.storeId];
  const commission = round2(Number(req.body.orderValue || 0) * store(click.storeId).commission);
  st.conversions++; st.wConv++; st.earnings += commission;
  state.totals.conversions++; state.totals.earnings += commission; bucket().conversions++;

  emit({ type: 'conversion', linkId: link.id, linkTitle: link.title, storeId: click.storeId,
         storeName: store(click.storeId).name, commission });
  evaluate(link);
  res.json({ ok: true, commission });
});

app.post('/api/reset', requireOwner, (_req, res) => { resetStats(); simQueue = []; emit({ type: 'reset' }); res.json({ ok: true }); });

// --- setup: region, affiliate connections, links ---
function config() {
  const used = new Set(usedStoreIds());
  return {
    region: state.region,
    regions: Object.entries(REGIONS).map(([id, r]) => ({ id, label: r.label })),
    currency: region().currency,
    catalog: Object.entries(region().stores).map(([id, s]) => ({
      id, name: s.name, program: s.program, network: s.network, commission: s.commission, domains: s.domains,
      tagLabel: s.tagLabel, tagExample: s.sampleTag, connected: id in state.connections, tag: state.connections[id] || null,
      inUse: used.has(id),
    })),
    links: state.links.map((l) => ({ id: l.id, title: l.title, slug: l.slug,
                                     stores: l.stores.map((id) => ({ id, url: l.urls[id], outOfStock: isOut(l, id) })) })),
  };
}

const RESERVED = new Set(['api', 'assets', 'r', 'links', 'connections', 'login', 'favicon.ico']);
function validLink(body, exceptId) {
  const title = String(body?.title || '').trim();
  const slug = String(body?.slug || '').trim().toLowerCase();
  const stores = Array.isArray(body?.stores) ? body.stores : [];
  if (!title) return { error: 'Add a product name.' };
  if (!/^[a-z0-9-]{2,40}$/.test(slug)) return { error: 'Short link name can use lowercase letters, numbers and dashes (2 to 40 characters).' };
  if (RESERVED.has(slug)) return { error: `“${slug}” is reserved. Try another name.` };
  if (state.links.some((l) => l.slug === slug && l.id !== exceptId)) return { error: `go.creator/${slug} is already taken.` };
  if (stores.length < 2) return { error: 'Add at least two stores so the link has somewhere to switch to.' };
  const seen = new Set();
  for (const s of stores) {
    if (!store(s.id)) return { error: 'One of the stores isn’t available in this region.' };
    if (!(s.id in state.connections)) return { error: `Connect ${store(s.id).name} before adding it to a link.` };
    if (seen.has(s.id)) return { error: `${store(s.id).name} is listed twice.` };
    seen.add(s.id);
    try { if (!/^https?:$/.test(new URL(s.url).protocol)) throw 0; }
    catch { return { error: `Add a valid product page for ${store(s.id).name}, starting with https://` }; }
  }
  return { title, slug, stores: stores.map((s) => ({ id: s.id, url: s.url.trim() })) };
}

app.get('/api/config', requireOwner, (_req, res) => res.json(config()));

app.post('/api/region', requireOwner, (req, res) => {
  if (!REGIONS[req.body?.region]) return res.status(400).json({ error: 'Unknown region' });
  seedRegion(req.body.region);
  simQueue = [];
  emit({ type: 'reset' });
  send(snapshot());
  res.json(config());
});

app.post('/api/connections', requireOwner, (req, res) => {
  const { storeId } = req.body || {};
  const tag = String(req.body?.tag || '').trim();
  if (!store(storeId)) return res.status(400).json({ error: 'Unknown store' });
  if (tag.length < 3) return res.status(400).json({ error: `Enter your ${store(storeId).tagLabel}.` });
  state.connections[storeId] = tag;
  res.json(config());
});

app.delete('/api/connections/:storeId', requireOwner, (req, res) => {
  const id = req.params.storeId;
  const using = state.links.filter((l) => l.stores.includes(id));
  if (using.length) {
    return res.status(409).json({ error: `${store(id).name} is used by ${using.length} link${using.length > 1 ? 's' : ''}. Remove it from ${using.length > 1 ? 'them' : 'it'} first.` });
  }
  delete state.connections[id];
  res.json(config());
});

app.post('/api/links', requireOwner, (req, res) => {
  const v = validLink(req.body);
  if (v.error) return res.status(400).json(v);
  state.links.push(makeLink(v));
  send(snapshot());
  res.json(config());
});

app.put('/api/links/:id', requireOwner, (req, res) => {
  const link = state.links.find((l) => l.id === req.params.id);
  if (!link) return res.status(404).json({ error: 'That link no longer exists.' });
  const v = validLink(req.body, link.id);
  if (v.error) return res.status(400).json(v);
  link.title = v.title;
  link.slug = v.slug;
  link.stores = v.stores.map((s) => s.id);
  link.urls = Object.fromEntries(v.stores.map((s) => [s.id, s.url]));
  link.stats = Object.fromEntries(link.stores.map((id) => [id, link.stats[id] || emptyStats()]));
  if (!link.stores.includes(link.active)) link.active = link.stores[0];
  send(snapshot());
  res.json(config());
});

// Mark one store out of stock (or back in stock) for one product
app.post('/api/links/:id/stock', requireOwner, (req, res) => {
  const link = state.links.find((l) => l.id === req.params.id);
  const { storeId, inStock } = req.body || {};
  if (!link || !link.stores.includes(storeId)) return res.status(404).json({ error: 'That link or store no longer exists.' });
  state.linkOut[link.id] ??= {};
  if (inStock) delete state.linkOut[link.id][storeId];
  else state.linkOut[link.id][storeId] = true;
  evaluate(link);
  send(snapshot());
  res.json(config());
});

app.delete('/api/links/:id', requireOwner, (req, res) => {
  const i = state.links.findIndex((l) => l.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'That link no longer exists.' });
  delete state.linkOut[state.links[i].id];
  state.links.splice(i, 1);
  send(snapshot());
  res.json(config());
});

// --- demo simulation controls ---
// What a fixed link (always the first store) would have earned for the same click.
app.post('/api/sim/baseline', (req, res) => {
  const link = state.links.find((l) => l.id === req.body?.linkId);
  if (!link) return res.status(404).json({ error: 'Unknown linkId' });
  state.totals.baseline += round2(Number(req.body.orderValue || 0) * store(link.stores[0]).commission);
  res.json({ ok: true });
});

// Presenter events: flash | slump | outage | restock
app.post('/api/sim/event', requireOwner, (req, res) => {
  const { kind, storeId } = req.body || {};
  if (!store(storeId) || !['flash', 'slump', 'outage', 'restock'].includes(kind)) {
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

// Polled by traffic.js: queued presenter events plus the current link list
app.get('/api/sim/poll', (_req, res) => {
  res.json({
    events: simQueue, autoEvents, region: state.region, orderRange: region().orderRange,
    links: state.links.map((l) => ({ id: l.id, stores: l.stores })),
    storeNames: Object.fromEntries(Object.entries(region().stores).map(([id, s]) => [id, s.name])),
  });
  simQueue = [];
});

// --- serve the built dashboard (production) ---
const dist = path.join(__dirname, '../client/dist');
app.use(express.static(dist));
// --- the smart link itself: /earbuds or /r/earbuds sends a real shopper to the best store ---
app.get(['/r/:slug', '/:slug'], (req, res, next) => {
  const link = state.links.find((l) => l.slug === req.params.slug.toLowerCase());
  if (!link) return next();
  const { storeId } = recordClick(link, true);
  res.set('Cache-Control', 'no-store');
  res.redirect(302, destination(link, storeId));
});

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
