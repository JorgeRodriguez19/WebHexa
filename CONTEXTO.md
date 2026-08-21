# CONTEXTO — Panel Hexa · Torre Reforma (Web Hexa 2)

> **Punto de entrada tras un `/clear`.** Este archivo resume el estado completo del
> proyecto para poder retomar el trabajo sin volver a analizar nada.
>
> Última actualización: **2026-08-10**, al terminar la construcción inicial.
>
> Documentos complementarios, en el mismo directorio:
> - **`CLAUDE.md`** — manual técnico: arranque, arquitectura, modelo de datos real,
>   tabla de reglas de negocio, perfiles, alcance.
> - **`ANALISIS.md`** — trazabilidad: de dónde salió cada decisión y cómo se
>   resolvieron las contradicciones entre los archivos fuente.
>
> **Ojo:** la sesión suele estar rooteada en `C:\Users\PC\Documents\Devol\Claude Code`,
> no en este proyecto, así que `CLAUDE.md` **no se auto-carga**. Hay que leerlo a mano.

---

## 1. Qué es esto y de dónde salió

**Ruta del proyecto:** `C:\Users\PC\Documents\Devol\Web Hexa 2`

Aplicación web de gestión de **accesos y salas** para los inquilinos de Torre Reforma
(cliente: **Hexa**, cuenta de Devol; el usuario es **Jorge Rodríguez**, prefiere que
se le hable en **español**).

Es la contraparte web de un chatbot de WhatsApp hecho en n8n: **aplica las mismas
reglas de negocio sobre la misma base de datos**, pero con interfaz gráfica en lugar
de conversación.

### Archivos fuente que originaron el proyecto (siguen en la carpeta)

| Archivo | Qué es | Prioridad de interpretación |
|---|---|---|
| `Chatbot Hexa BETA - Whatsapp Meta.json` | Export del flujo n8n. Fuente de verdad de la lógica real. | **1** |
| `Documentacion_Chatbot_Hexa_BETA_WhatsApp.md` | Documentación funcional derivada del `.json`. Define los identificadores **RN-###**. | **2** |
| `panel-hexa-accesos-salas.jsx` | Prototipo visual de una sola pieza, con datos falsos. **Referencia estética, no funcional.** | **3** |
| `Base de datos.txt` | Credenciales de Postgres. | **4** |

A esas cuatro se sumó una quinta fuente que resultó decisiva: **el schema
`development` real**, inspeccionado directamente. **Cuando el `.json` y la base
discrepan, manda la base.**

### Historia importante

Existe una **primera versión** en `C:\Users\PC\Documents\Devol\Claude Web Hexa`
(del 2026-08-07). Jorge pidió explícitamente **construir de cero en una carpeta
nueva** en lugar de continuarla. La primera versión queda como **respaldo/referencia,
no se toca ni se borra**.

---

## 2. ⚠️ Restricción crítica de base de datos

La base `hexa` (AWS RDS) tiene **cuatro schemas: `beta`, `development`, `public`,
`test`**.

**Estado actual (2026-08-14): la aplicación está conectada a `beta`, que es
PRODUCCIÓN**, con lectura y escritura, por decisión expresa de Jorge. Ver la
entrada del 2026-08-14 en la sección 12: hay diferencias de estructura entre
`beta` y `development` que obligaron a cambios de código.

Reglas que siguen vigentes:
- **`public` y `test` no se tocan nunca.** Nadie ha autorizado operar en ellos.
- `server/db.js` **aborta el arranque** si `PGSCHEMA` no es `development` ni
  `beta`, y **advierte por consola** cuando arranca en producción.
- Toda consulta califica la tabla con el helper `T()` → `"<schema>"."tabla"`.
  Nunca se depende de `search_path`.
- El schema activo se cambia con `PGSCHEMA` en `.env` y se ve en la barra
  superior de la web (distintivo rojo cuando es `beta`).

Credenciales en `.env` (no versionado; hay `.env.example`).
Host `db-hexa.cpmk6okaa11k.us-east-2.rds.amazonaws.com`, base `hexa`, usuario `postgres`.

