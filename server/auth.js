/* ------------------------------------------------------------------ *
 *  Autenticación y sesión
 *
 *  La base no traía credenciales: `usuarios` solo tiene datos de contacto
 *  (nombre, teléfono, correo, id_telegram) porque el chatbot identifica a la
 *  gente por su número de WhatsApp. Para la web se añadió una tabla propia,
 *  `web_credenciales`, que NO toca ninguna tabla del chatbot.
 *
 *  Decisiones:
 *  - Hash con scrypt de `node:crypto`. Sin dependencias externas y con sal
 *    por credencial; nunca se guarda la contraseña en claro.
 *  - Sesión sin estado: un token firmado con HMAC-SHA256. No hace falta
 *    tabla de sesiones ni limpieza de expiradas.
 *  - **La empresa del usuario viaja DENTRO del token firmado.** Es la clave
 *    del aislamiento: el cliente no puede pedir datos de otra empresa
 *    cambiando un parámetro, porque el servidor ignora lo que venga en el
 *    cuerpo y usa lo que dice la sesión.
 * ------------------------------------------------------------------ */
import crypto from "node:crypto";
import { q, T } from "./db.js";
import { ErrorHttp } from "./util.js";

const DIAS = 86_400_000;
const VIGENCIA_MS = 12 * 60 * 60 * 1000; // 12 h

/* ---------- secreto de firma ---------- */

let secreto = process.env.SESION_SECRETO || "";
if (!secreto) {
  // Sin secreto configurado se genera uno al vuelo: la aplicación funciona,
  // pero todas las sesiones caducan al reiniciar la API. Se avisa.
  secreto = crypto.randomBytes(32).toString("hex");
  console.warn(
    "[hexa] SESION_SECRETO no está definido en .env: se generó uno temporal.\n" +
      "       Las sesiones se invalidarán al reiniciar la API."
  );
}

/* ---------- contraseñas ---------- */

/** Genera `scrypt$<sal>$<hash>` para guardar en la base. */
export function hashear(password) {
  const sal = crypto.randomBytes(16).toString("hex");
  const h = crypto.scryptSync(password, sal, 64).toString("hex");
  return `scrypt$${sal}$${h}`;
}

/** Comparación en tiempo constante contra el formato de `hashear`. */
export function verificar(password, guardado) {
  if (typeof guardado !== "string") return false;
  const [algo, sal, esperado] = guardado.split("$");
  if (algo !== "scrypt" || !sal || !esperado) return false;
  const calculado = crypto.scryptSync(password, sal, 64).toString("hex");
  const a = Buffer.from(calculado, "hex");
  const b = Buffer.from(esperado, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* ---------- tokens ---------- */

const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
const firmar = (dato) => crypto.createHmac("sha256", secreto).update(dato).digest("base64url");

export function emitirToken(sesion) {
  const cuerpo = b64({ ...sesion, exp: Date.now() + VIGENCIA_MS });
  return `${cuerpo}.${firmar(cuerpo)}`;
}

/** Devuelve la sesión si el token es válido y no ha expirado; null si no. */
export function leerToken(token) {
  if (typeof token !== "string" || !token.includes(".")) return null;
  const [cuerpo, firma] = token.split(".");
  if (!cuerpo || !firma) return null;

  const esperada = firmar(cuerpo);
  const a = Buffer.from(firma);
  const b = Buffer.from(esperada);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  let datos;
  try {
    datos = JSON.parse(Buffer.from(cuerpo, "base64url").toString());
  } catch {
    return null;
  }
  if (!datos?.exp || datos.exp < Date.now()) return null;
  return datos;
}

/* ---------- consulta de credenciales ---------- */

/**
 * Busca una credencial por correo, con los datos del usuario ligado.
 * `id_usuario` puede ser null: así se modela un superusuario de
 * administración que no pertenece a ninguna empresa inquilina.
 */
export async function credencialPorCorreo(correo) {
  const r = await q(
    `select c.id, c.correo, c.password_hash, c.es_superusuario, c.estado,
            c.id_usuario, u.nombre_completo, u.id_empresa,
            e.nombre as empresa, u.estado as usuario_activo
       from ${T("web_credenciales")} c
       left join ${T("usuarios")} u on u.id = c.id_usuario
       left join ${T("empresas")} e on e.id = u.id_empresa
      where lower(c.correo) = lower($1)`,
    [correo]
  );
  return r.rows[0] ?? null;
}

export async function marcarAcceso(idCredencial) {
  await q(`update ${T("web_credenciales")} set ultimo_acceso = now() where id = $1`, [idCredencial]);
}

/* ---------- middleware ---------- */

/** Lee el token del encabezado y deja la sesión en `req.sesion` (o null). */
export function conSesion(req, _res, siguiente) {
  const cabecera = req.headers.authorization || "";
  const token = cabecera.startsWith("Bearer ") ? cabecera.slice(7) : null;
  req.sesion = token ? leerToken(token) : null;
  siguiente();
}

/** Corta la petición si no hay sesión válida. */
export function exigirSesion(req) {
  if (!req.sesion) throw new ErrorHttp(401, "Tu sesión expiró o no has iniciado sesión.");
  return req.sesion;
}

/** Corta la petición si la sesión no es de un superusuario. */
export function exigirSuperusuario(req) {
  const s = exigirSesion(req);
  if (!s.super)
    throw new ErrorHttp(
      403,
      "Solo un superusuario puede realizar esta acción. Tu cuenta solo administra tu empresa."
    );
  return s;
}

/**
 * Empresa sobre la que puede operar esta petición.
 *
 * Para un usuario normal es SIEMPRE la de su sesión, sin importar lo que pida
 * el cliente. Un superusuario puede apuntar a otra con `?id_empresa=` o en el
 * cuerpo, porque su función es revisar las solicitudes de todos los inquilinos.
 */
export function empresaDeSesion(req, solicitada = null) {
  const s = exigirSesion(req);
  if (!s.super) {
    if (s.id_empresa == null)
      throw new ErrorHttp(403, "Tu cuenta no tiene una empresa asignada.");
    return s.id_empresa;
  }
  const n = Number(solicitada);
  return Number.isInteger(n) && n > 0 ? n : s.id_empresa ?? null;
}

/**
 * Usuario a cuyo nombre se registra la solicitud.
 *
 * `actualizaciones.id_usuario` y `solicitudes_salas.id_usuario` son NOT NULL,
 * así que hace falta uno siempre. Para una cuenta normal es el de su sesión.
 * Un superusuario no está ligado a ninguna empresa, así que si quiere
 * registrar algo tiene que indicar explícitamente en nombre de quién.
 */
export function usuarioDeSesion(req, solicitado = null) {
  const s = exigirSesion(req);
  if (!s.super) {
    if (!s.id_usuario)
      throw new ErrorHttp(
        403,
        "Tu cuenta no está ligada a un usuario del sistema, así que no puede registrar movimientos."
      );
    return s.id_usuario;
  }
  const n = Number(solicitado);
  if (Number.isInteger(n) && n > 0) return n;
  throw new ErrorHttp(
    400,
    "Como superusuario debes indicar el usuario solicitante (id_usuario) al registrar un movimiento."
  );
}

export const VIGENCIA_SESION_MS = VIGENCIA_MS;
export const UN_DIA_MS = DIAS;
