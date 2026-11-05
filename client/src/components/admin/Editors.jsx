import { useState } from 'react';
import { api } from '../../services/api.js';

const defaults = { vehicleCode: '', brand: '', model: '', category: 'economy', seats: 5, transmission: 'manual', fuelType: 'petrol', dailyPrice: '0.00', imageUrl: '/images/car-placeholder.svg', status: 'inactive' };
const message = error => error.response?.data?.error?.message || 'Unable to save. Check your connection and try again.';
export function CarEditor({ car, onSaved, onClose }) {
  const [values, setValues] = useState(car ? Object.fromEntries(Object.keys(defaults).map(key => [key, car[key]])) : defaults);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const change = event => setValues(current => ({ ...current, [event.target.name]: event.target.value }));
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const body = { ...values, seats: Number(values.seats) };
      if (car) await api.patch(`/admin/cars/${car.id}`, body); else await api.post('/admin/cars', body);
      onSaved(car ? 'Car updated.' : 'Car created.');
    } catch (failure) { setError(message(failure)); }
    finally { setBusy(false); }
  }
  return <section className="admin-editor" aria-labelledby="car-editor-heading"><h2 id="car-editor-heading">{car ? `Edit car #${car.id}` : 'Create car'}</h2>
    <form onSubmit={submit} className="admin-form"><fieldset disabled={busy}>
      <label>Vehicle code<input name="vehicleCode" maxLength={30} required value={values.vehicleCode} onChange={change} /></label>
      <label>Brand<input name="brand" maxLength={60} required value={values.brand} onChange={change} /></label>
      <label>Model<input name="model" maxLength={80} required value={values.model} onChange={change} /></label>
      <div className="filter-field"><label htmlFor="admin-car-category">Category</label><select id="admin-car-category" name="category" value={values.category} onChange={change}>{['economy', 'sedan', 'suv', 'van', 'premium'].map(value => <option key={value} value={value}>{value}</option>)}</select></div>
      <label>Seats<input name="seats" type="number" min="1" max="20" step="1" required value={values.seats} onChange={change} /></label>
      <div className="filter-field"><label htmlFor="admin-car-transmission">Transmission</label><select id="admin-car-transmission" name="transmission" value={values.transmission} onChange={change}><option value="manual">Manual</option><option value="automatic">Automatic</option></select></div>
      <div className="filter-field"><label htmlFor="admin-car-fuel">Fuel type</label><select id="admin-car-fuel" name="fuelType" value={values.fuelType} onChange={change}>{['petrol', 'diesel', 'hybrid', 'electric'].map(value => <option key={value} value={value}>{value}</option>)}</select></div>
      <label>Daily price (TRY)<input name="dailyPrice" type="number" min="0" max="9999999999.99" step="0.01" required value={values.dailyPrice} onChange={change} /></label>
      <div className="filter-field"><label htmlFor="admin-car-status">Car status</label><select id="admin-car-status" name="status" value={values.status} onChange={change}>{['active', 'maintenance', 'inactive'].map(value => <option key={value} value={value}>{value}</option>)}</select></div>
      <label className="wide-field">Image URL<input name="imageUrl" maxLength={500} value={values.imageUrl} onChange={change} aria-describedby="image-help" /><span id="image-help" className="form-hint">Use an HTTP(S) URL or an image under /images/.</span></label>
      <p className="wide-field form-hint">Saved reservation prices remain unchanged. Cars with ongoing or upcoming reservations must stay active until those reservations are resolved.</p>
      {error && <p className="wide-field" role="alert">{error}</p>}
      <div className="wide-field action-buttons"><button className="primary-button" disabled={busy}>{busy ? 'Saving…' : car ? 'Save car' : 'Create car'}</button><button type="button" onClick={onClose}>Close editor</button></div>
    </fieldset></form>
  </section>;
}
export function CustomerEditor({ customer, onSaved, onClose }) {
  const [values, setValues] = useState({ fullName: customer.fullName, email: customer.email, phone: customer.phone });
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    try { await api.patch(`/admin/customers/${customer.id}`, values); onSaved('Customer updated.'); }
    catch (failure) { setError(message(failure)); }
    finally { setBusy(false); }
  }
  const change = event => setValues(current => ({ ...current, [event.target.name]: event.target.value }));
  return <section className="admin-editor"><h2>Edit customer #{customer.id}</h2><p>Only contact details can be changed. Account roles and passwords are protected.</p>
    <form className="account-form" onSubmit={submit}><fieldset disabled={busy}>
      <label>Full name<input name="fullName" maxLength={100} required value={values.fullName} onChange={change} /></label>
      <label>Email<input name="email" type="email" maxLength={254} required value={values.email} onChange={change} /></label>
      <label>Phone (optional)<input name="phone" type="tel" maxLength={30} value={values.phone} onChange={change} /></label>
      {error && <p role="alert">{error}</p>}<div className="action-buttons"><button className="primary-button">{busy ? 'Saving…' : 'Save customer'}</button><button type="button" onClick={onClose}>Close editor</button></div>
    </fieldset></form>
  </section>;
}
