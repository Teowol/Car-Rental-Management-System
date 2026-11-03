import CarCard from './CarCard.jsx';
export default function CarGrid({ cars }) {
  return <div className="car-grid">{cars.map(car => <CarCard key={car.id} car={car} />)}</div>;
}
