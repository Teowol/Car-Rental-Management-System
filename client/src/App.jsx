import { useEffect, useState } from 'react';
import Navbar from './components/layout/Navbar.jsx';
import Catalog from './pages/Catalog.jsx';
import CarDetails from './pages/CarDetails.jsx';

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
  const detail = route.match(/^#\/cars\/([^/]+)$/);
  return <>
    <a className="skip-link" href="#main">Skip to content</a><Navbar />
    <main id="main" tabIndex="-1">{detail ? <CarDetails key={detail[1]} id={detail[1]} /> : route === '#/' || route === '#main' ? <Catalog /> : <section className="state-panel"><h1>Page not found</h1><a href="#/">Back to catalog</a></section>}</main>
    <footer><a className="brand" href="#/">smartrent.</a><p>Discover your next journey.</p><span>Car rental management system</span></footer>
  </>;
}