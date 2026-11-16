import { useCallback, useEffect, useRef, useState } from 'react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip } from 'recharts';
import { Close, ConfirmDialog, Logo, Sliders, Spinner, ThemeSegmented, ThemeToggle, money } from './ui.jsx';
import { ConnectionsPage, LinksPage, useConfig } from './Setup.jsx';

const pct = (n) => `${(n * 100).toFixed(1)}%`;
const clock = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const cssVar = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const postJson = (url, body) =>
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });

const EVENT_TOAST = {
  flash: (n) => `Flash sale started at ${n}`,
  slump: (n) => `Sales slump at ${n}`,
  outage: (n) => `${n} marked out of stock`,
  restock: (n) => `${n} is back in stock`,
};

export default function Dashboard({ user, theme, setTheme, toast, onSignedOut }) {
  const [snap, setSnap] = useState(null);
  const [reroutes, setReroutes] = useState([]);
  const [sales, setSales] = useState([]);
  const [rerouted, setRerouted] = useState({});
  const [live, setLive] = useState(false);
  const [conn, setConn] = useState(0);
  const [presenter, setPresenter] = useState(false);
  const [confirm, setConfirm] = useState(null); // 'reset' | 'signout'
  const [busy, setBusy] = useState(false);
  const owner = user.role === 'owner';
  const tabFromHash = () => (owner && ['links', 'connections'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'dashboard');
  const [tab, setTab] = useState(tabFromHash);
  const goTo = useCallback((t) => { location.hash = t === 'dashboard' ? '' : t; setTab(t); scrollTo(0, 0); }, []);
  useEffect(() => {
    const onHash = () => setTab(tabFromHash());
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  }, []);
  const cfgState = useConfig(owner, snap?.region, onSignedOut);

  // Live stream
  useEffect(() => {
    const es = new EventSource('/api/stream');
    es.onopen = () => setLive(true);
    es.onerror = async () => {
      setLive(false);
      if (es.readyState !== EventSource.CLOSED) return; // browser is retrying by itself
      const r = await fetch('/api/me').catch(() => null);
      if (r?.status === 401) onSignedOut();
      else setTimeout(() => setConn((c) => c + 1), 2000);
    };
    es.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === 'snapshot') setSnap(msg);
      else if (msg.type === 'reroute') {
        setReroutes((r) => [msg, ...r].slice(0, 6));
        setRerouted((m) => ({ ...m, [msg.linkId]: msg.at }));
      } else if (msg.type === 'conversion') setSales((s) => [msg, ...s].slice(0, 12));
      else if (msg.type === 'reset') { setReroutes([]); setSales([]); setRerouted({}); }
    };
    return () => es.close();
  }, [conn, onSignedOut]);

  // P toggles presenter controls, Escape closes them
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.closest('input, textarea') || confirm || !owner) return;
      if (e.key.toLowerCase() === 'p' && !e.metaKey && !e.ctrlKey) setPresenter((p) => !p);
      if (e.key === 'Escape') setPresenter(false);
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [confirm, owner]);

  const cancelConfirm = useCallback(() => setConfirm(null), []);

  async function runConfirm() {
    setBusy(true);
    try {
      if (confirm === 'reset') {
        const r = await postJson('/api/reset');
        if (r.status === 401) return onSignedOut();
        toast('Data reset');
      } else {
        await postJson('/api/logout').catch(() => {});
        toast('Signed out');
        onSignedOut();
      }
    } catch {
      toast('Couldn’t reach the server. Try again.');
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  }

  return (
    <>
      <nav className="nav">
        <div className="nav-inner">
          <span className="brand"><Logo size={26} /> Smart Links</span>
          <div className="nav-actions">
            <span className={`status ${live ? 'on' : ''}`}>{live ? 'Live' : 'Reconnecting'}</span>
            {owner && (
              <button className={`icon-btn ${presenter ? 'active' : ''}`} onClick={() => setPresenter((p) => !p)}
                      aria-label="Presenter controls" aria-expanded={presenter} title="Presenter controls (P)">
                <Sliders />
              </button>
            )}
            <ThemeToggle theme={theme} setTheme={setTheme} />
            <AccountMenu user={user} theme={theme} setTheme={setTheme}
                         onReset={() => setConfirm('reset')}
                         onSignOut={() => (owner ? setConfirm('signout')
                           : postJson('/api/logout').catch(() => {}).finally(onSignedOut))} />
          </div>
        </div>
        {owner && (
          <div className="tabs" role="tablist" aria-label="Sections">
            {[['dashboard', 'Dashboard'], ['links', 'Links'], ['connections', 'Connections']].map(([id, label]) => (
              <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => goTo(id)}>{label}</button>
            ))}
          </div>
        )}
      </nav>

      {!snap ? (
        <div className="splash"><Spinner size={28} /><p className="muted">Connecting to live data</p></div>
      ) : (
        tab === 'links' ? <LinksPage snap={snap} cfgState={cfgState} toast={toast} goTo={goTo} />
        : tab === 'connections' ? <ConnectionsPage cfgState={cfgState} toast={toast} />
        : <Content snap={snap} reroutes={reroutes} sales={sales} rerouted={rerouted}
                   onReset={owner ? () => setConfirm('reset') : null} onManage={owner ? () => goTo('links') : null} />
      )}

      {owner && presenter && snap && <PresenterSheet snap={snap} toast={toast} onClose={() => setPresenter(false)} onSignedOut={onSignedOut} />}

      <ConfirmDialog
        open={confirm === 'reset'}
        title="Reset all data?"
        message="Clicks, sales and earnings go back to zero for everyone viewing this demo."
        confirmLabel="Reset" destructive busy={busy}
        onConfirm={runConfirm} onCancel={cancelConfirm} />
      <ConfirmDialog
        open={confirm === 'signout'}
        title="Sign out?"
        message={owner ? 'You’ll need the demo password to sign back in.' : 'You can come back as a visitor any time.'}
        confirmLabel="Sign out" busy={busy}
        onConfirm={runConfirm} onCancel={cancelConfirm} />
    </>
  );
}

