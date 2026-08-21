import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

import { ENTORNO, SCHEMA, verificarConexion } from "./db.js";
import { entorno } from "./capacidades.js";
import { conSesion } from "./auth.js";
import { sesion } from "./rutas/sesion.js";
import { lectura } from "./rutas/lectura.js";
import { accesos } from "./rutas/accesos.js";
import { salas } from "./rutas/salas.js";
import { ErrorHttp } from "./util.js";

const raiz = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(raiz, "dist");
const hayBuild = fs.existsSync(path.join(dist, "index.html"));

const app = express();
app.disable("x-powered-by");

/*
 * CORS solo hace falta en desarrollo, donde Vite sirve la web en :5173 y la
 * API vive en :4000. En producción el mismo servicio sirve ambas cosas, así
 * que no se abre a otros orígenes.
 */
if (!hayBuild || process.env.CORS_ABIERTO === "on") app.use(cors());

app.use(express.json({ limit: "256kb" }));

/* Detrás del proxy de Railway, para que req.ip sea la IP real del visitante
   (lo usa el límite de intentos de login). */
app.set("trust proxy", 1);

app.get("/api/salud", async (_req, res) => {
  const tablas = await verificarConexion();
  res.json({ ok: true, schema: SCHEMA, tablas, entorno });
});

/*
 * Toda petición pasa por conSesion: deja la sesión en req.sesion o null. Las
 * rutas de datos exigen sesión y sacan de ella la empresa, así que el cliente
 * no puede pedir información de otra empresa cambiando un parámetro.
 */
app.use(conSesion);
app.use("/api", sesion);
app.use("/api", lectura);
app.use("/api", accesos);
app.use("/api", salas);

app.use("/api", (_req, res) => res.status(404).json({ error: "Ruta no encontrada." }));

/* ------------------------------------------------------------------ *
 *  Web estática
 *  En producción este mismo proceso sirve el build de Vite, así que hay un
 *  solo servicio y la web consume /api en su propio origen.
 * ------------------------------------------------------------------ */
if (hayBuild) {
  app.use(
    express.static(dist, {
      // Los nombres de los assets llevan hash; el index nunca se cachea para
      // que un despliegue nuevo se vea de inmediato.
      setHeaders: (res, archivo) => {
        if (archivo.endsWith("index.html")) res.setHeader("Cache-Control", "no-cache");
        else res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      },
    })
  );
  // La app es de una sola página: cualquier ruta desconocida devuelve el index.
  app.get(/.*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

/* Manejador central: traduce los errores de regla a un mensaje que la web
 * puede mostrar tal cual, junto con el identificador RN-### cuando aplica. */
app.use((err, _req, res, _next) => {
  const status = err instanceof ErrorHttp ? err.status : 500;
  if (status >= 500) console.error("[api]", err);
  res.status(status).json({
    error: status >= 500 ? "Error interno del servidor. Revisa la consola de la API." : err.message,
    rn: err.rn ?? null,
  });
});

/* Railway inyecta PORT; en local se usa API_PORT para no chocar con Vite. */
const puerto = Number(process.env.PORT || process.env.API_PORT || 4000);

try {
  const tablas = await verificarConexion();
  app.listen(puerto, "0.0.0.0", () =>
    console.log(
      `[hexa] escuchando en :${puerto} · schema "${SCHEMA}" · entorno ${ENTORNO} ` +
        `(${tablas} tablas)${hayBuild ? " · sirviendo dist/" : " · solo API"}`
    )
  );
} catch (e) {
  console.error(`[hexa] no se pudo conectar a la base: ${e.message}`);
  process.exit(1);
}
