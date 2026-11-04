import { useEffect, useState } from 'react';
import { api } from '../../services/api.js';
import { dateRangeError, rentalToday } from '../../utils/dates.js';
import CarCard from './CarCard.jsx';
import { price } from '../../utils/cars.js';

export default function Availability({ carId, initialStart = '', initialEnd = '' }) {
  const [dates, setDates] = useState({ startDate: initialStart, endDate: initialEnd });
  const initialError = initialStart || initialEnd ? dateRangeError(initialStart, initialEnd) : '';
  const [query, setQuery] = useState(initialStart && initialEnd && !initialError ? { startDate: initialStart, endDate: initialEnd } : null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(initialError);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!query) return;
    const controller = new AbortController();
    setLoading(true); setError(''); setResult(null);
    async function load() {
      try {
        const { data: availability } = await api.get(`/cars/${carId}/availability`, { params: query, signal: controller.signal });
        const alternatives = availability.available ? null : (await api.get('/cars/alternatives', { params: { ...query, carId }, signal: controller.signal })).data;
        if (!controller.signal.aborted) setResult({ availability, alternatives });
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure.response?.data?.error?.message || 'Unable to check availability. Please try again.');
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }
    load();
    return () => controller.abort();
  }, [carId, query]);
  function change(event) {
    setDates({ ...dates, [event.target.name]: event.target.value });
    setQuery(null); setResult(null); setError(''); setLoading(false);
  }
  function submit(event) {
    event.preventDefault();
    const message = dateRangeError(dates.startDate, dates.endDate);
    setError(message); setResult(null);
    if (!message) setQuery({ ...dates });
  }
  return <section className="availability-section" aria-labelledby="availability-heading">
    <p className="eyebrow">PLAN YOUR JOURNEY</p><h2 id="availability-heading">Check availability</h2>
    <p className="availability-note" id="date-help">Pickup day is included; return day is excluded. Dates use Europe/Istanbul time. Availability can change before a booking is confirmed.</p>
    <form className="availability-form" onSubmit={submit} noValidate aria-describedby="date-help">
      <label>Pickup date<input type="date" name="startDate" min={rentalToday()} max="9999-12-30" required value={dates.startDate} onChange={change} /></label>
      <label>Return date<input type="date" name="endDate" min={dates.startDate || rentalToday()} max="9999-12-31" required value={dates.endDate} onChange={change} /></label>
      <button className="primary-button" disabled={loading}>{loading ? 'Checking…' : 'Check dates'}</button>
    </form>
    <div aria-busy={loading} className="availability-result">
      {loading && <p role="status">Checking availability and alternatives…</p>}
      {error && <div className="state-panel" role="alert"><p>{error}</p>{query && <button onClick={() => setQuery({ ...dates })}>Try again</button>}</div>}
      {result && <>
        <div className="availability-summary" role="status"><h3>{result.availability.available ? 'Available for your dates' : 'Unavailable for your dates'}</h3>
          <p>{result.availability.startDate} → {result.availability.endDate}</p>
          {!result.availability.available && <p>{result.availability.reason === 'maintenance' ? 'This car is currently under maintenance.' : 'This car is reserved during part or all of your selected dates.'}</p>}
          {result.availability.available && <p>Booking will be available soon. The displayed daily price is a list price.</p>}
        </div>
        {result.alternatives && <section aria-labelledby="alternatives-heading"><h3 id="alternatives-heading">Available alternatives</h3>
          <p className="availability-note">Available for the same dates. Ranked by category match, then daily price difference, seat count proximity and transmission match. Showing up to 6 cars.</p>
          {result.alternatives.items.length ? <div className="car-grid alternative-grid">{result.alternatives.items.map(car => <div className="alternative-item" key={car.id}>
            <CarCard car={car} dateRange={{ startDate: result.availability.startDate, endDate: result.availability.endDate }} />
            <p className="match-reasons">{car.match.sameCategory ? 'Same category' : 'Different category'} · {price(car.match.dailyPriceDifference)} daily price difference · {car.match.seatDifference === 0 ? 'Same seat count' : `${car.match.seatDifference > 0 ? '+' : ''}${car.match.seatDifference} seats`} · {car.match.sameTransmission ? 'Same transmission' : 'Different transmission'}</p>
          </div>)}</div> : <div className="state-panel"><h4>No alternatives available for these dates</h4><p>Try a different pickup or return date.</p></div>}
        </section>}
      </>}
    </div>
  </section>;
}
