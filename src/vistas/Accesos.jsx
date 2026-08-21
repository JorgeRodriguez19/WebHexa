import React, { useMemo, useState } from "react";
import { AlertTriangle, Plus, RefreshCw, Search, ShieldCheck } from "lucide-react";

import { Badge, Btn, Cabecera, Card, Field, Gauge, Linea, Modal, Vacio } from "../lib/ui.jsx";
import { folioAcceso } from "../lib/fmt.js";
import { TIPO_ACCESO, TIPO_CAMBIO, norm } from "../../shared/reglas.js";

const MOTIVOS_REPOSICION = ["Extravío", "Robo", "Daño físico", "Falla de lectura"];

export default function Accesos({ ctx }) {
  const { accesos, cupo, misSolicitudesAcc, catalogos, usuarioId, tarjetasLibres } = ctx;
  const [q, setQ] = useState("");
  const [filtro, setFiltro] = useState("todos");
  const [modal, setModal] = useState(null); // {tipo:'N'|'R'|'S', acceso}

  const vip = cupo(TIPO_ACCESO.VIP);
  const veh = cupo(TIPO_ACCESO.VEHICULAR);

  const tipos = catalogos.tipos_acceso;

  const lista = useMemo(
    () =>
      accesos
        .filter((a) => (filtro === "todos" ? true : a.tipo === filtro))
        .filter((a) => {
          if (!q.trim()) return true;
          const t = norm(q);
          return norm(a.num_tarjeta).includes(t) || norm(a.empleado).includes(t);
        }),
    [accesos, filtro, q]
  );

  const pendientes = misSolicitudesAcc.filter((s) => s.estado_revision === "P");

  return (
    <div className="flex flex-col gap-5">
      <Cabecera
        titulo="Accesos"
        sub="Tarjetas VIP, vehiculares y peatonales asignadas a tu personal"
        accion={
          <Btn variant="primary" onClick={() => setModal({ tipo: "N" })} disabled={!usuarioId}>
            <Plus size={15} /> Solicitar tarjeta
          </Btn>
        }
      />

      <Card>
        <div className="px-5 py-4 flex flex-wrap items-end gap-6">
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
          <div className="hx-hint max-w-xs">
            Los segmentos claros son solicitudes aún sin autorizar; también ocupan lugar.
            <br />
            Inventario de plásticos libres: <span className="mono">{tarjetasLibres}</span>.
          </div>
        </div>
      </Card>

      <Card>
        <div className="px-5 pt-4 flex flex-wrap gap-3 items-center justify-between">
          <div className="hx-filtros">
            {["todos", ...tipos.map((t) => t.descripcion)].map((f) => (
              <button key={f} className="hx-chip" data-on={filtro === f} onClick={() => setFiltro(f)}>
                {f === "todos" ? "Todas" : f}
              </button>
            ))}
          </div>
          <div className="hx-buscador">
            <Search size={14} />
            <input
              className="hx-input-plain"
              placeholder="Buscar tarjeta o empleado"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        </div>

        <div className="px-5 py-4">
          {lista.length === 0 ? (
            <Vacio texto="No hay tarjetas que coincidan con la búsqueda." />
          ) : (
            <div className="hx-tabla-wrap">
              <table className="hx-tabla">
                <thead>
                  <tr>
                    <th>Tarjeta</th>
                    <th>Tipo</th>
                    <th>Horario</th>
                    <th>Asignada a</th>
                    <th>Desde</th>
                    <th>Estado</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {lista.map((a) => {
                    const vigente = a.status !== false;
                    return (
                      <tr key={a.id} data-baja={!vigente}>
                        <td className="mono hx-num">{a.num_tarjeta}</td>
                        <td>
                          <Badge tone={a.id_tipo === TIPO_ACCESO.VIP ? "brass" : "neutral"}>
                            {a.tipo}
                          </Badge>
                        </td>
                        <td className="hx-hint mono">{a.horario}</td>
                        <td>
                          <div className="hx-strong">{a.empleado}</div>
                          {!a.empleado_activo && <div className="hx-hint">Empleado inactivo</div>}
                        </td>
                        <td className="mono hx-hint">{a.fecha_asignacion}</td>
                        <td>
                          {vigente ? <Badge tone="ok">Vigente</Badge> : <Badge tone="bad">Liberada</Badge>}
                        </td>
                        <td className="text-right whitespace-nowrap">
                          <Btn
                            disabled={!vigente || !usuarioId}
                            onClick={() => setModal({ tipo: "R", acceso: a })}
                          >
                            Reasignar
                          </Btn>
                          <Btn
                            disabled={!vigente || !usuarioId}
                            onClick={() => setModal({ tipo: "S", acceso: a })}
                          >
                            Reponer
                          </Btn>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Card>

      {/* las solicitudes en curso van al final: el inventario asignado es lo principal */}
      {pendientes.length > 0 && (
        <Card>
          <div className="px-5 pt-4">
            <h2 className="hx-h2">Solicitudes en curso</h2>
          </div>
          <ul className="px-5 pb-4 hx-divide">
            {pendientes.map((s) => (
              <li key={s.id} className="py-3 flex items-center gap-3 flex-wrap">
                <span className="mono hx-folio">{folioAcceso(s.id)}</span>
                <span className="hx-strong">{TIPO_CAMBIO[s.tipo_cambio] ?? s.tipo_cambio}</span>
                <span className="hx-hint">{describir(s)}</span>
                <Badge tone="warn">Pendiente</Badge>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {modal?.tipo === "N" && <ModalNuevaTarjeta ctx={ctx} onClose={() => setModal(null)} />}
      {modal?.tipo === "R" && (
        <ModalReasignar ctx={ctx} acceso={modal.acceso} onClose={() => setModal(null)} />
      )}
      {modal?.tipo === "S" && (
        <ModalReponer ctx={ctx} acceso={modal.acceso} onClose={() => setModal(null)} />
      )}
    </div>
  );
}

export function describir(s) {
  if (s.tipo_cambio === "N") return `${s.tipo} para ${s.empleado}`;
  if (s.tipo_cambio === "R") return `${s.num_tarjeta} → ${s.empleado}`;
  if (s.tipo_cambio === "S") return `${s.num_tarjeta} · ${s.comentarios || "reposición"}`;
  return s.empleado ?? "";
}

/* ------------------------------------------------------------------ *
 *  N · tarjeta nueva (Flujo_Solicitud_Tarjeta)
 * ------------------------------------------------------------------ */

function ModalNuevaTarjeta({ ctx, onClose }) {
  const { empleados, catalogos, cupo, avisar, acciones } = ctx;
  const activos = empleados.filter((e) => e.estado);

  const [idEmpleado, setIdEmpleado] = useState(activos[0]?.id ?? "");
  const [idTipo, setIdTipo] = useState(TIPO_ACCESO.VIP);
  const [idHorario, setIdHorario] = useState(catalogos.horarios[0]?.id ?? 1);
  const [robotico, setRobotico] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);

  const c = cupo(idTipo);

  const enviar = async () => {
    if (!idEmpleado) {
      avisar("RN-014", "Elige un empleado registrado. Si no aparece, regístralo primero.");
      return;
    }
    if (!motivo.trim()) {
      avisar("RN-009", "Escribe el motivo de la solicitud.");
      return;
    }
    setEnviando(true);
    const r = await acciones.crearSolicitudAcceso({
      tipo_cambio: "N",
      id_empleado: Number(idEmpleado),
      id_tipo: Number(idTipo),
      id_horario: Number(idHorario),
      robotico,
      comentarios: motivo.trim(),
    });
    setEnviando(false);
    if (r) onClose();
  };

  return (
    <Modal open kicker="Accesos" title="Solicitar tarjeta" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <Field label="Empleado" hint="Solo aparecen empleados activos de tu empresa">
          <select
            className="hx-input"
            value={idEmpleado}
            onChange={(e) => setIdEmpleado(e.target.value)}
          >
            {activos.length === 0 && <option value="">Sin empleados activos</option>}
            {activos.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nombre_completo}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Tipo de acceso">
          <div className="hx-radio-row">
            {catalogos.tipos_acceso.map((t) => (
              <button
                key={t.id}
                className="hx-radio"
                data-on={Number(idTipo) === t.id}
                onClick={() => setIdTipo(t.id)}
              >
                {t.descripcion}
              </button>
            ))}
          </div>
        </Field>

        {c.consumeCupo && (
          <div className="hx-nota" data-tone={c.disponible <= 0 ? "warn" : "info"}>
            {c.disponible <= 0 ? <AlertTriangle size={14} /> : <ShieldCheck size={14} />}
            <span>
              {c.disponible <= 0
                ? `Cupo agotado: ${c.asignados + c.pendientes} de ${c.total} lugares ocupados.`
                : `Quedan ${c.disponible} de ${c.total} lugares en el contrato.`}
            </span>
          </div>
        )}

        <Field label="Horario de acceso" hint="Catálogo development.horarios">
          <select className="hx-input" value={idHorario} onChange={(e) => setIdHorario(e.target.value)}>
            {catalogos.horarios.map((h) => (
              <option key={h.id} value={h.id}>
                {h.tipo} — {h.descripcion}
              </option>
            ))}
          </select>
        </Field>

        <label className="hx-check">
          <input type="checkbox" checked={robotico} onChange={(e) => setRobotico(e.target.checked)} />
          <span>Acceso robótico (torniquete automatizado)</span>
        </label>

        <Field label="Motivo">
          <input
            className="hx-input"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Ingreso a piso ejecutivo, cambio de puesto…"
          />
        </Field>

        <div className="flex justify-end gap-2">
          <Btn onClick={onClose}>Cancelar</Btn>
          <Btn
            variant="primary"
            onClick={enviar}
            disabled={enviando || !activos.length || (c.consumeCupo && c.disponible <= 0)}
          >
            {enviando ? "Enviando…" : "Enviar solicitud"}
          </Btn>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ *
 *  R · reasignación (Flujo_Reasignar_Acceso)
 * ------------------------------------------------------------------ */

function ModalReasignar({ ctx, acceso, onClose }) {
  const { empleados, avisar, acciones } = ctx;
  const candidatos = empleados.filter((e) => e.estado && e.id !== acceso.id_empleado);

  const [destino, setDestino] = useState(candidatos[0]?.id ?? "");
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);

  const enviar = async () => {
    if (!destino) {
      avisar("RN-014", "Elige al empleado que recibirá la tarjeta.");
      return;
    }
    setEnviando(true);
    const r = await acciones.crearSolicitudAcceso({
      tipo_cambio: "R",
      num_tarjeta: acceso.num_tarjeta,
      id_empleado: Number(destino),
      comentarios: motivo.trim() || null,
    });
    setEnviando(false);
    if (r) onClose();
  };

  return (
    <Modal
      open
      kicker={`Tarjeta ${acceso.num_tarjeta} · ${acceso.tipo}`}
      title="Reasignar tarjeta"
      onClose={onClose}
    >
      <div className="flex flex-col gap-4">
        <div className="hx-resumen">
          <Linea k="Titular actual" v={acceso.empleado} />
          <Linea k="Asignada desde" v={acceso.fecha_asignacion} mono />
          <Linea k="Horario" v={acceso.horario} />
        </div>
        {candidatos.length === 0 ? (
          <div className="hx-nota" data-tone="warn">
            <AlertTriangle size={14} />
            <span>No hay otro empleado activo para recibir la tarjeta.</span>
          </div>
        ) : (
          <Field label="Nuevo titular">
            <select className="hx-input" value={destino} onChange={(e) => setDestino(e.target.value)}>
              {candidatos.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nombre_completo}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Motivo" hint="Opcional">
          <input
            className="hx-input"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Cambio de área, sustitución…"
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Btn onClick={onClose}>Cancelar</Btn>
          <Btn variant="primary" onClick={enviar} disabled={enviando || !candidatos.length}>
            {enviando ? "Enviando…" : "Enviar solicitud"}
          </Btn>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ *
 *  S · reposición por robo o extravío (Flujo_Reposición_Acceso)
 * ------------------------------------------------------------------ */

function ModalReponer({ ctx, acceso, onClose }) {
  const { acciones, tarjetasLibres } = ctx;
  const [motivo, setMotivo] = useState(MOTIVOS_REPOSICION[0]);
  const [enviando, setEnviando] = useState(false);

  const enviar = async () => {
    setEnviando(true);
    const r = await acciones.crearSolicitudAcceso({
      tipo_cambio: "S",
      num_tarjeta: acceso.num_tarjeta,
      comentarios: motivo,
    });
    setEnviando(false);
    if (r) onClose();
  };

  return (
    <Modal
      open
      kicker={`Tarjeta ${acceso.num_tarjeta} · ${acceso.tipo}`}
      title="Reponer tarjeta"
      onClose={onClose}
    >
      <div className="flex flex-col gap-4">
        <div className="hx-resumen">
          <Linea k="Titular" v={acceso.empleado} />
          <Linea k="Tipo" v={acceso.tipo} />
        </div>
        <Field label="Motivo de la reposición">
          <div className="hx-radio-row">
            {MOTIVOS_REPOSICION.map((m) => (
              <button key={m} className="hx-radio" data-on={motivo === m} onClick={() => setMotivo(m)}>
                {m}
              </button>
            ))}
          </div>
        </Field>
        <div className="hx-nota" data-tone={tarjetasLibres === 0 ? "warn" : undefined}>
          <RefreshCw size={14} />
          <span>
            Al aprobarse, el plástico actual se inhabilita y se asigna uno nuevo del inventario. El
            cupo del contrato no cambia.
            {tarjetasLibres === 0 && " Ahora mismo no hay plásticos libres en inventario."}
          </span>
        </div>
        <div className="flex justify-end gap-2">
          <Btn onClick={onClose}>Cancelar</Btn>
          <Btn variant="primary" onClick={enviar} disabled={enviando}>
            {enviando ? "Enviando…" : "Enviar solicitud"}
          </Btn>
        </div>
      </div>
    </Modal>
  );
}