---

## 3. Decisiones que Jorge tomó explícitamente

Se le preguntó y respondió esto. **No revertir sin volver a preguntar.**

1. **Ubicación** → proyecto nuevo en `Web Hexa 2`, sin tocar el anterior.
2. **Identidad de usuario** → **selector de empresa/perfil en la barra superior**,
   como el prototipo. Sin login, sin cambios de schema.
3. **Alcance** → **solo el panel de accesos y salas del prototipo**.
   Descartó explícitamente: administración de catálogos, vista de conversaciones
   del chatbot (`logmensajes` / `n8n_chat_histories`), y la gestión completa de
   inventario.

---

## 4. Stack y arranque

```bash
cd "C:\Users\PC\Documents\Devol\Web Hexa 2"
npm install
npm run dev          # API en :4000 + web en :5173
```

| Script | Qué hace |
|---|---|
| `npm run dev` | Levanta API y web a la vez (concurrently) |
| `npm run server` | Solo la API (Express 5, puerto 4000) |
| `npm run web` | Solo la web (Vite 6, puerto 5173, proxea `/api` al 4000) |
| `npm run build` | Build de producción |
| `npm run smoke` | Monta la app en jsdom contra la API viva y recorre las seis vistas |
| `npm run prueba` | Prueba de escritura de punta a punta; **deshace todo al terminar** |
| `npm run integridad` | Compara los conteos del schema contra el estado esperado |
| `npm run restos` | Busca filas de prueba olvidadas |

**Stack:** React 18 + Vite 6 + Tailwind v4 (`@tailwindcss/vite`) + lucide-react ·
Express 5 + `pg` · jsdom + esbuild solo para las pruebas.

**Nota de entorno:** el servidor de preview del harness (`preview_start`) **no
funciona en esta máquina** — falla incluso con configuraciones que ya existían.
Por eso la verificación se hace con `npm run smoke` (jsdom) en vez de un navegador
real. No hay capturas de pantalla; para validar diseño hay que pedirle a Jorge que
lo abra en http://localhost:5173.

---

## 5. Arquitectura

```
shared/reglas.js        Reglas de negocio puras (RN-###). ÚNICO módulo que importan
                        tanto el servidor como la web, para que la validación del
                        cliente y la del backend no diverjan. 150 líneas.

server/
  db.js                 Pool de pg, guardia de schema, parsers de tipo
  sql.js                TODAS las consultas SQL, cada una con su nota de negocio
  util.js               Validación de entrada + clase ErrorHttp
  index.js              App Express, montaje de rutas, manejador central de errores
  rutas/lectura.js      GET catálogos, panel por empresa, ocupación, bandeja admin
  rutas/accesos.js      Solicitudes N/R/S/A/B, resolución, empleados, vehículos
  rutas/salas.js        Disponibilidad, solicitudes de sala, resolución

src/
  App.jsx               Shell: selectores, carga de datos, acciones, avisos, nav
  estilos.css           Tema Hexa completo (importa Tailwind + todas las clases hx-*)
  lib/api.js            Cliente HTTP; propaga { error, rn } de la API
  lib/ui.jsx            Componentes del prototipo (Card, Btn, Badge, Field, Modal,
                        Gauge, Franja, Cabecera, Metrica, Vacio, Linea, Cargando)
  lib/fmt.js            Fechas legibles, dinero (USD), folios
  lib/useOcupacion.js   Hook que consulta la ocupación de un día
  vistas/               Resumen · Salas · Accesos · Empleados · Vehiculos · Solicitudes

scripts/                smoke.mjs · prueba-escritura.mjs · verificar-integridad.mjs
                        · revisar-restos.mjs
```

**Dónde vive cada validación:** las reglas se comprueban **en el servidor, siempre,
dentro de una transacción**. El cliente las repite solo para dar aviso temprano; si
discrepan, gana el servidor y su mensaje se muestra tal cual, con su `RN-###`.

### Endpoints

