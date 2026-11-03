import { categories, transmissions, fuels } from '../../utils/cars.js';
export const initialFilters = { search: '', category: '', transmission: '', fuelType: '', minSeats: '', minPrice: '', maxPrice: '', sort: 'name' };

export default function CarFilters({ filters, onChange, onSubmit, onReset }) {
  const field = event => onChange({ ...filters, [event.target.name]: event.target.value });
  const select = (name, label, options) => <div className="filter-field"><label htmlFor={name}>{label}</label><select id={name} name={name} value={filters[name]} onChange={field}><option value="">All</option>{Object.entries(options).map(([key, title]) => <option key={key} value={key}>{title}</option>)}</select></div>;
  return <form className="filters" onSubmit={event => { event.preventDefault(); onSubmit(); }}>
    <div className="filter-heading"><h2>Find your car</h2><button className="text-button" type="button" onClick={onReset}>Clear</button></div>
    <label>Brand or model<input name="search" type="search" maxLength={100} value={filters.search} onChange={field} placeholder="e.g. Toyota Corolla" /></label>
    {select('category', 'Car category', categories)}{select('transmission', 'Transmission', transmissions)}{select('fuelType', 'Fuel', fuels)}
    <label>Minimum seats<input name="minSeats" type="number" min="1" max="20" step="1" value={filters.minSeats} onChange={field} placeholder="Any" /></label>
    <fieldset><legend>Daily price (TRY)</legend><div className="price-range"><label className="sr-only" htmlFor="minPrice">Minimum price</label><input id="minPrice" name="minPrice" type="number" min="0" max="9999999999.99" step="0.01" value={filters.minPrice} onChange={field} placeholder="Min" /><span aria-hidden="true">–</span><label className="sr-only" htmlFor="maxPrice">Maximum price</label><input id="maxPrice" name="maxPrice" type="number" min="0" max="9999999999.99" step="0.01" value={filters.maxPrice} onChange={field} placeholder="Max" /></div></fieldset>
    <div className="filter-field"><label htmlFor="sort">Sort by</label><select id="sort" name="sort" value={filters.sort} onChange={field}><option value="name">Brand / model</option><option value="priceAsc">Price: low to high</option><option value="priceDesc">Price: high to low</option></select></div>
    <button className="primary-button" type="submit">Show cars <span aria-hidden="true">→</span></button>
  </form>;
}
