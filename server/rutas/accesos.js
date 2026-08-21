import { Router } from "express";
import { enTransaccion, q, T } from "../db.js";
import { NORM, SQL_CUPOS, SQL_TARJETAS_LIBRES } from "../sql.js";
import {
  HAY_APROBADO,
  HAY_STATUS_ACCESO,
  PERMITE_BAJA_ACCESO,
  accesoVigente,
  ordenPorVigencia,
  statusAcceso,
} from "../capacidades.js";
import { empresaDeSesion, exigirSuperusuario, usuarioDeSesion } from "../auth.js";
import {
  CONSUME_CUPO,
  REV_CANCELADA,
  REV_FINALIZADA,
  REV_PENDIENTE,
  TIPO_CAMBIO,
  isoLocal,
  norm,
} from "../../shared/reglas.js";
import {
  booleano,
  enteroPositivo,
  malaPeticion,
  reglaViolada,
  texto,
} from "../util.js";

export const accesos = Router();

/* ------------------------------------------------------------------ *
 *  Lecturas auxiliares con validación de pertenencia (RN-005)
 * ------------------------------------------------------------------ */

async function empleadoDeEmpresa(cx, idEmpleado, idEmpresa) {
  const r = await cx.query(
    `select id, nombre_completo, estado from ${T("empleados")}
      where id = $1 and id_empresa = $2`,
    [idEmpleado, idEmpresa]
  );
  // RN-014 · el empleado debe existir; RN-005 · y ser de la empresa del usuario.
  if (!r.rows.length)
    throw reglaViolada(
      "El empleado no existe o no pertenece a tu empresa. Regístralo antes de continuar.",
      "RN-014"
    );
  return r.rows[0];
}

async function accesoDeEmpresa(cx, numTarjeta, idEmpresa) {
  const r = await cx.query(
    `select a.id, a.num_tarjeta, a.id_empleado, a.id_tipo, a.id_horario, a.robotico,
            ${statusAcceso("a")} as status, e.nombre_completo as empleado
       from ${T("accesos")} a
       join ${T("empleados")} e on e.id = a.id_empleado
      where a.num_tarjeta = $1 and a.id_empresa = $2
      order by ${ordenPorVigencia("a")} a.id desc
      limit 1`,
    [numTarjeta, idEmpresa]
  );
  // RN-017 · la tarjeta debe existir en `accesos` y pertenecer a la empresa.
  if (!r.rows.length)
    throw reglaViolada(
      `La tarjeta ${numTarjeta} no está registrada a nombre de tu empresa.`,
      "RN-017"
    );
  return r.rows[0];
}

async function usuarioDeEmpresa(cx, idUsuario, idEmpresa) {
  const r = await cx.query(
    `select id, nombre_completo from ${T("usuarios")} where id = $1 and id_empresa = $2`,
    [idUsuario, idEmpresa]
  );
  if (!r.rows.length)
    throw malaPeticion(
      "El usuario solicitante no pertenece a la empresa seleccionada. Elige otro solicitante."
    );
  return r.rows[0];
}

async function contratoDe(cx, idEmpresa) {
  const r = await cx.query(
    `select id, nombre, num_contrato, num_vip, num_vehiculares from ${T("empresas")} where id = $1`,
    [idEmpresa]
  );
  if (!r.rows.length) throw malaPeticion("La empresa no existe.");
  return r.rows[0];
}

/**
 * RN-011 / RN-012 · valida el cupo del contrato antes de aceptar una tarjeta
 * nueva. Los accesos Peatonales no consumen cupo.
 */
async function validarCupo(cx, idEmpresa, idTipo) {
  const columna = CONSUME_CUPO[idTipo];
  if (!columna) return; // Peatonal

  const empresa = await contratoDe(cx, idEmpresa);
  const limite = Number(empresa[columna]);

  const r = await cx.query(SQL_CUPOS, [idEmpresa]);
  const fila = r.rows.find((x) => x.id_tipo === idTipo);
  const asignados = fila?.asignados ?? 0;
  const pendientes = fila?.pendientes ?? 0;
  const ocupados = asignados + pendientes;

  if (ocupados >= limite) {
    const etiqueta = idTipo === 1 ? "VIP" : "vehiculares";
    throw reglaViolada(
      `Cupo de accesos ${etiqueta} agotado: ${ocupados} de ${limite} lugares ocupados ` +
        `(${asignados} asignados y ${pendientes} en solicitudes pendientes). ` +
        `Libera un acceso o amplía el contrato.`,
      idTipo === 1 ? "RN-011" : "RN-012"
    );
  }
}

