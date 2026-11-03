CREATE TABLE IF NOT EXISTS cars (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  vehicle_code VARCHAR(30) NOT NULL UNIQUE,
  brand VARCHAR(60) NOT NULL,
  model VARCHAR(80) NOT NULL,
  category ENUM('economy','sedan','suv','van','premium') NOT NULL,
  seats TINYINT UNSIGNED NOT NULL,
  transmission ENUM('manual','automatic') NOT NULL,
  fuel_type ENUM('petrol','diesel','hybrid','electric') NOT NULL,
  daily_price DECIMAL(12,2) NOT NULL,
  image_url VARCHAR(500) NOT NULL DEFAULT '/images/car-placeholder.svg',
  status ENUM('active','maintenance','inactive') NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT cars_seats_valid CHECK (seats BETWEEN 1 AND 20),
  CONSTRAINT cars_price_valid CHECK (daily_price >= 0),
  INDEX cars_catalog (status, category, daily_price)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
