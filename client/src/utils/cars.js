export const categories = { economy: 'Economy', sedan: 'Sedan', suv: 'SUV', van: 'Van', premium: 'Premium' };
export const transmissions = { manual: 'Manual', automatic: 'Automatic' };
export const fuels = { petrol: 'Petrol', diesel: 'Diesel', hybrid: 'Hybrid', electric: 'Electric' };
export const price = value => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'TRY', maximumFractionDigits: 2 }).format(Number(value));