/** Evita dos solicitudes idénticas en cola para la misma persona. */
async function sinDuplicadoPendiente(cx, idEmpresa, tipoCambio, idEmpleado) {
  const r = await cx.query(
    `select id from ${T("actualizaciones")}
      where id_empresa = $1 and tipo_cambio = $2 and id_empleado = $3
        and estado_revision = $4
      limit 1`,
    [idEmpresa, tipoCambio, idEmpleado, REV_PENDIENTE]
  );
  if (r.rows.length)
    throw reglaViolada(
      `Ya existe una solicitud de "${TIPO_CAMBIO[tipoCambio]}" pendiente (folio SOL-${String(
        r.rows[0].id
      ).padStart(4, "0")}) para esa persona.`,
      "RN-013"
    );
}

/**
 * RN-013 · inserta la solicitud en `actualizaciones` con estado 'P'.
 * Ningún cambio se aplica hasta que administración lo apruebe.
 */
async function insertarSolicitud(cx, datos) {
  const r = await cx.query(
    `insert into ${T("actualizaciones")}
       (id_empresa, id_empleado, num_tarjeta, id_horario, id_tipo, num_chip,
        estado_revision, tipo_cambio, fecha_solicitud, num_contrato,
        comentarios, id_usuario, robotico)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     returning id`,
    [
      datos.id_empresa,
      datos.id_empleado,
      datos.num_tarjeta ?? null,
      datos.id_horario,
      datos.id_tipo,
      datos.num_chip ?? null,
      REV_PENDIENTE,
      datos.tipo_cambio,
      isoLocal(),
      datos.num_contrato ?? "",
      datos.comentarios ?? null,
      datos.id_usuario,
      datos.robotico ?? false,
    ]
  );
  return r.rows[0].id;
}

/* ------------------------------------------------------------------ *
 *  POST /api/solicitudes/acceso — crea una solicitud (tipo_cambio N/R/S/A/B)
 * ------------------------------------------------------------------ */

