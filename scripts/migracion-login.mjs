/**
 * Migración del login: crea la tabla de credenciales de la web y las cuentas
 * iniciales. Es IDEMPOTENTE: se puede correr varias veces sin duplicar nada.
 *
 *   node scripts/migracion-login.mjs <schema>            → solo muestra el plan
 *   node scripts/migracion-login.mjs <schema> --aplicar  → lo ejecuta
 *
 * Qué hace:
 *   1. CREATE TABLE <schema>.web_credenciales   (tabla nueva, propia de la web;
 *      no toca ninguna tabla que use el chatbot)
 *   2. INSERT del usuario "Office Manager" en <schema>.usuarios, empresa HEXA
 *   3. INSERT de su credencial y de una cuenta de superusuario
 *
 * Notas de estructura verificadas contra la base:
 *   - `usuarios.id` es IDENTITY ALWAYS: nunca se inserta explícitamente.
 *   - `usuarios.correo` y `usuarios.telefono` son UNIQUE.
 *   - `usuarios.telefono` es NOT NULL y el chatbot identifica a la gente por
 *     ese número, así que el usuario de la web lleva un valor que NO es un
 *     teléfono real y `whatsapp = false`, para no interferir con WhatsApp.
 */
import "dotenv/config";
import pg from "pg";
import crypto from "node:crypto";

const SCHEMA = process.argv[2];
const APLICAR = process.argv.includes("--aplicar");

if (!SCHEMA || !["development", "beta"].includes(SCHEMA)) {
  console.error("\nUso: node scripts/migracion-login.mjs <development|beta> [--aplicar]\n");
  process.exit(1);
}

/* ---------- cuentas a crear ---------- */

const OFFICE_MANAGER = {
  nombre_completo: "Office Manager",
  correo: "office.manager@hexa.com.mx",
  // No es un teléfono: evita chocar con la identificación por WhatsApp.
  telefono: "web-office-manager",
  empresa: "HEXA",
  password: "Hexa2026!",
};

const SUPERUSUARIO = {
  correo: "admin@hexa.com.mx",
  password: "AdminTR2026!",
};

/* ---------- utilidades ---------- */

const hashear = (password) => {
  const sal = crypto.randomBytes(16).toString("hex");
  return `scrypt$${sal}$${crypto.scryptSync(password, sal, 64).toString("hex")}`;
};

const cliente = new pg.Client({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  ssl: { rejectUnauthorized: false },
});

const T = (t) => `"${SCHEMA}"."${t}"`;

await cliente.connect();
const q = (s, v = []) => cliente.query(s, v).then((r) => r.rows);

console.log(`\n${"=".repeat(68)}`);
console.log(`MIGRACIÓN DE LOGIN · schema "${SCHEMA}"${APLICAR ? "" : "   (SIMULACIÓN)"}`);
if (SCHEMA === "beta") console.log(`ATENCIÓN: "beta" es PRODUCCIÓN.`);
console.log("=".repeat(68));

/* ---------- 1 · estado actual ---------- */

const yaHayTabla = (
  await q(
    `select 1 from information_schema.tables
      where table_schema = $1 and table_name = 'web_credenciales'`,
    [SCHEMA]
  )
).length;

// El nombre difiere entre schemas: "HEXA" en beta, "Hexa" en development.
const empresa = (
  await q(`select id, nombre from ${T("empresas")} where lower(nombre) = lower($1) order by id`, [
    OFFICE_MANAGER.empresa,
  ])
)[0];

if (!empresa) {
  console.error(`\n[ABORTADO] No existe la empresa "${OFFICE_MANAGER.empresa}" en ${SCHEMA}.\n`);
  await cliente.end();
  process.exit(1);
}

const yaHayUsuario = (
  await q(`select id, nombre_completo, id_empresa from ${T("usuarios")} where lower(correo) = lower($1)`, [
    OFFICE_MANAGER.correo,
  ])
)[0];

