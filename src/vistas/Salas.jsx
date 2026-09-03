import React, { useEffect, useState } from "react";
import { AlertTriangle, ArrowRight, Check, MapPin, Plus, ShieldCheck, Trash2 } from "lucide-react";

import {
  Badge,
  Btn,
  Cabecera,
  Card,
  Cargando,
  Field,
  Franja,
  Linea,
  Modal,
  Vacio,
} from "../lib/ui.jsx";
import { useOcupacion } from "../lib/useOcupacion.js";
import { api } from "../lib/api.js";
import { dinero, fechaCorta, fechaLarga, folioSala, hhmm } from "../lib/fmt.js";
import {
  CAPACIDAD_MAXIMA,
  CIERRE_TORRE,
  costoEstimado,
  diasHabilesSiguientes,
  esDiaHabil,
  horasEntre,
  rejillaHoras,
  toHora,
  toMin,
} from "../../shared/reglas.js";

const HORAS = rejillaHoras();

export default function Salas({ ctx }) {
  const {
    hoy,
    salas,
    empresaId,
    reservaciones,
    misSolicitudesSalas,
    bloquesDe,
    acciones,
    usuarioId,
  } = ctx;

  const [dia, setDia] = useState(() => diasHabilesSiguientes(1)[0]);
  const [señal, setSeñal] = useState(0);
  const { ocupacion, cargando } = useOcupacion(dia, señal);
  const [wizard, setWizard] = useState(false);

  const mias = reservaciones.filter(
    (r) => r.id_empresa === empresaId && r.fecha_reservacion >= hoy
  );
  const pendientesSala = misSolicitudesSalas.filter((s) => s.estado === "P");

  const alCerrarWizard = (creo) => {
    setWizard(false);
    if (creo) setSeñal((s) => s + 1);
  };

  return (
    <div className="flex flex-col gap-5">
      <Cabecera
        titulo="Salas y reservaciones"
        sub="Disponibilidad por franja horaria · las salas operan de 08:00 a 18:00 y la Terraza de 18:00 a 24:00"
        accion={
          <Btn
            variant="primary"
            onClick={() => setWizard(true)}
            disabled={!usuarioId}
            title={usuarioId ? "" : "La empresa no tiene un solicitante registrado"}
          >
            <Plus size={15} /> Reservar sala
          </Btn>
        }
      />

      <Card>
        <div className="flex items-center justify-between gap-3 flex-wrap px-5 pt-4">
          <div className="flex items-baseline gap-3">
            <h2 className="hx-h2">{fechaLarga(dia)}</h2>
            {!esDiaHabil(dia) && <Badge tone="warn">Día inhábil · no se reserva</Badge>}
          </div>
          <input
            type="date"
            className="hx-input hx-input-sm mono"
            value={dia}
            onChange={(e) => e.target.value && setDia(e.target.value)}
            aria-label="Elegir día"
          />
        </div>
        {cargando ? (
          <Cargando texto="Consultando ocupación…" />
        ) : (
          <div className="px-5 py-4 flex flex-col gap-3">
            {salas.map((s) => (
              <div key={s.id} className="hx-sala-row">
                <div className="hx-sala-id">
                  <span className="hx-sala-nom">{s.nombre}</span>
                  <span className="mono hx-sala-meta">
                    {s.capacidad} pax · {dinero(s.precio_hora)}/h
                  </span>
                </div>
                <Franja bloques={bloquesDe(ocupacion, s.id)} sala={s} />
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <div className="px-5 pt-4">
          <h2 className="hx-h2">Mis reservaciones</h2>
        </div>
        {mias.length === 0 && pendientesSala.length === 0 ? (
          <Vacio texto="Aún no hay reservaciones. Empieza con “Reservar sala”." />
        ) : (
          <div className="px-5 pb-4">
            <div className="hx-tabla-wrap">
              <table className="hx-tabla">
                <thead>
                  <tr>
                    <th>Evento</th>
                    <th>Sala</th>
                    <th>Fecha</th>
                    <th>Horario</th>
                    <th className="text-right">Costo estimado</th>
                    <th>Estado</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {pendientesSala.map((s) => (
                    <tr key={`p${s.id}`}>
                      <td>
                        <div className="hx-strong">{s.tipo_evento}</div>
                        <div className="hx-hint mono">
                          {folioSala(s.id)} · {s.solicitante}
                        </div>
                      </td>
                      <td>{s.sala}</td>
                      <td className="mono">{fechaCorta(s.fecha_reservacion)}</td>
                      <td className="mono">
                        {hhmm(s.hora_inicio)}–{hhmm(s.hora_fin)}
                      </td>
                      <td className="mono text-right">
                        {dinero(costoEstimado(s.precio_hora, s.hora_inicio, s.hora_fin))}
                      </td>
                      <td>
                        <Badge tone="warn">Pendiente</Badge>
                      </td>
                      <td className="text-right">
                        <Btn onClick={() => acciones.cancelarSolicitudSala(s.id).then(() => setSeñal((x) => x + 1))}>
                          <Trash2 size={13} /> Retirar
                        </Btn>
                      </td>
                    </tr>
                  ))}
                  {mias.map((r) => (
                    <tr key={`r${r.id}`}>
                      <td>
                        <div className="hx-strong">{r.tipo_evento}</div>
                        <div className="hx-hint mono">
                          {r.num_invitados} invitados · {r.solicitante}
                        </div>
                      </td>
                      <td>{r.sala}</td>
                      <td className="mono">{fechaCorta(r.fecha_reservacion)}</td>
                      <td className="mono">
                        {hhmm(r.hora_inicio)}–{hhmm(r.hora_fin)}
                      </td>
                      <td className="mono text-right">
                        {dinero(costoEstimado(r.precio_hora, r.hora_inicio, r.hora_fin))}
                      </td>
                      <td>
                        <Badge tone="ok">Confirmada</Badge>
                      </td>
                      <td className="hx-hint text-right">Aprobada {fechaCorta(r.fecha_aprobacion)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="hx-nota mt-3">
              <ShieldCheck size={14} />
              <span>
                Una reservación ya aprobada solo puede modificarla o cancelarla la administración del
                edificio: la tabla <code className="mono">reservaciones</code> no registra
                solicitudes de cambio.
              </span>
            </div>
          </div>
        )}
      </Card>

      {wizard && <WizardReserva ctx={ctx} onClose={alCerrarWizard} />}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 *  Asistente de reservación · Flujo_Reservacion_Sala
 *  1 datos del evento · 2 sala asignada · 3 confirmación
 * ------------------------------------------------------------------ */

function WizardReserva({ ctx, onClose }) {
  const { avisarError, acciones } = ctx;

  const [paso, setPaso] = useState(1);
  const [form, setForm] = useState(() => ({
    fecha: diasHabilesSiguientes(1)[0],
    hora_inicio: "09:00",
    hora_fin: "11:00",
    num_invitados: 6,
    tipo_evento: "",
  }));
  const [busqueda, setBusqueda] = useState(null);
  const [salaSel, setSalaSel] = useState(null);
  const [servicios, setServicios] = useState([]);
  const [buscando, setBuscando] = useState(false);
  const [enviando, setEnviando] = useState(false);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  /*
   * Mover la hora de inicio tiene que arrastrar la de término.
   * Las opciones de término se filtran a las posteriores al inicio, y un
   * <select> cuyo value no está entre sus opciones muestra la primera SIN
   * disparar onChange: la pantalla decía 13:30 mientras el estado seguía en
   * 11:00, y se enviaba un rango invertido que el servidor rechazaba con
   * RN-019. Se conserva la duración elegida y se topa en el cierre de la torre.
   */
  const cambiarInicio = (v) =>
    setForm((f) => {
      const duracion = Math.max(30, toMin(f.hora_fin) - toMin(f.hora_inicio));
      const fin = Math.min(toMin(v) + duracion, toMin(CIERRE_TORRE));
      return { ...f, hora_inicio: v, hora_fin: toHora(fin) };
    });

  /* Ocupación del día elegido, para pintar la franja de cada opción. */
  const { ocupacion } = useOcupacion(paso >= 2 ? form.fecha : null);

  /* Paso 1 · el servidor aplica RN-019, RN-020 y RN-021 y devuelve las salas. */
  const buscarSala = async () => {
    if (!form.tipo_evento.trim()) {
      ctx.avisar("RN-009", "Falta el nombre del evento. Sin ese dato la solicitud no se registra.");
      return;
    }
    setBuscando(true);
    try {
      const r = await api.salasDisponibles({
        fecha: form.fecha,
        hora_inicio: form.hora_inicio,
        hora_fin: form.hora_fin,
        num_invitados: form.num_invitados,
      });
      setBusqueda(r);
      if (!r.salas.length) {
        ctx.avisar(
          "RN-021",
          `Ninguna sala está libre el ${fechaCorta(form.fecha)} de ${form.hora_inicio} a ${form.hora_fin}. ` +
            `Prueba otro rango o alguna de estas fechas: ${(r.sugerencias ?? [])
              .map(fechaCorta)
              .join(", ")}.`
        );
        return;
      }
      setSalaSel(r.salas[0].id);
      setPaso(2);
    } catch (e) {
      avisarError(e);
    } finally {
      setBuscando(false);
    }
  };

  const sala = busqueda?.salas.find((s) => s.id === salaSel) ?? null;
  const horas = horasEntre(form.hora_inicio, form.hora_fin);
  const costo = sala ? costoEstimado(sala.precio_hora, form.hora_inicio, form.hora_fin) : 0;

  const confirmar = async () => {
    setEnviando(true);
    const r = await acciones.crearSolicitudSala({
      id_sala: salaSel,
      fecha: form.fecha,
      hora_inicio: form.hora_inicio,
      hora_fin: form.hora_fin,
      num_invitados: Number(form.num_invitados),
      tipo_evento: form.tipo_evento.trim(),
      servicios: servicios.filter((s) => s.tipo.trim()),
    });
    setEnviando(false);
    if (r) onClose(true);
  };

  return (
    <Modal
      open
      wide
      onClose={() => onClose(false)}
      kicker="Nueva reservación"
      title={paso === 1 ? "Datos del evento" : paso === 2 ? "Sala asignada" : "Confirma la reservación"}
    >
      <div className="hx-pasos mono">
        {["Datos", "Sala", "Confirmación"].map((p, i) => (
          <span key={p} data-state={paso === i + 1 ? "on" : paso > i + 1 ? "done" : "off"}>
            {i + 1} {p}
          </span>
        ))}
      </div>

      {paso === 1 && (
        <div className="flex flex-col gap-4 mt-4">
          <Field label="Nombre del evento">
            <input
              className="hx-input"
              value={form.tipo_evento}
              onChange={(e) => set("tipo_evento", e.target.value)}
              placeholder="Junta de consejo, capacitación, entrevista…"
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Fecha" hint="Solo días hábiles futuros">
              <input
                type="date"
                className="hx-input mono"
                value={form.fecha}
                onChange={(e) => e.target.value && set("fecha", e.target.value)}
              />
            </Field>
            <Field label="Invitados" hint="Define la sala que te corresponde">
              <input
                type="number"
                min="1"
                max={CAPACIDAD_MAXIMA}
                className="hx-input mono"
                value={form.num_invitados}
                onChange={(e) => set("num_invitados", e.target.value)}
              />
            </Field>
            <Field label="Hora de inicio">
              <select
                className="hx-input mono"
                value={form.hora_inicio}
                onChange={(e) => cambiarInicio(e.target.value)}
              >
                {HORAS.slice(0, -1).map((h) => (
                  <option key={h}>{h}</option>
                ))}
              </select>
            </Field>
            <Field label="Hora de término">
              <select
                className="hx-input mono"
                value={form.hora_fin}
                onChange={(e) => set("hora_fin", e.target.value)}
              >
                {HORAS.filter((h) => toMin(h) > toMin(form.hora_inicio)).map((h) => (
                  <option key={h}>{h}</option>
                ))}
              </select>
            </Field>
          </div>
          <div className="hx-nota">
            <MapPin size={14} />
            <span>
              La sala se asigna por capacidad: hasta 8, 12, 22, 96 o 150 personas. Si tu banda está
              ocupada, subimos a la siguiente.
            </span>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Btn onClick={() => onClose(false)}>Cancelar</Btn>
            <Btn variant="primary" onClick={buscarSala} disabled={buscando}>
              {buscando ? "Buscando…" : "Buscar sala"} <ArrowRight size={14} />
            </Btn>
          </div>
        </div>
      )}

      {paso === 2 && busqueda && (
        <div className="flex flex-col gap-4 mt-4">
          {busqueda.subio_banda && (
            <div className="hx-nota" data-tone="warn">
              <AlertTriangle size={14} />
              <span>
                Las salas de hasta {busqueda.banda_original} personas están ocupadas a esa hora. Te
                mostramos las de hasta {busqueda.banda}.
              </span>
            </div>
          )}
          <div className="flex flex-col gap-2">
            {busqueda.salas.map((s) => (
              <button
                key={s.id}
                className="hx-opcion"
                data-sel={salaSel === s.id}
                data-libre={true}
                onClick={() => setSalaSel(s.id)}
              >
                <div className="flex items-center justify-between gap-3 w-full">
                  <div className="text-left">
                    <div className="hx-strong">{s.nombre}</div>
                    <div className="hx-hint mono">
                      Piso {s.piso} · hasta {s.capacidad} personas · {dinero(s.precio_hora)}/h
                    </div>
                  </div>
                  <Badge tone="ok">Libre</Badge>
                </div>
                <div className="w-full mt-2">
                  <Franja
                    compact
                    sala={s}
                    bloques={ctx.bloquesDe(ocupacion, s.id)}
                    propuesta={{ ini: form.hora_inicio, fin: form.hora_fin, choca: false }}
                  />
                </div>
              </button>
            ))}
          </div>
          <div className="flex justify-between gap-2 pt-1">
            <Btn onClick={() => setPaso(1)}>Volver</Btn>
            <Btn variant="primary" onClick={() => setPaso(3)} disabled={!salaSel}>
              Continuar <ArrowRight size={14} />
            </Btn>
          </div>
        </div>
      )}

      {paso === 3 && sala && (
        <div className="flex flex-col gap-4 mt-4">
          <Servicios servicios={servicios} setServicios={setServicios} />

          <div className="hx-resumen">
            <Linea k="Evento" v={form.tipo_evento} />
            <Linea k="Sala" v={`${sala.nombre} · piso ${sala.piso}`} />
            <Linea k="Fecha" v={fechaLarga(form.fecha)} />
            <Linea k="Horario" v={`${form.hora_inicio} a ${form.hora_fin} · ${horas} h`} mono />
            <Linea k="Invitados" v={`${form.num_invitados} de ${sala.capacidad}`} mono />
            <Linea k="Tarifa" v={`${dinero(sala.precio_hora)} por hora`} mono />
            {servicios.filter((s) => s.tipo.trim()).length > 0 && (
              <Linea
                k="Servicios"
                v={servicios
                  .filter((s) => s.tipo.trim())
                  .map((s) => (s.proveedor ? `${s.tipo} (${s.proveedor})` : s.tipo))
                  .join(", ")}
              />
            )}
            <div className="hx-resumen-total">
              <span>Costo estimado</span>
              <span className="mono">{dinero(costo)}</span>
            </div>
          </div>

          <div className="hx-nota">
            <ShieldCheck size={14} />
            <span>
              Al confirmar, la solicitud queda pendiente de autorización por la administración del
              edificio.
            </span>
          </div>
          <div className="flex justify-between gap-2">
            <Btn onClick={() => setPaso(2)}>Volver</Btn>
            <Btn variant="primary" onClick={confirmar} disabled={enviando}>
              <Check size={15} /> {enviando ? "Enviando…" : "Confirmar reservación"}
            </Btn>
          </div>
        </div>
      )}
    </Modal>
  );
}

/**
 * Paso 5 del Flujo_Reservacion_Sala: servicios adicionales con proveedor.
 * Se guardan en `solicitudes_salas.servicios` como JSON indexado en base 1,
 * igual que lo escribe el chatbot.
 */
function Servicios({ servicios, setServicios }) {
  const cambiar = (i, k, v) =>
    setServicios((prev) => prev.map((s, j) => (i === j ? { ...s, [k]: v } : s)));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <span className="hx-label">Servicios adicionales</span>
        <Btn onClick={() => setServicios((p) => [...p, { tipo: "", proveedor: "" }])}>
          <Plus size={13} /> Agregar
        </Btn>
      </div>
      {servicios.length === 0 ? (
        <span className="hx-hint">Opcional: coffee break, catering, montaje, equipo audiovisual…</span>
      ) : (
        servicios.map((s, i) => (
          <div key={i} className="grid gap-2" style={{ gridTemplateColumns: "1fr 1fr auto" }}>
            <input
              className="hx-input"
              placeholder="Servicio"
              value={s.tipo}
              onChange={(e) => cambiar(i, "tipo", e.target.value)}
            />
            <input
              className="hx-input"
              placeholder="Proveedor"
              value={s.proveedor}
              onChange={(e) => cambiar(i, "proveedor", e.target.value)}
            />
            <Btn onClick={() => setServicios((p) => p.filter((_, j) => j !== i))} title="Quitar">
              <Trash2 size={13} />
            </Btn>
          </div>
        ))
      )}
    </div>
  );
}
