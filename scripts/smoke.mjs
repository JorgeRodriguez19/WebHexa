/**
 * Prueba de humo: monta la aplicación real en jsdom contra la API viva y
 * recorre las seis vistas comprobando que renderizan sin errores.
 *
 * Requiere la API arriba (npm run server). No escribe nada en la base.
 *
 *   node scripts/smoke.mjs
 */
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { fileURLToPath } from "node:url";
import path from "node:path";

const raiz = path.dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const API = process.env.SMOKE_API || "http://localhost:4000";

const fallos = [];
const errores = [];

/* ---------- 1 · empaquetar la app ---------- */
const salida = await build({
  entryPoints: [path.join(raiz, "src/main.jsx")],
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  jsx: "automatic",
  loader: { ".css": "text" },
  define: { "process.env.NODE_ENV": '"development"' },
  logLevel: "silent",
});
const codigo = salida.outputFiles[0].text;

/* ---------- 2 · entorno de navegador ---------- */
const dom = new JSDOM(`<!doctype html><html><body><div id="root"></div></body></html>`, {
  url: "http://localhost:5173/",
  pretendToBeVisual: true,
  runScripts: "outside-only",
});
const { window } = dom;

window.console.error = (...a) => errores.push(a.join(" "));
window.console.warn = (...a) => {
  const m = a.join(" ");
  if (!/deprecat|StrictMode/i.test(m)) errores.push(m);
};

/* La app pide rutas relativas /api/...; aquí se redirigen a la API real. */
window.fetch = (url, opciones) =>
  fetch(String(url).startsWith("/") ? API + url : url, opciones);
window.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
window.cancelAnimationFrame = (id) => clearTimeout(id);

window.eval(codigo);

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const texto = () => window.document.getElementById("root").textContent;
const $ = (sel) => window.document.querySelector(sel);
const $$ = (sel) => [...window.document.querySelectorAll(sel)];

const comprobar = (nombre, cond, detalle = "") => {
  if (cond) console.log(`  ok   ${nombre}`);
  else {
    console.log(`  FALLA ${nombre}${detalle ? ` — ${detalle}` : ""}`);
    fallos.push(nombre);
  }
};

const clic = async (el) => {
  el.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
  await esperar(700);
};

/* ---------- 3 · sesión para las consultas directas del script ---------- *
 * La API ya no responde nada sin token, así que el script inicia sesión por su
 * cuenta con la misma cuenta que usará en la interfaz. Con SMOKE_USUARIO y
 * SMOKE_CLAVE se puede recorrer la app como cualquier perfil.
 */
const CORREO = process.env.SMOKE_USUARIO || "admin@hexa.com.mx";
const CLAVE = process.env.SMOKE_CLAVE || "AdminTR2026!";

