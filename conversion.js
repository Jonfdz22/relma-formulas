// =====================================================
// MOTOR DE CONVERSIÓN RELMA
// 1 onza (HOZ) = unidad base
// 1 bote de tinta = 32 onzas
// Fracciones: 32, 64, 128
// Capacidades pintura: LT=1, GAL=4, CBT=19 (exactos)
// =====================================================

function parsearFormulaA128(texto) {
  if (texto === null || texto === undefined) return 0;
  const original = String(texto).trim();
  if (original === "") return 0;

  const str = original.toLowerCase().replace(/,/g, ".");
  const partes = str.split("+").map(p => p.trim()).filter(p => p !== "");
  let total128 = 0;

  for (const parte of partes) {
    let m;

    m = parte.match(/^(\d+(?:\.\d+)?)\s*(hoz|h|onzas?|oz)$/);
    if (m) { total128 += parseFloat(m[1]) * 128; continue; }

    m = parte.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+)$/);
    if (m) {
      total128 += (parseFloat(m[1]) / parseFloat(m[2])) * 128;
      continue;
    }

    m = parte.match(/^(\d+(?:\.\d+)?)$/);
    if (m) { total128 += parseFloat(m[1]) * 128; continue; }

    return null;
  }
  return total128;
}

function formatearDesde128Truncado(total128, maquina) {
  maquina = (maquina === 64) ? 64 : 32;
  const onzasOut = Math.floor(total128 / 128);

  const resto128 = Math.round((total128 - onzasOut * 128) * 1000) / 1000;

  const resto64Raw = resto128 / 2;
  const resto64    = Math.floor(resto64Raw);
  const residuo64  = resto64Raw - resto64;

  let texto = onzasOut + " HOZ";

  if (maquina === 32) {
    const resto32Raw = resto64 / 2;
    const resto32    = Math.floor(resto32Raw);
    const residuo32  = resto32Raw - resto32;

    const f64  = (residuo32 >= 0.5) ? 1 : 0;
    const f128 = (residuo64 >= 0.5) ? 1 : 0;

    if (resto32 > 0) texto += " + " + resto32 + "/32";
    if (f64  > 0)    texto += " + " + f64  + "/64";
    if (f128 > 0)    texto += " + " + f128 + "/128";
  } else {
    const f128 = (residuo64 >= 0.5) ? 1 : 0;
    if (resto64 > 0) texto += " + " + resto64 + "/64";
    if (f128    > 0) texto += " + " + f128   + "/128";
  }

  return texto;
}

function convertirFormula(texto, capOrigen, capDestino, maquina) {
  if (!texto) return "";
  const lineas = texto.split("\n");
  const resultado = [];

  for (const linea of lineas) {
    const limpia = linea.trim();
    if (limpia === "") continue;

    const partes = limpia.split(/[|=]/);
    if (partes.length < 2) continue;

    const tinta    = partes[0].trim();
    const cantidad = partes.slice(1).join("=").trim();

    const total128 = parsearFormulaA128(cantidad);
    if (total128 === null) {
      resultado.push(tinta + " = ERROR DE FORMATO");
      continue;
    }

    const convertida = formatearDesde128Truncado(
      (total128 / capOrigen) * capDestino, maquina
    );
    resultado.push(tinta + " = " + convertida);
  }

  return resultado.join("\n");
}

function ejecutarTests() {
  const casos = [
    ["parse 18/64",              parsearFormulaA128("18/64"),            36],
    ["parse 1/128",              parsearFormulaA128("1/128"),            1],
    ["parse 38 hoz + 16/32",     parsearFormulaA128("38 hoz + 16/32"),   38*128+64],
    ["parse 24 HOZ",             parsearFormulaA128("24 HOZ"),           24*128],
    ["parse 10/32",              parsearFormulaA128("10/32"),            40],
    ["ind 3/64",                 formatearDesde128Truncado(6, 32),       "0 HOZ + 1/32 + 1/64"],
    ["ind 5/128",                formatearDesde128Truncado(5, 32),       "0 HOZ + 1/32 + 1/128"],
    ["arq 3/64",                 formatearDesde128Truncado(6, 64),       "0 HOZ + 3/64"],
    ["arq 5/128",                formatearDesde128Truncado(5, 64),       "0 HOZ + 2/64 + 1/128"],
  ];

  let ok = 0, fail = 0;
  console.log("=== PRUEBAS DEL MOTOR ===");
  for (const [desc, got, exp] of casos) {
    if (got === exp) { ok++; console.log("✓ " + desc); }
    else { fail++; console.log("✗ " + desc + "  ->  " + got + "  (esperado: " + exp + ")"); }
  }
  console.log("\n" + ok + " OK, " + fail + " fallos\n");

  const ejemplo = convertirFormula("VERDE PG=18/64 + 1/128", 1, 19, 32);
  console.log("Ejemplo del resumen:");
  console.log(ejemplo);
  console.log("Esperado: VERDE PG = 5 HOZ + 15/32 + 1/64 + 1/128");
}

if (require.main === module) ejecutarTests();

module.exports = {
  parsearFormulaA128,
  formatearDesde128Truncado,
  convertirFormula,
};
