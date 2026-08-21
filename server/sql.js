import { T } from "./db.js";
import { accesoVigente, columnaAprobado, ordenPorVigencia, statusAcceso } from "./capacidades.js";

/* ------------------------------------------------------------------ *
 *  RN-027 · búsqueda insensible a acentos, mayúsculas y ñ.
 *  El flujo n8n usa `LOWER(unaccent(...))`, pero la extensión `unaccent`
 *  NO está instalada en esta base (solo plpgsql), así que se replica con
 *  `translate`, que no requiere extensiones.
 * ------------------------------------------------------------------ */
const ACENTOS = "áàäâãéèëêíìïîóòöôõúùüûñÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑ";
const LLANOS = "aaaaaeeeeiiiiooooouuuunAAAAAEEEEIIIIOOOOOUUUUN";

/** Envuelve una expresión SQL para compararla normalizada. */
export const NORM = (expr) => `lower(translate(${expr}, '${ACENTOS}', '${LLANOS}'))`;

/* ------------------------------------------------------------------ *
 *  Vistas de lectura
 *  Todas resuelven los catálogos por JOIN para que el frontend reciba
 *  descripciones y no ids sueltos, y todas están acotadas por empresa
 *  (RN-005) mediante parámetro, nunca por interpolación de texto.
 * ------------------------------------------------------------------ */

/**
 * Accesos vigentes e históricos de una empresa.
 * Nota de schema: en `development` la vigencia es la columna "Status" (con
 * mayúscula inicial, hay que entrecomillarla). En `beta` esa columna NO
 * existe: un acceso que está en la tabla está vigente, y la baja se hace
 * moviéndolo a `historico`. Ver server/capacidades.js.
 */
export const SQL_ACCESOS = `
  select a.id,
         a.id_empresa,
         a.id_empleado,
         a.num_tarjeta,
         a.id_horario,
         a.id_tipo,
         a.num_chip,
         a.fecha_solicitud,
         a.fecha_asignacion,
         a.num_contrato,
         a.robotico,
         ${statusAcceso("a")} as status,
         e.nombre_completo   as empleado,
         e.estado            as empleado_activo,
         t.descripcion       as tipo,
         h.tipo              as horario,
         h.descripcion       as horario_descripcion
    from ${T("accesos")} a
    join ${T("empleados")}     e on e.id = a.id_empleado
    join ${T("tipo_accesos")}  t on t.id = a.id_tipo
    join ${T("horarios")}      h on h.id = a.id_horario
   where a.id_empresa = $1
   order by ${ordenPorVigencia("a")} a.id desc`;

/** Solicitudes de acceso/personal (`actualizaciones`) con nombres resueltos. */
export const SQL_ACTUALIZACIONES = `
  select s.id,
         s.id_empresa,
         s.id_empleado,
         s.num_tarjeta,
         s.id_horario,
         s.id_tipo,
         s.num_chip,
         s.estado_revision,
         s.tipo_cambio,
         s.fecha_solicitud,
         s.num_contrato,
         s.comentarios,
         s.id_usuario,
         s.usuario_revision,
         s.robotico,
         ${columnaAprobado("s")},
         e.nombre_completo as empleado,
         u.nombre_completo as solicitante,
         t.descripcion     as tipo,
         h.tipo            as horario,
         em.nombre         as empresa
    from ${T("actualizaciones")} s
    left join ${T("empleados")}    e  on e.id  = s.id_empleado
    left join ${T("usuarios")}     u  on u.id  = s.id_usuario
    left join ${T("tipo_accesos")} t  on t.id  = s.id_tipo
    left join ${T("horarios")}     h  on h.id  = s.id_horario
    left join ${T("empresas")}     em on em.id = s.id_empresa
   where ($1::smallint is null or s.id_empresa = $1)
   order by (s.estado_revision = 'P') desc, s.id desc
   limit $2`;

