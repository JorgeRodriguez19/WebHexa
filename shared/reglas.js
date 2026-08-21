/* ------------------------------------------------------------------ *
 *  Reglas de negocio del flujo n8n "Chatbot Hexa BETA - Whatsapp Meta"
 *  Módulo puro (sin dependencias) compartido por el servidor y la web,
 *  para que la validación del cliente y la del backend nunca divergan.
 *
 *  Los identificadores RN-### corresponden a la documentación funcional.
 * ------------------------------------------------------------------ */

/* ---------- horas ---------- */

/** "09:30" | "09:30:00" -> 570 */
export const toMin = (t) => {
  const [h, m] = String(t).split(":").map(Number);
  return h * 60 + (m || 0);
};

/** 570 -> "09:30" */
export const toHora = (min) =>
  `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

export const horasEntre = (a, b) => (toMin(b) - toMin(a)) / 60;

/**
 * RN-021 · solapamiento estricto: dos rangos choc­an si se traslapan,
 * pero NO si solo se tocan en el extremo (09:00–11:00 y 11:00–13:00 conviven).
 * Réplica de la condición `NOT (hora_fin <= $ini OR hora_inicio >= $fin)`
 * del nodo `Postgre_find_sala`.
 */
export const solapa = (a1, a2, b1, b2) => toMin(a1) < toMin(b2) && toMin(b1) < toMin(a2);

/** Rejilla de horas en pasos de 30 min. La Terraza cierra a las 24:00. */
export const APERTURA_TORRE = "08:00";
export const CIERRE_TORRE = "24:00";

export const rejillaHoras = (desde = APERTURA_TORRE, hasta = CIERRE_TORRE) => {
  const out = [];
  for (let m = toMin(desde); m <= toMin(hasta); m += 30) out.push(toHora(m));
  return out;
};

/* ---------- fechas ---------- */

/** Fecha local (no UTC) en formato "YYYY-MM-DD". */
export const isoLocal = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export const parseISO = (s) => {
  const [y, m, d] = String(s).slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
};

export const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

/** RN-019 · solo lunes a viernes. Replica el sub-workflow `Date_validation`. */
export const esDiaHabil = (iso) => {
  const g = parseISO(iso).getDay();
  return g >= 1 && g <= 5;
};

/**
 * RN-019 · una fecha de reservación es válida solo si es futura y hábil.
 * Devuelve el mismo contrato que `Date_validation`: { diaSemana, valida, razon }.
 */
export function validarFechaReservacion(iso, hoy = isoLocal()) {
  const diaSemana = DIAS[parseISO(iso).getDay()];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso).slice(0, 10)))
    return { diaSemana, valida: false, razon: "Formato de fecha inválido" };
  if (iso < hoy)
    return {
      diaSemana,
      valida: false,
      razon: "La fecha seleccionada ya pasó y no se puede reservar. Elige una fecha futura.",
    };
  if (!esDiaHabil(iso))
    return {
      diaSemana,
      valida: false,
      razon:
        "La fecha seleccionada cae en fin de semana y no está disponible para reservaciones. " +
        "Elige un día entre lunes y viernes.",
    };
  return { diaSemana, valida: true, razon: null };
}

/** Próximos `n` días hábiles a partir de mañana (sugerencia cuando no hay sala). */
export function diasHabilesSiguientes(n, desde = new Date()) {
  const out = [];
  const d = new Date(desde);
  d.setHours(0, 0, 0, 0);
  while (out.length < n) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() >= 1 && d.getDay() <= 5) out.push(isoLocal(d));
  }
  return out;
}

/* ---------- texto ---------- */

/**
 * RN-027 · comparación tolerante a acentos, mayúsculas/minúsculas y ñ.
 * En el flujo n8n esto se hace con `LOWER(unaccent(...))`, pero la extensión
 * `unaccent` NO está instalada en esta base, así que se normaliza en código
 * (y en SQL con `translate`, ver server/sql.js).
 */
export const norm = (s) =>
  (s ?? "")
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

/* ---------- salas ---------- */

/** RN-020 · bandas de capacidad. */
export const BANDAS = [8, 12, 22, 96, 150];
export const CAPACIDAD_MAXIMA = BANDAS[BANDAS.length - 1];

export const bandaPara = (n) => BANDAS.find((b) => n <= b) ?? null;
export const bandaSiguiente = (b) => BANDAS[BANDAS.indexOf(b) + 1] ?? null;

/** RN-022 · costo estimado = precio_hora × horas totales (en USD). */
export const costoEstimado = (precioHora, ini, fin) =>
  Number(precioHora) * horasEntre(ini, fin);

/* ---------- accesos ---------- */

/** Catálogo `development.tipo_accesos`. */
export const TIPO_ACCESO = { VIP: 1, VEHICULAR: 2, PEATONAL: 3 };

/** RN-011 / RN-012 · solo VIP y Vehicular consumen cupo del contrato. */
export const CONSUME_CUPO = { 1: "num_vip", 2: "num_vehiculares" };

/** `actualizaciones.tipo_cambio` — los cinco valores que usa el flujo n8n. */
export const TIPO_CAMBIO = {
  N: "Nueva tarjeta",
  R: "Reasignación de tarjeta",
  S: "Reposición de tarjeta",
  A: "Alta de empleado",
  B: "Baja de empleado",
};

/* ---------- estados de solicitud ---------- */

/*
 * La base ya trae una convención propia, distinta de la del prototipo:
 *   actualizaciones.estado_revision  ∈ {'P','F'}   (205 filas históricas)
 *   solicitudes_salas.estado         ∈ {'P','F'}   (76 filas históricas)
 *   la columna `aprobado` (boolean NULL) existe pero nunca se llenó.
 *
 * Se respeta esa convención y se usa `aprobado` para distinguir el desenlace,
 * que es justo para lo que fue añadida:
 *   'P' + null   -> Pendiente
 *   'F' + true   -> Aprobada
 *   'F' + false  -> Rechazada
 *   'F' + null   -> Finalizada (filas históricas, sin desenlace registrado)
 *   'C' + false  -> Cancelada por el solicitante
 *
 * OJO: el schema de producción (`beta`) NO tiene la columna `aprobado`. Ahí el
 * desenlace se registra con `usuario_revision` y, si es rechazo, anteponiendo
 * "Rechazada:" en `comentarios`. Por eso esta función acepta el comentario:
 * es la única señal disponible para distinguir un rechazo de una aprobación.
 */
export const REV_PENDIENTE = "P";
export const REV_FINALIZADA = "F";
export const REV_CANCELADA = "C";

const MARCA_RECHAZO = /^\s*rechazada\s*:/i;

export function estadoSolicitud(revision, aprobado, comentarios = null) {
  if (revision === REV_PENDIENTE) return "P";
  if (revision === REV_CANCELADA) return "C";
  if (aprobado === true) return "A";
  if (aprobado === false) return "R";
  // Sin columna `aprobado`: se deduce del comentario que dejó el revisor.
  if (comentarios && MARCA_RECHAZO.test(comentarios)) return "R";
  return "F";
}

export const ETIQUETA_ESTADO = {
  P: "Pendiente",
  A: "Aprobada",
  R: "Rechazada",
  C: "Cancelada",
  F: "Finalizada",
};

export const TONO_ESTADO = { P: "warn", A: "ok", R: "bad", C: "neutral", F: "neutral" };
