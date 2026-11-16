import { useEffect, useState } from 'react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip } from 'recharts';

const money = (n) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const pct = (n) => `${(n * 100).toFixed(1)}%`;
const clock = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const cssVar = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

export default function App() {
  const [snap, setSnap] = useState(null);
  const [reroutes, setReroutes] = useState([]);
  const [sales, setSales] = useState([]);
  const [rerouted, setRerouted] = useState({}); // linkId -> time of last reroute
  const [live, setLive] = useState(false);

  useEffect(() => {
    const es = new EventSource('/api/stream');
    es.onopen = () => setLive(true);
    es.onerror = () => setLive(false);
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
  }, []);

  if (!snap) {
    return <main className="empty">Connecting to the API on port 4000. Start everything with <code>npm run dev</code>.</main>;
  }

  const { totals, links, series } = snap;
  const cr = totals.clicks ? totals.conversions / totals.clicks : 0;

  return (
    <main>
      <header className="top">
        <div>
          <h1>Smart links</h1>
          <p className="sub">Each click goes to the store converting best right now.</p>
        </div>
        <div className="top-actions">
          <span className={`status ${live ? 'on' : ''}`}>{live ? 'Live' : 'Reconnecting'}</span>
          <button onClick={() => fetch('/api/reset', { method: 'POST' })}>Reset data</button>
        </div>
      </header>

      <dl className="metrics">
        <Metric label="Clicks" value={totals.clicks.toLocaleString()} />
        <Metric label="Conversion rate" value={pct(cr)} />
        <Metric label="Earnings" value={money(totals.earnings)} />
        <Metric label="Reroutes" value={totals.reroutes} accent />
      </dl>

      <section className="grid">
        <div className="panel">
          <h2>Clicks and sales per second</h2>
          <div className="chart">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={series} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                <XAxis dataKey="t" tickFormatter={clock} minTickGap={60} tick={{ fontSize: 12 }} stroke={cssVar('--muted')} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} stroke={cssVar('--muted')} />
                <Tooltip labelFormatter={clock} />
                <Area type="monotone" dataKey="clicks" name="Clicks" stroke={cssVar('--ink')} fill={cssVar('--ink')} fillOpacity={0.08} isAnimationActive={false} />
                <Area type="monotone" dataKey="conversions" name="Sales" stroke={cssVar('--sale')} fill={cssVar('--sale')} fillOpacity={0.3} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="panel feed">
          <h2>Routing changes</h2>
          {reroutes.length === 0 ? (
            <p className="muted small">When a store starts converting better, traffic switches to it and shows up here.</p>
          ) : (
            <ol>
              {reroutes.map((e) => (
                <li key={e.id} className="ev reroute">
                  <p><strong>{e.linkTitle}</strong> now goes to <strong className="to">{e.toName}</strong></p>
                  <time>{clock(e.at)}</time>
                  <p className="muted">{pct(e.toCr)} recent conversion vs {pct(e.fromCr)} at {e.fromName}</p>
                </li>
              ))}
            </ol>
          )}
          <h2 className="feed-sales">Latest sales</h2>
          <ol>
            {sales.map((e) => (
              <li key={e.id} className="ev">
                <p>{e.linkTitle} at {e.storeName}</p>
                <span className="amount">+{money(e.commission)}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="panel">
        <h2>Active links</h2>
        <div className="links">
          {links.map((l) => <LinkCard key={l.id} link={l} justRerouted={Date.now() - (rerouted[l.id] || 0) < 4000} />)}
        </div>
      </section>
    </main>
  );
}

function Metric({ label, value, accent }) {
  return (
    <div className={`metric ${accent ? 'accent' : ''}`}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function LinkCard({ link, justRerouted }) {
  const sum = (k) => link.stores.reduce((a, s) => a + s[k], 0);
  const clicks = sum('clicks');
  const active = link.stores.find((s) => s.id === link.active);

  return (
    <article className={`link ${justRerouted ? 'rerouted' : ''}`}>
      <h3>{link.title}</h3>
      <span className="slug">{link.slug}</span>
      <p className="routing">Routing to <strong>{active.name}</strong></p>

      <div className="split" role="img" aria-label="Share of clicks by store">
        {link.stores.map((s) => (
          <span key={s.id} className={s.id === link.active ? 'on' : ''}
                style={{ flexGrow: clicks ? s.clicks : 1 }} title={`${s.name}: ${s.clicks} clicks`} />
        ))}
      </div>

      <ul className="stores">
        {link.stores.map((s) => (
          <li key={s.id} className={s.id === link.active ? 'on' : ''}>
            <span>{s.name}</span><span>{pct(s.recentCr)}</span>
          </li>
        ))}
      </ul>

      <dl className="link-stats">
        <div><dt>Clicks</dt><dd>{clicks.toLocaleString()}</dd></div>
        <div><dt>Conv. rate</dt><dd>{pct(clicks ? sum('conversions') / clicks : 0)}</dd></div>
        <div><dt>Earned</dt><dd>{money(sum('earnings'))}</dd></div>
      </dl>
    </article>
  );
}