/**
 * Vehículos de una empresa.
 * Nota de schema: `vehiculos` NO tiene id_empresa; el alcance por empresa
 * se obtiene por el empleado conductor (FK vehiculos.id_empleado).
 */
export const SQL_VEHICULOS = `
  select v.id,
         v.marca,
         v.submarca,
         v.color,
         v.placas,
         v.id_tipo,
         v.id_empleado,
         e.nombre_completo as empleado,
         e.estado          as empleado_activo,
         e.id_empresa,
         tv.descripcion    as tipo
    from ${T("vehiculos")} v
    join ${T("empleados")} e  on e.id  = v.id_empleado
    left join ${T("tipo_vehiculos")} tv on tv.id = v.id_tipo
   where e.id_empresa = $1
   order by v.id desc`;

/** Empleados de una empresa, con el conteo de tarjetas vigentes. */
export const SQL_EMPLEADOS = `
  select e.id,
         e.nombre_completo,
         e.id_empresa,
         e.capacitacion,
         e.estado,
         coalesce(
           (select count(*)::int from ${T("accesos")} a
             where a.id_empleado = e.id and ${accesoVigente("a")}), 0
         ) as tarjetas
    from ${T("empleados")} e
   where e.id_empresa = $1
   order by e.estado desc, e.nombre_completo`;

/**
 * Reservaciones aprobadas.
 * Nota de schema: `reservaciones` NO tiene id_empresa; se deriva del usuario
 * que la solicitó (FK reservaciones.id_usuario).
 */
export const SQL_RESERVACIONES = `
  select r.id,
         r.id_sala,
         r.id_usuario,
         r.fecha_reservacion,
         r.hora_inicio,
         r.hora_fin,
         r.tipo_evento,
         r.num_invitados,
         r.fecha_aprobacion,
         r.fecha_fin,
         r.nombre_documento,
         u.id_empresa,
         u.nombre_completo as solicitante,
         s.nombre          as sala,
         s.precio_hora,
         s.piso,
         s.capacidad
    from ${T("reservaciones")} r
    join ${T("usuarios")} u on u.id = r.id_usuario
    join ${T("salas")}    s on s.id = r.id_sala
   where r.fecha_reservacion >= $1
   order by r.fecha_reservacion, r.hora_inicio`;

/** Solicitudes de sala. */
export const SQL_SOLICITUDES_SALAS = `
  select s.id,
         s.id_sala,
         s.id_usuario,
         s.fecha_registro,
         s.fecha_reservacion,
         s.hora_inicio,
         s.hora_fin,
         s.estado,
         s.tipo_evento,
         s.num_invitados,
         s.fecha_revision,
         s.comentarios,
         s.usuario_revision,
         s.servicios,
         ${columnaAprobado("s")},
         u.id_empresa,
         u.nombre_completo as solicitante,
         sa.nombre         as sala,
         sa.precio_hora,
         sa.piso,
         sa.capacidad,
         em.nombre         as empresa
    from ${T("solicitudes_salas")} s
    join ${T("usuarios")} u  on u.id  = s.id_usuario
    join ${T("salas")}    sa on sa.id = s.id_sala
    left join ${T("empresas")} em on em.id = u.id_empresa
   where ($1::int is null or u.id_empresa = $1)
   order by (s.estado = 'P') desc, s.fecha_reservacion desc, s.id desc
   limit $2`;

/**
 * RN-020 / RN-021 · búsqueda de sala disponible.
 * Traducción literal del nodo `Postgre_find_sala` del flujo n8n, con una
 * corrección deliberada: el original solo excluye choques contra
 * `reservaciones` (aprobadas) y por eso permite dos solicitudes pendientes
 * en conflicto (observación 6 de la documentación). Aquí se excluyen también
 * las solicitudes en estado 'P'.
 *
 *  $1 num_invitados (capacidad mínima)   $4 hora_fin
 *  $2 banda_max     (capacidad máxima)   $5 fecha
 *  $3 hora_inicio                        $6 id de reservación a ignorar (o null)
 */