function AccountMenu({ user, theme, setTheme, onReset, onSignOut }) {
  const owner = user.role === 'owner';
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    addEventListener('mousedown', onDown);
    addEventListener('keydown', onKey);
    return () => { removeEventListener('mousedown', onDown); removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <div className="account" ref={ref}>
      <button className="avatar" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}
              aria-label="Account">{owner ? user.email[0].toUpperCase() : 'V'}</button>
      {open && (
        <div className="menu" role="menu">
          <p className="menu-email">{owner ? user.email : 'Visitor, view only'}</p>
          <div className="menu-row"><span>Appearance</span><ThemeSegmented theme={theme} setTheme={setTheme} /></div>
          <hr />
          {owner && <button role="menuitem" className="menu-item" onClick={() => { setOpen(false); onReset(); }}>Reset data</button>}
          <button role="menuitem" className={`menu-item ${owner ? 'danger' : ''}`} onClick={() => { setOpen(false); onSignOut(); }}>
            {owner ? 'Sign out' : 'Sign in with password'}
          </button>
        </div>
      )}
    </div>
  );
}

function Content({ snap, reroutes, sales, rerouted, onReset, onManage }) {
  const { totals, links, series } = snap;
  const fmt = (n) => money(n, snap.currency, snap.locale);
  const cr = totals.clicks ? totals.conversions / totals.clicks : 0;
  const lift = totals.baseline > 0 ? (totals.earnings - totals.baseline) / totals.baseline : null;

  return (
    <main className="page">
      <header className="page-head">
        <div>
          <h1>Smart links</h1>
          <p className="muted">Each click goes to the store converting best right now.</p>
        </div>
        {onReset && <button className="btn btn-gray" onClick={onReset}>Reset data</button>}
      </header>

      <dl className="metrics">
        <Metric label="Clicks" value={totals.clicks.toLocaleString()}
          note={totals.liveClicks > 0 ? `${totals.liveClicks.toLocaleString()} from real shoppers`
            : snap.simulated ? 'Simulated demo traffic' : null} />
        <Metric label="Conversion rate" value={pct(cr)} />
        <Metric label="Earnings" value={fmt(totals.earnings)}
          note={lift === null ? 'Comparing with fixed links…' : (
            <><strong className={lift >= 0 ? 'up' : 'down'}>{lift >= 0 ? '+' : ''}{(lift * 100).toFixed(0)}%</strong> vs {fmt(totals.baseline)} with fixed links</>
          )} />
        <Metric label="Reroutes" value={totals.reroutes} accent />
      </dl>

      <section className="grid">
        <div className="card">
          <div className="card-head">
            <h2>Clicks and sales</h2>
            <div className="legend"><span className="c">Clicks</span><span className="s">Sales</span></div>
          </div>
          <div className="chart">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={series} margin={{ top: 8, right: 4, left: -24, bottom: 0 }}>
                <defs>
                  <linearGradient id="gClicks" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={cssVar('--accent')} stopOpacity={0.5} /><stop offset="100%" stopColor={cssVar('--accent')} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gSales" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={cssVar('--green-fill')} stopOpacity={0.45} /><stop offset="100%" stopColor={cssVar('--green-fill')} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="t" tickFormatter={clock} minTickGap={70} tick={{ fontSize: 11, fill: cssVar('--muted') }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: cssVar('--muted') }} axisLine={false} tickLine={false} />
                <Tooltip labelFormatter={clock}
                  contentStyle={{ background: cssVar('--elevated'), border: 'none', borderRadius: 12, boxShadow: '0 8px 24px rgba(0,0,0,.15)', color: cssVar('--ink') }} />
                <Area type="monotone" dataKey="clicks" name="Clicks" stroke={cssVar('--accent')} strokeWidth={2.5} fill="url(#gClicks)" isAnimationActive={false} />
                <Area type="monotone" dataKey="conversions" name="Sales" stroke={cssVar('--green-fill')} strokeWidth={2.5} fill="url(#gSales)" isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card feed">
          <h2>Routing changes</h2>
          {reroutes.length === 0 ? (
            <p className="muted small">When a store starts converting better, traffic switches to it and shows up here.</p>
          ) : (
            <ol>
              {reroutes.map((e) => (
                <li key={e.id} className="reroute">
                  <p><strong>{e.linkTitle}</strong> now goes to <strong className="to">{e.toName}</strong></p>
                  <time>{clock(e.at)}</time>
                  <p className="why">
                    {e.reason === 'stock' ? `${e.fromName} is out of stock`
                      : e.reason === 'restock' ? `${e.toName} is back in stock`
                      : `${pct(e.toCr)} recent conversion vs ${pct(e.fromCr)} at ${e.fromName}`}
                  </p>
                </li>
              ))}
            </ol>
          )}
          <h2 className="feed-sales">Latest sales</h2>
          {sales.length === 0 ? <p className="muted small">Sales appear here as they come in.</p> : (
            <ol className="sales">
              {sales.map((e) => (
                <li key={e.id}><span>{e.linkTitle} at {e.storeName}</span><span className="amount">+{fmt(e.commission)}</span></li>
              ))}
            </ol>
          )}
        </div>
      </section>

      <section>
        <div className="section-head">
          <h2 className="section-title">Active links</h2>
          {onManage && <button className="btn btn-gray btn-small" onClick={onManage}>Manage links</button>}
        </div>
        {links.length === 0 ? <p className="muted">No links yet.{onManage && ' Create one under Links.'}</p> : (
          <div className="links">
            {links.map((l) => <LinkCard key={l.id} link={l} fmt={fmt} justRerouted={Date.now() - (rerouted[l.id] || 0) < 4000} />)}
          </div>
        )}
      </section>
    </main>
  );
}

