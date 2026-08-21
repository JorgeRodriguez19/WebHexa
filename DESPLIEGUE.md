# Despliegue en Railway

Guía para publicar el panel con una **copia de `beta`** en Railway, para
mostrar la web sin tocar la base real que usa el chatbot.

> **La copia es una foto congelada.** Lo que se registre en la demo no llega al
> chatbot, y lo que el chatbot escriba en AWS RDS no aparecerá en la demo. Para
> que ambos compartan datos de verdad hay que tener **una sola instancia**: o se
> mueve la base a Railway y se repunta n8n, o la web se conecta a RDS. Ver la
> sección final.

---

## Cómo queda montado

Un **solo servicio web** sirve la interfaz y la API en el mismo origen:
Express entrega el build de Vite desde `dist/` y atiende `/api/*`. No hace
falta CORS ni un segundo servicio, y no hay que configurar la URL de la API en
el front porque usa rutas relativas.

```
Railway
├── Postgres            ← copia del schema beta
└── panel-hexa (web)    ← Express: dist/ + /api
```

---

## 1 · Subir el código a GitHub

El repositorio ya está iniciado y **`.gitignore` excluye lo sensible**:
`.env`, `Base de datos.txt` (trae las credenciales en claro), el `.json` del
flujo n8n y la documentación del cliente.

```bash
cd "C:\Users\PC\Documents\Devol\Web Hexa 2"
git add -A
git commit -m "Panel Hexa: login, aislamiento por empresa y despliegue"
git branch -M main
git remote add origin https://github.com/<tu-usuario>/panel-hexa.git
git push -u origin main
```

**Crea el repositorio como privado.** Aunque no se sube ningún secreto, el
código describe la estructura de la base y las reglas de negocio del cliente.

---

## 2 · Crear el proyecto en Railway

1. **New Project → Deploy from GitHub repo** y elige el repositorio.
2. Railway detecta Node con Nixpacks y lee `railway.json`, que ya define el
   build (`npm run build`), el arranque (`npm start`) y el chequeo de salud
   (`/api/salud`). No hay que configurar comandos a mano.
3. El primer despliegue **fallará** hasta que existan las variables de entorno
   y la base. Es lo esperado; continúa con el paso 3.

---

## 3 · Añadir Postgres

En el proyecto: **New → Database → Add PostgreSQL**.

Railway crea la variable `DATABASE_URL`. Para que el servicio web la use, en
**Variables** del servicio web añade una referencia:

```
DATABASE_URL = ${{Postgres.DATABASE_URL}}
```

Esa forma (`${{Servicio.VARIABLE}}`) es la de Railway para compartir variables
entre servicios, y usa la red interna, que es más rápida y no sale a internet.

---

## 4 · Variables de entorno del servicio web

| Variable | Valor | Por qué |
|---|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` | Conexión a la base de Railway |
| `PGSCHEMA` | `beta` | La copia mantiene el nombre para que la estructura coincida (sin `"Status"`, sin `aprobado`) |
| `ENTORNO` | `demo` | Marca que **no** es producción: el distintivo de la web dice "Demo" y no advierte en rojo |
| `PGSSL` | `off` | El Postgres interno de Railway no usa SSL y falla si se fuerza |
| `SESION_SECRETO` | *(64 caracteres al azar)* | Firma los tokens de sesión |

Genera el secreto con:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

`PORT` la inyecta Railway sola: no la definas.

---

## 5 · Copiar los datos de `beta` a Railway

En el servicio Postgres de Railway, pestaña **Variables**, copia
`DATABASE_PUBLIC_URL` (la que apunta a `…proxy.rlwy.net`). Hace falta la
**pública** porque el script corre desde tu PC, no dentro de Railway.

Primero en simulación, que solo lee y no escribe nada:

```bash
cd "C:\Users\PC\Documents\Devol\Web Hexa 2"