accesos.post("/solicitudes/acceso", async (req, res) => {
  const b = req.body ?? {};
  const idEmpresa = empresaDeSesion(req, b.id_empresa);
  const idUsuario = usuarioDeSesion(req, b.id_usuario);
  const tipo = texto(b.tipo_cambio, "El tipo de solicitud", { max: 1 });

  if (!TIPO_CAMBIO[tipo])
    throw malaPeticion(`Tipo de solicitud desconocido: "${tipo}". Se esperaba N, R, S, A o B.`);

  const id = await enTransaccion(async (cx) => {
    await usuarioDeEmpresa(cx, idUsuario, idEmpresa);
    const empresa = await contratoDe(cx, idEmpresa);
    const comun = {
      id_empresa: idEmpresa,
      id_usuario: idUsuario,
      num_contrato: empresa.num_contrato,
      tipo_cambio: tipo,
      comentarios: texto(b.comentarios, "El motivo", { max: 400, requerido: false }),
    };

    /* ---- N · tarjeta nueva (Flujo_Solicitud_Tarjeta) ---- */
    if (tipo === "N") {
      const idEmpleado = enteroPositivo(b.id_empleado, "El empleado");
      const idTipo = enteroPositivo(b.id_tipo, "El tipo de acceso");
      const idHorario = enteroPositivo(b.id_horario, "El horario");

      const emp = await empleadoDeEmpresa(cx, idEmpleado, idEmpresa);
      // RN-016 · no se emiten tarjetas a personal inactivo.
      if (!emp.estado)
        throw reglaViolada(
          `${emp.nombre_completo} está inactivo. Solicita su alta antes de pedir una tarjeta.`,
          "RN-016"
        );
      await validarCupo(cx, idEmpresa, idTipo);

      return insertarSolicitud(cx, {
        ...comun,
        id_empleado: idEmpleado,
        num_tarjeta: null,
        id_tipo: idTipo,
        id_horario: idHorario,
        robotico: booleano(b.robotico, false),
      });
    }

    /* ---- R · reasignación (Flujo_Reasignar_Acceso) ---- */
    if (tipo === "R") {
      const numTarjeta = texto(b.num_tarjeta, "El número de tarjeta", { max: 60 });
      const idDestino = enteroPositivo(b.id_empleado, "El nuevo titular");

      const acceso = await accesoDeEmpresa(cx, numTarjeta, idEmpresa);
      if (acceso.status === false)
        throw reglaViolada(`La tarjeta ${numTarjeta} ya no está vigente.`, "RN-017");

      const emp = await empleadoDeEmpresa(cx, idDestino, idEmpresa);
      if (!emp.estado)
        throw reglaViolada(
          `${emp.nombre_completo} está inactivo y no puede recibir accesos.`,
          "RN-016"
        );
      if (acceso.id_empleado === idDestino)
        throw reglaViolada(`La tarjeta ${numTarjeta} ya está asignada a ${emp.nombre_completo}.`);

      return insertarSolicitud(cx, {
        ...comun,
        id_empleado: idDestino,
        num_tarjeta: numTarjeta,
        // Reasignar conserva el tipo y el horario del acceso original.
        id_tipo: acceso.id_tipo,
        id_horario: acceso.id_horario,
        robotico: acceso.robotico,
      });
    }

    /* ---- S · reposición por robo o extravío (Flujo_Reposición_Acceso) ---- */
    if (tipo === "S") {
      const numTarjeta = texto(b.num_tarjeta, "El número de tarjeta", { max: 60 });
      const acceso = await accesoDeEmpresa(cx, numTarjeta, idEmpresa);
      if (acceso.status === false)
        throw reglaViolada(`La tarjeta ${numTarjeta} ya no está vigente.`, "RN-017");

      return insertarSolicitud(cx, {
        ...comun,
        // La reposición mantiene al mismo titular: solo cambia el plástico.
        id_empleado: acceso.id_empleado,
        num_tarjeta: numTarjeta,
        id_tipo: acceso.id_tipo,
        id_horario: acceso.id_horario,
        robotico: acceso.robotico,
      });
    }

    /* ---- B · baja de empleado / A · alta (reactivación) ---- */
    const idEmpleado = enteroPositivo(b.id_empleado, "El empleado");
    const emp = await empleadoDeEmpresa(cx, idEmpleado, idEmpresa);

    // RN-016 · la baja exige que esté activo; el alta, que esté inactivo.
    if (tipo === "B" && !emp.estado)
      throw reglaViolada(`${emp.nombre_completo} ya está inactivo.`, "RN-016");
    if (tipo === "A" && emp.estado)
      throw reglaViolada(`${emp.nombre_completo} ya está activo.`, "RN-016");

    await sinDuplicadoPendiente(cx, idEmpresa, tipo, idEmpleado);

    return insertarSolicitud(cx, {
      ...comun,
      id_empleado: idEmpleado,
      num_tarjeta: null,
      // El flujo n8n fija horario y tipo en 1 para altas y bajas: la solicitud
      // no habla de una tarjeta concreta, pero las columnas son NOT NULL.
      id_tipo: 1,
      id_horario: 1,
      robotico: false,
    });
  });

  res.status(201).json({ id, folio: `SOL-${String(id).padStart(4, "0")}` });
});

/* ------------------------------------------------------------------ *
 *  PATCH /api/solicitudes/acceso/:id/resolver — aprobar o rechazar
 * ------------------------------------------------------------------ */

