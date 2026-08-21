import React, { useState } from "react";
import { Plus, Search, ShieldCheck } from "lucide-react";

import { Badge, Btn, Cabecera, Card, Field, Modal, Vacio } from "../lib/ui.jsx";
import { norm } from "../../shared/reglas.js";

export default function Vehiculos({ ctx }) {
  const { vehiculos, usuarioId } = ctx;
  const [q, setQ] = useState("");
  const [nuevo, setNuevo] = useState(false);
  const [verInactivos, setVerInactivos] = useState(false);

  /*
   * `vehiculos` no tiene estado propio: un vehículo se considera inactivo cuando
   * su conductor lo está. Como los empleados, no se listan por defecto.
   */
  const activos = vehiculos.filter((v) => v.empleado_activo).length;
  const inactivos = vehiculos.length - activos;

  const lista = vehiculos
    .filter((v) => (verInactivos ? true : v.empleado_activo))
    .filter((v) =>
      !q.trim()
        ? true
        : [v.placas, v.marca, v.submarca, v.empleado].some((c) => norm(c).includes(norm(q)))
    );

  return (
    <div className="flex flex-col gap-5">
      <Cabecera
        titulo="Vehículos"
        sub="Autos registrados para el estacionamiento del edificio"
        accion={
          <Btn variant="primary" onClick={() => setNuevo(true)} disabled={!usuarioId}>
            <Plus size={15} /> Registrar vehículo
          </Btn>
        }
      />
      <Card>
        <div className="px-5 pt-4 flex justify-between items-center gap-3 flex-wrap">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="hx-hint">
              {activos} {activos === 1 ? "vehículo activo" : "vehículos activos"}
            </span>
            {inactivos > 0 && (
              <button
                className="hx-chip"
                data-on={verInactivos}
                onClick={() => setVerInactivos((v) => !v)}
              >
                {verInactivos ? "Ocultar" : "Ver"} {inactivos} con conductor inactivo
              </button>
            )}
          </div>
          <div className="hx-buscador">
            <Search size={14} />
            <input
              className="hx-input-plain"
              placeholder="Buscar placa, marca o conductor"
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
                  ? "Sin coincidencias. Prueba con otra búsqueda."
                  : vehiculos.length
                    ? "Ningún vehículo tiene conductor activo. Consúltalos con el filtro de arriba."
                    : "Sin vehículos registrados. Empieza con “Registrar vehículo”."
              }
            />
          ) : (
            <div className="hx-tabla-wrap">
              <table className="hx-tabla">
                <thead>
                  <tr>
                    <th>Placa</th>
                    <th>Vehículo</th>
                    <th>Color</th>
                    <th>Tipo</th>
                    <th>Conductor</th>
                  </tr>
                </thead>
                <tbody>
                  {lista.map((v) => (
                    <tr key={v.id} data-baja={!v.empleado_activo}>
                      <td className="mono hx-num">{v.placas}</td>
                      <td className="hx-strong">
                        {[v.marca, v.submarca].filter(Boolean).join(" ") || (
                          <span className="hx-hint">Sin especificar</span>
                        )}
                      </td>
                      <td>{v.color || <span className="hx-hint">—</span>}</td>
                      <td>
                        {v.tipo ? <Badge tone="neutral">{v.tipo}</Badge> : <span className="hx-hint">—</span>}
                      </td>
                      <td>
                        <div>{v.empleado}</div>
                        {!v.empleado_activo && <div className="hx-hint">Empleado inactivo</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Card>
      {nuevo && <ModalNuevoVehiculo ctx={ctx} onClose={() => setNuevo(false)} />}
    </div>
  );
}

/**
 * Flujo_Nuevo_Vehiculo. Nota de schema: `vehiculos` no tiene id_empresa ni
 * cajón de estacionamiento; el vínculo con la empresa es el conductor.
 */
function ModalNuevoVehiculo({ ctx, onClose }) {
  const { empleados, catalogos, avisar, acciones, vehiculos } = ctx;
  const activos = empleados.filter((e) => e.estado);

  const [f, setF] = useState({
    id_empleado: activos[0]?.id ?? "",
    placas: "",
    marca: "",
    submarca: "",
    color: "",
    id_tipo: "",
  });
  const [enviando, setEnviando] = useState(false);
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));

  const enviar = async () => {
    if (!f.id_empleado) {
      avisar("RN-014", "Elige al empleado que conducirá el vehículo.");
      return;
    }
    if (!f.placas.trim()) {
      avisar("RN-009", "La placa es obligatoria.");
      return;
    }
    if (vehiculos.some((v) => norm(v.placas) === norm(f.placas))) {
      avisar("RN-015", `La placa ${f.placas.trim().toUpperCase()} ya está registrada.`);
      return;
    }
    setEnviando(true);
    const r = await acciones.crearVehiculo({
      id_empleado: Number(f.id_empleado),
      placas: f.placas.trim(),
      marca: f.marca.trim() || null,
      submarca: f.submarca.trim() || null,
      color: f.color.trim() || null,
      id_tipo: f.id_tipo ? Number(f.id_tipo) : null,
    });
    setEnviando(false);
    if (r) onClose();
  };

  return (
    <Modal open kicker="Estacionamiento" title="Registrar vehículo" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <Field label="Conductor" hint="Debe ser un empleado activo de tu empresa">
          <select
            className="hx-input"
            value={f.id_empleado}
            onChange={(e) => set("id_empleado", e.target.value)}
          >
            {activos.length === 0 && <option value="">Sin empleados activos</option>}
            {activos.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nombre_completo}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Placa">
            <input
              className="hx-input mono"
              value={f.placas}
              onChange={(e) => set("placas", e.target.value)}
              placeholder="ABC-12-34"
            />
          </Field>
          <Field label="Color" hint="Opcional">
            <input className="hx-input" value={f.color} onChange={(e) => set("color", e.target.value)} />
          </Field>
          <Field label="Marca" hint="Opcional">
            <input className="hx-input" value={f.marca} onChange={(e) => set("marca", e.target.value)} />
          </Field>
          <Field label="Submarca" hint="Opcional">
            <input
              className="hx-input"
              value={f.submarca}
              onChange={(e) => set("submarca", e.target.value)}
            />
          </Field>
        </div>
        <Field label="Tipo de vehículo" hint="Catálogo development.tipo_vehiculos">
          <select className="hx-input" value={f.id_tipo} onChange={(e) => set("id_tipo", e.target.value)}>
            <option value="">Sin especificar</option>
            {catalogos.tipos_vehiculo.map((t) => (
              <option key={t.id} value={t.id}>
                {t.descripcion}
              </option>
            ))}
          </select>
        </Field>
        <div className="hx-nota">
          <ShieldCheck size={14} />
          <span>
            El registro es inmediato. El cajón de estacionamiento lo asigna la administración fuera
            del sistema.
          </span>
        </div>
        <div className="flex justify-end gap-2">
          <Btn onClick={onClose}>Cancelar</Btn>
          <Btn variant="primary" onClick={enviar} disabled={enviando || !activos.length}>
            {enviando ? "Registrando…" : "Registrar vehículo"}
          </Btn>
        </div>
      </div>
    </Modal>
  );
}
