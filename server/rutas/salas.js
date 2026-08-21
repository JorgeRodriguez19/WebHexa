import { Router } from "express";
import { enTransaccion, q, T } from "../db.js";
import { SQL_SALAS_DISPONIBLES } from "../sql.js";
import { HAY_APROBADO } from "../capacidades.js";
import { empresaDeSesion, exigirSuperusuario, usuarioDeSesion } from "../auth.js";
import {
  BANDAS,
  CAPACIDAD_MAXIMA,
  REV_CANCELADA,
  REV_FINALIZADA,
  REV_PENDIENTE,
  bandaPara,
  bandaSiguiente,
  costoEstimado,
  diasHabilesSiguientes,
  horasEntre,
  isoLocal,
  toMin,
  validarFechaReservacion,
} from "../../shared/reglas.js";
import {
  booleano,
  enteroPositivo,
  fechaISO,
  hora,
  malaPeticion,
  reglaViolada,
  texto,
} from "../util.js";

export const salas = Router();

/* ------------------------------------------------------------------ *
 *  Validación común de un rango de reservación
 * ------------------------------------------------------------------ */

function validarRango({ fecha, hora_inicio, hora_fin, num_invitados }) {
  const f = fechaISO(fecha, "La fecha");
  const ini = hora(hora_inicio, "La hora de inicio");
  const fin = hora(hora_fin, "La hora de término");
  const inv = enteroPositivo(num_invitados, "El número de invitados");

  // RN-019 · fecha futura y día hábil.
  const v = validarFechaReservacion(f);
  if (!v.valida) throw reglaViolada(v.razon, "RN-019");

  if (toMin(fin) <= toMin(ini))
    throw reglaViolada("La hora de término debe ser posterior a la de inicio.", "RN-019");
  if (toMin(ini) % 30 !== 0 || toMin(fin) % 30 !== 0)
    throw reglaViolada("Las horas deben caer en múltiplos de media hora.", "RN-019");

  // RN-020 · más de 150 invitados excede la capacidad de la torre.
  if (inv > CAPACIDAD_MAXIMA)
    throw reglaViolada(
      `Más de ${CAPACIDAD_MAXIMA} invitados excede la capacidad de la torre. No hay sala disponible.`,
      "RN-020"
    );

  return { fecha: f, ini, fin, inv };
}

/**
 * RN-020 / RN-021 · busca salas libres subiendo de banda cuando la que
 * corresponde al número de invitados está ocupada.
 */
async function buscarSalas(cliente, { fecha, ini, fin, inv, ignorar = null }) {
  const bandaOriginal = bandaPara(inv);
  let banda = bandaOriginal;
  const bandasProbadas = [];

  while (banda) {
    bandasProbadas.push(banda);
    const r = await cliente.query(SQL_SALAS_DISPONIBLES, [inv, banda, ini, fin, fecha, ignorar]);
    if (r.rows.length)
      return {
        banda,
        banda_original: bandaOriginal,
        subio_banda: banda !== bandaOriginal,
        bandas_probadas: bandasProbadas,
        salas: r.rows.map((s) => ({
          ...s,
          horas: horasEntre(ini, fin),
          costo: costoEstimado(s.precio_hora, ini, fin), // RN-022
        })),
      };
    banda = bandaSiguiente(banda);
  }

  return {
    banda: null,
    banda_original: bandaOriginal,
    subio_banda: false,
    bandas_probadas: bandasProbadas,
    salas: [],
    // El flujo n8n sugiere mover la hora ±1 h o proponer las próximas 3 fechas hábiles.
    sugerencias: diasHabilesSiguientes(3, new Date(`${fecha}T12:00:00`)),
  };
}

/* ------------------------------------------------------------------ *
 *  GET /api/salas/disponibles — paso 2 del Flujo_Reservacion_Sala
 * ------------------------------------------------------------------ */

salas.get("/salas/disponibles", async (req, res) => {
  const { fecha, ini, fin, inv } = validarRango({
    fecha: req.query.fecha,
    hora_inicio: req.query.hora_inicio,
    hora_fin: req.query.hora_fin,
    num_invitados: req.query.num_invitados,
  });
  const ignorar = req.query.ignorar ? enteroPositivo(req.query.ignorar, "La reservación") : null;

  const r = await buscarSalas({ query: q }, { fecha, ini, fin, inv, ignorar });
  res.json({ fecha, hora_inicio: ini, hora_fin: fin, num_invitados: inv, bandas: BANDAS, ...r });
});

