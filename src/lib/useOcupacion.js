import { useEffect, useState } from "react";
import { api } from "./api.js";

/**
 * Ocupación de todas las salas en una fecha (reservaciones aprobadas +
 * solicitudes pendientes). Se consulta al servidor en cada cambio de día
 * porque la franja debe reflejar también lo que reservan otros inquilinos.
 *
 * `señal` permite forzar una recarga tras crear o resolver una solicitud.
 */
export function useOcupacion(fecha, señal = 0) {
  const [ocupacion, setOcupacion] = useState([]);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    if (!fecha) return;
    let vigente = true;
    setCargando(true);
    api
      .ocupacion(fecha)
      .then((r) => vigente && setOcupacion(r))
      .catch(() => vigente && setOcupacion([]))
      .finally(() => vigente && setCargando(false));
    return () => {
      vigente = false;
    };
  }, [fecha, señal]);

  return { ocupacion, cargando };
}
