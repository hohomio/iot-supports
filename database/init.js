const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config();

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  port: Number(process.env.DB_PORT) || 3306,
  multipleStatements: true
};

async function initDatabases() {
  console.log('====================================================');
  console.log(' [DATABASE SETUP] Inisialisasi Database Gudang & Toko');
  console.log('====================================================');
  console.log(`Menghubungkan ke MySQL di ${dbConfig.host}:${dbConfig.port} sebagai user '${dbConfig.user}'...`);

  let connection;
  try {
    connection = await mysql.createConnection(dbConfig);
    console.log('✔ Berhasil terhubung ke server MySQL!\n');

    // 1. Eksekusi db_gudang.sql
    console.log('>> Menjalankan skema db_gudang.sql...');
    const gudangSql = fs.readFileSync(path.join(__dirname, 'db_gudang.sql'), 'utf-8');
    await connection.query(gudangSql);
    console.log('✔ Database db_gudang berhasil dibuat dan disiapkan.');

    // 2. Eksekusi db_toko.sql
    console.log('>> Menjalankan skema db_toko.sql...');
    const tokoSql = fs.readFileSync(path.join(__dirname, 'db_toko.sql'), 'utf-8');
    await connection.query(tokoSql);
    console.log('✔ Database db_toko berhasil dibuat dan disiapkan.');

    console.log('\n====================================================');
    console.log('✔ SEMUA DATABASE & SEED DATA BERHASIL DIINISIALISASI!');
    console.log('====================================================');
  } catch (error) {
    console.error('\n❌ Gagal inisialisasi database!');
    console.error('Pesan Error:', error.message);
    console.error('\nTips Pemecahan Masalah:');
    console.error('1. Pastikan service MySQL sedang running (XAMPP / MySQL80 / Docker).');
    console.error('2. Jika user/password MySQL berbeda, sesuaikan di file .env:');
    console.error('   DB_HOST=localhost\n   DB_USER=root\n   DB_PASSWORD=password_kamu\n   DB_PORT=3306');
    process.exit(1);
  } finally {
    if (connection) await connection.end();
  }
}

initDatabases();

