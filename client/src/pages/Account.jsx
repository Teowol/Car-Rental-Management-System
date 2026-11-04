import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../services/api.js';
const failureMessage = error => error.response?.data?.error?.message || 'Unable to connect. Please try again.';
export function ProtectedPage({ admin = false, children }) {
  const { user, loading, error, refresh } = useAuth();
  if (loading) return <section className="state-panel" role="status">Checking your session…</section>;
  if (error) return <section className="state-panel"><p role="alert">{error}</p><button onClick={() => refresh()}>Try again</button></section>;
  if (!user) return <section className="state-panel"><h1>Sign in required</h1><p>Sign in to access your account.</p><a href="#/login">Sign in</a></section>;
  if (admin && user.role !== 'admin') return <section className="state-panel"><h1>Access denied</h1><p>Administrator access required.</p><a href="#/account">My account</a></section>;
  return children;
}
export function AuthPage({ register = false }) {
  const { user, loading, authenticate } = useAuth();
  const [values, setValues] = useState({ email: '', password: '', fullName: '', phone: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const change = event => setValues({ ...values, [event.target.name]: event.target.value });
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      await authenticate(register ? 'register' : 'login', register ? values : { email: values.email, password: values.password });
      window.location.hash = '#/account';
    } catch (failure) { setError(failureMessage(failure)); }
    finally { setBusy(false); }
  }
  if (loading) return <section className="state-panel" role="status">Checking your session…</section>;
  if (user) return <section className="state-panel"><h1>You are signed in</h1><a href="#/account">My account</a></section>;
  return <section className="account-page"><p className="eyebrow">YOUR SMARTRENT ACCOUNT</p><h1>{register ? 'Create account' : 'Welcome back'}</h1>
    <p>{register ? 'Save your profile for your next journey.' : 'Sign in to manage your profile.'}</p>
    <form className="account-form" onSubmit={submit}>
      {register && <label>Full name<input name="fullName" value={values.fullName} onChange={change} autoComplete="name" maxLength={100} required /></label>}
      <label>Email<input name="email" type="email" value={values.email} onChange={change} autoComplete="email" maxLength={254} required /></label>
      <label>Password<input name="password" type="password" value={values.password} onChange={change} autoComplete={register ? 'new-password' : 'current-password'} minLength={12} maxLength={128} required aria-describedby="password-help" /></label>
      <p id="password-help" className="form-hint">Use 12 to 128 characters.</p>
      {register && <label>Phone (optional)<input name="phone" type="tel" value={values.phone} onChange={change} autoComplete="tel" maxLength={30} /></label>}
      {error && <p role="alert">{error}</p>}
      <button className="primary-button" disabled={busy}>{busy ? 'Please wait…' : register ? 'Create account' : 'Sign in'}</button>
    </form>
    <p>{register ? 'Already have an account? ' : 'New to SmartRent? '}<a href={register ? '#/login' : '#/register'}>{register ? 'Sign in' : 'Create account'}</a></p>
  </section>;
}
export function ProfilePage() {
  const { user, updateProfile } = useAuth();
  const [values, setValues] = useState({ fullName: user.fullName, email: user.email, phone: user.phone });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError(''); setSaved(false);
    try { await updateProfile(values); setSaved(true); }
    catch (failure) { setError(failureMessage(failure)); }
    finally { setBusy(false); }
  }
  return <section className="account-page"><p className="eyebrow">YOUR SMARTRENT ACCOUNT</p><h1>My profile</h1><p>Keep your contact details up to date.</p>
    <form className="account-form" onSubmit={submit}>
      <label>Full name<input autoComplete="name" value={values.fullName} maxLength={100} required onChange={e => { setSaved(false); setValues({ ...values, fullName: e.target.value }); }} /></label>
      <label>Email<input type="email" autoComplete="email" value={values.email} maxLength={254} required onChange={e => { setSaved(false); setValues({ ...values, email: e.target.value }); }} /></label>
      <label>Phone (optional)<input type="tel" autoComplete="tel" value={values.phone} maxLength={30} onChange={e => { setSaved(false); setValues({ ...values, phone: e.target.value }); }} /></label>
      {error && <p role="alert">{error}</p>}{saved && <p role="status">Profile saved.</p>}
      <button className="primary-button" disabled={busy}>{busy ? 'Saving…' : 'Save profile'}</button>
    </form>
  </section>;
}
export function AdminPage() {
  const [state, setState] = useState({ loading: true });
  useEffect(() => {
    let active = true;
    api.get('/admin/access').then(() => { if (active) setState({ loading: false }); }).catch(error => { if (active) setState({ error: failureMessage(error) }); });
    return () => { active = false; };
  }, []);
  return <section className="account-page"><h1>Administrator workspace</h1>{state.loading ? <p role="status">Verifying access…</p> : state.error ? <p role="alert">{state.error}</p> : <><p>Your administrator access is verified.</p><p>Vehicle, reservation and customer management tools are coming soon.</p></>}</section>;
}
