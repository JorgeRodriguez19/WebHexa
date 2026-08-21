import React, { useState } from "react";
import { LogIn, ShieldCheck } from "lucide-react";

import { Btn, Eyebrow, Field } from "../lib/ui.jsx";
import { api, sesion as almacen } from "../lib/api.js";

/**
 * Pantalla de acceso. Mantiene el lenguaje visual del panel: fondo oscuro
 * como la barra superior, marca de tres barras, bordes finos sin sombra y
 * tipografía monoespaciada en las etiquetas.
 */
export default function Login({ onEntrar, entorno }) {
  const [correo, setCorreo] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);

  const enviar = async (e) => {
    e?.preventDefault();
    setError(null);

    if (!correo.trim()) return setError("Escribe tu correo.");
    if (!password) return setError("Escribe tu contraseña.");

    setEnviando(true);
    try {
      const r = await api.login(correo.trim(), password);
      almacen.guardar(r.token, r.perfil);
      onEntrar(r.perfil);
    } catch (err) {
      setError(err.message);
      setPassword("");
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="hx-login">
      <form className="hx-login-caja" onSubmit={enviar}>
        <div className="flex items-center gap-3">
          <div className="hx-mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div>
            <div className="hx-brand">HEXA</div>
            <div className="hx-brand-sub">Torre Reforma · Panel de operación</div>
          </div>
        </div>

        <div className="hx-login-sep" />

        <div>
          <Eyebrow>Acceso</Eyebrow>
          <h1 className="hx-login-tit">Inicia sesión</h1>
        </div>

        <Field label="Correo">
          <input
            className="hx-input"
            type="email"
            autoComplete="username"
            autoFocus
            value={correo}
            onChange={(e) => setCorreo(e.target.value)}
            placeholder="nombre@empresa.com"
          />
        </Field>

        <Field label="Contraseña">
          <input
            className="hx-input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
        </Field>

        {error && (
          <div className="hx-nota" data-tone="bad">
            <span>{error}</span>
          </div>
        )}

        <Btn variant="primary" type="submit" disabled={enviando} className="hx-login-btn">
          <LogIn size={15} /> {enviando ? "Entrando…" : "Entrar"}
        </Btn>

        <div className="hx-nota">
          <ShieldCheck size={14} />
          <span>
            Solo verás la información de tu empresa. El alcance se aplica en el servidor, no en
            esta pantalla.
          </span>
        </div>

        {entorno?.produccion && (
          <div className="hx-login-prod mono">
            Conectado a <b>{entorno.schema}</b> · datos de producción
          </div>
        )}
      </form>
    </div>
  );
}
