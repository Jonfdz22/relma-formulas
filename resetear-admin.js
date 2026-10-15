const Database = require("better-sqlite3");
const path = require("path");
const bcrypt = require("bcryptjs");

const db = new Database(path.join(__dirname, "relma.db"));

console.log("\n=== DIAGNÓSTICO + RESETEO ===\n");

console.log("Esquema actual de la tabla 'usuarios':");
try {
  const cols = db.prepare("PRAGMA table_info(usuarios)").all();
  cols.forEach(c => console.log(`  • ${c.name} (${c.type})`));
} catch (e) {
  console.log("  (no existe la tabla)");
}

console.log("\nUsuarios actuales:");
try {
  const us = db.prepare("SELECT * FROM usuarios").all();
  if (!us.length) console.log("  (ninguno)");
  us.forEach(u => console.log(`  • ${u.usuario} [id=${u.id}]`));
} catch (e) {
  console.log("  Error:", e.message);
}

console.log("\nRecreando tabla usuarios...");
db.exec("DROP TABLE IF EXISTS usuarios");
db.exec(`
  CREATE TABLE usuarios (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario        TEXT UNIQUE NOT NULL,
    password_hash  TEXT NOT NULL,
    nombre         TEXT,
    rol            TEXT NOT NULL DEFAULT 'taller',
    activo         INTEGER DEFAULT 1,
    fecha_creacion TEXT DEFAULT (datetime('now'))
  )
`);
console.log("✓ Tabla usuarios recreada.");

const hash = bcrypt.hashSync("admin123", 10);
db.prepare("INSERT INTO usuarios (usuario,password_hash,nombre,rol) VALUES (?,?,?,?)")
  .run("admin", hash, "Administrador", "admin");
console.log("✓ Admin creado.");

const admin = db.prepare("SELECT * FROM usuarios WHERE usuario='admin'").get();
const verifica = bcrypt.compareSync("admin123", admin.password_hash);
console.log(`\n✓ Verificación de contraseña: ${verifica ? "OK ✅" : "FALLÓ ❌"}`);

console.log("\n✅ Listo. Usa: admin / admin123\n");