import { useEffect, useState } from 'react';
import { api } from '../services/api.js';
import { price } from '../utils/cars.js';

export default function AccountActivity({ loyalty = false }) {
  const [result, setResult] = useState(null);
  const [page, setPage] = useState(1);
  const [retry, setRetry] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    api.get(loyalty ? '/loyalty/mine' : '/payments/mine', { params: { page, pageSize: 10 }, signal: controller.signal }).then(({ data }) => { if (!controller.signal.aborted) setResult(data); }).catch(failure => {
      if (!controller.signal.aborted) setError(failure.response?.data?.error?.message || 'Unable to load your activity.');
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [loyalty, page, retry]);
  return <section className="bookings-page"><p className="eyebrow">YOUR SMARTRENT ACCOUNT</p><h1>{loyalty ? 'Loyalty points' : 'My payments'}</h1>
    <p>{loyalty ? 'Earn 1 point per 100 TRY on paid rentals, once completed on or after the return date. Refunds reverse the earned points. Points have no cash value.' : 'All payments and refunds shown here are simulated. No real money is charged. Payment attempts are made from My bookings.'}</p>
    {loading ? <p role="status">Loading activity…</p> : error ? <div className="state-panel" role="alert"><p>{error}</p><button onClick={() => setRetry(value => value + 1)}>Try again</button></div> : result && <>
      {loyalty && <div className="loyalty-balance" role="status"><span>Available points</span><strong>{BigInt(result.balance).toLocaleString('en-GB')}</strong></div>}
      {result.items.length ? <div className="booking-list">{result.items.map(item => <article className="booking-record activity-record" key={item.id}>
        <div><p className="eyebrow">RESERVATION #{item.reservationId}</p><h2>{loyalty ? item.reason === 'earned' ? 'Rental points earned' : 'Refund points reversal' : item.carName}</h2>
          <p>{loyalty ? item.createdAt : `Payment reference #${item.id}`}</p>
        </div><div>{loyalty ? <p className="points-delta">{BigInt(item.pointsDelta) >= 0n ? '+' : ''}{BigInt(item.pointsDelta).toLocaleString('en-GB')} points</p> : <><p className="booking-total">{price(item.amount)}</p><p className={`booking-status status-${item.status}`}>{item.status}</p><p>{item.methodLabel} · {item.attemptCount} {item.attemptCount === 1 ? 'attempt' : 'attempts'}</p><p>Reservation: {item.reservationStatus}</p>{item.paidAt && <p>Paid: {item.paidAt}</p>}{item.refundedAt && <p>Refunded: {item.refundedAt}</p>}</>}</div>
      </article>)}</div> : <div className="state-panel"><h2>{loyalty ? 'No points activity yet' : 'No payments yet'}</h2><a href="#/bookings">View my bookings</a></div>}
      {result.total > result.pageSize && <nav className="pagination" aria-label="Activity pages"><button disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page} / {Math.ceil(result.total / result.pageSize)}</span><button disabled={page * result.pageSize >= result.total} onClick={() => setPage(page + 1)}>Next</button></nav>}
    </>}
  </section>;
}
