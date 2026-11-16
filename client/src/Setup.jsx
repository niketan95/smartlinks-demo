import { useCallback, useEffect, useState } from 'react';
import { ConfirmDialog, Copy, Modal, Plus, Spinner, Trash, money } from './ui.jsx';

export const api = async (method, url, body) => {
  const r = await fetch(url, {
    method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.error || 'Something went wrong. Try again.'), { status: r.status });
  return data;
};

export function useConfig(enabled, region, onSignedOut) {
  const [cfg, setCfg] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    if (!enabled) return;
    api('GET', '/api/config').then(setCfg).catch((e) => (e.status === 401 ? onSignedOut() : setError(e.message)));
  }, [enabled, onSignedOut]);
  useEffect(load, [load, region]);
  return { cfg, setCfg, error, reload: load };
}

const slugify = (s) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
const initials = (name) => name.replace(/[^A-Za-z ]/g, '').split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();

function detectStore(rawUrl, catalog) {
  try {
    const host = new URL(rawUrl.trim()).hostname.replace(/^www\./, '');
    return catalog.find((s) => s.domains.some((d) => host === d || host.endsWith(`.${d}`)))?.id || '';
  } catch { return null; }
}

// ======================= Links page =======================
export function LinksPage({ snap, cfgState, toast, goTo }) {
  const { cfg, setCfg, error } = cfgState;
  const [editing, setEditing] = useState(null); // null | 'new' | link object | { prefill }
  const [importing, setImporting] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);
  const fmt = (n) => money(n, snap.currency, snap.locale);

  if (error) return <main className="page"><p className="form-error">{error}</p></main>;
  if (!cfg) return <div className="splash"><Spinner size={28} /></div>;

  const live = Object.fromEntries(snap.links.map((l) => [l.id, l]));
  const connected = cfg.catalog.filter((s) => s.connected);

  async function remove() {
    setBusy(true);
    try { setCfg(await api('DELETE', `/api/links/${deleting.id}`)); toast(`Deleted ${deleting.title}`); }
    catch (e) { toast(e.message); }
    finally { setBusy(false); setDeleting(null); }
  }

  return (
    <main className="page">
      <header className="page-head">
        <div>
          <h1>Links</h1>
          <p className="muted">One link per product. It sends each shopper to the store converting best right now.</p>
        </div>
        <div className="head-actions">
          <button className="btn btn-gray" onClick={() => setImporting(true)}>Import links</button>
          <button className="btn btn-primary" onClick={() => setEditing('new')} disabled={connected.length < 2}><Plus /> New link</button>
        </div>
      </header>

      {connected.length < 2 && (
        <div className="notice">Connect at least two stores before creating a link. <button className="link-btn" onClick={() => goTo('connections')}>Go to connections</button></div>
      )}

      {cfg.links.length === 0 ? (
        <div className="card empty-state">
          <h2>No links yet</h2>
          <p className="muted">Create your first smart link, or import the affiliate links you already share.</p>
        </div>
      ) : (
        <div className="link-list">
          {cfg.links.map((l) => {
            const s = live[l.id];
            const clicks = s ? s.stores.reduce((a, x) => a + x.clicks, 0) : 0;
            const earned = s ? s.stores.reduce((a, x) => a + x.earnings, 0) : 0;
            return (
              <article key={l.id} className="card link-row">
                <div className="link-row-main">
                  <h3>{l.title}</h3>
                  <button className="slug-copy" onClick={() => navigator.clipboard?.writeText(`https://go.creator/${l.slug}`).then(() => toast('Link copied'), () => toast('Couldn’t copy. Select the link and copy it manually.'))}>
                    go.creator/{l.slug} <Copy />
                  </button>
                  <div className="store-pills">
                    {l.stores.map((st, i) => (
                      <span key={st.id} className={`pill ${s?.active === st.id ? 'on' : ''}`} title={st.url}>
                        {cfg.catalog.find((c) => c.id === st.id)?.name}{i === 0 && <em> fallback</em>}
                      </span>
                    ))}
                  </div>
                </div>
                <dl className="link-row-stats">
                  <div><dt>Clicks</dt><dd>{clicks.toLocaleString()}</dd></div>
                  <div><dt>Earned</dt><dd>{fmt(earned)}</dd></div>
                </dl>
                <div className="link-row-actions">
                  <button className="btn btn-small" onClick={() => setEditing(l)}>Edit</button>
                  <button className="icon-btn danger-icon" onClick={() => setDeleting(l)} aria-label={`Delete ${l.title}`}><Trash /></button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {editing && (
        <LinkForm cfg={cfg} initial={editing === 'new' ? null : editing} toast={toast}
                  onSaved={(c, title, isNew) => { setCfg(c); setEditing(null); toast(isNew ? `Created ${title}` : `Saved ${title}`); }}
                  onClose={() => setEditing(null)} goTo={goTo} />
      )}
      {importing && (
        <ImportModal cfg={cfg} goTo={goTo} onClose={() => setImporting(false)}
                     onContinue={(prefill) => { setImporting(false); setEditing({ prefill }); }} />
      )}
      <ConfirmDialog open={!!deleting} title={`Delete ${deleting?.title}?`}
        message="The short link stops working everywhere you’ve shared it. Its stats are removed from the dashboard."
        confirmLabel="Delete" destructive busy={busy} onConfirm={remove} onCancel={() => setDeleting(null)} />
    </main>
  );
}

function LinkForm({ cfg, initial, onSaved, onClose, goTo }) {
  const editing = initial && initial.id;
  const start = initial?.prefill || initial;
  const connected = cfg.catalog.filter((s) => s.connected);
  const [title, setTitle] = useState(start?.title || '');
  const [slug, setSlug] = useState(start?.slug || '');
  const [slugTouched, setSlugTouched] = useState(!!editing);
  const [stores, setStores] = useState(start?.stores?.length ? start.stores : [{ id: connected[0]?.id || '', url: '' }, { id: connected[1]?.id || '', url: '' }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const setRow = (i, patch) => setStores((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const unused = connected.filter((c) => !stores.some((r) => r.id === c.id));

  async function save() {
    setBusy(true); setError('');
    try {
      const body = { title, slug, stores };
      const c = await api(editing ? 'PUT' : 'POST', editing ? `/api/links/${initial.id}` : '/api/links', body);
      onSaved(c, title.trim(), !editing);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  return (
    <Modal title={editing ? 'Edit link' : 'New smart link'} onClose={onClose} busy={busy} wide
      footer={<>
        <button className="btn btn-gray" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn btn-primary" onClick={save} disabled={busy}>
          {busy ? <><Spinner size={16} /> Saving</> : editing ? 'Save changes' : 'Create link'}
        </button>
      </>}>
      <label className="field">
        <span>Product name</span>
        <input value={title} placeholder="e.g. Wireless earbuds" autoFocus
               onChange={(e) => { setTitle(e.target.value); if (!slugTouched) setSlug(slugify(e.target.value)); }} />
      </label>
      <label className="field">
        <span>Short link</span>
        <span className="prefixed"><span>go.creator/</span>
          <input value={slug} onChange={(e) => { setSlug(e.target.value); setSlugTouched(true); }} placeholder="wireless-earbuds" />
        </span>
      </label>

      <div className="field">
        <span>Stores that sell it</span>
        <p className="hint">Paste the product page from each store. The first store is the fallback before there’s enough data.</p>
        <ol className="store-rows">
          {stores.map((r, i) => (
            <li key={i}>
              <select value={r.id} onChange={(e) => setRow(i, { id: e.target.value })} aria-label={`Store ${i + 1}`}>
                {!r.id && <option value="">Choose store</option>}
                {connected.filter((c) => c.id === r.id || !stores.some((x) => x.id === c.id)).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <input value={r.url} onChange={(e) => setRow(i, { url: e.target.value })} placeholder="https://…" aria-label={`Product page ${i + 1}`} inputMode="url" />
              <button className="icon-btn danger-icon" onClick={() => setStores((rows) => rows.filter((_, j) => j !== i))}
                      disabled={stores.length <= 1} aria-label="Remove store"><Trash /></button>
            </li>
          ))}
        </ol>
        <div className="row-actions">
          <button className="btn btn-small" onClick={() => setStores((rows) => [...rows, { id: unused[0].id, url: '' }])} disabled={!unused.length}><Plus /> Add store</button>
          {cfg.catalog.some((c) => !c.connected) && (
            <button className="link-btn" onClick={() => { onClose(); goTo('connections'); }}>Connect more stores</button>
          )}
        </div>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
    </Modal>
  );
}

function ImportModal({ cfg, onClose, onContinue, goTo }) {
  const [text, setText] = useState('');
  const [rows, setRows] = useState(null);
  const [title, setTitle] = useState('');
  const name = (id) => cfg.catalog.find((c) => c.id === id)?.name;
  const isConnected = (id) => cfg.catalog.find((c) => c.id === id)?.connected;

  function detect() {
    const lines = text.split(/\s+/).map((l) => l.trim()).filter(Boolean);
    setRows(lines.map((url) => ({ url, id: detectStore(url, cfg.catalog) })));
  }
  const usable = (rows || []).filter((r) => r.id && isConnected(r.id));
  const uniqueUsable = usable.filter((r, i) => usable.findIndex((x) => x.id === r.id) === i);

  return (
    <Modal title="Import existing links" onClose={onClose} wide
      footer={rows ? <>
        <button className="btn btn-gray" onClick={() => setRows(null)}>Back</button>
        <button className="btn btn-primary" disabled={!title.trim() || uniqueUsable.length < 1}
                onClick={() => onContinue({ title: title.trim(), slug: slugify(title), stores: uniqueUsable.map(({ id, url }) => ({ id, url })) })}>
          Continue
        </button>
      </> : <>
        <button className="btn btn-gray" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={detect} disabled={!text.trim()}>Find stores</button>
      </>}>
      {!rows ? (
        <>
          <p className="muted small">Paste the links you already share for one product, one per line. Store links and affiliate short links both work (Amazon, Flipkart, Myntra, Best Buy and more).</p>
          <textarea className="textarea" rows={6} value={text} onChange={(e) => setText(e.target.value)} autoFocus
            placeholder={cfg.region === 'in'
              ? 'https://amzn.in/d/xyz123\nhttps://dl.flipkart.com/s/abc456\nhttps://www.myntra.com/sports-shoes/90013/buy'
              : 'https://amzn.to/3xyz123\nhttps://www.bestbuy.com/site/vlog-camera-kit/90002.p\nhttps://www.walmart.com/ip/90001'} />
          <p className="hint">Links from Linktree, Wishlink, LTK or bit.ly hide the store behind them, so you’ll pick the store yourself.</p>
        </>
      ) : (
        <>
          <ul className="import-rows">
            {rows.map((r, i) => (
              <li key={i}>
                <span className="import-url" title={r.url}>{r.url}</span>
                {r.id === null ? <span className="pill-red">Not a valid link</span> : (
                  <select value={r.id} onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, id: e.target.value } : x)))}
                          aria-label="Store for this link">
                    <option value="">Which store?</option>
                    {cfg.catalog.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                )}
                {r.id && (isConnected(r.id)
                  ? <span className="pill-green">Connected</span>
                  : <button className="link-btn small" onClick={() => { onClose(); goTo('connections'); }}>Connect {name(r.id)}</button>)}
              </li>
            ))}
          </ul>
          <label className="field">
            <span>Product name</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Running shoes" autoFocus />
          </label>
          <p className="hint">Next you can review the link and add more stores. Unconnected stores are skipped.</p>
        </>
      )}
    </Modal>
  );
}

// ======================= Connections page =======================
export function ConnectionsPage({ cfgState, toast }) {
  const { cfg, setCfg, error } = cfgState;
  const [connecting, setConnecting] = useState(null);
  const [disconnecting, setDisconnecting] = useState(null);
  const [switchTo, setSwitchTo] = useState(null);
  const [busy, setBusy] = useState(false);

  if (error) return <main className="page"><p className="form-error">{error}</p></main>;
  if (!cfg) return <div className="splash"><Spinner size={28} /></div>;

  async function run(fn, done) {
    setBusy(true);
    try { setCfg(await fn()); done && toast(done); }
    catch (e) { toast(e.message); }
    finally { setBusy(false); setDisconnecting(null); setSwitchTo(null); }
  }
  const regionLabel = (id) => cfg.regions.find((r) => r.id === id)?.label;

  return (
    <main className="page">
      <header className="page-head">
        <div>
          <h1>Connections</h1>
          <p className="muted">Connect the affiliate programs you already use. Your own tracking ID stays on every sale.</p>
        </div>
        <div className="seg seg-lg" role="group" aria-label="Region">
          {cfg.regions.map((r) => (
            <button key={r.id} aria-pressed={cfg.region === r.id} onClick={() => cfg.region !== r.id && setSwitchTo(r.id)}>{r.label}</button>
          ))}
        </div>
      </header>

      <div className="programs">
        {cfg.catalog.map((s) => (
          <article key={s.id} className="card program">
            <div className="program-top">
              <span className="program-logo" aria-hidden="true">{initials(s.name)}</span>
              <div>
                <h3>{s.name}</h3>
                <p className="muted small">{s.program}{s.network !== 'Direct' && ` via ${s.network}`}</p>
              </div>
              {s.connected ? <span className="pill-green">Connected</span> : <span className="pill-gray">Not connected</span>}
            </div>
            <p className="program-meta">
              {s.connected ? <>{s.tagLabel}: <strong>{s.tag}</strong></> : <>About {(s.commission * 100).toFixed(1)}% commission in this demo</>}
            </p>
            <div className="program-actions">
              {s.connected ? <>
                <button className="btn btn-small" onClick={() => setConnecting(s)}>Change ID</button>
                <button className="btn btn-small btn-danger-text" onClick={() => setDisconnecting(s)}>Disconnect</button>
              </> : <button className="btn btn-small btn-primary" onClick={() => setConnecting(s)}>Connect</button>}
            </div>
          </article>
        ))}
      </div>
      <p className="hint page-hint">This is a demo: connecting saves the ID you enter but doesn’t contact the program. The live product would sign in to each program and verify the ID.</p>

      {connecting && (
        <ConnectModal store={connecting} onClose={() => setConnecting(null)}
          onSaved={(c) => { setCfg(c); toast(`${connecting.name} connected`); setConnecting(null); }} />
      )}
      <ConfirmDialog open={!!disconnecting} title={`Disconnect ${disconnecting?.name}?`}
        message="Links can’t send shoppers to this store until you connect it again."
        confirmLabel="Disconnect" destructive busy={busy}
        onConfirm={() => run(() => api('DELETE', `/api/connections/${disconnecting.id}`), `${disconnecting.name} disconnected`)}
        onCancel={() => setDisconnecting(null)} />
      <ConfirmDialog open={!!switchTo} title={`Switch to ${regionLabel(switchTo)}?`}
        message={`Links, connections and dashboard data are replaced with the ${regionLabel(switchTo)} sample set.`}
        confirmLabel="Switch" busy={busy}
        onConfirm={() => run(() => api('POST', '/api/region', { region: switchTo }), `Switched to ${regionLabel(switchTo)}`)}
        onCancel={() => setSwitchTo(null)} />
    </main>
  );
}

function ConnectModal({ store, onClose, onSaved }) {
  const [tag, setTag] = useState(store.tag || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save(e) {
    e?.preventDefault();
    setBusy(true); setError('');
    try {
      await new Promise((r) => setTimeout(r, 700)); // stands in for verifying with the program
      onSaved(await api('POST', '/api/connections', { storeId: store.id, tag }));
    } catch (err) { setError(err.message); setBusy(false); }
  }
  return (
    <Modal title={`Connect ${store.name}`} onClose={onClose} busy={busy}
      footer={<>
        <button className="btn btn-gray" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? <><Spinner size={16} /> Verifying</> : 'Connect'}</button>
      </>}>
      <form onSubmit={save}>
        <p className="muted small">{store.program}{store.network !== 'Direct' && `, through your ${store.network} account`}.</p>
        <label className="field">
          <span>{store.tagLabel}</span>
          <input value={tag} onChange={(e) => setTag(e.target.value)} placeholder={store.tagExample} autoFocus disabled={busy} />
        </label>
        {error && <p className="form-error" role="alert">{error}</p>}
      </form>
    </Modal>
  );
}
