// carga-libros.js v5 — Lector universal definitivo (arregla letras rotas y RAL)
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');

const DB_PATH = path.join(__dirname, 'relma.db');
const PDF_DIR = 'C:\\Users\\SW-ETIK\\Desktop\\Formularios';
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

const LIBROS = [
  { prefijo: '05_MINWAX', nombre: 'Minwax Wood Stain', tipo: 'MINWAX' },
  { prefijo: '07_COMEX', nombre: 'Comex ColorLife', tipo: 'COMEX' },
  { prefijo: '08_COMEX', nombre: 'Comex ColorLife 2.0', tipo: 'COMEX' },
  { prefijo: '09_BEREL', nombre: 'Berel International', tipo: 'BEREL' },
  { prefijo: '10_BEREL', nombre: 'Berel Multitono', tipo: 'BEREL' },
  { prefijo: 'Fórmulas 4000', nombre: 'SW 4000 Industrial', tipo: 'SW 4000' },
  { prefijo: 'RA -28', nombre: 'RAL 28', tipo: 'RAL' },
  { prefijo: 'RA-26', nombre: 'RAL 26', tipo: 'RAL' }
];

const norm = s => (s || '').replace(/\s+/g, ' ').trim();

function ozDe(oz, a, b, c) {
  return (oz||0) + (a||0)/32 + (b||0)/64 + (c||0)/128;
}

