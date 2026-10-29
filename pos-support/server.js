const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const app = express();
const PORT = process.env.PORT_POS || 3003;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Pool db_toko
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: 'db_toko',
  port: Number(process.env.DB_PORT) || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Health check
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', connected: true });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// ==========================================
// 1. CARI & SCAN BARANG POS
// ==========================================

// Cari barang berdasarkan barcode atau pencarian nama
app.get('/api/items/search', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.json([]);
  try {
    const query = `
      SELECT i.id, i.sku, i.barcode, i.name, i.price, COALESCE(ss.qty, 0) as stock_qty
      FROM items i
      LEFT JOIN store_stock ss ON i.id = ss.item_id
      WHERE i.barcode = ? OR i.name LIKE ? OR i.sku LIKE ?
      LIMIT 10
    `;
    const [rows] = await pool.query(query, [q, `%${q}%`, `%${q}%`]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Scan spesifik by barcode
app.get('/api/items/barcode/:barcode', async (req, res) => {
  try {
    const query = `
      SELECT i.id, i.sku, i.barcode, i.name, i.price, COALESCE(ss.qty, 0) as stock_qty
      FROM items i
      LEFT JOIN store_stock ss ON i.id = ss.item_id
      WHERE i.barcode = ?
    `;
    const [rows] = await pool.query(query, [req.params.barcode]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Barang tidak ditemukan di inventaris toko' });
    }
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 2. CHECKOUT / TRANSAKSI PENJUALAN (POS)
// ==========================================
app.post('/api/checkout', async (req, res) => {
  const { cashier, items, cash_received } = req.body;
  // items: [{ item_id, qty, price }]

  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Keranjang belanja kosong' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    let total = 0;

    // 1. Validasi ketersediaan stok di store_stock
    for (const it of items) {
      const itemId = Number(it.item_id);
      const qty = Number(it.qty);
      const price = Number(it.price);

      if (qty <= 0) continue;
      total += qty * price;

      const [stockRows] = await conn.query(
        'SELECT qty FROM store_stock WHERE item_id = ? FOR UPDATE',
        [itemId]
      );
      const currentStock = stockRows.length > 0 ? stockRows[0].qty : 0;
      if (currentStock < qty) {
        throw new Error(`Stok toko tidak mencukupi untuk item ID ${itemId}. Stok tersedia: ${currentStock}, diminta: ${qty}`);
      }
    }

    // 2. Generate Invoice No (INV-YYYYMMDD-XXXX)
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const invoiceNo = `INV-${dateStr}-${randomSuffix}`;

    // 3. Simpan Transaksi Sales Header
    const [salesResult] = await conn.query(
      'INSERT INTO sales (invoice_no, cashier, total) VALUES (?, ?, ?)',
      [invoiceNo, cashier || 'Kasir 1', total]
    );
    const salesId = salesResult.insertId;

    // 4. Proses Setiap Item: Simpan Detail & Potong Stok (store_stock & rack_stock via FIFO)
    for (const it of items) {
      const itemId = Number(it.item_id);
      const qty = Number(it.qty);
      const price = Number(it.price);

      // Simpan ke sales_items
      await conn.query(
        'INSERT INTO sales_items (sales_id, item_id, qty, price) VALUES (?, ?, ?, ?)',
        [salesId, itemId, qty, price]
      );

      // A. Potong store_stock
      await conn.query(
        'UPDATE store_stock SET qty = qty - ? WHERE item_id = ?',
        [qty, itemId]
      );

      // B. Potong rack_stock secara FIFO (rak dengan id terkecil yang punya stok)
      let remainingToDeduct = qty;
      const [racks] = await conn.query(
        'SELECT rack_id, qty FROM rack_stock WHERE item_id = ? AND qty > 0 ORDER BY rack_id ASC FOR UPDATE',
        [itemId]
      );

      for (const rack of racks) {
        if (remainingToDeduct <= 0) break;
        const take = Math.min(rack.qty, remainingToDeduct);
        await conn.query(
          'UPDATE rack_stock SET qty = qty - ? WHERE rack_id = ? AND item_id = ?',
          [take, rack.rack_id, itemId]
        );
        remainingToDeduct -= take;
      }
    }

    await conn.commit();

    const change = Number(cash_received || total) - total;

    res.json({
      success: true,
      message: 'Transaksi berhasil!',
      invoice_no: invoiceNo,
      date: now,
      total,
      cash_received: Number(cash_received || total),
      change: change >= 0 ? change : 0
    });
  } catch (err) {
    await conn.rollback();
    res.status(400).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// ==========================================
// 3. RIWAYAT PENJUALAN (SALES HISTORY)
// ==========================================
app.get('/api/sales', async (req, res) => {
  try {
    const query = `
      SELECT s.id, s.invoice_no, s.date, s.cashier, s.total,
             COUNT(si.id) as total_items,
             COALESCE(SUM(si.qty), 0) as total_qty
      FROM sales s
      LEFT JOIN sales_items si ON s.id = si.sales_id
      GROUP BY s.id
      ORDER BY s.date DESC
      LIMIT 20
    `;
    const [rows] = await pool.query(query);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/sales/:id', async (req, res) => {
  try {
    const [sales] = await pool.query('SELECT * FROM sales WHERE id = ?', [req.params.id]);
    if (sales.length === 0) return res.status(404).json({ error: 'Penjualan tidak ditemukan' });

    const [items] = await pool.query(`
      SELECT si.*, i.name, i.sku, i.barcode
      FROM sales_items si
      JOIN items i ON si.item_id = i.id
      WHERE si.sales_id = ?
    `, [req.params.id]);

    res.json({ sales: sales[0], items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`[POS KASIR SUPPORT] Berjalan di http://localhost:${PORT}`);
});

