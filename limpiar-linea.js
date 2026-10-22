// limpiar-linea.js — Borra la tabla colores_linea para recargar limpio
const Database = require('better-sqlite3');
const path = require('path');
const db = new Database(path.join(__dirname, 'relma.db'));

const antes = db.prepare('SELECT COUNT(*) as n FROM colores_linea').get().n;
db.prepare('DELETE FROM colores_linea').run();
const despues = db.prepare('SELECT COUNT(*) as n FROM colores_linea').get().n;

console.log(`🗑  Fórmulas eliminadas: ${antes}`);
console.log(`✅ Fórmulas restantes: ${despues}`);
db.close();