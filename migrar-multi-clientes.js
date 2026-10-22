const Database = require('better-sqlite3');
const path = require('path');
const db = new Database(path.join(__dirname, 'relma.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS formula_clientes (
    formula_id INTEGER,
    cliente_id INTEGER,
    PRIMARY KEY (formula_id, cliente_id),
    FOREIGN KEY (formula_id) REFERENCES formulas(id) ON DELETE CASCADE,
    FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE CASCADE
  );
`);

// Copiamos los clientes actuales de las fórmulas existentes a la nueva tabla
const formulas = db.prepare("SELECT id, cliente_id FROM formulas").all();
const insert = db.prepare("INSERT OR IGNORE INTO formula_clientes (formula_id, cliente_id) VALUES (?, ?)");
const insertarTodo = db.transaction(() => {
  formulas.forEach(f => insert.run(f.id, f.cliente_id));
});
insertarTodo();

console.log("✅ Tabla formula_clientes creada y datos migrados correctamente.");
db.close();