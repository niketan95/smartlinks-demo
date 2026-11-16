import { useState } from 'react';
import { Eye, EyeOff, Logo, Spinner, ThemeToggle } from './ui.jsx';

export default function Login({ theme, setTheme, onSignedIn }) {
  const [visiting, setVisiting] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [shake, setShake] = useState(false);

  const fail = (msg) => { setError(msg); setShake(true); };

  async function submit(e) {
    e.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(email)) return fail('Enter a valid email address.');
    if (!password) return fail('Enter the demo password.');
    setBusy(true);
    setError('');
    try {
      const r = await fetch('/api/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) return fail(data.error || 'Couldn’t sign in. Try again.');
      onSignedIn(data);
    } catch {
      fail('Can’t reach the server. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function visit() {
    setVisiting(true);
    setError('');
    try {
      const r = await fetch('/api/login/visitor', { method: 'POST' });
      if (!r.ok) throw new Error();
      onSignedIn(await r.json());
    } catch {
      fail('Can’t reach the server. Check your connection and try again.');
    } finally {
      setVisiting(false);
    }
  }

  return (
    <div className="auth">
      <div className="auth-corner"><ThemeToggle theme={theme} setTheme={setTheme} /></div>
      <form className={`auth-card ${shake ? 'shake' : ''}`} onSubmit={submit} onAnimationEnd={() => setShake(false)} noValidate>
        <Logo size={52} />
        <h1>Welcome to Smart Links</h1>
        <p className="muted">Take a look around, or sign in to run the demo.</p>

        <button type="button" className="btn btn-primary btn-block" onClick={visit} disabled={busy || visiting}>
          {visiting ? <><Spinner size={16} label="Opening" /> Opening dashboard</> : 'Continue as visitor'}
        </button>
        <div className="divider"><span>or sign in</span></div>

        <label className="field">
          <span>Email</span>
          <input type="email" autoComplete="email" inputMode="email" value={email}
                 onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" disabled={busy} />
        </label>
        <label className="field">
          <span>Password</span>
          <span className="pw">
            <input type={show ? 'text' : 'password'} autoComplete="current-password" value={password}
                   onChange={(e) => setPassword(e.target.value)} disabled={busy} />
            <button type="button" className="pw-toggle" onClick={() => setShow((s) => !s)}
                    aria-label={show ? 'Hide password' : 'Show password'}>{show ? <EyeOff /> : <Eye />}</button>
          </span>
        </label>

        {error && <p className="form-error" role="alert">{error}</p>}

        <button className="btn btn-gray btn-block" disabled={busy || visiting}>
          {busy ? <><Spinner size={16} label="Signing in" /> Signing in</> : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
