const $  = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

const state = {
  clientes: [], tintas: [], productos: [], formulas: [],
  sesion: JSON.parse(localStorage.getItem("relma_sesion") || "null"),
  config: {},
};
let sesionActual = null;
let formulaDetalleActual = null;
let archivoRestoreTemp = null;
let modalRetorno = null;

// ==================== UTILS ====================
function toast(msg, tipo) {
  const t = $("#toast");
  t.textContent = msg;
  t.className = "toast " + (tipo || "");
  setTimeout(() => t.classList.add("oculto"), 3200);
}

async function api(url, opts = {}) {
  const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
  if (state.sesion) {
    headers["x-usuario"] = state.sesion.usuario;
    headers["x-rol"] = state.sesion.rol;
  }
  const r = await fetch(url, { ...opts, headers });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.error || "HTTP " + r.status);
  }
  return r.json();
}

function confirmar(titulo, mensaje, palabraClave) {
  return new Promise(resolve => {
    $("#confirmTitulo").textContent = titulo;
    $("#confirmMensaje").innerHTML = mensaje;
    const inputBox = $("#confirmInputBox");
    if (palabraClave) {
      inputBox.classList.remove("oculto");
      $("#confirmPalabra").textContent = palabraClave;
      $("#confirmInput").value = "";
    } else {
      inputBox.classList.add("oculto");
    }
    $("#modalConfirm").classList.remove("oculto");
    const cerrar = () => {
      $("#modalConfirm").classList.add("oculto");
      $("#confirmAceptar").onclick = null;
      $("#confirmCancelar").onclick = null;
    };
    $("#confirmCancelar").onclick = () => { cerrar(); resolve(false); };
    $("#confirmAceptar").onclick = () => {
      if (palabraClave && $("#confirmInput").value.trim() !== palabraClave) {
        toast("Palabra incorrecta", "error"); return;
      }
      cerrar(); resolve(true);
    };
  });
}

function parsearCantidad(texto) {
  if (!texto) return null;
  const str = String(texto).trim().toLowerCase().replace(/,/g, ".");
  const partes = str.split("+").map(p => p.trim()).filter(p => p);
  let total128 = 0;
  for (const parte of partes) {
    let m;
    m = parte.match(/^(\d+(?:\.\d+)?)\s*ml$/);
    if (m) { total128 += (parseFloat(m[1]) / (964/32)) * 128; continue; }
    m = parte.match(/^(\d+(?:\.\d+)?)\s*(hoz|h|onzas?|oz)$/);
    if (m) { total128 += parseFloat(m[1]) * 128; continue; }
    m = parte.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+)$/);
    if (m) { total128 += (parseFloat(m[1]) / parseFloat(m[2])) * 128; continue; }
    m = parte.match(/^(\d+(?:\.\d+)?)$/);
    if (m) { total128 += parseFloat(m[1]) * 128; continue; }
    return null;
  }
  return total128;
}

// ==================== VALIDACIÓN Y NORMALIZACIÓN DE CANTIDADES ====================
const DENOMINADORES_VALIDOS = [32, 64, 128, 256, 512];

function validarYNormalizarCantidad(texto, maquina) {
  if (!texto || texto.trim() === "") {
    return { valido: false, error: "Escribe una cantidad" };
  }
  const str = String(texto).trim().toLowerCase().replace(/,/g, ".");
  const partes = str.split("+").map(p => p.trim()).filter(p => p !== "");
  if (!partes.length) return { valido: false, error: "Formato vacío" };

  let total128 = 0;

  for (const parte of partes) {
    let m;

    // ml
    m = parte.match(/^(\d+(?:\.\d+)?)\s*ml$/);
    if (m) {
      const v = parseFloat(m[1]);
      if (v < 0) return { valido: false, error: "No se aceptan negativos" };
      total128 += (v / (964/32)) * 128;
      continue;
    }

    // hoz / onzas / oz / h
    m = parte.match(/^(\d+(?:\.\d+)?)\s*(hoz|h|onzas?|oz)$/);
    if (m) {
      const v = parseFloat(m[1]);
      if (v < 0) return { valido: false, error: "No se aceptan negativos" };
      total128 += v * 128;
      continue;
    }

    // fracción X/Y
    m = parte.match(/^(\d+)\s*\/\s*(\d+)$/);
    if (m) {
      const num = parseInt(m[1]);
      const den = parseInt(m[2]);
      if (den === 0) return { valido: false, error: "Denominador no puede ser 0" };
      if (!DENOMINADORES_VALIDOS.includes(den)) {
        return { valido: false, error: `Denominador ${den} no válido. Usa: ${DENOMINADORES_VALIDOS.join(", ")}` };
      }
      if (num < 0) return { valido: false, error: "No se aceptan negativos" };
      total128 += (num / den) * 128;
      continue;
    }

    // decimal suelto (interpretado como onzas)
    m = parte.match(/^(\d+(?:\.\d+)?)$/);
    if (m) {
      const v = parseFloat(m[1]);
      if (v < 0) return { valido: false, error: "No se aceptan negativos" };
      total128 += v * 128;
      continue;
    }

    return { valido: false, error: `No entiendo "${parte}"` };
  }

  const normalizado = formatearOZConMaquina(total128, maquina || 32);
  return { valido: true, normalizado, total128 };
}

function formatearOZ(total128) {
  const onzasOut = Math.floor(total128 / 128);
  const resto128 = Math.round((total128 - onzasOut * 128) * 1000) / 1000;
  const r64 = resto128 / 2, r64f = Math.floor(r64), rd64 = r64 - r64f;
  const r32 = r64f / 2, r32f = Math.floor(r32), rd32 = r32 - r32f;
  const f64 = rd32 >= 0.5 ? 1 : 0, f128 = rd64 >= 0.5 ? 1 : 0;
  let t = onzasOut + " HOZ";
  if (r32f > 0) t += " + " + r32f + "/32";
  if (f64 > 0)  t += " + " + f64 + "/64";
  if (f128 > 0) t += " + " + f128 + "/128";
  return t;
}

function formatearOZConMaquina(total128, maquina) {
  const onzasOut = Math.floor(total128 / 128);
  const resto128 = Math.round((total128 - onzasOut * 128) * 1000) / 1000;
  if (maquina === 64) {
    const r64 = Math.floor(resto128 / 2);
    const residuo = (resto128 / 2) - r64;
    const f128 = residuo >= 0.5 ? 1 : 0;
    let t = onzasOut + " HOZ";
    if (r64 > 0) t += " + " + r64 + "/64";
    if (f128 > 0) t += " + " + f128 + "/128";
    return t;
  }
  return formatearOZ(total128);
}

function formatearML(total128) {
  const ml = (total128 / 128) * (964/32);
  if (ml < 1)  return ml.toFixed(2) + " ML";
  if (ml < 10) return ml.toFixed(1) + " ML";
  return Math.round(ml) + " ML";
}

