# Panel Hexa · Torre Reforma

Aplicación web de gestión de **accesos y salas** para los inquilinos de Torre Reforma
(cliente Hexa). Es la contraparte web del chatbot de WhatsApp
`Chatbot Hexa BETA - Whatsapp Meta`: **aplica las mismas reglas de negocio sobre la
misma base de datos**, pero con interfaz en lugar de conversación.

---

## Arranque

```bash
npm install
npm run dev          # API en :4000 + web en :5173
```

| Script | Qué hace |
|---|---|
| `npm run dev` | Levanta API y web a la vez |
| `npm run server` | Solo la API (Express, puerto 4000) |
| `npm run web` | Solo la web (Vite, puerto 5173, proxea `/api` al 4000) |
| `npm run build` | Build de producción |
| `npm run smoke` | Monta la app en jsdom contra la API viva y recorre las seis vistas |
| `npm run prueba` | Prueba de escritura de punta a punta; **deshace todo al terminar** |
| `npm run integridad` | Compara los conteos del schema contra el estado esperado |

Las credenciales viven en `.env` (no versionado). Ver `.env.example`.

---

## ⚠️ Schemas: `development` y `beta` (producción)

La base `hexa` tiene cuatro schemas: **`beta`, `development`, `public`, `test`**.

- **`beta` es PRODUCCIÓN**: ahí opera el chatbot de WhatsApp. La aplicación está
  autorizada a leer y escribir en él (decisión del cliente, 2026-08-14).
- **`development`** es el entorno de pruebas.
- **`public` y `test` no se tocan nunca.**

Impuesto en código, no por convención:

- `server/db.js` **aborta el arranque** con cualquier otro schema y **advierte
  por consola** cuando arranca en `beta`.
- Toda consulta califica la tabla con `T()` → `"<schema>"."tabla"`. Nunca se
  depende de `search_path`.
- `server/capacidades.js` concentra las **diferencias de estructura** entre
  ambos schemas, para no tener condicionales sueltos por el código.
- `npm run prueba` (escribe y revierte) **se niega a correr** si el schema no es
  `development`, comprobando tanto el `.env` como el schema de la API viva.

Se cambia con `PGSCHEMA` en `.env`. El schema activo se ve en la barra superior
de la web, en rojo cuando es producción.

### Diferencias entre `beta` y `development`

No son copias idénticas. Verificado con `npm run comparar` (solo lectura):

| Diferencia | Consecuencia |
|---|---|
| `accesos` **no tiene columna de vigencia** en beta | Un acceso que existe está vigente. La baja real se hace copiando a `historico` y **borrando** la fila. |
| `actualizaciones.aprobado` **no existe** en beta | El desenlace se registra en `usuario_revision`; el rechazo se marca con el prefijo `"Rechazada:"` en `comentarios`. |
| `solicitudes_salas.aprobado` **no existe** en beta | Igual. |
| `empleados.fecha_capacitacion` solo en beta | No se usa. |
| `tipo_vehiculos` incluye "Moto" en beta | Se lee del catálogo. |

**Bajas y reactivaciones (`tipo_cambio` B y A) están deshabilitadas en beta**
porque implicarían borrar filas de `accesos`. Devuelven un error explicativo con
RN-016. Decisión pendiente del cliente.

---

## Arquitectura

```
shared/reglas.js        Reglas de negocio puras (RN-###). Único módulo que
                        importan tanto el servidor como la web, para que la
                        validación del cliente y la del backend no diverjan.

server/
  db.js                 Pool de pg, guardia de schema, parsers de tipo
  sql.js                Todas las consultas SQL, con su nota de negocio
  util.js               Validación de entrada + ErrorHttp
  rutas/lectura.js      GET catálogos, panel por empresa, ocupación
  rutas/accesos.js      Solicitudes N/R/S/A/B, resolución, empleados, vehículos
  rutas/salas.js        Disponibilidad, solicitudes de sala, resolución

src/
  App.jsx               Shell: selectores, carga de datos, acciones, avisos
  lib/api.js            Cliente HTTP; propaga { error, rn } de la API
  lib/ui.jsx            Componentes del prototipo (Card, Modal, Gauge, Franja…)
  lib/fmt.js            Fechas y dinero
  vistas/               Resumen · Salas · Accesos · Empleados · Vehículos · Solicitudes
```

