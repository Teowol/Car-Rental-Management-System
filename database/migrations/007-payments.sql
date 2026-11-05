CREATE TABLE IF NOT EXISTS payments (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  reservation_id INT UNSIGNED NOT NULL UNIQUE,
  amount DECIMAL(20,2) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'TRY',
  status ENUM('pending','paid','failed','refunded') NOT NULL DEFAULT 'pending',
  method_label VARCHAR(40) NOT NULL DEFAULT 'Simulated payment',
  paid_at DATETIME NULL,
  refunded_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (reservation_id) REFERENCES reservations(id) ON DELETE CASCADE,
  CONSTRAINT payments_amount_valid CHECK (amount >= 0 AND currency = 'TRY')
) ENGINE=InnoDB;
