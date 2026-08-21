import React, { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { APERTURA_TORRE, CIERRE_TORRE, toMin } from "../../shared/reglas.js";
import { hhmm } from "./fmt.js";

/* ------------------------------------------------------------------ *
 *  Componentes base del prototipo, sin cambios de estilo.
 * ------------------------------------------------------------------ */

export function Eyebrow({ children, className = "" }) {
  return <div className={`hx-eyebrow ${className}`}>{children}</div>;
}

export function Card({ children, className = "" }) {
  return <section className={`hx-card ${className}`}>{children}</section>;
}

export function Badge({ children, tone = "neutral" }) {
  return (
    <span className="hx-badge" data-tone={tone}>
      {children}
    </span>
  );
}

export function Btn({
  children,
  onClick,
  variant = "ghost",
  disabled,
  type = "button",
  className = "",
  title,
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`hx-btn ${className}`}
      data-variant={variant}
    >
      {children}
    </button>
  );
}

export function Field({ label, hint, children }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="hx-label">{label}</span>
      {children}
      {hint ? <span className="hx-hint">{hint}</span> : null}
    </label>
  );
}

export function Modal({ open, title, kicker, onClose, children, wide = false }) {
  const ref = useRef(null);

  /*
   * `onClose` casi siempre llega como flecha nueva en cada render
   * (`onClose={() => onClose(false)}`), así que NO puede ser dependencia de un
   * efecto: se guarda en un ref para que el listener use siempre la última
   * versión sin volver a suscribirse.
   */
  const cerrar = useRef(onClose);
  useEffect(() => {
    cerrar.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") cerrar.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  /*
   * Foco inicial solo al abrir. Antes esto vivía en el efecto de arriba con
   * `onClose` en las dependencias, así que se re-ejecutaba en cada render: cada
   * letra escrita en un input devolvía el foco al diálogo y había que volver a
   * hacer clic en el campo para escribir la siguiente.
   */
  useEffect(() => {
    if (open) ref.current?.focus();
  }, [open]);

  if (!open) return null;
  return (
    <div
      className="hx-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`hx-modal ${wide ? "hx-modal-wide" : ""}`}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        ref={ref}
      >
        <header className="flex items-start justify-between gap-4 px-5 py-4 hx-modal-head">
          <div>
            {kicker ? <Eyebrow>{kicker}</Eyebrow> : null}
            <h2 className="hx-h2 mt-1">{title}</h2>
          </div>
          <Btn onClick={onClose} title="Cerrar">
            <X size={16} />
          </Btn>
        </header>
        <div className="px-5 py-5">{children}</div>
      </div>
    </div>
  );
}

export function Cabecera({ titulo, sub, accion }) {
  return (
    <div className="flex items-end justify-between gap-4 flex-wrap">
      <div>
        <h1 className="hx-h1">{titulo}</h1>
        {sub ? <div className="hx-hint mt-1">{sub}</div> : null}
      </div>
      {accion}
    </div>
  );
}

export function Metrica({ valor, label }) {
  return (
    <div className="hx-metrica">
      <div className="hx-metrica-num mono">{valor}</div>
      <div className="hx-metrica-lbl">{label}</div>
    </div>
  );
}

export function Vacio({ texto }) {
  return <div className="hx-vacio">{texto}</div>;
}

export function Linea({ k, v, mono }) {
  return (
    <div className="hx-linea">
      <span className="hx-linea-k">{k}</span>
      <span className={`hx-linea-v ${mono ? "mono" : ""}`}>{v}</span>
    </div>
  );
}

export function Cargando({ texto = "Consultando la base…" }) {
  return (
    <div className="hx-cargando px-5 py-6">
      <span className="hx-spinner" />
      <span>{texto}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 *  Medidor de cupo segmentado (firma visual del prototipo)
 *  Con cupos grandes (Devol tiene 30 VIP) los segmentos individuales no
 *  caben, así que por encima de 24 se degrada a una barra continua sin
 *  cambiar el lenguaje visual.
 * ------------------------------------------------------------------ */
export function Gauge({ label, usado, total, pendiente = 0 }) {
  const t = Math.max(0, Number(total) || 0);
  const u = Math.min(usado, t);
  const p = Math.min(pendiente, Math.max(0, t - u));

  return (
    <div className="flex flex-col gap-1.5" style={{ minWidth: 132 }}>
      <div className="flex items-baseline justify-between gap-3">
        <Eyebrow>{label}</Eyebrow>
        <span className="mono text-xs hx-num">
          {usado + pendiente}/{t}
        </span>
      </div>
      {t <= 24 ? (
        <div className="hx-ticks" aria-label={`${usado} de ${t} en uso`}>
          {Array.from({ length: t }).map((_, i) => (
            <span
              key={i}
              className="hx-tick"
              data-state={i < u ? "on" : i < u + p ? "wait" : "off"}
            />
          ))}
        </div>
      ) : (
        <div className="hx-barra" aria-label={`${usado} de ${t} en uso`}>
          <i data-state="on" style={{ width: `${(u / t) * 100}%` }} />
          <i data-state="wait" style={{ width: `${(p / t) * 100}%` }} />
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 *  Franja horaria
 *  El prototipo dibujaba 07:00–20:00, pero la Terraza opera 18:00–24:00,
 *  así que la escala va de 08:00 a 24:00 y se sombrea el horario en que
 *  cada sala está cerrada.
 * ------------------------------------------------------------------ */
const INI = toMin(APERTURA_TORRE);
const SPAN = toMin(CIERRE_TORRE) - INI;
const MARCAS = [8, 10, 12, 14, 16, 18, 20, 22, 24];

const pos = (t) => ((toMin(t) - INI) / SPAN) * 100;
const ancho = (a, b) => ((toMin(b) - toMin(a)) / SPAN) * 100;
const acotar = (v) => Math.max(0, Math.min(100, v));

export function Franja({ bloques = [], propuesta = null, compact = false, sala = null }) {
  const cerrados = [];
  if (sala?.horario_apertura && sala?.horario_cierre) {
    const a = pos(sala.horario_apertura);
    const c = pos(sala.horario_cierre);
    if (a > 0) cerrados.push({ left: 0, width: acotar(a) });
    if (c < 100) cerrados.push({ left: acotar(c), width: acotar(100 - c) });
  }

  return (
    <div className={`hx-franja ${compact ? "hx-franja-sm" : ""}`}>
      <div className="hx-franja-rail">
        {cerrados.map((c, i) => (
          <span
            key={`c${i}`}
            className="hx-franja-cerrado"
            style={{ left: `${c.left}%`, width: `${c.width}%` }}
            title="Fuera del horario de operación"
          />
        ))}
        {MARCAS.map((h) => (
          <span
            key={h}
            className="hx-franja-tick"
            style={{ left: `${((h * 60 - INI) / SPAN) * 100}%` }}
          />
        ))}
        {bloques.map((b, i) => (
          <div
            key={i}
            className="hx-bloque"
            data-tono={b.tono}
            style={{ left: `${acotar(pos(b.ini))}%`, width: `${acotar(ancho(b.ini, b.fin))}%` }}
            title={`${hhmm(b.ini)}–${hhmm(b.fin)} · ${b.label}`}
          >
            <span className="hx-bloque-txt">{b.label}</span>
          </div>
        ))}
        {propuesta ? (
          <div
            className="hx-propuesta"
            data-choca={propuesta.choca ? "si" : "no"}
            style={{
              left: `${acotar(pos(propuesta.ini))}%`,
              width: `${acotar(ancho(propuesta.ini, propuesta.fin))}%`,
            }}
          >
            <span className="hx-bloque-txt">{propuesta.choca ? "ocupada" : "libre"}</span>
          </div>
        ) : null}
      </div>
      {!compact && (
        <div className="hx-franja-horas mono">
          {MARCAS.map((h) => (
            <span key={h} style={{ left: `${((h * 60 - INI) / SPAN) * 100}%` }}>
              {String(h).padStart(2, "0")}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
