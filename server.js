const express = require("express");
const path = require("path");
const bcrypt = require("bcryptjs");
const fs = require("fs");
const { db, logCambio } = require("./database");
const respaldos = require("./respaldos");
const ExcelJS = require("exceljs");
const multer = require("multer");
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
const { convertirFormula } = require("./conversion");

const app = express();
app.use(express.json({ limit: "50mb" }));
app.use(express.static(path.join(__dirname, "public")));

// Middleware: obtiene usuario del header
function usuarioDe(req) { return req.headers["x-usuario"] || "anonimo"; }
function esAdmin(req) { return req.headers["x-rol"] === "admin"; }
function requiereAdmin(req, res, next) {
  if (!esAdmin(req)) return res.status(403).json({ error: "Solo admin" });
  next();
}

// ==================== LOGIN ====================
app.post("/api/login", (req, res) => {
  const { usuario, password } = req.body;
  const u = db.prepare("SELECT * FROM usuarios WHERE usuario=? AND activo=1").get(usuario);
  if (!u || !bcrypt.compareSync(password, u.password_hash))
    return res.status(401).json({ error: "Credenciales inválidas" });
  res.json({ id: u.id, usuario: u.usuario, nombre: u.nombre, rol: u.rol });
});

// ==================== CONFIG ====================
app.get("/api/config", (req, res) => {
  const rows = db.prepare("SELECT clave, valor FROM config").all();
  const cfg = {};
  rows.forEach(r => cfg[r.clave] = r.valor);
  res.json(cfg);
});

app.put("/api/config/:clave", requiereAdmin, (req, res) => {
  const { valor } = req.body;
  db.prepare("INSERT OR REPLACE INTO config (clave, valor, tipo) VALUES (?, ?, COALESCE((SELECT tipo FROM config WHERE clave=?), 'texto'))")
    .run(req.params.clave, String(valor), req.params.clave);
  logCambio(usuarioDe(req), "CONFIG", "config", null, { clave: req.params.clave, valor });
  res.json({ ok: true });
});

// ==================== USUARIOS ====================
app.get("/api/usuarios", requiereAdmin, (req, res) => {
  res.json(db.prepare("SELECT id, usuario, nombre, rol, activo, fecha_creacion FROM usuarios ORDER BY usuario").all());
});

