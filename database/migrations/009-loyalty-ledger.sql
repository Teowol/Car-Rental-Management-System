CREATE TABLE IF NOT EXISTS loyalty_transactions (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  reservation_id INT UNSIGNED NOT NULL,
  points_delta BIGINT NOT NULL,
  reason ENUM('earned','reversed') NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (reservation_id, reason),
  FOREIGN KEY (reservation_id) REFERENCES reservations(id) ON DELETE CASCADE,
  CONSTRAINT loyalty_delta_valid CHECK ((reason = 'earned' AND points_delta >= 0) OR (reason = 'reversed' AND points_delta <= 0))
) ENGINE=InnoDB;
