const $  = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[ch]);
}

function leerSesionGuardada() {
  try {
    const guardada = JSON.parse(localStorage.getItem("relma_sesion") || "null");
    return guardada && typeof guardada === "object" && typeof guardada.usuario === "string"
      ? guardada : null;
  } catch (error) {
    try { localStorage.removeItem("relma_sesion"); } catch (_) {}
    return null;
  }
}

function obtenerLogoSeguro(valor) {
  const src = String(valor || "").trim();
  if (/^data:image\/(?:png|jpe?g|gif|webp|svg\+xml);base64,/i.test(src)) return src;
  if (/^https?:\/\//i.test(src)) return src;
  if (/^(?:\/(?!\/)|\.{1,2}\/)[^\s]*$/i.test(src)) return src;
  return "";
}

const state = {
  clientes: [], tintas: [], productos: [], formulas: [],
  sesion: leerSesionGuardada(),
  config: {},
};
let sesionActual = null;
let formulaDetalleActual = null;
let archivoRestoreTemp = null;
let modalRetorno = null;
let clientesTagsSeleccionados = [];

let toastTimer = null;
function toast(msg, tipo) {
  const t = $("#toast");
  if (!t) return;
  t.textContent = String(msg ?? "");
  t.className = "toast " + (tipo || "");
  t.setAttribute("role", tipo === "error" ? "alert" : "status");
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("oculto"), 3200);
}