**Dónde vive cada validación.** Las reglas se comprueban en el servidor, siempre,
dentro de una transacción. El cliente las repite solo para dar aviso temprano; si
el cliente y el servidor discrepan, gana el servidor y su mensaje se muestra tal
cual, con su identificador `RN-###`.

---

## Modelo de datos real (schema `development`)

Trampas confirmadas contra la base, **distintas de lo que sugieren el prototipo
y los prompts del flujo n8n**:

| Tabla | Qué hay que saber |
|---|---|
| `accesos` | La columna de vigencia es **`"Status"`** con mayúscula: hay que entrecomillarla. No existe `estado`. |
| `empresas` | También tiene `"Status"`. `num_contrato` es nullable pese a ser obligatorio en `actualizaciones`. |
| `empleados` | Solo `id, nombre_completo, id_empresa, capacitacion, estado`. **No hay puesto ni correo** (el prototipo los inventaba). |
| `vehiculos` | **No tiene `id_empresa`**: el alcance por empresa se deriva del empleado conductor. Tampoco hay cajón; el modelo se llama `submarca`. |
| `reservaciones` | **No tiene `id_empresa`**: se deriva de `id_usuario`. El motivo se llama `tipo_evento` y la fecha `fecha_reservacion`. |
| `solicitudes_salas` | `servicios` es un JSON indexado en base 1: `{"1":{"tipo":…,"proveedor":…}}`. |
| `salas` | `precio_hora` está **en dólares** (25, 50, 150, 1000). `piso` es entero. La **Terraza opera 18:00–24:00**, las demás 08:00–18:00. |
| `tarjetas` | Inventario de plásticos. `accesos.num_tarjeta` es FK a esta tabla y NOT NULL: **no se puede emitir un acceso sin un plástico libre**. Al momento de escribir esto hay 6. |
| Todos los `id` | Son `GENERATED ALWAYS AS IDENTITY`: nunca se insertan explícitamente. |
| Extensión `unaccent` | **NO está instalada** (solo `plpgsql`). La RN-027 se implementa con `translate` en SQL y con `normalize("NFD")` en JS. |

### Estados de solicitud

La base ya traía su propia convención, distinta de la del prototipo
(`actualizaciones.estado_revision` y `solicitudes_salas.estado` solo contienen
`'P'` y `'F'` en las 281 filas históricas; la columna `aprobado` existe pero nunca
se llenó). Se respeta esa convención y se usa `aprobado` para el desenlace:

| `estado_revision` / `estado` | `aprobado` | Significado |
|---|---|---|
| `P` | `null` | Pendiente |
| `F` | `true` | Aprobada |
| `F` | `false` | Rechazada |
| `F` | `null` | Finalizada (filas históricas, sin desenlace registrado) |
| `C` | `false` | Cancelada por el solicitante |

Ver `estadoSolicitud()` en `shared/reglas.js`.

---

## Reglas de negocio implementadas

Los identificadores son los de `Documentacion_Chatbot_Hexa_BETA_WhatsApp.md`.

| RN | Regla | Dónde |
|---|---|---|
| RN-005 | Todo se acota a la empresa del usuario | Parámetro `$1` en cada consulta + `empleadoDeEmpresa` / `accesoDeEmpresa` |
| RN-009 | No se inventan datos; los campos obligatorios se exigen | `server/util.js` |
| RN-011 / RN-012 | Cupo VIP y vehicular del contrato; los peatonales no consumen | `validarCupo()`, `SQL_CUPOS` |
| RN-013 | Toda solicitud nace en `'P'`, pendiente de administración | `insertarSolicitud()` |
| RN-014 | El empleado debe existir antes de pedirle una tarjeta | `empleadoDeEmpresa()` |
| RN-015 | Sin empleados ni placas duplicados | `POST /empleados`, `POST /vehiculos` |
| RN-016 | Baja solo si está activo; alta solo si está inactivo | `rutas/accesos.js` |
| RN-017 | La tarjeta debe existir en `accesos` y ser de la empresa | `accesoDeEmpresa()` |
| RN-019 | Fecha futura y día hábil | `validarFechaReservacion()` |
| RN-020 | Bandas de capacidad 8/12/22/96/150 con salto a la superior | `buscarSalas()` |
| RN-021 | Sin solapamiento (estricto: 09–11 y 11–13 conviven) | `SQL_SALAS_DISPONIBLES` |
| RN-022 | Costo = `precio_hora` × horas, en USD | `costoEstimado()` |
| RN-023 | La reserva se guarda en `'P'` | `POST /solicitudes/sala` |
| RN-027 | Búsquedas sin acentos ni mayúsculas | `NORM()` en SQL, `norm()` en JS |

