import React, { useMemo, useState } from "react";
import { ArrowRight, ChevronRight, Clock } from "lucide-react";

import { Badge, Btn, Card, Cargando, Eyebrow, Franja, Gauge, Metrica, Vacio } from "../lib/ui.jsx";
import { useOcupacion } from "../lib/useOcupacion.js";
import { diaDe, fechaLarga, hhmm, mesDe } from "../lib/fmt.js";
import { TIPO_ACCESO, esDiaHabil } from "../../shared/reglas.js";

export default function Resumen({ ctx }) {
  const {
    hoy,
    empresa,
    usuario,
    empresaId,
    salas,
    reservaciones,
    empleados,
    accesos,
    vehiculos,
    cupo,
    bloquesDe,
    setVista,
    misSolicitudesAcc,
    misSolicitudesSalas,
  } = ctx;

  const [dia, setDia] = useState(hoy);
  const { ocupacion, cargando } = useOcupacion(dia);

  const vip = cupo(TIPO_ACCESO.VIP);
  const veh = cupo(TIPO_ACCESO.VEHICULAR);

  const proximas = reservaciones
    .filter((r) => r.id_empresa === empresaId && r.fecha_reservacion >= hoy)
    .slice(0, 4);

  const pendientes =
    misSolicitudesAcc.filter((s) => s.estado_revision === "P").length +
    misSolicitudesSalas.filter((s) => s.estado === "P").length;

  /**
   * La franja solo muestra las salas con actividad ese día: reservación aprobada
   * o solicitud pendiente. Si ninguna la tiene, la tarjeta entera no se dibuja.
   */
  const salasConActividad = useMemo(
    () =>
      salas
        .map((s) => ({ sala: s, bloques: bloquesDe(ocupacion, s.id) }))
        .filter((x) => x.bloques.length > 0),
    [salas, ocupacion, bloquesDe]
  );

  const hayFranja = cargando || salasConActividad.length > 0;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <Eyebrow>
            {usuario?.nombre_completo ?? "Sin solicitante"} · {empresa?.nombre}
          </Eyebrow>
          <h1 className="hx-h1 mt-1">Hoy en la torre</h1>
        </div>
        <input
          type="date"
          className="hx-input hx-input-sm mono"
          value={dia}
          onChange={(e) => e.target.value && setDia(e.target.value)}
          aria-label="Elegir día"
        />
      </div>

      {/* franja del día: solo las salas con actividad; si no hay ninguna, no se dibuja */}
      {hayFranja && (
        <Card>
          <div className="flex items-center justify-between gap-3 flex-wrap px-5 pt-4">
            <div className="flex items-baseline gap-3">
              <h2 className="hx-h2">{fechaLarga(dia)}</h2>
              {!esDiaHabil(dia) && <Badge tone="warn">Día inhábil</Badge>}
            </div>
            {!cargando && (
              <span className="mono hx-hint">
                {salasConActividad.length}{" "}
                {salasConActividad.length === 1 ? "sala con actividad" : "salas con actividad"}
              </span>
            )}
          </div>

          {cargando ? (
            <Cargando texto="Consultando ocupación…" />
          ) : (
            <>
              <div className="px-5 py-4 flex flex-col gap-3">
                {salasConActividad.map(({ sala, bloques }) => (
                  <div key={sala.id} className="hx-sala-row">
                    <div className="hx-sala-id">
                      <span className="hx-sala-nom">{sala.nombre}</span>
                      <span className="mono hx-sala-meta">
                        {sala.capacidad} pax · piso {sala.piso} · {hhmm(sala.horario_apertura)}–
                        {hhmm(sala.horario_cierre)}
                      </span>
                    </div>
                    <Franja bloques={bloques} sala={sala} />
                  </div>
                ))}
              </div>

              <div className="hx-leyenda px-5 pb-4 mono">
                <span>
                  <i className="hx-dot" data-tono="propia" /> Mi empresa
                </span>
                <span>
                  <i className="hx-dot" data-tono="ajena" /> Otro inquilino
                </span>
                <span>
                  <i className="hx-dot" data-tono="pendiente" /> Solicitud pendiente
                </span>
                <span>
                  <i className="hx-dot" data-tono="cerrado" /> Fuera de horario
                </span>
              </div>
            </>
          )}
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="px-5 pt-4 pb-2 flex items-center justify-between">
            <h2 className="hx-h2">Próximas reservaciones</h2>
            <Btn onClick={() => setVista("salas")}>
              Ver salas <ChevronRight size={14} />
            </Btn>
          </div>
          {proximas.length === 0 ? (
            <Vacio texto="Sin reservaciones futuras. Reserva una sala desde la sección Salas." />
          ) : (
            <ul className="px-5 pb-4 flex flex-col hx-divide">
              {proximas.map((r) => (
                <li key={r.id} className="flex items-center gap-4 py-3">
                  <div className="hx-fecha-chip mono">
                    <span>{diaDe(r.fecha_reservacion)}</span>
                    <span>{mesDe(r.fecha_reservacion)}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="hx-strong truncate">{r.tipo_evento}</div>
                    <div className="hx-hint mono">
                      {r.sala} · {hhmm(r.hora_inicio)}–{hhmm(r.hora_fin)} · {r.num_invitados}{" "}
                      invitados
                    </div>
                  </div>
                  <Badge tone="ok">Confirmada</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <div className="px-5 pt-4">
            <h2 className="hx-h2">Cupos del contrato</h2>
          </div>
          <div className="px-5 py-4 flex flex-col gap-4">
            <Gauge
              label="Accesos VIP"
              usado={vip.asignados}
              pendiente={vip.pendientes}
              total={vip.total}
            />
            <Gauge
              label="Accesos vehiculares"
              usado={veh.asignados}
              pendiente={veh.pendientes}
              total={veh.total}
            />
            <div className="hx-hint">Los accesos peatonales no consumen cupo.</div>
            <div className="grid grid-cols-3 gap-3 pt-1">
              <Metrica valor={empleados.filter((e) => e.estado).length} label="Empleados activos" />
              <Metrica
                valor={accesos.filter((a) => a.status !== false).length}
                label="Tarjetas vigentes"
              />
              <Metrica valor={vehiculos.length} label="Vehículos" />
            </div>
            {pendientes > 0 && (
              <button className="hx-alerta" onClick={() => setVista("solicitudes")}>
                <Clock size={15} />
                <span>
                  {pendientes} {pendientes === 1 ? "solicitud pendiente" : "solicitudes pendientes"}{" "}
                  de revisión
                </span>
                <ArrowRight size={14} className="ml-auto" />
              </button>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
