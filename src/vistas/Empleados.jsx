import React, { useMemo, useState } from "react";
import { Plus, Search, ShieldCheck } from "lucide-react";

import { Badge, Btn, Cabecera, Card, Field, Modal, Vacio } from "../lib/ui.jsx";
import { norm } from "../../shared/reglas.js";

export default function Empleados({ ctx }) {
  const { empleados, accesos, avisar, acciones, misSolicitudesAcc, usuarioId } = ctx;
  const [q, setQ] = useState("");
  const [nuevo, setNuevo] = useState(false);
  const [verInactivos, setVerInactivos] = useState(false);

  const activos = empleados.filter((e) => e.estado).length;
  const inactivos = empleados.length - activos;

  /*
   * Los inactivos no se listan por defecto. Se pueden mostrar con el chip porque
   * la reactivación (RN-016, tipo_cambio "A") solo se puede pedir desde su fila.
   */
  const lista = useMemo(
    () =>
      empleados
        .filter((e) => (verInactivos ? true : e.estado))
        .filter((e) => (!q.trim() ? true : norm(e.nombre_completo).includes(norm(q)))),
    [empleados, q, verInactivos]
  );

  const pendienteDe = (id, tipo) =>
    misSolicitudesAcc.some(
      (s) => s.estado_revision === "P" && s.tipo_cambio === tipo && s.id_empleado === id
    );

  const solicitar = (tipo, e) => {
    if (pendienteDe(e.id, tipo)) {
      avisar("RN-013", `Ya hay una solicitud de ${tipo === "B" ? "baja" : "alta"} pendiente para ${e.nombre_completo}.`);
      return;
    }
    acciones.crearSolicitudAcceso({ tipo_cambio: tipo, id_empleado: e.id });
  };

  return (
    <div className="flex flex-col gap-5">
      <Cabecera
        titulo="Empleados"
        sub="Personal registrado ante la administración del edificio"
        accion={
          <Btn variant="primary" onClick={() => setNuevo(true)}>
            <Plus size={15} /> Registrar empleado
          </Btn>
        }
      />

      <Card>
        <div className="px-5 pt-4 flex justify-between items-center gap-3 flex-wrap">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="hx-hint">
              {activos} {activos === 1 ? "empleado activo" : "empleados activos"}
            </span>
            {inactivos > 0 && (
              <button
                className="hx-chip"
                data-on={verInactivos}
                onClick={() => setVerInactivos((v) => !v)}
              >
                {verInactivos ? "Ocultar" : "Ver"} {inactivos}{" "}
                {inactivos === 1 ? "inactivo" : "inactivos"}
              </button>
            )}
          </div>
          <div className="hx-buscador">
            <Search size={14} />
            <input
              className="hx-input-plain"
              placeholder="Buscar por nombre"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        </div>
        <div className="px-5 py-4">
          {lista.length === 0 ? (
            <Vacio
              texto={
                q.trim()
                  ? "Sin coincidencias. Prueba con otro nombre."
                  : "No hay empleados activos. Registra uno o consulta los inactivos."
              }
            />
          ) : (
            <div className="hx-tabla-wrap">
              <table className="hx-tabla">
                <thead>
                  <tr>
                    <th>Nombre</th>
                    <th>Tarjetas vigentes</th>
                    <th>Capacitación</th>
                    {verInactivos && <th>Estado</th>}
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {lista.map((e) => {
                    const tarjetas = accesos.filter(
                      (a) => a.id_empleado === e.id && a.status !== false
                    );
                    return (
                      <tr key={e.id} data-baja={!e.estado}>
                        <td className="hx-strong">{e.nombre_completo}</td>
                        <td className="mono">
                          {tarjetas.length === 0 ? (
                            <span className="hx-hint">—</span>
                          ) : (
                            tarjetas.map((t) => t.num_tarjeta).join(" · ")
                          )}
                        </td>
                        <td>
                          {e.capacitacion ? (
                            <Badge tone="ok">Acreditada</Badge>
                          ) : (
                            <span className="hx-hint">Pendiente</span>
                          )}
                        </td>
                        {verInactivos && (
                          <td>
                            {e.estado ? (
                              <Badge tone="ok">Activo</Badge>
                            ) : (
                              <Badge tone="bad">Inactivo</Badge>
                            )}
                          </td>
                        )}
                        <td className="text-right whitespace-nowrap">
                          {e.estado ? (
                            <Btn onClick={() => solicitar("B", e)} disabled={!usuarioId}>
                              Dar de baja
                            </Btn>
                          ) : (
                            <Btn onClick={() => solicitar("A", e)} disabled={!usuarioId}>
                              Reactivar
                            </Btn>
                          )}
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

      {nuevo && <ModalNuevoEmpleado ctx={ctx} onClose={() => setNuevo(false)} />}
    </div>
  );
}

/**
 * Flujo_Nuevo_Empleado: el chatbot inserta el empleado de inmediato, sin
 * pasar por revisión. La web hace lo mismo para no divergir del flujo n8n.
 */
function ModalNuevoEmpleado({ ctx, onClose }) {
  const { acciones, avisar, empleados } = ctx;
  const [nombre, setNombre] = useState("");
  const [capacitacion, setCapacitacion] = useState(false);
  const [enviando, setEnviando] = useState(false);

  const enviar = async () => {
    if (!nombre.trim()) {
      avisar("RN-009", "El nombre completo es obligatorio.");
      return;
    }
    // RN-015 · aviso temprano; el servidor vuelve a validarlo contra la base.
    if (empleados.some((e) => norm(e.nombre_completo) === norm(nombre))) {
      avisar("RN-015", `${nombre.trim()} ya está registrado en tu empresa.`);
      return;
    }
    setEnviando(true);
    const r = await acciones.crearEmpleado({ nombre_completo: nombre.trim(), capacitacion });
    setEnviando(false);
    if (r) onClose();
  };

  return (
    <Modal open kicker="Empleados" title="Registrar empleado" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <Field label="Nombre completo" hint="Tal como aparece en su identificación">
          <input
            className="hx-input"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Nombre y apellidos"
          />
        </Field>
        <label className="hx-check">
          <input
            type="checkbox"
            checked={capacitacion}
            onChange={(e) => setCapacitacion(e.target.checked)}
          />
          <span>Ya tomó la capacitación de seguridad del edificio</span>
        </label>
        <div className="hx-nota">
          <ShieldCheck size={14} />
          <span>
            Verificamos que la persona no esté ya registrada. Los nombres se comparan sin distinguir
            acentos ni mayúsculas. El alta es inmediata: no requiere autorización.
          </span>
        </div>
        <div className="flex justify-end gap-2">
          <Btn onClick={onClose}>Cancelar</Btn>
          <Btn variant="primary" onClick={enviar} disabled={enviando}>
            {enviando ? "Registrando…" : "Registrar empleado"}
          </Btn>
        </div>
      </div>
    </Modal>
  );
}
