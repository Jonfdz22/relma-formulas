const Database = require("better-sqlite3");
const path = require("path");
const bcrypt = require("bcryptjs");

const db = new Database(path.join(__dirname, "relma.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS clientes (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre         TEXT NOT NULL UNIQUE,
    contacto       TEXT,
    telefono       TEXT,
    email          TEXT,
    direccion      TEXT,
    notas          TEXT,
    activo         INTEGER DEFAULT 1,
    fecha_creacion TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS formulas (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    cliente_id          INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
    color               TEXT NOT NULL,
    codigo              TEXT,
    producto            TEXT,
    base                TEXT,
    capacidad_madre     INTEGER NOT NULL DEFAULT 1,
    maquina             INTEGER NOT NULL DEFAULT 32,
    foto_url            TEXT,
    notas               TEXT,
    favorito            INTEGER DEFAULT 0,
    fecha_creacion      TEXT DEFAULT (datetime('now')),
    ultima_actualizacion TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS detalle_tintas (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    formula_id     INTEGER NOT NULL REFERENCES formulas(id) ON DELETE CASCADE,
    tinta          TEXT NOT NULL,
    cantidad_texto TEXT NOT NULL,
    categoria      TEXT
  );
  CREATE TABLE IF NOT EXISTS catalogo_tintas (
    codigo    TEXT PRIMARY KEY,
    nombre    TEXT NOT NULL,
    categoria TEXT NOT NULL,
    maquina   INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS catalogo_productos (
    codigo    TEXT PRIMARY KEY,
    nombre    TEXT NOT NULL,
    categoria TEXT NOT NULL,
    maquina   INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS historial_preparacion (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    fecha         TEXT DEFAULT (datetime('now')),
    cliente_id    INTEGER REFERENCES clientes(id),
    formula_id    INTEGER REFERENCES formulas(id),
    cantidad      REAL,
    unidad        TEXT,
    preparo       TEXT,
    ajustes       TEXT,
    observaciones TEXT,
    estado        TEXT DEFAULT 'EN PROCESO'
  );
  CREATE TABLE IF NOT EXISTS log_cambios (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    fecha       TEXT DEFAULT (datetime('now')),
    usuario     TEXT,
    accion      TEXT,
    tabla       TEXT,
    registro_id INTEGER,
    detalle     TEXT
  );
  CREATE TABLE IF NOT EXISTS usuarios (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario        TEXT UNIQUE NOT NULL,
    password_hash  TEXT NOT NULL,
    nombre         TEXT,
    rol            TEXT NOT NULL DEFAULT 'taller',
    activo         INTEGER DEFAULT 1,
    fecha_creacion TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS sesiones_mezclador (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    cliente_id      INTEGER NOT NULL REFERENCES clientes(id),
    muestra_nombre  TEXT,
    muestra_codigo  TEXT,
    producto        TEXT,
    base            TEXT,
    tamano_cantidad REAL NOT NULL,
    tamano_unidad   TEXT DEFAULT 'LT',
    estado          TEXT DEFAULT 'ABIERTA',
    fecha_inicio    TEXT DEFAULT (datetime('now')),
    fecha_cierre    TEXT,
    usuario         TEXT,
    notas           TEXT
  );
  CREATE TABLE IF NOT EXISTS ajustes_mezclador (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    sesion_id       INTEGER NOT NULL REFERENCES sesiones_mezclador(id) ON DELETE CASCADE,
    tinta           TEXT NOT NULL,
    cantidad_texto  TEXT NOT NULL,
    cantidad_en_128 REAL NOT NULL,
    unidad_mostrar  TEXT DEFAULT 'OZ',
    fecha           TEXT DEFAULT (datetime('now')),
    usuario         TEXT
  );
  CREATE TABLE IF NOT EXISTS config (
    clave TEXT PRIMARY KEY,
    valor TEXT,
    tipo  TEXT DEFAULT 'texto'
  );
`);

const insT = db.prepare("INSERT OR IGNORE INTO catalogo_tintas (codigo,nombre,categoria,maquina) VALUES (?,?,?,?)");
const insP = db.prepare("INSERT OR IGNORE INTO catalogo_productos (codigo,nombre,categoria,maquina) VALUES (?,?,?,?)");
const insC = db.prepare("INSERT OR IGNORE INTO clientes (nombre) VALUES (?)");
const insCfg = db.prepare("INSERT OR IGNORE INTO config (clave,valor,tipo) VALUES (?,?,?)");

db.transaction(() => {
  [
    ["BU","CAFÉ","INDUSTRIAL",32],["LB","NEGRO","INDUSTRIAL",32],
    ["MY","AMARILLO CROMO","INDUSTRIAL",32],["OY","AMARILLO LIMÓN","INDUSTRIAL",32],
    ["PB","AZUL","INDUSTRIAL",32],["PG","VERDE","INDUSTRIAL",32],
    ["QR","ROJO QUINO","INDUSTRIAL",32],["QV","VIOLETA","INDUSTRIAL",32],
    ["RO","ROJO ÓXIDO","INDUSTRIAL",32],["TW","BLANCO","INDUSTRIAL",32],
    ["UO","NARANJA","INDUSTRIAL",32],["YO","AMARILLO ÓXIDO","INDUSTRIAL",32],
    ["BLANCO","BLANCO","ARQUITECTONICA",64],["ROJO","ROJO","ARQUITECTONICA",64],
    ["VERDE","VERDE","ARQUITECTONICA",64],["AZUL","AZUL","ARQUITECTONICA",64],
    ["ROJO_OXIDO","ROJO ÓXIDO","ARQUITECTONICA",64],["AMARILLO","AMARILLO","ARQUITECTONICA",64],
    ["OCRE","OCRE","ARQUITECTONICA",64],["NEGRO","NEGRO","ARQUITECTONICA",64],
    ["MAGENTA","MAGENTA","ARQUITECTONICA",64],["CAFE","CAFÉ","ARQUITECTONICA",64]
  ].forEach(t => insT.run(...t));

  [
    ["SKTM","SUPER KEM-TONE MATE","BASE AGUA",64],["SKTS","SUPER KEM-TONE SATIN","BASE AGUA",64],
    ["KTM","KEM-TONE MATE","BASE AGUA",64],["KTS","KEM-TONE SATIN","BASE AGUA",64],
    ["EVM","EVOLUCION MATE","BASE AGUA",64],["EVS","EVOLUCION SATIN","BASE AGUA",64],
    ["PROC","PROCRAFT","BASE AGUA",64],["CENT","CENTINELA","BASE AGUA",64],
    ["VINIL","VINIL-ACRILICA","BASE AGUA",64],["A12","A-12","BASE AGUA",64],
    ["MTL","METALEX","BASE SOLVENTE",64],["PAB","P.A.B","BASE SOLVENTE",64],
    ["MTLM","METALEX BASE METALICA","BASE SOLVENTE",64],["EVO","EVOLUCION","BASE SOLVENTE",64],
    ["EZC","EZ-COLOR","BASE SOLVENTE",64],["PMXEP","PROMAX EPOXICO","BASE SOLVENTE",64],
    ["PMXPU","PROMAX POLIURETANO","BASE SOLVENTE",64],
    ["RA28","RA-28","INDUSTRIAL",32],["RA26","RA-26","INDUSTRIAL",32],
    ["ACR218","ACROLON 218","INDUSTRIAL",32],["MACRO","MACROPOXY","INDUSTRIAL",32],
    ["AMER400","AMERLOCK400","INDUSTRIAL",32],["PRIMEST","PRIMARIO ESTRUCTURAL","INDUSTRIAL",32],
    ["P34","P-34","INDUSTRIAL",32],["ACR7300","ACROLON 7300","INDUSTRIAL",32],
    ["RP6","RP-6","INDUSTRIAL",32],["P19","P-19","INDUSTRIAL",32],
    ["RECORT","RECORTABLE","INDUSTRIAL",32],["A29","A-29","INDUSTRIAL",32]
  ].forEach(p => insP.run(...p));

  ["RESERVIMEX","SERMANT","PETIMEX","ACCTRA","BENANDRE","ELECNOR","FLOMACRU",
   "MEXALIT","SERVI BOOMS","SISTEMEX","TERMO JALTE","ZUMPANGO","A&P PLASTICOS",
   "DOBLE EQUIPO","TECNOLOGIA EN SOLDADURA","JOSELUIS MENDOZA","TUMEX",
   "SERVICIOS MECANICOS","JONATHAN GUTIERRES","METAL MECANICA","OLBEN",
   "CBTIS 59","DSF","SINGUILUCAN","SYCSA","MANUEL CALP","GARRIDO ISRRAEL",
   "TORRES JORGE","GHD","MILAN","FRIGO CEL","GRUPACK","CHAMPANGE METALICO",
   "ALEJANDRO DINA","FERIA PACHUCA","HOTELES HOTSON","HOSPITAL GENERAL",
   "ITISA","CHINOS","GRUPO HIDALGO","MANSEI","HECTOR LUCIO","USIMECA",
   "COMECOP","GRUPO MERC","REYES FERNANDEZ","TORO CALPULALPAN","C1+J1",
   "IGLESIA JW","PARMASEUTICAS"].forEach(c => insC.run(c));

  [
    ["pref_backup_horas","6","numero"],
    ["pref_backup_drive","","texto"],
    ["empresa_nombre","RELMA","texto"],
    ["empresa_logo","","url"],
    ["empresa_telefono","","texto"],
    ["empresa_direccion","","texto"],
    ["empresa_email","","texto"],
    ["pref_unidad","OZ","texto"],
    ["pref_maquina","32","numero"],
    ["pref_tamano","1","numero"],
    ["pref_ml_por_oz","30.125","numero"],
    ["pref_tema","oscuro","texto"]
  ].forEach(c => insCfg.run(...c));

  const existeAdmin = db.prepare("SELECT id FROM usuarios WHERE usuario='admin'").get();
  if (!existeAdmin) {
    const hash = bcrypt.hashSync("admin123", 10);
    db.prepare("INSERT INTO usuarios (usuario,password_hash,nombre,rol) VALUES (?,?,?,?)")
      .run("admin", hash, "Administrador", "admin");
    console.log("→ Usuario admin creado (admin / admin123)");
  }
})();

function logCambio(usuario, accion, tabla, registroId, detalle) {
  try {
    db.prepare("INSERT INTO log_cambios (usuario,accion,tabla,registro_id,detalle) VALUES (?,?,?,?,?)")
      .run(usuario || "sistema", accion, tabla, registroId || null,
           typeof detalle === "string" ? detalle : JSON.stringify(detalle));
  } catch (e) { /* silencioso */ }
}

module.exports = { db, logCambio };