accesos.patch("/solicitudes/acceso/:id/resolver", async (req, res) => {
  const b = req.body ?? {};
  exigirSuperusuario(req);
  const id = enteroPositivo(req.params.id, "El folio");
  const aprobar = booleano(b.aprobar, false);
  const revisor = texto(b.usuario_revision, "El revisor", { max: 120, requerido: false }) ?? "Administración Hexa";
  const nota = texto(b.comentarios, "El comentario", { max: 400, requerido: false });

  const efecto = await enTransaccion(async (cx) => {
    // FOR UPDATE evita que dos revisores resuelvan la misma solicitud a la vez.
    const r = await cx.query(
      `select * from ${T("actualizaciones")} where id = $1 for update`,
      [id]
    );
    if (!r.rows.length) throw malaPeticion("La solicitud no existe.");
    const s = r.rows[0];
    if (s.estado_revision !== REV_PENDIENTE)
      throw reglaViolada("Esa solicitud ya fue resuelta.");

    /*
     * `aprobado` no existe en beta. Allí el desenlace se registra como lo hace
     * producción: estado 'F' + `usuario_revision`, y si es rechazo el motivo
     * queda en `comentarios` con un prefijo reconocible.
     */
    const comentario = aprobar ? nota : `Rechazada: ${nota || "sin motivo indicado"}`;

    if (HAY_APROBADO) {
      await cx.query(
        `update ${T("actualizaciones")}
            set estado_revision = $2, aprobado = $3, usuario_revision = $4,
                comentarios = coalesce($5, comentarios)
          where id = $1`,
        [id, REV_FINALIZADA, aprobar, revisor, comentario]
      );
    } else {
      await cx.query(
        `update ${T("actualizaciones")}
            set estado_revision = $2, usuario_revision = $3,
                comentarios = coalesce($4, comentarios)
          where id = $1`,
        [id, REV_FINALIZADA, revisor, comentario]
      );
    }

    if (!aprobar) return { aplicado: "rechazada" };
    return aplicarAprobacion(cx, s);
  });

  res.json({ id, ...efecto });
});

/**
 * Aplica en la base el efecto de una solicitud aprobada.
 *
 * El flujo n8n solo deja la solicitud en 'P': el cierre del ciclo lo hace la
 * administración, y es lo que replica el prototipo. No se escribe en
 * `historico` (queda fuera del alcance acordado).
 */
