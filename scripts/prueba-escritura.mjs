/**
 * Prueba de extremo a extremo de los caminos de ESCRITURA contra la API viva.
 *
 * Crea solicitudes, las aprueba, verifica el efecto en la base y DESHACE todo
 * al terminar (incluso si algo falla). Solo toca el schema `development`.
 *
 *   node scripts/prueba-escritura.mjs
 */
import "dotenv/config";
import pg from "pg";

const API = process.env.SMOKE_API || "http://localhost:4000";
const S = '"development"';

/* ------------------------------------------------------------------ *
 *  GUARDIA: este script ESCRIBE. Jamás debe correr contra producción.
 *
 *  No basta con mirar el .env local: las escrituras las hace la API, así que
 *  lo que importa es a qué schema apunta ELLA. Si la API está en `beta`, las
 *  inserciones irían a producción mientras la limpieza borraría en
 *  development — es decir, dejaría basura en producción sin avisar.
 * ------------------------------------------------------------------ */
{
  if ((process.env.PGSCHEMA || "development") !== "development") {
    console.error(
      `\n[ABORTADO] PGSCHEMA="${process.env.PGSCHEMA}".\n` +
        `Esta prueba crea y borra filas: solo puede correr sobre "development".\n`
    );
    process.exit(1);
  }

  let salud;
  try {
    salud = await fetch(`${API}/api/salud`).then((r) => r.json());
  } catch {
    console.error(`\n[ABORTADO] No responde la API en ${API}. Levántala con: npm run server\n`);
    process.exit(1);
  }
  if (salud?.schema !== "development") {
    console.error(
      `\n[ABORTADO] La API está conectada al schema "${salud?.schema}".\n` +
        `Esta prueba escribe en la base y solo puede correr contra "development".\n` +
        `Cambia PGSCHEMA en .env y reinicia la API antes de ejecutarla.\n`
    );
    process.exit(1);
  }
}

const cliente = new pg.Client({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  ssl: { rejectUnauthorized: false },
});

const limpieza = [];
const fallos = [];

const ok = (n, cond, detalle = "") => {
  console.log(cond ? `  ok    ${n}` : `  FALLA ${n}${detalle ? ` — ${detalle}` : ""}`);
  if (!cond) fallos.push(n);
};

async function pedir(ruta, opciones = {}) {
  const res = await fetch(`${API}/api${ruta}`, {
    headers: opciones.body ? { "Content-Type": "application/json" } : undefined,
    ...opciones,
    body: opciones.body ? JSON.stringify(opciones.body) : undefined,
  });
  const txt = await res.text();
  return { status: res.status, datos: txt ? JSON.parse(txt) : null };
}

const sql = (q, p) => cliente.query(q, p);