function PresenterSheet({ snap, toast, onClose, onSignedOut }) {
  const [pending, setPending] = useState(null);
  async function event(kind, s) {
    setPending(`${kind}-${s.id}`);
    try {
      const r = await postJson('/api/sim/event', { kind, storeId: s.id });
      if (r.status === 401) return onSignedOut();
      toast(EVENT_TOAST[kind](s.name));
    } catch {
      toast('Couldn’t reach the server. Try again.');
    } finally {
      setPending(null);
    }
  }
  const Btn = ({ kind, s, children, className = '' }) => (
    <button className={`btn btn-small ${className}`} disabled={!!pending} onClick={() => event(kind, s)}>
      {pending === `${kind}-${s.id}` ? <Spinner size={14} /> : children}
    </button>
  );

  return (
    <aside className="sheet" aria-label="Presenter controls">
      <div className="sheet-head">
        <h2>Presenter controls</h2>
        <button className="icon-btn" onClick={onClose} aria-label="Close presenter controls"><Close /></button>
      </div>
      <p className="muted small">Out of stock reroutes instantly. A flash sale takes 20 to 40 seconds while the router measures it. Press P to show or hide.</p>
      <label className="switch-row">
        <span>Random events</span>
        <input type="checkbox" className="switch" checked={snap.autoEvents}
               onChange={(e) => postJson('/api/sim/auto', { on: e.target.checked }).then(() =>
                 toast(e.target.checked ? 'Random events on' : 'Random events off'))} />
      </label>
      <ul className="sheet-stores">
        {snap.stores.map((s) => (
          <li key={s.id}>
            <div className="sheet-store-name">{s.name}{s.outOfStock && <span className="pill-red">Out of stock</span>}</div>
            <div className="sheet-actions">
              <Btn kind="flash" s={s}>Flash sale</Btn>
              <Btn kind="slump" s={s}>Sales slump</Btn>
              {s.outOfStock ? <Btn kind="restock" s={s}>Back in stock</Btn>
                : <Btn kind="outage" s={s} className="btn-danger-text">Out of stock</Btn>}
            </div>
          </li>
        ))}
      </ul>
    </aside>
  );
}