### Dos desviaciones deliberadas respecto al flujo n8n

Ambas corrigen huecos que la propia documentación señala como riesgos:

1. **El cupo cuenta también las solicitudes pendientes.** El chatbot solo mira
   `accesos`, así que varias solicitudes `'P'` simultáneas pueden rebasar el
   contrato. Aquí `SQL_CUPOS` suma asignados + pendientes.
2. **La disponibilidad de sala excluye también las solicitudes pendientes.**
   `Postgre_find_sala` solo consulta `reservaciones` (aprobadas), lo que permite
   dos solicitudes en conflicto para el mismo horario (observación 6 de la
   documentación). `SQL_SALAS_DISPONIBLES` añade el `NOT EXISTS` sobre
   `solicitudes_salas` en estado `'P'`.

---

## Sesión y alcance por empresa

Hay **login real**. La base no traía credenciales (el chatbot identifica por
WhatsApp), así que se añadió la tabla **`web_credenciales`**, propia de la web,
que no toca ninguna tabla del chatbot.

- Contraseñas con **scrypt** (`node:crypto`), sal por credencial.
- Sesión sin estado: **token firmado con HMAC-SHA256**, 12 h de vigencia.
- **La empresa viaja dentro del token firmado.** El servidor la impone y
  descarta cualquier `id_empresa` del cliente: cambiar un parámetro no sirve.
  Si una cuenta normal pide otra empresa, responde **403**.
- `/api/ocupacion/:fecha` devuelve todas las salas (hace falta para no chocar al
  reservar) pero **el servidor borra** el evento, el solicitante y los invitados
  de los bloques ajenos.
- `/api/administracion/solicitudes` y resolver solicitudes exigen
  **superusuario** (`exigirSuperusuario`).

| Cuenta | Alcance |
|---|---|
| `office.manager@hexa.com.mx` | Solo la empresa HEXA |
| `admin@hexa.com.mx` | Superusuario: todas las empresas, bandeja global |

Las contraseñas iniciales están en `CONTEXTO.md`. **Cámbialas** con
`npm run credencial <schema> clave <correo> <nueva>`.

Un superusuario no pertenece a ninguna empresa (`id_usuario` nulo). Como
`actualizaciones.id_usuario` es NOT NULL, al registrar algo actúa a nombre del
primer usuario activo de la empresa que esté viendo (`usuarioParaActuar`).

**Falta para producción abierta:** HTTPS y mover el token de `localStorage` a
cookie `HttpOnly`. Hoy es apto para red interna.

---

## Fuera de alcance

Decidido con el cliente; no está implementado:

- Reprogramar o cancelar una reservación **ya aprobada**. La tabla `reservaciones`
  no modela solicitudes de cambio y `solicitudes_salas` solo representa altas.
- Escritura en `historico` al liberar un acceso.
- Administración de catálogos (empresas, usuarios, salas, inventario de tarjetas).
- Vista de conversaciones del chatbot (`logmensajes`, `n8n_chat_histories`).
- Los dominios del chatbot que no son accesos ni salas: documentos/RAG (Pinecone),
  anexos de Google Drive, carga masiva por Excel.

---

## Verificación

`npm run prueba` crea solicitudes reales, las aprueba, comprueba el efecto en la
base y **revierte todo** (13 operaciones de limpieza). `npm run integridad`
confirma después que los conteos volvieron al estado original. Ambos scripts
operan exclusivamente sobre `development`.
