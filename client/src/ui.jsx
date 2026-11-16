import { useCallback, useEffect, useRef, useState } from 'react';

// ---------- spinner (Apple-style activity indicator) ----------
export function Spinner({ size = 18, label = 'Loading' }) {
  return (
    <span className="spinner" style={{ '--s': `${size}px` }} role="status" aria-label={label}>
      {Array.from({ length: 8 }, (_, i) => <i key={i} style={{ '--i': i }} />)}
    </span>
  );
}

// ---------- theme ----------
const THEME_KEY = 'sl-theme';
export function useTheme() {
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem(THEME_KEY) || 'auto'; } catch { return 'auto'; }
  });
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'auto') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
    try { localStorage.setItem(THEME_KEY, theme); } catch {}
  }, [theme]);
  return [theme, setTheme];
}
const prefersDark = () => matchMedia('(prefers-color-scheme: dark)').matches;
export const isDark = (theme) => theme === 'dark' || (theme === 'auto' && prefersDark());

export function ThemeToggle({ theme, setTheme }) {
  const dark = isDark(theme);
  return (
    <button className="icon-btn" onClick={() => setTheme(dark ? 'light' : 'dark')}
            aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'} title={dark ? 'Light mode' : 'Dark mode'}>
      {dark ? <Sun /> : <Moon />}
    </button>
  );
}

export function ThemeSegmented({ theme, setTheme }) {
  return (
    <div className="seg" role="group" aria-label="Appearance">
      {[['light', 'Light'], ['dark', 'Dark'], ['auto', 'Auto']].map(([v, l]) => (
        <button key={v} type="button" aria-pressed={theme === v} onClick={() => setTheme(v)}>{l}</button>
      ))}
    </div>
  );
}

// ---------- confirmation dialog ----------
export function ConfirmDialog({ open, title, message, confirmLabel = 'Confirm', destructive, busy, onConfirm, onCancel }) {
  const cancelRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onCancel(); };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [open, busy, onCancel]);
  if (!open) return null;
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && !busy && onCancel()}>
      <div className="alert" role="alertdialog" aria-modal="true" aria-labelledby="alert-title" aria-describedby="alert-msg">
        <h2 id="alert-title">{title}</h2>
        <p id="alert-msg">{message}</p>
        <div className="alert-actions">
          <button ref={cancelRef} className="btn btn-gray" onClick={onCancel} disabled={busy}>Cancel</button>
          <button className={`btn ${destructive ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm} disabled={busy}>
            {busy ? <Spinner size={16} label="Working" /> : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- toasts ----------
export function useToasts() {
  const [toasts, setToasts] = useState([]);
  const show = useCallback((text) => {
    const id = Math.random();
    setToasts((t) => [...t.slice(-2), { id, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2800);
  }, []);
  return [toasts, show];
}
export function Toasts({ toasts }) {
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => <div key={t.id} className="toast">{t.text}</div>)}
    </div>
  );
}

// ---------- icons ----------
const Svg = ({ children, size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
       strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);
export const Sun = () => <Svg><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></Svg>;
export const Moon = () => <Svg><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" /></Svg>;
export const Sliders = () => <Svg><path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" /></Svg>;
export const Close = () => <Svg><path d="M6 6l12 12M18 6 6 18" /></Svg>;
export const Eye = () => <Svg><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></Svg>;
export const EyeOff = () => <Svg><path d="M3 3l18 18M10.6 5.1A10.7 10.7 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2" /></Svg>;
export const Logo = ({ size = 28 }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
    <rect width="32" height="32" rx="8" fill="var(--accent)" />
    <path d="M7 16h7l5-6h6M14 16l5 6h6" stroke="#fff" strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// ---------- modal sheet ----------
export function Modal({ title, onClose, children, footer, wide, busy }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose(); };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [onClose, busy]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} disabled={busy} aria-label="Close"><Close /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export const money = (n, currency = 'USD', locale = 'en-US') =>
  n.toLocaleString(locale, { style: 'currency', currency, maximumFractionDigits: currency === 'INR' ? 0 : 2 });

export const Plus = () => <Svg><path d="M12 5v14M5 12h14" /></Svg>;
export const Copy = () => <Svg size={16}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h9" /></Svg>;
export const Trash = () => <Svg size={16}><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" /></Svg>;
