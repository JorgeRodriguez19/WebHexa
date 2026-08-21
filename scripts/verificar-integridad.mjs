/**
 * Compara los conteos del schema development contra el estado esperado.
 * Es una foto fija de `development`: no aplica a `beta`, que cambia sola
 * porque el chatbot escribe en ella continuamente.
 */
import "dotenv/config";
import pg from "pg";

const ESPERADO = {
  empresas: 8, usuarios: 10, empleados: 118, tarjetas: 65, accesos: 65,
  vehiculos: 23, salas: 8, reservaciones: 48, solicitudes_salas: 76,
  actualizaciones: 205, historico: 45, horarios: 2, tipo_accesos: 3, tipo_vehiculos: 2,
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

let diferencias = 0;
for (const [tabla, n] of Object.entries(ESPERADO)) {
  const r = await c.query(`select count(*)::int n from "development"."${tabla}"`);
  const igual = r.rows[0].n === n;
  if (!igual) diferencias++;
  console.log(`  ${igual ? "ok  " : "DIF "} ${tabla.padEnd(20)} ${r.rows[0].n}${igual ? "" : ` (esperado ${n})`}`);
}

const libres = await c.query(
  `select count(*)::int n from "development".tarjetas t
    where t.estado is true
      and not exists (select 1 from "development".accesos a where a.num_tarjeta = t.id)`
);
console.log(`\n  tarjetas libres en inventario: ${libres.rows[0].n} (originalmente 6)`);
console.log(diferencias ? "\nHAY DIFERENCIAS" : "\nBase intacta.");

await c.end();
process.exit(diferencias ? 1 : 0);