```
GET   /api/salud
GET   /api/catalogos                          empresas, usuarios, salas, horarios, tipos
GET   /api/empresa/:id/panel                  todo lo de una empresa en una llamada
GET   /api/reservaciones?desde=YYYY-MM-DD
GET   /api/ocupacion/:fecha                   aprobadas + pendientes, todas las salas
GET   /api/administracion/solicitudes         bandeja de todas las empresas
GET   /api/salas/disponibles?fecha&hora_inicio&hora_fin&num_invitados[&ignorar]
POST  /api/solicitudes/acceso                 tipo_cambio N|R|S|A|B
PATCH /api/solicitudes/acceso/:id/resolver    exige perfil=administracion
PATCH /api/solicitudes/acceso/:id/cancelar
POST  /api/solicitudes/sala
PATCH /api/solicitudes/sala/:id/resolver      exige perfil=administracion
PATCH /api/solicitudes/sala/:id/cancelar
POST  /api/empleados                          alta directa (sin revisión)
POST  /api/vehiculos                          alta directa (sin revisión)
GET   /api/empleados/buscar?id_empresa&q
```

---

## 6. Modelo de datos real — trampas confirmadas

Estas difieren de lo que sugieren el prototipo y los prompts del n8n. **Verificadas
por introspección contra la base.**

| Tabla | Qué hay que saber |
|---|---|
| `accesos` | La columna de vigencia es **`"Status"`** con mayúscula: hay que entrecomillarla. **No existe `estado`.** |
| `empresas` | También tiene `"Status"`. `num_contrato` es nullable pese a ser obligatorio en `actualizaciones`. |
| `empleados` | Solo `id, nombre_completo, id_empresa, capacitacion, estado`. **No hay puesto ni correo** (el prototipo los inventaba). |
| `vehiculos` | **No tiene `id_empresa`**: el alcance se deriva del empleado conductor. Tampoco hay cajón; el modelo se llama `submarca`. `placas` es NOT NULL. |
| `reservaciones` | **No tiene `id_empresa`**: se deriva de `id_usuario`. El motivo es `tipo_evento`, la fecha es `fecha_reservacion`. |
| `solicitudes_salas` | `servicios` es JSON indexado en base 1: `{"1":{"tipo":…,"proveedor":…}}`. `estado` es varchar(255). |
| `salas` | `precio_hora` está **en dólares** (25, 50, 150, 1000). `piso` es entero. **La Terraza opera 18:00–24:00**, las demás 08:00–18:00. |
| `tarjetas` | Inventario de plásticos (`id` es text). `accesos.num_tarjeta` es FK a esta tabla y NOT NULL: **no se puede emitir un acceso sin un plástico libre**. Solo hay **6 libres**. |
| Todos los `id` | Son `GENERATED ALWAYS AS IDENTITY`: **nunca se insertan explícitamente**. |
| Extensión `unaccent` | **NO está instalada** (solo `plpgsql`). La RN-027 se implementa con `translate()` en SQL y `normalize("NFD")` en JS. |
| Fechas | `pg` devolvía DATE como Date con desfase de zona. `server/db.js` fija parsers: DATE → `"YYYY-MM-DD"`, TIME → `"HH:MM"`, int8 → number, float4 → number. |

### Datos reales al 2026-08-10

```
empresas 8 · usuarios 10 · empleados 118 · tarjetas 65 · accesos 65
vehiculos 23 · salas 8 · reservaciones 48 · solicitudes_salas 76
actualizaciones 205 · historico 45 · horarios 2 · tipo_accesos 3 · tipo_vehiculos 2
tarjetas libres en inventario: 6
```

- **Empresas:** Devol(1, la que tiene todos los datos), Hexa(2), ATK(3), Netflix(5),
  Kotaro(6), Nike(7), Apple(8), DEVS(16).
- **Solo las empresas 1, 2, 3 y 5 tienen usuarios.** Las demás no pueden registrar
  movimientos porque `id_usuario` es NOT NULL. La web lo detecta y lo explica.