function Metric({ label, value, accent, note }) {
  return (
    <div className={`metric ${accent ? 'accent' : ''}`}>
      <dt>{label}</dt>
      <dd>{value}</dd>
      {note && <dd className="metric-note">{note}</dd>}
    </div>
  );
}

function LinkCard({ link, justRerouted, fmt }) {
  const sum = (k) => link.stores.reduce((a, s) => a + s[k], 0);
  const clicks = sum('clicks');
  const active = link.stores.find((s) => s.id === link.active);

  return (
    <article className={`card link ${justRerouted ? 'rerouted' : ''}`}>
      <h3>{link.title}</h3>
      <span className="slug">{location.host}/{link.slug}</span>
      <p className="routing"><span className="live-dot" aria-hidden="true" />Routing to <strong>{active.name}</strong></p>
      <div className="split" role="img" aria-label="Share of clicks by store">
        {link.stores.map((s) => (
          <span key={s.id} className={s.id === link.active ? 'on' : ''}
                style={{ flexGrow: clicks ? s.clicks : 1 }} title={`${s.name}: ${s.clicks} clicks`} />
        ))}
      </div>
      <ul className="stores">
        {link.stores.map((s) => (
          <li key={s.id} className={`${s.id === link.active ? 'on' : ''} ${s.outOfStock ? 'out' : ''}`}>
            <span>{s.name}</span><span>{s.outOfStock ? 'Out of stock' : pct(s.recentCr)}</span>
          </li>
        ))}
      </ul>
      <dl className="link-stats">
        <div><dt>Clicks</dt><dd>{clicks.toLocaleString()}</dd></div>
        <div><dt>Conv. rate</dt><dd>{pct(clicks ? sum('conversions') / clicks : 0)}</dd></div>
        <div><dt>Earned</dt><dd>{fmt(sum('earnings'))}</dd></div>
      </dl>
    </article>
  );
}
