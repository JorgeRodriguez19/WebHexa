/* ------------------------------------------------------------------ *
 *  Diferencias entre los schemas soportados
 *
 *  `beta` (producción) y `development` NO son idénticos. Verificado por
 *  introspección con `npm run comparar`:
 *
 *    1. `accesos` NO tiene columna de vigencia en beta.
 *       En development existe `"Status"` (boolean). En beta una fila que
 *       existe está vigente, y la baja se hace copiando el acceso a
 *       `historico` y BORRÁNDOLO de `accesos`.
 *
 *    2. `actualizaciones.aprobado` NO existe en beta.
 *    3. `solicitudes_salas.aprobado` NO existe en beta.
 *       En producción el desenlace se registra con `usuario_revision`
 *       (lleno en las 55 y 25 filas respectivamente) y, si es rechazo, el
 *       motivo va en `comentarios`.
 *
 *    4. `empleados.fecha_capacitacion` solo existe en beta (no se usa).
 *
 *  Este módulo concentra esas diferencias para que el resto del código no
 *  tenga condicionales de schema desperdigados.
 * ------------------------------------------------------------------ */
import { ENTORNO, SCHEMA } from "./db.js";

/**
 * ¿Se está operando sobre la base real que comparte el chatbot?
 * OJO: no es lo mismo que "el schema se llama beta". La copia de Railway
 * también se llama `beta` (para que la estructura coincida) pero es una demo
 * con datos congelados, así que allí ENTORNO=demo y esto es false.
 */
export const ES_PRODUCCION = ENTORNO === "produccion";

/*
 * La ESTRUCTURA sí depende del nombre del schema: `beta` y sus copias no
 * tienen `accesos."Status"` ni la columna `aprobado`; `development` sí.
 */
const ESTRUCTURA_BETA = SCHEMA === "beta";

/** ¿Existe `accesos."Status"`? */
export const HAY_STATUS_ACCESO = !ESTRUCTURA_BETA;

/** ¿Existe la columna `aprobado` en actualizaciones y solicitudes_salas? */
export const HAY_APROBADO = !ESTRUCTURA_BETA;

/**
 * Bajas y reactivaciones de acceso (tipo_cambio B y A).
 * En beta implicarían borrar filas de `accesos` y escribir en `historico`.
 * Queda pendiente de decisión del cliente, así que están deshabilitadas.
 */
export const PERMITE_BAJA_ACCESO = !ESTRUCTURA_BETA;

/**
 * Expresión SQL para la vigencia de un acceso.
 * En beta no hay columna: si la fila existe, el acceso está vigente.
 */
export const statusAcceso = (alias = "a") =>
  HAY_STATUS_ACCESO ? `${alias}."Status"` : `true`;

/** Predicado "este acceso está vigente", para el WHERE. */
export const accesoVigente = (alias = "a") =>
  HAY_STATUS_ACCESO ? `${alias}."Status" is not false` : `true`;

/** Fragmento de ORDER BY que ordena por vigencia; vacío si no aplica. */
export const ordenPorVigencia = (alias = "a") =>
  HAY_STATUS_ACCESO ? `${alias}."Status" desc nulls last,` : ``;

/** Columna `aprobado` en un SELECT; se rellena con null donde no existe. */
export const columnaAprobado = (alias = "s") =>
  HAY_APROBADO ? `${alias}.aprobado` : `null::boolean as aprobado`;

/** Descripción legible del entorno, para /api/salud y la interfaz. */
export const entorno = {
  schema: SCHEMA,
  produccion: ES_PRODUCCION,
  etiqueta: ES_PRODUCCION ? "PRODUCCIÓN" : ENTORNO === "demo" ? "Demo" : "Desarrollo",
  permite_baja_acceso: PERMITE_BAJA_ACCESO,
  hay_status_acceso: HAY_STATUS_ACCESO,
  hay_aprobado: HAY_APROBADO,
};
