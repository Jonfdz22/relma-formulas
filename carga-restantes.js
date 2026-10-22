// carga-restantes.js — Lector de PDFs para Minwax, Primarios, etc.
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');

const DB_PATH = path.join(__dirname, 'relma.db');
const PDF_DIR = 'C:\\Users\\SW-ETIK\\Desktop\\Formularios';
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

// ⚠️ AQUÍ PON LOS NOMBRES EXACTOS DE TUS PDFs:
const PDFS_A_CARGAR = [
  { archivo: '05_MINWAX_SW_10.20.pdf', tipo: 'MINWAX', marca: 'Sherwin-Williams', tinta: 'ARQUITECTONICA', proveedor: 'Sherwin-Williams' },
  { archivo: '06_PRIMARIOSP_SW.pdf', tipo: 'PRIMARIO', marca: 'Sherwin-Williams', tinta: 'ARQUITECTONICA', proveedor: 'Sherwin-Williams' }
];

const BASES_SW = ['EXTRA WHITE','ULTRADEEP','DEEP','VIVID YELLOW','LIGHT YELLOW','REAL RED','BASE EMPACADA','NO DISPONIBLE', 'A24WJ01'];
const norm = s => (s || '').replace(/\s+/g, ' ').trim();

function ozDe(oz, a, b, c) {
  return (oz||0) + (a||0)/32 + (b||0)/64 + (c||0)/128;
}

async function parsearPDF(rutaPDF, config) {
  if (!fs.existsSync(rutaPDF)) {
    console.log(`   ❌ No encontré: ${config.archivo}`);
    return [];
  }

  const data = new Uint8Array(fs.readFileSync(rutaPDF));
  const doc = await pdfjs.getDocument(data).promise;
  const formulas = [];
  let currentFormula = null;

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const textContent = await page.getTextContent();
    
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
      
      if (!cols) {
        const headers = row.filter(i => ['oz', '32', '64', '128'].includes(i.str.trim()));
        if (headers.length >= 12) {
          cols = headers.map(h => h.x).sort((a,b)=>a-b);
        }
      }
      
      const fullRowText = row.map(i => i.str).join(" ");

      // Detectar código (soporta SW, A24WJ01 o P1-P6)
      const codeMatch = fullRowText.match(/\b(SW\d{4}|P[1-6]|A24WJ01)\b/);
      
      if (codeMatch) {
        if (currentFormula && currentFormula.colorantes.length > 0) formulas.push(currentFormula);
        
        const codigo = codeMatch[1];
        const mNom = fullRowText.match(new RegExp('\\b' + codigo + '\\b\\s+(.+?)(?:\\s{2,}|\\d{3}-C\\d+|N\\/A|A24WJ01)', 'i'));
        const nombre = mNom ? norm(mNom[1]) : 'Color ' + codigo;

        currentFormula = {
          codigo, nombre, tipo_pintura: config.tipo,
          base_color: 'EXTRA WHITE', pagina: '', variante: 'general', colorantes: [],
          marca: config.marca, tipo_tinta: config.tinta, proveedor_tinta: config.proveedor
        };
      }

      if (currentFormula) {
        // Base
        if (!currentFormula.base_color || currentFormula.base_color === 'EXTRA WHITE') {
          for (const b of BASES_SW) {
            if (fullRowText.includes(b)) { currentFormula.base_color = b; break; }
          }
        }
      }

      // Detectar tinta (ej. "Negro (B1)")
      const tintMatch = fullRowText.match(/([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)?)\s*\(([A-Z]\d)\)/);
      if (tintMatch && currentFormula && cols) {
        const tinta = norm(tintMatch[1]) + ' (' + tintMatch[2] + ')';
        const v = new Array(12).fill(0);
        
        row.forEach(item => {
          if (/^\d+$/.test(item.str.trim())) {
            const num = parseInt(item.str.trim(), 10);
            let minDist = Infinity, colIdx = -1;
            for (let j=0; j<cols.length; j++) {
              const dist = Math.abs(cols[j] - item.x);
              if (dist < minDist) { minDist = dist; colIdx = j; }
            }
            if (minDist < 20 && v[colIdx] === 0) v[colIdx] = num;
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
    (codigo, nombre, tipo_pintura, base_color, variante, locator, pagina, colorantes, total_oz, volumen_ref, marca, tipo_tinta, proveedor_tinta)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
`);

async function main() {
  let totalGeneral = 0;
  for (const config of PDFS_A_CARGAR) {
    console.log(`📄 Leyendo: ${config.archivo}`);
    const ruta = path.join(PDF_DIR, config.archivo);
    const formulas = await parsearPDF(ruta, config);
    
    let total = 0;
    const tx = db.transaction(() => {
      for (const f of formulas) {
        try {
          const total_oz = f.colorantes.reduce((s,c) => s + (c.oz_galon||0), 0);
          ins.run(f.codigo, f.nombre, f.tipo_pintura, f.base_color, f.variante, null, f.pagina || null, 
                  JSON.stringify(f.colorantes), +total_oz.toFixed(4), 'GALON', 
                  config.marca, config.tinta, config.proveedor);
          total++;
        } catch (e) { }
      }
    });
    tx();
    console.log(`   ✅ ${total} fórmulas cargadas\n`);
    totalGeneral += total;
  }
  console.log(`\n🎉 TOTAL NUEVAS: ${totalGeneral} fórmulas\n`);
}

main();