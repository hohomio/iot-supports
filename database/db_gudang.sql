-- ========================================================
-- DATABASE GUDANG (db_gudang)
-- ========================================================
CREATE DATABASE IF NOT EXISTS db_gudang;
USE db_gudang;

CREATE TABLE IF NOT EXISTS suppliers (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(150) NOT NULL UNIQUE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS items (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  sku        VARCHAR(50)  NOT NULL UNIQUE,
  barcode    VARCHAR(100) NOT NULL UNIQUE,
  name       VARCHAR(150) NOT NULL,
  price      DECIMAL(12,2) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_items_price CHECK (price >= 0)
) ENGINE=InnoDB;

-- stok gudang total per barang, tidak boleh minus
CREATE TABLE IF NOT EXISTS stock (
  item_id    INT PRIMARY KEY,
  qty        INT NOT NULL DEFAULT 0,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_stock_item FOREIGN KEY (item_id) REFERENCES items(id),
  CONSTRAINT chk_stock_qty CHECK (qty >= 0)
) ENGINE=InnoDB;

-- Inbound: barang masuk dari supplier
CREATE TABLE IF NOT EXISTS inbound (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  doc_no      VARCHAR(50) NOT NULL UNIQUE,
  supplier_id INT NULL,
  date        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status      VARCHAR(20) NOT NULL DEFAULT 'DONE',
  CONSTRAINT fk_inbound_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
  CONSTRAINT chk_inbound_status CHECK (status IN ('DONE'))
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS inbound_items (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  inbound_id INT NOT NULL,
  item_id    INT NOT NULL,
  qty        INT NOT NULL,
  CONSTRAINT fk_ii_inbound FOREIGN KEY (inbound_id) REFERENCES inbound(id) ON DELETE CASCADE,
  CONSTRAINT fk_ii_item    FOREIGN KEY (item_id)    REFERENCES items(id),
  CONSTRAINT chk_ii_qty CHECK (qty > 0)
) ENGINE=InnoDB;

-- Outbound: dokumen kirim ke toko (SENT = dalam pengiriman, RECEIVED = sudah di-putaway toko)
CREATE TABLE IF NOT EXISTS outbound (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  doc_no            VARCHAR(50) NOT NULL UNIQUE,
  destination_store VARCHAR(100) NULL,
  date              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status            VARCHAR(20) NOT NULL DEFAULT 'SENT',
  CONSTRAINT chk_outbound_status CHECK (status IN ('SENT','RECEIVED')),
  INDEX idx_outbound_status (status)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS outbound_items (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  outbound_id INT NOT NULL,
  item_id     INT NOT NULL,
  qty         INT NOT NULL,
  CONSTRAINT fk_oi_outbound FOREIGN KEY (outbound_id) REFERENCES outbound(id) ON DELETE CASCADE,
  CONSTRAINT fk_oi_item     FOREIGN KEY (item_id)     REFERENCES items(id),
  CONSTRAINT chk_oi_qty CHECK (qty > 0)
) ENGINE=InnoDB;

-- ========================================================
-- DATA CONTOH AWAL (SEED DATA GUDANG)
-- ========================================================
INSERT IGNORE INTO suppliers (id, name) VALUES 
(1, 'PT Sumber Distribusi Nasional'),
(2, 'PT Unilever Indonesia'),
(3, 'PT Nestle Indonesia');

INSERT IGNORE INTO items (id, sku, barcode, name, price) VALUES
(1, 'MILO-3IN1', '8991001', 'Milo 3in1 Sachet 35g', 3500.00),
(2, 'DANCOW-500', '8991002', 'Dancow FortiGro 500g', 48000.00),
(3, 'SHAMPOO-PT', '8991003', 'Sampo Pantene Anti Dandruff 160ml', 24500.00),
(4, 'SABUN-LB', '8991004', 'Sabun Lifebuoy Total 10 110g', 4500.00),
(5, 'PEPSODENT-190', '8991005', 'Pasta Gigi Pepsodent 190g', 14000.00);

-- Inisialisasi stok awal gudang (masing-masing 100 pcs untuk bahan uji coba)
INSERT IGNORE INTO stock (item_id, qty) VALUES
(1, 100),
(2, 100),
(3, 100),
(4, 100),
(5, 100);

