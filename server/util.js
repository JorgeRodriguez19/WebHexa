/* ------------------------------------------------------------------ *
 *  Utilidades de validación de entrada.
 *  Todo lo que llega del cliente pasa por aquí antes de tocar SQL.
 * ------------------------------------------------------------------ */

/** Error con código HTTP, para que el manejador central responda bien. */
export class ErrorHttp extends Error {
  constructor(status, mensaje, rn = null) {
    super(mensaje);
    this.status = status;
    this.rn = rn;
  }
}

export const malaPeticion = (mensaje, rn = null) => new ErrorHttp(400, mensaje, rn);
export const reglaViolada = (mensaje, rn = null) => new ErrorHttp(422, mensaje, rn);

export function entero(valor, campo) {
  const n = Number(valor);
  if (!Number.isInteger(n)) throw malaPeticion(`${campo} debe ser un número entero.`);
  return n;
}

export function enteroPositivo(valor, campo) {
  const n = entero(valor, campo);
  if (n <= 0) throw malaPeticion(`${campo} debe ser mayor que cero.`);
  return n;
}

export function empresaDe(valor) {
  const n = Number(valor);
  if (!Number.isInteger(n) || n <= 0) throw malaPeticion("Identificador de empresa inválido.");
  return n;
}

export function limiteDe(valor, porDefecto) {
  const n = Number(valor);
  if (!Number.isInteger(n) || n <= 0) return porDefecto;
  return Math.min(n, 1000);
}

export function texto(valor, campo, { max = 400, requerido = true } = {}) {
  const s = (valor ?? "").toString().trim();
  if (!s) {
    if (requerido) throw malaPeticion(`${campo} es obligatorio.`);
    return null;
  }
  if (s.length > max) throw malaPeticion(`${campo} no puede exceder ${max} caracteres.`);
  return s;
}

export function booleano(valor, porDefecto = false) {
  if (valor === true || valor === "true") return true;
  if (valor === false || valor === "false") return false;
  return porDefecto;
}

export function fechaISO(valor, campo) {
  const s = (valor ?? "").toString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw malaPeticion(`${campo} debe tener formato YYYY-MM-DD.`);
  return s;
}

export function hora(valor, campo) {
  const s = (valor ?? "").toString();
  if (!/^([01]\d|2[0-4]):[0-5]\d(:[0-5]\d)?$/.test(s))
    throw malaPeticion(`${campo} debe tener formato HH:MM.`);
  return s.slice(0, 5);
}

/**
 * Perfil que ejecuta la acción. El panel no tiene autenticación (se eligió
 * el selector de empresa/perfil del prototipo), así que el perfil llega en
 * el cuerpo de la petición y solo se usa para autorizar las resoluciones.
 */
export function exigirAdministracion(cuerpo) {
  if (cuerpo?.perfil !== "administracion")
    throw new ErrorHttp(403, "Solo el perfil Administración Hexa puede resolver solicitudes.");
}
