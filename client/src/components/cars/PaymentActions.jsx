import { useRef, useState } from 'react';
import { api } from '../../services/api.js';

export default function PaymentActions({ reservation, onUpdated, onStarted, disabled }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const requestIds = useRef({});
  const inFlight = useRef(false);
  async function run(outcome) {
    if (inFlight.current || disabled) return;
    inFlight.current = true; setBusy(true); setError(''); onStarted();
    try {
      if (outcome === 'complete') {
        const { data } = await api.patch(`/reservations/${reservation.id}/complete`, {});
        onUpdated(`Rental completed. ${data.pointsEarned} points earned.`);
      } else {
        requestIds.current[outcome] ||= crypto.randomUUID();
        const { data } = await api.post('/payments/simulate', { reservationId: reservation.id, requestId: requestIds.current[outcome], outcome });
        delete requestIds.current[outcome];
        onUpdated(data.payment.status === 'paid' ? 'Simulated payment successful. Reservation confirmed.' : data.payment.status === 'refunded' ? 'This payment has already been refunded.' : 'Simulated payment failed. You can try again.');
      }
    } catch (failure) {
      setError(failure.response?.data?.error?.message || 'Unable to confirm the result. Check Payments and refresh before trying again.');
    } finally { inFlight.current = false; setBusy(false); }
  }
  return <div className="payment-actions"><p>Payment: <strong>{reservation.paymentStatus}</strong>{reservation.paymentId ? ` · Reference #${reservation.paymentId}` : ''}</p>
    {reservation.canPay && <><p className="simulation-note">Simulation only. No money is charged and no card details are required.</p><div className="action-buttons"><button disabled={busy || disabled} onClick={() => run('paid')}>Simulate successful payment</button><button disabled={busy || disabled} onClick={() => run('failed')}>Simulate failed payment</button></div></>}
    {reservation.canComplete && <button disabled={busy || disabled} onClick={() => run('complete')}>Complete rental and earn points</button>}
    {busy && <p role="status">Updating payment and rental…</p>}{error && <p role="alert">{error} <a href="#/payments">View payments</a></p>}
  </div>;
}