function csvEscape(v) {
  if (v === null || v === undefined) return "";
  const s = String(v).replace(/"/g, '""');
  return /[",;\n]/.test(s) ? '"' + s + '"' : s;
}

function descargarCSV(nombreArchivo, filas) {
  const csv = filas.map(f => f.map(csvEscape).join(",")).join("\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = nombreArchivo; a.click();
  URL.revokeObjectURL(url);
}

// ==================== TEMA ====================
function aplicarTema(tema) {
  document.documentElement.setAttribute("data-tema", tema);
  $("#btnTema").textContent = tema === "claro" ? "☀️" : "🌙";
  localStorage.setItem("relma_tema", tema);
}
$("#btnTema").onclick = () => {
  const a = document.documentElement.getAttribute("data-tema");
  aplicarTema(a === "claro" ? "oscuro" : "claro");
};
aplicarTema(localStorage.getItem("relma_tema") || "oscuro");

// ==================== LOGIN ====================
function verificarAcceso() {
  if (state.sesion) {
    $("#loginScreen").classList.add("oculto");
    $("#app").classList.remove("oculto");
    $("#userNombre").textContent = state.sesion.nombre || state.sesion.usuario;
    $("#dropUsuario").textContent = state.sesion.usuario;
    $("#dropRol").textContent = state.sesion.rol;
    aplicarRol();
    cargarTodo();
  } else {
    $("#loginScreen").classList.remove("oculto");
    $("#app").classList.add("oculto");
  }
}

function aplicarRol() {
  const admin = state.sesion && state.sesion.rol === "admin";
  $$(".solo-admin").forEach(el => el.classList.toggle("oculto", !admin));
  $$('nav button[data-tab="config"]').forEach(el => el.classList.toggle("oculto", !admin));
}

$("#btnLogin").onclick = async () => {
  const usuario = $("#loginUsuario").value.trim();
  const password = $("#loginPassword").value;
  $("#loginError").textContent = "";
  try {
    const u = await api("/api/login", { method: "POST", body: JSON.stringify({ usuario, password }) });
    state.sesion = u;
    localStorage.setItem("relma_sesion", JSON.stringify(u));
    $("#loginPassword").value = "";
    verificarAcceso();
    toast("Bienvenido " + u.usuario, "exito");
  } catch (e) { $("#loginError").textContent = "❌ " + e.message; }
};
$("#loginPassword").addEventListener("keydown", e => { if (e.key === "Enter") $("#btnLogin").click(); });

$("#btnUser").onclick = (e) => {
  e.stopPropagation();
  $("#userDropdown").classList.toggle("oculto");
};
document.addEventListener("click", () => $("#userDropdown").classList.add("oculto"));
$("#userDropdown").onclick = e => e.stopPropagation();
$("#btnLogout").onclick = () => { localStorage.removeItem("relma_sesion"); location.reload(); };

// ==================== TABS ====================
$$("nav button").forEach(b => b.onclick = () => {
  $$("nav button").forEach(x => x.classList.remove("activo"));
  $$(".tab").forEach(x => x.classList.remove("activo"));
  b.classList.add("activo");
  $("#tab-" + b.dataset.tab).classList.add("activo");
  if (b.dataset.tab === "config") cargarConfig();
  if (b.dataset.tab === "backup") cargarRespaldos();
});

$$(".sub-tabs button").forEach(b => b.onclick = () => {
  $$(".sub-tabs button").forEach(x => x.classList.remove("activo"));
  $$(".sub-panel").forEach(x => x.classList.remove("activo"));
  b.classList.add("activo");
  $("#sub-" + b.dataset.sub).classList.add("activo");
  if (b.dataset.sub === "log") cargarLog();
  if (b.dataset.sub === "catalogos") cargarCatalogos();
  if (b.dataset.sub === "usuarios") cargarUsuarios();
});

// ==================== CARGA INICIAL ====================
async function cargarTodo() {
  try {
    state.clientes  = await api("/api/clientes");
    state.tintas    = await api("/api/tintas");
    state.productos = await api("/api/productos");
    state.formulas  = await api("/api/formulas");
    state.config    = await api("/api/config");
    aplicarConfig(state.config);
    pintarClientes();
    pintarFormulas();
    pintarHistorial();
    llenarSelects();
    cargarSesiones();
    cargarFormulasConversor();
  } catch (e) {
    console.error(e);
    toast("Error al cargar: " + e.message, "error");
  }
}

function aplicarConfig(cfg) {
  if (cfg.empresa_logo) {
    $("#headerLogo").innerHTML = `<img src="${cfg.empresa_logo}" style="height:32px;vertical-align:middle"> ${cfg.empresa_nombre || "RELMA"}`;
    $("#loginLogo").innerHTML = `<img src="${cfg.empresa_logo}" style="height:60px">`;
  } else if (cfg.empresa_nombre) {
    $("#headerLogo").textContent = "🎨 " + cfg.empresa_nombre;
  }
  document.title = (cfg.empresa_nombre || "RELMA") + " — Sistema de Fórmulas";
}

// ==================== BÚSQUEDA GLOBAL ====================
let timeoutBusqueda;
$("#buscarGlobal").oninput = (e) => {
  clearTimeout(timeoutBusqueda);
  const q = e.target.value.trim();
  if (q.length < 2) return $("#resultadosGlobal").classList.add("oculto");
  timeoutBusqueda = setTimeout(async () => {
    const r = await api("/api/buscar?q=" + encodeURIComponent(q));
    const cont = $("#resultadosGlobal");
    let html = "";
    if (r.clientes.length) {
      html += '<div class="grupo">Clientes</div>';
      r.clientes.forEach(c => html += `<div class="item" data-tipo="cliente" data-id="${c.id}">👥 ${c.nombre}</div>`);
    }
    if (r.formulas.length) {
      html += '<div class="grupo">Fórmulas</div>';
      r.formulas.forEach(f => html += `<div class="item" data-tipo="formula" data-id="${f.id}">🧪 ${f.color} <small>${f.cliente_nombre}</small></div>`);
    }
    if (r.productos.length) {
      html += '<div class="grupo">Productos</div>';
      r.productos.forEach(p => html += `<div class="item">📦 ${p.nombre} <small>${p.categoria}</small></div>`);
    }
    cont.innerHTML = html || '<div class="item">Sin resultados</div>';
    cont.classList.remove("oculto");
    cont.querySelectorAll(".item[data-tipo]").forEach(el => {
      el.onclick = () => {
        cont.classList.add("oculto");
        $("#buscarGlobal").value = "";
        if (el.dataset.tipo === "cliente") {
          const c = state.clientes.find(x => x.id == el.dataset.id);
          if (c) verCliente(c);
        } else if (el.dataset.tipo === "formula") {
          verFormula(Number(el.dataset.id));
        }
      };
    });
  }, 250);
};
document.addEventListener("click", e => {
  if (!e.target.closest(".buscador-global")) $("#resultadosGlobal").classList.add("oculto");
});

// ==================== SISTEMA DE MODALES CON RETORNO ====================
function capturarCamposModal(modalId) {
  const campos = {};
  $$(`#${modalId} input, #${modalId} select, #${modalId} textarea`).forEach(el => {
    if (el.id) campos[el.id] = el.value;
  });
  return campos;
}
function restaurarCamposModal(campos) {
  for (const [id, val] of Object.entries(campos)) {
    const el = $("#" + id);
    if (el) el.value = val;
  }
}
function abrirModalConRetorno(modalNuevo, modalPadre, dropdownPadre) {
  if (modalPadre) {
    modalRetorno = {
      modal: modalPadre,
      campos: capturarCamposModal(modalPadre),
      dropdown: dropdownPadre
    };
    $("#" + modalPadre).classList.add("oculto");
  } else {
    modalRetorno = null;
  }
  $("#" + modalNuevo).classList.remove("oculto");
}
async function cerrarModalSecundario(modalId, valorCreado, campoSeleccionar) {
  $("#" + modalId).classList.add("oculto");
  if (!modalRetorno) return;

  if (valorCreado) {
    state.clientes  = await api("/api/clientes");
    state.productos = await api("/api/productos");
    state.tintas    = await api("/api/tintas");
  }

  $("#" + modalRetorno.modal).classList.remove("oculto");

  // Reconstruir dropdowns PRIMERO
  if (modalRetorno.modal === "modalNuevaSesion") {
    $("#nsCliente").innerHTML = state.clientes.map(c => `<option value="${c.id}">${c.nombre}</option>`).join("");
    $("#nsProducto").innerHTML = '<option value="">— Selecciona —</option>' +
      state.productos.map(p => `<option value="${p.nombre}">${p.nombre} (${p.categoria})</option>`).join("");
  }
  if (modalRetorno.modal === "modalFormula") {
    $("#nfCliente").innerHTML = state.clientes.map(c => `<option value="${c.id}">${c.nombre}</option>`).join("");
    $("#nfProducto").innerHTML = '<option value="">— Selecciona —</option>' +
      state.productos.map(p => `<option value="${p.nombre}">${p.nombre} (${p.categoria})</option>`).join("");
  }

  // AHORA restaurar valores
  restaurarCamposModal(modalRetorno.campos);

  if (valorCreado && campoSeleccionar) {
    const el = $("#" + campoSeleccionar);
    if (el) el.value = valorCreado;
  }
  modalRetorno = null;
}

// ==================== CLIENTES ====================
function pintarClientes() {
  const q = ($("#buscarCliente").value || "").toUpperCase();
  const soloActivos = $("#soloActivos").checked;
  const cont = $("#listaClientes");
  cont.innerHTML = "";
  const lista = state.clientes.filter(c =>
    (!soloActivos || c.activo) && c.nombre.toUpperCase().includes(q)
  );
  if (!lista.length) { cont.innerHTML = '<div class="card">Sin clientes que coincidan.</div>'; return; }
  lista.forEach(c => {
    const div = document.createElement("div");
    div.className = "card";
    div.innerHTML = `
      <div class="card-acciones">
        <button class="editar" title="Editar">✏️</button>
        <button class="borrar" title="Eliminar">🗑</button>
      </div>
      <h3>${c.nombre}</h3>
      <div class="sub">${c.contacto || ""}</div>
      <div class="sub">${c.telefono || ""}</div>
      <div class="badge ${c.activo ? "" : "inactivo"}">${c.num_formulas} fórmula(s)</div>
      <div class="sub" style="font-size:0.75rem;margin-top:6px">📅 ${formatearFecha(c.fecha_creacion)}</div>`;
    div.onclick = (e) => { if (!e.target.closest("button")) verCliente(c); };
    div.querySelector(".editar").onclick = (e) => { e.stopPropagation(); abrirCliente(c); };
    div.querySelector(".borrar").onclick = async (e) => {
      e.stopPropagation();
      const ok = await confirmar("Eliminar cliente",
        `<p>¿Eliminar <b>${c.nombre}</b>?</p><p>Se borrarán también sus ${c.num_formulas} fórmula(s) e historial.</p>`);
      if (ok) {
        try {
          await api("/api/clientes/" + c.id, { method: "DELETE" });
          toast("Cliente eliminado", "exito");
          await cargarTodo();
        } catch (err) {
          toast("No se pudo borrar: " + err.message, "error");
        }
      }
    };
    cont.appendChild(div);
  });
}
$("#buscarCliente").oninput = pintarClientes;
$("#soloActivos").onchange = pintarClientes;

async function verCliente(c) {
  $("#filtroCliente").value = c.id;
  pintarFormulas();
  $$("nav button").forEach(x => x.classList.remove("activo"));
  $$(".tab").forEach(x => x.classList.remove("activo"));
  document.querySelector('[data-tab="formulas"]').classList.add("activo");
  $("#tab-formulas").classList.add("activo");
}

function abrirCliente(c) {
  $("#cliTitulo").textContent = c ? "Editar Cliente" : "Nuevo Cliente";
  $("#cliId").value = c ? c.id : "";
  $("#ncNombre").value = c ? c.nombre : "";
  $("#ncContacto").value = c ? c.contacto || "" : "";
  $("#ncTelefono").value = c ? c.telefono || "" : "";
  $("#ncEmail").value = c ? c.email || "" : "";
  $("#ncDireccion").value = c ? c.direccion || "" : "";
  $("#ncNotas").value = c ? c.notas || "" : "";
  $("#modalCliente").classList.remove("oculto");
}

$("#btnNuevoCliente").onclick = () => abrirCliente(null);

$$("#modalCliente .cancelar").forEach(b => b.onclick = () => {
  if (modalRetorno && modalRetorno.modal) cerrarModalSecundario("modalCliente", null, null);
  else $("#modalCliente").classList.add("oculto");
});

$("#btnGuardarCliente").onclick = async () => {
  const nombre = $("#ncNombre").value.trim();
  if (!nombre) return toast("Pon el nombre", "error");
  const id = $("#cliId").value;
  const datos = {
    nombre, contacto: $("#ncContacto").value, telefono: $("#ncTelefono").value,
    email: $("#ncEmail").value, direccion: $("#ncDireccion").value, notas: $("#ncNotas").value,
  };
  try {
    let idNuevo;
    if (id) {
      await api("/api/clientes/" + id, { method: "PUT", body: JSON.stringify(datos) });
      toast("Cliente actualizado", "exito");
      idNuevo = id;
    } else {
      const r = await api("/api/clientes", { method: "POST", body: JSON.stringify(datos) });
      toast("Cliente creado", "exito");
      idNuevo = r.id;
    }
    if (modalRetorno && modalRetorno.modal) {
      const dropdown = modalRetorno.dropdown;
      await cerrarModalSecundario("modalCliente", idNuevo, dropdown);
    } else {
      $("#modalCliente").classList.add("oculto");
      state.clientes = await api("/api/clientes");
      pintarClientes();
      llenarSelects();
    }
  } catch (e) { toast("Error: " + e.message, "error"); }
};

// ==================== PRODUCTO ====================
function abrirProductoNuevo(modalPadre, dropdownPadre) {
  abrirModalConRetorno("modalProducto", modalPadre, dropdownPadre);
  ["npCodigo","npNombre"].forEach(id => $("#"+id).value = "");
}

$("#btnGuardarProducto").onclick = async () => {
  const codigo = $("#npCodigo").value.trim();
  const nombre = $("#npNombre").value.trim();
  if (!codigo || !nombre) return toast("Faltan datos", "error");
  try {
    await api("/api/productos", { method: "POST", body: JSON.stringify({
      codigo, nombre, categoria: $("#npCategoria").value, maquina: Number($("#npMaquina").value)
    })});
    toast("Producto agregado", "exito");
    state.productos = await api("/api/productos");
    if (modalRetorno && modalRetorno.modal) {
      const dropdown = modalRetorno.dropdown;
      await cerrarModalSecundario("modalProducto", nombre, dropdown);
    } else {
      $("#modalProducto").classList.add("oculto");
    }
  } catch (e) { toast("Error: " + e.message, "error"); }
};

$$("#modalProducto .cancelar").forEach(b => b.onclick = () => {
  if (modalRetorno && modalRetorno.modal) cerrarModalSecundario("modalProducto", null, null);
  else $("#modalProducto").classList.add("oculto");
});

// ==================== TINTA AL VUELO ====================
function abrirTintaNueva(modalPadre, dropdownPadre) {
  abrirModalConRetorno("modalTinta", modalPadre, dropdownPadre);
  ["ntCodigo","ntNombre"].forEach(id => $("#"+id).value = "");
  // Sugerir máquina según el padre
  if (modalPadre === "modalFormula") {
    $("#ntMaquina").value = $("#nfMaquina").value;
    $("#ntCategoria").value = $("#nfMaquina").value === "64" ? "ARQUITECTONICA" : "INDUSTRIAL";
  } else if (modalPadre === "modalNuevaSesion") {
    const prod = state.productos.find(p => p.nombre === $("#nsProducto").value);
    const maquina = prod ? prod.maquina : 32;
    $("#ntMaquina").value = maquina;
    $("#ntCategoria").value = maquina === 64 ? "ARQUITECTONICA" : "INDUSTRIAL";
  }
}

$("#btnGuardarTinta").onclick = async () => {
  const codigo = $("#ntCodigo").value.trim();
  const nombre = $("#ntNombre").value.trim();
  if (!codigo || !nombre) return toast("Faltan datos", "error");
  try {
    await api("/api/tintas", { method: "POST", body: JSON.stringify({
      codigo, nombre, categoria: $("#ntCategoria").value, maquina: Number($("#ntMaquina").value)
    })});
    toast("Tinta agregada", "exito");
    state.tintas = await api("/api/tintas");

    if (modalRetorno && modalRetorno.modal) {
      const padre = modalRetorno.modal;
      await cerrarModalSecundario("modalTinta", nombre, null);

      // Si es el modal de fórmula, agregar una nueva fila con la tinta preseleccionada
      if (padre === "modalFormula") {
        agregarFilaTinta(nombre, "");
      }
    } else {
      $("#modalTinta").classList.add("oculto");
      // Si estamos en el igualador, recargar tintas y seleccionar la nueva
      if (sesionActual) {
        llenarTintasMezclador(sesionActual.producto);
        setTimeout(() => { $("#mezcTinta").value = nombre; }, 50);
      }
    }
  } catch (e) { toast("Error: " + e.message, "error"); }
};

$$("#modalTinta .cancelar").forEach(b => b.onclick = () => {
  if (modalRetorno && modalRetorno.modal) cerrarModalSecundario("modalTinta", null, null);
  else $("#modalTinta").classList.add("oculto");
});

// ==================== FÓRMULAS ====================
function pintarFormulas() {
  const q = ($("#buscarFormula").value || "").toUpperCase();
  const clienteId = $("#filtroCliente").value;
  const producto = $("#filtroProducto").value;
  const soloFav = $("#soloFavoritos").checked;
  const cont = $("#listaFormulas");
  cont.innerHTML = "";
  const lista = state.formulas.filter(f =>
    (!clienteId || f.cliente_id == clienteId) &&
    (!producto || f.producto === producto) &&
    (!soloFav || f.favorito) &&
    (!q || (f.color + " " + (f.codigo || "")).toUpperCase().includes(q))
  );
  if (!lista.length) { cont.innerHTML = '<div class="card">Sin fórmulas. Usa "+ Nueva Fórmula".</div>'; return; }
  lista.forEach(f => {
    const div = document.createElement("div");
    div.className = "card";
    div.innerHTML = `
      <div class="card-acciones">
        <button class="fav ${f.favorito ? "activo" : ""}" title="Favorito">⭐</button>
        <button class="editar" title="Editar">✏️</button>
        <button class="duplicar" title="Duplicar">📋</button>
        <button class="borrar" title="Eliminar">🗑</button>
      </div>
      <h3>${f.color}</h3>
      <div class="sub">${f.cliente_nombre}</div>
      <div class="sub">${f.producto || ""} · ${f.base || ""}</div>
      <div class="badge">${f.capacidad_madre} LT · ${f.maquina === 64 ? "Arq." : "Ind."}</div>
      <div class="sub" style="font-size:0.75rem;margin-top:6px">📅 ${formatearFecha(f.fecha_creacion)}</div>`;
    div.onclick = (e) => { if (!e.target.closest("button")) verFormula(f.id); };
    div.querySelector(".fav").onclick = async (e) => {
      e.stopPropagation();
      const r = await api("/api/formulas/" + f.id + "/favorito", { method: "POST" });
      f.favorito = r.favorito;
      pintarFormulas();
    };
    div.querySelector(".editar").onclick = async (e) => {
      e.stopPropagation();
      const full = await api("/api/formulas/" + f.id);
      abrirFormula(full);
    };
    div.querySelector(".duplicar").onclick = async (e) => {
      e.stopPropagation();
      await api("/api/formulas/" + f.id + "/duplicar", { method: "POST" });
      toast("Fórmula duplicada", "exito");
      await cargarTodo();
    };
    div.querySelector(".borrar").onclick = async (e) => {
      e.stopPropagation();
      const ok = await confirmar("Eliminar fórmula", `<p>¿Eliminar <b>${f.color}</b> de ${f.cliente_nombre}?</p>`);
      if (ok) {
        try {
          await api("/api/formulas/" + f.id, { method: "DELETE" });
          toast("Fórmula eliminada", "exito");
          await cargarTodo();
        } catch (err) {
          toast("No se pudo borrar: " + err.message, "error");
        }
      }
    };
    cont.appendChild(div);
  });
}
$("#buscarFormula").oninput = pintarFormulas;
$("#filtroCliente").onchange = pintarFormulas;
$("#filtroProducto").onchange = pintarFormulas;
$("#soloFavoritos").onchange = pintarFormulas;
$("#btnNuevaFormula").onclick = () => abrirFormula(null);

function abrirFormula(f) {
  $("#frmTitulo").textContent = f ? "Editar Fórmula" : "Nueva Fórmula";
  $("#frmId").value = f ? f.id : "";
  $("#nfCliente").innerHTML = state.clientes.map(c => `<option value="${c.id}">${c.nombre}</option>`).join("");
  $("#nfProducto").innerHTML = '<option value="">— Selecciona —</option>' +
    state.productos.map(p => `<option value="${p.nombre}">${p.nombre} (${p.categoria})</option>`).join("");
  $("#nfColor").value = f ? f.color : "";
  $("#nfCodigo").value = f ? f.codigo || "" : "";
  $("#nfBase").value = f ? f.base || "" : "";
  $("#nfCapacidad").value = f ? f.capacidad_madre : 1;
  $("#nfMaquina").value = f ? f.maquina : 32;
  $("#nfNotas").value = f ? f.notas || "" : "";
  if (f) {
    $("#nfCliente").value = f.cliente_id;
    $("#nfProducto").value = f.producto || "";
  } else {
    const cliFiltro = $("#filtroCliente").value;
    if (cliFiltro) $("#nfCliente").value = cliFiltro;
    const prodFiltro = $("#filtroProducto").value;
    if (prodFiltro) $("#nfProducto").value = prodFiltro;
  }
  $("#nfTintas").innerHTML = "";
  if (f && f.tintas && f.tintas.length) f.tintas.forEach(t => agregarFilaTinta(t.tinta, t.cantidad_texto));
  else agregarFilaTinta();
  $("#modalFormula").classList.remove("oculto");
}

function agregarFilaTinta(tinta, cantidad) {
  const maquina = Number($("#nfMaquina").value);
  const tintasFiltradas = state.tintas.filter(t => t.maquina === maquina);
  const cont = $("#nfTintas");
  const div = document.createElement("div");
  div.className = "tinta-fila";
  div.innerHTML = `
    <select class="tinta-select">
      <option value="">— Tinta —</option>
      ${tintasFiltradas.map(t => `<option value="${t.nombre}" data-cat="${t.categoria}">${t.nombre} (${t.categoria})</option>`).join("")}
    </select>
      <input type="text" class="tinta-cant" placeholder="Ej: 24 hoz + 10/32" value="${cantidad || ""}">
    <span class="feedback-tinta"></span>
    <button type="button" class="quitar">✕</button>`;
  if (tinta) div.querySelector(".tinta-select").value = tinta;
  div.querySelector(".quitar").onclick = () => div.remove();
  cont.appendChild(div);

  // Feedback en vivo para este input
  const input = div.querySelector(".tinta-cant");
  const fb = div.querySelector(".feedback-tinta");
  input.addEventListener("input", () => {
    const val = input.value.trim();
    const maq = Number($("#nfMaquina").value);
    if (!val) {
      fb.textContent = ""; fb.className = "feedback-tinta";
      input.classList.remove("input-valido", "input-invalido");
      return;
    }
    const r = validarYNormalizarCantidad(val, maq);
    if (r.valido) {
      fb.textContent = (r.normalizado !== val) ? "→ " + r.normalizado : "✓";
      fb.className = "feedback-tinta valido";
      input.classList.add("input-valido");
      input.classList.remove("input-invalido");
    } else {
      fb.textContent = "✗";
      fb.className = "feedback-tinta invalido";
      input.classList.add("input-invalido");
      input.classList.remove("input-valido");
    }
  });
  input.addEventListener("blur", () => {
    const val = input.value.trim();
    const maq = Number($("#nfMaquina").value);
    if (!val) return;
    const r = validarYNormalizarCantidad(val, maq);
    if (r.valido) input.value = r.normalizado;
  });
}

// Refrescar tintas al cambiar la máquina
document.addEventListener("change", (e) => {
  if (e.target && e.target.id === "nfMaquina") {
    const maquina = Number(e.target.value);
    const tintasFiltradas = state.tintas.filter(t => t.maquina === maquina);
    $$("#nfTintas .tinta-select").forEach(sel => {
      const valorActual = sel.value;
      sel.innerHTML = '<option value="">— Tinta —</option>' +
        tintasFiltradas.map(t => `<option value="${t.nombre}" data-cat="${t.categoria}">${t.nombre} (${t.categoria})</option>`).join("");
      if (tintasFiltradas.find(t => t.nombre === valorActual)) sel.value = valorActual;
    });
    toast("Tintas filtradas por máquina " + maquina, "aviso");
  }
});

$("#nfAddTinta").onclick = () => agregarFilaTinta();
$("#nfNuevaTinta").onclick = () => abrirTintaNueva("modalFormula", null);

$$("#modalFormula .cancelar").forEach(b => b.onclick = () => $("#modalFormula").classList.add("oculto"));
$("#nfNuevoCliente").onclick = () => {
  abrirModalConRetorno("modalCliente", "modalFormula", "nfCliente");
  abrirCliente(null);
};
$("#nfNuevoProducto").onclick = () => abrirProductoNuevo("modalFormula", "nfProducto");

$("#btnGuardarFormula").onclick = async () => {
  const tintas = [];
  const maq = Number($("#nfMaquina").value);
  let huboError = false;
  $$("#nfTintas .tinta-fila").forEach(fila => {
    const tinta = fila.querySelector(".tinta-select").value;
    const cant = fila.querySelector(".tinta-cant").value.trim();
    if (tinta && cant) {
      const r = validarYNormalizarCantidad(cant, maq);
      if (!r.valido) {
        huboError = true;
        toast("Tinta " + tinta + ": " + r.error, "error");
        return;
      }
      const opt = fila.querySelector(".tinta-select").selectedOptions[0];
      tintas.push({ tinta, cantidad_texto: r.normalizado, categoria: opt.dataset.cat });
    }
  });
  if (huboError) return;
  if (!tintas.length) return toast("Agrega al menos una tinta", "error");
  const id = $("#frmId").value;
  const datos = {
    cliente_id: Number($("#nfCliente").value),
    color: $("#nfColor").value.trim(),
    codigo: $("#nfCodigo").value.trim(),
    producto: $("#nfProducto").value,
    base: $("#nfBase").value.trim(),
    capacidad_madre: Number($("#nfCapacidad").value),
    maquina: Number($("#nfMaquina").value),
    notas: $("#nfNotas").value.trim(),
    tintas,
  };
  if (!datos.color) return toast("Pon el color", "error");
  try {
    if (id) {
      await api("/api/formulas/" + id, { method: "PUT", body: JSON.stringify(datos) });
      toast("Fórmula actualizada", "exito");
    } else {
      await api("/api/formulas", { method: "POST", body: JSON.stringify(datos) });
      toast("Fórmula guardada", "exito");
    }
    $("#modalFormula").classList.add("oculto");
    await cargarTodo();
  } catch (e) { toast("Error: " + e.message, "error"); }
};

// ==================== VER FÓRMULA ====================
async function verFormula(id) {
  const f = await api("/api/formulas/" + id);
  formulaDetalleActual = f;
  $("#detTitulo").textContent = f.color + " — " + f.cliente_nombre;
  pintarDetalleFormula();
  $("#modalDetalle").classList.remove("oculto");
}

function formatearFecha(fechaSQL) {
  if (!fechaSQL) return "";
  // Viene del backend como "2026-10-15 14:32:00" (UTC)
  // La interpretamos como UTC y la pasamos a local
  const d = new Date(fechaSQL.replace(" ", "T") + "Z");
  if (isNaN(d.getTime())) return fechaSQL;
  const pad = n => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function pintarDetalleFormula() {
  if (!formulaDetalleActual) return;
  const f = formulaDetalleActual;
  const unidad = $("#detUnidad").value;
  const tintas = f.tintas.map(t => {
    let valor = t.cantidad_texto;
    const total128 = parsearCantidad(t.cantidad_texto);
    if (total128 !== null) {
      if (unidad === "ML") valor = formatearML(total128);
      if (unidad === "AMBAS") valor = t.cantidad_texto + "   (" + formatearML(total128) + ")";
    }
    return `<div class="tinta-fila"><div style="flex:1"><b>${t.tinta}</b></div><div style="flex:1">${valor}</div></div>`;
  }).join("");
  $("#detContenido").innerHTML = `
    <p><b>Cliente:</b> ${f.cliente_nombre}</p>
    <p><b>Producto:</b> ${f.producto || "-"}</p>
    <p><b>Base:</b> ${f.base || "-"}</p>
    <p><b>Capacidad:</b> ${f.capacidad_madre} LT · <b>Máquina:</b> ${f.maquina === 64 ? "Arquitectónica" : "Industrial"}</p>
    ${f.codigo ? `<p><b>Código:</b> ${f.codigo}</p>` : ""}
    <p style="color:var(--txt-suave);font-size:0.85rem;margin-top:6px">
      📅 Creada: ${formatearFecha(f.fecha_creacion)}
      ${f.ultima_actualizacion && f.ultima_actualizacion !== f.fecha_creacion
        ? ` · ✏️ Editada: ${formatearFecha(f.ultima_actualizacion)}` : ""}
    </p>
    <h4 style="margin-top:10px">Tintas:</h4>${tintas}
    ${f.notas ? `<p style="margin-top:10px"><b>Notas:</b> ${f.notas}</p>` : ""}`;
  $("#detConvSalida").textContent = "";
  cargarHistorialFormula(f.id);
}

async function cargarHistorialFormula(formulaId) {
  try {
    const items = await api("/api/preparaciones/formula/" + formulaId);
    $("#detHistorial").innerHTML = items.length
      ? items.map(i => `<div class="log-fila"><span class="fecha">${i.fecha}</span> · <b>${i.estado}</b> · ${i.preparo || "-"}</div>`).join("")
      : "<p class='ayuda'>Aún no se ha preparado esta fórmula.</p>";
  } catch (e) { $("#detHistorial").innerHTML = "<p class='ayuda'>Error.</p>"; }
}

$("#detUnidad").onchange = pintarDetalleFormula;
$$("#modalDetalle .cancelar").forEach(b => b.onclick = () => $("#modalDetalle").classList.add("oculto"));

let conversionTemporal = null;

$("#detBtnConvertir").onclick = () => {
  if (!formulaDetalleActual) return;
  const destino = Number($("#detConvTamano").value);
  if (!destino) return toast("Elige tamaño", "error");
  const origen = formulaDetalleActual.capacidad_madre;
  const maquina = formulaDetalleActual.maquina;
  const lineas = formulaDetalleActual.tintas.map(t => {
    const total128 = parsearCantidad(t.cantidad_texto);
    if (total128 === null) return { texto: t.tinta + " = ERROR", tinta: null };
    const conv = (total128 / origen) * destino;
    return {
      texto: t.tinta + " = " + formatearOZConMaquina(conv, maquina),
      tinta: t.tinta,
      cantidad: formatearOZConMaquina(conv, maquina),
      categoria: t.categoria
    };
  });
  conversionTemporal = {
    destino,
    maquina,
    tintas: lineas.filter(l => l.tinta).map(l => ({
      tinta: l.tinta, cantidad_texto: l.cantidad, categoria: l.categoria
    }))
  };
  $("#detConvSalida").textContent = "Convertido a " + destino + " LT:\n" + lineas.map(l => l.texto).join("\n");
  $("#detBtnGuardarConvertida").classList.remove("oculto");
};

$("#detBtnGuardarConvertida").onclick = () => {
  if (!conversionTemporal || !formulaDetalleActual) return;
  const f = formulaDetalleActual;
  const conv = conversionTemporal;
  $("#modalDetalle").classList.add("oculto");
  $("#frmTitulo").textContent = "Guardar versión convertida (" + conv.destino + " LT)";
  $("#frmId").value = "";
  $("#nfCliente").innerHTML = state.clientes.map(c => `<option value="${c.id}">${c.nombre}</option>`).join("");
  $("#nfProducto").innerHTML = '<option value="">— Selecciona —</option>' +
    state.productos.map(p => `<option value="${p.nombre}">${p.nombre} (${p.categoria})</option>`).join("");
  $("#nfCliente").value = f.cliente_id;
  $("#nfProducto").value = f.producto || "";
  $("#nfColor").value = f.color;
  $("#nfCodigo").value = f.codigo || "";
  $("#nfBase").value = f.base || "";
  $("#nfCapacidad").value = conv.destino;
  $("#nfMaquina").value = conv.maquina;
  $("#nfNotas").value = (f.notas ? f.notas + " " : "") + "(convertida de " + f.capacidad_madre + " LT)";
  $("#nfTintas").innerHTML = "";
  conv.tintas.forEach(t => agregarFilaTinta(t.tinta, t.cantidad_texto));
  $("#modalFormula").classList.remove("oculto");
  toast("Revisa los datos y guarda como nueva fórmula", "exito");
};

$("#detBtnPreparar").onclick = () => {
  if (!formulaDetalleActual) return;
  abrirPreparar(formulaDetalleActual);
};

// ==================== PREPARAR ====================
function abrirPreparar(f) {
  const tintas = f.tintas.map(t => {
    const total128 = parsearCantidad(t.cantidad_texto);
    const ml = total128 !== null ? formatearML(total128) : "";
    return `<div class="preparar-tinta">
      <div class="nombre">${t.tinta}</div>
      <div class="cantidad">${t.cantidad_texto}</div>
      ${ml ? `<div style="color:var(--txt-suave);margin-top:4px">${ml}</div>` : ""}
    </div>`;
  }).join("");
  $("#prepararContenido").innerHTML = `
    <h1>${f.color}</h1>
    <div class="info">${f.cliente_nombre} · ${f.producto || ""} · Base: ${f.base || "-"} · <b>${f.capacidad_madre} LT</b></div>
    ${tintas}`;
  $("#modalPreparar").classList.remove("oculto");
}
$("#prepCerrar").onclick = () => $("#modalPreparar").classList.add("oculto");

$("#prepImprimir").onclick = () => {
  if (!formulaDetalleActual) return;
  const f = formulaDetalleActual;
  const tintas = f.tintas.map(t => `<tr><td style="padding:8px;border-bottom:1px solid #ddd">${t.tinta}</td><td style="padding:8px;border-bottom:1px solid #ddd;font-weight:bold">${t.cantidad_texto}</td></tr>`).join("");
  const win = window.open("", "_blank");
  win.document.write(`<html><head><title>${f.color}</title>
    <style>body{font-family:Arial;padding:20px}h1{color:#0284c7}table{width:100%;border-collapse:collapse;margin-top:16px}th{background:#0284c7;color:white;padding:10px;text-align:left}</style></head>
    <body><h1>${state.config.empresa_nombre || "RELMA"}</h1>
    <h2>${f.color}</h2>
    <p><b>Cliente:</b> ${f.cliente_nombre}<br><b>Producto:</b> ${f.producto || "-"}<br>
    <b>Base:</b> ${f.base || "-"}<br><b>Capacidad:</b> ${f.capacidad_madre} LT<br>
    <b>Fecha:</b> ${new Date().toLocaleString()}</p>
    <table><tr><th>Tinta</th><th>Cantidad</th></tr>${tintas}</table></body></html>`);
  win.document.close(); win.print();
};

// ==================== ETIQUETA CON OPCIONES ====================
function leerOpcionesEtiqueta() {
  return {
    color:     $("#etqMostrarColor").checked,
    cliente:   $("#etqMostrarCliente").checked,
    producto:  $("#etqMostrarProducto").checked,
    base:      $("#etqMostrarBase").checked,
    cantidad:  $("#etqMostrarCantidad").checked,
    codigo:    $("#etqMostrarCodigo").checked,
    tintas:    $("#etqMostrarTintas").checked,
    fecha:     $("#etqMostrarFecha").checked,
    empresa:   $("#etqMostrarEmpresa").checked,
  };
}

function generarEtiquetaHTML(opciones) {
  const f = formulaDetalleActual;
  if (!f) return "";
  const hayTintas = opciones.tintas && f.tintas && f.tintas.length;
  const claseMarco = hayTintas ? "marco" : "marco marco-sin-tintas";
  let html = `<div class="${claseMarco}">`;

  const tieneHeader = opciones.color || opciones.cliente || opciones.producto
    || opciones.base || opciones.cantidad || opciones.codigo;
  if (tieneHeader) {
    html += '<div class="header">';
    if (opciones.color) html += `<div class="color">${f.color}</div>`;
    const metaParts = [];
    if (opciones.cliente && f.cliente_nombre) metaParts.push(f.cliente_nombre);
    if (opciones.producto && f.producto) metaParts.push(f.producto);
    if (opciones.base && f.base) metaParts.push(f.base);
    if (opciones.cantidad && f.capacidad_madre) metaParts.push(f.capacidad_madre + " LT");
    if (opciones.codigo && f.codigo) metaParts.push(f.codigo);
    if (metaParts.length) html += `<div class="meta">${metaParts.join(" · ")}</div>`;
    html += '</div>';
  }

  if (hayTintas) {
    html += '<div class="tintas">';
    for (const t of f.tintas) {
      html += `<div class="tinta-fila">
        <div class="tinta-nombre">${t.tinta}</div>
        <div class="tinta-cantidad">${t.cantidad_texto}</div>
      </div>`;
    }
    html += '</div>';
  } else {
    html += '<div class="tintas-vacio"></div>';
  }

  const footerParts = [];
  if (opciones.empresa) footerParts.push(state.config.empresa_nombre || "RELMA");
  if (opciones.fecha) footerParts.push(
    new Date().toLocaleDateString() + " " +
    new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})
  );
  if (footerParts.length) {
    html += `<div class="footer">${footerParts.join(" · ")}</div>`;
  }

  html += '</div>';
  return html;
}

function actualizarPreviewEtiqueta() {
  const opciones = leerOpcionesEtiqueta();
  $("#etqPreview").innerHTML = generarEtiquetaHTML(opciones);
}

$("#prepEtiqueta").onclick = () => {
  if (!formulaDetalleActual) return;
  actualizarPreviewEtiqueta();
  $("#modalEtiqueta").classList.remove("oculto");
};

// Listeners de los checkboxes para actualizar preview en vivo
[
  "etqMostrarColor","etqMostrarCliente","etqMostrarProducto","etqMostrarBase",
  "etqMostrarCantidad","etqMostrarCodigo","etqMostrarTintas","etqMostrarFecha","etqMostrarEmpresa"
].forEach(id => {
  const el = $("#" + id);
  if (el) el.addEventListener("change", actualizarPreviewEtiqueta);
});

$("#etqCancelar").onclick = () => {
  $("#modalEtiqueta").classList.add("oculto");
};

$("#etqImprimir").onclick = () => {
  const opciones = leerOpcionesEtiqueta();
  const contenido = generarEtiquetaHTML(opciones);

  const win = window.open("", "_blank");
  win.document.write(`<!DOCTYPE html>
<html><head><title>Etiqueta</title>
<meta charset="UTF-8">
<style>
  @page { size: 59mm 102mm; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    width: 59mm;
    height: 102mm;
    background: #fff;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  body {
    font-family: Arial, Helvetica, sans-serif;
    color: #000;
    padding: 3mm;
  }
  .marco {
    width: 100%; height: 100%;
    border: 1.5px solid #000;
    border-radius: 2mm;
    padding: 2.5mm;
    display: flex;
    flex-direction: column;
  }
  .header {
    border-bottom: 1.2px solid #000;
    padding-bottom: 1.5mm;
    margin-bottom: 1.5mm;
    text-align: center;
  }
  .color {
    font-size: 13pt;
    font-weight: 900;
    line-height: 1.1;
    text-transform: uppercase;
    letter-spacing: -0.3pt;
    word-wrap: break-word;
  }
  .meta {
    font-size: 7pt;
    margin-top: 1.5mm;
    line-height: 1.25;
    font-weight: 600;
    text-transform: uppercase;
    color: #333;
    word-wrap: break-word;
  }
  .tintas {
    flex: 1;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    justify-content: flex-start;
  }
  .tinta-fila {
    padding: 1.5mm 0;
    border-bottom: 0.5px dashed #999;
    text-align: center;
  }
  .tinta-fila:last-child { border-bottom: none; }
  .tinta-nombre {
    font-size: 9.5pt;
    font-weight: 700;
    text-transform: uppercase;
    line-height: 1.1;
    margin-bottom: 0.8mm;
    word-wrap: break-word;
  }
  .tinta-cantidad {
    font-size: 11pt;
    font-weight: 900;
    font-family: "Courier New", "Consolas", monospace;
    line-height: 1.15;
    word-wrap: break-word;
  }
    .tintas-vacio {
    flex: 1;
  }
  .marco-sin-tintas .header {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    border-bottom: 1.2px solid #000;
    padding: 3mm 0;
    margin-bottom: 2mm;
  }
  .marco-sin-tintas .color {
    font-size: 22pt;
    letter-spacing: -0.5pt;
    margin-bottom: 4mm;
  }
  .marco-sin-tintas .meta {
    font-size: 10pt;
    margin-top: 0;
    line-height: 1.4;
    color: #222;
  }
  .footer {
    margin-top: 1mm;
    padding-top: 1.5mm;
    border-top: 1.2px solid #000;
    font-size: 7pt;
    text-align: center;
    line-height: 1.35;
    font-weight: 700;
    text-transform: uppercase;
    color: #333;
    white-space: normal;
    word-wrap: break-word;
  }
  .meta {
    font-size: 7pt;
    margin-top: 1.5mm;
    line-height: 1.3;
    font-weight: 600;
    text-transform: uppercase;
    color: #333;
    word-wrap: break-word;
    white-space: normal;
  }
</style>
</head>
<body>${contenido}</body></html>`);
  win.document.close();
  setTimeout(() => win.print(), 500);
};

$("#prepMarcar").onclick = async () => {
  const f = formulaDetalleActual;
  await api("/api/preparaciones", { method: "POST", body: JSON.stringify({
    cliente_id: f.cliente_id, formula_id: f.id,
    preparo: state.sesion.usuario, estado: "ENTREGADO"
  })});
  toast("✅ Preparación registrada", "exito");
  $("#modalPreparar").classList.add("oculto");
  $("#modalDetalle").classList.add("oculto");
  await cargarTodo();
};

// ==================== CONVERSOR ====================
async function cargarFormulasConversor() {
  const sel = $("#convCargarFormula");
  sel.innerHTML = '<option value="">— Ninguna —</option>' +
    state.formulas.map(f => `<option value="${f.id}">${f.cliente_nombre} → ${f.color}</option>`).join("");
}

$("#convCargarFormula").onchange = async (e) => {
  const id = e.target.value;
  if (!id) return;
  const f = await api("/api/formulas/" + id);
  $("#capOrigen").value = [1,4,19].includes(f.capacidad_madre) ? f.capacidad_madre : "custom";
  if ($("#capOrigen").value === "custom") {
    $("#capOrigenCustom").value = f.capacidad_madre;
    $("#capOrigenCustom").classList.remove("oculto");
  }
  $("#maquinaConv").value = f.maquina;
  $("#entradaConv").value = f.tintas.map(t => t.tinta + "=" + t.cantidad_texto).join("\n");
  toast("Fórmula cargada", "exito");
  ejecutarConversion();
};

function ejecutarConversion() {
  const capOrigen = $("#capOrigen").value === "custom"
    ? (parseFloat($("#capOrigenCustom").value) || 1) : Number($("#capOrigen").value);
  const capDestino = $("#capDestino").value === "custom"
    ? (parseFloat($("#capDestinoCustom").value) || 1) : Number($("#capDestino").value);
  const maquina = Number($("#maquinaConv").value);
  const mostrarML = $("#convMostrarML").checked;
  const texto = ($("#entradaConv").value || "").trim();
  if (!texto) return $("#salidaConv").textContent = "(escribe algo primero)";

  const lineas = texto.split("\n").filter(l => l.trim());
  const out = [];
  for (const linea of lineas) {
    const partes = linea.split(/[|=]/);
    if (partes.length < 2) continue;
    const tinta = partes[0].trim();
    const cant = partes.slice(1).join("=").trim();
    const total128 = parsearCantidad(cant);
    if (total128 === null) { out.push(tinta + " = ERROR"); continue; }
    const conv = (total128 / capOrigen) * capDestino;
    out.push(tinta + " = " + formatearOZConMaquina(conv, maquina) +
             (mostrarML ? "   (" + formatearML(conv) + ")" : ""));
  }
  $("#salidaConv").textContent = out.join("\n") || "(vacío)";
}

$("#btnConvertir").onclick = ejecutarConversion;

["capOrigen","capDestino","capOrigenCustom","capDestinoCustom","maquinaConv","convMostrarML","entradaConv"].forEach(id => {
  const el = $("#" + id);
  if (el) {
    el.addEventListener("input", ejecutarConversion);
    el.addEventListener("change", ejecutarConversion);
  }
});

$("#btnCopiarConv").onclick = () => {
  navigator.clipboard.writeText($("#salidaConv").textContent);
  toast("Copiado al portapapeles", "exito");
};

["capOrigen", "capDestino"].forEach(id => {
  $("#" + id).addEventListener("change", () => {
    const inp = $("#" + id + "Custom");
    if ($("#" + id).value === "custom") inp.classList.remove("oculto");
    else inp.classList.add("oculto");
  });
});

// ==================== HISTORIAL ====================
async function pintarHistorial(filtros) {
  const params = new URLSearchParams();
  if (filtros) Object.entries(filtros).forEach(([k, v]) => { if (v) params.append(k, v); });
  const items = await api("/api/preparaciones?" + params);
  const cont = $("#listaHistorial");
  if (!items.length) { cont.innerHTML = "<p class='ayuda'>Sin resultados.</p>"; return; }
  cont.innerHTML = items.map(i => `
    <div class="item">
      <div>
        <div class="fecha">${i.fecha}</div>
        <b>${i.color || "—"}</b> · ${i.cliente_nombre || "—"}
        <div class="ayuda">${i.producto || ""} · preparó: ${i.preparo || "-"}</div>
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <span class="estado-badge ${(i.estado || "EN PROCESO").replace(" ", "-")}">${i.estado || "EN PROCESO"}</span>
        ${state.sesion.rol === "admin" ? `<button class="peligro borrar-hist" data-id="${i.id}">🗑</button>` : ""}
      </div>
    </div>`).join("");
  cont.querySelectorAll(".borrar-hist").forEach(b => {
    b.onclick = async () => {
      const ok = await confirmar("Eliminar registro", "<p>¿Borrar este registro del historial?</p>");
      if (ok) {
        await api("/api/preparaciones/" + b.dataset.id, { method: "DELETE" });
        toast("Registro eliminado", "exito");
        pintarHistorial(obtenerFiltrosHist());
      }
    };
  });
}

function obtenerFiltrosHist() {
  return {
    desde: $("#histDesde").value, hasta: $("#histHasta").value,
    cliente_id: $("#histCliente").value, producto: $("#histProducto").value,
    estado: $("#histEstado").value, q: $("#histQ").value,
  };
}
$("#btnFiltrarHist").onclick = () => pintarHistorial(obtenerFiltrosHist());
$("#btnLimpiarHist").onclick = () => {
  ["histDesde","histHasta","histQ"].forEach(id => $("#"+id).value = "");
  ["histCliente","histProducto","histEstado"].forEach(id => $("#"+id).value = "");
  pintarHistorial();
};
$("#btnExportarHistCSV").onclick = async () => {
  const params = new URLSearchParams();
  Object.entries(obtenerFiltrosHist()).forEach(([k, v]) => { if (v) params.append(k, v); });
  const items = await api("/api/preparaciones?" + params);
  if (!items.length) return toast("Nada que exportar", "aviso");
  const filas = [["Fecha","Cliente","Color","Código","Producto","Estado","Preparó","Cantidad","Unidad","Observaciones"]];
  items.forEach(i => filas.push([i.fecha, i.cliente_nombre, i.color, i.codigo, i.producto, i.estado, i.preparo, i.cantidad, i.unidad, i.observaciones]));
  descargarCSV("historial_" + new Date().toISOString().slice(0,10) + ".csv", filas);
  toast("Historial exportado", "exito");
};

// ==================== IGUALAR COLOR ====================
async function cargarSesiones() {
  try {
    const items = await api("/api/mezclador/sesiones");
    const cont = $("#mezcSesiones");
    cont.innerHTML = items.length
      ? items.map(s => `
        <div class="sesion-card" data-id="${s.id}">
          <h4>${s.muestra_nombre || "Sin nombre"}${s.muestra_codigo ? " · " + s.muestra_codigo : ""}</h4>
          <div class="sub">${s.cliente_nombre || "-"}</div>
          <div class="sub">${s.producto || ""} · ${s.base || ""}</div>
          <div class="badge">${s.num_ajustes} ajuste(s)</div>
        </div>`).join("")
      : '<div class="card">No hay sesiones abiertas. Crea una nueva.</div>';
    cont.querySelectorAll(".sesion-card").forEach(c => c.onclick = () => abrirSesion(Number(c.dataset.id)));
  } catch (e) { console.error(e); }
}

async function abrirSesion(id) {
  const s = await api("/api/mezclador/sesion/" + id);
  sesionActual = s;
  $("#mezcCliente").value = s.cliente_nombre || "";
  $("#mezcMuestra").value = (s.muestra_nombre || "") + (s.muestra_codigo ? " (" + s.muestra_codigo + ")" : "");
  $("#mezcProducto").value = s.producto || "";
  $("#mezcBase").value = s.base || "";
  $("#mezcTamano").value = s.tamano_cantidad + " " + s.tamano_unidad;
  llenarTintasMezclador(s.producto);
  pintarHistorialMezclador(s.ajustes);
  pintarTotalesMezclador(s.ajustes);
  $("#mezcListaSesiones").classList.add("oculto");
  $("#mezcTrabajo").classList.remove("oculto");
}

function llenarTintasMezclador(productoNombre) {
  const prod = state.productos.find(p => p.nombre === productoNombre);
  const maquina = prod ? prod.maquina : 64;
  $("#mezcTinta").innerHTML = '<option value="">— Selecciona —</option>' +
    state.tintas.filter(t => t.maquina === maquina)
      .map(t => `<option value="${t.nombre}" data-cat="${t.categoria}">${t.nombre} (${t.categoria})</option>`).join("");
}

function pintarHistorialMezclador(ajustes) {
  const cont = $("#mezcHistorial");
  if (!ajustes.length) return cont.innerHTML = "<p class='ayuda'>Sin ajustes aún.</p>";
  cont.innerHTML = ajustes.map(a => {
    const hora = (a.fecha || "").split(" ")[1] || "";
    return `<div class="ajuste-fila">
      <span class="hora">${hora}</span>
      <span class="tinta">${a.tinta}</span>
      <span class="cantidad">+ ${a.cantidad_texto}</span>
      <button class="del-btn" data-id="${a.id}">🗑</button>
    </div>`;
  }).join("");
  cont.querySelectorAll(".del-btn").forEach(b => {
    b.onclick = async () => {
      await api("/api/mezclador/ajuste/" + b.dataset.id, { method: "DELETE" });
      const s = await api("/api/mezclador/sesion/" + sesionActual.id);
      sesionActual = s;
      pintarHistorialMezclador(s.ajustes);
      pintarTotalesMezclador(s.ajustes);
    };
  });
}

function pintarTotalesMezclador(ajustes) {
  const cont = $("#mezcTotales");
  if (!ajustes.length) return cont.innerHTML = "<p class='ayuda'>Sin totales aún.</p>";
  const totales = {};
  ajustes.forEach(a => totales[a.tinta] = (totales[a.tinta] || 0) + a.cantidad_en_128);
  const unidad = $("#mezcUnidadMostrar").value;
  cont.innerHTML = Object.entries(totales).map(([tinta, t128]) => {
    let v = unidad === "OZ" ? formatearOZ(t128)
          : unidad === "ML" ? formatearML(t128)
          : formatearOZ(t128) + "  (" + formatearML(t128) + ")";
    return `<div class="total-fila"><span class="tinta">${tinta}</span><span class="valor">${v}</span></div>`;
  }).join("");
}

$("#btnNuevaSesion").onclick = () => {
  $("#nsCliente").innerHTML = state.clientes.map(c => `<option value="${c.id}">${c.nombre}</option>`).join("");
  $("#nsProducto").innerHTML = '<option value="">— Selecciona —</option>' +
    state.productos.map(p => `<option value="${p.nombre}">${p.nombre} (${p.categoria})</option>`).join("");
  ["nsMuestra","nsCodigo","nsBase","nsNotas"].forEach(id => $("#"+id).value = "");
  $("#nsCantidad").value = 1;
  $("#nsUnidad").value = "LT";
  $("#modalNuevaSesion").classList.remove("oculto");
};
$("#nsNuevoCliente").onclick = () => {
  abrirModalConRetorno("modalCliente", "modalNuevaSesion", "nsCliente");
  abrirCliente(null);
};
$("#nsNuevoProducto").onclick = () => abrirProductoNuevo("modalNuevaSesion", "nsProducto");
$("#mezcNuevaTinta").onclick = () => {
  if (!sesionActual) return;
  abrirModalConRetorno("modalTinta", null, null);
  ["ntCodigo","ntNombre"].forEach(id => $("#"+id).value = "");
  const prod = state.productos.find(p => p.nombre === sesionActual.producto);
  const maquina = prod ? prod.maquina : 32;
  $("#ntMaquina").value = maquina;
  $("#ntCategoria").value = maquina === 64 ? "ARQUITECTONICA" : "INDUSTRIAL";
};
$$("#modalNuevaSesion .cancelar").forEach(b => b.onclick = () => $("#modalNuevaSesion").classList.add("oculto"));

$("#nsCrear").onclick = async () => {
  const cliente_id = Number($("#nsCliente").value);
  const cantidad = parseFloat($("#nsCantidad").value);
  if (!cliente_id || !cantidad) return toast("Faltan datos", "error");
  try {
    const r = await api("/api/mezclador/sesion", { method: "POST", body: JSON.stringify({
      cliente_id,
      muestra_nombre: $("#nsMuestra").value.trim(),
      muestra_codigo: $("#nsCodigo").value.trim(),
      producto: $("#nsProducto").value,
      base: $("#nsBase").value.trim(),
      tamano_cantidad: cantidad,
      tamano_unidad: $("#nsUnidad").value,
      notas: $("#nsNotas").value.trim(),
    })});
    $("#modalNuevaSesion").classList.add("oculto");
    await abrirSesion(r.id);
  } catch (e) { toast("Error: " + e.message, "error"); }
};

$("#btnAgregarAjuste").onclick = async () => {
  if (!sesionActual) return;
  const tinta = $("#mezcTinta").value;
  const cant = $("#mezcCantidad").value.trim();
  if (!tinta || !cant) return toast("Falta tinta o cantidad", "error");

  const r = validarYNormalizarCantidad(cant, 32);
  if (!r.valido) return toast("❌ " + r.error, "error");

  await api("/api/mezclador/sesion/" + sesionActual.id + "/ajuste", { method: "POST", body: JSON.stringify({
    tinta,
    cantidad_texto: r.normalizado,   // ← se guarda NORMALIZADO
    cantidad_en_128: r.total128
  })});
  $("#mezcCantidad").value = "";
  $("#mezcFeedback").textContent = "";
  $("#mezcFeedback").className = "feedback-cantidad";
  $("#mezcCantidad").classList.remove("input-valido", "input-invalido");
  const s = await api("/api/mezclador/sesion/" + sesionActual.id);
  sesionActual = s;
  pintarHistorialMezclador(s.ajustes);
  pintarTotalesMezclador(s.ajustes);
};

$("#mezcUnidadMostrar").onchange = () => {
  if (sesionActual) pintarTotalesMezclador(sesionActual.ajustes);
};

$("#btnVolverLista").onclick = () => {
  sesionActual = null;
  $("#mezcTrabajo").classList.add("oculto");
  $("#mezcListaSesiones").classList.remove("oculto");
  cargarSesiones();
};

$("#btnCerrarSesionSinGuardar").onclick = async () => {
  if (!sesionActual) return;
  const ok = await confirmar("Descartar sesión", "<p>¿Borrar todos los ajustes de esta sesión?</p>");
  if (!ok) return;
  await api("/api/mezclador/sesion/" + sesionActual.id, { method: "DELETE" });
  sesionActual = null;
  $("#mezcTrabajo").classList.add("oculto");
  $("#mezcListaSesiones").classList.remove("oculto");
  cargarSesiones();
};

$("#btnCerrarSesion").onclick = async () => {
  if (!sesionActual) return;
  const guardar = $("#mezcGuardarFormula").checked;
  const ok = await confirmar("Finalizar sesión",
    guardar ? "<p>¿Guardar como fórmula permanente del cliente?</p>" : "<p>¿Finalizar sin guardar fórmula?</p>");
  if (!ok) return;
  const totales = {};
  sesionActual.ajustes.forEach(a => totales[a.tinta] = (totales[a.tinta] || 0) + a.cantidad_en_128);
  const tintas = Object.entries(totales).map(([tinta, t128]) => ({
    tinta, cantidad_texto: formatearOZ(t128),
    categoria: (state.tintas.find(x => x.nombre === tinta) || {}).categoria || null
  }));
  const r = await api("/api/mezclador/sesion/" + sesionActual.id + "/cerrar", { method: "POST", body: JSON.stringify({
    tintas, guardar_formula: guardar, notas: $("#mezcNotasFinales").value.trim()
  })});
  toast(guardar && r.formula_id ? "Sesión cerrada y fórmula guardada" : "Sesión cerrada", "exito");
  sesionActual = null;
  $("#mezcTrabajo").classList.add("oculto");
  $("#mezcListaSesiones").classList.remove("oculto");
  await cargarTodo();
};

// ==================== BACKUP ====================
$("#btnBackupJSON").onclick = async () => {
  const tablas = Array.from($$('.chk-grid input:checked')).map(c => c.value);
  if (!tablas.length) return toast("Selecciona al menos una tabla", "error");
  const r = await fetch("/api/backup", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-usuario": state.sesion.usuario, "x-rol": state.sesion.rol
    },
    body: JSON.stringify({ tablas })
  });
  const blob = await r.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "relma_backup_" + new Date().toISOString().slice(0,10) + ".json";
  a.click();
  URL.revokeObjectURL(url);
  toast("Respaldo descargado", "exito");
};

