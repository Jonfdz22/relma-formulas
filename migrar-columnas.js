const Database = require("better-sqlite3");
const path = require("path");
const db = new Database(path.join(__dirname, "relma.db"));

console.log("\n=== MIGRAR COLUMNAS FALTANTES ===\n");

// Ver columnas actuales de clientes
console.log("Columnas actuales de 'clientes':");
const colsC = db.prepare("PRAGMA table_info(clientes)").all().map(c => c.name);
console.log("  " + colsC.join(", "));

// Agregar columnas si no existen
const agregarColumna = (tabla, columna, tipo) => {
  if (!db.prepare("PRAGMA table_info(" + tabla + ")").all().map(c => c.name).includes(columna)) {
    db.exec(`ALTER TABLE ${tabla} ADD COLUMN ${columna} ${tipo}`);
    console.log(`  ✓ Agregada: ${tabla}.${columna}`);
  } else {
    console.log(`  • Ya existe: ${tabla}.${columna}`);
  }
};

console.log("\nMigrando 'clientes'...");
agregarColumna("clientes", "email", "TEXT");
agregarColumna("clientes", "direccion", "TEXT");

console.log("\nMigrando 'formulas'...");
agregarColumna("formulas", "favorito", "INTEGER DEFAULT 0");

console.log("\nColumnas finales de 'clientes':");
const colsFinal = db.prepare("PRAGMA table_info(clientes)").all().map(c => c.name);
console.log("  " + colsFinal.join(", "));

console.log("\n✅ Migración completa.\n");