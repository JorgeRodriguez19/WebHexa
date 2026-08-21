import { Router } from "express";
import { q, T } from "../db.js";
import {
  SQL_ACCESOS,
  SQL_ACTUALIZACIONES,
  SQL_CUPOS,
  SQL_EMPLEADOS,
  SQL_OCUPACION,
  SQL_RESERVACIONES,
  SQL_SOLICITUDES_SALAS,
  SQL_TARJETAS_LIBRES,
  SQL_VEHICULOS,
} from "../sql.js";
import { isoLocal } from "../../shared/reglas.js";
import { empresaDe, limiteDe } from "../util.js";
import { empresaDeSesion, exigirSesion, exigirSuperusuario } from "../auth.js";
import { ErrorHttp } from "../util.js";

export const lectura = Router();

/* ------------------------------------------------------------------ *
 *  Alcance por empresa (RN-005)
 *
 *  La empresa sale SIEMPRE de la sesión firmada, nunca de un parámetro que
 *  pueda cambiar el cliente. Si una cuenta normal pide otra empresa se
 *  responde 403 en lugar de devolver la suya en silencio: así un intento de
 *  salirse del alcance es visible y no se confunde con un error de la web.
 * ------------------------------------------------------------------ */
function alcance(req, solicitada = null) {
  const s = exigirSesion(req);
  if (s.super) return { id: empresaDeSesion(req, solicitada), sesion: s };
  if (solicitada != null && Number(solicitada) !== s.id_empresa)
    throw new ErrorHttp(403, "Solo puedes consultar los datos de tu propia empresa.");
  return { id: empresaDeSesion(req), sesion: s };
}

/**
 * Catálogos. Las salas y los catálogos de tipos son del edificio y los ve
 * cualquiera; la lista de empresas y de usuarios se acota a la sesión.
 */
lectura.get("/catalogos", async (req, res) => {
  const s = exigirSesion(req);

  const [empresas, usuarios, salas, horarios, tiposAcceso, tiposVehiculo] = await Promise.all([
    q(
      `select e.id, e.nombre, e.num_vehiculares, e.num_vip, e.num_contrato, e."Status" as status,
              (select count(*)::int from ${T("empleados")} p where p.id_empresa = e.id) as empleados,
              (select count(*)::int from ${T("usuarios")}  u where u.id_empresa = e.id) as usuarios
         from ${T("empresas")} e
        where e."Status" is not false
          and ($1::boolean is true or e.id = $2)
        order by e.nombre`,
      [!!s.super, s.id_empresa]
    ),
    q(
      `select u.id, u.nombre_completo, u.id_empresa, u.correo, u.estado, u.whatsapp
         from ${T("usuarios")} u
        where ($1::boolean is true or u.id_empresa = $2)
        order by u.nombre_completo`,
      [!!s.super, s.id_empresa]
    ),
    q(`select id, nombre, capacidad, precio_hora, piso, horario_apertura, horario_cierre
         from ${T("salas")} order by capacidad, nombre`),
    q(`select id, tipo, descripcion from ${T("horarios")} order by id`),
    q(`select id, descripcion from ${T("tipo_accesos")} order by id`),
    q(`select id, descripcion from ${T("tipo_vehiculos")} order by id`),
  ]);

  res.json({
    hoy: isoLocal(),
    empresas: empresas.rows,
    usuarios: usuarios.rows,
    salas: salas.rows,
    horarios: horarios.rows,
    tipos_acceso: tiposAcceso.rows,
    tipos_vehiculo: tiposVehiculo.rows,
  });
});

/**
 * Todo lo que necesita el panel para una empresa, en una sola llamada.
 * RN-005 · el alcance se aplica en el servidor, no en el cliente.
 */
lectura.get("/empresa/:id/panel", async (req, res) => {
  const { id } = alcance(req, empresaDe(req.params.id));
  const limite = limiteDe(req.query.limite, 400);

  const [empresa, empleados, accesos, vehiculos, cupos, actualizaciones, solicitudes, tarjetas] =
    await Promise.all([
      q(
        `select id, nombre, num_vehiculares, num_vip, num_contrato
           from ${T("empresas")} where id = $1`,
        [id]
      ),
      q(SQL_EMPLEADOS, [id]),
      q(SQL_ACCESOS, [id]),
      q(SQL_VEHICULOS, [id]),
      q(SQL_CUPOS, [id]),
      q(SQL_ACTUALIZACIONES, [id, limite]),
      q(SQL_SOLICITUDES_SALAS, [id, limite]),
      q(SQL_TARJETAS_LIBRES, [id]),
    ]);

  if (!empresa.rows.length) return res.status(404).json({ error: "La empresa no existe." });

  res.json({
    hoy: isoLocal(),
    empresa: empresa.rows[0],
    empleados: empleados.rows,
    accesos: accesos.rows,
    vehiculos: vehiculos.rows,
    cupos: cupos.rows,
    actualizaciones: actualizaciones.rows,
    solicitudes_salas: solicitudes.rows,
    tarjetas_libres: tarjetas.rows.length,
  });
});

/** Reservaciones aprobadas de tu empresa desde una fecha. */
lectura.get("/reservaciones", async (req, res) => {
  const { id, sesion } = alcance(req);
  const desde = /^\d{4}-\d{2}-\d{2}$/.test(req.query.desde || "") ? req.query.desde : isoLocal();
  const r = await q(SQL_RESERVACIONES, [desde]);
  const propias = sesion.super ? r.rows : r.rows.filter((x) => x.id_empresa === id);
  res.json(propias);
});

/**
 * Ocupación de todas las salas en un día: aprobadas + pendientes.
 *
 * Se devuelven TODAS las salas —hace falta para no chocar al reservar— pero de
 * los bloques ajenos NO se revela el evento, el solicitante ni el número de
 * invitados. Antes ese recorte lo hacía el cliente; ahora lo hace el servidor,
 * que es el único sitio donde de verdad protege (RN-005).
 */
lectura.get("/ocupacion/:fecha", async (req, res) => {
  const { id, sesion } = alcance(req);
  const { fecha } = req.params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha))
    return res.status(400).json({ error: "Fecha inválida, se espera YYYY-MM-DD." });

  const r = await q(SQL_OCUPACION, [fecha]);
  const visible = r.rows.map((o) =>
    sesion.super || o.id_empresa === id
      ? o
      : {
          ref: o.ref,
          origen: o.origen,
          id_sala: o.id_sala,
          hora_inicio: o.hora_inicio,
          hora_fin: o.hora_fin,
          id_empresa: null,
          tipo_evento: null,
          num_invitados: null,
          solicitante: null,
          ajena: true,
        }
  );
  res.json(visible);
});

/**
 * Bandeja de administración: solicitudes de todas las empresas.
 * Reservada a superusuarios; un Office Manager solo ve las de su empresa
 * a través de /empresa/:id/panel.
 */
lectura.get("/administracion/solicitudes", async (req, res) => {
  exigirSuperusuario(req);
  const limite = limiteDe(req.query.limite, 300);
  const [acc, sal] = await Promise.all([
    q(SQL_ACTUALIZACIONES, [null, limite]),
    q(SQL_SOLICITUDES_SALAS, [null, limite]),
  ]);
  res.json({ hoy: isoLocal(), actualizaciones: acc.rows, solicitudes_salas: sal.rows });
});
