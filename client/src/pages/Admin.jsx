import { useEffect, useState } from 'react';
import { api } from '../services/api.js';
import { price } from '../utils/cars.js';
import { CarEditor, CustomerEditor } from '../components/admin/Editors.jsx';

const sections = { cars: 'Cars', reservations: 'Reservations', customers: 'Customers', payments: 'Payments' };
const statuses = { cars: ['active', 'maintenance', 'inactive'], reservations: ['pending', 'confirmed', 'cancelled', 'completed'], payments: ['pending', 'paid', 'failed', 'refunded'] };
export default function AdminPage({ section = 'cars' }) {
  const [filters, setFilters] = useState({ search: '', status: '' });
  const [query, setQuery] = useState({ page: 1, pageSize: 10 });
  const [result, setResult] = useState(null), [loading, setLoading] = useState(true);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [retry, setRetry] = useState(0), [editor, setEditor] = useState(null);
  const [confirmation, setConfirmation] = useState(null), [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(''); setConfirmation(null);
    api.get(`/admin/${section}`, { params: query, signal: controller.signal }).then(({ data }) => { if (!controller.signal.aborted) setResult(data); }).catch(failure => {
      if (!controller.signal.aborted) setError(failure.response?.data?.error?.message || 'Unable to load admin records.');
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [section, query, retry]);
  function saved(message) { setNotice(message); setEditor(null); setConfirmation(null); setRetry(value => value + 1); }
  async function perform() {
    if (busy || !confirmation) return;
    setBusy(true); setNotice(''); setError('');
    try {
      const { kind, item, status } = confirmation;
      if (kind === 'deactivate') await api.delete(`/admin/cars/${item.id}`, { data: {} });
      else if (kind === 'refund') await api.post(`/admin/payments/${item.id}/refund`, {});
      else await api.patch(`/admin/reservations/${item.id}`, { status });
      saved(kind === 'deactivate' ? 'Car deactivated. History preserved.' : kind === 'refund' ? 'Simulated payment refunded. Earned points reversed where applicable.' : `Reservation #${item.id} updated to ${status}.`);
    } catch (failure) { setError(failure.response?.data?.error?.message || 'Unable to confirm the change. Refresh the list before trying again.'); }
    finally { setBusy(false); }
  }
  function ask(kind, item, status) { setError(''); setNotice(''); setConfirmation({ kind, item, status }); }
  function edit(item) { setEditor(item); setConfirmation(null); setNotice(''); setError(''); }
  const disabled = busy || editor !== null;
  return <section className="admin-page"><p className="eyebrow">SMARTRENT ADMIN</p><h1>Administrator workspace</h1><p>Manage vehicles, bookings, customer contact details and simulated payments.</p>
    <nav className="admin-tabs" aria-label="Admin sections">{Object.entries(sections).map(([key, label]) => <a key={key} href={`#/admin/${key}`} aria-current={section === key ? 'page' : undefined}>{label}</a>)}</nav>
    <div className="admin-title"><h2>Manage {section}</h2>{section === 'cars' && <button className="primary-button" disabled={disabled} onClick={() => edit({ creating: true })}>Add car</button>}</div>
    {notice && <p role="status" className="admin-notice">{notice}</p>}
    {editor && (section === 'cars' ? <CarEditor key={editor.id || 'new'} car={editor.creating ? null : editor} onSaved={saved} onClose={() => setEditor(null)} /> : <CustomerEditor key={editor.id} customer={editor} onSaved={saved} onClose={() => setEditor(null)} />)}
    <form className="admin-search" onSubmit={event => { event.preventDefault(); setEditor(null); setNotice(''); setQuery({ search: filters.search, ...(statuses[section] ? { status: filters.status } : {}), page: 1, pageSize: 10 }); }}>
      <label>Search {section}<input maxLength={100} value={filters.search} onChange={event => setFilters({ ...filters, search: event.target.value })} /></label>
      {statuses[section] && <div className="filter-field"><label htmlFor="admin-status-filter">Status filter</label><select id="admin-status-filter" value={filters.status} onChange={event => setFilters({ ...filters, status: event.target.value })}><option value="">All statuses</option>{statuses[section].map(status => <option key={status} value={status}>{status}</option>)}</select></div>}
      <button className="primary-button" disabled={busy}>Search</button>
    </form>
    {error && <div role="alert" className="state-panel"><p>{error}</p><button disabled={busy} onClick={() => setRetry(value => value + 1)}>Refresh records</button></div>}
    {loading ? <p role="status">Loading admin records…</p> : result && <><p className="availability-note">{result.total} {result.total === 1 ? 'record' : 'records'}</p>
      {result.items.length ? <div className="admin-records">{result.items.map(item => <article className="admin-record" key={item.id} aria-labelledby={`admin-record-${item.id}`}>
        <div><p className="eyebrow">#{item.id}{section === 'cars' ? ` · ${item.vehicleCode}` : section === 'payments' ? ` · RESERVATION #${item.reservationId}` : ''}</p>
          <h3 id={`admin-record-${item.id}`}>{section === 'cars' ? `${item.brand} ${item.model}` : section === 'customers' ? item.fullName : item.carName}</h3>
          {section === 'cars' ? <><p>{item.category} · {item.seats} seats · {item.transmission} · {item.fuelType}</p><p>{price(item.dailyPrice)} / day · <strong>{item.status}</strong></p><p className="admin-image-path">{item.imageUrl}</p></> : section === 'customers' ? <><p>{item.email}</p><p>{item.phone || 'No phone number'}</p></> : <><p>{item.customerName} · {item.customerEmail}</p><p>Rental: {item.startDate} → {item.endDate}</p><p>Reservation: <strong>{item.reservationStatus}</strong> · Payment: <strong>{item.paymentStatus}</strong></p><p>{item.amount === null ? 'No saved price' : price(item.amount)}{item.paymentId ? ` · Payment #${item.paymentId}` : ''}</p></>}
        </div>
        <div className="admin-actions">{section === 'cars' ? <><button disabled={disabled} onClick={() => edit(item)}>Edit car</button>{item.status !== 'inactive' && <button disabled={disabled} onClick={() => ask('deactivate', item)}>Deactivate car</button>}</> : section === 'customers' ? <button disabled={disabled} onClick={() => edit(item)}>Edit customer</button> : section === 'payments' ? item.status === 'paid' && <button disabled={disabled} onClick={() => ask('refund', item)}>Refund payment</button> : <>{item.canConfirm && <button disabled={disabled} onClick={() => ask('status', item, 'confirmed')}>Confirm reservation</button>}{item.canComplete && <button disabled={disabled} onClick={() => ask('status', item, 'completed')}>Complete rental</button>}{item.canCancel && <button disabled={disabled} onClick={() => ask('status', item, 'cancelled')}>Cancel reservation</button>}</>}
          {confirmation?.item.id === item.id && <div className="admin-confirmation" role="group" aria-label="Confirm admin action"><p>{confirmation.kind === 'deactivate' ? `Deactivate ${item.brand} ${item.model}? Its reservation history will be kept.` : confirmation.kind === 'refund' ? `Refund simulated payment #${item.id} for ${price(item.amount)}? An active rental will be cancelled and earned points reversed.` : confirmation.status === 'cancelled' ? `Cancel reservation #${item.id}? Any paid amount will be refunded and points reversed.` : `Set reservation #${item.id} to ${confirmation.status}? Payment and return-date rules will be checked.`}</p><div className="action-buttons"><button disabled={busy} onClick={perform}>{busy ? 'Applying…' : 'Confirm action'}</button><button disabled={busy} onClick={() => setConfirmation(null)}>Keep unchanged</button></div></div>}
        </div>
      </article>)}</div> : <div className="state-panel"><h3>No records match your filters</h3><p>Try a different search or status.</p></div>}
      {result.total > result.pageSize && <nav className="pagination" aria-label="Admin pages"><button disabled={query.page === 1 || busy} onClick={() => { setEditor(null); setQuery({ ...query, page: query.page - 1 }); }}>Previous</button><span>Page {query.page} / {Math.ceil(result.total / result.pageSize)}</span><button disabled={query.page * result.pageSize >= result.total || busy} onClick={() => { setEditor(null); setQuery({ ...query, page: query.page + 1 }); }}>Next</button></nav>}
    </>}
  </section>;
}