/* ------------------------------------------------------------------ *
 *  POST /api/solicitudes/sala — paso 7 del Flujo_Reservacion_Sala
 * ------------------------------------------------------------------ */

salas.post("/solicitudes/sala", async (req, res) => {
  const b = req.body ?? {};
  const idEmpresa = empresaDeSesion(req, b.id_empresa);
  const idUsuario = usuarioDeSesion(req, b.id_usuario);
  const idSala = enteroPositivo(b.id_sala, "La sala");
  const tipoEvento = texto(b.tipo_evento, "El tipo de evento", { max: 200 });
  const { fecha, ini, fin, inv } = validarRango(b);
  const servicios = normalizarServicios(b.servicios);

  const creada = await enTransaccion(async (cx) => {
    const u = await cx.query(
      `select id, nombre_completo from ${T("usuarios")} where id = $1 and id_empresa = $2`,
      [idUsuario, idEmpresa]
    );
    if (!u.rows.length)
      throw malaPeticion("El solicitante no pertenece a la empresa seleccionada.");

    // Se revalida la disponibilidad en el servidor: entre que el usuario vio
    // la sala libre y confirmó, otra empresa pudo tomarla.
    const libre = await cx.query(SQL_SALAS_DISPONIBLES, [inv, CAPACIDAD_MAXIMA, ini, fin, fecha, null]);
    const elegida = libre.rows.find((s) => s.id === idSala);
    if (!elegida) {
      const sala = await cx.query(
        `select nombre, capacidad, horario_apertura, horario_cierre from ${T("salas")} where id = $1`,
        [idSala]
      );
      if (!sala.rows.length) throw malaPeticion("La sala no existe.");
      const s = sala.rows[0];
      if (s.capacidad < inv)
        throw reglaViolada(
          `${s.nombre} tiene capacidad para ${s.capacidad} personas y el evento es de ${inv}.`,
          "RN-020"
        );
      if (toMin(s.horario_apertura) > toMin(ini) || toMin(s.horario_cierre) < toMin(fin))
        throw reglaViolada(
          `${s.nombre} opera de ${s.horario_apertura} a ${s.horario_cierre}; ` +
            `el horario solicitado queda fuera.`,
          "RN-021"
        );
      throw reglaViolada(
        `${s.nombre} ya no está libre el ${fecha} de ${ini} a ${fin}. Elige otro horario o sala.`,
        "RN-021"
      );
    }

    // RN-023 · la solicitud se guarda pendiente de revisión administrativa.
    const r = await cx.query(
      `insert into ${T("solicitudes_salas")}
         (id_sala, id_usuario, fecha_registro, fecha_reservacion, hora_inicio, hora_fin,
          estado, tipo_evento, num_invitados, comentarios, servicios)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       returning id`,
      [
        idSala,
        idUsuario,
        isoLocal(),
        fecha,
        ini,
        fin,
        REV_PENDIENTE,
        tipoEvento,
        inv,
        texto(b.comentarios, "El comentario", { max: 400, requerido: false }),
        JSON.stringify(servicios),
      ]
    );

    return {
      id: r.rows[0].id,
      sala: elegida.nombre,
      horas: horasEntre(ini, fin),
      costo: costoEstimado(elegida.precio_hora, ini, fin), // RN-022
    };
  });

  res.status(201).json({ ...creada, folio: `RES-${String(creada.id).padStart(4, "0")}` });
});

/**
 * `solicitudes_salas.servicios` es un JSON indexado numéricamente en base 1,
 * tal como lo escribe el flujo n8n: {"1":{"tipo":…,"proveedor":…}, …}
 */
function normalizarServicios(entrada) {
  if (!Array.isArray(entrada) || !entrada.length) return {};
  const out = {};
  entrada.slice(0, 12).forEach((s, i) => {
    const tipo = (s?.tipo ?? "").toString().trim();
    if (!tipo) return;
    out[String(i + 1)] = { tipo, proveedor: (s?.proveedor ?? "").toString().trim() };
  });
  return out;
}

/* ------------------------------------------------------------------ *
 *  PATCH /api/solicitudes/sala/:id/resolver
 *  Al aprobar se crea la reservación real en `reservaciones`.
 * ------------------------------------------------------------------ */

