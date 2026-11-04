import { useState } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
export default function Navbar() {
  const { user, loading, logout } = useAuth();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function signOut() {
    setBusy(true); setError('');
    try { await logout(); }
    catch { setError('Unable to sign out. Please try again.'); }
    finally { setBusy(false); }
  }
  return <header className="topbar"><a className="brand" href="#/">smart<span>rent</span><span className="brand-dot">.</span></a><nav aria-label="Main navigation"><a href="#/">Car catalog <span aria-hidden="true">↗</span></a>{!loading && (user ? <><a href="#/account">My account</a><a href="#/bookings">My bookings</a>{user.role === 'admin' && <a href="#/admin">Admin</a>}<button className="nav-button" disabled={busy} onClick={signOut}>{busy ? 'Signing out…' : 'Sign out'}</button></> : <a href="#/login">Sign in</a>)}{error && <span role="alert">{error}</span>}</nav></header>;
}
