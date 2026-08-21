import React, { useState } from "react";
import { Check, ShieldCheck, X } from "lucide-react";

import { Badge, Btn, Cabecera, Card, Vacio } from "../lib/ui.jsx";
import { describir } from "./Accesos.jsx";
import { dinero, fechaLarga, folioAcceso, folioSala, hhmm } from "../lib/fmt.js";
import {
  ETIQUETA_ESTADO,
  TIPO_CAMBIO,
  TONO_ESTADO,
  costoEstimado,
  estadoSolicitud,
} from "../../shared/reglas.js";

export default function Solicitudes({ ctx }) {
  const { esAdmin, admin, misSolicitudesAcc, misSolicitudesSalas, acciones, tarjetasLibres } = ctx;
  const [tab, setTab] = useState("accesos");
  const [filtro, setFiltro] = useState("pendientes");

  const acc = esAdmin ? (admin?.actualizaciones ?? []) : misSolicitudesAcc;
  const sal = esAdmin ? (admin?.solicitudes_salas ?? []) : misSolicitudesSalas;

  const soloPendientes = (lista, clave) =>
    filtro === "pendientes" ? lista.filter((s) => s[clave] === "P") : lista;

  const accVisibles = soloPendientes(acc, "estado_revision");
  const salVisibles = soloPendientes(sal, "estado");

  return (
    <div className="flex flex-col gap-5">
      <Cabecera
        titulo="Solicitudes"
        sub={
          esAdmin
            ? "Autoriza o rechaza los movimientos de todos los inquilinos"
            : "Movimientos enviados a la administración del edificio"
        }
        accion={
          <div className="hx-filtros">
            {[
              ["pendientes", "Pendientes"],
              ["todas", "Historial completo"],
            ].map(([v, l]) => (
              <button key={v} className="hx-chip" data-on={filtro === v} onClick={() => setFiltro(v)}>
                {l}
              </button>
            ))}
          </div>
        }
      />

      <div className="hx-tabs">
        <button className="hx-tab" data-on={tab === "accesos"} onClick={() => setTab("accesos")}>
          Accesos y personal <span className="mono">{acc.filter((s) => s.estado_revision === "P").length}</span>
        </button>
        <button className="hx-tab" data-on={tab === "salas"} onClick={() => setTab("salas")}>
          Salas <span className="mono">{sal.filter((s) => s.estado === "P").length}</span>
        </button>
      </div>

      {esAdmin && tarjetasLibres === 0 && tab === "accesos" && (
        <div className="hx-nota" data-tone="warn">
          <ShieldCheck size={14} />
          <span>
            No quedan plásticos libres en <code className="mono">tarjetas</code>. Aprobar una tarjeta
            nueva o una reposición fallará hasta que se dé de alta inventario.
          </span>
        </div>
      )}

      {tab === "accesos" && (
        <Card>
          {accVisibles.length === 0 ? (
            <Vacio
              texto={
                filtro === "pendientes"
                  ? "No hay solicitudes de accesos pendientes."
                  : "No hay solicitudes de accesos."
              }
            />
          ) : (
            <ul className="px-5 py-2 hx-divide">
              {accVisibles.map((s) => {
                const estado = estadoSolicitud(s.estado_revision, s.aprobado, s.comentarios);
                return (
                  <li key={s.id} className="hx-sol">
                    <div className="hx-sol-main">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="mono hx-folio">{folioAcceso(s.id)}</span>
                        <span className="hx-strong">
                          {TIPO_CAMBIO[s.tipo_cambio] ?? s.tipo_cambio}
                        </span>
                        <Badge tone={TONO_ESTADO[estado]}>{ETIQUETA_ESTADO[estado]}</Badge>
                      </div>
                      <div className="hx-hint mt-1">{describir(s)}</div>
                      <div className="hx-hint mono mt-1">
                        {s.fecha_solicitud} · {s.solicitante ?? "—"}
                        {esAdmin ? ` · ${s.empresa ?? ""}` : ""}
                        {s.usuario_revision ? ` · revisó ${s.usuario_revision}` : ""}
                      </div>
                      {s.comentarios ? (
                        <div className="hx-hint mt-1">“{s.comentarios}”</div>
                      ) : null}
                    </div>
                    <div className="hx-sol-acc">
                      {estado === "P" && esAdmin && (
                        <>
                          <Btn variant="ok" onClick={() => acciones.resolverAcceso(s.id, true)}>
                            <Check size={14} /> Aprobar
                          </Btn>
                          <Btn variant="bad" onClick={() => acciones.resolverAcceso(s.id, false)}>
                            <X size={14} /> Rechazar
                          </Btn>
                        </>
                      )}
                      {estado === "P" && !esAdmin && (
                        <Btn onClick={() => acciones.cancelarSolicitudAcceso(s.id)}>Retirar</Btn>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      )}

      {tab === "salas" && (
        <Card>
          {salVisibles.length === 0 ? (
            <Vacio
              texto={
                filtro === "pendientes"
                  ? "No hay solicitudes de salas pendientes."
                  : "No hay solicitudes de salas."
              }
            />
          ) : (
            <ul className="px-5 py-2 hx-divide">
              {salVisibles.map((s) => {
                const estado = estadoSolicitud(s.estado, s.aprobado, s.comentarios);
                const servicios = Object.values(s.servicios ?? {});
                return (
                  <li key={s.id} className="hx-sol">
                    <div className="hx-sol-main">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="mono hx-folio">{folioSala(s.id)}</span>
                        <span className="hx-strong">{s.tipo_evento}</span>
                        <Badge tone={TONO_ESTADO[estado]}>{ETIQUETA_ESTADO[estado]}</Badge>
                      </div>
                      <div className="hx-hint mt-1">
                        {s.sala} · {fechaLarga(s.fecha_reservacion)} · {hhmm(s.hora_inicio)}–
                        {hhmm(s.hora_fin)} · {s.num_invitados} invitados
                      </div>
                      <div className="hx-hint mono mt-1">
                        {dinero(costoEstimado(s.precio_hora, s.hora_inicio, s.hora_fin))} ·{" "}
                        {s.solicitante}
                        {esAdmin ? ` · ${s.empresa ?? ""}` : ""}
                        {s.usuario_revision ? ` · revisó ${s.usuario_revision}` : ""}
                      </div>
                      {servicios.length > 0 && (
                        <div className="hx-hint mt-1">
                          Servicios:{" "}
                          {servicios
                            .map((v) => (v.proveedor ? `${v.tipo} (${v.proveedor})` : v.tipo))
                            .join(", ")}
                        </div>
                      )}
                    </div>
                    <div className="hx-sol-acc">
                      {estado === "P" && esAdmin && (
                        <>
                          <Btn variant="ok" onClick={() => acciones.resolverSala(s.id, true)}>
                            <Check size={14} /> Aprobar
                          </Btn>
                          <Btn variant="bad" onClick={() => acciones.resolverSala(s.id, false)}>
                            <X size={14} /> Rechazar
                          </Btn>
                        </>
                      )}
                      {estado === "P" && !esAdmin && (
                        <Btn onClick={() => acciones.cancelarSolicitudSala(s.id)}>Retirar</Btn>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      )}

      {!esAdmin && (
        <div className="hx-nota">
          <ShieldCheck size={14} />
          <span>
            Cambia el perfil a “Administración Hexa” en la barra superior para autorizar solicitudes.
          </span>
        </div>
      )}
    </div>
  );
}