set DESTINO_URL=postgresql://postgres:...@...proxy.rlwy.net:12345/railway
npm run copiar beta beta
```

Revisa el inventario que imprime (17 tablas, ~15 800 filas) y luego aplícalo:

```bash
npm run copiar beta beta -- --aplicar
```

El script crea las tablas leyendo el DDL real de `pg_catalog`, copia los datos
en lotes conservando los identificadores originales, recrea las restricciones y
reposiciona las secuencias. Al final compara los conteos de origen y destino.

> **Solo lee del origen.** Nunca escribe en AWS RDS.

---

## 6 · Cambiar las contraseñas

Las contraseñas iniciales están en el código del script de migración, que es
público dentro del repositorio. **Cámbialas antes de compartir la URL:**

```bash
set DESTINO_URL=
set DATABASE_URL=postgresql://postgres:...@...proxy.rlwy.net:12345/railway

npm run credencial beta listar
npm run credencial beta clave office.manager@hexa.com.mx <nueva>
npm run credencial beta clave admin@hexa.com.mx <nueva>
```

> Los scripts de credenciales leen la conexión del `.env`. Para apuntarlos a
> Railway, usa un `.env` aparte o exporta `PGHOST`/`PGUSER`/`PGPASSWORD` con los
> datos de Railway en esa terminal.

---

## 7 · Publicar y comprobar

En **Settings → Networking → Generate Domain** obtienes la URL pública.

Comprueba:

```bash
curl https://<tu-dominio>.up.railway.app/api/salud
```

Debe responder `"schema":"beta"` y `"etiqueta":"Demo"`. Luego abre la URL en el
navegador: verás la pantalla de acceso.

---

## Qué ya está resuelto en el código

- **Un solo servicio.** Express sirve `dist/` con fallback de SPA, así que
  recargar en `/salas` no da 404. Los assets llevan hash y se cachean un año;
  el `index.html` nunca se cachea.
- **`PORT` y `0.0.0.0`.** Railway asigna el puerto y exige escuchar en todas
  las interfaces.
- **`DATABASE_URL` y SSL configurable.** Funciona igual contra RDS (con SSL) y
  contra Railway (sin SSL, red interna).
- **CORS cerrado en producción.** Solo se abre si no hay build o si se fuerza
  con `CORS_ABIERTO=on`.
- **`trust proxy`.** Detrás del proxy de Railway, para que el límite de
  intentos de login vea la IP real del visitante.
- **Freno de fuerza bruta.** 8 intentos fallidos por IP y por correo en 15
  minutos; luego 429 durante el resto de la ventana. Ajustable con
  `LOGIN_MAX_INTENTOS` y `LOGIN_VENTANA_MIN`.

---

## Pendiente antes de un uso serio

- **El token vive en `localStorage`.** Con HTTPS (que Railway da) es aceptable,
  pero lo correcto es una cookie `HttpOnly` + `Secure`. Es un cambio contenido:
  afecta `server/rutas/sesion.js` y `src/lib/api.js`.
- **Sin bitácora de accesos.** Solo se guarda `ultimo_acceso` por credencial.
- **El freno de intentos vive en memoria.** Con varias réplicas cada una
  contaría por su cuenta. Para eso haría falta una tabla o Redis.

---

## Si más adelante quieres una sola base compartida

La demo divergirá en cuanto alguien la use. Para unificar hay dos caminos:

**Mover la base a Railway y repuntar el chatbot.** En n8n la conexión de
Postgres es **una credencial compartida** por todos los nodos: cambias host,
base, usuario y contraseña en un solo lugar y el flujo entero pasa a Railway.
Hay que copiar `beta` con datos frescos justo antes del corte y parar el
chatbot mientras se copia, para no perder escrituras.

**Dejar la base en RDS.** Entonces el servicio de Railway necesita salida hacia
RDS, y el security group filtra por IP. Railway no da IP de salida fija en los
planes básicos, así que tocaría contratar esa opción o abrir el grupo a rangos
amplios, lo que **no es recomendable** con una base productiva.

La replicación no resuelve esto: dejaría el destino en solo lectura y las
escrituras de la web no volverían al origen.
