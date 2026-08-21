/**
 * Compara dos schemas de la base `hexa` sin escribir absolutamente nada.
 * Solo hace SELECT sobre information_schema, pg_constraint y COUNT(*).
 *
 *   node scripts/comparar-schemas.mjs [origen] [destino]
 *   node scripts/comparar-schemas.mjs development beta
 *
 * No importa server/db.js a propósito: ese módulo aborta si el schema no es
 * development, y aquí necesitamos poder mirar (que no tocar) cualquiera.
 */
import "dotenv/config";
import pg from "pg";

const A = process.argv[2] || "development";
const B = process.argv[3] || "beta";

const pool = new pg.Pool({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  ssl: { rejectUnauthorized: false },
  max: 4,
});

const q = (sql, p = []) => pool.query(sql, p).then((r) => r.rows);

const columnas = (schema) =>
  q(
    `select table_name, column_name, data_type, is_nullable, column_default,
            character_maximum_length, numeric_precision, numeric_scale
       from information_schema.columns
      where table_schema = $1
      order by table_name, ordinal_position`,
    [schema]
  );

const tablas = (schema) =>
  q(
    `select table_name from information_schema.tables
      where table_schema = $1 and table_type = 'BASE TABLE'
      order by table_name`,
    [schema]
  ).then((r) => r.map((x) => x.table_name));

const restricciones = (schema) =>
  q(
    `select c.conname, c.contype, t.relname as tabla,
            pg_get_constraintdef(c.oid) as definicion
       from pg_constraint c
       join pg_class t on t.oid = c.conrelid
       join pg_namespace n on n.oid = t.relnamespace
      where n.nspname = $1
      order by t.relname, c.conname`,
    [schema]
  );

const tipo = (c) => {
  let t = c.data_type;
  if (c.character_maximum_length) t += `(${c.character_maximum_length})`;
  else if (c.numeric_precision && c.data_type === "numeric")
    t += `(${c.numeric_precision},${c.numeric_scale})`;
  return `${t}${c.is_nullable === "NO" ? " NOT NULL" : ""}`;
};

const idContar = (schema, tabla) =>
  q(`select count(*)::int n from "${schema}"."${tabla}"`)
    .then((r) => r[0].n)
    .catch(() => null);

/* ---------------------------------------------------------------- */

const [tablasA, tablasB] = await Promise.all([tablas(A), tablas(B)]);
const [colsA, colsB] = await Promise.all([columnas(A), columnas(B)]);

const porTabla = (cols) => {
  const m = new Map();
  for (const c of cols) {
    if (!m.has(c.table_name)) m.set(c.table_name, new Map());
    m.get(c.table_name).set(c.column_name, c);
  }
  return m;
};
const mA = porTabla(colsA);
const mB = porTabla(colsB);

console.log(`\n${"=".repeat(72)}`);
console.log(`COMPARACIÓN DE SCHEMAS   ${A}  →  ${B}`);
console.log("=".repeat(72));

/* 1 · tablas */
const soloA = tablasA.filter((t) => !tablasB.includes(t));
const soloB = tablasB.filter((t) => !tablasA.includes(t));
const comunes = tablasA.filter((t) => tablasB.includes(t));

console.log(`\n## TABLAS`);
console.log(`   ${A}: ${tablasA.length} · ${B}: ${tablasB.length} · comunes: ${comunes.length}`);
if (soloA.length) console.log(`   Solo en ${A}: ${soloA.join(", ")}`);
if (soloB.length) console.log(`   Solo en ${B}: ${soloB.join(", ")}`);
if (!soloA.length && !soloB.length) console.log(`   Mismo conjunto de tablas.`);

/* 2 · columnas por tabla común */
console.log(`\n## DIFERENCIAS DE COLUMNAS (solo tablas comunes)`);
let difs = 0;
for (const t of comunes) {
  const ca = mA.get(t) ?? new Map();
  const cb = mB.get(t) ?? new Map();
  const faltanEnB = [...ca.keys()].filter((k) => !cb.has(k));
  const sobranEnB = [...cb.keys()].filter((k) => !ca.has(k));
  const distintas = [...ca.keys()]
    .filter((k) => cb.has(k))
    .filter((k) => tipo(ca.get(k)) !== tipo(cb.get(k)))
    .map((k) => `${k}: ${A}=${tipo(ca.get(k))} | ${B}=${tipo(cb.get(k))}`);

  if (!faltanEnB.length && !sobranEnB.length && !distintas.length) continue;
  difs++;
  console.log(`\n   ${t}`);
  if (faltanEnB.length) console.log(`     falta en ${B}:  ${faltanEnB.join(", ")}`);
  if (sobranEnB.length) console.log(`     extra en ${B}:  ${sobranEnB.join(", ")}`);
  for (const d of distintas) console.log(`     tipo distinto: ${d}`);
}
if (!difs) console.log(`   Ninguna. Las tablas comunes son idénticas columna a columna.`);

/* 3 · defaults de identidad / secuencias */
console.log(`\n## COLUMNAS id: generación`);
for (const t of comunes) {
  const a = mA.get(t)?.get("id");
  const b = mB.get(t)?.get("id");
  if (!a && !b) continue;
  const da = a?.column_default ?? (a ? "IDENTITY/none" : "—");
  const db = b?.column_default ?? (b ? "IDENTITY/none" : "—");
  if (String(da) !== String(db)) console.log(`   ${t}: ${A}=${da} | ${B}=${db}`);
}

/* 4 · restricciones */
const [rA, rB] = await Promise.all([restricciones(A), restricciones(B)]);
const norm = (r) => `${r.tabla}|${r.definicion}`;
const setA = new Set(rA.map(norm));
const setB = new Set(rB.map(norm));
console.log(`\n## RESTRICCIONES`);
console.log(`   ${A}: ${rA.length} · ${B}: ${rB.length}`);
const faltanB = rA.filter((r) => !setB.has(norm(r)));
const extraB = rB.filter((r) => !setA.has(norm(r)));
for (const r of faltanB) console.log(`   falta en ${B}:  ${r.tabla} → ${r.definicion}`);
for (const r of extraB) console.log(`   extra en ${B}:  ${r.tabla} → ${r.definicion}`);
if (!faltanB.length && !extraB.length) console.log(`   Idénticas.`);

/* 5 · volumen de datos */
console.log(`\n## FILAS`);
console.log(`   ${"tabla".padEnd(22)}${A.padStart(12)}${B.padStart(12)}`);
for (const t of comunes) {
  const [na, nb] = await Promise.all([idContar(A, t), idContar(B, t)]);
  console.log(`   ${t.padEnd(22)}${String(na ?? "—").padStart(12)}${String(nb ?? "—").padStart(12)}`);
}

/* 6 · extensiones */
const ext = await q(`select extname from pg_extension order by extname`);
console.log(`\n## EXTENSIONES INSTALADAS (nivel base de datos)`);
console.log(`   ${ext.map((e) => e.extname).join(", ")}`);

console.log(`\n${"=".repeat(72)}\n`);
await pool.end();
