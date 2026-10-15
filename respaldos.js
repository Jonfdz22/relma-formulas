const fs = require("fs");
const path = require("path");
const { db, logCambio } = require("./database");

const CARPETA_LOCAL = path.join(__dirname, "respaldos");
const MAX_RESPALDOS = 30;
let INTERVALO_HORAS = 6;
let CARPETA_DRIVE = null;
let timer = null;

function asegurarCarpetas() {
  if (!fs.existsSync(CARPETA_LOCAL)) fs.mkdirSync(CARPETA_LOCAL, { recursive: true });
  if (CARPETA_DRIVE && !fs.existsSync(CARPETA_DRIVE)) {
    try { fs.mkdirSync(CARPETA_DRIVE, { recursive: true }); } catch(e) {}
  }
}

function nombreRespaldo() {
  const now = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `relma_${now.getFullYear()}-${p(now.getMonth()+1)}-${p(now.getDate())}_${p(now.getHours())}-${p(now.getMinutes())}.db`;
}

function respaldarAhora(usuario = "sistema") {
  try {
    asegurarCarpetas();
    db.pragma("wal_checkpoint(TRUNCATE)");
    const origen = path.join(__dirname, "relma.db");
    const nombre = nombreRespaldo();
    const destino = path.join(CARPETA_LOCAL, nombre);
    fs.copyFileSync(origen, destino);

    let copiadoDrive = false;
    if (CARPETA_DRIVE) {
      try {
        fs.copyFileSync(destino, path.join(CARPETA_DRIVE, nombre));
        copiadoDrive = true;
      } catch (e) {
        console.error("Error copiando a Drive:", e.message);
      }
    }

    limpiarViejos(CARPETA_LOCAL, MAX_RESPALDOS);
    if (CARPETA_DRIVE) limpiarViejos(CARPETA_DRIVE, MAX_RESPALDOS);

    logCambio(usuario, "BACKUP_AUTO", "sistema", null, { archivo: nombre, drive: copiadoDrive });
    return { ok: true, archivo: nombre, drive: copiadoDrive };
  } catch (e) {
    console.error("Error en respaldo:", e.message);
    return { ok: false, error: e.message };
  }
}

function limpiarViejos(carpeta, max) {
  try {
    const archivos = fs.readdirSync(carpeta)
      .filter(f => f.startsWith("relma_") && f.endsWith(".db"))
      .map(f => ({ nombre: f, fecha: fs.statSync(path.join(carpeta, f)).mtimeMs }))
      .sort((a, b) => b.fecha - a.fecha);
    for (let i = max; i < archivos.length; i++) {
      fs.unlinkSync(path.join(carpeta, archivos[i].nombre));
    }
  } catch (e) { /* silencioso */ }
}

function listarRespaldos() {
  asegurarCarpetas();
  return fs.readdirSync(CARPETA_LOCAL)
    .filter(f => f.startsWith("relma_") && f.endsWith(".db"))
    .map(f => {
      const stat = fs.statSync(path.join(CARPETA_LOCAL, f));
      return { archivo: f, fecha: stat.mtime, bytes: stat.size };
    })
    .sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
}

function configurar(opciones) {
  if (opciones && opciones.horas) INTERVALO_HORAS = Number(opciones.horas);
  if (opciones && opciones.drive !== undefined) CARPETA_DRIVE = opciones.drive || null;
  if (timer) clearInterval(timer);
  const ms = INTERVALO_HORAS * 60 * 60 * 1000;
  timer = setInterval(() => respaldarAhora("auto"), ms);
  console.log(`→ Respaldos automáticos cada ${INTERVALO_HORAS}h` +
    (CARPETA_DRIVE ? ` (local + Drive: ${CARPETA_DRIVE})` : " (solo local)"));
  return { horas: INTERVALO_HORAS, drive: CARPETA_DRIVE };
}

function detener() { if (timer) clearInterval(timer); }

module.exports = { respaldarAhora, listarRespaldos, configurar, detener, CARPETA_LOCAL };