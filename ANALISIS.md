# Análisis de los archivos fuente y decisiones tomadas

Documento de trazabilidad: de dónde salió cada decisión de la aplicación y cómo se
resolvieron las contradicciones entre los cuatro archivos de partida.

Orden de prioridad acordado:
**1)** `Chatbot Hexa BETA - Whatsapp Meta.json` (lógica real) ·
**2)** `Documentacion_Chatbot_Hexa_BETA_WhatsApp.md` (requerimientos) ·
**3)** `panel-hexa-accesos-salas.jsx` (diseño visual) ·
**4)** `Base de datos.txt` (conexión).

A esa lista se añadió una quinta fuente que resultó decisiva: **el schema
`development` real**, inspeccionado directamente. Cuando el `.json` y la base
discrepan, manda la base: es contra ella que la aplicación tiene que funcionar.

---

## 1. Qué es el sistema

Un chatbot de WhatsApp multi-agente (supervisor "Helios" + `Access_Agent`,
`Documents_Agent`, `Salas_Agent`) que atiende a los inquilinos de Torre Reforma
en tres dominios: **accesos y estacionamiento**, **documentación interna** y
**reservación de salas**. Todo cambio que solicita un inquilino se guarda como
**solicitud pendiente** (`'P'`) y espera aprobación de la administración.

Esta aplicación web cubre el primero y el tercer dominio —los que el prototipo
dibuja— con las mismas reglas y sobre las mismas tablas.

---

## 2. Contradicciones encontradas y cómo se resolvieron

### 2.1. El prototipo inventa columnas que no existen

El `.jsx` fue escrito desde el `.md`, no desde la base, y modela datos que no
están:

| Prototipo | Realidad en `development` | Resolución |
|---|---|---|
| `empleados.puesto`, `empleados.correo` | No existen | Se eliminaron de la UI. En su lugar se muestra `capacitacion`, que sí existe y es operativamente relevante. |
| `accesos.estado` | La columna es `"Status"` | Se usa `"Status"`, entrecomillada, expuesta como `status`. |
| `vehiculos.cajon`, `vehiculos.modelo`, `vehiculos.id_empresa` | No existen; el modelo es `submarca` | Se quitó el cajón (lo asigna administración fuera del sistema); el alcance por empresa se deriva del empleado conductor. |
| `reservaciones.motivo`, `.fecha`, `.id_empresa` | Son `tipo_evento`, `fecha_reservacion`, y la empresa se deriva de `id_usuario` | Se renombró y se hizo el JOIN. |
| `empresas.piso` | No existe | Se sustituyó por los cupos del contrato en el pie del riel de navegación. |
| Solicitudes de tipo `E` (empleado) y `V` (vehículo) | El flujo n8n **inserta empleados y vehículos directamente**, sin revisión | Se siguió el `.json`: alta inmediata. |

### 2.2. El prototipo asume salas que no son las reales

El `.jsx` trae "Sala Ágora", "Terraza Reforma" y precios de 420–3800 MXN. Las
salas reales son `Sala 1`…`Sala 5`, `Sala de consejo`, `Auditorio` y `Terraza`,
con capacidades 6/8/12/12/12/22/96/150 y precios 25–1000 **en dólares** (así los
presenta el prompt del `Salas_Agent`).

Dos consecuencias de diseño:

- **La franja horaria se extendió de 07:00–20:00 a 08:00–24:00**, porque la
  Terraza opera de 18:00 a 24:00 y en la escala original no cabía. Se añadió un
  sombreado diagonal para el horario en que cada sala está cerrada.
- **La selección de sala ya no es por igualdad de capacidad.** El prototipo hacía
  `capacidad === banda`, que con una sala de capacidad 6 dejaría fuera opciones
  válidas. Se implementó la condición real del nodo `Postgre_find_sala`:
  `capacidad >= invitados AND capacidad <= banda`, ordenando por menor excedente.

### 2.3. Los prompts del n8n contradicen su propio DDL

Los prompts escriben `Estado-revision` (con guion), `Num_VIP`, `Tipo_cambio` en
Title Case y una tabla `beta.tipo_acceso` en singular; el DDL real usa
`estado_revision`, `num_vip`, `tipo_cambio` y `tipo_accesos`. Además los ejemplos
de la sección "Nombre de columnas" apuntan al schema `development` cuando el
chatbot corre sobre `beta`.