async function aplicarAprobacion(cx, s) {
  const hoy = isoLocal();

  /** Toma una tarjeta libre del inventario `tarjetas` y la marca de la empresa. */
  const tomarTarjetaLibre = async () => {
    const libres = await cx.query(SQL_TARJETAS_LIBRES, [s.id_empresa]);
    if (!libres.rows.length)
      throw reglaViolada(
        "No hay tarjetas libres en el inventario (development.tarjetas). " +
          "Da de alta plásticos nuevos antes de aprobar esta solicitud."
      );
    const num = libres.rows[0].id;
    await cx.query(`update ${T("tarjetas")} set id_empresa = $2 where id = $1`, [
      num,
      s.id_empresa,
    ]);
    return num;
  };

  if (s.tipo_cambio === "N") {
    const num = await tomarTarjetaLibre();
    // En beta no existe la columna "Status": se omite de la inserción.
    await cx.query(
      `insert into ${T("accesos")}
         (id_empresa, id_empleado, num_tarjeta, id_horario, id_tipo, num_chip,
          fecha_solicitud, fecha_asignacion, num_contrato, robotico${
            HAY_STATUS_ACCESO ? `, "Status"` : ``
          })
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10${HAY_STATUS_ACCESO ? `,true` : ``})`,
      [
        s.id_empresa,
        s.id_empleado,
        num,
        s.id_horario,
        s.id_tipo,
        s.num_chip,
        s.fecha_solicitud,
        hoy,
        s.num_contrato,
        s.robotico,
      ]
    );
    return { aplicado: "tarjeta emitida", num_tarjeta: num };
  }

  if (s.tipo_cambio === "R") {
    const upd = await cx.query(
      `update ${T("accesos")}
          set id_empleado = $3, fecha_asignacion = $4
        where num_tarjeta = $1 and id_empresa = $2 and ${accesoVigente("accesos")}`,
      [s.num_tarjeta, s.id_empresa, s.id_empleado, hoy]
    );
    if (!upd.rowCount)
      throw reglaViolada(
        `La tarjeta ${s.num_tarjeta} ya no está vigente en la empresa; no se pudo reasignar.`,
        "RN-017"
      );
    return { aplicado: "tarjeta reasignada", num_tarjeta: s.num_tarjeta };
  }

  if (s.tipo_cambio === "S") {
    const nuevo = await tomarTarjetaLibre();
    const upd = await cx.query(
      `update ${T("accesos")}
          set num_tarjeta = $3, fecha_asignacion = $4
        where num_tarjeta = $1 and id_empresa = $2 and ${accesoVigente("accesos")}`,
      [s.num_tarjeta, s.id_empresa, nuevo, hoy]
    );
    if (!upd.rowCount)
      throw reglaViolada(
        `La tarjeta ${s.num_tarjeta} ya no está vigente; no se pudo reponer.`,
        "RN-017"
      );
    // El plástico perdido se inhabilita para que no vuelva al inventario.
    await cx.query(`update ${T("tarjetas")} set estado = false where id = $1`, [s.num_tarjeta]);
    return { aplicado: "tarjeta repuesta", num_tarjeta: nuevo, reemplaza: s.num_tarjeta };
  }

  if (s.tipo_cambio === "B") {
    /*
     * En beta la baja de un acceso NO es un cambio de bandera: hay que copiar
     * la fila a `historico` y borrarla de `accesos`. Es destructivo e
     * irreversible desde la aplicación, así que queda pendiente de decisión
     * del cliente y aquí se rechaza en lugar de improvisar.
     */
    if (!PERMITE_BAJA_ACCESO)
      throw reglaViolada(
        "Las bajas todavía no están habilitadas sobre el schema de producción. " +
          "Ahí liberar un acceso implica moverlo a `historico` y borrarlo de `accesos`, " +
          "una operación destructiva que aún no se ha autorizado. La solicitud queda " +
          "registrada; aplícala desde el proceso habitual de administración.",
        "RN-016"
      );

    await cx.query(`update ${T("empleados")} set estado = false where id = $1`, [s.id_empleado]);
    // Al dar de baja a la persona se liberan sus accesos vigentes.
    const acc = await cx.query(
      `update ${T("accesos")} set "Status" = false
        where id_empleado = $1 and id_empresa = $2 and ${accesoVigente("accesos")}
        returning num_tarjeta`,
      [s.id_empleado, s.id_empresa]
    );
    return { aplicado: "empleado dado de baja", tarjetas_liberadas: acc.rows.map((x) => x.num_tarjeta) };
  }

  if (s.tipo_cambio === "A") {
    if (!PERMITE_BAJA_ACCESO)
      throw reglaViolada(
        "Las reactivaciones todavía no están habilitadas sobre el schema de producción, " +
          "porque van de la mano con las bajas. La solicitud queda registrada.",
        "RN-016"
      );
    await cx.query(`update ${T("empleados")} set estado = true where id = $1`, [s.id_empleado]);
    return { aplicado: "empleado reactivado" };
  }

  return { aplicado: "sin efecto" };
}

/* ------------------------------------------------------------------ *
 *  PATCH /api/solicitudes/acceso/:id/cancelar — el solicitante la retira
 * ------------------------------------------------------------------ */

accesos.patch("/solicitudes/acceso/:id/cancelar", async (req, res) => {
  const id = enteroPositivo(req.params.id, "El folio");
  const idEmpresa = empresaDeSesion(req, req.body?.id_empresa);

  const r = await q(
    `update ${T("actualizaciones")}
        set estado_revision = $3${HAY_APROBADO ? ", aprobado = false" : ""},
            comentarios = coalesce(nullif(comentarios, ''), 'Retirada por el solicitante')
      where id = $1 and id_empresa = $2 and estado_revision = $4
      returning id`,
    [id, idEmpresa, REV_CANCELADA, REV_PENDIENTE]
  );
  if (!r.rows.length)
    throw reglaViolada("La solicitud no existe, no es de tu empresa o ya fue resuelta.");
  res.json({ id, aplicado: "cancelada" });
});

