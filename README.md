# 🚀 IoT Supports - Gudang, Toko Putaway, & POS Kasir

Sistem pendukung IoT yang terdiri dari **2 Database MySQL** dan **3 Software Ringan**:
1. **Gudang Support (Web Dashboard)** - Port `3001`
   - Inbound (Penerimaan barang dari supplier & tambah stok gudang)
   - Outbound (Kirim barang ke toko dengan status `SENT`)
   - Inventory & Monitoring Stok Total Gudang
2. **Toko Support (Mobile-Friendly Web)** - Port `3002`
   - Putaway Alur Lengkap: Pilih Dokumen Outbound -> Scan Barcode Rak & Confirm -> Scan Barcode Barang & Input Qty -> Simpan ke Rak
   - Sinkronisasi master barang otomatis dari `db_gudang.items` ke `db_toko.items`
   - Monitoring Real-time Rak & Isi Barang (misal: di Rak A ada Milo 10 pcs, Dancow 5 pcs, dll.)
   - Selesaikan Dokumen Outbound (`SENT` -> `RECEIVED`)
3. **POS Kasir (Mobile-Friendly Web)** - Port `3003`
   - Kamera Scanner Barcode langsung dari browser HP (HTML5 QR/Barcode)
   - Input barcode manual & pencarian
   - Keranjang Belanja & Perhitungan Kembalian
   - **Logika FIFO Auto-Deduct:** Memotong `store_stock` DAN memotong `rack_stock` dari rak pertama yang memiliki ketersediaan barang tersebut.
   - Cetak / Tampilkan Struk Pembayaran & Riwayat Penjualan.

---

## 🛠️ Persiapan & Instalasi

### 1. Pastikan Service MySQL Berjalan
Jika menggunakan **MySQL bawaan Windows (MySQL80)**:
Buka PowerShell / Command Prompt (Run as Administrator) dan ketik:
```bash
net start MySQL80
```
*(Atau jika menggunakan XAMPP, cukup buka XAMPP Control Panel lalu Start modul MySQL)*.

### 2. Konfigurasi Password MySQL (Jika Diperlukan)
File konfigurasi ada di `.env`. Defaultnya:
```env
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
```
*(Jika user MySQL kamu memiliki password, isi di baris `DB_PASSWORD`)*.

### 3. Inisialisasi Database (`db_gudang` & `db_toko`)
Jalankan perintah ini sekali untuk membuat database, tabel, dan data contoh awal:
```bash
npm run db:init
```

---

## 🏃 Menjalankan Aplikasi

Kamu bisa menjalankan ketiga software sekaligus dengan satu perintah:
```bash
npm start
```
Atau jalankan masing-masing secara terpisah di terminal berbeda:
- Gudang: `npm run start:gudang`
- Toko: `npm run start:toko`
- POS: `npm run start:pos`

---

## 📱 Akses Aplikasi di Browser & Smartphone

| Software | URL di Laptop/PC | Keterangan |
| :--- | :--- | :--- |
| **Gudang (Admin)** | `http://localhost:3001` | Dashboard Inbound, Outbound, Stok Gudang |
| **Toko (Putaway)** | `http://localhost:3002` | Mobile-friendly Putaway & Monitoring Rak |
| **POS Kasir** | `http://localhost:3003` | Kasir HP dengan Scanner Kamera |

### Cara Buka di Smartphone (Kamera Scanner):
1. Pastikan HP dan Laptop terhubung ke **jaringan WiFi / Hotspot yang sama**.
2. Cek IP Laptop kamu (misal di terminal: `ipconfig`, contoh dapat `192.168.1.15`).
3. Buka browser di HP kamu (Chrome / Safari):
   - Toko Putaway: `http://192.168.1.15:3002`
   - Kasir POS: `http://192.168.1.15:3003`
4. Izinkan akses kamera saat diminta oleh browser.

---

## 🧪 Skenario Pengujian Alur Data (End-to-End)

1. **Gudang (`:3001`):**
   - Buka tab *3. Outbound (Kirim ke Toko)*.
   - Pilih barang (misal Milo 10 pcs, Dancow 5 pcs).
   - Klik **"Terbitkan Dokumen (Kirim ke Toko)"**.
   - Dokumen berstatus `SENT` dan stok gudang otomatis terpotong.
2. **Toko Putaway (`:3002`):**
   - Buka menu *Putaway*.
   - **Step 1:** Pilih nomor surat jalan yang baru dibuat di gudang.
   - **Step 2:** Scan / ketik barcode rak (cth: `RAK001` untuk Rak A) -> Klik **Confirm Rak**.
   - **Step 3:** Scan / ketik barcode barang (cth: `8991001` untuk Milo) -> Masukkan total qty (cth: `10`) -> Klik **Simpan ke Rak**.
   - Buka tab *Isi Rak*: Kamu akan melihat di **Rak A** sudah ada Milo 10 pcs!
   - Klik tombol **"Selesaikan Seluruh Putaway Dokumen Ini"** (status outbound di gudang otomatis berubah jadi `RECEIVED`).
3. **Kasir POS (`:3003`):**
   - Buka Kasir di HP / Laptop.
   - Scan atau ketik barcode `8991001` (Milo).
   - Masukkan ke keranjang (misal beli 2 pcs).
   - Masukkan uang pembayaran -> Klik **Bayar Sekarang**.
   - **Hasil:**
     - Struk transaksi keluar.
     - Total stok toko berkurang 2 pcs.
     - Stok di **Rak A** otomatis berkurang 2 pcs (dari 10 pcs jadi 8 pcs) secara **FIFO**!