$("#btnBackupCSV").onclick = async () => {
  const tablas = Array.from($$('.chk-grid input:checked')).map(c => c.value);
  if (!tablas.length) return toast("Selecciona al menos una tabla", "error");
  if (tablas.includes("usuarios")) {
    toast("Nota: 'usuarios' no se incluye en Excel por seguridad", "aviso");
  }
  try {
    const r = await fetch("/api/backup/csv", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-usuario": state.sesion.usuario, "x-rol": state.sesion.rol
      },
      body: JSON.stringify({ tablas })
    });
    if (!r.ok) throw new Error("Error " + r.status);
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "relma_backup_" + new Date().toISOString().slice(0,10) + ".csv";
    a.click();
    URL.revokeObjectURL(url);
    toast("Excel descargado. Ábrelo con Excel o Google Sheets", "exito");
  } catch (e) {
    toast("Error: " + e.message, "error");
  }
};

$("#btnBackupDB").onclick = () => { window.location.href = "/api/backup/db?u=" + state.sesion.usuario; };

$("#btnBackupXLSX").onclick = async () => {
  const tablas = Array.from($$('.chk-grid input:checked')).map(c => c.value);
  if (!tablas.length) return toast("Selecciona al menos una tabla", "error");
  try {
    const r = await fetch("/api/backup/xlsx", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-usuario": state.sesion.usuario, "x-rol": state.sesion.rol
      },
      body: JSON.stringify({ tablas })
    });
    if (!r.ok) throw new Error("Error " + r.status);
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "relma_backup_" + new Date().toISOString().slice(0,10) + ".xlsx";
    a.click();
    URL.revokeObjectURL(url);
    toast("Excel con pestañas descargado", "exito");
  } catch (e) { toast("Error: " + e.message, "error"); }
};

