const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const app = express();
const PORT = process.env.PORT_TOKO || 3002;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Pool db_toko
const poolToko = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: 'db_toko',
  port: Number(process.env.DB_PORT) || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Pool db_gudang (untuk membaca data surat jalan outbound & sync master item)
const poolGudang = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: 'db_gudang',
  port: Number(process.env.DB_PORT) || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Health check
app.get('/api/health', async (req, res) => {
  try {
    await poolToko.query('SELECT 1');
    await poolGudang.query('SELECT 1');
    res.json({ status: 'ok', connected: true });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// ==========================================
// 1. DATA RAK (RACKS)
// ==========================================

// Get all racks with items inside
app.get('/api/racks', async (req, res) => {
  try {
    const [racks] = await poolToko.query('SELECT * FROM racks ORDER BY rack_code ASC');
    
    // Ambil isi barang di setiap rak
    const [rackItems] = await poolToko.query(`
      SELECT rs.rack_id, rs.item_id, rs.qty, i.name, i.barcode, i.sku, i.price
      FROM rack_stock rs
      JOIN items i ON rs.item_id = i.id
      WHERE rs.qty > 0
      ORDER BY i.name ASC
    `);

    // Kelompokkan barang per rak
    const rackMap = racks.map(rack => {
      const items = rackItems.filter(ri => ri.rack_id === rack.id);
      const totalQty = items.reduce((sum, it) => sum + it.qty, 0);
      return {
        ...rack,
        total_items: items.length,
        total_qty: totalQty,
        items
      };
    });

    res.json(rackMap);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Find rack by barcode
app.get('/api/racks/scan/:barcode', async (req, res) => {
  try {
    const [rows] = await poolToko.query('SELECT * FROM racks WHERE barcode = ?', [req.params.barcode]);
    if (rows.length === 0) return res.status(404).json({ error: 'Rak dengan barcode tersebut tidak ditemukan' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add new rack
app.post('/api/racks', async (req, res) => {
  const { rack_code, barcode } = req.body;
  if (!rack_code || !barcode) return res.status(400).json({ error: 'Kode rak dan barcode rak wajib diisi' });
  try {
    const [result] = await poolToko.query('INSERT INTO racks (rack_code, barcode) VALUES (?, ?)', [rack_code, barcode]);
    res.json({ success: true, id: result.insertId, rack_code, barcode });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 2. DATA OUTBOUND GUDANG (SURAT JALAN)
// ==========================================

// Get active outbound docs from db_gudang (status SENT)
app.get('/api/outbound-docs', async (req, res) => {
  try {
    const [docs] = await poolGudang.query(`
      SELECT o.id, o.doc_no, o.destination_store, o.date, o.status,
             COUNT(oi.id) as total_items,
             COALESCE(SUM(oi.qty), 0) as total_qty
      FROM outbound o
      LEFT JOIN outbound_items oi ON o.id = oi.outbound_id
      WHERE o.status = 'SENT'
      GROUP BY o.id
      ORDER BY o.date DESC
    `);
    res.json(docs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get detail of an outbound doc
app.get('/api/outbound-docs/:doc_no', async (req, res) => {
  try {
    const [docs] = await poolGudang.query('SELECT * FROM outbound WHERE doc_no = ?', [req.params.doc_no]);
    if (docs.length === 0) return res.status(404).json({ error: 'Dokumen outbound tidak ditemukan di gudang' });

    const [items] = await poolGudang.query(`
      SELECT oi.*, i.name as item_name, i.sku, i.barcode, i.price
      FROM outbound_items oi
      JOIN items i ON oi.item_id = i.id
      WHERE oi.outbound_id = ?
    `, [docs[0].id]);

    res.json({ outbound: docs[0], items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Scan item by barcode (Bisa mencari dari db_gudang jika belum ada di db_toko)
app.get('/api/items/scan/:barcode', async (req, res) => {
  try {
    // Cek di db_toko dulu
    let [rows] = await poolToko.query('SELECT * FROM items WHERE barcode = ?', [req.params.barcode]);
    if (rows.length === 0) {
      // Cek di db_gudang
      const [gudangRows] = await poolGudang.query('SELECT * FROM items WHERE barcode = ?', [req.params.barcode]);
      if (gudangRows.length === 0) {
        return res.status(404).json({ error: 'Barang dengan barcode tersebut tidak terdaftar di sistem' });
      }
      return res.json({ ...gudangRows[0], source: 'gudang' });
    }
    res.json({ ...rows[0], source: 'toko' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 3. PROSES PUTAWAY KE RAK
// ==========================================

// Putaway items to rack
app.post('/api/putaway', async (req, res) => {
  const { outbound_doc_no, rack_id, item_barcode, qty, username } = req.body;
  const putawayQty = Number(qty);

  if (!outbound_doc_no || !rack_id || !item_barcode || putawayQty <= 0) {
    return res.status(400).json({ error: 'Semua data putaway (Doc No, Rak ID, Barcode Barang, dan Qty > 0) wajib diisi' });
  }

  const connToko = await poolToko.getConnection();
  try {
    await connToko.beginTransaction();

    // 1. Cek / Sinkronkan master barang dari db_gudang ke db_toko jika belum ada
    let [items] = await connToko.query('SELECT * FROM items WHERE barcode = ?', [item_barcode]);
    let item;

    if (items.length === 0) {
      // Ambil dari db_gudang
      const [gudangItems] = await poolGudang.query('SELECT * FROM items WHERE barcode = ?', [item_barcode]);
      if (gudangItems.length === 0) {
        throw new Error(`Barang dengan barcode ${item_barcode} tidak ditemukan di master gudang maupun toko`);
      }
      item = gudangItems[0];

      // Salin ke db_toko.items dengan id yang SAMA
      await connToko.query(
        'INSERT INTO items (id, sku, barcode, name, price) VALUES (?, ?, ?, ?, ?)',
        [item.id, item.sku, item.barcode, item.name, item.price]
      );
    } else {
      item = items[0];
    }

    // 2. Simpan Header Putaway
    const [putawayResult] = await connToko.query(
      'INSERT INTO putaway (outbound_doc_no, rack_id, username) VALUES (?, ?, ?)',
      [outbound_doc_no, rack_id, username || 'staf']
    );
    const putawayId = putawayResult.insertId;

    // 3. Simpan Detail Putaway Items
    await connToko.query(
      'INSERT INTO putaway_items (putaway_id, item_id, qty) VALUES (?, ?, ?)',
      [putawayId, item.id, putawayQty]
    );

    // 4. Update Stok per Rak (rack_stock)
    await connToko.query(`
      INSERT INTO rack_stock (rack_id, item_id, qty)
      VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE qty = qty + ?
    `, [rack_id, item.id, putawayQty, putawayQty]);

    // 5. Update Total Stok Toko (store_stock)
    await connToko.query(`
      INSERT INTO store_stock (item_id, qty)
      VALUES (?, ?)
      ON DUPLICATE KEY UPDATE qty = qty + ?
    `, [item.id, putawayQty, putawayQty]);

    await connToko.commit();

    res.json({
      success: true,
      message: `Berhasil menaruh ${putawayQty} pcs ${item.name} ke rak. Stok rak dan stok toko bertambah.`,
      item: { id: item.id, name: item.name, barcode: item.barcode, qty: putawayQty }
    });
  } catch (err) {
    await connToko.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    connToko.release();
  }
});

// Selesaikan Dokumen Putaway (Ubah status Outbound di gudang jadi RECEIVED)
app.post('/api/putaway/complete-doc', async (req, res) => {
  const { outbound_doc_no } = req.body;
  if (!outbound_doc_no) return res.status(400).json({ error: 'Nomor dokumen wajib diisi' });

  try {
    const [result] = await poolGudang.query(
      'UPDATE outbound SET status = "RECEIVED" WHERE doc_no = ?',
      [outbound_doc_no]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Dokumen outbound tidak ditemukan di gudang' });
    }
    res.json({ success: true, message: `Dokumen ${outbound_doc_no} berhasil ditandai selesai (RECEIVED)` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 4. STORE TOTAL STOCK
// ==========================================
app.get('/api/store-stock', async (req, res) => {
  try {
    const [rows] = await poolToko.query(`
      SELECT ss.item_id, ss.qty, ss.updated_at, i.sku, i.barcode, i.name, i.price
      FROM store_stock ss
      JOIN items i ON ss.item_id = i.id
      ORDER BY i.name ASC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`[TOKO PUTAWAY & RACK] Berjalan di http://localhost:${PORT}`);
});

