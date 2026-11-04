export function rentalToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
export function dateRangeError(startDate, endDate) {
  for (const value of [startDate, endDate]) {
    const date = new Date(value + 'T00:00:00Z');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) return 'Choose valid pickup and return dates.';
  }
  if (startDate >= endDate) return 'Return date must be after pickup date.';
  if (startDate < rentalToday()) return 'Pickup date cannot be in the past (Europe/Istanbul).';
  return '';
}