- **Solo las empresas 1, 2 y 11 tienen empleados.** (11 es huérfana: no existe esa
  empresa; `empleados.id_empresa` no tiene FK.)
- **Salas:** `Sala 1..3`(cap 12), `Sala 4`(6), `Sala 5`(8), `Sala de consejo`(22),
  `Auditorio`(96), `Terraza`(150, 18:00–24:00, $1000/h).
- **Catálogos:** `tipo_accesos` 1=VIP, 2=Vehicular, 3=Peatonal ·
  `horarios` 1=Oficina(08–18), 2=24/7 · `tipo_vehiculos` 1=Coche, 2=Camioneta.

### Estados de solicitud — convención adoptada

La base ya traía la suya, distinta de la del prototipo (las 281 filas históricas solo
tienen `'P'` y `'F'`; la columna `aprobado` existe pero nunca se llenó):

| `estado_revision` / `estado` | `aprobado` | Significado |
|---|---|---|
| `P` | `null` | Pendiente |
| `F` | `true` | Aprobada |
| `F` | `false` | Rechazada |
| `F` | `null` | Finalizada (filas históricas, sin desenlace) |
| `C` | `false` | Cancelada por el solicitante |

Ver `estadoSolicitud()` en `shared/reglas.js`.

---

## 7. Reglas de negocio implementadas

| RN | Regla | Dónde |
|---|---|---|
| RN-005 | Todo se acota a la empresa del usuario | `$1` en cada consulta + `empleadoDeEmpresa` / `accesoDeEmpresa` |
| RN-009 | Campos obligatorios; no se inventan datos | `server/util.js` |
| RN-011 / RN-012 | Cupo VIP y vehicular del contrato; los peatonales no consumen | `validarCupo()`, `SQL_CUPOS` |
| RN-013 | Toda solicitud nace en `'P'` | `insertarSolicitud()` |
| RN-014 | El empleado debe existir antes de pedirle tarjeta | `empleadoDeEmpresa()` |
| RN-015 | Sin empleados ni placas duplicados | `POST /empleados`, `POST /vehiculos` |
| RN-016 | Baja solo si está activo; alta solo si está inactivo | `rutas/accesos.js` |
| RN-017 | La tarjeta debe existir en `accesos` y ser de la empresa | `accesoDeEmpresa()` |
| RN-019 | Fecha futura y día hábil (lun–vie) | `validarFechaReservacion()` |
| RN-020 | Bandas 8/12/22/96/150 con salto a la superior | `buscarSalas()` |
| RN-021 | Sin solapamiento — **estricto**: 09–11 y 11–13 conviven | `SQL_SALAS_DISPONIBLES` |
| RN-022 | Costo = `precio_hora` × horas, **en USD** | `costoEstimado()` |
| RN-023 | La reserva se guarda en `'P'` | `POST /solicitudes/sala` |
| RN-027 | Búsquedas sin acentos ni mayúsculas | `NORM()` en SQL, `norm()` en JS |

### Dos desviaciones deliberadas respecto al flujo n8n

Corrigen huecos que la propia documentación marca como riesgos:

1. **El cupo cuenta también las solicitudes pendientes.** El chatbot solo mira
   `accesos`, así que varias solicitudes `'P'` simultáneas rebasan el contrato.
2. **La disponibilidad de sala excluye también las solicitudes pendientes.**
   `Postgre_find_sala` solo consulta `reservaciones` (aprobadas), lo que permite dos
   solicitudes en conflicto (observación 6 de la documentación).

### Otras desviaciones respecto al prototipo (todas justificadas en `ANALISIS.md`)

- Los tipos de solicitud `E` (empleado) y `V` (vehículo) del prototipo **no existen**:
  el `.json` inserta empleados y vehículos **directamente**, sin revisión. Se siguió el `.json`.
- La franja horaria se extendió de 07:00–20:00 a **08:00–24:00** por la Terraza, con
  sombreado diagonal para el horario cerrado de cada sala.
