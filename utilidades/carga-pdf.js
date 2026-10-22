// carga-pdf.js v2 — Escáner de coordenadas (X, Y) definitivo
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');

const DB_PATH = path.join(__dirname, 'relma.db');
const PDF_DIR = 'C:\\Users\\SW-ETIK\\Desktop\\Formularios';
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

const BASES_SW = ['EXTRA WHITE','ULTRADEEP','DEEP','VIVID YELLOW','LIGHT YELLOW','REAL RED','BASE EMPACADA','NO DISPONIBLE'];
const norm = s => (s || '').replace(/\s+/g, ' ').trim();

function ozDe(oz, a, b, c) {
  return (oz||0) + (a||0)/32 + (b||0)/64 + (c||0)/128;
}

async function parsearPDF(rutaPDF, tipoPintura) {
  const data = new Uint8Array(fs.readFileSync(rutaPDF));
  const doc = await pdfjs.getDocument(data).promise;
  const formulas = [];
  let currentFormula = null;

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const textContent = await page.getTextContent();
    
    // Agrupar textos por su coordenada Y (renglón)
    const rows = {};
    textContent.items.forEach(item => {
      if (!item.str.trim()) return;
      const y = Math.round(item.transform[5]);
      if (!rows[y]) rows[y] = [];
      rows[y].push({ str: item.str, x: item.transform[4] });
    });

    const sortedYs = Object.keys(rows).map(Number).sort((a,b) => b - a);
    let cols = null;

    for (const y of sortedYs) {
      const row = rows[y].sort((a,b) => a.x - b.x);
      
      // Encontrar las coordenadas X del encabezado (oz, 32, 64, 128)
      if (!cols) {
        const headers = row.filter(i => ['oz', '32', '64', '128'].includes(i.str.trim()));
        if (headers.length >= 12) {
          cols = headers.map(h => h.x).sort((a,b)=>a-b);
        }
      }
      
      const fullRowText = row.map(i => i.str).join(" ");

      // Detectar un nuevo código SW
      const codeMatch = fullRowText.match(/\b(SW\d{4})\b/);
      if (codeMatch) {
        if (currentFormula && currentFormula.colorantes.length > 0) formulas.push(currentFormula);
        
        const codigo = codeMatch[1];
        const mNom = fullRowText.match(new RegExp('\\b' + codigo + '\\b\\s+(.+?)(?:\\s{2,}|\\d{3}-C\\d+|N\\/A)', 'i'));
        const nombre = mNom ? norm(mNom[1]) : 'Desconocido';

        currentFormula = {
          codigo, nombre, tipo_pintura: tipoPintura,
          base_color: '', pagina: '', variante: 'general', colorantes: []
        };
      }
      
         // Detectar página y base (pueden estar en el mismo renglón o en el siguiente)
      if (currentFormula) {
        // 1. Detectar Nombre si aún es Desconocido o vacío
        if (!currentFormula.nombre || currentFormula.nombre === 'Desconocido') {
          let txtLimpio = fullRowText.replace(currentFormula.codigo, '').trim();
          const mPag = txtLimpio.match(/\b(\d{3}-C\d+)\b/);
          if (mPag) {
            currentFormula.pagina = mPag[1];
            txtLimpio = txtLimpio.split(mPag[1])[0].trim(); // Agarramos lo que está antes de la página
          }
          txtLimpio = txtLimpio.replace(/N\/A/gi, '').replace(/\s+/g, ' ').trim();
          if (txtLimpio.length > 2 && !BASES_SW.some(b => txtLimpio.includes(b))) {
             currentFormula.nombre = txtLimpio;
          }
        } else if (!currentFormula.pagina) {
          const mPag = fullRowText.match(/\b(\d{3}-C\d+)\b/);
          if (mPag) currentFormula.pagina = mPag[1];
        }

        // 2. Detectar base (Solo si la línea NO contiene el código SW para no confundir el nombre con la base)
        if (!currentFormula.base_color && !fullRowText.includes(currentFormula.codigo)) {
          for (const b of BASES_SW) {
            // Quitamos "REAL RED" de la búsqueda principal si el nombre ya lo contiene
            if (b === 'REAL RED' && currentFormula.nombre.includes('REAL RED')) continue;
            if (fullRowText.includes(b)) { currentFormula.base_color = b; break; }
          }
        }
      }

      // Detectar tinta (ej. "Magenta (R3)")
      const tintMatch = fullRowText.match(/([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)?)\s*\(([A-Z]\d)\)/);
      if (tintMatch && currentFormula && cols) {
        const tinta = norm(tintMatch[1]) + ' (' + tintMatch[2] + ')';
        const v = new Array(12).fill(0);
        
        // Asignar cada número a la columna X más cercana
        row.forEach(item => {
          if (/^\d+$/.test(item.str.trim())) {
            const num = parseInt(item.str.trim(), 10);
            let minDist = Infinity, colIdx = -1;
            for (let j=0; j<12; j++) {
              const dist = Math.abs(cols[j] - item.x);
              if (dist < minDist) { minDist = dist; colIdx = j; }
            }
            // Si el número está razonablemente alineado a esa columna
            if (minDist < 20 && v[colIdx] === 0) {
              v[colIdx] = num;
            }
          }
        });
        
        currentFormula.colorantes.push({
          tinta,
          oz_galon: +ozDe(v[4], v[5], v[6], v[7]).toFixed(4),
          oz_litro: +ozDe(v[0], v[1], v[2], v[3]).toFixed(4),
          oz_cubeta: +ozDe(v[8], v[9], v[10], v[11]).toFixed(4)
        });
      }
    }
  }
  if (currentFormula && currentFormula.colorantes.length > 0) formulas.push(currentFormula);
  return formulas;
}

const ins = db.prepare(`
  INSERT OR REPLACE INTO colores_linea
    (codigo, nombre, tipo_pintura, base_color, variante, locator, pagina, colorantes, total_oz, volumen_ref, marca)
  VALUES (?,?,?,?,?,?,?,?,?,?,?)
`);

async function main() {
  console.log(`📂 Leyendo PDFs desde: ${PDF_DIR}\n`);
  const archivos = fs.readdirSync(PDF_DIR).filter(f => f.toLowerCase().endsWith('.pdf')).sort();
  
  let total = 0;
  for (const arch of archivos) {
    if (!arch.toUpperCase().includes('AGUA') && !arch.toUpperCase().includes('SOLVENTE') && !arch.toUpperCase().includes('PROCONSTRUCTOR')) continue;

    console.log(`📄 Leyendo: ${arch}`);
    let tipo = 'BASE AGUA';
    if (arch.toUpperCase().includes('SOLVENTE')) tipo = 'BASE SOLVENTE';
    if (arch.toUpperCase().includes('PROCONSTRUCTOR')) tipo = 'PROCONSTRUCTOR';

    const formulas = await parsearPDF(path.join(PDF_DIR, arch), tipo);
    
    const tx = db.transaction(() => {
      for (const f of formulas) {
        try {
          const total_oz = f.colorantes.reduce((s,c) => s + (c.oz_galon||0), 0);
          ins.run(f.codigo, f.nombre, f.tipo_pintura, f.base_color, f.variante, null, f.pagina || null, JSON.stringify(f.colorantes), +total_oz.toFixed(4), 'GALON', 'Sherwin-Williams');
          total++;
        } catch (e) {}
      }
    });
    tx();
    console.log(`   ✅ ${formulas.length} fórmulas cargadas\n`);
  }
  console.log(`\n🎉 TOTAL: ${total} fórmulas\n`);
}

main();