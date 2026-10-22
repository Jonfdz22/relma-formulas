// carga-linea.js v7 — Parser definitivo (lectura inteligente)
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, 'relma.db');
const LINEA_DIR = path.join(__dirname, 'linea');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

const BASES_SW = ['EXTRA WHITE','ULTRADEEP','DEEP','VIVID YELLOW','LIGHT YELLOW','REAL RED','BASE EMPACADA','NO DISPONIBLE'];
const norm = s => (s || '').replace(/\s+/g, ' ').trim();

function ozDe(oz, a, b, c) {
  return (oz||0) + (a||0)/32 + (b||0)/64 + (c||0)/128;
}

// Lectura inteligente: asigna cada número a la columna más cercana
function leer12(line, cols) {
  const v = new Array(12).fill(0);
  const regexNum = /\d+/g;
  let match;
  const numeros = [];
  
  while ((match = regexNum.exec(line)) !== null) {
    const num = parseInt(match[0], 10);
    const pos = match.index;
    
    // Ignorar números muy a la izquierda
    if (pos > 40) { 
      numeros.push({ valor: num, pos: pos });
    }
  }
  
  for (const num of numeros) {
    let minDist = Infinity;
    let colIndex = -1;
    
    for (let i = 0; i < 12; i++) {
      const dist = Math.abs(cols[i] - num.pos);
      if (dist < minDist) {
        minDist = dist;
        colIndex = i;
      }
    }
    
    if (minDist <= 15) {
      if (v[colIndex] === 0) {
        v[colIndex] = num.valor;
      } else {
        let bestCol = -1;
        let bestDist = Infinity;
        for (let i = 0; i < 12; i++) {
          if (v[i] === 0) {
            const d = Math.abs(cols[i] - num.pos);
            if (d < bestDist && d < 20) {
              bestDist = d;
              bestCol = i;
            }
          }
        }
        if (bestCol !== -1) v[bestCol] = num.valor;
      }
    }
  }
  return v;
}

function parsearSW(texto, tipoPintura) {
  const lines = texto.split(/\r?\n/);
  const formulas = [];

  let cols = null;
  for (const ln of lines) {
    const matches = [...ln.matchAll(/\boz\s+32\s+64\s+128/g)];
    if (matches.length >= 3) {
      cols = [];
      for (const m of matches) {
        const str = m[0], start = m.index;
        let off = 0;
        for (const tok of ['oz','32','64','128']) {
          const idx = str.indexOf(tok, off);
          cols.push(start + idx);
          off = idx + tok.length;
        }
      }
      break;
    }
  }
  if (!cols || cols.length !== 12) return [];

  const bloques = [];
  let cur = null;
  for (const ln of lines) {
    const mCode = ln.match(/\b(SW\d{4})\b/);
    if (mCode) {
      if (cur) bloques.push(cur);
      cur = { codigo: mCode[1], lineas: [ln] };
    } else if (cur) {
      if (ln.trim()) cur.lineas.push(ln);
    }
  }
  if (cur) bloques.push(cur);

  for (const bl of bloques) {
    const f = {
      codigo: bl.codigo, nombre: '',
      tipo_pintura: tipoPintura, base_color: '', variante: 'general',
      pagina: '', colorantes: []
    };

    const primera = bl.lineas[0];

    const mNom = primera.match(new RegExp('\\b' + f.codigo + '\\b\\s+(.+?)(?:\\s{2,}|\\d{3}-C\\d+|N\\/A)', 'i'));
    if (mNom) f.nombre = norm(mNom[1]).replace(/^[\\|\\s]+/, '');

    for (const ln of bl.lineas) {
      if (!f.pagina) {
        const mPag = ln.match(/\b(\d{3}-C\d+)\b/);
        if (mPag) f.pagina = mPag[1];
      }
      
      if (!f.base_color) {
        for (const b of BASES_SW) {
          const re = new RegExp('\\b' + b.replace(/\s+/g, '\\s+') + '\\b');
          if (re.test(ln)) { f.base_color = b; break; }
        }
      }

      if (/Solo para Interiores|Fórmula Interior/i.test(ln)) f.variante = 'interior';
      if (/Para uso en Exteriores/i.test(ln)) f.variante = 'exterior';
    }

    const reCol = /([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)?)\s*\(([A-Z]\d)\)/g;

    for (const ln of bl.lineas) {
      let mc;
      reCol.lastIndex = 0;
      while ((mc = reCol.exec(ln)) !== null) {
        const tinta = norm(mc[1]) + ' (' + mc[2] + ')';
        const v = leer12(ln, cols);
        f.colorantes.push({
          tinta,
          oz_galon: +ozDe(v[4], v[5], v[6], v[7]).toFixed(4),
          oz_litro: +ozDe(v[0], v[1], v[2], v[3]).toFixed(4),
          oz_cubeta: +ozDe(v[8], v[9], v[10], v[11]).toFixed(4)
        });
      }
    }

    if (f.base_color && f.colorantes.length > 0) formulas.push(f);
  }
  return formulas;
}

