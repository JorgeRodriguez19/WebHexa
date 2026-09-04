import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Building2,
  CalendarDays,
  Car,
  CreditCard,
  Inbox,
  Users,
  AlertTriangle,
  RefreshCw,
  LogOut,
} from "lucide-react";

import { api, cuandoExpireLaSesion, ErrorApi, sesion as almacen } from "./lib/api.js";
import Login from "./vistas/Login.jsx";
import { Btn, Cargando, Eyebrow } from "./lib/ui.jsx";
import { isoLocal, norm, solapa, TIPO_ACCESO } from "../shared/reglas.js";

import Resumen from "./vistas/Resumen.jsx";
import Salas from "./vistas/Salas.jsx";
import Accesos from "./vistas/Accesos.jsx";
import Empleados from "./vistas/Empleados.jsx";
import Vehiculos from "./vistas/Vehiculos.jsx";
import Solicitudes from "./vistas/Solicitudes.jsx";

export default function App() {
  /* ---------- catálogos (una sola vez) ---------- */
  const [catalogos, setCatalogos] = useState(null);
  const [errorArranque, setErrorArranque] = useState(null);
  /* Contador para volver a pedir los catálogos sin recargar la página. */
  const [reintento, setReintento] = useState(0);
  /* Schema al que está conectada la API: `beta` es PRODUCCIÓN y se advierte. */
  const [entorno, setEntorno] = useState(null);

  /* ---------- sesión ---------- */
  /*
   * El perfil llega del servidor al iniciar sesión y manda sobre todo lo demás:
   * la empresa NO se elige, se hereda de la cuenta. Un superusuario es la única
   * excepción: puede cambiar de empresa porque revisa las de todos.
   */
  const [perfil, setPerfil] = useState(() => almacen.leer()?.perfil ?? null);
  const [empresaId, setEmpresaId] = useState(() => almacen.leer()?.perfil?.id_empresa ?? null);

  const esAdmin = !!perfil?.superusuario;
  const usuarioId = perfil?.id_usuario ?? null;

  /* ---------- datos del panel ---------- */
  const [panel, setPanel] = useState(null);
  const [reservaciones, setReservaciones] = useState([]);
  const [admin, setAdmin] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [vista, setVista] = useState("resumen");
  const [avisos, setAvisos] = useState([]);

  const avisar = useCallback((rn, msg, tone = "block") => {
    setAvisos((prev) => [
      ...prev.slice(-4),
      { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, rn, msg, tone },
    ]);
  }, []);

  /** Traduce un error de la API a un aviso, conservando el RN-### si viene. */
  const avisarError = useCallback(
    (e, rnPorDefecto = null) => {
      const rn = e instanceof ErrorApi ? e.rn || rnPorDefecto : rnPorDefecto;
      avisar(rn || "Error", e.message, "block");
    },
    [avisar]
  );

  useEffect(() => {
    if (!avisos.length) return;
    const t = setTimeout(() => setAvisos((prev) => prev.slice(1)), 6000);
    return () => clearTimeout(t);
  }, [avisos]);

  /* ---------- salir ---------- */
  const salir = useCallback(() => {
    almacen.borrar();
    setPerfil(null);
    setCatalogos(null);
    setPanel(null);
    setAdmin(null);
    setEmpresaId(null);
    setErrorArranque(null);
    setVista("resumen");
  }, []);

  /* Si el servidor rechaza el token (expiró o se revocó), vuelve al login. */
  useEffect(() => {
    cuandoExpireLaSesion(() => salir());
  }, [salir]);

  const entrar = useCallback((p) => {
    setPerfil(p);
    setEmpresaId(p.id_empresa ?? null);
  }, []);

  /* El entorno se consulta siempre: la pantalla de login avisa si es producción. */
  useEffect(() => {
    api
      .salud()
      .then((s) => setEntorno(s.entorno ?? null))
      .catch(() => setEntorno(null));
  }, []);

  /* ---------- carga inicial (solo con sesión) ---------- *
   * Se reintenta antes de rendirse. La primera petición tras iniciar sesión
   * abre conexiones nuevas contra RDS y puede agotar el tiempo de espera; el
   * síntoma era un error de API justo al entrar que se arreglaba recargando
   * la página, porque al recargar el pool ya estaba caliente.
   *
   * Las dependencias son `perfil` y `reintento`, NO `empresaId`: al fijar la
   * empresa del superusuario aquí mismo, tenerla en las dependencias volvía a
   * pedir los catálogos una segunda vez sin necesidad.
   */
  useEffect(() => {
    if (!perfil) return;
    let vivo = true;
    let temporizador = null;

    const intentar = async (restantes) => {
      try {
        const c = await api.catalogos();
        if (!vivo) return;
        setCatalogos(c);
        setErrorArranque(null);
        // Un superusuario no tiene empresa propia: se abre en la que tenga más
        // personal para que la vista no arranque vacía.
        if (perfil.superusuario) {
          const conDatos = [...c.empresas]
            .filter((e) => e.usuarios > 0)
            .sort((a, b) => b.empleados - a.empleados);
          const elegida = (conDatos[0] ?? c.empresas[0])?.id ?? null;
          setEmpresaId((actual) => actual ?? elegida);
        }
      } catch (e) {
        if (!vivo) return;
        /* Un 401/403 no se reintenta: no es un tropiezo de red, es la sesión. */
        const transitorio = e.status !== 401 && e.status !== 403;
        if (restantes > 0 && transitorio) {
          temporizador = setTimeout(() => intentar(restantes - 1), 1200);
          return;
        }
        setErrorArranque(e.message);
      }
    };

    intentar(2);
    return () => {
      vivo = false;
      if (temporizador) clearTimeout(temporizador);
    };
  }, [perfil, reintento]);

  const recargar = useCallback(async () => {
    if (empresaId == null) return;
    setCargando(true);
    try {
      const [p, r] = await Promise.all([api.panel(empresaId), api.reservaciones(isoLocal())]);
      setPanel(p);
      setReservaciones(r);
      if (esAdmin) setAdmin(await api.solicitudesAdmin());
    } catch (e) {
      avisarError(e);
    } finally {
      setCargando(false);
    }
  }, [empresaId, esAdmin, avisarError]);

  useEffect(() => {
    recargar();
  }, [recargar]);

  /* ---------- derivados ---------- */
  const empresa = panel?.empresa ?? null;
  /* El usuario de la sesión; si la cuenta es de superusuario no hay ninguno. */
  const usuario = useMemo(
    () =>
      catalogos?.usuarios.find((u) => u.id === usuarioId) ??
      (perfil ? { id: usuarioId, nombre_completo: perfil.nombre } : null),
    [catalogos, usuarioId, perfil]
  );

  const empleados = panel?.empleados ?? [];
  const accesos = panel?.accesos ?? [];
  const vehiculos = panel?.vehiculos ?? [];
  const misSolicitudesAcc = panel?.actualizaciones ?? [];
  const misSolicitudesSalas = panel?.solicitudes_salas ?? [];
  const salas = catalogos?.salas ?? [];

  const empleadoDe = useCallback((id) => empleados.find((e) => e.id === id), [empleados]);
  const salaDe = useCallback((id) => salas.find((s) => s.id === id), [salas]);

  /* RN-011 / RN-012 · cupos calculados por el servidor. */
  const cupo = useCallback(
    (idTipo) => {
      const fila = (panel?.cupos ?? []).find((c) => c.id_tipo === idTipo);
      const limite =
        idTipo === TIPO_ACCESO.VIP
          ? Number(empresa?.num_vip ?? 0)
          : idTipo === TIPO_ACCESO.VEHICULAR
            ? Number(empresa?.num_vehiculares ?? 0)
            : Infinity;
      const asignados = fila?.asignados ?? 0;
      const pendientes = fila?.pendientes ?? 0;
      return {
        asignados,
        pendientes,
        total: limite,
        disponible: limite - asignados - pendientes,
        consumeCupo: idTipo !== TIPO_ACCESO.PEATONAL,
      };
    },
    [panel, empresa]
  );

  const pendientesTotal = esAdmin
    ? (admin?.actualizaciones ?? []).filter((s) => s.estado_revision === "P").length +
      (admin?.solicitudes_salas ?? []).filter((s) => s.estado === "P").length
    : misSolicitudesAcc.filter((s) => s.estado_revision === "P").length +
      misSolicitudesSalas.filter((s) => s.estado === "P").length;

  /* ---------- acciones ---------- */

  /*
   * Un superusuario no pertenece a ninguna empresa, así que al registrar algo
   * tiene que declarar sobre qué empresa y a nombre de qué usuario actúa. Para
   * una cuenta normal estos campos no se mandan: el servidor los toma de la
   * sesión firmada y descarta lo que venga del cliente.
   */
  const usuarioParaActuar = useMemo(() => {
    if (!esAdmin) return usuarioId;
    const suyos = (catalogos?.usuarios ?? []).filter((u) => u.id_empresa === empresaId);
    return (suyos.find((u) => u.estado) ?? suyos[0])?.id ?? null;
  }, [esAdmin, catalogos, empresaId, usuarioId]);

  const contexto = esAdmin ? { id_empresa: empresaId, id_usuario: usuarioParaActuar } : {};

  const ejecutar = useCallback(
    async (fn, exito) => {
      try {
        const r = await fn();
        await recargar();
        if (exito) {
          const msg = exito(r);
          if (msg) avisar(msg.rn, msg.texto, "ok");
        }
        return r;
      } catch (e) {
        avisarError(e);
        return null;
      }
    },
    [recargar, avisar, avisarError]
  );

  const acciones = {
    crearSolicitudAcceso: (cuerpo) =>
      ejecutar(
        () => api.crearSolicitudAcceso({ ...cuerpo, ...contexto }),
        (r) => ({
          rn: "RN-013",
          texto: `Solicitud ${r.folio} registrada en estado Pendiente. Queda a revisión de administración.`,
        })
      ),

    crearSolicitudSala: (cuerpo) =>
      ejecutar(
        () => api.crearSolicitudSala({ ...cuerpo, ...contexto }),
        (r) => ({
          rn: "RN-023",
          texto: `Solicitud ${r.folio} de ${r.sala} registrada en estado Pendiente. Administración la revisará.`,
        })
      ),

    crearEmpleado: (cuerpo) =>
      ejecutar(
        () => api.crearEmpleado({ ...cuerpo, ...contexto }),
        (r) => ({ rn: "RN-015", texto: `${r.nombre_completo} quedó registrado en la empresa.` })
      ),

    crearVehiculo: (cuerpo) =>
      ejecutar(
        () => api.crearVehiculo({ ...cuerpo, ...contexto }),
        (r) => ({ rn: "RN-005", texto: `Vehículo ${r.placas} registrado a nombre de ${r.empleado}.` })
      ),

    resolverAcceso: (id, aprobar) =>
      ejecutar(
        () =>
          api.resolverAcceso(id, {
            aprobar,
            usuario_revision: perfil?.nombre,
          }),
        (r) => ({
          rn: "RN-013",
          texto: aprobar
            ? `Solicitud aprobada · ${r.aplicado}${r.num_tarjeta ? ` (tarjeta ${r.num_tarjeta})` : ""}.`
            : "Solicitud rechazada.",
        })
      ),

    resolverSala: (id, aprobar) =>
      ejecutar(
        () =>
          api.resolverSala(id, {
            aprobar,
            usuario_revision: perfil?.nombre,
          }),
        () => ({
          rn: "RN-023",
          texto: aprobar ? "Reservación aprobada y creada en el calendario." : "Solicitud rechazada.",
        })
      ),

    cancelarSolicitudAcceso: (id) =>
      ejecutar(
        () => api.cancelarAcceso(id, { ...contexto }),
        () => ({ rn: "RN-013", texto: "Solicitud retirada." })
      ),

    cancelarSolicitudSala: (id) =>
      ejecutar(
        () => api.cancelarSala(id, { ...contexto }),
        () => ({ rn: "RN-023", texto: "Solicitud retirada." })
      ),
  };

  /* ---------- ocupación de salas (RN-021) ---------- */

  /**
   * Bloques que se pintan en la franja de una sala en una fecha:
   * reservaciones aprobadas + solicitudes pendientes, de cualquier empresa.
   * Los ajenos se muestran sin revelar el evento (RN-005).
   */
  const bloquesDe = useCallback(
    (ocupacion, idSala) =>
      (ocupacion ?? [])
        .filter((o) => o.id_sala === idSala)
        .map((o) => ({
          ini: o.hora_inicio,
          fin: o.hora_fin,
          label: o.id_empresa === empresaId ? o.tipo_evento : "Otro inquilino",
          tono: o.origen === "pendiente" ? "pendiente" : o.id_empresa === empresaId ? "propia" : "ajena",
        })),
    [empresaId]
  );

  const salaLibreEn = useCallback(
    (ocupacion, idSala, ini, fin) =>
      !(ocupacion ?? []).some(
        (o) => o.id_sala === idSala && solapa(ini, fin, o.hora_inicio, o.hora_fin)
      ),
    []
  );

  const ctx = {
    catalogos,
    hoy: panel?.hoy ?? catalogos?.hoy ?? isoLocal(),
    empresa,
    empresaId,
    usuario,
    /*
     * Usuario efectivo para registrar movimientos. Las vistas lo usan para
     * habilitar los botones de alta; un superusuario no tiene usuario propio,
     * así que actúa a nombre de uno de la empresa que está viendo.
     */
    usuarioId: usuarioParaActuar,
    perfil,
    esAdmin,
    salas,
    empleados,
    accesos,
    vehiculos,
    reservaciones,
    misSolicitudesAcc,
    misSolicitudesSalas,
    admin,
    tarjetasLibres: panel?.tarjetas_libres ?? 0,
    empleadoDe,
    salaDe,
    cupo,
    avisar,
    avisarError,
    bloquesDe,
    salaLibreEn,
    acciones,
    setVista,
    recargar,
    norm,
  };

  /* ---------- arranque ---------- */

  /* Sin sesión no se monta nada del panel: la puerta es el login. */
  if (!perfil) return <Login onEntrar={entrar} entorno={entorno} />;

  if (errorArranque)
    return (
      <div className="hx-arranque">
        <div className="hx-arranque-caja">
          <div className="flex items-center gap-2" style={{ color: "#a8443a" }}>
            <AlertTriangle size={18} />
            <strong>No se pudo iniciar el panel</strong>
          </div>
          <p className="hx-hint mt-3" style={{ fontSize: 12.5 }}>
            {errorArranque}
          </p>
          {/* Antes la única salida era recargar la página a mano. */}
          <div className="flex gap-2 mt-4">
            <Btn
              variant="primary"
              onClick={() => {
                setErrorArranque(null);
                setReintento((n) => n + 1);
              }}
            >
              <RefreshCw size={14} /> Reintentar
            </Btn>
            <Btn onClick={salir}>
              <LogOut size={14} /> Salir
            </Btn>
          </div>
          {import.meta.env.DEV && (
            <div className="hx-nota mt-4">
              <span>
                Si la API no responde, levántala con <code className="mono">npm run server</code>.
                Debe contestar en <code className="mono">http://localhost:4000/api/salud</code>.
              </span>
            </div>
          )}
        </div>
      </div>
    );

  if (!catalogos)
    return (
      <div className="hx-arranque">
        <div className="hx-arranque-caja">
          <Cargando texto="Conectando con la base de datos…" />
        </div>
      </div>
    );

  const NAV = [
    { id: "resumen", label: "Resumen", icon: Building2 },
    { id: "salas", label: "Salas", icon: CalendarDays },
    { id: "accesos", label: "Accesos", icon: CreditCard },
    { id: "empleados", label: "Empleados", icon: Users },
    { id: "vehiculos", label: "Vehículos", icon: Car },
    { id: "solicitudes", label: "Solicitudes", icon: Inbox, badge: pendientesTotal },
  ];

  return (
    <div className="hx-root">
      <header className="hx-top">
        <div className="flex items-center gap-3 min-w-0">
          <div className="hx-mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <div className="hx-brand">HEXA</div>
              {entorno && (
                <span
                  className="hx-entorno mono"
                  data-prod={entorno.produccion}
                  title={
                    entorno.produccion
                      ? "Base real compartida con el chatbot: los cambios afectan producción."
                      : `Entorno ${entorno.etiqueta}: los cambios no llegan al chatbot.`
                  }
                >
                  {entorno.produccion ? entorno.schema : entorno.etiqueta}
                </span>
              )}
            </div>
            <div className="hx-brand-sub">Torre Reforma · Panel de operación</div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap justify-end">
          {/* La empresa solo se elige si la cuenta es de superusuario; una
              cuenta normal la hereda de su sesión y no puede cambiarla. */}
          {esAdmin && (
            <div className="hx-select-wrap">
              <span className="hx-select-tag mono">Empresa</span>
              <select
                className="hx-select"
                value={empresaId ?? ""}
                onChange={(e) => setEmpresaId(Number(e.target.value))}
              >
                {catalogos.empresas.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.nombre}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="hx-sesion">
            <div className="hx-sesion-nombre">{perfil.nombre}</div>
            <div className="hx-sesion-sub mono">
              {esAdmin ? "Superusuario · todas las empresas" : (perfil.empresa ?? empresa?.nombre ?? "")}
            </div>
          </div>

          <Btn onClick={recargar} title="Volver a consultar la base">
            <RefreshCw size={14} className={cargando ? "hx-girando" : ""} />
          </Btn>
          <Btn onClick={salir} title="Cerrar sesión">
            <LogOut size={14} />
          </Btn>
        </div>
      </header>

      <div className="hx-body">
        <nav className="hx-rail" aria-label="Secciones">
          {NAV.map((n) => {
            const Icon = n.icon;
            return (
              <button
                key={n.id}
                onClick={() => setVista(n.id)}
                className="hx-rail-item"
                data-active={vista === n.id}
              >
                <Icon size={17} strokeWidth={1.9} />
                <span>{n.label}</span>
                {n.badge ? <span className="hx-rail-badge mono">{n.badge}</span> : null}
              </button>
            );
          })}
          <div className="hx-rail-foot">
            <Eyebrow>Contrato</Eyebrow>
            <div className="mono text-xs mt-1">{empresa?.num_contrato ?? "—"}</div>
            <div className="hx-hint mt-2">
              {empresa ? `${empresa.num_vip} VIP · ${empresa.num_vehiculares} vehiculares` : ""}
            </div>
          </div>
        </nav>

        <main className="hx-main">
          {!panel ? (
            <Cargando />
          ) : !usuarioId && !esAdmin ? (
            <SinUsuarios empresa={empresa} />
          ) : (
            <>
              {vista === "resumen" && <Resumen ctx={ctx} />}
              {vista === "salas" && <Salas ctx={ctx} />}
              {vista === "accesos" && <Accesos ctx={ctx} />}
              {vista === "empleados" && <Empleados ctx={ctx} />}
              {vista === "vehiculos" && <Vehiculos ctx={ctx} />}
              {vista === "solicitudes" && <Solicitudes ctx={ctx} />}
            </>
          )}
        </main>
      </div>

      <div className="hx-avisos">
        {avisos.map((a) => (
          <div key={a.id} className="hx-aviso" data-tone={a.tone}>
            <span className="hx-aviso-rn mono">{a.rn}</span>
            <span className="hx-aviso-msg">{a.msg}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Varias empresas del schema `development` no tienen ningún usuario, y
 * `actualizaciones.id_usuario` / `solicitudes_salas.id_usuario` son NOT NULL:
 * sin solicitante no se puede registrar nada a nombre de esa empresa.
 */
function SinUsuarios({ empresa }) {
  return (
    <div className="flex flex-col gap-5">
      <h1 className="hx-h1">{empresa?.nombre}</h1>
      <div className="hx-nota" data-tone="warn">
        <AlertTriangle size={15} />
        <span>
          Esta empresa no tiene usuarios registrados en <code className="mono">usuarios</code>, y toda
          solicitud debe ir firmada por uno. Puedes consultar sus datos cambiando de empresa, pero no
          registrar movimientos hasta que se dé de alta un contacto.
        </span>
      </div>
    </div>
  );
}