// ==================== IMPORTADOR EXCEL ====================
let archivoImportTemp = null;

$("#inputImportar").onchange = (e) => {
  const f = e.target.files[0];
  if (!f) return;
  archivoImportTemp = f;
  $("#importarPreview").classList.remove("oculto");
  toast("Archivo listo. Clic en Aplicar importación para procesar.", "exito");
};

$("#btnCancelarImport").onclick = () => {
  $("#importarPreview").classList.add("oculto");
  $("#inputImportar").value = "";
  archivoImportTemp = null;
};

$("#btnAplicarImport").onclick = async () => {
  if (!archivoImportTemp) return;
  const fd = new FormData();
  fd.append("archivo", archivoImportTemp);
  try {
    const r = await fetch("/api/importar/excel", {
      method: "POST",
      headers: {
        "x-usuario": state.sesion.usuario, "x-rol": state.sesion.rol
      },
      body: fd
    });
    if (!r.ok) {
      const e = await r.json();
      throw new Error(e.error || "Error " + r.status);
    }
    const data = await r.json();
    const rr = data.resultados;
    toast(`Importado: ${rr.clientes} clientes, ${rr.productos} productos, ${rr.tintas} tintas`, "exito");
    $("#importarPreview").classList.add("oculto");
    $("#inputImportar").value = "";
    archivoImportTemp = null;
    await cargarTodo();
  } catch (e) { toast("Error: " + e.message, "error"); }
};

