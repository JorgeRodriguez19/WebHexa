/**
 * Copia un schema completo de una base a otra: estructura y datos.
 *
 * Pensado para llevar `beta` de AWS RDS a un Postgres de Railway sin depender
 * de `pg_dump` (que no está instalado en esta máquina). Lee el DDL de
 * `pg_catalog`, que es la fuente exacta de tipos y restricciones.
 *
 *   node scripts/copiar-schema.mjs <schemaOrigen> <schemaDestino> [--aplicar]
 *
 * El origen sale del .env (PGHOST/PGUSER/…). El destino, de DESTINO_URL:
 *
 *   DESTINO_URL="postgresql://user:pass@host:puerto/base" \
 *     node scripts/copiar-schema.mjs beta beta --aplicar
 *
 * SOLO LEE del origen. Nunca escribe en él.
 *
 * Detalles que importan:
 *   - Las columnas `id` son IDENTITY ALWAYS: para conservar los ids originales
 *     hay que insertar con OVERRIDING SYSTEM VALUE y luego reposicionar la
 *     secuencia, o los siguientes INSERT chocarían con la clave primaria.
 *   - Las restricciones se crean DESPUÉS de los datos: así el orden de carga
 *     no importa y las FK no fallan por dependencias cruzadas.
 *   - Las fechas y horas se leen como texto para que no las toque ninguna
 *     conversión de zona horaria en el camino.
 */
import "dotenv/config";
import pg from "pg";

const [ORIGEN, DESTINO = ORIGEN] = process.argv.slice(2);
const APLICAR = process.argv.includes("--aplicar");
const LOTE = 500;

if (!ORIGEN) {
  console.error(`
Uso:
  DESTINO_URL="postgresql://..." node scripts/copiar-schema.mjs <origen> <destino> [--aplicar]

Ejemplo:
  DESTINO_URL="postgresql://postgres:xxx@host.proxy.rlwy.net:12345/railway" \\
    node scripts/copiar-schema.mjs beta beta --aplicar
`);
  process.exit(1);
}

if (!process.env.DESTINO_URL) {
  console.error("\n[ABORTADO] Falta la variable DESTINO_URL con la conexión de destino.\n");
  process.exit(1);
}

/* Fechas y horas como texto: sin conversiones de zona en el trasvase. */
for (const oid of [1082, 1083, 1114, 1184]) pg.types.setTypeParser(oid, (v) => v);

const origen = new pg.Client({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  ssl: { rejectUnauthorized: false },
});

const destinoUrl = new URL(process.env.DESTINO_URL);
const destinoInterno = /\.railway\.internal$|^localhost$/.test(destinoUrl.hostname);
const destino = new pg.Client({
  connectionString: process.env.DESTINO_URL,
  ssl: destinoInterno ? false : { rejectUnauthorized: false },
});

try {
  await origen.connect();
} catch (e) {
  console.error(`\n[ABORTADO] No se pudo conectar al ORIGEN (${process.env.PGHOST}): ${e.message}\n`);
  process.exit(1);
}

/* En simulación no se toca el destino: solo se inventaría el origen. */
if (APLICAR) {
  try {
    await destino.connect();
  } catch (e) {
    console.error(`\n[ABORTADO] No se pudo conectar al DESTINO (${destinoUrl.hostname}): ${e.message}`);
    console.error(`Revisa DESTINO_URL. En Railway usa la URL pública (…proxy.rlwy.net) si corres esto desde tu PC.\n`);
    process.exit(1);
  }
}

const qo = (s, v = []) => origen.query(s, v).then((r) => r.rows);
const qd = (s, v = []) => destino.query(s, v);

console.log(`\n${"=".repeat(70)}`);
console.log(`COPIA DE SCHEMA   ${process.env.PGHOST}/${ORIGEN}  →  ${destinoUrl.hostname}/${DESTINO}`);
console.log(`${APLICAR ? "" : "(SIMULACIÓN — no se escribe nada)"}`);
console.log("=".repeat(70));

