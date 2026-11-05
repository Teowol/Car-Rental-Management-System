import { useEffect, useRef, useState } from 'react';
import Navbar from './components/layout/Navbar.jsx';
import Catalog from './pages/Catalog.jsx';
import CarDetails from './pages/CarDetails.jsx';
import { AuthPage, ProfilePage, ProtectedPage } from './pages/Account.jsx';
import AdminPage from './pages/Admin.jsx';
import MyBookings from './pages/MyBookings.jsx';
import AccountActivity from './pages/AccountActivity.jsx';
import ErrorBoundary from './components/common/ErrorBoundary.jsx';

export default function App() {
  const [route, setRoute] = useState(window.location.hash || '#/');
  const main = useRef(null), previousRoute = useRef(route);
  useEffect(() => {
    const update = () => {
      if (window.location.hash === '#main') return;
      setRoute(window.location.hash || '#/');
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  const detail = route.match(/^#\/cars\/([^/?]+)(?:\?([^#]*))?$/);
  const dateParams = new URLSearchParams(detail?.[2] || '');
  const authRoute = route.match(/^#\/(login|register)(?:\?(.*))?$/);
  const nextPage = new URLSearchParams(authRoute?.[2] || '').get('next') || '';
  useEffect(() => {
    const titles = { '#/': 'Car catalog', '#main': 'Car catalog', '#/bookings': 'My bookings', '#/payments': 'My payments', '#/loyalty': 'Loyalty points', '#/account': 'My profile' };
    const title = authRoute ? authRoute[1] === 'register' ? 'Create account' : 'Sign in' : detail ? 'Car details' : /^#\/admin(?:\/(cars|customers|reservations|payments))?$/.test(route) ? 'Admin ' + (route.split('/')[2] || 'cars') : titles[route] || 'Page not found';
    document.title = title + ' | SmartRent';
    if (previousRoute.current !== route) main.current?.focus({ preventScroll: true });
    previousRoute.current = route;
  }, [route]);
  let content;
  if (authRoute) content = <AuthPage key={authRoute[1]} register={authRoute[1] === 'register'} nextPage={nextPage} />;
  else if (route === '#/bookings') content = <ProtectedPage><MyBookings /></ProtectedPage>;
  else if (route === '#/payments' || route === '#/loyalty') content = <ProtectedPage><AccountActivity key={route} loyalty={route === '#/loyalty'} /></ProtectedPage>;
  else if (route === '#/account') content = <ProtectedPage><ProfilePage /></ProtectedPage>;
  else if (/^#\/admin(?:\/(cars|customers|reservations|payments))?$/.test(route)) content = <ProtectedPage admin><AdminPage key={route} section={route.split('/')[2] || 'cars'} /></ProtectedPage>;
  else if (detail) content = <CarDetails key={route} id={detail[1]} initialStart={dateParams.get('startDate') || ''} initialEnd={dateParams.get('endDate') || ''} />;
  else if (route === '#/' || route === '#main') content = <Catalog />;
  else content = <section className="state-panel"><h1>Page not found</h1><a href="#/">Back to catalog</a></section>;
  return <>
    <a className="skip-link" href="#main" onClick={event => { event.preventDefault(); main.current?.focus(); }}>Skip to content</a><Navbar />
    <main id="main" tabIndex="-1" ref={main}><ErrorBoundary key={route}>{content}</ErrorBoundary></main>
    <footer><a className="brand" href="#/">smartrent.</a><p>Discover your next journey.</p><span>Car rental management system</span></footer>
  </>;
}
