// carga-comex.js v5 — Lector por coordenadas estricto (sin adivinar)
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');

const DB_PATH = path.join(__dirname, 'relma.db');
const PDF_DIR = 'C:\\Users\\SW-ETIK\\Desktop\\Formularios';
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

const norm = s => (s || '').replace(/\s+/g, ' ').trim();
function ozDe(oz, a, b, c) {
  return (oz||0) + (a||0)/32 + (b||0)/64 + (c||0)/128;
}

async function parsearPDF(rutaPDF, tipo) {
  const data = new Uint8Array(fs.readFileSync(rutaPDF));
  const doc = await pdfjs.getDocument(data).promise;
  const formulas = [];
  let currentFormula = null;

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const textContent = await page.getTextContent();
    
    // Agrupar textos por Y (renglón) con tolerancia de 3px
    const rows = [];
    textContent.items.forEach(item => {
      if (!item.str.trim()) return;
      const y = item.transform[5];
      let row = rows.find(r => Math.abs(r.y - y) < 3);
      if (!row) { row = { y: y, items: [] }; rows.push(row); }
      row.items.push({ str: item.str, x: item.transform[4], w: item.width || 0 });
    });

    const sortedRows = rows.sort((a,b) => b.y - a.y);
    let cols = null;

    for (const row of sortedRows) {
      const items = row.items.sort((a,b) => a.x - b.x);
      
      // 1. Detectar Columnas en el encabezado
      if (!cols) {
        const headers = items.filter(i => ['oz', '32', '64', '128'].includes(i.str.trim()));
        if (headers.length >= 12) { 
          cols = headers.map(h => h.x).sort((a,b)=>a-b);
        }
      }
      
      let rowText = "";
      let lastX = 0;
      items.forEach(item => {
        if (lastX !== 0 && item.x - lastX > 3) rowText += " ";
        rowText += item.str;
        lastX = item.x + item.w;
      });
      rowText = norm(rowText);

      // 2. Detectar Código (A1-01, 214-04) usando un regex que atrapa todo
      const codeMatch = rowText.match(/([A-Z0-9]+)[\s\-‐]+(\d+)/i);
      if (codeMatch) {
        if (currentFormula && currentFormula.colorantes.length > 0) formulas.push(currentFormula);
        
        const codigo = codeMatch[1] + '-' + codeMatch[2];
        const partes = rowText.split(codeMatch[0]);
        let nombre = partes[1] ? partes[1].trim().split(/\s{2,}/)[0].trim() : codigo;
        
        currentFormula = {
          codigo, nombre, tipo_pintura: tipo, base_color: 'EXTRA WHITE',
          pagina: '', variante: 'general', colorantes: []
        };
      }

      if (currentFormula) {
        // 3. Detectar Base
        if (rowText.match(/ULTRADEEP/i)) currentFormula.base_color = 'ULTRADEEP';
        else if (rowText.match(/DEEP/i)) currentFormula.base_color = 'DEEP';
        else if (rowText.match(/LIGHT YELLOW/i)) currentFormula.base_color = 'LIGHT YELLOW';
        else if (rowText.match(/VIVID YELLOW/i)) currentFormula.base_color = 'VIVID YELLOW';
        else if (rowText.match(/EXTRA WHITE/i)) currentFormula.base_color = 'EXTRA WHITE';

        // 4. Detectar Tintas (Azul, Magenta, etc)
        const tintMatch = rowText.match(/([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)?)\s*\(([A-Z0-9]{1,2})\)/);
        if (tintMatch && cols) {
          const tinta = norm(tintMatch[1]) + ' (' + tintMatch[2] + ')';
          
          // 5. Asignar números a las columnas basándonos en su posición X
          const v = new Array(12).fill(0);
          items.forEach(item => {
            if (/^\d+$/.test(item.str.trim())) {
              const num = parseInt(item.str.trim(), 10);
              let minDist = Infinity, colIdx = -1;
              for (let j=0; j<12; j++) {
                const dist = Math.abs(cols[j] - item.x);
                if (dist < minDist) { minDist = dist; colIdx = j; }
              }
              // Si el número está alineado a la columna, lo guardamos
              if (minDist < 15 && v[colIdx] === 0) v[colIdx] = num;
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
  console.log("🧹 Limpiando intentos anteriores de Comex...");
  db.prepare("DELETE FROM colores_linea WHERE tipo_pintura LIKE 'COMEX%'").run();

  const archivos = [
    { file: '07_COMEX_COLORLIFE.pdf', tipo: 'COMEX COLORLIFE' },
    { file: '08_COMEX_COLORLIFE 2.pdf', tipo: 'COMEX COLORLIFE 2.0' }
  ];

  let totalGeneral = 0;

  for (const arch of archivos) {
    let rutaPDF = path.join(PDF_DIR, arch.file);
    if (!fs.existsSync(rutaPDF)) {
       const encontrado = fs.readdirSync(PDF_DIR).find(f => f.includes(arch.file.split('_')[0]));
       if (encontrado) rutaPDF = path.join(PDF_DIR, encontrado);
       else { continue; }
    }

    console.log(`📄 Leyendo: ${path.basename(rutaPDF)}`);
    const formulas = await parsearPDF(rutaPDF, arch.tipo);
    
    let total = 0;
    const tx = db.transaction(() => {
      for (const f of formulas) {
        try {
          const total_oz = f.colorantes.reduce((s,c) => s + (c.oz_galon||0), 0);
          ins.run(f.codigo, f.nombre, f.tipo_pintura, f.base_color, f.variante, null, f.pagina || null, 
                  JSON.stringify(f.colorantes), +total_oz.toFixed(4), 'GALON', 
                  'Sherwin-Williams', 'ARQUITECTONICA', 'Comex');
          total++;
        } catch (e) { }
      }
    });
    tx();
    console.log(`   ✅ ${total} fórmulas cargadas de ${arch.tipo}\n`);
    totalGeneral += total;
  }

  console.log(`\n🎉 TOTAL COMEX: ${totalGeneral} fórmulas\n`);
}

main();