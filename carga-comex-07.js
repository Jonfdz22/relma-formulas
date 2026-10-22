// carga-comex-07.js — Exclusivo para Comex Color Life (07)
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, 'relma.db');
const PDF_DIR = 'C:\\Users\\SW-ETIK\\Desktop\\Formularios';
const LINEA_DIR = path.join(__dirname, 'linea');
const POPPLER = 'C:\\poppler\\Library\\bin\\pdftotext.exe';

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

const norm = s => (s || '').replace(/\s+/g, ' ').trim();

function ozDe(oz, a, b, c) {
  return (oz||0) + (a||0)/32 + (b||0)/64 + (c||0)/128;
}

function parsearTexto(txt, tipo) {
  // Reemplazamos el guion raro por un guion normal
  txt = txt.replace(/‐/g, '-');
  
  const lines = txt.split(/\r?\n/);
  const formulas = [];
  
  let currentFormula = null;

  for (const ln of lines) {
    // 1. Detectar el código (Ej: A1-01)
    const codeMatch = ln.match(/([A-Z0-9]+)\s*-\s*(\d+)/i);
    
    if (codeMatch) {
      if (currentFormula && currentFormula.colorantes.length > 0) formulas.push(currentFormula);
      
      const codigo = `${codeMatch[1]}-${codeMatch[2]}`;
      const partes = ln.split(codeMatch[0]);
      let nombre = partes[1] ? partes[1].trim().split(/\s{2,}/)[0].trim() : codigo;

      currentFormula = {
        codigo, nombre,
        tipo_pintura: tipo, base_color: 'EXTRA WHITE', variante: 'general', pagina: '', colorantes: []
      };
    }

    if (!currentFormula) continue;

    // 2. Detectar Base
    if (ln.match(/ULTRADEEP/i)) currentFormula.base_color = 'ULTRADEEP';
    else if (ln.match(/DEEP/i)) currentFormula.base_color = 'DEEP';
    else if (ln.match(/LIGHT YELLOW/i)) currentFormula.base_color = 'LIGHT YELLOW';
    else if (ln.match(/VIVID YELLOW/i)) currentFormula.base_color = 'VIVID YELLOW';
    else if (ln.match(/EXTRA WHITE/i)) currentFormula.base_color = 'EXTRA WHITE';

    // 3. Detectar Tintas y sus números
    const reCol = /([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)?)\s*\(([A-Z0-9]{1,2})\)/g;
    let mc;
    reCol.lastIndex = 0;
    
    while ((mc = reCol.exec(ln)) !== null) {
      const tinta = norm(mc[1]) + ' (' + mc[2] + ')';
      
      // Tomamos el texto que está a la derecha de la tinta
      const restoLinea = ln.substring(mc.index + mc[0].length);
      
      // Extraemos todos los números de esa parte derecha
      const numeros = restoLinea.match(/\d+/g) || [];
      
      // Los rellenamos a 12 posiciones si faltan
      while (numeros.length < 12) numeros.push('0');
      
      // Convertimos a enteros (los primeros 12 números que encuentre)
      const v = numeros.slice(0, 12).map(n => parseInt(n, 10));

      currentFormula.colorantes.push({
        tinta,
        oz_litro: +ozDe(v[0], v[1], v[2], v[3]).toFixed(4),
        oz_galon: +ozDe(v[4], v[5], v[6], v[7]).toFixed(4),
        oz_cubeta: +ozDe(v[8], v[9], v[10], v[11]).toFixed(4)
      });
    }
  }
  
  if (currentFormula && currentFormula.colorantes.length > 0) formulas.push(currentFormula);
  return formulas;
}

const ins = db.prepare(`
  INSERT OR REPLACE INTO colores_linea
    (codigo, nombre, tipo_pintura, base_color, variante, locator, pagina, colorantes, total_oz, volumen_ref, marca, tipo_tinta, proveedor_tinta)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
`);

async function main() {
  console.log("🧹 Limpiando intentos anteriores de Comex Color Life...");
  db.prepare("DELETE FROM colores_linea WHERE tipo_pintura = 'COMEX COLORLIFE'").run();

  const pdfFile = '07_COMEX_COLORLIFE.pdf';
  let rutaPDF = path.join(PDF_DIR, pdfFile);
  
  if (!fs.existsSync(rutaPDF)) {
     console.log(`❌ No se encontró el PDF: ${pdfFile}`);
     return;
  }

  console.log(`📄 Convirtiendo ${pdfFile} a texto...`);
  const rutaTXT = path.join(LINEA_DIR, '07_COMEX.txt');
  
  try {
    execSync(`"${POPPLER}" -layout "${rutaPDF}" "${rutaTXT}"`);
  } catch (e) {
    console.log(`❌ Error al convertir. Revisa Poppler.`);
    return;
  }

  console.log(`📄 Leyendo texto...`);
  const txt = fs.readFileSync(rutaTXT, 'utf8');
  const formulas = parsearTexto(txt, 'COMEX COLORLIFE');
  
  let total = 0;
  const tx = db.transaction(() => {
    for (const f of formulas) {
      try {
        const total_oz = f.colorantes.reduce((s,c) => s + (c.oz_galon||0), 0);
        ins.run(f.codigo, f.nombre, f.tipo_pintura, f.base_color, f.variante, null, f.pagina || null, 
                JSON.stringify(f.colorantes), +total_oz.toFixed(4), 'GALON', 
                'Sherwin-Williams', 'ARQUITECTONICA', 'Comex');
        total++;
      } catch (e) { console.log(e); }
    }
  });
  tx();
  
  console.log(`\n✅ ${total} fórmulas cargadas de COMEX COLORLIFE\n`);
}

main();