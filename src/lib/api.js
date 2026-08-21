/* ------------------------------------------------------------------ *
 *  Cliente de la API. Vite proxea /api al servidor Express en :4000.
 *  Los errores de regla llegan como { error, rn } y se propagan tal cual
 *  para que las vistas los muestren con su identificador RN-###.
 * ------------------------------------------------------------------ */

export class ErrorApi extends Error {
  constructor(mensaje, rn, status) {
    super(mensaje);
    this.rn = rn;
    this.status = status;
  }
}

/* ------------------------------------------------------------------ *
 *  Sesión
 *  El token se guarda en localStorage y viaja en cada petición. La empresa
 *  NO se manda: va firmada dentro del token y el servidor la impone.
 * ------------------------------------------------------------------ */
const CLAVE = "hexa.sesion";

export const sesion = {
  leer() {
    try {
      const s = JSON.parse(localStorage.getItem(CLAVE) || "null");
      return s?.token ? s : null;
    } catch {
      return null;
    }
  },
  guardar(token, perfil) {
    localStorage.setItem(CLAVE, JSON.stringify({ token, perfil }));
  },
  borrar() {
    localStorage.removeItem(CLAVE);
  },
  token() {
    return this.leer()?.token ?? null;
  },
};

/** Se avisa a la app cuando el servidor rechaza la sesión, para volver al login. */
let alExpirar = () => {};
export const cuandoExpireLaSesion = (fn) => {
  alExpirar = fn;
};

async function pedir(ruta, opciones = {}) {
  const token = sesion.token();
  let res;
  try {
    res = await fetch(`/api${ruta}`, {
      headers: {
        ...(opciones.body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...opciones,
      body: opciones.body ? JSON.stringify(opciones.body) : undefined,
    });
  } catch {
    throw new ErrorApi(
      "No hay conexión con la API. Verifica que el servidor esté corriendo (npm run server).",
      null,
      0
    );
  }

  const texto = await res.text();
  const datos = texto ? JSON.parse(texto) : null;

  if (res.status === 401 && !ruta.startsWith("/auth/login")) {
    sesion.borrar();
    alExpirar();
  }

  if (!res.ok) throw new ErrorApi(datos?.error || `Error ${res.status}`, datos?.rn ?? null, res.status);
  return datos;
}

const qs = (o) =>
  Object.entries(o)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&");

export const api = {
  salud: () => pedir("/salud"),
  login: (correo, password) => pedir("/auth/login", { method: "POST", body: { correo, password } }),
  yo: () => pedir("/auth/yo"),
  catalogos: () => pedir("/catalogos"),
  panel: (idEmpresa) => pedir(`/empresa/${idEmpresa}/panel`),
  reservaciones: (desde) => pedir(`/reservaciones?${qs({ desde })}`),
  ocupacion: (fecha) => pedir(`/ocupacion/${fecha}`),
  solicitudesAdmin: () => pedir("/administracion/solicitudes"),

  salasDisponibles: (p) => pedir(`/salas/disponibles?${qs(p)}`),

  crearSolicitudAcceso: (body) => pedir("/solicitudes/acceso", { method: "POST", body }),
  resolverAcceso: (id, body) =>
    pedir(`/solicitudes/acceso/${id}/resolver`, { method: "PATCH", body }),
  cancelarAcceso: (id, body) =>
    pedir(`/solicitudes/acceso/${id}/cancelar`, { method: "PATCH", body }),

  crearSolicitudSala: (body) => pedir("/solicitudes/sala", { method: "POST", body }),
  resolverSala: (id, body) => pedir(`/solicitudes/sala/${id}/resolver`, { method: "PATCH", body }),
  cancelarSala: (id, body) => pedir(`/solicitudes/sala/${id}/cancelar`, { method: "PATCH", body }),

  crearEmpleado: (body) => pedir("/empleados", { method: "POST", body }),
  crearVehiculo: (body) => pedir("/vehiculos", { method: "POST", body }),
};