$("#inputRestore").onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const json = JSON.parse(await file.text());
    archivoRestoreTemp = json;
    const preview = await api("/api/restore/preview", { method: "POST", body: JSON.stringify({ data: json.data }) });
    const resumen = Object.entries(preview.resumen).filter(([k, v]) => v > 0)
      .map(([k, v]) => `<div>• <b>${k}</b>: ${v} fila(s)</div>`).join("");
    $("#restoreResumen").innerHTML = resumen || "<p>El archivo no contiene datos.</p>";
    $("#restorePreview").classList.remove("oculto");
    toast("Archivo leído correctamente", "exito");
  } catch (err) {
    toast("Archivo inválido: " + err.message, "error");
    $("#restorePreview").classList.add("oculto");
  }
};

$("#btnCancelarRestore").onclick = () => {
  $("#restorePreview").classList.add("oculto");
  $("#inputRestore").value = "";
  archivoRestoreTemp = null;
};

$("#btnAplicarRestore").onclick = async () => {
  if (!archivoRestoreTemp) return;
  const modo = $("#restoreModo").value;
  const ok = await confirmar("Confirmar restauración",
    `<p>Se aplicará el respaldo en modo <b>${modo}</b>.</p>` +
    `<p><b>Advertencia:</b> si elegiste "Reemplazar" se borrarán los datos actuales de las tablas incluidas.</p>`,
    "RESTAURAR");
  if (!ok) return;
  try {
    await api("/api/restore", { method: "POST", body: JSON.stringify({ data: archivoRestoreTemp.data, modo })});
    toast("Restauración completada", "exito");
    $("#restorePreview").classList.add("oculto");
    $("#inputRestore").value = "";
    archivoRestoreTemp = null;
    await cargarTodo();
  } catch (e) { toast("Error: " + e.message, "error"); }
};

