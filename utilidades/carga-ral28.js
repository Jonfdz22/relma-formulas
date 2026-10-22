// carga-ral28.js — Lector exclusivo para RAL-28
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');

const DB_PATH = path.join(__dirname, 'relma.db');
const RUTA_PDF = 'C:\\Users\\SW-ETIK\\Desktop\\Formularios\\RA -28 Formulario Base Entintable 4389 para Ventas.pdf';
const db = new Database(DB_PATH);

const norm = s => (s || '').replace(/\s+/g, ' ').trim();
function ozDe(oz, a, b, c) {
  return (oz||0) + (a||0)/32 + (b||0)/64 + (c||0)/128;
}

async function main() {
  if (!fs.existsSync(RUTA_PDF)) return console.log("❌ No se encontró el PDF de RAL-28");

  const data = new Uint8Array(fs.readFileSync(RUTA_PDF));
  const doc = await pdfjs.getDocument(data).promise;
  const formulas = [];
  let currentFormula = null;

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const textContent = await page.getTextContent();
    
    // Agrupar por renglón
    const rows = [];
    textContent.items.forEach(item => {
      if (!item.str.trim()) return;
      const y = item.transform[5];
      let row = rows.find(r => Math.abs(r.y - y) < 4);
      if (!row) { row = { y: y, items: [] }; rows.push(row); }
      row.items.push({ str: item.str, x: item.transform[4], w: item.width || 0 });
    });

    const sortedRows = rows.sort((a,b) => b.y - a.y);

    for (const row of sortedRows) {
      const items = row.items.sort((a,b) => a.x - b.x);
      const rowText = norm(items.map(i => i.str).join(' '));

      // 1. Detectar Nombre y Código (Ej: "Green Beige" y "1000")
      const nameMatch = rowText.match(/^(.+?)\s+(\d{4})\s+(Ultradeep|Extrawhite)/i);
      if (nameMatch) {
        if (currentFormula && currentFormula.colorantes.length > 0) formulas.push(currentFormula);
        currentFormula = {
          codigo: nameMatch[2], nombre: nameMatch[1].trim(),
          tipo_pintura: 'RAL 28', base_color: nameMatch[3].toUpperCase(),
          colorantes: []
        };
        continue; // Saltamos a la siguiente línea para leer las tintas
      }

      // 2. Detectar Tintas (LB, MY, UO, TW, etc.)
      if (currentFormula) {
        const tintas = rowText.match(/\b(LB|MY|UO|TW|BU|OY|QR|RO|YO|PB|PG|MV)\b/g);
        if (tintas && tintas.length > 0) {
          const tinta = tintas[0]; // Tomamos la primera que aparezca en el renglón
          
          // 3. Asignar los números a las columnas basándonos en su posición X
          // Galón (oz, 1/32, 1/64, 1/128) y Cubeta (oz, 1/32, 1/64, 1/128)
          const v = { gal: [0,0,0,0], cub: [0,0,0,0] };
          
          items.forEach(item => {
            if (/^\d+$/.test(item.str.trim())) {
              const num = parseInt(item.str.trim(), 10);
              const x = item.x;
              
              // Coordenadas exactas de la captura:
              // Galón: oz(328), 1/32(357), 1/64(391), 1/128(422)
              // Cubeta: oz(463), 1/32(492), 1/64(526), 1/128(556)
              if (x > 310 && x < 340 && v.gal[0] === 0) v.gal[0] = num;
              else if (x > 340 && x < 370 && v.gal[1] === 0) v.gal[1] = num;
              else if (x > 370 && x < 400 && v.gal[2] === 0) v.gal[2] = num;
              else if (x > 400 && x < 440 && v.gal[3] === 0) v.gal[3] = num;
              
              else if (x > 450 && x < 480 && v.cub[0] === 0) v.cub[0] = num;
              else if (x > 480 && x < 510 && v.cub[1] === 0) v.cub[1] = num;
              else if (x > 510 && x < 540 && v.cub[2] === 0) v.cub[2] = num;
              else if (x > 540 && x < 570 && v.cub[3] === 0) v.cub[3] = num;
            }
          });

          const oz_galon = ozDe(v.gal[0], v.gal[1], v.gal[2], v.gal[3]);
          const oz_cubeta = ozDe(v.cub[0], v.cub[1], v.cub[2], v.cub[3]);

          if (oz_galon > 0 || oz_cubeta > 0) {
            currentFormula.colorantes.push({
              tinta,
              oz_galon: +oz_galon.toFixed(4),
              oz_litro: 0,
              oz_cubeta: +oz_cubeta.toFixed(4)
            });
          }
        }
      }
    }
  }
  if (currentFormula && currentFormula.colorantes.length > 0) formulas.push(currentFormula);

  // Guardar en Base de Datos
  db.prepare("DELETE FROM colores_linea WHERE tipo_pintura = 'RAL 28'").run();
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
  console.log(`✅ RAL 28: ${formulas.length} fórmulas cargadas correctamente.`);
}
main();