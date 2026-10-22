const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, 'linea');

const archivos = fs.readdirSync(DIR).filter(f => f.toLowerCase().endsWith('.txt'));
console.log(`📂 ${archivos.length} archivos en ${DIR}\n`);
console.log('='.repeat(80));

for (const arch of archivos) {
  const txt = fs.readFileSync(path.join(DIR, arch), 'utf8');
  const lines = txt.split(/\r?\n/).filter(l => l.trim());
  console.log(`\n📄 ARCHIVO: ${arch}`);
  console.log(`   Tamaño: ${txt.length} chars | Líneas: ${lines.length}`);
  console.log('   --- primeras 25 líneas ---');
  for (let i = 0; i < Math.min(25, lines.length); i++) {
    const l = lines[i].substring(0, 130);
    console.log(`   ${String(i+1).padStart(3)} | ${l}`);
  }
  console.log('='.repeat(80));
}