const acceso = await fetch(`${API}/api/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ correo: CORREO, password: CLAVE }),
})
  .then((r) => r.json())
  .catch(() => ({}));

const tokenApi = acceso?.token ?? null;
/* El recorrido cambia según el perfil: un Office Manager no tiene selector de
   empresa ni bandeja global. */
const esSuper = !!acceso?.perfil?.superusuario;

const json = async (ruta) =>
  (await fetch(API + ruta, { headers: { Authorization: `Bearer ${tokenApi}` } })).json();

if (!tokenApi) {
  console.log(`\n[ABORTADO] No se pudo iniciar sesión como ${CORREO}.`);
  console.log(`Corre primero: node scripts/migracion-login.mjs <schema> --aplicar\n`);
  process.exit(1);
}

/* ---------- 4 · recorrido ---------- */
await esperar(2500);

console.log("\nPantalla de acceso");
comprobar("muestra el login antes del panel", texto().includes("Inicia sesión"), texto().slice(0, 120));
comprobar("no filtra datos del panel sin sesión", !texto().includes("Hoy en la torre"));

{
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  const escribir = (sel, valor) => {
    const el = $(sel);
    setter.call(el, valor);
    el.dispatchEvent(new window.Event("input", { bubbles: true }));
  };
  escribir('.hx-login input[type="email"]', CORREO);
  escribir('.hx-login input[type="password"]', CLAVE);
  await esperar(120);
  await clic($$(".hx-login .hx-btn").find((b) => b.textContent.includes("Entrar")));
  await esperar(2600);
}

console.log("\nArranque");
comprobar("la app monta", texto().length > 0);
comprobar("no muestra el error de arranque", !texto().includes("No se pudo iniciar el panel"), texto().slice(0, 200));
comprobar("carga la marca HEXA", texto().includes("HEXA"));
/* Ya no hay selectores de solicitante ni de perfil: la sesión los define. El
   de empresa solo existe para un superusuario, que revisa las de todos. */
comprobar(
  esSuper
    ? "el superusuario puede elegir empresa"
    : "una cuenta normal NO puede elegir empresa",
  $$("select.hx-select").length === (esSuper ? 1 : 0),
  `${$$("select.hx-select").length} selectores`
);
comprobar("muestra quién inició sesión", !!$(".hx-sesion-nombre")?.textContent);
console.log(
  `  · sesión: ${$(".hx-sesion-nombre")?.textContent} — ${$(".hx-sesion-sub")?.textContent}`
);

console.log("\nVista Resumen");
comprobar("título 'Hoy en la torre'", texto().includes("Hoy en la torre"));
comprobar("muestra cupos del contrato", texto().includes("Cupos del contrato"));

/**
 * La franja se dibuja si y solo si hay salas con actividad ese día, y solo con
 * esas salas. Se comprueban los dos lados de la regla contra la API real.
 */
const salasConActividad = async (fecha) =>
  new Set((await json(`/api/ocupacion/${fecha}`)).map((o) => o.id_sala));

const fijarDia = async (fecha) => {
  const input = $('input[type="date"]');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(input, fecha);
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
  input.dispatchEvent(new window.Event("change", { bubbles: true }));
  await esperar(900);
};

const catalogos = await json("/api/catalogos");
const hoy = catalogos.hoy;
const esperadasHoy = await salasConActividad(hoy);

comprobar(
  esperadasHoy.size === 0
    ? "sin actividad hoy: la sección de salas no se dibuja"
    : `hoy hay ${esperadasHoy.size} sala(s) con actividad: se dibujan todas`,
  $$(".hx-franja-rail").length === esperadasHoy.size,
  `${$$(".hx-franja-rail").length} franjas vs ${esperadasHoy.size} esperadas`
);

/*
 * Lado positivo de la regla. Se busca en todo el histórico (hoy la base solo
 * tiene reservaciones pasadas) y se elige el día con más salas ocupadas, que es
 * el que mejor distingue "solo las ocupadas" de "todas".
 */
const porDia = new Map();
for (const r of await json("/api/reservaciones?desde=2000-01-01")) {
  if (!porDia.has(r.fecha_reservacion)) porDia.set(r.fecha_reservacion, new Set());
  porDia.get(r.fecha_reservacion).add(r.id_sala);
}
const diaConReserva = [...porDia.entries()].sort((a, b) => b[1].size - a[1].size)[0]?.[0];

if (!diaConReserva) {
  console.log("  --   sin reservaciones en la base; se omite el caso positivo");
} else {
  await fijarDia(diaConReserva);
  const esperadas = await salasConActividad(diaConReserva);
  const dibujadas = $$(".hx-sala-nom").map((e) => e.textContent);
  const nombres = new Set(
    (catalogos.salas ?? []).filter((s) => esperadas.has(s.id)).map((s) => s.nombre)
  );

  comprobar(
    `${diaConReserva}: dibuja exactamente las salas ocupadas`,
    dibujadas.length === esperadas.size && dibujadas.every((n) => nombres.has(n)),
    `dibujadas [${dibujadas}] vs esperadas [${[...nombres]}]`
  );
  comprobar(
    `${diaConReserva}: no cuela salas libres`,
    (catalogos.salas ?? [])
      .filter((s) => !esperadas.has(s.id))
      .every((s) => !dibujadas.includes(s.nombre))
  );

  await fijarDia(hoy);
}

const nav = (etiqueta) => $$(".hx-rail-item").find((b) => b.textContent.includes(etiqueta));

for (const [etiqueta, esperado] of [
  ["Salas", "Salas y reservaciones"],
  ["Accesos", "Tarjetas VIP, vehiculares"],
  ["Empleados", "Personal registrado"],
  ["Vehículos", "Autos registrados"],
  // El texto cambia según el perfil: un superusuario ve la bandeja de revisión.
  ["Solicitudes", esSuper ? "Autoriza o rechaza" : "Movimientos enviados"],
]) {
  console.log(`\nVista ${etiqueta}`);
  const boton = nav(etiqueta);
  if (!boton) {
    comprobar(`existe la pestaña ${etiqueta}`, false);
    continue;
  }
  await clic(boton);
  comprobar(`navega a ${etiqueta}`, texto().includes(esperado), texto().slice(0, 160));
  comprobar(`${etiqueta} sin tabla vacía inesperada`, !texto().includes("undefined"));
}

/*
 * Empleados y Vehículos ocultan las filas inactivas por defecto; el chip las
 * revela. `data-baja` es el atributo con el que se sombreaban, así que no debe
 * haber ninguna fila con él hasta pulsar el chip.
 */
for (const [etiqueta, marca] of [
  ["Empleados", "inactivo"],
  ["Vehículos", "conductor inactivo"],
]) {
  console.log(`\n${etiqueta} · filas inactivas ocultas`);
  await clic(nav(etiqueta));

  const filas = () => $$(".hx-tabla tbody tr").length;
  const sombreadas = () => $$('.hx-tabla tbody tr[data-baja="true"]').length;
  const antes = filas();

  comprobar("por defecto no lista filas inactivas", sombreadas() === 0, `${sombreadas()} sombreadas`);

  const chip = $$(".hx-chip").find((b) => b.textContent.includes(marca));
  if (!chip) {
    console.log("  --   no hay inactivos en esta empresa; se omite el resto");
    continue;
  }
  await clic(chip);
  comprobar("el chip revela filas adicionales", filas() > antes, `${antes} → ${filas()}`);
  comprobar("las reveladas vienen sombreadas", sombreadas() > 0);

  await clic($$(".hx-chip").find((b) => b.textContent.includes("Ocultar")));
  comprobar("el chip vuelve a ocultarlas", filas() === antes && sombreadas() === 0);
}

/* Perfil de administración: debe mostrar los botones de aprobar/rechazar.
   Requiere estar en Solicitudes, que es donde vive la bandeja. */
await clic(nav("Solicitudes"));

console.log(`\n${esSuper ? "Bandeja de administración" : "Alcance de una cuenta normal"}`);
await esperar(600);
if (esSuper) {
  comprobar("está en modo administración", texto().includes("Autoriza o rechaza"), texto().slice(0, 160));
} else {
  comprobar("NO ve la bandeja de administración", !texto().includes("Autoriza o rechaza"));
  comprobar("solo ve sus propios movimientos", texto().includes("Movimientos enviados"));
}

/*
 * Los botones de aprobar solo existen si hay solicitudes pendientes. En el
 * schema de producción (beta) todas están resueltas, así que la comprobación
 * se condiciona a lo que realmente hay en la base en lugar de asumir que
 * siempre hay trabajo en la bandeja.
 */
const bandeja = esSuper ? await json("/api/administracion/solicitudes") : {};
const pendientes = esSuper
  ? (bandeja.actualizaciones ?? []).filter((s) => s.estado_revision === "P").length +
    (bandeja.solicitudes_salas ?? []).filter((s) => s.estado === "P").length
  : 0;
const aprobar = $$(".hx-btn").filter((b) => b.textContent.includes("Aprobar"));

if (!esSuper) {
  comprobar("una cuenta normal no ve botones de aprobación", aprobar.length === 0);
} else if (pendientes === 0) {
  console.log("  --   no hay solicitudes pendientes en este schema; nada que aprobar");
  comprobar("sin pendientes no ofrece botones de aprobación", aprobar.length === 0);
} else {
  comprobar("aparecen botones de aprobación", aprobar.length > 0, `${aprobar.length} botones`);
}

/* Asistente de reservación hasta el paso 2 (no confirma: no escribe en la base). */
console.log("\nAsistente de reservación");
await clic(nav("Salas"));
const reservar = $$(".hx-btn").find((b) => b.textContent.includes("Reservar sala"));
if (reservar && !reservar.disabled) {
  await clic(reservar);
  comprobar("abre el modal", !!$(".hx-modal"), "no se encontró .hx-modal");
  const evento = $(".hx-modal input.hx-input");
  if (evento) {
    /*
     * Se escribe LETRA POR LETRA a propósito. Escribirlo de golpe ocultaba un
     * bug real: el efecto de foco del Modal se re-ejecutaba en cada render y
     * devolvía el foco al diálogo, así que había que volver a hacer clic en el
     * campo para cada letra.
     */
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    const frase = "Prueba de humo";
    evento.focus();
    let perdioFoco = false;
    for (const letra of frase) {
      if (window.document.activeElement !== evento) {
        perdioFoco = true;
        break;
      }
      setter.call(evento, evento.value + letra);
      evento.dispatchEvent(new window.Event("input", { bubbles: true }));
      await esperar(30);
    }
    comprobar("el campo de texto conserva el foco al escribir", !perdioFoco);
    comprobar(
      "el texto se escribe completo",
      evento.value === frase,
      `quedó "${evento.value}" en lugar de "${frase}"`
    );
    await esperar(200);
  }
  const buscar = $$(".hx-modal .hx-btn").find((b) => b.textContent.includes("Buscar sala"));
  await clic(buscar);
  await esperar(1200);
  const enPaso2 = texto().includes("Sala asignada") || texto().includes("Ninguna sala");
  comprobar("el paso 1 valida y avanza (o avisa que no hay sala)", enPaso2, texto().slice(-260));
} else {
  comprobar("el botón Reservar sala está disponible", false);
}

/* ---------- 4 · resultado ---------- */
const relevantes = errores.filter((e) => !/Warning: ReactDOM.render|act\(/.test(e));
console.log("\n" + "=".repeat(60));
if (relevantes.length) {
  console.log(`Errores de consola (${relevantes.length}):`);
  relevantes.slice(0, 10).forEach((e) => console.log("  ! " + e.slice(0, 300)));
}
if (fallos.length || relevantes.length) {
  console.log(`\nRESULTADO: ${fallos.length} comprobaciones fallidas, ${relevantes.length} errores.`);
  process.exit(1);
}
console.log("\nRESULTADO: todo correcto.");
process.exit(0);
