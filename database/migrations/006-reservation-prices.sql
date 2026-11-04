CREATE TABLE IF NOT EXISTS reservation_prices (
  reservation_id INT UNSIGNED PRIMARY KEY,
  daily_price DECIMAL(12,2) NOT NULL,
  rental_days INT UNSIGNED NOT NULL,
  total_amount DECIMAL(20,2) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'TRY',
  FOREIGN KEY (reservation_id) REFERENCES reservations(id) ON DELETE CASCADE,
  CONSTRAINT reservation_prices_valid CHECK (daily_price >= 0 AND rental_days > 0 AND total_amount = daily_price * rental_days AND currency = 'TRY')
) ENGINE=InnoDB;