- La selección de sala usa `capacidad >= invitados AND capacidad <= banda` (el SQL real
  del nodo `Postgre_find_sala`), no `capacidad === banda` como el prototipo.
- El dinero se muestra en **USD**, no MXN.
- El medidor de cupo (`Gauge`) se degrada a barra continua por encima de 24 lugares
  (Devol tiene 30 VIP contratados y no caben 30 segmentos).

### Añadidos al prototipo, por necesidad del schema

- **Selector de solicitante** en la barra superior (`id_usuario` es NOT NULL).
- **Horario y "acceso robótico"** en el modal de tarjeta nueva (`id_horario` y
  `robotico` son NOT NULL, y el `Flujo_Solicitud_Tarjeta` los pide).
- **Servicios adicionales** en el paso 3 del asistente (paso 5 del
  `Flujo_Reservacion_Sala`; la columna `servicios` ya tiene datos reales).

---

## 8. Diseño visual — qué hay que conservar

Jorge dijo que **le gusta mucho el diseño del prototipo** y quiere conservarlo. Está
íntegro en `src/estilos.css`:

- Paleta: `--ink:#0F1722` · `--steel:#2C3D52` · `--mist:#E6E9E4` · `--card:#FBFBF9`
  · `--brass:#A87A35` · `--brass-soft:#E7D6B4` · `--signal:#2E7A5C` · `--alert:#A8443A`
  · `--line:#D3D7D1` · `--muted:#6C7770`
- Tipografías: **Archivo** (texto) + **IBM Plex Mono** (clase `.mono`), cargadas desde
  Google Fonts en `index.html`.
- Estética: bordes finos de 1px sin sombras, esquinas rectas (sin border-radius),
  badges monoespaciados en versalitas con letter-spacing, riel de navegación lateral
  de 200px con marca de latón en el activo, avisos inferiores con el `RN-###` visible.
- Piezas de firma: `Gauge` (medidor de cupo segmentado) y `Franja` (línea de tiempo
  horaria por sala).

**Al modificar la UI, mantener este lenguaje visual.**

---

## 9. Estado de verificación (al cierre de la construcción)

- **Build de producción:** limpio (`✓ built in ~3.6s`).
- **`npm run smoke`** — 21 comprobaciones: monta la app en jsdom contra la API viva,
  recorre las seis vistas, cambia a perfil administración, abre el asistente de
  reservación. **Todas pasan.**
- **`npm run prueba`** — 34 comprobaciones de escritura de punta a punta: crear
  solicitud → aprobar → verificar efecto en BD. Cubre cupo VIP (corta en el tope),
  aislamiento por empresa, emisión de tarjeta desde inventario, anti-solapamiento
  (bloquea el horario, permite el contiguo), duplicados con acentos, cancelación,
  y que un coordinador no pueda aprobar. **Todas pasan**, y revierte sus 13
  operaciones al terminar.
- **`npm run integridad`** — conteos idénticos al estado original, 6 tarjetas libres
  intactas. **Base limpia.**

**Sin verificar:** aspecto real en navegador (el preview del harness no funciona aquí).

---

## 10. Fuera de alcance / pendientes conocidos

Nada de esto está implementado:

- **Reprogramar o cancelar una reservación ya aprobada.** La tabla `reservaciones` no
  modela solicitudes de cambio y `solicitudes_salas` solo representa altas.
  **Jorge quedó de decidir si lo quiere**; requiere inventar una convención o tocar
  el schema. El prototipo tenía esos botones; se quitaron en lugar de fingir que
  funcionan.
- Escritura en `historico` al liberar un acceso.
- Administración de catálogos (empresas, usuarios, salas, inventario de tarjetas).
- Vista de conversaciones del chatbot (`logmensajes`, `n8n_chat_histories`).
- Los dominios del chatbot que no son accesos ni salas: documentos/RAG (Pinecone),
  anexos de Google Drive, carga masiva por Excel.
- **Autenticación real.** El perfil viaja en el cuerpo de la petición y el servidor
  exige `administracion` para resolver (`exigirAdministracion`), pero **esto no es
  seguridad**. Si el panel sale de la red interna, hay que poner login de verdad.

