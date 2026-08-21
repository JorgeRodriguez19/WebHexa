import "dotenv/config";
import pg from "pg";

const { Pool, types } = pg;

/* ------------------------------------------------------------------ *
 *  Guardia de schema
 *  La BD `hexa` tiene cuatro schemas: beta, development, public y test.
 *
 *  - `development` es el de pruebas.
 *  - `beta` es PRODUCCIÓN: es donde opera el chatbot de WhatsApp. El cliente
 *    autorizó expresamente operar sobre él con lectura y escritura.
 *  - `public` y `test` siguen prohibidos: nadie ha autorizado tocarlos.
 *
 *  Las diferencias de estructura entre beta y development están en
 *  server/capacidades.js.
 * ------------------------------------------------------------------ */
const PERMITIDOS = ["development", "beta"];

export const SCHEMA = process.env.PGSCHEMA || "development";

/*
 * ENTORNO distingue la instalación, no la estructura:
 *   "produccion" → la base real de AWS RDS, compartida con el chatbot.
 *   "demo"       → una copia (por ejemplo la de Railway). Misma estructura,
 *                  datos congelados, nadie más escribe en ella.
 * Se separa del nombre del schema porque la copia de `beta` en Railway también
 * se llama `beta` —para que las capacidades coincidan— pero NO es producción.
 */
export const ENTORNO = process.env.ENTORNO || (SCHEMA === "beta" ? "produccion" : "desarrollo");

if (!PERMITIDOS.includes(SCHEMA)) {
  console.error(
    `\n[HEXA] PGSCHEMA="${SCHEMA}" no está permitido.\n` +
      `        Schemas autorizados: ${PERMITIDOS.join(", ")}.\n` +
      `        "public" y "test" nunca deben tocarse.\n`
  );
  process.exit(1);
}

if (ENTORNO === "produccion") {
  console.warn(
    `\n${"!".repeat(64)}\n` +
      `  ATENCIÓN: conectado al schema "${SCHEMA}" = PRODUCCIÓN.\n` +
      `  Toda escritura afecta datos reales que también usa el chatbot.\n` +
      `${"!".repeat(64)}\n`
  );
}

/** Califica una tabla: T("accesos") -> "development"."accesos" */
export const T = (tabla) => `"${SCHEMA}"."${tabla}"`;

/* ------------------------------------------------------------------ *
 *  Parsers de tipo
 *  Sin esto, `pg` convierte DATE a un Date de JS en la zona local y una
 *  fecha guardada como 2026-02-19 vuelve como 2026-02-19T07:00:00.000Z,
 *  que al serializar a JSON se puede leer como el día anterior.
 *  Las fechas de este dominio son días de calendario, no instantes:
 *  se manejan como texto "YYYY-MM-DD" de punta a punta.
 * ------------------------------------------------------------------ */
types.setTypeParser(1082, (v) => v); // date        -> "2026-02-19"
types.setTypeParser(1083, (v) => (v ? v.slice(0, 5) : v)); // time -> "09:00"
types.setTypeParser(20, (v) => (v === null ? null : Number.parseInt(v, 10))); // int8 -> number
types.setTypeParser(700, (v) => (v === null ? null : Number.parseFloat(v))); // float4 -> number

/*
 * Conexión. Dos formas, para poder correr igual en local y en Railway:
 *   - DATABASE_URL: es lo que inyectan los servicios gestionados (Railway).
 *   - PGHOST/PGUSER/…: el modo local contra AWS RDS.
 *
 * SSL: RDS lo exige; el Postgres interno de Railway no lo usa y falla si se
 * fuerza. Se controla con PGSSL ("on" | "off"); por defecto se activa salvo
 * que la conexión sea a la red interna de Railway o a localhost.
 */
const url = process.env.DATABASE_URL || "";
const hostEfectivo = url ? new URL(url).hostname : process.env.PGHOST || "";
const interno = /\.railway\.internal$|^localhost$|^127\.0\.0\.1$/.test(hostEfectivo);
const usarSsl = (process.env.PGSSL || (interno ? "off" : "on")) === "on";

export const pool = new Pool({
  ...(url
    ? { connectionString: url }
    : {
        host: process.env.PGHOST,
        port: Number(process.env.PGPORT || 5432),
        database: process.env.PGDATABASE,
        user: process.env.PGUSER,
        password: process.env.PGPASSWORD,
      }),
  ssl: usarSsl ? { rejectUnauthorized: false } : false,
  max: Number(process.env.PGMAX || 8),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 15_000,
});

pool.on("error", (e) => console.error("[pg] error inesperado en el pool:", e.message));

export const q = (sql, params = []) => pool.query(sql, params);

/** Ejecuta `fn` dentro de una transacción y hace rollback ante cualquier error. */
export async function enTransaccion(fn) {
  const cx = await pool.connect();
  try {
    await cx.query("BEGIN");
    const r = await fn(cx);
    await cx.query("COMMIT");
    return r;
  } catch (e) {
    await cx.query("ROLLBACK");
    throw e;
  } finally {
    cx.release();
  }
}

/** Verifica al arrancar que el schema existe y que hay conectividad. */
export async function verificarConexion() {
  const r = await q(
    `select count(*)::int n from information_schema.tables where table_schema = $1`,
    [SCHEMA]
  );
  if (r.rows[0].n === 0) throw new Error(`el schema "${SCHEMA}" no existe o está vacío`);
  return r.rows[0].n;
}
