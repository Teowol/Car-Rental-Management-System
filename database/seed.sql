-- Fictional demo specifications/prices. Existing vehicles are never overwritten.
INSERT INTO cars (vehicle_code,brand,model,category,seats,transmission,fuel_type,daily_price,status)
VALUES
 ('DEMO-01','Renault','Clio','economy',5,'manual','petrol',1000.00,'active'),
 ('DEMO-02','Fiat','Egea','economy',5,'manual','diesel',1100.00,'active'),
 ('DEMO-03','Toyota','Yaris','economy',5,'automatic','hybrid',1250.00,'active'),
 ('DEMO-04','Toyota','Corolla','sedan',5,'automatic','hybrid',1500.00,'active'),
 ('DEMO-05','Honda','Civic','sedan',5,'automatic','petrol',1600.00,'active'),
 ('DEMO-06','Skoda','Octavia','sedan',5,'automatic','diesel',1700.00,'active'),
 ('DEMO-07','Dacia','Duster','suv',5,'manual','diesel',1800.00,'active'),
 ('DEMO-08','Nissan','Qashqai','suv',5,'automatic','petrol',2000.00,'active'),
 ('DEMO-09','Peugeot','5008','suv',7,'automatic','diesel',2400.00,'active'),
 ('DEMO-10','Volkswagen','Transporter','van',9,'manual','diesel',2600.00,'active'),
 ('DEMO-11','BMW','320i','premium',5,'automatic','petrol',3500.00,'maintenance'),
 ('DEMO-12','Mercedes','C200','premium',5,'automatic','petrol',3600.00,'inactive')
ON DUPLICATE KEY UPDATE vehicle_code = cars.vehicle_code;
