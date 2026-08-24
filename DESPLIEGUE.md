# Despliegue en Railway

Guía para publicar el panel en Railway.

> **Decisión tomada el 2026-08-24: conexión directa a AWS RDS, schema `beta`.**
> El panel y el chatbot comparten la misma base, así que lo que se registra en
> la web lo ve el chatbot en vivo, y al revés. Esto sustituye al plan anterior
> de subir una copia de `beta` a un Postgres de Railway, que quedaba desfasada
> desde el primer día. Ese plan sigue documentado abajo como alternativa.
>
> **Se opera sobre producción.** `ENTORNO=produccion` hace que la web lo avise
> en rojo. Cambia las contraseñas iniciales *antes* de generar el dominio.

---

## Cómo queda montado

Un **solo servicio web** sirve la interfaz y la API en el mismo origen:
Express entrega el build de Vite desde `dist/` y atiende `/api/*`. No hace
falta CORS ni un segundo servicio, y no hay que configurar la URL de la API en
el front porque usa rutas relativas.

```
Railway
└── WebHexa (web)    ← Express: dist/ + /api
                        │
                        └──► AWS RDS · base "hexa" · schema "beta"
                                 ▲
                                 └── n8n (chatbot de WhatsApp)
```

**No hace falta un servicio de Postgres en Railway.** Si lo creaste, bórralo.

### Por qué funciona la conexión directa

El grupo de seguridad de RDS acepta conexiones desde cualquier IP, así que
Railway entra sin necesidad de IP de salida fija. Se comprobó con un proyecto
anterior de Railway que se conectaba al mismo host.

> Eso también significa que la base productiva está expuesta a internet. La
> contraseña ha circulado en claro (`Base de datos.txt`). Rotarla es lo
> prudente, pero implica actualizar la credencial de Postgres en n8n.

---

## 1 · Subir el código a GitHub

Hecho: `https://github.com/JorgeRodriguez19/WebHexa`, rama `main`.

`.gitignore` excluye lo sensible: `.env`, `Base de datos.txt` (trae las
credenciales en claro), el `.json` del flujo n8n y la documentación del
cliente. **El repositorio debe ser privado**: aunque no lleva secretos, el
código describe la estructura de la base y las reglas de negocio del cliente.

Si git falla con `SSL certificate problem: unable to get local issuer
certificate`, es la red corporativa interceptando HTTPS. Se resuelve usando el
almacén de certificados de Windows, **sin** desactivar la verificación:

```bash
git config http.sslBackend schannel
```

Para cambiar de cuenta de GitHub, borra la credencial guardada. PowerShell 5.1
no pasa bien los datos por tubería a un ejecutable nativo, así que va por
archivo:

```bash
printf "protocol=https\nhost=github.com\n\n" > .git/cred.txt
cmd /c "git credential reject < .git\cred.txt"
del .git\cred.txt
```

El siguiente `git push` abrirá el navegador para autenticarse.

---

## 2 · Crear el proyecto en Railway

1. **New Project → Deploy from GitHub repo** y elige el repositorio.
2. Railway detecta Node con Nixpacks y lee `railway.json`, que ya define el
   build (`npm run build`), el arranque (`npm start`) y el chequeo de salud
   (`/api/salud`). No hay que configurar comandos a mano.
3. El primer despliegue **falla** hasta que existan las variables. Es lo
   esperado: sin ellas `verificarConexion()` no encuentra a dónde conectarse,
   el proceso termina con `exit(1)` y el healthcheck no responde. El síntoma en
   la interfaz es *Build ✓ · Deploy ✓ · Network → Healthcheck ✗*, y en **Deploy
   Logs** aparece `[hexa] no se pudo conectar a la base: …`.

---

## 3 · Variables de entorno del servicio web

| Variable | Valor | Por qué |
|---|---|---|
| `PGHOST` | `db-hexa.cpmk6okaa11k.us-east-2.rds.amazonaws.com` | La instancia de RDS |
| `PGPORT` | `5432` | |
| `PGDATABASE` | `hexa` | |
| `PGUSER` | `postgres` | |
| `PGPASSWORD` | *(la de `Base de datos.txt`)* | |
| `PGSCHEMA` | `beta` | Producción, la que usa el chatbot |
| `PGSSL` | `on` | RDS exige TLS |
| `ENTORNO` | `produccion` | La web avisa en rojo que son datos reales |
| `SESION_SECRETO` | *(64 caracteres al azar)* | Firma los tokens de sesión |

Genera el secreto con:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**Tres trampas con los nombres:**

- Sin guion bajo: `PGHOST`, no `PG_HOST`. Son los nombres estándar de `libpq`.
- `SESION_SECRETO` en español, no `SESSION_SECRET`. Con el nombre equivocado el
  servidor se inventa un secreto temporal y las sesiones mueren en cada
  reinicio.