salas.patch("/solicitudes/sala/:id/resolver", async (req, res) => {
  const b = req.body ?? {};
  exigirSuperusuario(req);
  const id = enteroPositivo(req.params.id, "El folio");
  const aprobar = booleano(b.aprobar, false);
  const revisor =
    texto(b.usuario_revision, "El revisor", { max: 120, requerido: false }) ?? "Administración Hexa";
  const nota = texto(b.comentarios, "El comentario", { max: 400, requerido: false });
  const hoy = isoLocal();

  const efecto = await enTransaccion(async (cx) => {
    const r = await cx.query(`select * from ${T("solicitudes_salas")} where id = $1 for update`, [id]);
    if (!r.rows.length) throw malaPeticion("La solicitud no existe.");
    const s = r.rows[0];
    if (s.estado !== REV_PENDIENTE) throw reglaViolada("Esa solicitud ya fue resuelta.");

    /* Sin `aprobado` (beta) el desenlace se registra como en producción:
       estado 'F' + usuario_revision, y el rechazo se explica en comentarios. */
    const comentario = aprobar ? nota : `Rechazada: ${nota || "sin motivo indicado"}`;

    if (HAY_APROBADO) {
      await cx.query(
        `update ${T("solicitudes_salas")}
            set estado = $2, aprobado = $3, usuario_revision = $4, fecha_revision = $5,
                comentarios = coalesce($6, comentarios)
          where id = $1`,
        [id, REV_FINALIZADA, aprobar, revisor, hoy, comentario]
      );
    } else {
      await cx.query(
        `update ${T("solicitudes_salas")}
            set estado = $2, usuario_revision = $3, fecha_revision = $4,
                comentarios = coalesce($5, comentarios)
          where id = $1`,
        [id, REV_FINALIZADA, revisor, hoy, comentario]
      );
    }

    if (!aprobar) return { aplicado: "rechazada" };

    // RN-021 · último control antes de convertirla en reservación firme.
    const choque = await cx.query(
      `select r.id from ${T("reservaciones")} r
        where r.id_sala = $1 and r.fecha_reservacion = $2::date
          and not (r.hora_fin <= $3::time or r.hora_inicio >= $4::time)
        limit 1`,
      [s.id_sala, s.fecha_reservacion, s.hora_inicio, s.hora_fin]
    );
    if (choque.rows.length)
      throw reglaViolada(
        `Ya existe una reservación aprobada que choca con ese horario ` +
          `(folio RES-${String(choque.rows[0].id).padStart(4, "0")}). Rechaza la solicitud o ajusta el horario.`,
        "RN-021"
      );

    const ins = await cx.query(
      `insert into ${T("reservaciones")}
         (id_sala, id_usuario, fecha_reservacion, hora_inicio, hora_fin,
          tipo_evento, num_invitados, fecha_aprobacion)
       values ($1,$2,$3,$4,$5,$6,$7,$8)
       returning id`,
      [
        s.id_sala,
        s.id_usuario,
        s.fecha_reservacion,
        s.hora_inicio,
        s.hora_fin,
        s.tipo_evento,
        s.num_invitados,
        hoy,
      ]
    );
    return { aplicado: "reservación creada", id_reservacion: ins.rows[0].id };
  });

  res.json({ id, ...efecto });
});

/* ------------------------------------------------------------------ *
 *  PATCH /api/solicitudes/sala/:id/cancelar — el solicitante la retira
 * ------------------------------------------------------------------ */

salas.patch("/solicitudes/sala/:id/cancelar", async (req, res) => {
  const id = enteroPositivo(req.params.id, "El folio");
  const idEmpresa = empresaDeSesion(req, req.body?.id_empresa);

  const r = await q(
    `update ${T("solicitudes_salas")} s
        set estado = $3${HAY_APROBADO ? ", aprobado = false" : ""},
            comentarios = coalesce(nullif(s.comentarios, ''), 'Retirada por el solicitante')
      where s.id = $1 and s.estado = $4
        and exists (select 1 from ${T("usuarios")} u
                     where u.id = s.id_usuario and u.id_empresa = $2)
      returning s.id`,
    [id, idEmpresa, REV_CANCELADA, REV_PENDIENTE]
  );
  if (!r.rows.length)
    throw reglaViolada("La solicitud no existe, no es de tu empresa o ya fue resuelta.");
  res.json({ id, aplicado: "cancelada" });
});