console.log(`\nEstado actual:`);
console.log(`  tabla web_credenciales : ${yaHayTabla ? "ya existe" : "NO existe, se creará"}`);
console.log(`  empresa ${OFFICE_MANAGER.empresa}            : id ${empresa.id}`);
console.log(
  `  usuario Office Manager : ${yaHayUsuario ? `ya existe (id ${yaHayUsuario.id})` : "NO existe, se creará"}`
);

if (!APLICAR) {
  console.log(`\nPlan:`);
  console.log(`  1. create table if not exists ${SCHEMA}.web_credenciales`);
  console.log(
    `  2. insert into ${SCHEMA}.usuarios  → "${OFFICE_MANAGER.nombre_completo}" (empresa ${empresa.id})`
  );
  console.log(`  3. insert credencial ${OFFICE_MANAGER.correo}   (Office Manager de ${empresa.nombre})`);
  console.log(`  4. insert credencial ${SUPERUSUARIO.correo}   (superusuario, ve todas las empresas)`);
  console.log(`\nNada se ha modificado. Para aplicarlo:`);
  console.log(`  node scripts/migracion-login.mjs ${SCHEMA} --aplicar\n`);
  await cliente.end();
  process.exit(0);
}

/* ---------- 2 · aplicar ---------- */

try {
  await cliente.query("BEGIN");

  await cliente.query(`
    create table if not exists ${T("web_credenciales")} (
      id              integer generated always as identity primary key,
      id_usuario      integer null references ${T("usuarios")}(id),
      correo          text    not null,
      password_hash   text    not null,
      es_superusuario boolean not null default false,
      estado          boolean not null default true,
      creado_en       timestamptz not null default now(),
      ultimo_acceso   timestamptz null,
      constraint web_credenciales_correo_unique unique (correo)
    )`);
  console.log(`\n  ok  tabla ${SCHEMA}.web_credenciales`);

  let idUsuario = yaHayUsuario?.id;
  if (!idUsuario) {
    const r = await cliente.query(
      `insert into ${T("usuarios")}
         (nombre_completo, id_empresa, telefono, correo, id_telegram, estado, whatsapp)
       values ($1, $2, $3, $4, null, true, false)
       returning id`,
      [OFFICE_MANAGER.nombre_completo, empresa.id, OFFICE_MANAGER.telefono, OFFICE_MANAGER.correo]
    );
    idUsuario = r.rows[0].id;
    console.log(`  ok  usuario "${OFFICE_MANAGER.nombre_completo}" creado con id ${idUsuario}`);
  } else {
    console.log(`  --  el usuario ya existía (id ${idUsuario}), no se duplica`);
  }

  const alta = async (correo, password, idU, esSuper) => {
    const r = await cliente.query(
      `insert into ${T("web_credenciales")} (id_usuario, correo, password_hash, es_superusuario)
       values ($1, $2, $3, $4)
       on conflict (correo) do nothing
       returning id`,
      [idU, correo, hashear(password), esSuper]
    );
    console.log(
      r.rows.length
        ? `  ok  credencial ${correo}${esSuper ? "  (superusuario)" : ""}`
        : `  --  la credencial ${correo} ya existía, no se toca`
    );
  };

  await alta(OFFICE_MANAGER.correo, OFFICE_MANAGER.password, idUsuario, false);
  await alta(SUPERUSUARIO.correo, SUPERUSUARIO.password, null, true);

  await cliente.query("COMMIT");

  console.log(`\n${"=".repeat(68)}`);
  console.log(`LISTO. Credenciales de acceso:`);
  console.log(`  ${OFFICE_MANAGER.correo.padEnd(30)} ${OFFICE_MANAGER.password}   → solo ${empresa.nombre}`);
  console.log(`  ${SUPERUSUARIO.correo.padEnd(30)} ${SUPERUSUARIO.password}   → todas las empresas`);
  console.log(`\nCámbialas con:  node scripts/credencial.mjs ${SCHEMA} <correo> <nueva>`);
  console.log("=".repeat(68) + "\n");
} catch (e) {
  await cliente.query("ROLLBACK");
  console.error(`\n[ERROR] Se deshizo todo: ${e.message}\n`);
  process.exitCode = 1;
}

await cliente.end();