export const SQL_SALAS_DISPONIBLES = `
  select s.id, s.nombre, s.capacidad, s.piso, s.precio_hora,
         s.horario_apertura, s.horario_cierre
    from ${T("salas")} s
   where s.capacidad >= $1
     and s.capacidad <= $2
     and s.horario_apertura <= $3::time
     and s.horario_cierre   >= $4::time
     and not exists (
           select 1
             from ${T("reservaciones")} r
            where r.id_sala = s.id
              and r.fecha_reservacion = $5::date
              and ($6::bigint is null or r.id <> $6::bigint)
              and not (r.hora_fin <= $3::time or r.hora_inicio >= $4::time)
         )
     and not exists (
           select 1
             from ${T("solicitudes_salas")} p
            where p.id_sala = s.id
              and p.estado = 'P'
              and p.fecha_reservacion = $5::date
              and not (p.hora_fin <= $3::time or p.hora_inicio >= $4::time)
         )
   order by (s.capacidad - $1) asc, s.precio_hora asc`;

/**
 * Ocupación de todas las salas en una fecha: reservaciones aprobadas +
 * solicitudes pendientes. Alimenta la franja horaria del panel.
 */
export const SQL_OCUPACION = `
  select r.id::text        as ref,
         'aprobada'        as origen,
         r.id_sala,
         r.hora_inicio,
         r.hora_fin,
         r.tipo_evento,
         r.num_invitados,
         u.id_empresa,
         u.nombre_completo as solicitante
    from ${T("reservaciones")} r
    join ${T("usuarios")} u on u.id = r.id_usuario
   where r.fecha_reservacion = $1::date
  union all
  select s.id::text        as ref,
         'pendiente'       as origen,
         s.id_sala,
         s.hora_inicio,
         s.hora_fin,
         s.tipo_evento,
         s.num_invitados,
         u.id_empresa,
         u.nombre_completo as solicitante
    from ${T("solicitudes_salas")} s
    join ${T("usuarios")} u on u.id = s.id_usuario
   where s.fecha_reservacion = $1::date
     and s.estado = 'P'
   order by hora_inicio`;

/**
 * RN-011 / RN-012 · cupos del contrato por tipo de acceso.
 * `asignados` cuenta accesos vigentes; `pendientes` cuenta solicitudes de
 * tarjeta nueva aún sin resolver. El flujo n8n solo mira `asignados`, lo que
 * permite sobre-reservar el cupo con varias solicitudes 'P' simultáneas;
 * aquí se cuentan ambas, como hace el prototipo.
 */
export const SQL_CUPOS = `
  select t.id                as id_tipo,
         t.descripcion       as tipo,
         coalesce(a.n, 0)    as asignados,
         coalesce(p.n, 0)    as pendientes
    from ${T("tipo_accesos")} t
    left join (
      select id_tipo, count(*)::int n from ${T("accesos")} a
       where a.id_empresa = $1 and ${accesoVigente("a")}
       group by id_tipo
    ) a on a.id_tipo = t.id
    left join (
      select id_tipo, count(*)::int n from ${T("actualizaciones")}
       where id_empresa = $1 and estado_revision = 'P' and tipo_cambio = 'N'
       group by id_tipo
    ) p on p.id_tipo = t.id
   order by t.id`;

/**
 * Inventario de tarjetas libres: existen en `tarjetas`, están habilitadas y
 * no figuran en `accesos`. Se usa al aprobar una tarjeta nueva o una
 * reposición, porque `accesos.num_tarjeta` es NOT NULL y FK a `tarjetas`.
 */
export const SQL_TARJETAS_LIBRES = `
  select t.id, t.estado, t.id_empresa
    from ${T("tarjetas")} t
   where t.estado is true
     and (t.id_empresa is null or t.id_empresa = $1)
     and not exists (select 1 from ${T("accesos")} a where a.num_tarjeta = t.id)
   order by t.id_empresa nulls last, t.id`;