---

## 11. Cómo retomar

1. Leer este archivo, después `CLAUDE.md` y, si hace falta entender el *porqué* de
   alguna decisión, `ANALISIS.md`.
2. `cd "C:\Users\PC\Documents\Devol\Web Hexa 2"` y `npm run dev`.
3. Antes de dar por buena cualquier modificación: `npm run build`, `npm run smoke`,
   y si tocó escritura, `npm run prueba` seguido de `npm run integridad`.
4. **Nunca** apuntar a un schema distinto de `development`.

---

## 12. Cambios posteriores a la construcción inicial

### 2026-08-10 — Resumen: la franja solo muestra salas con actividad

A petición de Jorge, en la vista **Resumen** la tarjeta de la franja horaria:

- **se dibuja si y solo si** al menos una sala tiene actividad ese día;
- **lista únicamente** las salas con actividad, no las ocho.

"Actividad" = tiene un bloque en `/api/ocupacion/:fecha`, es decir **reservación
aprobada o solicitud pendiente** — lo mismo que la franja ya pintaba.

**Efecto secundario resuelto:** el selector de fecha vivía dentro de esa tarjeta y
habría desaparecido con ella, dejando al usuario sin poder cambiar de día. Se movió
a la cabecera de la vista, junto al título "Hoy en la torre". Mientras carga la
ocupación la tarjeta sí se muestra, con el spinner, para evitar parpadeo.

La vista **Salas** no cambió: ahí la franja sigue mostrando las ocho salas, porque
su propósito es elegir dónde reservar y las libres son justo las relevantes.

`scripts/smoke.mjs` se actualizó para comprobar **los dos lados** de la regla: que
hoy (sin reservaciones) la sección no se dibuja, y que en el día con más salas
ocupadas del histórico se dibujan exactamente esas y ninguna libre.

### 2026-08-11 — Accesos: se invirtió el orden de las dos listas

Ahora la **tabla de tarjetas asignadas** va arriba (después de los medidores de
cupo) y **Solicitudes en curso** al final. La tarjeta de solicitudes sigue
apareciendo solo si hay pendientes.

### 2026-08-11 — Bug de foco en TODOS los campos de texto de los modales

**Síntoma:** al escribir en un campo de un modal (lo reportó en el asistente de
reservación), cada letra hacía perder el foco; había que volver a hacer clic en el
campo para escribir la siguiente.

**Causa:** en `Modal` (`src/lib/ui.jsx`) el `useEffect` que ponía el foco inicial
tenía `onClose` en sus dependencias, y todos los modales lo pasan como flecha nueva
en cada render (`onClose={() => onClose(false)}`). Cada tecla → `setState` →
re-render → `onClose` nuevo → el efecto se re-ejecutaba → `ref.current.focus()`
devolvía el foco al `<div role="dialog">`.

**Arreglo:** el efecto se partió en tres. `onClose` vive en un ref para que el
listener de Escape no necesite re-suscribirse, y el foco inicial quedó en un efecto
que solo depende de `[open]`.

**Lección para el futuro:** una función definida en el JSX del padre no puede ser
dependencia de un efecto con efectos secundarios visibles. Afectaba a los modales de
accesos, empleados y vehículos también, no solo al de salas.

El smoke ahora escribe **letra por letra** y verifica que el campo conserva el foco
y que el texto llega completo. Antes escribía el valor de golpe, lo que ocultaba el
bug por completo. Verificado reintroduciendo el bug a propósito: las dos
comprobaciones fallan y el campo queda en `"P"`.

### 2026-08-11 — Empleados y Vehículos: los inactivos ya no se listan

Antes se mostraban sombreados (`data-baja`). Ahora **no aparecen**, y un chip junto
al contador los revela bajo demanda (arranca apagado).

- **Empleados:** inactivo = `estado` falso. La columna "Estado" solo se dibuja
  cuando el chip está encendido, porque con solo activos era una columna constante.
