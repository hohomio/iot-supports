-- ========================================================
-- DATABASE TOKO (db_toko)
-- ========================================================
CREATE DATABASE IF NOT EXISTS db_toko;
USE db_toko;

-- Salinan master barang dari gudang. id SAMA dengan id di db_gudang (diisi otomatis saat Putaway).
CREATE TABLE IF NOT EXISTS items (
  id      INT PRIMARY KEY,
  sku     VARCHAR(50)  NOT NULL UNIQUE,
  barcode VARCHAR(100) NOT NULL UNIQUE,
  name    VARCHAR(150) NOT NULL,
  price   DECIMAL(12,2) NOT NULL DEFAULT 0,
  CONSTRAINT chk_items_price CHECK (price >= 0)
) ENGINE=InnoDB;

-- Rak toko. Isi sendiri sesuai rak asli (barcode rak yang dicetak harus sama dengan kolom barcode).
CREATE TABLE IF NOT EXISTS racks (
  id        INT AUTO_INCREMENT PRIMARY KEY,
  rack_code VARCHAR(50)  NOT NULL UNIQUE,
  barcode   VARCHAR(100) NOT NULL UNIQUE
) ENGINE=InnoDB;

-- Putaway: riwayat barang dari gudang ditaruh ke rak
CREATE TABLE IF NOT EXISTS putaway (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  outbound_doc_no VARCHAR(50) NOT NULL,
  rack_id         INT NOT NULL,
  date            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  username        VARCHAR(50) NOT NULL DEFAULT 'staf',
  CONSTRAINT fk_putaway_rack FOREIGN KEY (rack_id) REFERENCES racks(id),
  INDEX idx_putaway_doc (outbound_doc_no)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS putaway_items (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  putaway_id INT NOT NULL,
  item_id    INT NOT NULL,
  qty        INT NOT NULL,
  CONSTRAINT fk_pi_putaway FOREIGN KEY (putaway_id) REFERENCES putaway(id) ON DELETE CASCADE,
  CONSTRAINT fk_pi_item    FOREIGN KEY (item_id)    REFERENCES items(id),
  CONSTRAINT chk_pi_qty CHECK (qty > 0)
) ENGINE=InnoDB;

-- Stok per rak (info lokasi) dan stok total toko (dipakai POS)
CREATE TABLE IF NOT EXISTS rack_stock (
  rack_id INT NOT NULL,
  item_id INT NOT NULL,
  qty     INT NOT NULL DEFAULT 0,
  PRIMARY KEY (rack_id, item_id),
  CONSTRAINT fk_rs_rack FOREIGN KEY (rack_id) REFERENCES racks(id),
  CONSTRAINT fk_rs_item FOREIGN KEY (item_id) REFERENCES items(id),
  CONSTRAINT chk_rs_qty CHECK (qty >= 0)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS store_stock (
  item_id    INT PRIMARY KEY,
  qty        INT NOT NULL DEFAULT 0,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_ss_item FOREIGN KEY (item_id) REFERENCES items(id),
  CONSTRAINT chk_ss_qty CHECK (qty >= 0)
) ENGINE=InnoDB;

-- POS
CREATE TABLE IF NOT EXISTS sales (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  invoice_no VARCHAR(50) NOT NULL UNIQUE,
  date       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  cashier    VARCHAR(50) NULL,
  total      DECIMAL(12,2) NOT NULL DEFAULT 0,
  CONSTRAINT chk_sales_total CHECK (total >= 0),
  INDEX idx_sales_date (date)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS sales_items (
  id       INT AUTO_INCREMENT PRIMARY KEY,
  sales_id INT NOT NULL,
  item_id  INT NOT NULL,
  qty      INT NOT NULL,
  price    DECIMAL(12,2) NOT NULL,
  CONSTRAINT fk_si_sales FOREIGN KEY (sales_id) REFERENCES sales(id) ON DELETE CASCADE,
  CONSTRAINT fk_si_item  FOREIGN KEY (item_id)  REFERENCES items(id),
  CONSTRAINT chk_si_qty   CHECK (qty > 0),
  CONSTRAINT chk_si_price CHECK (price >= 0)
) ENGINE=InnoDB;

-- ========================================================
-- DATA CONTOH AWAL (SEED DATA TOKO)
-- ========================================================
-- Buat master rak toko awal
INSERT IGNORE INTO racks (id, rack_code, barcode) VALUES
(1, 'RAK-A', 'RAK001'),
(2, 'RAK-B', 'RAK002'),
(3, 'RAK-C', 'RAK003');

