import { useEffect, useState } from 'react';
import { api } from '../services/api.js';
import { CarImage } from '../components/cars/CarCard.jsx';
import { categories, transmissions, fuels, price } from '../utils/cars.js';
import Availability from '../components/cars/Availability.jsx';
export default function CarDetails({ id, initialStart = '', initialEnd = '' }) {
  const [car, setCar] = useState(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => { if (car) document.title = `${car.brand} ${car.model} | SmartRent`; }, [car]);
  useEffect(() => {
    const controller = new AbortController();
    setCar(null); setError('');
    api.get(`/cars/${encodeURIComponent(id)}`, { signal: controller.signal }).then(({ data }) => setCar(data)).catch(err => {
      if (!controller.signal.aborted) setError(err.response?.data?.error?.message || 'Unable to load car details.');
    });
    return () => controller.abort();
  }, [id, retry]);
  return <section className="detail-page"><a className="back-link" href="#/">← Back to the catalog</a>
    {error ? <div className="state-panel" role="alert"><h1>{error}</h1><button onClick={() => setRetry(value => value + 1)}>Try again</button></div> : !car ? <p role="status">Loading car details…</p> : <><div className="detail-layout"><div className="detail-visual"><CarImage car={car} /><span>Illustrative car drawing</span></div><div><p className="eyebrow">{categories[car.category]}</p><h1>{car.brand}<br /><em>{car.model}</em></h1><dl className="detail-specs"><div><dt>Transmission</dt><dd>{transmissions[car.transmission]}</dd></div><div><dt>Fuel</dt><dd>{fuels[car.fuelType]}</dd></div><div><dt>Capacity</dt><dd>{car.seats} seats</dd></div><div><dt>Car status</dt><dd>{car.status === 'maintenance' ? 'Under maintenance' : 'Active'}</dd></div></dl><p className="detail-price">{price(car.dailyPrice)} <span>/ day</span></p><p className="availability-note">{car.status === 'maintenance' ? 'This car is currently undergoing maintenance.' : 'Choose pickup and return dates below to check availability.'} The amount shown is the daily list price.</p></div></div><Availability carId={car.id} initialStart={initialStart} initialEnd={initialEnd} /></>}
  </section>;
}