- **No definas `DATABASE_URL`.** Si existe, `server/db.js` la prefiere sobre las
  variables sueltas.

`PORT` la inyecta Railway sola: no la definas.

---

## 4 · Cambiar las contraseñas

Las iniciales están escritas en `scripts/migracion-login.mjs`, dentro del
repositorio. **Cámbialas antes de generar el dominio público**, porque el panel
escribe en producción:

```bash
cd "C:\Users\PC\Documents\Devol\Web Hexa 2"
npm run credencial beta listar
npm run credencial beta clave office.manager@hexa.com.mx <nueva>
npm run credencial beta clave admin@hexa.com.mx <nueva>
```

Los scripts leen la conexión del `.env` local, que ya apunta a RDS `beta`.

---

## 5 · Publicar y comprobar

En **Settings → Networking → Generate Domain** obtienes la URL pública.

```bash
curl https://<tu-dominio>.up.railway.app/api/salud
```

Debe responder `"schema":"beta"`, el número de tablas, y dentro de `entorno`,
`"produccion":true` con `"etiqueta":"PRODUCCIÓN"`. Luego abre la URL en el
navegador: verás la pantalla de acceso con el aviso rojo.

---

## Qué ya está resuelto en el código

- **Un solo servicio.** Express sirve `dist/` con fallback de SPA, así que
  recargar en `/salas` no da 404. Los assets llevan hash y se cachean un año;
  el `index.html` nunca se cachea.
- **`PORT` y `0.0.0.0`.** Railway asigna el puerto y exige escuchar en todas
  las interfaces.
- **Dos formas de conexión y SSL configurable.** `DATABASE_URL` o las variables
  sueltas; SSL se activa salvo que el host sea interno de Railway o localhost.
- **CORS cerrado en producción.** Solo se abre si no hay build o si se fuerza
  con `CORS_ABIERTO=on`.
- **`trust proxy`.** Detrás del proxy de Railway, para que el límite de
  intentos de login vea la IP real del visitante.
- **Freno de fuerza bruta.** 8 intentos fallidos por IP y por correo en 15
  minutos; luego 429 durante el resto de la ventana. Ajustable con
  `LOGIN_MAX_INTENTOS` y `LOGIN_VENTANA_MIN`.
- **Aislamiento por empresa impuesto en el servidor.** La empresa viaja dentro
  del token firmado; pedir otra da 403.

---

## Pendiente antes de un uso serio

Ahora que el panel está en internet y escribe en producción, esto sube de
prioridad:

- **El token vive en `localStorage`.** Con HTTPS (que Railway da) es aceptable,
  pero lo correcto es una cookie `HttpOnly` + `Secure`. Es un cambio contenido:
  afecta `server/rutas/sesion.js` y `src/lib/api.js`.
- **Sin bitácora de accesos.** Solo se guarda `ultimo_acceso` por credencial.
  Sobre datos reales conviene registrar quién entró y qué cambió.
- **El freno de intentos vive en memoria.** Con varias réplicas cada una
  contaría por su cuenta. Para eso haría falta una tabla o Redis.
- **Las bajas de acceso siguen deshabilitadas en `beta`** (devuelven un error
  explicativo RN-016). Falta decidir si se implementan como en el chatbot:
  copiar a `historico` y borrar de `accesos`.

---

## Alternativa: una copia en Railway (no es lo que se hizo)

Si alguna vez hace falta una demo aislada que no toque la base real:

1. **New → Database → Add PostgreSQL** y en el servicio web pon
   `DATABASE_URL = ${{Postgres.DATABASE_URL}}`, `PGSCHEMA=beta`,
   `ENTORNO=demo`, `PGSSL=off` (el Postgres interno de Railway no usa TLS).
   La copia conserva el nombre `beta` para que la estructura coincida.
2. **Copia los datos antes de redesplegar.** El Postgres nuevo está vacío y
   `verificarConexion()` también falla si el schema no existe, así que el
   healthcheck seguiría rojo. Con `DATABASE_PUBLIC_URL` del servicio Postgres
   (la de `…proxy.rlwy.net`, porque el script corre desde tu PC):

   ```bash
   set DESTINO_URL=postgresql://postgres:...@...proxy.rlwy.net:12345/railway
   npm run copiar beta beta              # simulación: solo lee
   npm run copiar beta beta -- --aplicar
   ```

   El script crea las tablas leyendo el DDL real de `pg_catalog`, copia los
   datos en lotes conservando los identificadores, recrea las restricciones y
   reposiciona las secuencias. **Solo lee del origen**: nunca escribe en RDS.

Esa copia es una foto congelada: divergirá en cuanto alguien la use. La
replicación tampoco resolvería el problema, porque dejaría el destino en solo
lectura y las escrituras de la web no volverían al origen.
