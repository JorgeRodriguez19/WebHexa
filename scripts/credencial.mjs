/**
 * Administra las credenciales de acceso a la web.
 *
 *   node scripts/credencial.mjs <schema> listar
 *   node scripts/credencial.mjs <schema> clave <correo> <nueva>
 *   node scripts/credencial.mjs <schema> crear <correo> <clave> <id_usuario|super>
 *   node scripts/credencial.mjs <schema> baja  <correo>
 *
 * Nunca imprime hashes ni contraseñas existentes: no se pueden recuperar, solo
 * reemplazar.
 */
import "dotenv/config";
import pg from "pg";
import crypto from "node:crypto";

const [SCHEMA, ACCION, A, B, C] = process.argv.slice(2);

if (!["development", "beta"].includes(SCHEMA) || !ACCION) {
  console.error(`
Uso:
  node scripts/credencial.mjs <development|beta> listar
  node scripts/credencial.mjs <development|beta> clave <correo> <nueva>
  node scripts/credencial.mjs <development|beta> crear <correo> <clave> <id_usuario|super>
  node scripts/credencial.mjs <development|beta> baja  <correo>
`);
  process.exit(1);
}

const hashear = (p) => {
  const sal = crypto.randomBytes(16).toString("hex");
  return `scrypt$${sal}$${crypto.scryptSync(p, sal, 64).toString("hex")}`;
};

const c = new pg.Client({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  ssl: { rejectUnauthorized: false },
});
await c.connect();
const T = (t) => `"${SCHEMA}"."${t}"`;

if (ACCION === "listar") {
  const r = await c.query(
    `select w.id, w.correo, w.es_superusuario, w.estado, w.ultimo_acceso,
            u.nombre_completo, e.nombre as empresa
       from ${T("web_credenciales")} w
       left join ${T("usuarios")} u on u.id = w.id_usuario
       left join ${T("empresas")} e on e.id = u.id_empresa
      order by w.id`
  );
  console.table(
    r.rows.map((x) => ({
      correo: x.correo,
      usuario: x.nombre_completo ?? "—",
      empresa: x.es_superusuario ? "TODAS (superusuario)" : (x.empresa ?? "—"),
      activa: x.estado,
      ultimo_acceso: x.ultimo_acceso ? new Date(x.ultimo_acceso).toISOString().slice(0, 16) : "nunca",
    }))
  );
} else if (ACCION === "clave") {
  if (!A || !B) throw new Error("Faltan <correo> y <nueva>");
  const r = await c.query(
    `update ${T("web_credenciales")} set password_hash = $2 where lower(correo) = lower($1) returning correo`,
    [A, hashear(B)]
  );
  console.log(r.rows.length ? `Contraseña actualizada para ${r.rows[0].correo}` : "No existe esa credencial.");
} else if (ACCION === "crear") {
  if (!A || !B || !C) throw new Error("Faltan <correo> <clave> <id_usuario|super>");
  const esSuper = C === "super";
  const r = await c.query(
    `insert into ${T("web_credenciales")} (id_usuario, correo, password_hash, es_superusuario)
     values ($1,$2,$3,$4) on conflict (correo) do nothing returning correo`,
    [esSuper ? null : Number(C), A, hashear(B), esSuper]
  );
  console.log(r.rows.length ? `Credencial creada: ${A}` : "Ya existía esa credencial.");
} else if (ACCION === "baja") {
  const r = await c.query(
    `update ${T("web_credenciales")} set estado = false where lower(correo) = lower($1) returning correo`,
    [A]
  );
  console.log(r.rows.length ? `Credencial desactivada: ${r.rows[0].correo}` : "No existe esa credencial.");
} else {
  console.error(`Acción desconocida: ${ACCION}`);
  process.exitCode = 1;
}

await c.end();
