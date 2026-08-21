/** Busca filas dejadas por las pruebas automatizadas en el schema development. */
import "dotenv/config";
import pg from "pg";

const c = new pg.Client({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  ssl: { rejectUnauthorized: false },
});
await c.connect();
const S = '"development"';

const ver = async (etiqueta, q) => {
  const r = await c.query(q);
  console.log(`${etiqueta}: ${r.rows.length}`);
  r.rows.forEach((f) => console.log("   " + JSON.stringify(f)));
};

await ver("actualizaciones PRUEBA", `select id, id_empresa, id_empleado, comentarios, estado_revision, fecha_solicitud from ${S}.actualizaciones where comentarios like 'PRUEBA%'`);
await ver("solicitudes_salas PRUEBA", `select id, id_sala, tipo_evento, estado from ${S}.solicitudes_salas where tipo_evento like 'PRUEBA%'`);
await ver("reservaciones PRUEBA", `select id, id_sala, tipo_evento from ${S}.reservaciones where tipo_evento like 'PRUEBA%'`);
await ver("empleados Prueba", `select id, nombre_completo, id_empresa from ${S}.empleados where nombre_completo like 'Prueba %'`);
await ver("actualizaciones de hoy", `select id, id_empresa, tipo_cambio, estado_revision, comentarios from ${S}.actualizaciones where fecha_solicitud = current_date`);

await c.end();