/* ---------- 1 · inventario del origen ---------- */

const tablas = await qo(
  `select c.relname
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = $1 and c.relkind = 'r'
    order by c.relname`,
  [ORIGEN]
);

if (!tablas.length) {
  console.error(`\n[ABORTADO] El schema "${ORIGEN}" no tiene tablas.\n`);
  process.exit(1);
}

const definiciones = [];
for (const { relname } of tablas) {
  const cols = await qo(
    `select a.attname,
            format_type(a.atttypid, a.atttypmod) as tipo,
            a.attnotnull as notnull,
            a.attidentity as identidad,
            pg_get_expr(d.adbin, d.adrelid) as por_defecto
       from pg_attribute a
       join pg_class c on c.oid = a.attrelid
       join pg_namespace n on n.oid = c.relnamespace
       left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
      where n.nspname = $1 and c.relname = $2 and a.attnum > 0 and not a.attisdropped
      order by a.attnum`,
    [ORIGEN, relname]
  );

  const restricciones = await qo(
    `select con.conname, pg_get_constraintdef(con.oid) as def, con.contype
       from pg_constraint con
       join pg_class c on c.oid = con.conrelid
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = $1 and c.relname = $2
      order by case con.contype when 'p' then 0 when 'u' then 1 else 2 end, con.conname`,
    [ORIGEN, relname]
  );

  const [{ n }] = await qo(`select count(*)::int n from "${ORIGEN}"."${relname}"`);
  definiciones.push({ tabla: relname, cols, restricciones, filas: n });
}

console.log(`\nTablas en ${ORIGEN}: ${definiciones.length}`);
for (const d of definiciones)
  console.log(`   ${d.tabla.padEnd(24)} ${String(d.filas).padStart(6)} filas · ${d.cols.length} columnas`);
console.log(`   ${"TOTAL".padEnd(24)} ${String(definiciones.reduce((a, d) => a + d.filas, 0)).padStart(6)} filas`);

if (!APLICAR) {
  console.log(`\nQué haría:`);
  console.log(`   1. create schema if not exists "${DESTINO}"`);
  console.log(`   2. crear las ${definiciones.length} tablas (sin restricciones)`);
  console.log(`   3. copiar los datos en lotes de ${LOTE}`);
  console.log(`   4. crear claves primarias, únicas y foráneas`);
  console.log(`   5. reposicionar las secuencias de identidad`);
  console.log(`\nNada se ha modificado. Para ejecutarlo, añade --aplicar\n`);
  await origen.end();
  process.exit(0);
}

/* ---------- 2 · estructura ---------- */

console.log(`\n--- estructura`);
await qd(`create schema if not exists "${DESTINO}"`);

