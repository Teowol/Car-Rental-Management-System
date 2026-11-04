export const categories = { economy: 'Economy', sedan: 'Sedan', suv: 'SUV', van: 'Van', premium: 'Premium' };
export const transmissions = { manual: 'Manual', automatic: 'Automatic' };
export const fuels = { petrol: 'Petrol', diesel: 'Diesel', hybrid: 'Hybrid', electric: 'Electric' };
export function price(value) {
  const [whole, fraction = '00'] = String(value).split('.');
  const formatter = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'TRY', maximumFractionDigits: 2 });
  // Format decimal strings without rounding large reservation totals through Number.
  if (/^\d+$/.test(whole) && /^\d{1,2}$/.test(fraction)) return formatter.formatToParts(BigInt(whole)).map(part => part.type === 'fraction' ? fraction.padEnd(2, '0') : part.value).join('');
  return formatter.format(Number(value));
}