- **Vehículos:** `vehiculos` **no tiene estado propio**; un vehículo se considera
  inactivo cuando su **conductor** lo está (`empleado_activo`). El chip dice
  "N con conductor inactivo".

**Por qué un chip y no una ocultación total:** el botón **"Reactivar"** (RN-016,
`tipo_cambio` = `A`) solo existe en la fila de un empleado inactivo. Ocultarlos sin
más eliminaba la única vía para reactivar a alguien, que es una regla implementada.
Si en algún momento se decide quitar el chip, hay que mover esa acción a otro lugar
antes.

El smoke comprueba las dos vistas: que por defecto no hay ninguna fila `data-baja`,
que el chip revela filas adicionales y que al apagarlo se vuelven a ocultar.

### 2026-08-14 — La aplicación se conectó al schema `beta` (PRODUCCIÓN)

Jorge pidió analizar `beta` y conectar la web a él. **No es una copia idéntica de
`development`**: hay tres diferencias que rompían el código. Verificado con
`npm run comparar` y `npm run analizar` (ambos SOLO LECTURA).

| Diferencia | Efecto |
|---|---|
| `accesos` **no tiene columna de vigencia** en beta (no existe `"Status"`) | Un acceso que existe está vigente. La baja real se hace copiando la fila a `historico` y **borrándola** de `accesos`. |
| `actualizaciones.aprobado` **no existe** en beta | El desenlace se registra con `usuario_revision` (lleno en las 55 filas). |
| `solicitudes_salas.aprobado` **no existe** en beta | Igual. `fecha_revision` nunca se usa en producción. |
| `empleados.fecha_capacitacion` solo existe en beta | No se usa; inofensivo. |
| `tipo_vehiculos` tiene un tercer valor, "Moto" | Se lee del catálogo; sin cambios. |

Escala real de `beta`: **36 empresas** (Netflix, Apple, SC Johnson, IFC…),
**3 744 empleados**, **2 935 accesos**, 3 937 tarjetas con **1 110 libres**,
45 usuarios, 17 reservaciones (hasta 2026-10-21). **0 solicitudes pendientes.**

**Decisiones que tomó Jorge al respecto:**
1. **Lectura y escritura completa** sobre producción.
2. **Bajas y reactivaciones (tipo_cambio B y A): pendientes de decidir.** Están
   deshabilitadas en beta y devuelven un error explicativo con RN-016, porque
   implicarían borrar filas de `accesos`. **Esta decisión sigue abierta.**
3. **Desenlace con `usuario_revision` + `comentarios`**, sin inventar valores
   nuevos: al rechazar se antepone `"Rechazada:"` en `comentarios`, y
   `estadoSolicitud()` lo usa para distinguir rechazo de aprobación donde no
   existe `aprobado`.

**Cómo se implementó:** un módulo nuevo, **`server/capacidades.js`**, concentra
todas las diferencias entre schemas (`statusAcceso()`, `accesoVigente()`,
`columnaAprobado()`, `PERMITE_BAJA_ACCESO`, `entorno`). El resto del código no
tiene condicionales de schema sueltos. `/api/salud` expone `entorno` y la barra
superior muestra el schema activo con distintivo rojo si es producción.

**Salvaguardas añadidas:** `npm run prueba` (que crea y borra filas) **aborta** si
`PGSCHEMA` no es `development` **y además** si la API viva está apuntando a otro
schema — sin ese segundo control dejaría basura en producción, porque escribe vía
API pero limpia por conexión directa. `npm run integridad` solo aplica a
`development` (beta cambia sola: el chatbot escribe en ella).

**Para volver a development:** `PGSCHEMA=development` en `.env` y reiniciar la API.

### 2026-08-14 — Login real y aislamiento por empresa

**Se acabó el selector de empresa/perfil.** Ahora hay pantalla de acceso y cada
cuenta solo ve su empresa. Esto sustituye al modelo del prototipo (decisión 2 de
la sección 3, que queda superada).