app.post("/api/usuarios", requiereAdmin, (req, res) => {
  const { usuario, password, nombre, rol } = req.body;
  if (!usuario || !password) return res.status(400).json({ error: "Faltan datos" });
  try {
    const hash = bcrypt.hashSync(password, 10);
    const info = db.prepare("INSERT INTO usuarios (usuario, password_hash, nombre, rol) VALUES (?,?,?,?)")
      .run(usuario, hash, nombre || usuario, rol || "taller");
    logCambio(usuarioDe(req), "CREAR", "usuarios", info.lastInsertRowid, { usuario, rol });
    res.json({ id: info.lastInsertRowid });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.put("/api/usuarios/:id", requiereAdmin, (req, res) => {
  const { nombre, rol, activo, password } = req.body;
  const u = db.prepare("SELECT * FROM usuarios WHERE id=?").get(req.params.id);
  if (!u) return res.status(404).json({ error: "No existe" });
  if (password) {
    const hash = bcrypt.hashSync(password, 10);
    db.prepare("UPDATE usuarios SET password_hash=? WHERE id=?").run(hash, req.params.id);
  }
  db.prepare("UPDATE usuarios SET nombre=COALESCE(?,nombre), rol=COALESCE(?,rol), activo=COALESCE(?,activo) WHERE id=?")
    .run(nombre || null, rol || null, activo !== undefined ? (activo ? 1 : 0) : null, req.params.id);
  logCambio(usuarioDe(req), "EDITAR", "usuarios", req.params.id, req.body);
  res.json({ ok: true });
});

app.delete("/api/usuarios/:id", requiereAdmin, (req, res) => {
  const u = db.prepare("SELECT usuario FROM usuarios WHERE id=?").get(req.params.id);
  if (u && u.usuario === "admin") return res.status(400).json({ error: "No puedes borrar al admin principal" });
  db.prepare("DELETE FROM usuarios WHERE id=?").run(req.params.id);
  logCambio(usuarioDe(req), "ELIMINAR", "usuarios", req.params.id, null);
  res.json({ ok: true });
});

// ==================== CLIENTES ====================
app.get("/api/clientes", (req, res) => {
  const q = req.query.q || "";
  res.json(db.prepare(`
    SELECT c.*,
      (SELECT COUNT(*) FROM formulas f WHERE f.cliente_id=c.id) AS num_formulas
    FROM clientes c WHERE c.nombre LIKE ? ORDER BY c.nombre
  `).all("%" + q + "%"));
});

app.post("/api/clientes", (req, res) => {
  const { nombre, contacto, telefono, email, direccion, notas } = req.body;
  if (!nombre) return res.status(400).json({ error: "Nombre requerido" });
  try {
    const info = db.prepare("INSERT INTO clientes (nombre,contacto,telefono,email,direccion,notas) VALUES (?,?,?,?,?,?)")
      .run(nombre, contacto||null, telefono||null, email||null, direccion||null, notas||null);
    logCambio(usuarioDe(req), "CREAR", "clientes", info.lastInsertRowid, { nombre });
    res.json({ id: info.lastInsertRowid });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.get("/api/clientes/:id", (req, res) => {
  const c = db.prepare("SELECT * FROM clientes WHERE id=?").get(req.params.id);
  if (!c) return res.status(404).json({ error: "No existe" });
  c.formulas = db.prepare("SELECT * FROM formulas WHERE cliente_id=? ORDER BY fecha_creacion DESC").all(req.params.id);
  res.json(c);
});

app.put("/api/clientes/:id", (req, res) => {
  const { nombre, contacto, telefono, email, direccion, notas, activo } = req.body;
  db.prepare(`UPDATE clientes SET
    nombre=COALESCE(?,nombre), contacto=COALESCE(?,contacto),
    telefono=COALESCE(?,telefono), email=COALESCE(?,email),
    direccion=COALESCE(?,direccion), notas=COALESCE(?,notas),
    activo=COALESCE(?,activo) WHERE id=?`)
    .run(nombre||null, contacto||null, telefono||null, email||null,
         direccion||null, notas||null,
         activo !== undefined ? (activo ? 1 : 0) : null, req.params.id);
  logCambio(usuarioDe(req), "EDITAR", "clientes", req.params.id, req.body);
  res.json({ ok: true });
});

app.delete("/api/clientes/:id", requiereAdmin, (req, res) => {
  try {
    const borrar = db.transaction(() => {
      // 1. Desconectar del historial (conserva el registro histórico)
      db.prepare("UPDATE historial_preparacion SET cliente_id=NULL WHERE cliente_id=?").run(req.params.id);
      // 2. Borrar sesiones del mezclador (con sus ajustes en cascada)
      db.prepare("DELETE FROM sesiones_mezclador WHERE cliente_id=?").run(req.params.id);
      // 3. Borrar fórmulas del cliente (detalle_tintas cae en cascada)
      db.prepare("DELETE FROM formulas WHERE cliente_id=?").run(req.params.id);
      // 4. Finalmente, borrar el cliente
      db.prepare("DELETE FROM clientes WHERE id=?").run(req.params.id);
    });
    borrar();
    logCambio(usuarioDe(req), "ELIMINAR", "clientes", req.params.id, null);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== CATÁLOGOS ====================
app.get("/api/tintas", (req, res) => {
  const cat = req.query.categoria;
  res.json(cat
    ? db.prepare("SELECT * FROM catalogo_tintas WHERE categoria=? ORDER BY nombre").all(cat)
    : db.prepare("SELECT * FROM catalogo_tintas ORDER BY categoria, nombre").all());
});

app.post("/api/tintas", (req, res) => {
  const { codigo, nombre, categoria, maquina } = req.body;
  if (!codigo || !nombre) return res.status(400).json({ error: "Faltan datos" });
  try {
    db.prepare("INSERT INTO catalogo_tintas (codigo,nombre,categoria,maquina) VALUES (?,?,?,?)")
      .run(codigo.toUpperCase(), nombre, categoria || "INDUSTRIAL", maquina || 32);
    logCambio(usuarioDe(req), "CREAR", "catalogo_tintas", null, { codigo, nombre });
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.get("/api/productos", (req, res) => {
  const cat = req.query.categoria;
  res.json(cat
    ? db.prepare("SELECT * FROM catalogo_productos WHERE categoria=? ORDER BY nombre").all(cat)
    : db.prepare("SELECT * FROM catalogo_productos ORDER BY categoria, nombre").all());
});

app.post("/api/productos", (req, res) => {
  const { codigo, nombre, categoria, maquina } = req.body;
  if (!codigo || !nombre) return res.status(400).json({ error: "Faltan datos" });
  try {
    db.prepare("INSERT INTO catalogo_productos (codigo,nombre,categoria,maquina) VALUES (?,?,?,?)")
      .run(codigo.toUpperCase(), nombre, categoria || "BASE AGUA", maquina || 64);
    logCambio(usuarioDe(req), "CREAR", "catalogo_productos", null, { codigo, nombre });
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ==================== FÓRMULAS ====================
app.get("/api/formulas", (req, res) => {
  const q = req.query.q || "";
  const fav = req.query.favoritos === "1";
  const cond = ["(f.color LIKE ? OR f.codigo LIKE ? OR c.nombre LIKE ?)"];
  const params = ["%"+q+"%","%"+q+"%","%"+q+"%"];
  if (fav) cond.push("f.favorito=1");
  res.json(db.prepare(`
    SELECT f.*, c.nombre AS cliente_nombre
    FROM formulas f JOIN clientes c ON c.id=f.cliente_id
    WHERE ${cond.join(" AND ")}
    ORDER BY f.favorito DESC, f.fecha_creacion DESC LIMIT 500
  `).all(...params));
});

app.get("/api/formulas/:id", (req, res) => {
  const f = db.prepare(`
    SELECT f.*, c.nombre AS cliente_nombre FROM formulas f
    JOIN clientes c ON c.id=f.cliente_id WHERE f.id=?`).get(req.params.id);
  if (!f) return res.status(404).json({ error: "No existe" });
  f.tintas = db.prepare("SELECT * FROM detalle_tintas WHERE formula_id=?").all(f.id);
  res.json(f);
});

function guardarFormula(data, usuario) {
  const crear = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO formulas (cliente_id,color,codigo,producto,base,capacidad_madre,maquina,foto_url,notas)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(
      data.cliente_id, data.color, data.codigo||null, data.producto||null, data.base||null,
      data.capacidad_madre||1, data.maquina||32, data.foto_url||null, data.notas||null);
    const fid = info.lastInsertRowid;
    const ins = db.prepare("INSERT INTO detalle_tintas (formula_id,tinta,cantidad_texto,categoria) VALUES (?,?,?,?)");
    for (const t of (data.tintas||[])) ins.run(fid, t.tinta, t.cantidad_texto, t.categoria||null);
    return fid;
  });
  return crear();
}

app.post("/api/formulas", (req, res) => {
  if (!req.body.cliente_id || !req.body.color) return res.status(400).json({ error: "Faltan datos" });
  const id = guardarFormula(req.body, usuarioDe(req));
  logCambio(usuarioDe(req), "CREAR", "formulas", id, { color: req.body.color });
  res.json({ id });
});

app.put("/api/formulas/:id", (req, res) => {
  const { color, codigo, producto, base, capacidad_madre, maquina, notas, tintas } = req.body;
  const upd = db.transaction(() => {
    db.prepare(`UPDATE formulas SET color=COALESCE(?,color), codigo=COALESCE(?,codigo),
      producto=COALESCE(?,producto), base=COALESCE(?,base),
      capacidad_madre=COALESCE(?,capacidad_madre), maquina=COALESCE(?,maquina),
      notas=COALESCE(?,notas), ultima_actualizacion=datetime('now') WHERE id=?`)
      .run(color||null, codigo||null, producto||null, base||null,
           capacidad_madre||null, maquina||null, notas||null, req.params.id);
    if (tintas) {
      db.prepare("DELETE FROM detalle_tintas WHERE formula_id=?").run(req.params.id);
      const ins = db.prepare("INSERT INTO detalle_tintas (formula_id,tinta,cantidad_texto,categoria) VALUES (?,?,?,?)");
      for (const t of tintas) ins.run(req.params.id, t.tinta, t.cantidad_texto, t.categoria||null);
    }
  });
  upd();
  logCambio(usuarioDe(req), "EDITAR", "formulas", req.params.id, req.body);
  res.json({ ok: true });
});

app.post("/api/formulas/:id/duplicar", (req, res) => {
  const orig = db.prepare("SELECT * FROM formulas WHERE id=?").get(req.params.id);
  if (!orig) return res.status(404).json({ error: "No existe" });
  const tintas = db.prepare("SELECT * FROM detalle_tintas WHERE formula_id=?").all(orig.id);
  const nueva = guardarFormula({
    cliente_id: orig.cliente_id,
    color: orig.color + " (copia)",
    codigo: orig.codigo, producto: orig.producto, base: orig.base,
    capacidad_madre: orig.capacidad_madre, maquina: orig.maquina,
    notas: orig.notas, tintas
  }, usuarioDe(req));
  logCambio(usuarioDe(req), "DUPLICAR", "formulas", nueva, { origen: orig.id });
  res.json({ id: nueva });
});

app.post("/api/formulas/:id/favorito", (req, res) => {
  const f = db.prepare("SELECT favorito FROM formulas WHERE id=?").get(req.params.id);
  if (!f) return res.status(404).json({ error: "No existe" });
  db.prepare("UPDATE formulas SET favorito=? WHERE id=?").run(f.favorito ? 0 : 1, req.params.id);
  res.json({ favorito: f.favorito ? 0 : 1 });
});

app.delete("/api/formulas/:id", (req, res) => {
  try {
    const borrar = db.transaction(() => {
      // Desconectar del historial antes de borrar la fórmula
      db.prepare("UPDATE historial_preparacion SET formula_id=NULL WHERE formula_id=?").run(req.params.id);
      // Borrar fórmula (detalle_tintas cae en cascada)
      db.prepare("DELETE FROM formulas WHERE id=?").run(req.params.id);
    });
    borrar();
    logCambio(usuarioDe(req), "ELIMINAR", "formulas", req.params.id, null);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== CONVERSIÓN ====================
app.post("/api/convertir", (req, res) => {
  const { texto, capOrigen, capDestino, maquina } = req.body;
  res.json({ resultado: convertirFormula(texto, Number(capOrigen), Number(capDestino), Number(maquina)) });
});

// ==================== HISTORIAL ====================
app.get("/api/preparaciones", (req, res) => {
  const { desde, hasta, cliente_id, producto, estado, q } = req.query;
  const cond = ["1=1"];
  const params = [];
  if (desde) { cond.push("h.fecha >= ?"); params.push(desde); }
  if (hasta) { cond.push("h.fecha <= ?"); params.push(hasta + " 23:59:59"); }
  if (cliente_id) { cond.push("h.cliente_id = ?"); params.push(cliente_id); }
  if (producto) { cond.push("f.producto = ?"); params.push(producto); }
  if (estado) { cond.push("h.estado = ?"); params.push(estado); }
  if (q) { cond.push("(f.color LIKE ? OR f.codigo LIKE ? OR c.nombre LIKE ?)");
           params.push("%"+q+"%","%"+q+"%","%"+q+"%"); }
  res.json(db.prepare(`
    SELECT h.*, c.nombre AS cliente_nombre, f.color, f.codigo, f.producto
    FROM historial_preparacion h
    LEFT JOIN clientes c ON c.id=h.cliente_id
    LEFT JOIN formulas f ON f.id=h.formula_id
    WHERE ${cond.join(" AND ")}
    ORDER BY h.fecha DESC LIMIT 2000
  `).all(...params));
});

app.get("/api/preparaciones/formula/:id", (req, res) => {
  res.json(db.prepare(`
    SELECT h.*, c.nombre AS cliente_nombre, f.color FROM historial_preparacion h
    LEFT JOIN clientes c ON c.id=h.cliente_id
    LEFT JOIN formulas f ON f.id=h.formula_id
    WHERE h.formula_id=? ORDER BY h.fecha DESC`).all(req.params.id));
});

app.post("/api/preparaciones", (req, res) => {
  const { cliente_id, formula_id, cantidad, unidad, preparo, ajustes, observaciones, estado } = req.body;
  const info = db.prepare(`
    INSERT INTO historial_preparacion (cliente_id,formula_id,cantidad,unidad,preparo,ajustes,observaciones,estado)
    VALUES (?,?,?,?,?,?,?,?)`).run(
    cliente_id||null, formula_id||null, cantidad||null, unidad||null,
    preparo||usuarioDe(req), ajustes||null, observaciones||null, estado||"EN PROCESO");
  logCambio(usuarioDe(req), "PREPARAR", "historial_preparacion", info.lastInsertRowid, { formula_id });
  res.json({ id: info.lastInsertRowid });
});

app.put("/api/preparaciones/:id", (req, res) => {
  const { estado, cantidad, unidad, observaciones } = req.body;
  db.prepare(`UPDATE historial_preparacion SET
    estado=COALESCE(?,estado), cantidad=COALESCE(?,cantidad),
    unidad=COALESCE(?,unidad), observaciones=COALESCE(?,observaciones) WHERE id=?`)
    .run(estado||null, cantidad||null, unidad||null, observaciones||null, req.params.id);
  logCambio(usuarioDe(req), "EDITAR", "historial_preparacion", req.params.id, req.body);
  res.json({ ok: true });
});

app.delete("/api/preparaciones/:id", requiereAdmin, (req, res) => {
  db.prepare("DELETE FROM historial_preparacion WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});

// ==================== MEZCLADOR ====================
app.get("/api/mezclador/sesiones", (req, res) => {
  const estado = req.query.estado || "ABIERTA";
  res.json(db.prepare(`
    SELECT s.*, c.nombre AS cliente_nombre,
      (SELECT COUNT(*) FROM ajustes_mezclador a WHERE a.sesion_id=s.id) AS num_ajustes
    FROM sesiones_mezclador s
    LEFT JOIN clientes c ON c.id=s.cliente_id
    WHERE s.estado = ? ORDER BY s.fecha_inicio DESC`).all(estado));
});

app.get("/api/mezclador/sesion/:id", (req, res) => {
  const s = db.prepare(`
    SELECT s.*, c.nombre AS cliente_nombre FROM sesiones_mezclador s
    LEFT JOIN clientes c ON c.id=s.cliente_id WHERE s.id=?`).get(req.params.id);
  if (!s) return res.status(404).json({ error: "No existe" });
  s.ajustes = db.prepare("SELECT * FROM ajustes_mezclador WHERE sesion_id=? ORDER BY fecha ASC, id ASC").all(s.id);
  res.json(s);
});

app.post("/api/mezclador/sesion", (req, res) => {
  const { cliente_id, muestra_nombre, muestra_codigo, producto, base,
          tamano_cantidad, tamano_unidad, notas } = req.body;
  if (!cliente_id || !tamano_cantidad) return res.status(400).json({ error: "Faltan datos" });
  const info = db.prepare(`
    INSERT INTO sesiones_mezclador (cliente_id,muestra_nombre,muestra_codigo,producto,base,tamano_cantidad,tamano_unidad,usuario,notas)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(
    cliente_id, muestra_nombre||null, muestra_codigo||null, producto||null,
    base||null, Number(tamano_cantidad), tamano_unidad||"LT", usuarioDe(req), notas||null);
  res.json({ id: info.lastInsertRowid });
});

app.post("/api/mezclador/sesion/:id/ajuste", (req, res) => {
  const { tinta, cantidad_texto, cantidad_en_128, unidad_mostrar } = req.body;
  const info = db.prepare(`
    INSERT INTO ajustes_mezclador (sesion_id,tinta,cantidad_texto,cantidad_en_128,unidad_mostrar,usuario)
    VALUES (?,?,?,?,?,?)`).run(req.params.id, tinta, cantidad_texto, Number(cantidad_en_128), unidad_mostrar||"OZ", usuarioDe(req));
  res.json({ id: info.lastInsertRowid });
});

app.delete("/api/mezclador/ajuste/:id", (req, res) => {
  db.prepare("DELETE FROM ajustes_mezclador WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});

app.post("/api/mezclador/sesion/:id/cerrar", (req, res) => {
  const { tintas, notas, guardar_formula } = req.body;
  const s = db.prepare("SELECT * FROM sesiones_mezclador WHERE id=?").get(req.params.id);
  if (!s) return res.status(404).json({ error: "No existe" });
  let formulaId = null;
  if (guardar_formula && tintas && tintas.length) {
    formulaId = guardarFormula({
      cliente_id: s.cliente_id, color: s.muestra_nombre || "Sin nombre",
      codigo: s.muestra_codigo, producto: s.producto, base: s.base,
      capacidad_madre: s.tamano_cantidad, maquina: 32, notas, tintas
    }, usuarioDe(req));
  }
  db.prepare("UPDATE sesiones_mezclador SET estado='CERRADA', fecha_cierre=datetime('now'), notas=COALESCE(?,notas) WHERE id=?")
    .run(notas||null, req.params.id);
  logCambio(usuarioDe(req), "CERRAR", "sesiones_mezclador", req.params.id, { formulaId });
  res.json({ ok: true, formula_id: formulaId });
});

app.delete("/api/mezclador/sesion/:id", (req, res) => {
  db.prepare("DELETE FROM sesiones_mezclador WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});

// ==================== LOG ====================
app.get("/api/log", (req, res) => {
  const { usuario, tabla, accion, desde, hasta } = req.query;
  const cond = ["1=1"]; const params = [];
  if (usuario) { cond.push("usuario = ?"); params.push(usuario); }
  if (tabla) { cond.push("tabla = ?"); params.push(tabla); }
  if (accion) { cond.push("accion = ?"); params.push(accion); }
  if (desde) { cond.push("fecha >= ?"); params.push(desde); }
  if (hasta) { cond.push("fecha <= ?"); params.push(hasta + " 23:59:59"); }
  res.json(db.prepare(`SELECT * FROM log_cambios WHERE ${cond.join(" AND ")} ORDER BY fecha DESC LIMIT 5000`).all(...params));
});

// ==================== BACKUP / RESTORE ====================
const TABLAS_BACKUP = ["clientes","formulas","detalle_tintas","historial_preparacion",
                       "catalogo_tintas","catalogo_productos","log_cambios","config","usuarios"];

app.post("/api/backup", (req, res) => {
  const { tablas, nombre } = req.body;
  const lista = (tablas && tablas.length ? tablas : TABLAS_BACKUP).filter(t => TABLAS_BACKUP.includes(t));
  const data = {};
  for (const t of lista) {
    if (t === "usuarios") {
      data[t] = db.prepare("SELECT id, usuario, password_hash, nombre, rol, activo, fecha_creacion FROM usuarios").all();
    } else {
      data[t] = db.prepare("SELECT * FROM " + t).all();
    }
  }
  const archivo = {
    sistema: "RELMA",
    version: "2.0",
    fecha: new Date().toISOString(),
    usuario: usuarioDe(req),
    tablas: lista,
    data
  };
  logCambio(usuarioDe(req), "BACKUP", "sistema", null, { tablas: lista });
  res.setHeader("Content-Disposition", "attachment; filename=" +
    (nombre || "relma_backup_" + new Date().toISOString().slice(0,10)) + ".json");
  res.json(archivo);
});

app.post("/api/restore/preview", requiereAdmin, (req, res) => {
  const { data } = req.body;
  if (!data) return res.status(400).json({ error: "Archivo inválido" });
  const resumen = {};
  for (const t of Object.keys(data)) resumen[t] = Array.isArray(data[t]) ? data[t].length : 0;
  res.json({ resumen });
});

app.post("/api/restore", requiereAdmin, (req, res) => {
  const { data, modo } = req.body; // modo: "reemplazar" | "fusionar"
  if (!data) return res.status(400).json({ error: "Archivo inválido" });
  const resultados = {};
  try {
    db.transaction(() => {
      if (modo === "reemplazar") {
        // Borrar respetando orden de dependencias
        db.prepare("DELETE FROM ajustes_mezclador").run();
        db.prepare("DELETE FROM sesiones_mezclador").run();
        db.prepare("DELETE FROM detalle_tintas").run();
        db.prepare("DELETE FROM formulas").run();
        db.prepare("DELETE FROM historial_preparacion").run();
        if (data.clientes) db.prepare("DELETE FROM clientes").run();
        if (data.catalogo_tintas) db.prepare("DELETE FROM catalogo_tintas").run();
        if (data.catalogo_productos) db.prepare("DELETE FROM catalogo_productos").run();
        if (data.config) db.prepare("DELETE FROM config").run();
        if (data.log_cambios) db.prepare("DELETE FROM log_cambios").run();
        if (data.usuarios) db.prepare("DELETE FROM usuarios WHERE usuario != 'admin'").run();
      }
      for (const tabla of Object.keys(data)) {
        if (!TABLAS_BACKUP.includes(tabla)) continue;
        const filas = data[tabla];
        if (!Array.isArray(filas) || !filas.length) continue;
        let insertadas = 0;
        for (const fila of filas) {
          try {
            const cols = Object.keys(fila);
            const placeholders = cols.map(() => "?").join(",");
            const stmt = db.prepare(`INSERT OR ${modo === "reemplazar" ? "REPLACE" : "IGNORE"} INTO ${tabla} (${cols.join(",")}) VALUES (${placeholders})`);
            stmt.run(...cols.map(c => fila[c]));
            insertadas++;
          } catch (e) { /* fila con conflicto, se salta */ }
        }
        resultados[tabla] = insertadas;
      }
    })();
    logCambio(usuarioDe(req), "RESTORE", "sistema", null, { modo, resultados });
    res.json({ ok: true, resultados });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== EXCEL CON PESTAÑAS (XLSX) ====================
app.post("/api/backup/xlsx", async (req, res) => {
  try {
    const { tablas } = req.body;
    const lista = (tablas && tablas.length ? tablas : TABLAS_BACKUP)
      .filter(t => TABLAS_BACKUP.includes(t) && t !== "usuarios");

    const wb = new ExcelJS.Workbook();
    wb.creator = "RELMA";
    wb.created = new Date();

    for (const tabla of lista) {
      const rows = db.prepare("SELECT * FROM " + tabla).all();
      const ws = wb.addWorksheet(tabla, { views: [{ state: "frozen", ySplit: 1 }] });

      if (!rows.length) {
        ws.addRow(["(sin registros)"]);
        continue;
      }

      const cols = Object.keys(rows[0]);
      ws.columns = cols.map(c => ({ header: c, key: c, width: 18 }));
      ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
      ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0EA5E9" } };
      ws.getRow(1).alignment = { vertical: "middle", horizontal: "center" };

      for (const row of rows) ws.addRow(row);
      ws.eachRow((row, n) => {
        if (n > 1) row.alignment = { vertical: "middle" };
      });
    }

    const fecha = new Date().toISOString().slice(0,10);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename=relma_backup_${fecha}.xlsx`);
    await wb.xlsx.write(res);
    res.end();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== IMPORTADOR DE EXCEL ====================
app.post("/api/importar/excel", requiereAdmin, upload.single("archivo"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No se subió archivo" });
  try {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(req.file.buffer);

    const resultados = { clientes: 0, productos: 0, tintas: 0, errores: [] };

    // Hoja "clientes" o "Clientes"
    const wsClientes = wb.getWorksheet("clientes") || wb.getWorksheet("Clientes");
    if (wsClientes) {
      const insC = db.prepare("INSERT OR IGNORE INTO clientes (nombre,contacto,telefono,email,direccion,notas) VALUES (?,?,?,?,?,?)");
      wsClientes.eachRow((row, n) => {
        if (n === 1) return;
        const nombre = row.getCell(1).value;
        if (nombre) {
          try {
            insC.run(String(nombre), String(row.getCell(2).value||""), String(row.getCell(3).value||""),
                     String(row.getCell(4).value||""), String(row.getCell(5).value||""), String(row.getCell(6).value||""));
            resultados.clientes++;
          } catch (e) { /* duplicado */ }
        }
      });
    }

    // Hoja "productos"
    const wsProd = wb.getWorksheet("productos") || wb.getWorksheet("Productos") || wb.getWorksheet("catalogo_productos");
    if (wsProd) {
      const insP = db.prepare("INSERT OR IGNORE INTO catalogo_productos (codigo,nombre,categoria,maquina) VALUES (?,?,?,?)");
      wsProd.eachRow((row, n) => {
        if (n === 1) return;
        const codigo = row.getCell(1).value;
        const nombre = row.getCell(2).value;
        if (codigo && nombre) {
          try {
            insP.run(String(codigo), String(nombre), String(row.getCell(3).value || "BASE AGUA"), Number(row.getCell(4).value) || 64);
            resultados.productos++;
          } catch (e) {}
        }
      });
    }

    // Hoja "tintas"
    const wsTintas = wb.getWorksheet("tintas") || wb.getWorksheet("Tintas") || wb.getWorksheet("catalogo_tintas");
    if (wsTintas) {
      const insT = db.prepare("INSERT OR IGNORE INTO catalogo_tintas (codigo,nombre,categoria,maquina) VALUES (?,?,?,?)");
      wsTintas.eachRow((row, n) => {
        if (n === 1) return;
        const codigo = row.getCell(1).value;
        const nombre = row.getCell(2).value;
        if (codigo && nombre) {
          try {
            insT.run(String(codigo), String(nombre), String(row.getCell(3).value || "INDUSTRIAL"), Number(row.getCell(4).value) || 32);
            resultados.tintas++;
          } catch (e) {}
        }
      });
    }

    logCambio(usuarioDe(req), "IMPORTAR", "sistema", null, resultados);
    res.json({ ok: true, resultados });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Plantilla de Excel para importar
app.get("/api/importar/plantilla", async (req, res) => {
  const wb = new ExcelJS.Workbook();

  const wc = wb.addWorksheet("clientes");
  wc.columns = [
    { header: "nombre", key: "nombre", width: 30 },
    { header: "contacto", key: "contacto", width: 20 },
    { header: "telefono", key: "telefono", width: 15 },
    { header: "email", key: "email", width: 25 },
    { header: "direccion", key: "direccion", width: 30 },
    { header: "notas", key: "notas", width: 30 }
  ];
  wc.addRow({ nombre: "CLIENTE EJEMPLO", contacto: "Juan", telefono: "555-1234", email: "", direccion: "", notas: "" });

  const wp = wb.addWorksheet("productos");
  wp.columns = [
    { header: "codigo", key: "codigo", width: 12 },
    { header: "nombre", key: "nombre", width: 30 },
    { header: "categoria", key: "categoria", width: 18 },
    { header: "maquina", key: "maquina", width: 10 }
  ];
  wp.addRow({ codigo: "PROD1", nombre: "PRODUCTO EJEMPLO", categoria: "BASE AGUA", maquina: 64 });

  const wt = wb.addWorksheet("tintas");
  wt.columns = [
    { header: "codigo", key: "codigo", width: 12 },
    { header: "nombre", key: "nombre", width: 25 },
    { header: "categoria", key: "categoria", width: 18 },
    { header: "maquina", key: "maquina", width: 10 }
  ];
  wt.addRow({ codigo: "XX", nombre: "TINTA EJEMPLO", categoria: "INDUSTRIAL", maquina: 32 });

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", "attachment; filename=relma_plantilla_importar.xlsx");
  await wb.xlsx.write(res);
  res.end();
});


// Descargar backup en CSV (Excel)
app.post("/api/backup/csv", (req, res) => {
  const { tablas } = req.body;
  const lista = (tablas && tablas.length ? tablas : TABLAS_BACKUP)
    .filter(t => TABLAS_BACKUP.includes(t) && t !== "usuarios");

  const csvEsc = (v) => {
    if (v === null || v === undefined) return "";
    const s = String(v).replace(/"/g, '""');
    return /[",;\n\r]/.test(s) ? '"' + s + '"' : s;
  };

  let csv = "";
  for (const tabla of lista) {
    const rows = db.prepare("SELECT * FROM " + tabla).all();
    csv += "# " + tabla.toUpperCase() + "\r\n";
    if (!rows.length) {
      csv += "(sin registros)\r\n\r\n";
      continue;
    }
    const cols = Object.keys(rows[0]);
    csv += cols.map(csvEsc).join(",") + "\r\n";
    for (const row of rows) {
      csv += cols.map(c => csvEsc(row[c])).join(",") + "\r\n";
    }
    csv += "\r\n";
  }

  res.setHeader("Content-Disposition", "attachment; filename=relma_backup_" +
    new Date().toISOString().slice(0,10) + ".csv");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.send("\ufeff" + csv);
});

// ==================== RESPALDOS AUTOMÁTICOS ====================
app.get("/api/respaldos", (req, res) => {
  res.json({ carpeta: respaldos.CARPETA_LOCAL, items: respaldos.listarRespaldos() });
});

app.post("/api/respaldos/ahora", (req, res) => {
  const r = respaldos.respaldarAhora(usuarioDe(req));
  res.json(r);
});

app.get("/api/respaldos/descargar/:archivo", (req, res) => {
  const archivo = path.basename(req.params.archivo);
  const ruta = path.join(respaldos.CARPETA_LOCAL, archivo);
  if (!fs.existsSync(ruta)) return res.status(404).json({ error: "No existe" });
  res.download(ruta);
});

app.delete("/api/respaldos/:archivo", requiereAdmin, (req, res) => {
  const archivo = path.basename(req.params.archivo);
  const ruta = path.join(respaldos.CARPETA_LOCAL, archivo);
  if (!fs.existsSync(ruta)) return res.status(404).json({ error: "No existe" });
  fs.unlinkSync(ruta);
  logCambio(usuarioDe(req), "BACKUP_BORRAR", "sistema", null, { archivo });
  res.json({ ok: true });
});

app.post("/api/respaldos/restaurar/:archivo", requiereAdmin, (req, res) => {
  const archivo = path.basename(req.params.archivo);
  const ruta = path.join(respaldos.CARPETA_LOCAL, archivo);
  if (!fs.existsSync(ruta)) return res.status(404).json({ error: "No existe" });

  // Hacer respaldo del estado actual antes de restaurar
  const seguridad = respaldos.respaldarAhora(usuarioDe(req) + " (pre-restore)");

  try {
    // Cerrar la BD antes de sobrescribir
    const dbPath = path.join(__dirname, "relma.db");
    db.close();
    fs.copyFileSync(ruta, dbPath);
    logCambio(usuarioDe(req), "RESTORE_AUTO", "sistema", null, { archivo });
    res.json({ ok: true, mensaje: "Restauración aplicada. Reinicia el servidor con Ctrl+C y node server.js" });
    setTimeout(() => process.exit(0), 500);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Descargar .db crudo
app.get("/api/backup/db", requiereAdmin, (req, res) => {
  const dbPath = path.join(__dirname, "relma.db");
  res.setHeader("Content-Disposition", "attachment; filename=relma_db_" + new Date().toISOString().slice(0,10) + ".db");
  res.sendFile(dbPath);
});

// ==================== ZONA PELIGROSA ====================
app.post("/api/peligro/borrar-todo", requiereAdmin, (req, res) => {
  const { que } = req.body;
  try {
    if (que === "formulas") {
      db.prepare("DELETE FROM detalle_tintas").run();
      db.prepare("DELETE FROM formulas").run();
    } else if (que === "clientes") {
      db.prepare("DELETE FROM detalle_tintas").run();
      db.prepare("DELETE FROM formulas").run();
      db.prepare("DELETE FROM historial_preparacion").run();
      db.prepare("DELETE FROM clientes").run();
    } else if (que === "historial") {
      db.prepare("DELETE FROM historial_preparacion").run();
    } else if (que === "mezclador") {
      db.prepare("DELETE FROM ajustes_mezclador").run();
      db.prepare("DELETE FROM sesiones_mezclador").run();
    } else if (que === "log") {
      db.prepare("DELETE FROM log_cambios").run();
    } else {
      return res.status(400).json({ error: "Opción inválida" });
    }
    logCambio(usuarioDe(req), "PELIGRO_BORRAR", "sistema", null, { que });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== BÚSQUEDA GLOBAL ====================
app.get("/api/buscar", (req, res) => {
  const q = (req.query.q || "").trim();
  if (q.length < 2) return res.json({ clientes: [], formulas: [], productos: [] });
  const like = "%" + q + "%";
  res.json({
    clientes: db.prepare("SELECT id, nombre FROM clientes WHERE nombre LIKE ? LIMIT 8").all(like),
    formulas: db.prepare(`
      SELECT f.id, f.color, f.codigo, c.nombre AS cliente_nombre
      FROM formulas f JOIN clientes c ON c.id=f.cliente_id
      WHERE f.color LIKE ? OR f.codigo LIKE ? LIMIT 8`).all(like, like),
    productos: db.prepare("SELECT codigo, nombre, categoria FROM catalogo_productos WHERE nombre LIKE ? LIMIT 8").all(like)
  });
});

// ==================== EXPORTAR CONSULTA MÓVIL ====================
app.post("/api/exportar-consulta", requiereAdmin, async (req, res) => {
  try {
    const html = generarConsultaMovil();
    // Guardar en la carpeta de respaldos (que se sincroniza a Drive)
    const ruta = path.join(respaldos.CARPETA_LOCAL, "consulta_movil.html");
    fs.writeFileSync(ruta, html, "utf8");

    // Intentar copiar a Drive también
    let copiadoDrive = false;
    try {
      const config = db.prepare("SELECT valor FROM config WHERE clave='pref_backup_drive'").get();
      if (config && config.valor) {
        const destino = path.join(config.valor, "consulta_movil.html");
        fs.writeFileSync(destino, html, "utf8");
        copiadoDrive = true;
      }
    } catch (e) { /* drive no disponible, ignorar */ }

    logCambio(usuarioDe(req), "EXPORTAR_CONSULTA", "sistema", null, { drive: copiadoDrive });
    res.json({
      ok: true,
      archivo: "consulta_movil.html",
      drive: copiadoDrive,
      tamano_kb: Math.round(html.length / 1024)
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
// (función generada más abajo)
function generarConsultaMovil() {
  const clientes = db.prepare("SELECT id, nombre, contacto, telefono FROM clientes WHERE activo=1 ORDER BY nombre").all();
  const formulas = db.prepare(`
    SELECT f.*, c.nombre AS cliente_nombre
    FROM formulas f JOIN clientes c ON c.id=f.cliente_id
    ORDER BY c.nombre, f.color
  `).all();
  const tintasPorFormula = {};
  for (const f of formulas) {
    tintasPorFormula[f.id] = db.prepare("SELECT tinta, cantidad_texto FROM detalle_tintas WHERE formula_id=?").all(f.id);
  }
  const cfg = {};
  db.prepare("SELECT clave, valor FROM config").all().forEach(r => cfg[r.clave] = r.valor);
  const empresa = cfg.empresa_nombre || "RELMA";

  const datos = { clientes, formulas, tintas: tintasPorFormula, empresa, fecha: new Date().toISOString() };

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>${empresa} — Consulta móvil</title>
<meta name="theme-color" content="#0ea5e9">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
         background: #0f172a; color: #e2e8f0; padding-bottom: 80px; min-height: 100vh; }
  header { background: #1e293b; padding: 12px 14px; position: sticky; top: 0; z-index: 50;
           border-bottom: 2px solid #334155; }
  header h1 { font-size: 16px; color: #0ea5e9; margin-bottom: 8px; }
  .search-bar { position: relative; }
  .search-bar input { width: 100%; background: #0f172a; color: #e2e8f0; border: 1px solid #334155;
                      border-radius: 8px; padding: 12px; font-size: 16px; }
  .search-bar input:focus { outline: none; border-color: #0ea5e9; }
  main { padding: 12px; max-width: 700px; margin: 0 auto; }
  .card { background: #1e293b; border: 1px solid #334155; border-radius: 10px;
          padding: 14px; margin-bottom: 10px; cursor: pointer; transition: all .15s; }
  .card:active { transform: scale(0.98); border-color: #0ea5e9; }
  .card h3 { font-size: 15px; color: #0ea5e9; margin-bottom: 4px; }
  .card .sub { font-size: 13px; color: #94a3b8; }
  .badge { display: inline-block; background: #0ea5e9; color: white; font-size: 11px;
           padding: 2px 8px; border-radius: 10px; margin-top: 6px; }
  .modal { position: fixed; inset: 0; background: rgba(0,0,0,.8); z-index: 100;
           display: flex; align-items: center; justify-content: center; padding: 12px; }
  .modal.oculto { display: none; }
  .modal-caja { background: #1e293b; border: 1px solid #334155; border-radius: 12px;
                padding: 18px; width: 100%; max-width: 500px; max-height: 90vh; overflow-y: auto; }
  .modal-caja h3 { color: #0ea5e9; margin-bottom: 12px; font-size: 17px; }
  .modal-caja p { margin-bottom: 6px; font-size: 14px; }
  .modal-caja p b { color: #94a3b8; font-weight: normal; }
  .tinta-row { display: flex; justify-content: space-between; padding: 8px 0;
               border-bottom: 1px solid #334155; font-size: 14px; }
  .tinta-row:last-child { border-bottom: none; }
  .tinta-row .nombre { font-weight: bold; color: #38bdf8; }
  .tinta-row .cantidad { font-family: Consolas, monospace; color: #4ade80; }
  .acciones { display: flex; gap: 8px; justify-content: flex-end; margin-top: 14px; }
  button { padding: 10px 16px; border-radius: 8px; cursor: pointer; border: none;
           font-weight: bold; font-size: 14px; }
  button.primario { background: #0ea5e9; color: white; }
  button.secundario { background: #334155; color: #e2e8f0; }
  .info { text-align: center; padding: 40px 20px; color: #94a3b8; }
  .info .num { font-size: 42px; font-weight: bold; color: #0ea5e9; margin-bottom: 6px; }
  .info .lbl { font-size: 12px; text-transform: uppercase; letter-spacing: 1px; }
  .footer-info { text-align: center; padding: 20px; color: #64748b; font-size: 11px; }
  .filtro-cliente { background: #334155; color: #e2e8f0; border: 1px solid #475569;
                    border-radius: 6px; padding: 8px; width: 100%; margin-top: 8px; font-size: 14px; }
  @media print {
    body { background: white; color: black; }
    header, .acciones, .footer-info { display: none; }
    .modal { position: static; background: white; padding: 0; }
    .modal-caja { background: white; color: black; border: 2px solid black; max-height: none; }
    .tinta-row { border-bottom: 1px solid #999; }
    .tinta-row .nombre { color: black; }
    .tinta-row .cantidad { color: black; }
  }
</style>
</head>
<body>

<header>
  <h1>🎨 ${empresa} — Consulta</h1>
  <div class="search-bar">
    <input id="buscar" type="text" placeholder="🔍 Buscar cliente, color o código..." autocomplete="off">
  </div>
  <select id="filtroCliente" class="filtro-cliente">
    <option value="">— Todos los clientes —</option>
  </select>
</header>

<main>
  <div class="info" id="stats">
    <div class="num" id="statsNum">0</div>
    <div class="lbl">Fórmulas</div>
  </div>
  <div id="lista"></div>
  <div class="footer-info">
    Generado: <span id="fechaGen"></span><br>
    Última actualización de datos: <span id="fechaAct"></span>
  </div>
</main>

<div class="modal oculto" id="modalDetalle">
  <div class="modal-caja" id="detalleCaja"></div>
</div>

<script>
const DATOS = ${JSON.stringify(datos)};

const $ = s => document.querySelector(s);

function formatearFecha(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("es-MX") + " " + d.toLocaleTimeString("es-MX", {hour:"2-digit", minute:"2-digit"});
  } catch(e) { return iso; }
}

function pintarFiltroClientes() {
  const sel = $("#filtroCliente");
  const ordenados = [...DATOS.clientes].sort((a,b) => a.nombre.localeCompare(b.nombre));
  ordenados.forEach(c => {
    const opt = document.createElement("option");
    opt.value = c.nombre;
    opt.textContent = c.nombre;
    sel.appendChild(opt);
  });
}

function pintarLista() {
  const q = ($("#buscar").value || "").toUpperCase().trim();
  const clienteFiltro = $("#filtroCliente").value;
  const cont = $("#lista");
  const stats = $("#stats");
  const statsNum = $("#statsNum");

  let filtradas = DATOS.formulas.filter(f => {
    if (clienteFiltro && f.cliente_nombre !== clienteFiltro) return false;
    if (!q) return true;
    const texto = (f.color + " " + (f.codigo||"") + " " + (f.cliente_nombre||"") + " " + (f.producto||"")).toUpperCase();
    return texto.includes(q);
  });

  if (!q && !clienteFiltro) {
    stats.style.display = "block";
    statsNum.textContent = DATOS.formulas.length;
  } else {
    stats.style.display = "none";
  }

  if (!filtradas.length) {
    cont.innerHTML = '<div class="info">Sin resultados</div>';
    return;
  }

  cont.innerHTML = filtradas.slice(0, 200).map(f => \`
    <div class="card" onclick="verFormula(\${f.id})">
      <h3>\${f.color}</h3>
      <div class="sub">\${f.cliente_nombre}</div>
      <div class="sub">\${f.producto || ""} · \${f.base || ""}</div>
      <div class="badge">\${f.capacidad_madre} LT · \${f.maquina === 64 ? "Arq." : "Ind."}</div>
    </div>
  \`).join("");
}

function verFormula(id) {
  const f = DATOS.formulas.find(x => x.id === id);
  if (!f) return;
  const tintas = DATOS.tintas[id] || [];
  const tintasHTML = tintas.map(t => \`
    <div class="tinta-row">
      <span class="nombre">\${t.tinta}</span>
      <span class="cantidad">\${t.cantidad_texto}</span>
    </div>
  \`).join("");

  $("#detalleCaja").innerHTML = \`
    <h3>\${f.color}</h3>
    <p><b>Cliente:</b> \${f.cliente_nombre}</p>
    <p><b>Producto:</b> \${f.producto || "-"}</p>
    <p><b>Base:</b> \${f.base || "-"}</p>
    <p><b>Capacidad:</b> \${f.capacidad_madre} LT · <b>Máquina:</b> \${f.maquina === 64 ? "Arquitectónica" : "Industrial"}</p>
    \${f.codigo ? '<p><b>Código:</b> ' + f.codigo + '</p>' : ""}
    \${f.notas ? '<p><b>Notas:</b> ' + f.notas + '</p>' : ""}
    <h4 style="margin-top:14px; color:#0ea5e9; font-size:14px;">Tintas:</h4>
    \${tintasHTML}
    <div class="acciones">
      <button class="secundario" onclick="cerrarModal()">Cerrar</button>
      <button class="primario" onclick="imprimirFormula(\${id})">🖨 Imprimir</button>
    </div>
  \`;
  $("#modalDetalle").classList.remove("oculto");
}

function cerrarModal() {
  $("#modalDetalle").classList.add("oculto");
}

function imprimirFormula(id) {
  const f = DATOS.formulas.find(x => x.id === id);
  if (!f) return;
  const tintas = DATOS.tintas[id] || [];
  const w = window.open("", "_blank");
  w.document.write(\`<html><head><title>\${f.color}</title>
    <style>body{font-family:Arial;padding:20px;} h1{color:#0284c7;} table{width:100%; border-collapse:collapse; margin-top:16px;} td,th{padding:8px; border-bottom:1px solid #ddd; text-align:left;} th{background:#0284c7; color:white;}</style>
    </head><body>
    <h1>\${DATOS.empresa}</h1><h2>\${f.color}</h2>
    <p><b>Cliente:</b> \${f.cliente_nombre}<br><b>Producto:</b> \${f.producto || "-"}<br><b>Base:</b> \${f.base || "-"}<br><b>Capacidad:</b> \${f.capacidad_madre} LT<br><b>Fecha:</b> \${new Date().toLocaleString("es-MX")}</p>
    <table><tr><th>Tinta</th><th>Cantidad</th></tr>\${tintas.map(t => '<tr><td>' + t.tinta + '</td><td><b>' + t.cantidad_texto + '</b></td></tr>').join("")}</table>
    </body></html>\`);
  w.document.close();
  setTimeout(() => w.print(), 300);
}

$("#buscar").addEventListener("input", pintarLista);
$("#filtroCliente").addEventListener("change", pintarLista);
$("#modalDetalle").addEventListener("click", e => {
  if (e.target.id === "modalDetalle") cerrarModal();
});

$("#fechaGen").textContent = new Date().toLocaleString("es-MX");
$("#fechaAct").textContent = formatearFecha(DATOS.fecha);

pintarFiltroClientes();
pintarLista();
</script>
</body>
</html>`;
}
module.exports._generarConsultaHTML = function(datos) {
  return generarConsultaMovil._html ? generarConsultaMovil._html(datos) : "";
};

// ==================== INICIO ====================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("\n========================================");
  console.log("  RELMA 2.0 en http://localhost:" + PORT);
  console.log("  admin / admin123");
  console.log("========================================");

  // Arrancar respaldos automáticos con lo que esté en config
  try {
    const horas = db.prepare("SELECT valor FROM config WHERE clave='pref_backup_horas'").get();
    const drive = db.prepare("SELECT valor FROM config WHERE clave='pref_backup_drive'").get();
    respaldos.configurar({
      horas: horas ? horas.valor : 6,
      drive: drive ? drive.valor : null,
    });

    // Generar consulta móvil cada 6 horas
    const generarConsulta = () => {
      try {
        const html = generarConsultaMovil();
        const rutaLocal = require("path").join(respaldos.CARPETA_LOCAL, "consulta_movil.html");
        require("fs").writeFileSync(rutaLocal, html, "utf8");
        if (drive && drive.valor) {
          try {
            require("fs").writeFileSync(require("path").join(drive.valor, "consulta_movil.html"), html, "utf8");
          } catch(e) {}
        }
        console.log("→ Consulta móvil generada (" + Math.round(html.length/1024) + " KB)");
      } catch(e) { console.error("Error generando consulta:", e.message); }
    };
    // Generar una al arrancar
    setTimeout(generarConsulta, 3000);
    // Y cada 6 horas
    setInterval(generarConsulta, 6 * 60 * 60 * 1000);
  } catch (e) {
    console.error("Error configurando respaldos:", e.message);
  }

  console.log("");
});

process.on("SIGINT", () => {
  console.log("\n→ Cerrando servidor, haciendo respaldo final...");
  respaldos.respaldarAhora("sistema (cierre)");
  respaldos.detener();
  process.exit(0);
});