const ddlColumna = (c) => {
  const partes = [`"${c.attname}"`, c.tipo];
  if (c.identidad === "a") partes.push("generated always as identity");
  else if (c.identidad === "d") partes.push("generated by default as identity");
  else if (c.por_defecto && !/^nextval\(/.test(c.por_defecto)) partes.push(`default ${c.por_defecto}`);
  if (c.notnull) partes.push("not null");
  return partes.join(" ");
};

for (const d of definiciones) {
  // Se recrea desde cero: si la tabla ya existía en el destino, se reemplaza.
  await qd(`drop table if exists "${DESTINO}"."${d.tabla}" cascade`);
  await qd(`create table "${DESTINO}"."${d.tabla}" (\n  ${d.cols.map(ddlColumna).join(",\n  ")}\n)`);
  console.log(`   ok  ${d.tabla}`);
}

/* ---------- 3 · datos ---------- */

console.log(`\n--- datos`);
for (const d of definiciones) {
  if (!d.filas) {
    console.log(`   --  ${d.tabla} (vacía)`);
    continue;
  }

  const nombres = d.cols.map((c) => `"${c.attname}"`).join(", ");
  // OVERRIDING SYSTEM VALUE: obligatorio para escribir en columnas IDENTITY
  // ALWAYS y conservar los ids originales, que son los que referencian las FK.
  const hayIdentidadAlways = d.cols.some((c) => c.identidad === "a");
  const overriding = hayIdentidadAlways ? " overriding system value" : "";

  let copiadas = 0;
  for (let salto = 0; salto < d.filas; salto += LOTE) {
    /*
     * Se pagina por `ctid`, no por la primera columna: ctid existe siempre y
     * da un orden estable. Ordenar por "la primera columna" fallaría en las
     * tablas sin clave única, repitiendo u omitiendo filas entre lotes.
     */
    const filas = await qo(
      `select ${nombres} from "${ORIGEN}"."${d.tabla}" order by ctid limit ${LOTE} offset ${salto}`
    );
    if (!filas.length) break;

    const valores = [];
    const marcadores = filas.map(
      (_f, i) => `(${d.cols.map((_c, j) => `$${i * d.cols.length + j + 1}`).join(",")})`
    );
    for (const f of filas) for (const c of d.cols) valores.push(f[c.attname]);

    await qd(
      `insert into "${DESTINO}"."${d.tabla}" (${nombres})${overriding} values ${marcadores.join(",")}`,
      valores
    );
    copiadas += filas.length;
  }
  console.log(`   ok  ${d.tabla.padEnd(24)} ${copiadas}/${d.filas}`);
}

/* ---------- 4 · restricciones ---------- */

console.log(`\n--- restricciones`);
let puestas = 0;
const omitidas = [];
for (const orden of ["p", "u", "c", "f"]) {
  for (const d of definiciones) {
    for (const r of d.restricciones.filter((x) => x.contype === orden)) {
      // La definición viene calificada con el schema de origen.
      const def = r.def.replaceAll(`${ORIGEN}.`, `"${DESTINO}".`);
      try {
        await qd(
          `alter table "${DESTINO}"."${d.tabla}" add constraint "${r.conname}" ${def}`
        );
        puestas++;
      } catch (e) {
        omitidas.push(`${d.tabla}.${r.conname}: ${e.message.split("\n")[0]}`);
      }
    }
  }
}
console.log(`   ${puestas} creadas`);
for (const o of omitidas) console.log(`   OMITIDA  ${o}`);

/* ---------- 5 · secuencias ---------- */

console.log(`\n--- secuencias de identidad`);
for (const d of definiciones) {
  const idcols = d.cols.filter((c) => c.identidad === "a" || c.identidad === "d");
  for (const c of idcols) {
    const r = await destino.query(
      `select coalesce(max("${c.attname}"), 0) + 1 as siguiente from "${DESTINO}"."${d.tabla}"`
    );
    const siguiente = r.rows[0].siguiente;
    await qd(
      `alter table "${DESTINO}"."${d.tabla}" alter column "${c.attname}" restart with ${siguiente}`
    );
    console.log(`   ok  ${d.tabla}.${c.attname} → siguiente ${siguiente}`);
  }
}

/* ---------- 6 · comprobación ---------- */

console.log(`\n--- comprobación`);
let diferencias = 0;
for (const d of definiciones) {
  const r = await destino.query(`select count(*)::int n from "${DESTINO}"."${d.tabla}"`);
  const igual = r.rows[0].n === d.filas;
  if (!igual) diferencias++;
  console.log(
    `   ${igual ? "ok " : "DIF"} ${d.tabla.padEnd(24)} origen ${d.filas} · destino ${r.rows[0].n}`
  );
}

console.log(`\n${"=".repeat(70)}`);
console.log(diferencias ? `TERMINÓ CON ${diferencias} DIFERENCIAS` : "COPIA COMPLETA Y VERIFICADA");
console.log("=".repeat(70) + "\n");

await origen.end();
await destino.end();
process.exit(diferencias ? 1 : 0);
