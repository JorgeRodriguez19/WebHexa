/* Presentación: fechas legibles y dinero. La lógica de negocio vive en
 * shared/reglas.js para que servidor y web usen exactamente la misma. */

import { parseISO } from "../../shared/reglas.js";

export const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
export const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

export const fechaLarga = (iso) => {
  const d = parseISO(iso);
  return `${DIAS[d.getDay()]} ${d.getDate()} de ${MESES[d.getMonth()]}`;
};

export const fechaCorta = (iso) => {
  const d = parseISO(iso);
  return `${String(d.getDate()).padStart(2, "0")} ${MESES[d.getMonth()]}`;
};

export const diaDe = (iso) => String(parseISO(iso).getDate()).padStart(2, "0");
export const mesDe = (iso) => MESES[parseISO(iso).getMonth()];

/**
 * `salas.precio_hora` está en dólares: el prompt del Salas_Agent presenta el
 * costo estimado en USD y los valores de la tabla (25, 50, 150, 1000) lo
 * confirman. El prototipo mostraba MXN; se corrige para no engañar al usuario.
 */
export const dinero = (n) =>
  `$${Number(n || 0).toLocaleString("es-MX", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} USD`;

export const folioAcceso = (id) => `SOL-${String(id).padStart(4, "0")}`;
export const folioSala = (id) => `RES-${String(id).padStart(4, "0")}`;

/** "08:00" o "08:00:00" -> "08:00" */
export const hhmm = (t) => (t ? String(t).slice(0, 5) : t);
