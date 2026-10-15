const Database = require("better-sqlite3");
const path = require("path");
const db = new Database(path.join(__dirname, "relma.db"));

console.log("Creando tablas del mezclador si no existen...");

db.exec(`
  CREATE TABLE IF NOT EXISTS sesiones_mezclador (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    cliente_id      INTEGER NOT NULL REFERENCES clientes(id),
    muestra_nombre  TEXT,
    muestra_codigo  TEXT,
    producto        TEXT,
    base            TEXT,
    tamano_cantidad REAL NOT NULL,
    tamano_unidad   TEXT DEFAULT 'LT',
    estado          TEXT DEFAULT 'ABIERTA',
    fecha_inicio    TEXT DEFAULT (datetime('now')),
    fecha_cierre    TEXT,
    usuario         TEXT,
    notas           TEXT
  );

  CREATE TABLE IF NOT EXISTS ajustes_mezclador (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    sesion_id       INTEGER NOT NULL REFERENCES sesiones_mezclador(id) ON DELETE CASCADE,
    tinta           TEXT NOT NULL,
    cantidad_texto  TEXT NOT NULL,
    cantidad_en_128 REAL NOT NULL,
    unidad_mostrar  TEXT DEFAULT 'OZ',
    fecha           TEXT DEFAULT (datetime('now')),
    usuario         TEXT
  );
`);

// Verificar
const tablas = db.prepare(
  "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
).all().map(t => t.name);

console.log("\nTablas en la BD:");
for (const t of tablas) console.log("  ✓ " + t);

if (tablas.includes("sesiones_mezclador") && tablas.includes("ajustes_mezclador")) {
  console.log("\n✅ Tablas del mezclador listas.\n");
} else {
  console.log("\n❌ Algo falló. Copia este mensaje completo.\n");
}