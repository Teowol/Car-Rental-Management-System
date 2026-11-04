import { useRef, useState } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { api } from '../../services/api.js';
import { price } from '../../utils/cars.js';

export default function BookingPanel({ quote, onBooked, onConflict, onPriceChanged, onBusyChange }) {
  const { user, loading } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const returnTo = `#/cars/${quote.carId}?${new URLSearchParams({ startDate: quote.startDate, endDate: quote.endDate })}`;
  async function book() {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); onBusyChange(true); setError('');
    try {
      const { data } = await api.post('/reservations', { carId: quote.carId, startDate: quote.startDate, endDate: quote.endDate, expectedDailyPrice: quote.dailyPrice });
      onBooked(data.reservation);
    } catch (failure) {
      const data = failure.response?.data;
      if (data?.error?.code === 'CAR_UNAVAILABLE') onConflict(data.alternatives);
      else {
        setError(data?.error?.message || 'Unable to confirm the result. Check My bookings before trying again.');
        if (data?.error?.code === 'PRICE_CHANGED' && data.quote) onPriceChanged(data.quote);
      }
    } finally { inFlight.current = false; setBusy(false); onBusyChange(false); }
  }
  return <div className="booking-panel"><h3>Review your reservation</h3>
    <p>{quote.rentalDays} {quote.rentalDays === 1 ? 'day' : 'days'} × {price(quote.dailyPrice)} per day</p>
    <p className="booking-total">Total: <strong>{price(quote.totalAmount)}</strong></p>
    <p>Creating a reservation holds these dates until cancellation. No payment is collected here. You can cancel before the pickup day.</p>
    {error && <p role="alert">{error} <a href="#/bookings">My bookings</a></p>}
    {loading ? <p role="status">Checking your session…</p> : user ? <button className="primary-button" onClick={book} disabled={busy}>{busy ? 'Creating reservation…' : 'Create reservation'}</button> : <a className="primary-button" href={`#/login?next=${encodeURIComponent(returnTo)}`}>Sign in to book</a>}
  </div>;
}
