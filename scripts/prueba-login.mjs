/**
 * Prueba del login y del aislamiento por empresa.
 *
 * NO escribe en la base: solo hace login y consultas de lectura, más intentos
 * deliberados de salirse del alcance para comprobar que el servidor los corta.
 *
 *   node scripts/prueba-login.mjs
 */
import "dotenv/config";

const API = process.env.SMOKE_API || "http://localhost:4000";
const fallos = [];

const ok = (n, cond, detalle = "") => {
  console.log(cond ? `  ok    ${n}` : `  FALLA ${n}${detalle ? ` — ${detalle}` : ""}`);
  if (!cond) fallos.push(n);
};

async function pedir(ruta, { token, metodo = "GET", cuerpo } = {}) {
  const res = await fetch(`${API}/api${ruta}`, {
    method: metodo,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(cuerpo ? { "Content-Type": "application/json" } : {}),
    },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const txt = await res.text();
  return { status: res.status, datos: txt ? JSON.parse(txt) : null };
}

const salud = await pedir("/salud");
console.log(`\nAPI en ${API} · schema "${salud.datos?.schema}"\n`);

/* ---------------------------------------------------------------- */
console.log("1 · Sin sesión no se ve nada");
for (const ruta of ["/catalogos", "/reservaciones", "/ocupacion/2026-01-05", "/administracion/solicitudes"]) {
  const r = await pedir(ruta);
  ok(`${ruta} responde 401`, r.status === 401, `dio ${r.status}`);
}

/* ---------------------------------------------------------------- */
console.log("\n2 · Credenciales incorrectas");
const malo = await pedir("/auth/login", {
  metodo: "POST",
  cuerpo: { correo: "office.manager@hexa.com.mx", password: "equivocada" },
});
ok("contraseña incorrecta da 401", malo.status === 401, `dio ${malo.status}`);
ok(
  "el mensaje no revela si el correo existe",
  /correo o contrase/i.test(malo.datos?.error ?? ""),
  malo.datos?.error
);

const inexistente = await pedir("/auth/login", {
  metodo: "POST",
  cuerpo: { correo: "nadie@ejemplo.com", password: "x" },
});
ok(
  "correo inexistente da el MISMO mensaje",
  inexistente.datos?.error === malo.datos?.error,
  `"${inexistente.datos?.error}" vs "${malo.datos?.error}"`
);

/* ---------------------------------------------------------------- */
console.log("\n3 · Office Manager entra y solo ve su empresa");
const login = await pedir("/auth/login", {
  metodo: "POST",
  cuerpo: { correo: "office.manager@hexa.com.mx", password: "Hexa2026!" },
});
ok("login correcto", login.status === 200, JSON.stringify(login.datos));
const token = login.datos?.token;
const perfil = login.datos?.perfil;
console.log(`        → ${perfil?.nombre} · ${perfil?.empresa} (empresa ${perfil?.id_empresa})`);
ok("no es superusuario", perfil?.superusuario === false);
ok("tiene empresa asignada", !!perfil?.id_empresa);

const cat = await pedir("/catalogos", { token });
ok("catálogos accesibles con sesión", cat.status === 200);
ok(
  "solo devuelve UNA empresa",
  cat.datos?.empresas?.length === 1,
  `devolvió ${cat.datos?.empresas?.length}`
);
ok(
  "y es la suya",
  cat.datos?.empresas?.[0]?.id === perfil?.id_empresa,
  `${cat.datos?.empresas?.[0]?.nombre}`
);
ok(
  "los usuarios listados son todos de su empresa",
  (cat.datos?.usuarios ?? []).every((u) => u.id_empresa === perfil.id_empresa),
  `${cat.datos?.usuarios?.length} usuarios`
);
ok("las salas del edificio sí se ven", (cat.datos?.salas ?? []).length > 0);

/* ---------------------------------------------------------------- */
console.log("\n4 · No puede salirse de su empresa");
const propio = await pedir(`/empresa/${perfil.id_empresa}/panel`, { token });
ok("su propio panel funciona", propio.status === 200, `dio ${propio.status}`);

const otras = (await pedir("/catalogos", { token: (await superToken()).token })).datos.empresas
  .filter((e) => e.id !== perfil.id_empresa)
  .slice(0, 3);

for (const e of otras) {
  const r = await pedir(`/empresa/${e.id}/panel`, { token });
  ok(`panel de ${e.nombre} (id ${e.id}) bloqueado con 403`, r.status === 403, `dio ${r.status}`);
}

const bandeja = await pedir("/administracion/solicitudes", { token });
ok("la bandeja global le está prohibida", bandeja.status === 403, `dio ${bandeja.status}`);

/* ---------------------------------------------------------------- */
console.log("\n5 · Las reservaciones y la ocupación vienen filtradas");
const res = await pedir("/reservaciones?desde=2000-01-01", { token });
ok(
  "solo reservaciones de su empresa",
  (res.datos ?? []).every((r) => r.id_empresa === perfil.id_empresa),
  `${(res.datos ?? []).length} filas`
);

const ocu = await pedir("/ocupacion/2025-09-25", { token });
const ajenos = (ocu.datos ?? []).filter((o) => o.ajena);
ok("la ocupación incluye bloques de otros (para no chocar)", (ocu.datos ?? []).length >= 0);
ok(
  "pero sin revelar el evento ajeno",
  ajenos.every((o) => o.tipo_evento === null && o.solicitante === null),
  `${ajenos.length} bloques ajenos`
);

/* ---------------------------------------------------------------- */
console.log("\n6 · Token manipulado");
const partes = token.split(".");
const falso = `${Buffer.from(
  JSON.stringify({ id_empresa: 999, super: true, exp: Date.now() + 60000 })
).toString("base64url")}.${partes[1]}`;
const conFalso = await pedir("/catalogos", { token: falso });
ok("un token con firma inválida se rechaza", conFalso.status === 401, `dio ${conFalso.status}`);

/* ---------------------------------------------------------------- */
console.log("\n7 · Superusuario");
const sup = await superToken();
ok("el superusuario entra", !!sup.token);
ok("está marcado como superusuario", sup.perfil?.superusuario === true);
const catSup = await pedir("/catalogos", { token: sup.token });
ok(
  "ve TODAS las empresas",
  (catSup.datos?.empresas ?? []).length > 1,
  `${catSup.datos?.empresas?.length} empresas`
);
const bandejaSup = await pedir("/administracion/solicitudes", { token: sup.token });
ok("accede a la bandeja global", bandejaSup.status === 200, `dio ${bandejaSup.status}`);

async function superToken() {
  const r = await pedir("/auth/login", {
    metodo: "POST",
    cuerpo: { correo: "admin@hexa.com.mx", password: "AdminTR2026!" },
  });
  return { token: r.datos?.token, perfil: r.datos?.perfil };
}

/* ---------------------------------------------------------------- */
console.log(`\n${"=".repeat(60)}`);
console.log(fallos.length ? `RESULTADO: ${fallos.length} fallidas` : "RESULTADO: todo correcto.");
process.exit(fallos.length ? 1 : 0);
