import { useEffect, useState } from 'react';
import { api } from '../services/api.js';
import { price } from '../utils/cars.js';
import PaymentActions from '../components/cars/PaymentActions.jsx';

export default function MyBookings() {
  const [page, setPage] = useState(1);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [confirmId, setConfirmId] = useState(null);
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(''); setConfirmId(null);
    api.get('/reservations/mine', { params: { page, pageSize: 10 }, signal: controller.signal }).then(({ data }) => { if (!controller.signal.aborted) setResult(data); }).catch(failure => {
      if (!controller.signal.aborted) setError(failure.response?.data?.error?.message || 'Unable to load your bookings.');
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [page, retry]);
  async function cancel(id) {
    if (busy !== null) return;
    setBusy(id); setError(''); setNotice('');
    try {
      const { data } = await api.patch(`/reservations/${id}/cancel`, {});
      setResult(current => ({ ...current, items: current.items.map(item => item.id === id ? data.reservation : item) }));
      setNotice(`Reservation #${id} cancelled.`); setConfirmId(null);
    } catch (failure) { setError(failure.response?.data?.error?.message || 'Unable to confirm cancellation. Refresh your bookings before trying again.'); }
    finally { setBusy(null); }
  }
  return <section className="bookings-page"><p className="eyebrow">YOUR JOURNEYS</p><h1>My bookings</h1><p>Pending reservations hold your dates until cancellation. Cancellation is available before the pickup day; paid reservations are refunded automatically. Earn 1 point per 100 TRY when a paid rental is completed on or after its return date.</p>
    {notice && <p role="status">{notice}</p>}
    {error && <div className="state-panel" role="alert"><p>{error}</p><button onClick={() => setRetry(value => value + 1)}>Try again</button></div>}
    {loading ? <p role="status">Loading bookings…</p> : result?.items.length ? <>
      <div className="booking-list">{result.items.map(item => <article className="booking-record" key={item.id} aria-labelledby={`booking-${item.id}`}>
        <div><p className="eyebrow">RESERVATION #{item.id}</p><h2 id={`booking-${item.id}`}>{item.carName}</h2><p>{item.startDate} → {item.endDate}</p><p className={`booking-status status-${item.status}`}>{item.status}</p></div>
        <div>{item.pricing ? <><p>{item.pricing.rentalDays} {item.pricing.rentalDays === 1 ? 'day' : 'days'} × {price(item.pricing.dailyPrice)}</p><p className="booking-total">Total: <strong>{price(item.pricing.totalAmount)}</strong></p></> : <p>Pricing is unavailable for this earlier record.</p>}
          <PaymentActions reservation={item} disabled={busy !== null} onStarted={() => setNotice('')} onUpdated={message => { setNotice(message); setRetry(value => value + 1); }} />
          {item.canCancel && (confirmId === item.id ? <div className="cancel-confirmation"><p>Cancel reservation #{item.id}?{item.paymentStatus === 'paid' ? ' The simulated payment will be refunded.' : ''}</p><button disabled={busy !== null} onClick={() => cancel(item.id)}>{busy === item.id ? 'Cancelling…' : 'Confirm cancellation'}</button><button disabled={busy !== null} onClick={() => setConfirmId(null)}>Keep reservation</button></div> : <button disabled={busy !== null} onClick={() => setConfirmId(item.id)}>Cancel reservation</button>)}
        </div>
      </article>)}</div>
      {result.total > result.pageSize && <nav className="pagination" aria-label="Booking pages"><button disabled={page === 1 || busy !== null} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page} / {Math.ceil(result.total / result.pageSize)}</span><button disabled={page * result.pageSize >= result.total || busy !== null} onClick={() => setPage(page + 1)}>Next</button></nav>}
    </> : !error && <div className="state-panel"><h2>No bookings yet</h2><p>Choose a car and check your rental dates to get started.</p><a href="#/">Explore cars</a></div>}
  </section>;
}