// ==================== CONFIG — USUARIOS ====================
async function cargarUsuarios() {
  const lista = await api("/api/usuarios");
  $("#listaUsuarios").innerHTML = lista.map(u => `
    <div class="usuario-fila ${u.activo ? "" : "inactivo"}">
      <div>
        <b>${u.usuario}</b> <span class="rol ${u.rol}">${u.rol}</span>
        ${u.nombre ? `<div class="ayuda">${u.nombre}</div>` : ""}
      </div>
      <div style="display:flex;gap:6px">
        <button class="secundario" onclick="cambiarPass(${u.id})">🔑 Contraseña</button>
        <button class="secundario" onclick="toggleActivo(${u.id}, ${u.activo ? 1 : 0})">
          ${u.activo ? "⏸" : "▶️"} ${u.activo ? "Desactivar" : "Activar"}
        </button>
        ${u.usuario !== "admin" ? `<button class="peligro" onclick="borrarUsuario(${u.id}, '${u.usuario}')">🗑</button>` : ""}
      </div>
    </div>`).join("");
}
window.cambiarPass = async (id) => {
  const pass = prompt("Nueva contraseña:");
  if (!pass) return;
  await api("/api/usuarios/" + id, { method: "PUT", body: JSON.stringify({ password: pass }) });
  toast("Contraseña actualizada", "exito");
};
window.toggleActivo = async (id, activo) => {
  await api("/api/usuarios/" + id, { method: "PUT", body: JSON.stringify({ activo: !activo }) });
  cargarUsuarios();
};
window.borrarUsuario = async (id, usuario) => {
  const ok = await confirmar("Eliminar usuario", `<p>¿Eliminar al usuario <b>${usuario}</b>?</p>`);
  if (ok) { await api("/api/usuarios/" + id, { method: "DELETE" }); cargarUsuarios(); }
};