try {
  await cliente.connect();

  /* ---------------- contexto de prueba ---------------- */
  const emp = (await sql(`select id, nombre, num_vip from ${S}.empresas where id = 2`)).rows[0];
  const usuario = (await sql(`select id from ${S}.usuarios where id_empresa = 2 limit 1`)).rows[0];
  const empleado = (
    await sql(`select id, nombre_completo from ${S}.empleados where id_empresa = 2 and estado limit 1`)
  ).rows[0];
  console.log(`Contexto: empresa ${emp.nombre} · usuario ${usuario.id} · empleado ${empleado.nombre_completo}\n`);

  /* ================= 1 · tarjeta nueva: crear, aprobar, verificar ========== */
  console.log("1 · Tarjeta nueva (tipo_cambio N)");
  const libresAntes = (
    await sql(`select count(*)::int n from ${S}.tarjetas t
               where t.estado is true and not exists
                 (select 1 from ${S}.accesos a where a.num_tarjeta = t.id)`)
  ).rows[0].n;

  const crear = await pedir("/solicitudes/acceso", {
    method: "POST",
    body: {
      id_empresa: 2,
      id_usuario: usuario.id,
      tipo_cambio: "N",
      id_empleado: empleado.id,
      id_tipo: 1,
      id_horario: 1,
      robotico: false,
      comentarios: "PRUEBA-WEB tarjeta",
    },
  });
  ok("crea la solicitud (201)", crear.status === 201, JSON.stringify(crear.datos));
  const idSol = crear.datos?.id;
  if (idSol) limpieza.push(() => sql(`delete from ${S}.actualizaciones where id = $1`, [idSol]));

  const fila = (await sql(`select * from ${S}.actualizaciones where id = $1`, [idSol])).rows[0];
  ok("queda en estado 'P'", fila?.estado_revision === "P", fila?.estado_revision);
  ok("guarda num_contrato", !!fila?.num_contrato, String(fila?.num_contrato));
  ok("guarda el motivo en comentarios", fila?.comentarios === "PRUEBA-WEB tarjeta");

  const rechazoPerfil = await pedir(`/solicitudes/acceso/${idSol}/resolver`, {
    method: "PATCH",
    body: { perfil: "coordinador", aprobar: true },
  });
  ok("un coordinador NO puede aprobar (403)", rechazoPerfil.status === 403, String(rechazoPerfil.status));

  const aprobar = await pedir(`/solicitudes/acceso/${idSol}/resolver`, {
    method: "PATCH",
    body: { perfil: "administracion", aprobar: true, usuario_revision: "PRUEBA" },
  });
  ok("administración aprueba (200)", aprobar.status === 200, JSON.stringify(aprobar.datos));
  const numTarjeta = aprobar.datos?.num_tarjeta;
  ok("emite una tarjeta del inventario", !!numTarjeta, JSON.stringify(aprobar.datos));

  if (numTarjeta) {
    const acc = (
      await sql(`select * from ${S}.accesos where num_tarjeta = $1 and id_empresa = 2`, [numTarjeta])
    ).rows[0];
    limpieza.push(() => sql(`delete from ${S}.accesos where num_tarjeta = $1 and id_empresa = 2`, [numTarjeta]));
    limpieza.push(() => sql(`update ${S}.tarjetas set id_empresa = null, estado = true where id = $1`, [numTarjeta]));
    ok("crea la fila en accesos", !!acc);
    ok("el acceso queda vigente", acc?.Status === true);
    ok("conserva el empleado", acc?.id_empleado === empleado.id);
    ok("conserva el tipo VIP", acc?.id_tipo === 1);

    const libresDespues = (
      await sql(`select count(*)::int n from ${S}.tarjetas t
                 where t.estado is true and not exists
                   (select 1 from ${S}.accesos a where a.num_tarjeta = t.id)`)
    ).rows[0].n;
    ok("el inventario baja en 1", libresDespues === libresAntes - 1, `${libresAntes} → ${libresDespues}`);
  }

  const reaprobar = await pedir(`/solicitudes/acceso/${idSol}/resolver`, {
    method: "PATCH",
    body: { perfil: "administracion", aprobar: false },
  });
  ok("no se puede resolver dos veces (422)", reaprobar.status === 422, String(reaprobar.status));

  const resuelta = (await sql(`select * from ${S}.actualizaciones where id = $1`, [idSol])).rows[0];
  ok("queda 'F' + aprobado=true", resuelta?.estado_revision === "F" && resuelta?.aprobado === true);

  /* ================= 2 · aislamiento por empresa (RN-005) ================= */
  console.log("\n2 · Aislamiento por empresa (RN-005)");
  const ajeno = (await sql(`select id from ${S}.empleados where id_empresa = 1 limit 1`)).rows[0];
  const fuga = await pedir("/solicitudes/acceso", {
    method: "POST",
    body: {
      id_empresa: 2, id_usuario: usuario.id, tipo_cambio: "N",
      id_empleado: ajeno.id, id_tipo: 3, id_horario: 1,
    },
  });
  ok("rechaza un empleado de otra empresa (422)", fuga.status === 422, JSON.stringify(fuga.datos));
  ok("cita la RN-014", fuga.datos?.rn === "RN-014", String(fuga.datos?.rn));

  const usuarioAjeno = await pedir("/solicitudes/acceso", {
    method: "POST",
    body: {
      id_empresa: 2, id_usuario: 3, tipo_cambio: "N",
      id_empleado: empleado.id, id_tipo: 3, id_horario: 1,
    },
  });
  ok("rechaza un solicitante de otra empresa (400)", usuarioAjeno.status === 400);

  /* ================= 3 · cupo del contrato (RN-011) ====================== */
  console.log("\n3 · Cupo del contrato (RN-011)");
  const cupos = (
    await sql(
      `select count(*)::int n from ${S}.accesos where id_empresa = 2 and id_tipo = 1 and "Status" is not false`
    )
  ).rows[0].n;
  console.log(`  · VIP asignados en ${emp.nombre}: ${cupos} de ${emp.num_vip}`);
  const creadas = [];
  let topeAlcanzado = null;
  for (let i = 0; i < emp.num_vip + 2; i++) {
    const r = await pedir("/solicitudes/acceso", {
      method: "POST",
      body: {
        id_empresa: 2, id_usuario: usuario.id, tipo_cambio: "N",
        id_empleado: empleado.id, id_tipo: 1, id_horario: 1, comentarios: "PRUEBA-WEB cupo",
      },
    });
    if (r.status === 201) creadas.push(r.datos.id);
    else { topeAlcanzado = r; break; }
  }
  for (const id of creadas) limpieza.push(() => sql(`delete from ${S}.actualizaciones where id = $1`, [id]));
  ok("corta al llegar al tope", topeAlcanzado?.status === 422, `creó ${creadas.length} antes de cortar`);
  ok("cita la RN-011", topeAlcanzado?.datos?.rn === "RN-011", String(topeAlcanzado?.datos?.rn));
  ok("cuenta las pendientes en el cupo", creadas.length < emp.num_vip + 2);

  /* ================= 4 · reserva de sala ================================= */
  console.log("\n4 · Reservación de sala");
  const manana = new Date();
  do { manana.setDate(manana.getDate() + 1); } while (manana.getDay() === 0 || manana.getDay() === 6);
  const fecha = `${manana.getFullYear()}-${String(manana.getMonth() + 1).padStart(2, "0")}-${String(manana.getDate()).padStart(2, "0")}`;

  const disp = await pedir(`/salas/disponibles?fecha=${fecha}&hora_inicio=09:00&hora_fin=11:00&num_invitados=10`);
  ok("encuentra salas libres", disp.datos?.salas?.length > 0, JSON.stringify(disp.datos)?.slice(0, 160));
  const salaElegida = disp.datos?.salas?.[0];

  const solSala = await pedir("/solicitudes/sala", {
    method: "POST",
    body: {
      id_empresa: 2, id_usuario: usuario.id, id_sala: salaElegida.id,
      fecha, hora_inicio: "09:00", hora_fin: "11:00", num_invitados: 10,
      tipo_evento: "PRUEBA-WEB tarjeta",
      servicios: [{ tipo: "coffee break", proveedor: "greenMe" }],
    },
  });
  ok("crea la solicitud de sala (201)", solSala.status === 201, JSON.stringify(solSala.datos));
  const idSala = solSala.datos?.id;
  if (idSala) limpieza.push(() => sql(`delete from ${S}.solicitudes_salas where id = $1`, [idSala]));
  ok("calcula el costo", solSala.datos?.costo === salaElegida.precio_hora * 2, String(solSala.datos?.costo));

  const filaSala = (await sql(`select * from ${S}.solicitudes_salas where id = $1`, [idSala])).rows[0];
  ok("guarda servicios como JSON indexado", filaSala?.servicios?.["1"]?.tipo === "coffee break", JSON.stringify(filaSala?.servicios));

  // RN-021: la misma sala y horario ya no debe aparecer libre.
  const disp2 = await pedir(`/salas/disponibles?fecha=${fecha}&hora_inicio=09:00&hora_fin=11:00&num_invitados=10`);
  ok(
    "la solicitud pendiente bloquea el horario",
    !disp2.datos?.salas?.some((s) => s.id === salaElegida.id),
    `sigue apareciendo la sala ${salaElegida.id}`
  );

  // Horario contiguo: debe seguir libre (solapamiento estricto).
  const disp3 = await pedir(`/salas/disponibles?fecha=${fecha}&hora_inicio=11:00&hora_fin=12:00&num_invitados=10`);
  ok(
    "un horario contiguo sí está libre",
    disp3.datos?.salas?.some((s) => s.id === salaElegida.id)
  );

  const aprobarSala = await pedir(`/solicitudes/sala/${idSala}/resolver`, {
    method: "PATCH",
    body: { perfil: "administracion", aprobar: true, usuario_revision: "PRUEBA" },
  });
  ok("aprueba la sala (200)", aprobarSala.status === 200, JSON.stringify(aprobarSala.datos));
  const idRes = aprobarSala.datos?.id_reservacion;
  if (idRes) limpieza.push(() => sql(`delete from ${S}.reservaciones where id = $1`, [idRes]));
  ok("crea la reservación", !!idRes);

  const res = (await sql(`select * from ${S}.reservaciones where id = $1`, [idRes])).rows[0];
  ok("la reservación tiene los datos correctos",
    res?.id_sala === salaElegida.id && res?.num_invitados === 10 && res?.tipo_evento === "PRUEBA-WEB tarjeta");

  /* ================= 5 · alta de empleado (RN-015) ======================= */
  console.log("\n5 · Alta de empleado (RN-015 / RN-027)");
  const nombre = `PRUEBA-WEB Ñandú Áutomatizada ${Date.now()}`;
  const alta = await pedir("/empleados", { method: "POST", body: { id_empresa: 2, nombre_completo: nombre } });
  ok("registra el empleado (201)", alta.status === 201, JSON.stringify(alta.datos));
  if (alta.datos?.id) limpieza.push(() => sql(`delete from ${S}.empleados where id = $1`, [alta.datos.id]));

  const dup = await pedir("/empleados", {
    method: "POST",
    body: { id_empresa: 2, nombre_completo: nombre.replace("Ñandú", "nandu").toUpperCase() },
  });
  ok("rechaza el duplicado ignorando acentos y mayúsculas (422)", dup.status === 422, JSON.stringify(dup.datos));
  ok("cita la RN-015", dup.datos?.rn === "RN-015");

  /* ================= 6 · cancelar solicitud ============================== */
  console.log("\n6 · Retirar una solicitud");
  const paraCancelar = await pedir("/solicitudes/acceso", {
    method: "POST",
    body: {
      id_empresa: 2, id_usuario: usuario.id, tipo_cambio: "N",
      id_empleado: empleado.id, id_tipo: 3, id_horario: 1, comentarios: "PRUEBA-WEB cancelar",
    },
  });
  const idCancel = paraCancelar.datos?.id;
  if (idCancel) limpieza.push(() => sql(`delete from ${S}.actualizaciones where id = $1`, [idCancel]));
  const cancel = await pedir(`/solicitudes/acceso/${idCancel}/cancelar`, {
    method: "PATCH", body: { id_empresa: 2 },
  });
  ok("cancela (200)", cancel.status === 200);
  const cancelada = (await sql(`select * from ${S}.actualizaciones where id = $1`, [idCancel])).rows[0];
  ok("queda en estado 'C'", cancelada?.estado_revision === "C", cancelada?.estado_revision);

  const cancelAjena = await pedir(`/solicitudes/acceso/${idCancel}/cancelar`, {
    method: "PATCH", body: { id_empresa: 1 },
  });
  ok("otra empresa no puede cancelarla (422)", cancelAjena.status === 422);
} catch (e) {
  console.error("\nEXCEPCIÓN:", e.message);
  fallos.push("excepción: " + e.message);
} finally {
  /* ---------------- deshacer todo ---------------- */
  console.log("\nLimpiando datos de prueba…");
  let errores = 0;
  for (const paso of limpieza.reverse()) {
    try { await paso(); } catch (e) { errores++; console.error("  ! " + e.message); }
  }
  console.log(`  ${limpieza.length} operaciones revertidas${errores ? `, ${errores} con error` : ""}.`);

  const restos = await sql(
    `select (select count(*)::int from ${S}.actualizaciones where comentarios like 'PRUEBA-WEB%') a,
            (select count(*)::int from ${S}.solicitudes_salas where tipo_evento like 'PRUEBA-WEB%') s,
            (select count(*)::int from ${S}.reservaciones where tipo_evento like 'PRUEBA-WEB%') r,
            (select count(*)::int from ${S}.empleados where nombre_completo like 'PRUEBA-WEB %') e`
  );
  console.log("  restos:", JSON.stringify(restos.rows[0]));
  const sucio = Object.values(restos.rows[0]).some((n) => n > 0);
  if (sucio) fallos.push("quedaron datos de prueba en la base");

  await cliente.end();
  console.log("\n" + "=".repeat(60));
  console.log(fallos.length ? `RESULTADO: ${fallos.length} fallos.` : "RESULTADO: todo correcto.");
  process.exit(fallos.length ? 1 : 0);
}
