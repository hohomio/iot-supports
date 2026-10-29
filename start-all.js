const { spawn } = require('child_process');
const path = require('path');

const services = [
  { name: 'GUDANG (3001)', script: 'gudang-support/server.js', color: '\x1b[36m' },
  { name: 'TOKO   (3002)', script: 'toko-support/server.js',   color: '\x1b[32m' },
  { name: 'POS    (3003)', script: 'pos-support/server.js',    color: '\x1b[35m' }
];

const children = [];

console.log('===============================================================');
console.log('  🚀 MENJALANKAN 3 SOFTWARE PENDUKUNG IOT (GUDANG, TOKO, POS)  ');
console.log('===============================================================');

services.forEach(svc => {
  const child = spawn('node', [path.join(__dirname, svc.script)], {
    stdio: ['inherit', 'pipe', 'pipe'],
    shell: true
  });

  child.stdout.on('data', (data) => {
    const lines = data.toString().trim().split('\n');
    lines.forEach(line => {
      console.log(`${svc.color}[${svc.name}]\x1b[0m ${line}`);
    });
  });

  child.stderr.on('data', (data) => {
    const lines = data.toString().trim().split('\n');
    lines.forEach(line => {
      console.error(`${svc.color}[${svc.name} ERROR]\x1b[0m ${line}`);
    });
  });

  child.on('close', (code) => {
    console.log(`${svc.color}[${svc.name}]\x1b[0m Berhenti dengan kode ${code}`);
  });

  children.push(child);
});

// Menangani shutdown bersih saat Ctrl+C
process.on('SIGINT', () => {
  console.log('\nMematikan semua service...');
  children.forEach(c => c.kill('SIGINT'));
  process.exit();
});

process.on('SIGTERM', () => {
  children.forEach(c => c.kill('SIGTERM'));
  process.exit();
});