$("#btnCrearUsuario").onclick = async () => {
  const usuario = $("#uNuevoUsuario").value.trim();
  const password = $("#uNuevoPassword").value;
  if (!usuario || !password) return toast("Faltan datos", "error");
  try {
    await api("/api/usuarios", { method: "POST", body: JSON.stringify({
      usuario, password, nombre: $("#uNuevoNombre").value.trim(), rol: $("#uNuevoRol").value
    })});
    $("#uNuevoUsuario").value = "";
    $("#uNuevoNombre").value = "";
    $("#uNuevoPassword").value = "";
    toast("Usuario creado", "exito");
    cargarUsuarios();
  } catch (e) { toast("Error: " + e.message, "error"); }
};

// ==================== CONFIG — EMPRESA / PREFS ====================
function cargarConfigEnForms() {
  const c = state.config;
  $("#cfgEmpresaNombre").value = c.empresa_nombre || "";
  $("#cfgEmpresaTel").value = c.empresa_telefono || "";
  $("#cfgEmpresaDir").value = c.empresa_direccion || "";
  $("#cfgEmpresaEmail").value = c.empresa_email || "";
  $("#cfgEmpresaLogo").value = c.empresa_logo || "";
  $("#cfgPrefUnidad").value = c.pref_unidad || "OZ";
  $("#cfgPrefMaquina").value = c.pref_maquina || "32";
  $("#cfgPrefTamano").value = c.pref_tamano || 1;
  $("#cfgPrefMlOz").value = c.pref_ml_por_oz || 30.125;
}