async function parsearPDF(rutaPDF, config) {
  if (!fs.existsSync(rutaPDF)) return [];

  const data = new Uint8Array(fs.readFileSync(rutaPDF));
  const doc = await pdfjs.getDocument(data).promise;
  const formulas = [];
  let currentFormula = null;

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const textContent = await page.getTextContent();
    
    // 1. Agrupar por renglón
    const rows = [];
    textContent.items.forEach(item => {
      if (!item.str.trim()) return;
      const y = item.transform[5];
      let row = rows.find(r => Math.abs(r.y - y) < 5); // Tolerancia de 5px
      if (!row) {
        row = { y: y, items: [] };
        rows.push(row);
      }
      row.items.push({ str: item.str, x: item.transform[4], w: item.width || 0 });
    });

    const sortedRows = rows.sort((a,b) => b.y - a.y);
    let cols = null;

    for (const row of sortedRows) {
      const items = row.items.sort((a,b) => a.x - b.x);
      
      // 2. Detectar Columnas (soporta 8 y 12 columnas, con o sin 1/)
      if (!cols) {
        const headers = items.filter(i => ['oz', '32', '64', '128', '1/32', '1/64', '1/128'].includes(i.str.trim()));
        if (headers.length >= 8) { 
          cols = headers.map(h => h.x).sort((a,b)=>a-b);
        }
      }
      
      // 3. Unir el texto del renglón reconstruyendo los espacios
      let rowText = "";
      let lastX = 0;
      items.forEach(item => {
        if (lastX !== 0) {
            const diff = item.x - lastX;
            if (diff > 3) rowText += " "; // Si hay separación, poner espacio
        }
        rowText += item.str;
        lastX = item.x + item.w;
      });
      rowText = norm(rowText);

      // 4. Detectar Código y Nombre
      let codigo = null;
      let nombre = '';
      
      // Buscamos en la zona izquierda (X < 200)
      const leftItems = items.filter(i => i.x < 200);
      if (leftItems.length > 0) {
        let textIzquierda = "";
        let lastXL = 0;
        leftItems.forEach(item => {
            if (lastXL !== 0 && item.x - lastXL > 3) textIzquierda += " ";
            textIzquierda += item.str;
            lastXL = item.x + item.w;
        });
        textIzquierda = norm(textIzquierda);

        if (config.tipo === 'RAL') {
            const m = textIzquierda.match(/^(.+?)\s+(\d{4})$/);
            if (m) { nombre = m[1].trim(); codigo = m[2]; }
        } else if (config.tipo === 'COMEX') {
            const m = textIzquierda.match(/([A-Z0-9]+-\d+)\s*(.+)?/i);
            if (m) { codigo = m[1]; nombre = m[2] ? m[2].trim() : codigo; }
        } else if (config.tipo === 'BEREL') {
            const m = textIzquierda.match(/(\d{3}|\d-\d{4}[A-Z])\s*(.+)?/i);
            if (m) { codigo = m[1]; nombre = m[2] ? m[2].trim() : codigo; }
        } else if (config.tipo === 'MINWAX') {
            const m = textIzquierda.match(/N\/A\s+(.+)/i);
            if (m) { codigo = m[1].trim(); nombre = codigo; }
        } else if (config.tipo === 'SW 4000') {
            const m = textIzquierda.match(/(SW\s?\d{4})\s*(.+)?/i);
            if (m) { codigo = m[1]; nombre = m[2] ? m[2].trim() : codigo; }
        }
      }

      if (codigo && (!currentFormula || currentFormula.codigo !== codigo)) {
        if (currentFormula && currentFormula.colorantes.length > 0) formulas.push(currentFormula);
        
        let base = 'NO ESPECIFICADA';
        if (rowText.match(/Ultradeep/i)) base = 'ULTRADEEP';
        else if (rowText.match(/Extrawhite|Extra White/i)) base = 'EXTRA WHITE';
        else if (rowText.match(/Deep/i)) base = 'DEEP';
        else if (rowText.match(/Light Yellow/i)) base = 'LIGHT YELLOW';
        else if (rowText.match(/Vivid Yellow/i)) base = 'VIVID YELLOW';

        currentFormula = {
            codigo: codigo, nombre: nombre, tipo_pintura: config.tipo,
            base_color: base, pagina: '', variante: 'general', colorantes: []
        };
      }

      // 5. Detectar Tintas
      let tintasEnFila = [];
      if (config.tipo === 'RAL') {
          // En RAL las tintas son 2 letras mayúsculas
          const m = rowText.match(/\b(LB|MY|UO|TW|BU|OY|QR|RO|YO|PB|PG|MV)\b/g);
          if (m) tintasEnFila = [...new Set(m)];
      } else {
          // En los otros, son "Nombre (Codigo)"
          const m = rowText.matchAll(/([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)?)\s*\(([A-Z0-9]{1,2})\)/g);
          for (const match of m) {
             tintasEnFila.push(norm(match[1]) + ' (' + match[2] + ')');
          }
      }

      // 6. Asignar números a las columnas
      if (tintasEnFila.length > 0 && currentFormula && cols) {
        const v = new Array(cols.length).fill(0);
        
        items.forEach(item => {
          if (/^\d+$/.test(item.str.trim())) {
            const num = parseInt(item.str.trim(), 10);
            let minDist = Infinity, colIdx = -1;
            for (let j=0; j<cols.length; j++) {
              const dist = Math.abs(cols[j] - item.x);
              if (dist < minDist) { minDist = dist; colIdx = j; }
            }
            if (minDist < 25 && v[colIdx] === 0) v[colIdx] = num;
          }
        });
        
        tintasEnFila.forEach(tinta => {
          let oz_litro = 0, oz_galon = 0, oz_cubeta = 0;

          if (config.tipo === 'RAL' || config.tipo === 'SW 4000') {
              // Solo tienen 8 columnas: Galón (0-3) y Cubeta (4-7)
              oz_galon = ozDe(v[0], v[1], v[2], v[3]);
              oz_cubeta = ozDe(v[4], v[5], v[6], v[7]);
          } else {
              // Tienen 12 columnas: Litro (0-3), Galón (4-7), Cubeta (8-11)
              oz_litro = ozDe(v[0], v[1], v[2], v[3]);
              oz_galon = ozDe(v[4], v[5], v[6], v[7]);
              oz_cubeta = ozDe(v[8], v[9], v[10], v[11]);
          }

          if (oz_galon > 0 || oz_litro > 0 || oz_cubeta > 0) {
            if (!currentFormula.colorantes.some(c => c.tinta === tinta)) {
                currentFormula.colorantes.push({
                  tinta, oz_galon: +oz_galon.toFixed(4), 
                  oz_litro: +oz_litro.toFixed(4), oz_cubeta: +oz_cubeta.toFixed(4)
                });
            }
          }
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
  console.log("🧹 Limpiando intentos anteriores...");
  db.prepare("DELETE FROM colores_linea WHERE tipo_pintura NOT IN ('BASE AGUA', 'BASE SOLVENTE', 'PROCONSTRUCTOR')").run();

  let totalGeneral = 0;
  const archivosEnCarpeta = fs.readdirSync(PDF_DIR);

  for (const config of LIBROS) {
    const archivoReal = archivosEnCarpeta.find(f => f.startsWith(config.prefijo) && f.endsWith('.pdf'));
    
    if (!archivoReal) {
      console.log(`⏭️  Saltando ${config.nombre}: No se encontró el PDF.`);
      continue;
    }

    console.log(`📄 Leyendo: ${archivoReal}`);
    const ruta = path.join(PDF_DIR, archivoReal);
    const formulas = await parsearPDF(ruta, config);
    
    let total = 0;
    const tx = db.transaction(() => {
      for (const f of formulas) {
        try {
          const total_oz = f.colorantes.reduce((s,c) => s + (c.oz_galon||0), 0);
          ins.run(f.codigo, f.nombre, f.tipo_pintura, f.base_color, f.variante, null, f.pagina || null, 
                  JSON.stringify(f.colorantes), +total_oz.toFixed(4), 'GALON', 
                  'Sherwin-Williams', 'MAXITONER', 'Maxitoner');
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