function parsearMetalex(texto) {
  const lines = texto.split(/\r?\n/);
  const formulas = [];
  let cur = null;
  let baseActual = 'Metalex Ultra Deep Brillante';

  for (const ln of lines) {
    if (/Metalex\s+Ultra\s+Deep/i.test(ln)) baseActual = 'Metalex Ultra Deep Brillante';

    const mCod = ln.match(/(CSW\d{4})\s+(.+?)\s{2,}/);
    if (mCod) {
      if (cur) formulas.push(cur);
      cur = {
        codigo: mCod[1], nombre: norm(mCod[2]),
        tipo_pintura: 'METALEX', base_color: baseActual,
        variante: 'general', pagina: '', colorantes: []
      };
      extraerColoranteMetalex(ln, cur);
      continue;
    }
    if (cur) extraerColoranteMetalex(ln, cur);
  }
  if (cur) formulas.push(cur);
  return formulas.filter(f => f.colorantes.length > 0);
}

function extraerColoranteMetalex(ln, cur) {
  const re = /([A-Za-z][A-Za-z ]+?)\s*\(([A-Z]{2})\)\s+([\d\s]+)$/;
  const m = ln.match(re);
  if (!m) return;
  const tinta = norm(m[1]) + ' (' + m[2] + ')';
  const nums = m[3].trim().split(/\s+/).map(Number);
  while (nums.length < 12) nums.push(0);
  const oz_g = ozDe(nums[4], nums[5], nums[6], nums[7]);
  if (oz_g > 0) {
    cur.colorantes.push({
      tinta,
      oz_galon: +oz_g.toFixed(4),
      oz_litro: 0, oz_cubeta: 0
    });
  }
}

function detectarFormato(txt) {
  const h = txt.substring(0, 4000);
  if (/Formulario Base solvente con Tintas Maxitoner/i.test(h)) return 'METALEX';
  if (/LIBRO DE/.test(h) && /BASE AGUA/i.test(h))       return 'SW_AGUA';
  if (/LIBRO DE/.test(h) && /BASE SOLVENTE/i.test(h))   return 'SW_SOLVENTE';
  if (/LIBRO DE/.test(h) && /PROCONSTRUCTOR/i.test(h))  return 'SW_PROCONSTRUCTOR';
  return 'DESCONOCIDO';
}

const ins = db.prepare(`
  INSERT OR REPLACE INTO colores_linea
    (codigo, nombre, tipo_pintura, base_color, variante, locator, pagina,
     colorantes, total_oz, volumen_ref, marca)
  VALUES (?,?,?,?,?,?,?,?,?,?,?)
`);

function guardar(formulas, marca) {
  let n = 0, saltadas = 0;
  const tx = db.transaction(() => {
    for (const f of formulas) {
      try {
        const total = f.colorantes.reduce((s,c) => s + (c.oz_galon||0), 0);
        ins.run(f.codigo, f.nombre, f.tipo_pintura, f.base_color, f.variante,
          null, f.pagina || null, JSON.stringify(f.colorantes),
          +total.toFixed(4), 'GALON', marca);
        n++;
      } catch (e) { saltadas++; }
    }
  });
  tx();
  return { n, saltadas };
}

function main() {
  const archivos = fs.readdirSync(LINEA_DIR).filter(f => f.toLowerCase().endsWith('.txt')).sort();
  console.log(`📂 ${archivos.length} archivos\n`);
  let total = 0;
  for (const arch of archivos) {
    const txt = fs.readFileSync(path.join(LINEA_DIR, arch), 'utf8');
    const fmt = detectarFormato(txt);
    console.log(`📄 ${arch}  → ${fmt}`);
    let formulas = [];
    if (fmt === 'SW_AGUA')               formulas = parsearSW(txt, 'BASE AGUA');
    else if (fmt === 'SW_SOLVENTE')      formulas = parsearSW(txt, 'BASE SOLVENTE');
    else if (fmt === 'SW_PROCONSTRUCTOR') formulas = parsearSW(txt, 'PROCONSTRUCTOR');
    else if (fmt === 'METALEX')          formulas = parsearMetalex(txt);
    else { console.log(`   ⏭️  Saltado\n`); continue; }

    const { n, saltadas } = guardar(formulas, 'Sherwin-Williams');
    console.log(`   ✅ ${n} cargadas${saltadas ? `, ${saltadas} saltadas` : ''}\n`);
    total += n;
  }
  console.log(`\n🎉 TOTAL: ${total} fórmulas\n`);
  const resumen = db.prepare(`
    SELECT tipo_pintura, base_color, COUNT(*) as n
    FROM colores_linea GROUP BY tipo_pintura, base_color
    ORDER BY tipo_pintura, n DESC
  `).all();
  console.log('📊 Resumen:');
  for (const r of resumen)
    console.log(`   ${r.tipo_pintura.padEnd(18)} ${r.base_color.padEnd(28)} ${r.n}`);
}

main(); // <--- ¡Esto faltaba en tu archivo anterior!