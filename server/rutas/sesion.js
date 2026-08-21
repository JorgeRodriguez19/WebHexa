import { Router } from "express";
import {
  credencialPorCorreo,
  emitirToken,
  exigirSesion,
  marcarAcceso,
  verificar,
} from "../auth.js";
import { ErrorHttp, texto } from "../util.js";

export const sesion = Router();

/* ------------------------------------------------------------------ *
 *  Límite de intentos
 *
 *  Al quedar la web expuesta a internet, el login es la única puerta y sin
 *  freno se puede probar contraseñas en masa. Se cuentan los fallos por IP y
 *  por correo: así ni una IP puede atacar muchas cuentas, ni muchas IPs una
 *  sola cuenta. Se guarda en memoria a propósito —basta para un servicio
 *  pequeño y evita otra tabla—; al reiniciar se olvida.
 * ------------------------------------------------------------------ */
const MAX_INTENTOS = Number(process.env.LOGIN_MAX_INTENTOS || 8);
const VENTANA_MS = Number(process.env.LOGIN_VENTANA_MIN || 15) * 60_000;

const intentos = new Map(); // clave -> { n, hasta }

function revisarFreno(clave) {
  const reg = intentos.get(clave);
  if (!reg) return;
  if (reg.hasta < Date.now()) return intentos.delete(clave);
  if (reg.n >= MAX_INTENTOS) {
    const min = Math.ceil((reg.hasta - Date.now()) / 60_000);
    throw new ErrorHttp(
      429,
      `Demasiados intentos fallidos. Espera ${min} ${min === 1 ? "minuto" : "minutos"} e inténtalo de nuevo.`
    );
  }
}

function anotarFallo(clave) {
  const reg = intentos.get(clave);
  if (!reg || reg.hasta < Date.now()) intentos.set(clave, { n: 1, hasta: Date.now() + VENTANA_MS });
  else reg.n += 1;
}

const limpiar = (claves) => claves.forEach((c) => intentos.delete(c));

/* Purga periódica para que el mapa no crezca sin límite. */
setInterval(() => {
  const ahora = Date.now();
  for (const [k, v] of intentos) if (v.hasta < ahora) intentos.delete(k);
}, 10 * 60_000).unref();

/**
 * Datos de sesión que se devuelven a la web. La empresa va aquí y también
 * dentro del token firmado: el cliente la muestra, el servidor la impone.
 */
const perfilDe = (c) => ({
  correo: c.correo,
  nombre: c.nombre_completo ?? "Administración Hexa",
  id_usuario: c.id_usuario ?? null,
  id_empresa: c.id_empresa ?? null,
  empresa: c.es_superusuario ? null : (c.empresa ?? null),
  superusuario: c.es_superusuario,
});

/* ------------------------------------------------------------------ *
 *  POST /api/auth/login
 * ------------------------------------------------------------------ */
sesion.post("/auth/login", async (req, res) => {
  const b = req.body ?? {};
  const correo = texto(b.correo, "El correo", { max: 160 });
  const password = typeof b.password === "string" ? b.password : "";

  if (!password) throw new ErrorHttp(400, "Escribe tu contraseña.");

  const porIp = `ip:${req.ip}`;
  const porCorreo = `correo:${correo.toLowerCase()}`;
  revisarFreno(porIp);
  revisarFreno(porCorreo);

  const c = await credencialPorCorreo(correo);

  /*
   * Mismo mensaje para "no existe" y "contraseña incorrecta": decir cuál de
   * las dos falló permitiría averiguar qué correos están registrados.
   */
  const generico = new ErrorHttp(401, "Correo o contraseña incorrectos.");
  if (!c || !verificar(password, c.password_hash)) {
    anotarFallo(porIp);
    anotarFallo(porCorreo);
    throw generico;
  }

  limpiar([porIp, porCorreo]);

  if (!c.estado) throw new ErrorHttp(403, "Esta cuenta está desactivada.");
  if (c.id_usuario && c.usuario_activo === false)
    throw new ErrorHttp(403, "El usuario está dado de baja en el sistema.");
  if (!c.es_superusuario && c.id_empresa == null)
    throw new ErrorHttp(403, "Tu cuenta no tiene una empresa asignada.");

  await marcarAcceso(c.id);

  const perfil = perfilDe(c);
  const token = emitirToken({
    cred: c.id,
    correo: perfil.correo,
    id_usuario: perfil.id_usuario,
    id_empresa: perfil.id_empresa,
    super: perfil.superusuario,
    nombre: perfil.nombre,
  });

  res.json({ token, perfil });
});

/* ------------------------------------------------------------------ *
 *  GET /api/auth/yo — valida el token guardado al recargar la página
 * ------------------------------------------------------------------ */
sesion.get("/auth/yo", async (req, res) => {
  const s = exigirSesion(req);
  const c = await credencialPorCorreo(s.correo ?? "");

  // El token es válido, pero la credencial pudo desactivarse desde entonces.
  if (c && (!c.estado || (c.id_usuario && c.usuario_activo === false)))
    throw new ErrorHttp(401, "Tu cuenta ya no está activa.");

  res.json({
    perfil: {
      correo: c?.correo ?? null,
      nombre: s.nombre,
      id_usuario: s.id_usuario,
      id_empresa: s.id_empresa,
      empresa: c?.es_superusuario ? null : (c?.empresa ?? null),
      superusuario: !!s.super,
    },
  });
});