**Resolución:** se ignoró la nomenclatura de los prompts y se usaron los nombres
reales verificados por introspección. Son errores del prompt, no del modelo de datos.

### 2.4. Estados de solicitud: `'A'`/`'R'` del prototipo vs. `'P'`/`'F'` de la base

El prototipo usa `P`/`A`/`R`/`C`. El flujo n8n solo escribe `'P'`. La base, en sus
281 filas históricas, solo contiene `'P'` y `'F'`, y tiene una columna `aprobado`
(boolean, nullable) que **nunca se llenó**.

**Resolución:** se conservó la convención de la base (`P`/`F`) y se usó `aprobado`
para registrar el desenlace, que es justo para lo que la columna existe. Las filas
históricas (`'F'` + `aprobado` nulo) se muestran como "Finalizada" en lugar de
inventarles un resultado. La cancelación por el solicitante usa `'C'`, valor nuevo
pero compatible con `varchar(1)` y distinguible de un rechazo.

### 2.5. `unaccent` no está instalada

La RN-027 pide `LOWER(unaccent(...))`, pero la única extensión instalada es
`plpgsql`. Cualquier consulta con `unaccent` fallaría.

**Resolución:** la normalización se hace con `translate()` en SQL (`NORM()` en
`server/sql.js`) y con `normalize("NFD")` en JS (`norm()` en `shared/reglas.js`).
Sin extensiones, mismo comportamiento.

### 2.6. Dos huecos del flujo n8n que se corrigieron

La propia documentación los señala como riesgos. Se corrigieron porque una web
con estado visible no puede permitírselos:

1. **Cupo sobre-reservable.** El chatbot valida el cupo contra `accesos`
   (asignados) e ignora las solicitudes `'P'`. Con el contrato al límite, varias
   solicitudes simultáneas lo rebasan. Aquí el cupo suma **asignados + pendientes**,
   y el medidor muestra los pendientes en un tono más claro.
2. **Doble reserva del mismo horario.** `Postgre_find_sala` solo excluye choques
   contra `reservaciones` (aprobadas), no contra `solicitudes_salas` pendientes.
   Aquí se excluyen ambas.

### 2.7. Lo que el n8n hace y la web no puede hacer igual

El chatbot deja la solicitud en `'P'` y ahí termina: **el cierre del ciclo lo hace
la administración por fuera**. El prototipo, en cambio, aplica el efecto al
aprobar. Se siguió el prototipo, con una salvedad de la base real:

`accesos.num_tarjeta` es NOT NULL y FK a `tarjetas`, así que **aprobar una tarjeta
nueva exige tomar un plástico libre del inventario**. Hoy solo hay 6 libres. La
aplicación toma uno, lo marca de la empresa, y si no hay ninguno **rechaza la
aprobación con un mensaje explícito** en vez de fallar con un error de FK. La
bandeja de administración avisa cuando el inventario llega a cero.

No se escribe en `historico`: quedó fuera del alcance acordado.

---

## 3. Qué se conservó del prototipo

El diseño visual se mantuvo íntegro: paleta (`--ink`, `--brass`, `--mist`,
`--signal`, `--alert`), tipografías Archivo + IBM Plex Mono, el riel de navegación
lateral, las tarjetas de borde fino sin sombra, los badges monoespaciados en
versalitas, el medidor de cupo segmentado, la franja horaria, el asistente de
reservación en tres pasos y los avisos inferiores con el identificador `RN-###`.

Tres añadidos, todos por necesidad funcional:

- **Selector de solicitante** en la barra superior: `actualizaciones.id_usuario` y
  `solicitudes_salas.id_usuario` son NOT NULL y varias empresas tienen más de un
  usuario, así que hay que elegir a nombre de quién va la solicitud.
- **Horario y "acceso robótico"** en el modal de tarjeta nueva:
  `accesos.id_horario` e `accesos.robotico` son NOT NULL, y el
  `Flujo_Solicitud_Tarjeta` los pide explícitamente en su paso 1.
- **Servicios adicionales** en el paso 3 del asistente: es el paso 5 del
  `Flujo_Reservacion_Sala` y la columna `solicitudes_salas.servicios` ya existe,
  con datos reales guardados por el chatbot.

El medidor de cupo se degrada a barra continua por encima de 24 lugares: Devol
tiene 30 accesos VIP contratados y 30 segmentos individuales no caben en la tarjeta.
