// cargar-rgb.js — Parsea los 2 formatos de RGB
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH   = path.join(__dirname, 'relma.db');
const LINEA_DIR = path.join(__dirname, 'linea');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

function rgbToHex(r, g, b) {
  return [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('').toUpperCase();
}

// ---------- Formato 1 col: "SW0001  Mulberry Silk  N/A  148  118  108  94766C" ----------
function parsear1Col(texto) {
  const out = [];
  const lines = texto.split(/\r?\n/);
  for (const line of lines) {
    // Nombre puede tener espacios, locator puede ser N/A o 242-C3 o faltar
    const m = line.match(
      /^(SW\d{4})\s+(.+?)\s+(?:(\d{3}-C\d+|[A-Z\d\-]+)\s+)?(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})\s*([0-9A-F]{6})?/i
    );
    if (!m) continue;
    const [_, codigo, nombre, loc, r, g, b, hex] = m;
    const R = +r, G = +g, B = +b;
    if (R > 255 || G > 255 || B > 255) continue;
    out.push({
      codigo,
      nombre: nombre.trim(),
      locator: loc || null,
      rgb_r: R, rgb_g: G, rgb_b: B,
      hex: (hex || rgbToHex(R, G, B)).toUpperCase()
    });
  }
  return out;
}

// ---------- Formato 2 col (Contratipos): dos bloques por línea ----------
function parsear2Col(texto) {
  const out = [];
  const lines = texto.split(/\r?\n/);
  // Regex de un bloque: código + nombre + (locator) + r g b (hex)
  const reBloque = /(SW\d{4})\s+([A-Za-z][A-Za-z0-9 '\-\.]+?)\s+(\d{3}-C\d+|N\/A|\s{2,})\s*(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})\s+([0-9A-F]{6}|N\/A)?/gi;
  for (const line of lines) {
    let m;
    reBloque.lastIndex = 0;
    while ((m = reBloque.exec(line)) !== null) {
      const [_, codigo, nombre, loc, r, g, b, hex] = m;
      const R = +r, G = +g, B = +b;
      if (R > 255 || G > 255 || B > 255) continue;
      out.push({
        codigo,
        nombre: nombre.trim(),
        locator: (loc || '').trim() || null,
        rgb_r: R, rgb_g: G, rgb_b: B,
        hex: (hex && hex !== 'N/A' ? hex : rgbToHex(R, G, B)).toUpperCase()
      });
    }
  }
  return out;
}

const ins = db.prepare(`
  INSERT OR REPLACE INTO colores_rgb
    (codigo, nombre, locator, rgb_r, rgb_g, rgb_b, hex, marca)
  VALUES (?,?,?,?,?,?,?,?)
`);

function guardar(regs, marca) {
  let n = 0;
  const tx = db.transaction(() => {
    for (const r of regs) {
      ins.run(r.codigo, r.nombre, r.locator, r.rgb_r, r.rgb_g, r.rgb_b, r.hex, marca);
      n++;
    }
  });
  tx();
  return n;
}

function detectar(txt) {
  const head = txt.substring(0, 2000);
  if (/^COLOR # COLOR NAME\s+LOCATOR #/m.test(head)) return '1COL';
  if (/^Código\s+Nombre\s+R\s+G\s+B\s+HEX/m.test(head)) return '2COL';
  return '?';
}

function main() {
  const archivos = fs.readdirSync(LINEA_DIR).filter(f => f.toLowerCase().endsWith('.txt'));
  let total = 0;
  for (const arch of archivos) {
    const full = path.join(LINEA_DIR, arch);
    const txt = fs.readFileSync(full, 'utf8');
    const fmt = detectar(txt);
    if (fmt === '?') continue; // no es RGB

    console.log(`🎨 ${arch}  → RGB ${fmt}`);
    let regs = fmt === '1COL' ? parsear1Col(txt) : parsear2Col(txt);
    // Dedup por código (quédate con el primero)
    const seen = new Set();
    regs = regs.filter(r => { if (seen.has(r.codigo)) return false; seen.add(r.codigo); return true; });

    const n = guardar(regs, 'Sherwin-Williams');
    console.log(`   ✅ ${n} colores RGB\n`);
    total += n;
  }
  console.log(`🎉 TOTAL: ${total} colores RGB guardados`);
}

main();