async function api(url, opts = {}) {
  const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
  if (state.sesion) {
    headers["x-usuario"] = state.sesion.usuario;
    headers["x-rol"] = state.sesion.rol;
  }

  let r;
  try {
    r = await fetch(url, { ...opts, headers });
  } catch (error) {
    throw new Error("No se pudo conectar con el servidor. Revisa la conexión e inténtalo de nuevo.");
  }

  const texto = await r.text().catch(() => "");
  let datos = null;
  if (texto) {
    try { datos = JSON.parse(texto); }
    catch (_) { datos = null; }
  }
  if (!r.ok) {
    const mensaje = datos && typeof datos.error === "string" ? datos.error : `Error HTTP ${r.status}`;
    throw new Error(mensaje);
  }
  if (texto && datos === null) {
    throw new Error("El servidor respondió con un formato inesperado.");
  }
  return datos;
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

const DENOMINADORES_VALIDOS = [32, 64, 128, 256, 512];

function validarYNormalizarCantidad(texto, maquina, exacto = false) {
  if (!texto || texto.trim() === "") return { valido: false, error: "Escribe una cantidad" };
  const str = String(texto).trim().toLowerCase().replace(/,/g, ".");
  const partes = str.split("+").map(p => p.trim()).filter(p => p !== "");
  if (!partes.length) return { valido: false, error: "Formato vacío" };

  let total128 = 0;
  for (const parte of partes) {
    let m;
    m = parte.match(/^(\d+(?:\.\d+)?)\s*ml$/);
    if (m) { total128 += (parseFloat(m[1]) / (964/32)) * 128; continue; }
    m = parte.match(/^(\d+(?:\.\d+)?)\s*(hoz|h|onzas?|oz)$/);
    if (m) { total128 += parseFloat(m[1]) * 128; continue; }
    m = parte.match(/^(\d+)\s*\/\s*(\d+)$/);
    if (m) {
      const num = parseInt(m[1]); const den = parseInt(m[2]);
      if (den === 0) return { valido: false, error: "Denominador no puede ser 0" };
      if (!DENOMINADORES_VALIDOS.includes(den)) return { valido: false, error: `Denominador ${den} no válido.` };
      total128 += (num / den) * 128; continue;
    }
    m = parte.match(/^(\d+(?:\.\d+)?)$/);
    if (m) { total128 += parseFloat(m[1]) * 128; continue; }
    return { valido: false, error: `No entiendo "${parte}"` };
  }

  // ✨ LA MAGIA: Devolvemos el texto EXACTAMENTE como lo escribió el usuario
  let normalizado = texto.replace(/\s+/g, " ").trim();
  // Si solo escribió una fracción suelta (ej. "8/64"), le ponemos el "0 HOZ + " al principio
  if (/^\d+(?:\.\d+)?(?:\/\d+)?$/.test(normalizado)) {
    normalizado = "0 HOZ + " + normalizado;
  }

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

function formatearOZExacto(total128) {
  const total512 = Math.round(total128 * 4);
  const onzasOut = Math.floor(total512 / 512);
  let rem = total512 % 512;

  // Priorizamos los 64avos primero
  const r64 = Math.floor(rem / 8); rem = rem % 8;
  const r128 = Math.floor(rem / 4); rem = rem % 4;
  const r256 = Math.floor(rem / 2); rem = rem % 2;
  const r512 = rem;

  let t = onzasOut + " HOZ";
  if (r64 > 0) t += " + " + r64 + "/64";
  if (r128 > 0) t += " + " + r128 + "/128";
  if (r256 > 0) t += " + " + r256 + "/256";
  if (r512 > 0) t += " + " + r512 + "/512";
  return t;
}

function formatearOZConMaquina(total128, maquina, exacto = false) {
  if (exacto) return formatearOZExacto(total128);

  const onzasOut = Math.floor(total128 / 128);
  const resto128 = Math.round((total128 - onzasOut * 128) * 1000) / 1000;

  // ✨ LÓGICA PARA MÁQUINA DE 64 (Respeta los 64avos)
  if (maquina === 64) {
    const r64 = Math.floor(resto128 / 2);
    const residuo = (resto128 / 2) - r64;
    const f128 = residuo >= 0.5 ? 1 : 0;
    
    let t = onzasOut + " HOZ";
    if (r64 > 0) t += " + " + r64 + "/64";
    if (f128 > 0) t += " + " + f128 + "/128";
    return t;
  }

  // Lógica para Máquina de 32 (La que ya teníamos)
  const r64 = resto128 / 2, r64f = Math.floor(r64), rd64 = r64 - r64f;
  const r32 = r64f / 2, r32f = Math.floor(r32), rd32 = r32 - r32f;
  const f64 = rd32 >= 0.5 ? 1 : 0, f128 = rd64 >= 0.5 ? 1 : 0;
  
  let t = onzasOut + " HOZ";
  if (r32f > 0) t += " + " + r32f + "/32";
  if (f64 > 0)  t += " + " + f64 + "/64";
  if (f128 > 0) t += " + " + f128 + "/128";
  return t;
}

function formatearML(total128) {
  const ml = (total128 / 128) * (964/32);
  if (ml < 1)  return ml.toFixed(2) + " ML";
  if (ml < 10) return ml.toFixed(1) + " ML";
  return Math.round(ml) + " ML";
}

function csvEscape(v) {
  if (v === null || v === undefined) return "";
  let valor = String(v);
  if (/^[\s]*[=+@]/.test(valor) || /^[\s]*-[A-Za-z]/.test(valor)) valor = "'" + valor;
  const s = valor.replace(/"/g, '""');
  return /[",;\n\r]/.test(s) ? '"' + s + '"' : s;
}

function descargarCSV(nombreArchivo, filas) {
  const csv = filas.map(f => f.map(csvEscape).join(",")).join("\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = nombreArchivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

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
  const nombre = cfg.empresa_nombre || "RELMA";
  const logo = obtenerLogoSeguro(cfg.empresa_logo);
  if (logo) {
    $("#headerLogo").innerHTML = `<img src="${escapeHTML(logo)}" alt="" style="height:32px;vertical-align:middle"> ${escapeHTML(nombre)}`;
    $("#loginLogo").innerHTML = `<img src="${escapeHTML(logo)}" alt="Logo de ${escapeHTML(nombre)}" style="height:60px;max-width:100%;object-fit:contain">`;
  } else {
    $("#headerLogo").textContent = "🎨 " + nombre;
    $("#loginLogo").textContent = "🎨 " + nombre;
  }
  document.title = nombre + " — Sistema de Fórmulas";
}

let timeoutBusqueda;
let secuenciaBusqueda = 0;
$("#buscarGlobal").oninput = (e) => {
  clearTimeout(timeoutBusqueda);
  const q = e.target.value.trim();
  const secuencia = ++secuenciaBusqueda;
  if (q.length < 2) return $("#resultadosGlobal").classList.add("oculto");
  timeoutBusqueda = setTimeout(async () => {
    const cont = $("#resultadosGlobal");
    try {
      const r = await api("/api/buscar?q=" + encodeURIComponent(q));
      if (secuencia !== secuenciaBusqueda || q !== $("#buscarGlobal").value.trim()) return;
      let html = "";
      if ((r.clientes || []).length) {
        html += '<div class="grupo">Clientes</div>';
        r.clientes.forEach(c => html += `<div class="item" data-tipo="cliente" data-id="${escapeHTML(c.id)}">👥 ${escapeHTML(c.nombre)}</div>`);
      }
      if ((r.formulas || []).length) {
        html += '<div class="grupo">Fórmulas</div>';
        r.formulas.forEach(f => {
          const detalles = [f.cliente_nombre, f.producto || 'Sin producto', f.base || 'Sin base',
            f.capacidad_madre ? f.capacidad_madre + ' LT' : ''].filter(Boolean).map(escapeHTML).join(' · ');
          html += `<div class="item" data-tipo="formula" data-id="${escapeHTML(f.id)}" style="display:flex; flex-direction:column; align-items:flex-start; padding:8px; border-bottom:1px solid var(--borde);">
            <div style="font-weight:bold;">🧪 ${escapeHTML(f.color)}</div>
            <div style="font-size:0.75rem; color:var(--txt-suave); margin-top:2px;">${detalles}</div>
          </div>`;
        });
      }
      if ((r.productos || []).length) {
        html += '<div class="grupo">Productos</div>';
        r.productos.forEach(p => html += `<div class="item">📦 ${escapeHTML(p.nombre)} <small>${escapeHTML(p.categoria)}</small></div>`);
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
    } catch (error) {
      if (secuencia !== secuenciaBusqueda) return;
      cont.textContent = "No se pudo realizar la búsqueda. " + error.message;
      cont.classList.remove("oculto");
    }
  }, 250);
};
document.addEventListener("click", e => {
  if (!e.target.closest(".buscador-global")) $("#resultadosGlobal").classList.add("oculto");
});

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

  if (modalRetorno.modal === "modalNuevaSesion") {
    $("#nsCliente").innerHTML = state.clientes.map(c => `<option value="${escapeHTML(c.id)}">${escapeHTML(c.nombre)}</option>`).join("");
    $("#nsProducto").innerHTML = '<option value="">— Selecciona —</option>' +
      state.productos.map(p => `<option value="${escapeHTML(p.nombre)}">${escapeHTML(p.nombre)} (${escapeHTML(p.categoria)})</option>`).join("");
  }
  if (modalRetorno.modal === "modalFormula") {
    $("#nfClienteSelect").innerHTML = state.clientes.map(c => `<option value="${escapeHTML(c.id)}">${escapeHTML(c.nombre)}</option>`).join("");
    $("#nfProducto").innerHTML = '<option value="">— Selecciona —</option>' +
      state.productos.map(p => `<option value="${escapeHTML(p.nombre)}">${escapeHTML(p.nombre)} (${escapeHTML(p.categoria)})</option>`).join("");
  }

  restaurarCamposModal(modalRetorno.campos);

  if (valorCreado && campoSeleccionar) {
    const el = $("#" + campoSeleccionar);
    if (el) el.value = valorCreado;
  }
  modalRetorno = null;
}

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
      <h3>${escapeHTML(c.nombre)}</h3>
      <div class="sub">${escapeHTML(c.contacto || "")}</div>
      <div class="sub">${escapeHTML(c.telefono || "")}</div>
      <div class="badge ${c.activo ? "" : "inactivo"}">${escapeHTML(c.num_formulas)} fórmula(s)</div>
      <div class="sub" style="font-size:0.75rem;margin-top:6px">📅 ${escapeHTML(formatearFecha(c.fecha_creacion))}</div>`;
    div.onclick = (e) => { if (!e.target.closest("button")) verCliente(c); };
    div.querySelector(".editar").onclick = (e) => { e.stopPropagation(); abrirCliente(c); };
    div.querySelector(".borrar").onclick = async (e) => {
      e.stopPropagation();
      const ok = await confirmar("Eliminar cliente",
        `<p>¿Eliminar <b>${escapeHTML(c.nombre)}</b>?</p><p>Se borrarán también sus ${escapeHTML(c.num_formulas)} fórmula(s) e historial.</p>`);
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

function abrirTintaNueva(modalPadre, dropdownPadre) {
  abrirModalConRetorno("modalTinta", modalPadre, dropdownPadre);
  ["ntCodigo","ntNombre"].forEach(id => $("#"+id).value = "");
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

      if (padre === "modalFormula") {
        agregarFilaTinta(nombre, "");
      }
    } else {
      $("#modalTinta").classList.add("oculto");
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

function pintarFormulas() {
  const q = ($("#buscarFormula").value || "").toUpperCase();
  const clienteId = $("#filtroCliente").value;
  const producto = $("#filtroProducto").value;
  const soloFav = $("#soloFavoritos").checked;
  const cont = $("#listaFormulas");
  cont.innerHTML = "";
  
  const cliFiltro = clienteId ? state.clientes.find(c => c.id == clienteId) : null;
  const nombreFiltro = cliFiltro ? cliFiltro.nombre : "";

  const lista = state.formulas.filter(f =>
    (!clienteId || (f.cliente_nombre && f.cliente_nombre.includes(nombreFiltro))) &&
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
      <h3>${escapeHTML(f.color)}</h3>
      <div class="sub">${escapeHTML(f.cliente_nombre)}</div>
      <div class="sub">${escapeHTML(f.producto || "")} · ${escapeHTML(f.base || "")}</div>
      <div class="badge">${escapeHTML(f.capacidad_madre)} LT · ${f.maquina === 64 ? "Arq." : "Ind."}</div>
      <div class="sub" style="font-size:0.75rem;margin-top:6px">📅 ${escapeHTML(formatearFecha(f.fecha_creacion))}</div>`;
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
      const ok = await confirmar("Eliminar fórmula", `<p>¿Eliminar <b>${escapeHTML(f.color)}</b> de ${escapeHTML(f.cliente_nombre)}?</p>`);
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
  $("#frmId").value = (f && f.id) ? f.id : "";
  
  $("#nfClienteSelect").innerHTML = state.clientes.map(c => `<option value="${c.id}">${escapeHTML(c.nombre)}</option>`).join("");
  
  if (f && f.id) {
    const idsAGuardar = f.clientes_ids ? String(f.clientes_ids).split(',') : [String(f.cliente_id)];
    clientesTagsSeleccionados = idsAGuardar.map(Number);
  } else {
    const cliFiltro = $("#filtroCliente").value;
    clientesTagsSeleccionados = cliFiltro ? [Number(cliFiltro)] : [];
  }
  
  actualizarTagsClientes();

  $("#nfProducto").innerHTML = '<option value="">— Selecciona —</option>' +
    state.productos.map(p => `<option value="${escapeHTML(p.nombre)}">${escapeHTML(p.nombre)} (${escapeHTML(p.categoria)})</option>`).join("");
    
  $("#nfColor").value = f ? f.color : "";
  $("#nfCodigo").value = f ? f.codigo || "" : "";
  $("#nfBase").value = f ? f.base || "" : "";
  $("#nfCapacidad").value = f ? f.capacidad_madre : 1;
  $("#nfMaquina").value = f ? f.maquina : 32;
  $("#nfNotas").value = f ? f.notas || "" : "";
  
  if (f) {
    $("#nfProducto").value = f.producto || "";
  } else {
    const prodFiltro = $("#filtroProducto").value;
    if (prodFiltro) $("#nfProducto").value = prodFiltro;
  }
  
  $("#nfTintas").innerHTML = "";
  if (f && f.tintas && f.tintas.length) {
    f.tintas.forEach(t => agregarFilaTinta(t.tinta, t.cantidad_texto));
  } else {
    agregarFilaTinta();
  }
  
  $("#modalFormula").classList.remove("oculto");
}

function actualizarTagsClientes() {
  $("#nfClientesTags").innerHTML = clientesTagsSeleccionados.map(id => {
    const c = state.clientes.find(x => x.id === id);
    if (!c) return "";
    return `
      <span style="background: #0ea5e9; color: white; padding: 6px 12px; border-radius: 20px; font-size: 0.85rem; display: inline-flex; align-items: center; gap: 8px; font-weight: 600;">
        ${escapeHTML(c.nombre)} 
        <button type="button" onclick="quitarClienteTag(${id})" style="background:transparent; border:none; color:white; cursor:pointer; font-size: 1.2rem; line-height: 1; padding: 0;">&times;</button>
      </span>`;
  }).join("");
}

window.quitarClienteTag = (id) => {
  clientesTagsSeleccionados = clientesTagsSeleccionados.filter(cid => cid !== id);
  actualizarTagsClientes();
};

document.getElementById("btnAgregarClienteTag").onclick = () => {
  const select = $("#nfClienteSelect");
  const id = Number(select.value);
  if (id && !clientesTagsSeleccionados.includes(id)) {
    clientesTagsSeleccionados.push(id);
    actualizarTagsClientes();
  }
};

function agregarFilaTinta(tinta, cantidad) {
  const maquina = Number($("#nfMaquina").value);
  const tintasFiltradas = state.tintas.filter(t => t.maquina === maquina);
  const cont = $("#nfTintas");
  const div = document.createElement("div");
  div.className = "tinta-fila";
  div.innerHTML = `
    <select class="tinta-select">
      <option value="">— Tinta —</option>
      ${tintasFiltradas.map(t => `<option value="${escapeHTML(t.nombre)}" data-cat="${escapeHTML(t.categoria)}">${escapeHTML(t.nombre)} (${escapeHTML(t.categoria)})</option>`).join("")}
    </select>
      <input type="text" class="tinta-cant" placeholder="Ej: 24 hoz + 10/32 + 15/64" value="${escapeHTML(cantidad || "")}">
    <span class="feedback-tinta"></span>
    <button type="button" class="quitar">✕</button>`;
  if (tinta) div.querySelector(".tinta-select").value = tinta;
  div.querySelector(".quitar").onclick = () => div.remove();
  cont.appendChild(div);

  const input = div.querySelector(".tinta-cant");
  const fb = div.querySelector(".feedback-tinta");

  // Evento 1: Mientras escribes (Feedback en vivo)
  input.addEventListener("input", () => {
    const val = input.value.trim();
    const maq = Number($("#nfMaquina").value);
    if (!val) {
      fb.textContent = ""; fb.className = "feedback-tinta";
      input.classList.remove("input-valido", "input-invalido");
      return;
    }
    
    const esExacto = document.getElementById("nfExacto") ? document.getElementById("nfExacto").checked : false;
    const r = validarYNormalizarCantidad(val, maq, esExacto);
    
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

  // Evento 2: Cuando quitas el cursor del campo (Guardar normalizado)
  input.addEventListener("blur", () => {
    const val = input.value.trim();
    const maq = Number($("#nfMaquina").value);
    if (!val) return;
    
    const esExacto = document.getElementById("nfExacto") ? document.getElementById("nfExacto").checked : false;
    const r = validarYNormalizarCantidad(val, maq, esExacto);
    
    if (r.valido) input.value = r.normalizado;
  });
}

document.addEventListener("change", (e) => {
  if (e.target && e.target.id === "nfMaquina") {
    const maquina = Number(e.target.value);
    const tintasFiltradas = state.tintas.filter(t => t.maquina === maquina);
    $$("#nfTintas .tinta-select").forEach(sel => {
      const valorActual = sel.value;
      sel.innerHTML = '<option value="">— Tinta —</option>' +
        tintasFiltradas.map(t => `<option value="${escapeHTML(t.nombre)}" data-cat="${escapeHTML(t.categoria)}">${escapeHTML(t.nombre)} (${escapeHTML(t.categoria)})</option>`).join("");
      if (tintasFiltradas.find(t => t.nombre === valorActual)) sel.value = valorActual;
    });
    toast("Tintas filtradas por máquina " + maquina, "aviso");
  }
});

$("#nfAddTinta").onclick = () => agregarFilaTinta();
$("#nfNuevaTinta").onclick = () => abrirTintaNueva("modalFormula", null);

$$("#modalFormula .cancelar").forEach(b => b.onclick = () => $("#modalFormula").classList.add("oculto"));
$("#nfNuevoCliente").onclick = () => {
  abrirModalConRetorno("modalCliente", "modalFormula", "nfClienteSelect");
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
  
  if (clientesTagsSeleccionados.length === 0) {
    return toast("Selecciona al menos un cliente", "error");
  }

  const datos = {
    cliente_id: clientesTagsSeleccionados[0] || null, 
    clientes_ids: clientesTagsSeleccionados, 
    color: $("#nfColor").value.trim(),
    codigo: $("#nfCodigo").value.trim(),
    producto: $("#nfProducto").value,
    base: $("#nfBase").value.trim(),
    capacidad_madre: Number($("#nfCapacidad").value),
    maquina: Number($("#nfMaquina").value),
    notas: $("#nfNotas").value.trim(),
    tintas,
  };
  
  if (!datos.color) return toast("Pon el nombre del color", "error");
  
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
  } catch (e) { 
    toast("Error: " + e.message, "error"); 
  }
};

async function verFormula(id) {
  const f = await api("/api/formulas/" + id);
  formulaDetalleActual = f;
  conversionTemporal = null;
  $("#detBtnGuardarConvertida").classList.add("oculto");
  $("#detBtnIgualarConvertida").classList.add("oculto");
  $("#detConvTamano").value = "";
  $("#detTitulo").textContent = f.color + " — " + f.cliente_nombre;
  pintarDetalleFormula();
  $("#modalDetalle").classList.remove("oculto");
}

function formatearFecha(fechaSQL) {
  if (!fechaSQL) return "";
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
    return `<div class="tinta-fila"><div style="flex:1"><b>${escapeHTML(t.tinta)}</b></div><div style="flex:1">${escapeHTML(valor)}</div></div>`;
  }).join("");
  $("#detContenido").innerHTML = `
    <p><b>Cliente(s):</b> ${escapeHTML(f.cliente_nombre)}</p>
    <p><b>Producto:</b> ${escapeHTML(f.producto || "-")}</p>
    <p><b>Base:</b> ${escapeHTML(f.base || "-")}</p>
    <p><b>Capacidad:</b> ${escapeHTML(f.capacidad_madre)} LT · <b>Máquina:</b> ${f.maquina === 64 ? "Arquitectónica" : "Industrial"}</p>
    ${f.codigo ? `<p><b>Código:</b> ${escapeHTML(f.codigo)}</p>` : ""}
    <p style="color:var(--txt-suave);font-size:0.85rem;margin-top:6px">
      📅 Creada: ${escapeHTML(formatearFecha(f.fecha_creacion))}
      ${f.ultima_actualizacion && f.ultima_actualizacion !== f.fecha_creacion
        ? ` · ✏️ Editada: ${escapeHTML(formatearFecha(f.ultima_actualizacion))}` : ""}
    </p>
    <h4 style="margin-top:10px">Tintas:</h4>${tintas}
    ${f.notas ? `<p style="margin-top:10px"><b>Notas:</b> ${escapeHTML(f.notas)}</p>` : ""}`;
  $("#detConvSalida").textContent = "";
  cargarHistorialFormula(f.id);
}

async function cargarHistorialFormula(formulaId) {
  try {
    const items = await api("/api/preparaciones/formula/" + formulaId);
    $("#detHistorial").innerHTML = items.length
      ? items.map(i => `<div class="log-fila"><span class="fecha">${escapeHTML(i.fecha)}</span> · <b>${escapeHTML(i.estado)}</b> · ${escapeHTML(i.preparo || "-")}</div>`).join("")
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
  $("#nfClienteSelect").innerHTML = state.clientes.map(c => `<option value="${escapeHTML(c.id)}">${escapeHTML(c.nombre)}</option>`).join("");
  $("#nfProducto").innerHTML = '<option value="">— Selecciona —</option>' +
    state.productos.map(p => `<option value="${escapeHTML(p.nombre)}">${escapeHTML(p.nombre)} (${escapeHTML(p.categoria)})</option>`).join("");
  
  clientesTagsSeleccionados = f.clientes_ids ? String(f.clientes_ids).split(',').map(Number) : [f.cliente_id];
  actualizarTagsClientes();
  
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

function abrirPreparar(f) {
  const tintas = f.tintas.map(t => {
    const total128 = parsearCantidad(t.cantidad_texto);
    const ml = total128 !== null ? formatearML(total128) : "";
    return `<div class="preparar-tinta">
      <div class="nombre">${escapeHTML(t.tinta)}</div>
      <div class="cantidad">${escapeHTML(t.cantidad_texto)}</div>
      ${ml ? `<div style="color:var(--txt-suave);margin-top:4px">${ml}</div>` : ""}
    </div>`;
  }).join("");
  $("#prepararContenido").innerHTML = `
    <h1>${escapeHTML(f.color)}</h1>
    <div class="info">${escapeHTML(f.cliente_nombre)} · ${escapeHTML(f.producto || "")} · Base: ${escapeHTML(f.base || "-")} · <b>${escapeHTML(f.capacidad_madre)} LT</b></div>
    ${tintas}`;
  $("#modalPreparar").classList.remove("oculto");
}
$("#prepCerrar").onclick = () => $("#modalPreparar").classList.add("oculto");

$("#prepImprimir").onclick = () => {
  if (!formulaDetalleActual) return;
  const f = formulaDetalleActual;
  const tintas = f.tintas.map(t => `<tr><td style="padding:8px;border-bottom:1px solid #ddd">${escapeHTML(t.tinta)}</td><td style="padding:8px;border-bottom:1px solid #ddd;font-weight:bold">${escapeHTML(t.cantidad_texto)}</td></tr>`).join("");
  const win = window.open("", "_blank");
  win.document.write(`<html><head><title>${escapeHTML(f.color)}</title>
    <style>body{font-family:Arial;padding:20px}h1{color:#0284c7}table{width:100%;border-collapse:collapse;margin-top:16px}th{background:#0284c7;color:white;padding:10px;text-align:left}</style></head>
    <body><h1>${escapeHTML(state.config.empresa_nombre || "RELMA")}</h1>
    <h2>${escapeHTML(f.color)}</h2>
    <p><b>Cliente:</b> ${escapeHTML(f.cliente_nombre)}<br><b>Producto:</b> ${escapeHTML(f.producto || "-")}<br>
    <b>Base:</b> ${escapeHTML(f.base || "-")}<br><b>Capacidad:</b> ${escapeHTML(f.capacidad_madre)} LT<br>
    <b>Fecha:</b> ${new Date().toLocaleString()}</p>
    <table><tr><th>Tinta</th><th>Cantidad</th></tr>${tintas}</table></body></html>`);
  win.document.close(); win.print();
};

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
    if (opciones.color) html += `<div class="color">${escapeHTML(f.color)}</div>`;
    const metaParts = [];
    if (opciones.cliente && f.cliente_nombre) metaParts.push(f.cliente_nombre);
    if (opciones.producto && f.producto) metaParts.push(f.producto);
    if (opciones.base && f.base) metaParts.push(f.base);
    if (opciones.cantidad && f.capacidad_madre) metaParts.push(f.capacidad_madre + " LT");
    if (opciones.codigo && f.codigo) metaParts.push(f.codigo);
    if (metaParts.length) html += `<div class="meta">${metaParts.map(escapeHTML).join(" · ")}</div>`;
    html += '</div>';
  }

  if (hayTintas) {
    html += '<div class="tintas">';
    for (const t of f.tintas) {
      html += `<div class="tinta-fila">
        <div class="tinta-nombre">${escapeHTML(t.tinta)}</div>
        <div class="tinta-cantidad">${escapeHTML(t.cantidad_texto)}</div>
      </div>`;
    }
    html += '</div>';
  } else {
    html += '<div class="tintas-vacio"></div>';
  }

  const footerParts = [];
  if (opciones.empresa) footerParts.push(escapeHTML(state.config.empresa_nombre || "RELMA"));
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

async function cargarFormulasConversor() {
  const sel = $("#convCargarFormula");
  sel.innerHTML = '<option value="">— Ninguna —</option>' +
    state.formulas.map(f => `<option value="${escapeHTML(f.id)}">${escapeHTML(f.cliente_nombre)} → ${escapeHTML(f.color)}</option>`).join("");
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
  
  // LEEMOS EL CHECKBOX DEL CONVERSOR AQUÍ
  const esExacto = document.getElementById("convExacto") ? document.getElementById("convExacto").checked : false;

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
    
    // LE PASAMOS EL DATO "esExacto" A LA FUNCIÓN
    out.push(tinta + " = " + formatearOZConMaquina(conv, maquina, esExacto) +
             (mostrarML ? "   (" + formatearML(conv) + ")" : ""));
  }
  $("#salidaConv").textContent = out.join("\n") || "(vacío)";
}
["capOrigen","capDestino","capOrigenCustom","capDestinoCustom","maquinaConv","convMostrarML","entradaConv","convExacto"].forEach(id => {
  const el = $("#" + id);
  if (el) {
    el.addEventListener("input", ejecutarConversion);
    el.addEventListener("change", ejecutarConversion);
  }
});

$("#btnCopiarConv").onclick = async () => {
  const texto = $("#salidaConv").textContent || "";
  try {
    if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error("El navegador no permite copiar automáticamente.");
    await navigator.clipboard.writeText(texto);
    toast("Copiado al portapapeles", "exito");
  } catch (error) {
    toast(error.message || "No se pudo copiar el resultado", "error");
  }
};

["capOrigen", "capDestino"].forEach(id => {
  $("#" + id).addEventListener("change", () => {
    const inp = $("#" + id + "Custom");
    if ($("#" + id).value === "custom") inp.classList.remove("oculto");
    else inp.classList.add("oculto");
  });
});

async function pintarHistorial(filtros) {
  const params = new URLSearchParams();
  if (filtros) Object.entries(filtros).forEach(([k, v]) => { if (v) params.append(k, v); });
  const items = await api("/api/preparaciones?" + params);
  const cont = $("#listaHistorial");
  if (!items.length) { cont.innerHTML = "<p class='ayuda'>Sin resultados.</p>"; return; }
  cont.innerHTML = items.map(i => `
    <div class="item">
      <div>
        <div class="fecha">${escapeHTML(i.fecha)}</div>
        <b>${escapeHTML(i.color || "—")}</b> · ${escapeHTML(i.cliente_nombre || "—")}
        <div class="ayuda">${escapeHTML(i.producto || "")} · preparó: ${escapeHTML(i.preparo || "-")}</div>
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <span class="estado-badge ${escapeHTML((i.estado || "EN PROCESO").replace(" ", "-"))}">${escapeHTML(i.estado || "EN PROCESO")}</span>
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

async function cargarSesiones() {
  try {
    const items = await api("/api/mezclador/sesiones");
    const cont = $("#mezcSesiones");
    cont.innerHTML = items.length
      ? items.map(s => `
        <div class="sesion-card" data-id="${s.id}">
          <h4>${escapeHTML(s.muestra_nombre || "Sin nombre")}${s.muestra_codigo ? " · " + escapeHTML(s.muestra_codigo) : ""}</h4>
          <div class="sub">${escapeHTML(s.cliente_nombre || "-")}</div>
          <div class="sub">${escapeHTML(s.producto || "")} · ${escapeHTML(s.base || "")}</div>
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
      .map(t => `<option value="${escapeHTML(t.nombre)}" data-cat="${escapeHTML(t.categoria)}">${escapeHTML(t.nombre)} (${escapeHTML(t.categoria)})</option>`).join("");
}

function pintarHistorialMezclador(ajustes) {
  const cont = $("#mezcHistorial");
  if (!ajustes.length) return cont.innerHTML = "<p class='ayuda'>Sin ajustes aún.</p>";
  cont.innerHTML = ajustes.map(a => {
    const hora = (a.fecha || "").split(" ")[1] || "";
    return `<div class="ajuste-fila">
      <span class="hora">${escapeHTML(hora)}</span>
      <span class="tinta">${escapeHTML(a.tinta)}</span>
      <span class="cantidad">+ ${escapeHTML(a.cantidad_texto)}</span>
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
    return `<div class="total-fila"><span class="tinta">${escapeHTML(tinta)}</span><span class="valor">${escapeHTML(v)}</span></div>`;
  }).join("");
}

$("#btnNuevaSesion").onclick = () => {
  $("#nsCliente").innerHTML = state.clientes.map(c => `<option value="${escapeHTML(c.id)}">${escapeHTML(c.nombre)}</option>`).join("");
  $("#nsProducto").innerHTML = '<option value="">— Selecciona —</option>' +
    state.productos.map(p => `<option value="${escapeHTML(p.nombre)}">${escapeHTML(p.nombre)} (${escapeHTML(p.categoria)})</option>`).join("");
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
    cantidad_texto: r.normalizado,
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

$("#btnBackupDB").onclick = async () => {
  try {
    toast("Descargando base de datos...", "aviso");
    const r = await fetch("/api/backup/db", {
      method: "GET",
      headers: {
        "x-usuario": state.sesion.usuario, 
        "x-rol": state.sesion.rol
      }
    });
    
    if (!r.ok) throw new Error("Error al descargar la base de datos");
    
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "relma_db_" + new Date().toISOString().slice(0,10) + ".db";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    
    toast("Base de datos descargada", "exito");
  } catch (e) {
    toast("Error: " + e.message, "error");
  }
};

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
    const texto = await file.text();
    const json = JSON.parse(texto);
    archivoRestoreTemp = json;
    
    // Pedir vista previa al servidor
    const preview = await api("/api/restore/preview", { method: "POST", body: JSON.stringify({ data: json.data }) });
    
    const resumen = Object.entries(preview.resumen || {})
      .filter(([k, v]) => Number(v) > 0)
      .map(([k, v]) => `<div>• <b>${escapeHTML(k)}</b>: ${escapeHTML(v)} fila(s)</div>`).join("");
      
    $("#restoreResumen").innerHTML = resumen || "<p>El archivo no contiene datos válidos.</p>";
    
    // Mostrar el cuadro con el botón de restaurar
    $("#restorePreview").style.display = "block";
    toast("Archivo leído correctamente", "exito");
    
  } catch (err) {
    toast("Archivo inválido: " + err.message, "error");
    $("#restorePreview").style.display = "none";
  }
};

// Función para cancelar
$("#btnCancelarRestore").onclick = () => {
  $("#restorePreview").style.display = "none";
  $("#inputRestore").value = "";
  archivoRestoreTemp = null;
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

async function cargarUsuarios() {
  const lista = await api("/api/usuarios");
  const cont = $("#listaUsuarios");
  cont.innerHTML = lista.map(u => `
    <div class="usuario-fila ${u.activo ? "" : "inactivo"}">
      <div>
        <b>${escapeHTML(u.usuario)}</b> <span class="rol ${escapeHTML(u.rol)}">${escapeHTML(u.rol)}</span>
        ${u.nombre ? `<div class="ayuda">${escapeHTML(u.nombre)}</div>` : ""}
      </div>
      <div class="acciones-usuario" style="display:flex;gap:6px;flex-wrap:wrap">
        <button type="button" class="secundario" data-user-accion="pass" data-id="${escapeHTML(u.id)}">🔑 Contraseña</button>
        <button type="button" class="secundario" data-user-accion="activo" data-id="${escapeHTML(u.id)}" data-activo="${u.activo ? 1 : 0}">
          ${u.activo ? "⏸" : "▶️"} ${u.activo ? "Desactivar" : "Activar"}
        </button>
        ${u.usuario !== "admin" ? `<button type="button" class="peligro" data-user-accion="borrar" data-id="${escapeHTML(u.id)}" data-usuario="${escapeHTML(u.usuario)}">🗑</button>` : ""}
      </div>
    </div>`).join("");
  cont.querySelectorAll("[data-user-accion]").forEach(btn => {
    btn.onclick = async () => {
      const id = Number(btn.dataset.id);
      if (btn.dataset.userAccion === "pass") await window.cambiarPass(id);
      if (btn.dataset.userAccion === "activo") await window.toggleActivo(id, Number(btn.dataset.activo));
      if (btn.dataset.userAccion === "borrar") await window.borrarUsuario(id, btn.dataset.usuario);
    };
  });
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
  const ok = await confirmar("Eliminar usuario", `<p>¿Eliminar al usuario <b>${escapeHTML(usuario)}</b>?</p>`);
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

async function cargarCatalogos() {
  const tintas = await api("/api/tintas");
  $("#listaCatTintas").innerHTML = tintas.map(t =>
    `<div class="log-fila"><b>${escapeHTML(t.codigo)}</b> · ${escapeHTML(t.nombre)} <span class="rol">${escapeHTML(t.categoria)}</span> · M${escapeHTML(t.maquina)}</div>`
  ).join("");
  const prods = await api("/api/productos");
  $("#listaCatProductos").innerHTML = prods.map(p =>
    `<div class="log-fila"><b>${escapeHTML(p.codigo)}</b> · ${escapeHTML(p.nombre)} <span class="rol">${escapeHTML(p.categoria)}</span> · M${escapeHTML(p.maquina)}</div>`
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

async function cargarLog() {
  const params = new URLSearchParams();
  if ($("#logFiltroUsuario").value) params.append("usuario", $("#logFiltroUsuario").value);
  if ($("#logFiltroTabla").value) params.append("tabla", $("#logFiltroTabla").value);
  if ($("#logFiltroAccion").value) params.append("accion", $("#logFiltroAccion").value);
  const items = await api("/api/log?" + params);
  $("#listaLog").innerHTML = items.length
    ? items.slice(0, 200).map(l => `
      <div class="log-fila">
        <span class="fecha">${escapeHTML(l.fecha)}</span> ·
        <b>${escapeHTML(l.usuario)}</b> ·
        <span class="accion">${escapeHTML(l.accion)}</span>
        sobre <b>${escapeHTML(l.tabla)}</b>${l.registro_id ? "#" + escapeHTML(l.registro_id) : ""}
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

$$("[data-peligro]").forEach(btn => {
  btn.onclick = async () => {
    const que = btn.dataset.peligro;
    const palabra = btn.dataset.confirm;
    const ok = await confirmar("⚠️ Acción destructiva",
      `<p>Esta acción <b>NO se puede deshacer</b>.</p><p>¿Borrar <b>${escapeHTML(que)}</b>?</p>`, palabra);
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

function llenarSelects() {
  const f = $("#filtroCliente");
  const cli = state.clientes.map(c => `<option value="${escapeHTML(c.id)}">${escapeHTML(c.nombre)}</option>`).join("");
  f.innerHTML = '<option value="">— Todos los clientes —</option>' + cli;
  $("#histCliente").innerHTML = '<option value="">— Todos —</option>' + cli;
  const prod = state.productos.map(p => `<option value="${escapeHTML(p.nombre)}">${escapeHTML(p.nombre)}</option>`).join("");
  $("#filtroProducto").innerHTML = '<option value="">— Todos los productos —</option>' + prod;
  $("#histProducto").innerHTML = '<option value="">— Todos —</option>' + prod;
}

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
          <b>${escapeHTML(item.archivo)}</b>
          <div class="ayuda">${escapeHTML(fecha)} · ${escapeHTML(kb)} KB</div>
        </div>
        <div style="display:flex;gap:6px">
          <button type="button" class="secundario" data-backup-accion="descargar" data-archivo="${escapeHTML(item.archivo)}" aria-label="Descargar respaldo">⬇</button>
          ${state.sesion.rol === "admin" ? `<button type="button" class="peligro" data-backup-accion="borrar" data-archivo="${escapeHTML(item.archivo)}" aria-label="Borrar respaldo">🗑</button>` : ""}
        </div>
      </div>`;
    }).join("");
    cont.querySelectorAll("[data-backup-accion]").forEach(btn => {
      btn.onclick = () => btn.dataset.backupAccion === "descargar"
        ? window.descargarRespaldo(btn.dataset.archivo)
        : window.borrarRespaldo(btn.dataset.archivo);
    });
  } catch (e) {
    $("#listaRespaldos").textContent = "Error al cargar respaldos: " + e.message;
  }
}

window.descargarRespaldo = (archivo) => {
  window.location.href = "/api/respaldos/descargar/" + encodeURIComponent(archivo);
};

window.borrarRespaldo = async (archivo) => {
  const ok = await confirmar("Borrar respaldo", `<p>¿Eliminar el archivo <b>${escapeHTML(archivo)}</b>?</p>`);
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

$("#btnGenerarConsulta").onclick = async () => {
  try {
    toast("Generando consulta móvil...", "aviso");
    const r = await api("/api/exportar-consulta", { method: "POST", body: JSON.stringify({}) });
    if (r.ok) {
      toast(`✅ Consulta generada (${r.tamano_kb} KB)${r.drive ? " · Copiada a Drive" : ""}`, "exito");
    } else {
      toast("Error: " + (r.error || "desconocido"), "error");
    }
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

setTimeout(() => {
  actualizarFeedback("mezcCantidad", "mezcFeedback", 32);
}, 100);

verificarAcceso();

const pickerColor = document.getElementById('color-picker');
const spanHex = document.getElementById('hex-value');
const btnBuscar = document.getElementById('btn-buscar');
const divResultado = document.getElementById('resultado');

let formulasLineaActuales = []; 
let unidadActualLinea = 'GALON'; 

if (pickerColor && spanHex) {
  pickerColor.addEventListener('input', (e) => {
    spanHex.textContent = e.target.value;
  });
}

function hexToRgb(hex) {
  const bigint = parseInt(hex.replace('#', ''), 16);
  return {
    r: (bigint >> 16) & 255,
    g: (bigint >> 8) & 255,
    b: bigint & 255
  };
}

if (btnBuscar) {
  btnBuscar.addEventListener('click', async () => {
    const hex = pickerColor.value;
    const rgb = hexToRgb(hex);
    const tipoPintura = document.getElementById('tipo-pintura').value;

    divResultado.innerHTML = '<p style="padding:20px">🔎 Buscando color similar...</p>';

    try {
      const resBusqueda = await fetch('/api/color/buscar-rgb', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rgb)
      });
      const colorEncontrado = await resBusqueda.json();

      if (!colorEncontrado || !colorEncontrado.codigo) {
        divResultado.innerHTML = '<div class="card-config"><p>❌ No se encontró ningún color similar.</p></div>';
        return;
      }

      const resFormula = await fetch('/api/color/formula', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codigo: colorEncontrado.codigo, tipo_pintura: tipoPintura })
      });
      formulasLineaActuales = await resFormula.json();

      pintarResultadoBusqueda(hex, colorEncontrado, tipoPintura);

    } catch (error) {
      console.error(error);
      divResultado.innerHTML = '<div class="card-config"><p>❌ Error al buscar. Abre F12 para ver el detalle.</p></div>';
    }
  });
}

function pintarResultadoBusqueda(hex, colorEncontrado, tipoPintura) {
  let html = `
    <div class="card-config">
      <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
        <div style="width:70px;height:70px;background:${hex};border-radius:12px;
                    border:3px solid #444;flex-shrink:0;
                    box-shadow:0 0 20px ${hex}88"></div>
        <div style="flex:1">
          <h2 style="margin:0;color:#0ea5e9;font-size:1.6rem">
            ${escapeHTML(colorEncontrado.codigo)} — ${escapeHTML(colorEncontrado.nombre)}
          </h2>
          <p style="margin:6px 0 0 0;color:#94a3b8;font-size:0.9rem">
            ${colorEncontrado.locator ? '📍 ' + escapeHTML(colorEncontrado.locator) + ' · ' : ''}
            RGB: ${escapeHTML(colorEncontrado.rgb_r)}, ${escapeHTML(colorEncontrado.rgb_g)}, ${escapeHTML(colorEncontrado.rgb_b)}
          </p>
        </div>
      </div>
    </div>`;

  if (!formulasLineaActuales || formulasLineaActuales.length === 0) {
    html += `
      <div class="card-config">
        <p style="font-size:1.05rem">⚠️ <b>No hay fórmula cargada</b> para <b>${escapeHTML(colorEncontrado.codigo)}</b> en <b>${escapeHTML(tipoPintura)}</b>.</p>
        <p style="color:#94a3b8;font-size:0.9rem">Prueba con otro tipo de pintura (Base Agua ↔ Base Solvente).</p>
      </div>`;
    divResultado.innerHTML = html;
    return;
  }

  html += `
    <div class="fila-botones" style="margin-top:20px; justify-content:flex-start; gap:10px; flex-wrap:wrap">
      <button class="secundario ${unidadActualLinea === 'LITRO' ? 'activo' : ''}" onclick="cambiarUnidadLinea('LITRO')">🧪 Litro</button>
      <button class="secundario ${unidadActualLinea === 'GALON' ? 'activo' : ''}" onclick="cambiarUnidadLinea('GALON')">🥫 Galón</button>
      <button class="secundario ${unidadActualLinea === 'CUBETA' ? 'activo' : ''}" onclick="cambiarUnidadLinea('CUBETA')">🪣 Cubeta</button>
    </div>`;

  formulasLineaActuales.forEach((f, idx) => {
    let colorantes = [];
    try { colorantes = typeof f.colorantes === 'string' ? JSON.parse(f.colorantes) : f.colorantes; } catch(e) {}
    
    const maquina = (f.marca === 'Maxitoner' || f.proveedor_tinta === 'Maxitoner') ? 32 : 64;

    const tintasHTML = colorantes.map(c => {
      let oz = 0;
      if (unidadActualLinea === 'LITRO') oz = c.oz_litro || 0;
      else if (unidadActualLinea === 'CUBETA') oz = c.oz_cubeta || 0;
      else oz = c.oz_galon || 0;

      const total128 = Math.round(oz * 128);
      const texto = total128 > 0 ? formatearOZConMaquina(total128, maquina) : "—";
      
      return `
        <div class="preparar-tinta">
          <div class="nombre">${escapeHTML((c.tinta || '?').toUpperCase())}</div>
          <div class="cantidad">${escapeHTML(texto)}</div>
        </div>`;
    }).join('');

    html += `
      <div class="card-config" style="margin-top:16px">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:10px;">
          <div>
            <h3 style="margin-top:0;color:#0ea5e9;font-size:1.1rem">
              📋 ${formulasLineaActuales.length > 1 ? 'Fórmula ' + (idx+1) + ' — ' : ''}
              Base <span style="color:#22d3ee">${escapeHTML(f.base_color)}</span>
              ${f.variante && f.variante !== 'general' ? ` <span style="color:#94a3b8;font-size:0.9rem">(${escapeHTML(f.variante)})</span>` : ''}
            </h3>
            <p style="color:#94a3b8;font-size:0.85rem;margin-top:0">
              ${escapeHTML(f.tipo_pintura)} · ${escapeHTML(f.marca)} · Referencia: <b style="color:#22d3ee">1 ${escapeHTML(unidadActualLinea)}</b>
            </p>
          </div>
          <div class="fila-botones" style="margin:0; gap:8px;">
            <button class="secundario" onclick="copiarFormulaLinea(${idx})" style="padding:6px 12px; font-size:0.85rem">📋 Copiar</button>
            <button class="primario" data-accion-linea="base" data-indice="${idx}" data-codigo="${escapeHTML(colorEncontrado.codigo)}" style="padding:6px 12px; font-size:0.85rem">📝 Usar como base</button>
          </div>
        </div>
        <div style="margin-top:14px">
          ${tintasHTML}
        </div>
      </div>`;
  });

  divResultado.innerHTML = html;
  divResultado.querySelectorAll('[data-accion-linea="base"]').forEach(btn => {
    btn.addEventListener("click", () => usarComoBaseLinea(Number(btn.dataset.indice), btn.dataset.codigo));
  });
}

window.cambiarUnidadLinea = (nuevaUnidad) => {
  unidadActualLinea = nuevaUnidad;
  const hex = pickerColor.value;
  const rgb = hexToRgb(hex);
  const codigoAct = formulasLineaActuales.length > 0 ? formulasLineaActuales[0].codigo : '';
  const colorFalso = { codigo: codigoAct, nombre: divResultado.querySelector('h2').textContent.split('—')[1].trim(), rgb_r: rgb.r, rgb_g: rgb.g, rgb_b: rgb.b };
  pintarResultadoBusqueda(hex, colorFalso, document.getElementById('tipo-pintura').value);
};

window.copiarFormulaLinea = (idx) => {
  const f = formulasLineaActuales[idx];
  if (!f) return;
  let colorantes = [];
  try { colorantes = JSON.parse(f.colorantes); } catch(e) {}
  
  const maquina = (f.marca === 'Maxitoner') ? 32 : 64;
  let texto = `Fórmula: ${f.codigo} - ${f.nombre}\nBase: ${f.base_color} (${unidadActualLinea})\n\n`;
  
  colorantes.forEach(c => {
    let oz = unidadActualLinea === 'LITRO' ? c.oz_litro : (unidadActualLinea === 'CUBETA' ? c.oz_cubeta : c.oz_galon);
    const total128 = Math.round((oz || 0) * 128);
    if (total128 > 0) {
      texto += `- ${c.tinta}: ${formatearOZConMaquina(total128, maquina)}\n`;
    }
  });
  
  navigator.clipboard.writeText(texto);
  toast("✅ Fórmula copiada al portapapeles", "exito");
};

window.usarComoBaseLinea = (idx, codigo) => {
  const f = formulasLineaActuales[idx];
  if (!f) return;
  let colorantes = [];
  try { colorantes = JSON.parse(f.colorantes); } catch(e) {}
  
  const maquina = (f.marca === 'Maxitoner') ? 32 : 64;
  const capacidad = unidadActualLinea === 'LITRO' ? 1 : (unidadActualLinea === 'CUBETA' ? 19 : 4);

  const tintasParaModal = [];
  colorantes.forEach(c => {
    let oz = unidadActualLinea === 'LITRO' ? c.oz_litro : (unidadActualLinea === 'CUBETA' ? c.oz_cubeta : c.oz_galon);
    const total128 = Math.round((oz || 0) * 128);
    if (total128 > 0) {
      const nombrePDF = c.tinta.toUpperCase(); 
      const tintaCatalogo = state.tintas.find(t => 
        t.maquina === maquina && (nombrePDF.includes(t.nombre.toUpperCase()) || t.nombre.toUpperCase().includes(nombrePDF.split(' ')[0]))
      );

      tintasParaModal.push({
        tinta: tintaCatalogo ? tintaCatalogo.nombre : c.tinta,
        cantidad_texto: formatearOZConMaquina(total128, maquina)
      });
    }
  });

  tintasParaModal.forEach(t => {
    t.cantidad_texto = t.cantidad_texto.replace(/^0 HOZ \+ /, '');
  });

  const formulaFalsa = {
    color: f.nombre === 'Desconocido' ? '' : f.nombre,
    codigo: f.codigo,
    producto: f.tipo_pintura, 
    base: f.base_color,
    capacidad_madre: capacidad,
    maquina: maquina,
    notas: "Fórmula base tomada de línea comercial",
    tintas: tintasParaModal
  };

  abrirFormula(formulaFalsa);
  toast("📝 Fórmula cargada en el editor. Asigna un cliente y guarda.", "exito");
};

const btnBuscarCodigo = document.getElementById('btn-buscar-codigo');
const inputCodigo = document.getElementById('input-codigo');

if (btnBuscarCodigo) {
  btnBuscarCodigo.addEventListener('click', async () => {
    const codigo = inputCodigo.value.trim().toUpperCase();
    if (!codigo) return toast("Escribe un código primero", "error");

    divResultado.innerHTML = '<p style="padding:20px">🔎 Buscando código...</p>';

    try {
      const res = await fetch('/api/color/formula-codigo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codigo })
      });
      formulasLineaActuales = await res.json();

      if (!formulasLineaActuales || formulasLineaActuales.length === 0) {
        divResultado.innerHTML = `<div class="card-config"><p>❌ No se encontró ninguna fórmula con el código <b>${escapeHTML(codigo)}</b>.</p></div>`;
        return;
      }

      const colorFalso = { 
        codigo: formulasLineaActuales[0].codigo, 
        nombre: formulasLineaActuales[0].nombre,
        rgb_r: 0, rgb_g: 0, rgb_b: 0
      };
      
      pintarResultadoBusqueda('#000000', colorFalso, formulasLineaActuales[0].tipo_pintura);

    } catch (error) {
      console.error(error);
      divResultado.innerHTML = '<div class="card-config"><p>❌ Error al buscar por código.</p></div>';
    }
  });
}

const btnCompararFormula = document.getElementById('btnCompararFormula');
const compEntrada = document.getElementById('compEntrada');
const compResultados = document.getElementById('compResultados');

if (btnCompararFormula) {
  btnCompararFormula.addEventListener('click', async () => {
    const texto = compEntrada.value.trim();
    const tipo = document.getElementById('compTipoPintura').value;
    
    if (!texto) return toast("Escribe algunas tintas primero", "error");

    const lineas = texto.split('\n').filter(l => l.trim());
    const tintas_usuario = [];

    lineas.forEach(ln => {
      const partes = ln.split(/[=:]/);
      if (partes.length >= 2) {
        const tinta = partes[0].trim();
        const cantStr = partes[1].trim();
        
        const total128 = parsearCantidad(cantStr);
        if (total128 !== null) {
          tintas_usuario.push({ tinta, cantidad_en_128: total128 });
        }
      }
    });

    if (tintas_usuario.length === 0) {
      return toast("No se entendió ninguna tinta. Revisa el formato (Tinta = Cantidad).", "error");
    }

    compResultados.innerHTML = '<p>🔎 Calculando similitud matemática...</p>';

    try {
      const res = await fetch('/api/comparar-formulas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tintas_usuario, tipo_pintura: tipo })
      });
      
      const resultados = await res.json();

      if (resultados.length === 0) {
        compResultados.innerHTML = '<div class="card-config"><p>❌ No se encontraron fórmulas parecidas (más del 50%).</p></div>';
        return;
      }

      let html = `<h3>🏆 Los colores más parecidos son:</h3>`;
      
      resultados.forEach(r => {
        let colorBarra = '#ef4444'; 
        if (r.porcentaje_similitud >= 80) colorBarra = '#22c55e';
        else if (r.porcentaje_similitud >= 65) colorBarra = '#eab308';

        const porcentaje = Math.max(0, Math.min(100, Number(r.porcentaje_similitud) || 0));
        html += `
          <div class="card-config" style="margin-bottom:15px">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;gap:10px">
              <h3 style="margin:0; color:#0ea5e9">${escapeHTML(r.codigo)} — ${escapeHTML(r.nombre)}</h3>
              <span style="font-size:1.5rem; font-weight:bold; color:${colorBarra}">
                ${porcentaje}%
              </span>
            </div>
            <div style="width:100%; background:#334155; height:10px; border-radius:5px; margin-bottom:10px; overflow:hidden">
              <div style="width:${porcentaje}%; background:${colorBarra}; height:100%"></div>
            </div>
            <p class="ayuda" style="margin-top:0">Base: <b>${escapeHTML(r.base_color)}</b> · Tipo: ${escapeHTML(r.tipo_pintura)}</p>
            <div style="display:flex; gap:10px; margin-top:10px">
               <button type="button" class="secundario" data-codigo-formula-linea="${escapeHTML(r.codigo)}">👁 Ver Fórmula</button>
            </div>
          </div>
        `;
      });

      compResultados.innerHTML = html;
      compResultados.querySelectorAll("[data-codigo-formula-linea]").forEach(btn => {
        btn.addEventListener("click", () => verFormulaLinea(btn.dataset.codigoFormulaLinea));
      });

    } catch (e) {
      console.error(e);
      compResultados.innerHTML = '<p>❌ Error al comparar.</p>';
    }
  });
}

window.verFormulaLinea = async (codigo) => {
  const tipo = document.getElementById('compTipoPintura').value;
  const res = await fetch('/api/color/formula', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ codigo, tipo_pintura: tipo })
  });
  formulasLineaActuales = await res.json();
  
  if (formulasLineaActuales.length > 0) {
    document.querySelectorAll("nav button").forEach(x => x.classList.remove("activo"));
    document.querySelectorAll(".tab").forEach(x => x.classList.remove("activo"));
    document.querySelector('[data-tab="comparar"]').classList.add("activo");
    document.getElementById('tab-comparar').classList.add("activo");

    const colorFalso = { codigo: codigo, nombre: formulasLineaActuales[0].nombre, rgb_r: 0, rgb_g: 0, rgb_b: 0 };
    pintarResultadoBusqueda('#000000', colorFalso, tipo);
  }
};

let formulaParaIgualar = null;

function prepararModalIgualar(f, notasExtra = "") {
  formulaParaIgualar = f;
  $("#modalDetalle").classList.add("oculto");
  
  $("#nsCliente").innerHTML = state.clientes.map(c => `<option value="${escapeHTML(c.id)}">${escapeHTML(c.nombre)}</option>`).join("");
  $("#nsProducto").innerHTML = '<option value="">— Selecciona —</option>' +
    state.productos.map(p => `<option value="${escapeHTML(p.nombre)}">${escapeHTML(p.nombre)} (${escapeHTML(p.categoria)})</option>`).join("");
  
  $("#nsCliente").value = f.cliente_id || "";
  $("#nsMuestra").value = f.color || "";
  $("#nsCodigo").value = f.codigo || "";
  $("#nsProducto").value = f.producto || "";
  $("#nsBase").value = f.base || "";
  $("#nsCantidad").value = f.capacidad_madre || 1;
  $("#nsUnidad").value = "LT";
  $("#nsNotas").value = notasExtra || "Sesión iniciada a partir de la fórmula base.";
  
  $("#modalNuevaSesion").classList.remove("oculto");
}

const btnIgualar = document.getElementById("detBtnIgualar");
if (btnIgualar) {
  btnIgualar.onclick = () => {
    if (!formulaDetalleActual) return;
    prepararModalIgualar(formulaDetalleActual);
  };
}

const btnIgualarConv = document.getElementById("detBtnIgualarConvertida");
if (btnIgualarConv) {
  btnIgualarConv.onclick = () => {
    if (!formulaDetalleActual || !conversionTemporal) return;
    const fConvertida = {
      ...formulaDetalleActual,
      capacidad_madre: conversionTemporal.destino,
      tintas: conversionTemporal.tintas
    };
    prepararModalIgualar(fConvertida, `Sesión iniciada a partir de la conversión a ${conversionTemporal.destino} LT.`);
  };
}

const botonConvertir = document.getElementById("detBtnConvertir");
const originalConvertir = botonConvertir.onclick;
botonConvertir.onclick = () => {
  originalConvertir();
  if (conversionTemporal) {
    document.getElementById("detBtnIgualarConvertida").classList.remove("oculto");
  } else {
    document.getElementById("detBtnIgualarConvertida").classList.add("oculto");
  }
};

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

    if (formulaParaIgualar && formulaParaIgualar.tintas) {
      toast("Cargando tintas base...", "aviso");
      for (const t of formulaParaIgualar.tintas) {
        const total128 = parsearCantidad(t.cantidad_texto);
        if (total128 !== null) {
          await api("/api/mezclador/sesion/" + r.id + "/ajuste", { 
            method: "POST", 
            body: JSON.stringify({ 
              tinta: t.tinta, 
              cantidad_texto: t.cantidad_texto,
              cantidad_en_128: total128 
            }) 
          });
        }
      }
      formulaParaIgualar = null;
    }

    await abrirSesion(r.id);
    document.querySelector('nav button[data-tab="mezclador"]').click();
    
  } catch (e) { 
    toast("Error: " + e.message, "error"); 
  }
};

const btnGuardarConv = document.getElementById("btnGuardarConv");
if (btnGuardarConv) {
  btnGuardarConv.onclick = () => {
    const capOrigen = $("#capOrigen").value === "custom" ? (parseFloat($("#capOrigenCustom").value) || 1) : Number($("#capOrigen").value);
    const capDestino = $("#capDestino").value === "custom" ? (parseFloat($("#capDestinoCustom").value) || 1) : Number($("#capDestino").value);
    const maquina = Number($("#maquinaConv").value);
    const texto = ($("#entradaConv").value || "").trim();
    
    if (!texto) return toast("Pega algunas tintas primero", "error");

    const lineas = texto.split("\n").filter(l => l.trim());
    const tintasConvertidas = [];

    for (const linea of lineas) {
      const partes = linea.split(/[|=]/);
      if (partes.length < 2) continue;
      
      const tinta = partes[0].trim().toUpperCase();
      const cant = partes.slice(1).join("=").trim();
      const total128 = parsearCantidad(cant);
      
      if (total128 !== null) {
        const conv = (total128 / capOrigen) * capDestino;
        tintasConvertidas.push({
          tinta,
          cantidad_texto: formatearOZConMaquina(conv, maquina),
          categoria: maquina === 64 ? "ARQUITECTONICA" : "INDUSTRIAL"
        });
      }
    }

    if (tintasConvertidas.length === 0) {
      return toast("No se pudo entender ninguna tinta", "error");
    }

    const f = $("#convCargarFormula").value ? state.formulas.find(x => x.id == $("#convCargarFormula").value) : null;

    const formulaFalsa = {
      color: f ? f.color : "",
      codigo: f ? f.codigo : "",
      producto: f ? f.producto : "",
      base: f ? f.base : "",
      capacidad_madre: capDestino,
      maquina: maquina,
      notas: `Convertido de ${capOrigen} LT a ${capDestino} LT`,
      tintas: tintasConvertidas
    };

    abrirFormula(formulaFalsa);
    toast("Revisa los datos y guarda la nueva fórmula", "exito");
  };
}