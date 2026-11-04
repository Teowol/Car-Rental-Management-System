import { useEffect, useState } from 'react';
import { api } from '../services/api.js';
import CarFilters, { initialFilters } from '../components/cars/CarFilters.jsx';
import CarGrid from '../components/cars/CarGrid.jsx';

export default function Catalog() {
  const [filters, setFilters] = useState(initialFilters);
  const [query, setQuery] = useState({ ...initialFilters, page: 1 });
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    const params = Object.fromEntries(Object.entries(query).filter(([, value]) => value !== ''));
    api.get('/cars', { params, signal: controller.signal }).then(({ data }) => setResult(data)).catch(err => {
      if (!controller.signal.aborted) setError(err.response?.data?.error?.message || 'Unable to load cars. Check your connection and try again.');
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [query, retry]);
  function reset() { setFilters(initialFilters); setQuery({ ...initialFilters, page: 1 }); }
  return <>
    <section className="catalog-hero"><div><p className="eyebrow">YOUR JOURNEY STARTS HERE</p><h1>The right car<br /><em>for every journey.</em></h1><p className="hero-copy">From city streets to open roads, explore your options.<br />Compare cars and daily rates in one place.</p></div><div className="hero-mark" aria-hidden="true"><span>A simpler way<br />to hit the road.</span><svg viewBox="0 0 180 100"><path d="M10 85C80 85 35 15 110 15h55M135 0l30 15-30 16" fill="none" stroke="currentColor" strokeWidth="2" /></svg><small>SMARTRENT / THE COLLECTION</small></div></section>
    <div className="catalog-layout"><aside aria-label="Car filters"><CarFilters filters={filters} onChange={setFilters} onSubmit={() => setQuery({ ...filters, page: 1 })} onReset={reset} /></aside>
      <section className="results" aria-labelledby="results-heading" aria-busy={loading}>
        <div className="results-heading"><h2 id="results-heading">Car collection</h2><span role="status">{loading ? 'Loading…' : error ? 'Request error' : `${result?.total ?? 0} ${result?.total === 1 ? 'car' : 'cars'}`}</span></div>
        <p className="availability-note">Daily list prices. Open a car to check availability for your pickup and return dates.</p>
        {loading ? <div className="state-panel" role="status">Loading cars…</div> : error ? <div className="state-panel" role="alert"><h3>Unable to display cars</h3><p>{error}</p><button onClick={() => setRetry(value => value + 1)}>Try again</button></div> : result?.items.length ? <><CarGrid cars={result.items} />{result.total > result.pageSize && <nav className="pagination" aria-label="Catalog pages"><button disabled={query.page === 1} onClick={() => setQuery({ ...query, page: query.page - 1 })}>Previous</button><span>Page {query.page} / {Math.ceil(result.total / result.pageSize)}</span><button disabled={query.page * result.pageSize >= result.total} onClick={() => setQuery({ ...query, page: query.page + 1 })}>Next</button></nav>}</> : <div className="state-panel"><h3>No cars match your filters</h3><p>Try a wider price range or a different car category.</p><button onClick={reset}>Clear filters</button></div>}
      </section>
    </div>
  </>;
}