**Lo que NO había en la base:** ni contraseñas, ni roles, ni un usuario llamado
"Office Manager". `usuarios` solo tiene datos de contacto porque el chatbot
identifica a la gente por su número de WhatsApp. Jorge decidió: **crear el
usuario**, **tabla de credenciales nueva**, y **superusuarios** aparte para
aprobar solicitudes de todos los inquilinos.

**Lo que se creó (en `development` y en `beta`):**

| Objeto | Detalle |
|---|---|
| Tabla `web_credenciales` | Propia de la web; **no toca ninguna tabla del chatbot**. Campos: `id_usuario` (nullable), `correo` único, `password_hash`, `es_superusuario`, `estado`, `creado_en`, `ultimo_acceso`. |
| Usuario `Office Manager` | En `usuarios`, empresa **HEXA** (id 7 en beta, id 2 en development). |
| Credencial `office.manager@hexa.com.mx` | Solo ve HEXA. |
| Credencial `admin@hexa.com.mx` | Superusuario: ve todas las empresas. |

Las contraseñas iniciales están en `scripts/migracion-login.mjs` (constantes
`OFFICE_MANAGER` y `SUPERUSUARIO`) y **este repositorio se versiona**, así que
hay que cambiarlas antes de exponer la web:
`npm run credencial <schema> clave <correo> <nueva>`.
Con `npm run credencial <schema> listar` se ven las cuentas y su último acceso.

**Cuidado con `usuarios`:** `id` es `IDENTITY ALWAYS` (nunca se inserta), y
`correo` y `telefono` son **UNIQUE**. El Office Manager lleva
`telefono = 'web-office-manager'` (no es un número) y `whatsapp = false`
**a propósito**, para no interferir con la identificación del chatbot.

**Cómo funciona el aislamiento (lo importante):**

- La sesión es un **token firmado con HMAC-SHA256** (`server/auth.js`), sin tabla
  de sesiones. Contraseñas con **scrypt** de `node:crypto`, sal por credencial.
- **La empresa viaja dentro del token firmado.** El servidor la impone y
  **descarta** cualquier `id_empresa` que mande el cliente. Cambiar un parámetro
  en el navegador no sirve de nada.
- Si una cuenta normal pide otra empresa, el servidor responde **403**, no le
  devuelve la suya en silencio: así el intento es visible.
- `/api/ocupacion/:fecha` sigue devolviendo **todas** las salas (hace falta para
  no chocar al reservar) pero **borra en el servidor** el evento, el solicitante
  y los invitados de los bloques ajenos. Antes ese recorte lo hacía el cliente,
  donde no protegía nada.
- `/api/administracion/solicitudes` exige superusuario.

**Superusuarios:** no pertenecen a ninguna empresa (`id_usuario` nulo). Como
`actualizaciones.id_usuario` es NOT NULL, cuando un superusuario registra algo
actúa a nombre del primer usuario activo de la empresa que está viendo
(`usuarioParaActuar` en `App.jsx`).

**Scripts nuevos:**

| Script | Para qué |
|---|---|
| `npm run migracion <schema> [--aplicar]` | Crea tabla y cuentas. **Idempotente** y sin `--aplicar` solo muestra el plan. |
| `npm run credencial <schema> listar\|clave\|crear\|baja` | Administra cuentas. Nunca imprime hashes. |
| `npm run login` | 27 comprobaciones de login y aislamiento. **No escribe nada.** |

`npm run smoke` ahora pasa por el login y **se adapta al perfil**: con
`SMOKE_USUARIO` y `SMOKE_CLAVE` se recorre la app como cualquier cuenta. Probado
con las dos: como Office Manager comprueba que no hay selector de empresa, no ve
la bandeja global ni botones de aprobar.

**Pendiente de seguridad:** el token va en `localStorage` y la API habla HTTP en
red local. Para exponerlo fuera hace falta HTTPS y conviene mover el token a una
cookie `HttpOnly`. Las contraseñas iniciales son públicas en este documento:
**cámbialas con `npm run credencial` antes de dar acceso a nadie.**