$("#btnGuardarEmpresa").onclick = async () => {
  const campos = {
    empresa_nombre: $("#cfgEmpresaNombre").value,
    empresa_telefono: $("#cfgEmpresaTel").value,
    empresa_direccion: $("#cfgEmpresaDir").value,
    empresa_email: $("#cfgEmpresaEmail").value,
    empresa_logo: $("#cfgEmpresaLogo").value,
  };
  for (const [k, v] of Object.entries(campos)) {
    await api("/api/config/" + k, { method: "PUT", body: JSON.stringify({ valor: v }) });
  }
  state.config = await api("/api/config");
  aplicarConfig(state.config);
  toast("Datos guardados", "exito");
};

$("#btnGuardarPrefs").onclick = async () => {
  const campos = {
    pref_unidad: $("#cfgPrefUnidad").value,
    pref_maquina: $("#cfgPrefMaquina").value,
    pref_tamano: $("#cfgPrefTamano").value,
    pref_ml_por_oz: $("#cfgPrefMlOz").value,
  };
  for (const [k, v] of Object.entries(campos)) {
    await api("/api/config/" + k, { method: "PUT", body: JSON.stringify({ valor: v }) });
  }
  state.config = await api("/api/config");
  toast("Preferencias guardadas", "exito");
};

// ==================== CONFIG — CATÁLOGOS ====================
async function cargarCatalogos() {
  const tintas = await api("/api/tintas");
  $("#listaCatTintas").innerHTML = tintas.map(t =>
    `<div class="log-fila"><b>${t.codigo}</b> · ${t.nombre} <span class="rol">${t.categoria}</span> · M${t.maquina}</div>`
  ).join("");
  const prods = await api("/api/productos");
  $("#listaCatProductos").innerHTML = prods.map(p =>
    `<div class="log-fila"><b>${p.codigo}</b> · ${p.nombre} <span class="rol">${p.categoria}</span> · M${p.maquina}</div>`
  ).join("");
}

$("#btnCrearTinta").onclick = async () => {
  const codigo = $("#ctCodigo").value.trim();
  const nombre = $("#ctNombre").value.trim();
  if (!codigo || !nombre) return toast("Faltan datos", "error");
  try {
    await api("/api/tintas", { method: "POST", body: JSON.stringify({
      codigo, nombre, categoria: $("#ctCategoria").value, maquina: Number($("#ctMaquina").value)
    })});
    state.tintas = await api("/api/tintas");
    $("#ctCodigo").value = ""; $("#ctNombre").value = "";
    toast("Tinta agregada", "exito");
    cargarCatalogos();
  } catch (e) { toast("Error: " + e.message, "error"); }
};

$("#btnCrearProducto").onclick = async () => {
  const codigo = $("#cpCodigo").value.trim();
  const nombre = $("#cpNombre").value.trim();
  if (!codigo || !nombre) return toast("Faltan datos", "error");
  try {
    await api("/api/productos", { method: "POST", body: JSON.stringify({
      codigo, nombre, categoria: $("#cpCategoria").value, maquina: Number($("#cpMaquina").value)
    })});
    state.productos = await api("/api/productos");
    $("#cpCodigo").value = ""; $("#cpNombre").value = "";
    toast("Producto agregado", "exito");
    cargarCatalogos();
  } catch (e) { toast("Error: " + e.message, "error"); }
};

// ==================== CONFIG — LOG ====================
async function cargarLog() {
  const params = new URLSearchParams();
  if ($("#logFiltroUsuario").value) params.append("usuario", $("#logFiltroUsuario").value);
  if ($("#logFiltroTabla").value) params.append("tabla", $("#logFiltroTabla").value);
  if ($("#logFiltroAccion").value) params.append("accion", $("#logFiltroAccion").value);
  const items = await api("/api/log?" + params);
  $("#listaLog").innerHTML = items.length
    ? items.slice(0, 200).map(l => `
      <div class="log-fila">
        <span class="fecha">${l.fecha}</span> ·
        <b>${l.usuario}</b> ·
        <span class="accion">${l.accion}</span>
        sobre <b>${l.tabla}</b>${l.registro_id ? "#" + l.registro_id : ""}
      </div>`).join("")
    : "<p class='ayuda'>Sin eventos.</p>";
}
$("#btnFiltrarLog").onclick = cargarLog;
$("#btnExportarLogCSV").onclick = async () => {
  const params = new URLSearchParams();
  if ($("#logFiltroUsuario").value) params.append("usuario", $("#logFiltroUsuario").value);
  if ($("#logFiltroTabla").value) params.append("tabla", $("#logFiltroTabla").value);
  if ($("#logFiltroAccion").value) params.append("accion", $("#logFiltroAccion").value);
  const items = await api("/api/log?" + params);
  const filas = [["Fecha","Usuario","Acción","Tabla","ID","Detalle"]];
  items.forEach(l => filas.push([l.fecha, l.usuario, l.accion, l.tabla, l.registro_id, l.detalle]));
  descargarCSV("log_" + new Date().toISOString().slice(0,10) + ".csv", filas);
  toast("Log exportado", "exito");
};

// ==================== CONFIG — ZONA PELIGROSA ====================
$$("[data-peligro]").forEach(btn => {
  btn.onclick = async () => {
    const que = btn.dataset.peligro;
    const palabra = btn.dataset.confirm;
    const ok = await confirmar("⚠️ Acción destructiva",
      `<p>Esta acción <b>NO se puede deshacer</b>.</p><p>¿Borrar <b>${que}</b>?</p>`, palabra);
    if (!ok) return;
    await api("/api/peligro/borrar-todo", { method: "POST", body: JSON.stringify({ que }) });
    toast("Acción completada", "exito");
    await cargarTodo();
  };
});

function cargarConfig() {
  cargarConfigEnForms();
  cargarUsuarios();
}

// ==================== SELECTS ====================
function llenarSelects() {
  const f = $("#filtroCliente");
  const cli = state.clientes.map(c => `<option value="${c.id}">${c.nombre}</option>`).join("");
  f.innerHTML = '<option value="">— Todos los clientes —</option>' + cli;
  $("#histCliente").innerHTML = '<option value="">— Todos —</option>' + cli;
  const prod = state.productos.map(p => `<option value="${p.nombre}">${p.nombre}</option>`).join("");
  $("#filtroProducto").innerHTML = '<option value="">— Todos los productos —</option>' + prod;
  $("#histProducto").innerHTML = '<option value="">— Todos —</option>' + prod;
}

// ==================== RESPALDOS AUTOMÁTICOS ====================
async function cargarRespaldos() {
  $("#cfgBackupHoras").value = state.config.pref_backup_horas || 6;
  $("#cfgBackupDrive").value = state.config.pref_backup_drive || "";

  try {
    const r = await api("/api/respaldos");
    const cont = $("#listaRespaldos");
    if (!r.items.length) {
      cont.innerHTML = "<p class='ayuda'>Aún no hay respaldos.</p>";
      return;
    }
    cont.innerHTML = r.items.map(item => {
      const fecha = new Date(item.fecha).toLocaleString();
      const kb = (item.bytes / 1024).toFixed(1);
      return `<div class="log-fila" style="display:flex;justify-content:space-between;align-items:center;gap:10px">
        <div>
          <b>${item.archivo}</b>
          <div class="ayuda">${fecha} · ${kb} KB</div>
        </div>
        <div style="display:flex;gap:6px">
          <button class="secundario" onclick="descargarRespaldo('${item.archivo}')">⬇</button>
          ${state.sesion.rol === "admin" ? `<button class="peligro" onclick="borrarRespaldo('${item.archivo}')">🗑</button>` : ""}
        </div>
      </div>`;
    }).join("");
  } catch (e) {
    $("#listaRespaldos").innerHTML = "<p class='ayuda'>Error: " + e.message + "</p>";
  }
}

window.descargarRespaldo = (archivo) => {
  window.location.href = "/api/respaldos/descargar/" + encodeURIComponent(archivo);
};

window.borrarRespaldo = async (archivo) => {
  const ok = await confirmar("Borrar respaldo", `<p>¿Eliminar el archivo <b>${archivo}</b>?</p>`);
  if (!ok) return;
  await api("/api/respaldos/" + encodeURIComponent(archivo), { method: "DELETE" });
  toast("Respaldo borrado", "exito");
  cargarRespaldos();
};

$("#btnGuardarBackupCfg").onclick = async () => {
  const horas = Number($("#cfgBackupHoras").value) || 6;
  const drive = $("#cfgBackupDrive").value.trim();
  try {
    await api("/api/config/pref_backup_horas", { method: "PUT", body: JSON.stringify({ valor: horas }) });
    await api("/api/config/pref_backup_drive", { method: "PUT", body: JSON.stringify({ valor: drive }) });
    state.config = await api("/api/config");
    toast("Configuración guardada. Reinicia el servidor para aplicar la nueva programación.", "aviso");
  } catch (e) {
    toast("Error: " + e.message, "error");
  }
};

$("#btnBackupAhora").onclick = async () => {
  try {
    const r = await api("/api/respaldos/ahora", { method: "POST", body: JSON.stringify({}) });
    if (r.ok) {
      toast(r.drive ? "Respaldo creado (local + Drive)" : "Respaldo creado (local)", "exito");
      cargarRespaldos();
    } else {
      toast("Error: " + r.error, "error");
    }
  } catch (e) {
    toast("Error: " + e.message, "error");
  }
};

// ==================== FEEDBACK DE CANTIDAD ====================
function actualizarFeedback(inputId, feedbackId, maquina) {
  const input = $("#" + inputId);
  const fb = $("#" + feedbackId);
  if (!input || !fb) return;

  input.addEventListener("input", () => {
    const val = input.value.trim();
    if (!val) {
      fb.textContent = "";
      fb.className = "feedback-cantidad";
      input.classList.remove("input-valido", "input-invalido");
      return;
    }
    const r = validarYNormalizarCantidad(val, maquina);
    if (r.valido) {
      if (r.normalizado !== val.replace(/\s+/g, " ").trim()) {
        fb.textContent = "✅ Se guardará como: " + r.normalizado;
        fb.className = "feedback-cantidad valido";
      } else {
        fb.textContent = "✅ Formato correcto";
        fb.className = "feedback-cantidad valido";
      }
      input.classList.add("input-valido");
      input.classList.remove("input-invalido");
    } else {
      fb.textContent = "❌ " + r.error;
      fb.className = "feedback-cantidad invalido";
      input.classList.add("input-invalido");
      input.classList.remove("input-valido");
    }
  });

  input.addEventListener("blur", () => {
    const val = input.value.trim();
    if (!val) return;
    const r = validarYNormalizarCantidad(val, maquina);
    if (r.valido) input.value = r.normalizado;
  });
}

// Aplicar al input del mezclador
setTimeout(() => {
  actualizarFeedback("mezcCantidad", "mezcFeedback", 32);
}, 100);

// ==================== ARRANQUE ====================
verificarAcceso();