import { useCallback, useEffect, useState } from 'react';
import Login from './Login.jsx';
import Dashboard from './Dashboard.jsx';
import { Spinner, Toasts, useTheme, useToasts } from './ui.jsx';

export default function App() {
  const [user, setUser] = useState(undefined); // undefined while checking the session
  const [theme, setTheme] = useTheme();
  const [toasts, toast] = useToasts();
  const signedOut = useCallback(() => setUser(null), []);

  useEffect(() => {
    fetch('/api/me').then((r) => (r.ok ? r.json() : null)).then(setUser).catch(() => setUser(null));
  }, []);

  return (
    <>
      {user === undefined ? (
        <div className="splash"><Spinner size={28} /></div>
      ) : user ? (
        <Dashboard user={user} theme={theme} setTheme={setTheme} toast={toast}
                   onSignedOut={signedOut} />
      ) : (
        <Login theme={theme} setTheme={setTheme}
               onSignedIn={(u) => { setUser(u); toast(u.role === 'owner' ? `Signed in as ${u.email}` : 'Viewing as visitor'); }} />
      )}
      <Toasts toasts={toasts} />
    </>
  );
}