/* ------------------------------------------------------------------ *
 *  POST /api/empleados — alta directa (Flujo_Nuevo_Empleado)
 *  El flujo n8n inserta el empleado de inmediato, sin pasar por revisión.
 * ------------------------------------------------------------------ */

accesos.post("/empleados", async (req, res) => {
  const idEmpresa = empresaDeSesion(req, req.body?.id_empresa);
  const nombre = texto(req.body?.nombre_completo, "El nombre completo", { max: 160 });
  const capacitacion = booleano(req.body?.capacitacion, false);

  const fila = await enTransaccion(async (cx) => {
    await contratoDe(cx, idEmpresa);
    // RN-015 · sin duplicados; RN-027 · comparación sin acentos ni mayúsculas.
    const dup = await cx.query(
      `select id, nombre_completo from ${T("empleados")}
        where id_empresa = $1 and ${NORM("nombre_completo")} = ${NORM("$2")}
        limit 1`,
      [idEmpresa, nombre]
    );
    if (dup.rows.length)
      throw reglaViolada(
        `${dup.rows[0].nombre_completo} ya está registrado en tu empresa.`,
        "RN-015"
      );

    const r = await cx.query(
      `insert into ${T("empleados")} (nombre_completo, id_empresa, capacitacion, estado)
       values ($1,$2,$3,true)
       returning id, nombre_completo, id_empresa, capacitacion, estado`,
      [nombre, idEmpresa, capacitacion]
    );
    return r.rows[0];
  });

  res.status(201).json(fila);
});

/* ------------------------------------------------------------------ *
 *  POST /api/vehiculos — alta directa (Flujo_Nuevo_Vehiculo)
 *  Nota de schema: `vehiculos` no tiene id_empresa; el alcance se valida
 *  contra el empleado conductor.
 * ------------------------------------------------------------------ */

accesos.post("/vehiculos", async (req, res) => {
  const b = req.body ?? {};
  const idEmpresa = empresaDeSesion(req, b.id_empresa);
  const idEmpleado = enteroPositivo(b.id_empleado, "El conductor");
  const placas = texto(b.placas, "Las placas", { max: 20 });

  const fila = await enTransaccion(async (cx) => {
    const emp = await empleadoDeEmpresa(cx, idEmpleado, idEmpresa);
    if (!emp.estado)
      throw reglaViolada(`${emp.nombre_completo} está inactivo.`, "RN-016");

    const dup = await cx.query(
      `select v.id, v.placas from ${T("vehiculos")} v
        join ${T("empleados")} e on e.id = v.id_empleado
       where e.id_empresa = $1 and ${NORM("v.placas")} = ${NORM("$2")}
       limit 1`,
      [idEmpresa, placas]
    );
    if (dup.rows.length)
      throw reglaViolada(`La placa ${dup.rows[0].placas} ya está registrada.`, "RN-015");

    const r = await cx.query(
      `insert into ${T("vehiculos")} (marca, submarca, color, placas, id_tipo, id_empleado)
       values ($1,$2,$3,$4,$5,$6)
       returning id, marca, submarca, color, placas, id_tipo, id_empleado`,
      [
        texto(b.marca, "La marca", { max: 60, requerido: false }),
        texto(b.submarca, "La submarca", { max: 60, requerido: false }),
        texto(b.color, "El color", { max: 40, requerido: false }),
        placas.toUpperCase(),
        b.id_tipo ? enteroPositivo(b.id_tipo, "El tipo de vehículo") : null,
        idEmpleado,
      ]
    );
    return { ...r.rows[0], empleado: emp.nombre_completo };
  });

  res.status(201).json(fila);
});

/** Sugerencias de nombre para el buscador, normalizadas (RN-027). */
accesos.get("/empleados/buscar", async (req, res) => {
  const idEmpresa = empresaDeSesion(req, req.query.id_empresa);
  const t = norm(req.query.q ?? "");
  const r = await q(
    `select id, nombre_completo, estado from ${T("empleados")}
      where id_empresa = $1 and ${NORM("nombre_completo")} like '%' || $2 || '%'
      order by estado desc, nombre_completo limit 20`,
    [idEmpresa, t]
  );
  res.json(r.rows);
});
