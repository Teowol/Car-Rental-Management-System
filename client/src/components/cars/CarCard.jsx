import { categories, transmissions, fuels, price } from '../../utils/cars.js';
import { useState } from 'react';

export function CarImage({ car }) {
  const [failed, setFailed] = useState(false);
  return <img src={!failed && car.imageUrl ? car.imageUrl : '/images/car-placeholder.svg'} alt={`${car.brand} ${car.model} illustrative car drawing`} onError={() => setFailed(true)} />;
}

export default function CarCard({ car }) {
  return <article className={`car-card category-${car.category}`}>
    <div className="car-visual"><span className="category-label">{categories[car.category]}</span><CarImage car={car} /><span className="image-caption">Illustrative image</span></div>
    <div className="car-body"><p className="car-brand">{car.brand}</p><h3>{car.model}</h3>
      <ul className="specs"><li>{transmissions[car.transmission]}</li><li>{fuels[car.fuelType]}</li><li>{car.seats} seats</li></ul>
      <div className="card-bottom"><p><strong>{price(car.dailyPrice)}</strong><span> / day</span></p><a className="detail-link" href={`#/cars/${car.id}`} aria-label={`${car.brand} ${car.model} details`}>Details <span aria-hidden="true">↗</span></a></div>
    </div>
  </article>;
}
