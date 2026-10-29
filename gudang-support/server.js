const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const app = express();
const PORT = process.env.PORT_GUDANG || 3001;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Database Pool db_gudang
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: 'db_gudang',
  port: Number(process.env.DB_PORT) || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Helper check connection
app.get('/api/health', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT 1');
    res.json({ status: 'ok', database: 'db_gudang', connected: true });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// ==========================================
// 1. INVENTORY & MASTER DATA
// ==========================================

// Get all items with current warehouse stock
app.get('/api/items', async (req, res) => {
  try {
    const query = `
      SELECT 
        i.id, i.sku, i.barcode, i.name, i.price, i.created_at,
        COALESCE(s.qty, 0) AS stock_qty,
        s.updated_at AS stock_updated_at
      FROM items i
      LEFT JOIN stock s ON i.id = s.item_id
      ORDER BY i.id ASC
    `;
    const [items] = await pool.query(query);
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add new master item
app.post('/api/items', async (req, res) => {
  const { sku, barcode, name, price, initial_qty } = req.body;
  if (!sku || !barcode || !name) {
    return res.status(400).json({ error: 'SKU, barcode, dan nama barang wajib diisi' });
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [result] = await conn.query(
      'INSERT INTO items (sku, barcode, name, price) VALUES (?, ?, ?, ?)',
      [sku, barcode, name, Number(price) || 0]
    );
    const itemId = result.insertId;
    const qty = Number(initial_qty) || 0;
    await conn.query(
      'INSERT INTO stock (item_id, qty) VALUES (?, ?)',
      [itemId, qty]
    );
    await conn.commit();
    res.json({ success: true, itemId, message: 'Item berhasil ditambahkan' });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// Get suppliers
app.get('/api/suppliers', async (req, res) => {
  try {
    const [suppliers] = await pool.query('SELECT * FROM suppliers ORDER BY name ASC');
    res.json(suppliers);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add supplier
app.post('/api/suppliers', async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Nama supplier wajib diisi' });
  try {
    const [result] = await pool.query('INSERT INTO suppliers (name) VALUES (?)', [name]);
    res.json({ success: true, id: result.insertId, name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 2. INBOUND (Barang Masuk dari Supplier)
// ==========================================

// Get list inbound
app.get('/api/inbound', async (req, res) => {
  try {
    const query = `
      SELECT inb.id, inb.doc_no, inb.date, inb.status, s.name as supplier_name,
             COUNT(ii.id) as total_items,
             COALESCE(SUM(ii.qty), 0) as total_qty
      FROM inbound inb
      LEFT JOIN suppliers s ON inb.supplier_id = s.id
      LEFT JOIN inbound_items ii ON inb.id = ii.inbound_id
      GROUP BY inb.id
      ORDER BY inb.date DESC
    `;
    const [rows] = await pool.query(query);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get inbound detail
app.get('/api/inbound/:id', async (req, res) => {
  try {
    const [inbound] = await pool.query(
      `SELECT inb.*, s.name as supplier_name 
       FROM inbound inb 
       LEFT JOIN suppliers s ON inb.supplier_id = s.id 
       WHERE inb.id = ?`,
      [req.params.id]
    );
    if (inbound.length === 0) return res.status(404).json({ error: 'Dokumen inbound tidak ditemukan' });

    const [items] = await pool.query(
      `SELECT ii.*, i.name as item_name, i.sku, i.barcode 
       FROM inbound_items ii 
       JOIN items i ON ii.item_id = i.id 
       WHERE ii.inbound_id = ?`,
      [req.params.id]
    );

    res.json({ inbound: inbound[0], items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create Inbound (Submit Inbound)
app.post('/api/inbound', async (req, res) => {
  const { doc_no, supplier_id, items } = req.body;
  // items: [{ item_id, qty }]
  if (!doc_no || !items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Nomor dokumen dan daftar item wajib diisi' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // 1. Insert Inbound Header
    const [headerResult] = await conn.query(
      'INSERT INTO inbound (doc_no, supplier_id, status) VALUES (?, ?, "DONE")',
      [doc_no, supplier_id || null]
    );
    const inboundId = headerResult.insertId;

    // 2. Insert items & Update Warehouse Stock
    for (const it of items) {
      const itemId = Number(it.item_id);
      const qty = Number(it.qty);
      if (qty <= 0) continue;

      await conn.query(
        'INSERT INTO inbound_items (inbound_id, item_id, qty) VALUES (?, ?, ?)',
        [inboundId, itemId, qty]
      );

      // Upsert stock di db_gudang
      await conn.query(
        `INSERT INTO stock (item_id, qty) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE qty = qty + ?`,
        [itemId, qty, qty]
      );
    }

    await conn.commit();
    res.json({ success: true, inboundId, doc_no, message: 'Inbound berhasil disimpan dan stok gudang bertambah' });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// ==========================================
// 3. OUTBOUND (Kirim ke Toko)
// ==========================================

// Get list outbound
app.get('/api/outbound', async (req, res) => {
  try {
    const query = `
      SELECT o.id, o.doc_no, o.destination_store, o.date, o.status,
             COUNT(oi.id) as total_items,
             COALESCE(SUM(oi.qty), 0) as total_qty
      FROM outbound o
      LEFT JOIN outbound_items oi ON o.id = oi.outbound_id
      GROUP BY o.id
      ORDER BY o.date DESC
    `;
    const [rows] = await pool.query(query);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get outbound detail (juga bisa dipanggil oleh sistem Toko untuk cek isi surat jalan)
app.get('/api/outbound/:doc_no', async (req, res) => {
  try {
    const [outbound] = await pool.query(
      'SELECT * FROM outbound WHERE doc_no = ?',
      [req.params.doc_no]
    );
    if (outbound.length === 0) return res.status(404).json({ error: 'Dokumen outbound tidak ditemukan' });

    const [items] = await pool.query(
      `SELECT oi.*, i.name as item_name, i.sku, i.barcode, i.price 
       FROM outbound_items oi 
       JOIN items i ON oi.item_id = i.id 
       WHERE oi.outbound_id = ?`,
      [outbound[0].id]
    );

    res.json({ outbound: outbound[0], items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create Outbound (Kirim barang ke toko)
app.post('/api/outbound', async (req, res) => {
  const { doc_no, destination_store, items } = req.body;
  // items: [{ item_id, qty }]
  if (!doc_no || !items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Nomor dokumen dan daftar item wajib diisi' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // 1. Cek ketersediaan stok tiap item di gudang
    for (const it of items) {
      const itemId = Number(it.item_id);
      const qty = Number(it.qty);
      if (qty <= 0) continue;

      const [stockRows] = await conn.query(
        'SELECT qty FROM stock WHERE item_id = ? FOR UPDATE',
        [itemId]
      );
      const currentStock = stockRows.length > 0 ? stockRows[0].qty : 0;
      if (currentStock < qty) {
        throw new Error(`Stok gudang tidak mencukupi untuk item ID ${itemId}. Stok saat ini: ${currentStock}, diminta: ${qty}`);
      }
    }

    // 2. Insert Outbound Header (Status SENT)
    const [headerResult] = await conn.query(
      'INSERT INTO outbound (doc_no, destination_store, status) VALUES (?, ?, "SENT")',
      [doc_no, destination_store || 'Toko Utama']
    );
    const outboundId = headerResult.insertId;

    // 3. Insert items & Potong Stok Gudang
    for (const it of items) {
      const itemId = Number(it.item_id);
      const qty = Number(it.qty);
      if (qty <= 0) continue;

      await conn.query(
        'INSERT INTO outbound_items (outbound_id, item_id, qty) VALUES (?, ?, ?)',
        [outboundId, itemId, qty]
      );

      // Potong stok gudang
      await conn.query(
        'UPDATE stock SET qty = qty - ? WHERE item_id = ?',
        [qty, itemId]
      );
    }

    await conn.commit();
    res.json({ success: true, outboundId, doc_no, message: 'Dokumen Outbound berhasil dibuat, status SENT, dan stok gudang dipotong' });
  } catch (err) {
    await conn.rollback();
    res.status(400).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// Update status outbound (bisa dipanggil saat Putaway toko selesai: SENT -> RECEIVED)
app.patch('/api/outbound/:doc_no/status', async (req, res) => {
  const { status } = req.body;
  if (!['SENT', 'RECEIVED'].includes(status)) {
    return res.status(400).json({ error: 'Status harus SENT atau RECEIVED' });
  }
  try {
    const [result] = await pool.query(
      'UPDATE outbound SET status = ? WHERE doc_no = ?',
      [status, req.params.doc_no]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Dokumen outbound tidak ditemukan' });
    }
    res.json({ success: true, message: `Status outbound diubah menjadi ${status}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`[GUDANG DASHBOARD] Berjalan di http://localhost:${PORT}`);
});

