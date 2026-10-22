// migrar-linea.js — crea las tablas colores_rgb y colores_linea
const path = require('path');
const Database = require('better-sqlite3');

const db = new Database(path.join(__dirname, 'relma.db'));
db.pragma('journal_mode = WAL');

console.log('🔧 Creando tablas...\n');

db.exec(`
  CREATE TABLE IF NOT EXISTS colores_rgb (
    codigo      TEXT PRIMARY KEY,
    nombre      TEXT NOT NULL,
    locator     TEXT,
    rgb_r       INTEGER,
    rgb_g       INTEGER,
    rgb_b       INTEGER,
    hex         TEXT,
    marca       TEXT DEFAULT 'Sherwin-Williams',
    cargado     TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_rgb_codigo ON colores_rgb(codigo);
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS colores_linea (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    codigo        TEXT NOT NULL,
    nombre        TEXT NOT NULL,
    tipo_pintura  TEXT NOT NULL,
    base_color    TEXT NOT NULL,
    variante      TEXT NOT NULL DEFAULT 'general',
    locator       TEXT,
    pagina        TEXT,
    colorantes    TEXT NOT NULL,
    total_oz      REAL NOT NULL,
    volumen_ref   TEXT NOT NULL DEFAULT 'GALON',
    marca         TEXT DEFAULT 'Sherwin-Williams',
    cargado       TEXT DEFAULT (datetime('now')),
    UNIQUE(codigo, tipo_pintura, base_color, variante)
  );
  CREATE INDEX IF NOT EXISTS idx_linea_codigo ON colores_linea(codigo);
  CREATE INDEX IF NOT EXISTS idx_linea_tipo   ON colores_linea(tipo_pintura);
  CREATE INDEX IF NOT EXISTS idx_linea_base   ON colores_linea(base_color);
`);

console.log('✅ Tablas creadas/verificadas');

// Verificar
const tablas = db.prepare(
  "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'colores%' ORDER BY name"
).all();
console.log('\n📋 Tablas existentes:');
for (const t of tablas) console.log('   •', t.name);

db.close();
console.log('\n🎉 Listo. Ya puedes correr: node carga-linea.js');