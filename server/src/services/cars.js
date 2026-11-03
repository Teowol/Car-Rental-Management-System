const categories = ['economy', 'sedan', 'suv', 'van', 'premium'];
const transmissions = ['manual', 'automatic'];
const fuels = ['petrol', 'diesel', 'hybrid', 'electric'];
const sorts = { priceAsc: 'daily_price ASC, id ASC', priceDesc: 'daily_price DESC, id ASC', name: 'brand ASC, model ASC, id ASC' };
const allowed = ['search', 'category', 'transmission', 'fuelType', 'minSeats', 'minPrice', 'maxPrice', 'sort', 'page', 'pageSize'];

export function invalid(message) {
  return Object.assign(new Error(message), { status: 400, code: 'INVALID_INPUT' });
}

export function parseId(value) {
  if (!/^[1-9]\d*$/.test(value) || Number(value) > 4294967295) throw invalid('Enter a valid car ID.');
  return Number(value);
}

function integer(value, fallback, max, field) {
  if (value === undefined) return fallback;
  if (!/^[1-9]\d*$/.test(value) || Number(value) > max) throw invalid(`${field} is invalid.`);
  return Number(value);
}

export function parseFilters(query) {
  for (const [key, value] of Object.entries(query)) {
    if (!allowed.includes(key) || typeof value !== 'string') throw invalid('Unsupported or repeated filter.');
  }
  const filters = { ...query };
  for (const [key, options] of [['category', categories], ['transmission', transmissions], ['fuelType', fuels]]) {
    if (filters[key] !== undefined && !options.includes(filters[key])) throw invalid(`${key} is invalid.`);
  }
  if (filters.search !== undefined) {
    filters.search = filters.search.trim();
    if (filters.search.length > 100) throw invalid('Search must be 100 characters or fewer.');
  }
  for (const key of ['minPrice', 'maxPrice']) {
    if (filters[key] !== undefined && !/^\d{1,10}(\.\d{1,2})?$/.test(filters[key])) throw invalid(`${key} is invalid.`);
  }
  if (filters.minPrice !== undefined && filters.maxPrice !== undefined && Number(filters.minPrice) > Number(filters.maxPrice)) throw invalid('Minimum price cannot exceed maximum price.');
  filters.minSeats = integer(filters.minSeats, undefined, 20, 'Seat count');
  filters.page = integer(filters.page, 1, 1000000, 'Page');
  filters.pageSize = integer(filters.pageSize, 12, 100, 'Page size');
  filters.sort = filters.sort ?? 'name';
  if (!Object.hasOwn(sorts, filters.sort)) throw invalid('Invalid sort order.');
  return filters;
}

const fields = 'id, brand, model, category, seats, transmission, fuel_type, daily_price, image_url, status';
function toCar(row) {
  return { id: row.id, brand: row.brand, model: row.model, category: row.category, seats: row.seats,
    transmission: row.transmission, fuelType: row.fuel_type, dailyPrice: row.daily_price,
    currency: 'TRY', imageUrl: row.image_url, status: row.status };
}

export async function listCars(database, filters) {
  const conditions = ["status = 'active'"];
  const values = [];
  for (const [key, column] of [['category', 'category'], ['transmission', 'transmission'], ['fuelType', 'fuel_type']]) {
    if (filters[key]) { conditions.push(`${column} = ?`); values.push(filters[key]); }
  }
  if (filters.search) {
    // Literal substring matching: '%' and '_' are not SQL wildcard input.
    conditions.push("LOCATE(?, CONCAT(brand, ' ', model)) > 0"); values.push(filters.search);
  }
  for (const [key, clause] of [['minSeats', 'seats >= ?'], ['minPrice', 'daily_price >= ?'], ['maxPrice', 'daily_price <= ?']]) {
    if (filters[key] !== undefined) { conditions.push(clause); values.push(filters[key]); }
  }
  const where = conditions.join(' AND ');
  const [[count]] = await database.execute(`SELECT COUNT(*) AS total FROM cars WHERE ${where}`, values);
  const [rows] = await database.execute(`SELECT ${fields} FROM cars WHERE ${where} ORDER BY ${sorts[filters.sort]} LIMIT ? OFFSET ?`, [...values, String(filters.pageSize), String((filters.page - 1) * filters.pageSize)]);
  return { items: rows.map(toCar), page: filters.page, pageSize: filters.pageSize, total: count.total };
}

export async function getCar(database, id) {
  const [rows] = await database.execute(`SELECT ${fields} FROM cars WHERE id = ? AND status <> 'inactive'`, [id]);
  return rows.length ? toCar(rows[0]) : null;
}
