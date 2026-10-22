// carga-berel.js — Lector exclusivo para Berel International
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');

const DB_PATH = path.join(__dirname, 'relma.db');
// ⚠️ OJO: Ajusta el nombre del PDF si es necesario
const RUTA_PDF = 'C:\\Users\\SW-ETIK\\Desktop\\Formularios\\09_BEREL_INTERNATIONAL.pdf';
const db = new Database(DB_PATH);

const norm = s => (s || '').replace(/\s+/g, ' ').trim();
function ozDe(oz, a, b, c) {
  return (oz||0) + (a||0)/32 + (b||0)/64 + (c||0)/128;
}

async function main() {
  if (!fs.existsSync(RUTA_PDF)) return console.log("❌ No se encontró el PDF de Berel");

  const data = new Uint8Array(fs.readFileSync(RUTA_PDF));
  const doc = await pdfjs.getDocument(data).promise;
  const formulas = [];
  let currentFormula = null;

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const textContent = await page.getTextContent();
    
    const rows = [];
    textContent.items.forEach(item => {
      if (!item.str.trim()) return;
      const y = item.transform[5];
      let row = rows.find(r => Math.abs(r.y - y) < 5);
      if (!row) { row = { y: y, items: [] }; rows.push(row); }
      row.items.push({ str: item.str, x: item.transform[4], w: item.width || 0 });
    });

    const sortedRows = rows.sort((a,b) => b.y - a.y);
    let cols = null;

    for (const row of sortedRows) {
      const items = row.items.sort((a,b) => a.x - b.x);
      
      if (!cols) {
        const headers = items.filter(i => ['oz', '32', '64', '128'].includes(i.str.trim()));
        if (headers.length >= 12) { 
          cols = headers.map(h => h.x).sort((a,b)=>a-b);
        }
      }
      
      // Reconstruir texto juntando letras rotas
      let rowText = "";
      let lastX = 0;
      items.forEach(item => {
        if (lastX !== 0 && item.x - lastX > 3) rowText += " ";
        rowText += item.str;
        lastX = item.x + item.w;
      });
      rowText = norm(rowText);

      // Código: 312, 313, 4-1905D, etc.
      const codeMatch = rowText.match(/^(\d{3}|\d-\d{4}[A-Z])\s+(.+?)\s+(DEEP|EXTRA WHITE|LIGHT YELLOW|VIVID YELLOW)/i);
      if (codeMatch) {
        if (currentFormula && currentFormula.colorantes.length > 0) formulas.push(currentFormula);
        currentFormula = {
          codigo: codeMatch[1], nombre: codeMatch[2].trim(),
          tipo_pintura: 'BEREL', base_color: codeMatch[3].toUpperCase(),
          colorantes: []
        };
      }

      if (currentFormula) {
        const tintMatch = rowText.match(/([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)?)\s*\(([A-Z0-9]{1,2})\)/);
        if (tintMatch && cols) {
          const tinta = norm(tintMatch[1]) + ' (' + tintMatch[2] + ')';
          const v = new Array(12).fill(0);
          
          items.forEach(item => {
            if (/^\d+$/.test(item.str.trim())) {
              const num = parseInt(item.str.trim(), 10);
              let minDist = Infinity, colIdx = -1;
              for (let j=0; j<12; j++) {
                const dist = Math.abs(cols[j] - item.x);
                if (dist < minDist) { minDist = dist; colIdx = j; }
              }
              if (minDist < 25 && v[colIdx] === 0) v[colIdx] = num;
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

  db.prepare("DELETE FROM colores_linea WHERE tipo_pintura = 'BEREL'").run();
  const ins = db.prepare(`
    INSERT INTO colores_linea (codigo, nombre, tipo_pintura, base_color, variante, colorantes, total_oz, volumen_ref, marca, tipo_tinta, proveedor_tinta)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
  `);
  
  const tx = db.transaction(() => {
    for (const f of formulas) {
      const total_oz = f.colorantes.reduce((s,c) => s + (c.oz_galon||0), 0);
      ins.run(f.codigo, f.nombre, f.tipo_pintura, f.base_color, 'general', JSON.stringify(f.colorantes), total_oz, 'GALON', 'Sherwin-Williams', 'MAXITONER', 'Maxitoner');
    }
  });
  tx();
  console.log(`✅ Berel: ${formulas.length} fórmulas cargadas correctamente.`);
}
main();
