import { useEffect, useState } from 'react';
import Navbar from './components/layout/Navbar.jsx';
import Catalog from './pages/Catalog.jsx';
import CarDetails from './pages/CarDetails.jsx';
import { AuthPage, ProfilePage, ProtectedPage, AdminPage } from './pages/Account.jsx';

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
  return <>
    <a className="skip-link" href="#main">Skip to content</a><Navbar />
    <main id="main" tabIndex="-1">{route === '#/login' ? <AuthPage key="login" /> : route === '#/register' ? <AuthPage key="register" register /> : route === '#/account' ? <ProtectedPage><ProfilePage /></ProtectedPage> : route === '#/admin' ? <ProtectedPage admin><AdminPage /></ProtectedPage> : detail ? <CarDetails key={route} id={detail[1]} initialStart={dateParams.get('startDate') || ''} initialEnd={dateParams.get('endDate') || ''} /> : route === '#/' || route === '#main' ? <Catalog /> : <section className="state-panel"><h1>Page not found</h1><a href="#/">Back to catalog</a></section>}</main>
    <footer><a className="brand" href="#/">smartrent.</a><p>Discover your next journey.</p><span>Car rental management system</span></footer>
  </>;
}
