/**
 * Radiografía del schema `beta` (producción) — ESTRICTAMENTE DE LECTURA.
 * Solo SELECT. No escribe, no altera, no crea nada.
 *
 *   node scripts/analizar-beta.mjs [schema]
 */
import "dotenv/config";
import pg from "pg";

const S = process.argv[2] || "beta";

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
const T = (t) => `"${S}"."${t}"`;

const titulo = (t) => console.log(`\n${"-".repeat(70)}\n${t}\n${"-".repeat(70)}`);
const tabla = (filas) => {
  if (!filas.length) return console.log("   (sin filas)");
  for (const f of filas) console.log("   " + JSON.stringify(f));
};

console.log(`\n${"=".repeat(70)}\nRADIOGRAFÍA DEL SCHEMA "${S}" — SOLO LECTURA\n${"=".repeat(70)}`);

/* 1 · estructura de las tablas que usa la app */
for (const t of ["accesos", "actualizaciones", "solicitudes_salas", "empresas", "empleados"]) {
  titulo(`Columnas de ${t}`);
  const cols = await q(
    `select column_name, data_type, is_nullable, column_default
       from information_schema.columns
      where table_schema = $1 and table_name = $2
      order by ordinal_position`,
    [S, t]
  );
  for (const c of cols)
    console.log(
      `   ${c.column_name.padEnd(24)} ${c.data_type.padEnd(28)} ${
        c.is_nullable === "NO" ? "NOT NULL" : ""
      } ${c.column_default ? `default ${c.column_default}` : ""}`
    );
}

/* 2 · cómo se marca la vigencia de un acceso si no hay "Status" */
titulo("accesos · valores de las columnas candidatas a estado");
const colsAcc = await q(
  `select column_name from information_schema.columns
    where table_schema = $1 and table_name = 'accesos'`,
  [S]
);
const nombres = colsAcc.map((c) => c.column_name);
for (const c of nombres) {
  if (!/status|estado|activo|vigen|baja/i.test(c)) continue;
  tabla(await q(`select "${c}" as valor, count(*)::int n from ${T("accesos")} group by 1 order by 2 desc`));
}
console.log(`   columnas de accesos: ${nombres.join(", ")}`);

/* 3 · convención de estados */
titulo("actualizaciones · estado_revision × tipo_cambio");
tabla(
  await q(
    `select estado_revision, tipo_cambio, count(*)::int n
       from ${T("actualizaciones")} group by 1,2 order by 3 desc limit 30`
  )
);

titulo("solicitudes_salas · estado");
tabla(await q(`select estado, count(*)::int n from ${T("solicitudes_salas")} group by 1 order by 2 desc`));

/* 4 · catálogos */
titulo("salas");
tabla(
  await q(
    `select id, nombre, capacidad, piso, precio_hora, horario_apertura, horario_cierre
       from ${T("salas")} order by capacidad`
  )
);

titulo("tipo_accesos / horarios / tipo_vehiculos");
tabla(await q(`select id, descripcion from ${T("tipo_accesos")} order by id`));
tabla(await q(`select * from ${T("horarios")} order by id`));
tabla(await q(`select id, descripcion from ${T("tipo_vehiculos")} order by id`));

/* 5 · inventario de tarjetas libres (clave: accesos.num_tarjeta es FK NOT NULL) */
titulo("tarjetas libres (no referenciadas por ningún acceso)");
tabla(
  await q(
    `select count(*)::int libres from ${T("tarjetas")} t
      where not exists (select 1 from ${T("accesos")} a where a.num_tarjeta = t.id)`
  )
);

/* 6 · empresas con usuarios y con empleados */
titulo("empresas: usuarios y empleados por empresa (top 15)");
tabla(
  await q(
    `select e.id, e.nombre, e.num_contrato, e.num_vip, e.num_vehiculares,
            (select count(*)::int from ${T("usuarios")} u where u.id_empresa = e.id) usuarios,
            (select count(*)::int from ${T("empleados")} p where p.id_empresa = e.id) empleados
       from ${T("empresas")} e
      order by empleados desc, usuarios desc
      limit 15`
  )
);

/* 7 · muestra de servicios JSON */
titulo("solicitudes_salas · muestra de `servicios`");
tabla(
  await q(
    `select id, servicios from ${T("solicitudes_salas")}
      where servicios is not null limit 5`
  )
);

/* 8 · reservaciones recientes */
titulo("reservaciones · rango de fechas");
tabla(
  await q(
    `select min(fecha_reservacion) desde, max(fecha_reservacion) hasta, count(*)::int n
       from ${T("reservaciones")}`
  )
);

console.log(`\n${"=".repeat(70)}\n`);
await pool.end();
