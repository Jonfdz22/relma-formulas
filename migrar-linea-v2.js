const path = require('path');
const Database = require('better-sqlite3');
const db = new Database(path.join(__dirname, 'relma.db'));

console.log('🔧 Migrando a v2...\n');

// Agregar columnas nuevas (SQLite permite ALTER TABLE ADD COLUMN)
try { db.exec(`ALTER TABLE colores_linea ADD COLUMN tipo_tinta TEXT DEFAULT 'ARQUITECTONICA'`); } catch(e) {}
try { db.exec(`ALTER TABLE colores_linea ADD COLUMN proveedor_tinta TEXT DEFAULT 'Sherwin-Williams'`); } catch(e) {}

// Actualizar Metalex existente
db.exec(`UPDATE colores_linea SET tipo_tinta='MAXITONER', proveedor_tinta='Maxitoner' WHERE tipo_pintura='METALEX'`);

// Actualizar los SW
db.exec(`UPDATE colores_linea SET tipo_tinta='ARQUITECTONICA', proveedor_tinta='Sherwin-Williams' WHERE tipo_pintura IN ('BASE AGUA','BASE SOLVENTE','PROCONSTRUCTOR')`);

const stats = db.prepare(`
  SELECT tipo_tinta, tipo_pintura, COUNT(*) as n
  FROM colores_linea GROUP BY tipo_tinta, tipo_pintura ORDER BY n DESC
`).all();
console.log('📊 Después de migrar:');
for (const s of stats) console.log(`   ${(s.tipo_tinta||'?').padEnd(15)} ${(s.tipo_pintura||'?').padEnd(15)} ${s.n}`);

db.close();
console.log('\n✅ Listo');