import { useEffect, useState } from 'react';
import Navbar from './components/layout/Navbar.jsx';
import Catalog from './pages/Catalog.jsx';
import CarDetails from './pages/CarDetails.jsx';
import { AuthPage, ProfilePage, ProtectedPage, AdminPage } from './pages/Account.jsx';
import MyBookings from './pages/MyBookings.jsx';
import AccountActivity from './pages/AccountActivity.jsx';

export default function App() {
  const [route, setRoute] = useState(window.location.hash || '#/');
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
  let content;
  if (authRoute) content = <AuthPage key={authRoute[1]} register={authRoute[1] === 'register'} nextPage={nextPage} />;
  else if (route === '#/bookings') content = <ProtectedPage><MyBookings /></ProtectedPage>;
  else if (route === '#/payments' || route === '#/loyalty') content = <ProtectedPage><AccountActivity key={route} loyalty={route === '#/loyalty'} /></ProtectedPage>;
  else if (route === '#/account') content = <ProtectedPage><ProfilePage /></ProtectedPage>;
  else if (route === '#/admin') content = <ProtectedPage admin><AdminPage /></ProtectedPage>;
  else if (detail) content = <CarDetails key={route} id={detail[1]} initialStart={dateParams.get('startDate') || ''} initialEnd={dateParams.get('endDate') || ''} />;
  else if (route === '#/' || route === '#main') content = <Catalog />;
  else content = <section className="state-panel"><h1>Page not found</h1><a href="#/">Back to catalog</a></section>;
  return <>
    <a className="skip-link" href="#main">Skip to content</a><Navbar />
    <main id="main" tabIndex="-1">{content}</main>
    <footer><a className="brand" href="#/">smartrent.</a><p>Discover your next journey.</p><span>Car rental management system</span></footer>
  </>;
}
