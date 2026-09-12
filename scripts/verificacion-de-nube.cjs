/**
 * verificacion-de-nube.cjs — Verifica, contra un proyecto de Supabase y por
 * PostgREST, lo que ninguna prueba local puede verificar: que las funciones de
 * sincronización de la nube (migración `0023`) hacen lo que dicen, con los
 * usuarios de Auth reales y sus JWT reales.
 *
 * POR QUÉ EXISTE. Las pruebas de Vitest corren contra SQLite y no saben nada
 * de Postgres, de RLS ni de `auth.jwt()`. Todo lo que `docs/SINCRONIZACION.md`
 * §9.5 lista bajo «qué prueban esas pruebas» vive acá, y la mitad B de la
 * prueba de deriva (§9.2) también.
 *
 * CUATRO MODOS, según el argumento:
 *
 *   (sin argumentos)      Mitad B de la prueba de deriva: inicia sesión con el
 *                         rol `restauracion`, llama a
 *                         `contrato_de_sincronizacion()` y compara lo que la
 *                         nube declara con la foto guardada en
 *                         `supabase/esquema-nube.json`. No escribe nada. Puede
 *                         correr contra cualquier proyecto.
 *
 *   --tomar-foto          Igual, pero en vez de comparar ESCRIBE la foto. Se
 *                         corre a propósito cuando el esquema de la nube cambió
 *                         de verdad, y el archivo resultante se revisa en el
 *                         commit como cualquier otro cambio.
 *
 *   --destructivo         La batería completa: escribe y vuelve a escribir
 *                         filas de mentira con el usuario `terminal`, prueba
 *                         que los demás roles no pueden, y comprueba
 *                         idempotencia, rechazos y atomicidad. SOLO contra un
 *                         proyecto de la lista fija de `proyectos-de-prueba.cjs`:
 *                         el seguro se niega ante cualquier otro, y ante
 *                         `pos-jimmy-cano` por nombre, ANTES de tocar la red.
 *
 *                         Antes de empezar VACÍA las tablas con la `service_role`
 *                         del proyecto de pruebas (POS_NUBE_PRUEBAS_SERVICE_ROLE).
 *                         Sin ella no adivina: sale con código 2. Si las tablas
 *                         ya se vaciaron por otra vía —por ejemplo con SQL—,
 *                         `--reinicio-hecho` salta ese paso. La batería
 *                         necesita un proyecto limpio: el invariante «siempre
 *                         queda un administrador activo» no se puede probar con
 *                         administradores ajenos en la tabla, y solo puede
 *                         haber una caja abierta.
 *
 *   --esperar-vencimiento Inicia sesión como terminal, espera a que el token
 *                         venza y comprueba que PostgREST lo rechace. Tarda lo
 *                         que dure el token (15 minutos, si Auth está como pide
 *                         §1.6 del diseño).
 *
 * DE DÓNDE SALEN LAS CREDENCIALES. De `.env.nube-pruebas` en la raíz del
 * proyecto (ignorado por git; ver `.env.nube-pruebas.ejemplo`). Las variables
 * de entorno del proceso pisan a las del archivo. La `service_role` del
 * proyecto REAL no se usa nunca, y ninguna credencial de acá viaja en la
 * aplicación.
 *
 * QUÉ NO PRUEBA. Que el trabajador local arme bien los lotes: eso lo prueban
 * las pruebas de la bandeja de salida. Acá los lotes se arman a mano, con la
 * forma que la terminal va a mandar, para probar el lado de Postgres.
 *
 * CÓDIGOS DE SALIDA: 0 todo bien · 1 alguna comprobación falló · 2 faltó algo
 * para poder verificar (credenciales, la foto) · 3 el seguro se negó.
 *
 * Salida: una línea por comprobación y, al final, una línea JSON con la marca
 * INFORME_DE_NUBE, para que otra herramienta pueda leerla.
 */

'use strict';

const { existsSync, readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { randomUUID } = require('node:crypto');
const { setTimeout: dormir } = require('node:timers/promises');

const { ProyectoNoAdmitido, exigirProyectoDePrueba } = require('./proyectos-de-prueba.cjs');

/** Raíz del proyecto: este guion vive en scripts/. */
const RAIZ = join(__dirname, '..');
const ARCHIVO_DE_ENTORNO = join(RAIZ, '.env.nube-pruebas');
const ARCHIVO_DE_FOTO = join(RAIZ, 'supabase', 'esquema-nube.json');

/** Marca de la línea JSON final. */
const MARCA_INFORME = 'INFORME_DE_NUBE';

const CODIGO = Object.freeze({ ok: 0, fallo: 1, incompleto: 2, seguro: 3 });

/** Segundos que §1.6 del diseño pide para la vida de un JWT. */
const VIDA_DEL_JWT_SEGUNDOS = 900;

/** Milisegundos máximos por petición: la nube puede tardar, pero no colgarse. */
const TIEMPO_MAXIMO_MS = 30_000;

/** Cuánto puede diferir `recibido_en` del reloj de esta máquina sin sospechar. */
const MARGEN_DEL_RELOJ_MS = 5 * 60 * 1000;

/** Margen después de `exp` antes de comprobar que el token venció. */
const MARGEN_DE_VENCIMIENTO_MS = 10_000;

/** El billete de Q5, con el UUID fijo de la migración 004 (igual en local y nube). */
const DENOMINACION_Q5 = 'c11a36fb-5100-4459-8fde-740bb784d3aa';

/**
 * El tope del rol venta se escribe con un id FIJO: `limites_descuento.rol` es
 * UNIQUE y esa tabla no se vacía entre corridas, así que un id nuevo por
 * corrida chocaría contra la fila de la corrida anterior.
 */
const ID_TOPE_VENTA = 'ab5c4e1e-2c7c-4c6e-9d7b-1c9d5f3a7e01';

/** Las cinco funciones de escritura y la de lectura, tal como se llaman por RPC. */
const FUNCIONES_DE_ESCRITURA = Object.freeze([
  'sincronizar_usuario',
  'sincronizar_apertura_de_caja',
  'sincronizar_cierre_de_caja',
  'sincronizar_venta',
  'sincronizar_lote_simple',
]);
const FUNCION_DEL_CONTRATO = 'contrato_de_sincronizacion';

/** Los códigos HTTP con los que PostgREST contesta cada clase de error. */
const HTTP = Object.freeze({ ok: 200, peticionInvalida: 400, sinAutenticar: 401, prohibido: 403, conflicto: 409 });

/** Una fecha fija para las filas de mentira; lo que importa es `recibido_en`, que lo pone el servidor. */
const FECHA = '2026-09-11T14:00:00.000Z';
const FECHA_DE_CIERRE = '2026-09-11T18:00:00.000Z';

/** Faltó algo para poder verificar. No es un fallo de la nube: es que no se pudo mirar. */
class Incompleto extends Error {
  constructor(mensaje) {
    super(mensaje);
    this.name = 'Incompleto';
  }
}

// ---------------------------------------------------------------------------
// Entorno
// ---------------------------------------------------------------------------

function leerEntorno() {
  const valores = {};
  if (existsSync(ARCHIVO_DE_ENTORNO)) {
    for (const linea of readFileSync(ARCHIVO_DE_ENTORNO, 'utf8').split('\n')) {
      const limpia = linea.trim();
      if (limpia === '' || limpia.startsWith('#')) continue;
      const separador = limpia.indexOf('=');
      if (separador <= 0) continue;
      valores[limpia.slice(0, separador).trim()] = limpia.slice(separador + 1).trim();
    }
  }
  for (const [clave, valor] of Object.entries(process.env)) {
    if (clave.startsWith('POS_NUBE_') && valor !== undefined && valor !== '') valores[clave] = valor;
  }
  return valores;
}

function exigirVariables(entorno, claves) {
  const faltan = claves.filter((clave) => !entorno[clave]);
  if (faltan.length > 0) {
    throw new Incompleto(`Faltan en el entorno: ${faltan.join(', ')} (ver .env.nube-pruebas.ejemplo).`);
  }
}

const VARIABLES_BASE = ['POS_NUBE_PROYECTO', 'POS_NUBE_URL', 'POS_NUBE_LLAVE_PUBLICABLE'];
const VARIABLES_DE = {
  terminal: ['POS_NUBE_TERMINAL_CORREO', 'POS_NUBE_TERMINAL_CLAVE'],
  restauracion: ['POS_NUBE_RESTAURACION_CORREO', 'POS_NUBE_RESTAURACION_CLAVE'],
  sinRol: ['POS_NUBE_SIN_ROL_CORREO', 'POS_NUBE_SIN_ROL_CLAVE'],
};

// ---------------------------------------------------------------------------
// Cliente mínimo de Supabase: Auth por contraseña y PostgREST. Sin librería.
// ---------------------------------------------------------------------------

class ClienteDeNube {
  constructor(url, llavePublicable) {
    this.url = url.replace(/\/$/, '');
    this.llavePublicable = llavePublicable;
  }

  /**
   * Una petición. `token` es el JWT de un usuario; sin él va la llave
   * publicable sola, que es exactamente lo que tendría un ladrón con la
   * aplicación instalada y sin credencial. Una llave secreta (`sb_secret_`)
   * viaja también como `apikey`, que es como Supabase la reconoce.
   */
  async pedir(metodo, ruta, { token = null, cuerpo, prefer } = {}) {
    const apikey = token !== null && token.startsWith('sb_secret_') ? token : this.llavePublicable;
    const headers = {
      apikey,
      Authorization: `Bearer ${token ?? this.llavePublicable}`,
      'Content-Type': 'application/json',
    };
    if (prefer !== undefined) headers.Prefer = prefer;
    const respuesta = await fetch(`${this.url}${ruta}`, {
      method: metodo,
      headers,
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(TIEMPO_MAXIMO_MS),
    });
    const texto = await respuesta.text();
    let datos = texto;
    try {
      datos = texto === '' ? null : JSON.parse(texto);
    } catch {
      // Queda como texto: PostgREST a veces contesta sin JSON.
    }
    return { estado: respuesta.status, datos };
  }

  async iniciarSesion(correo, clave) {
    const r = await this.pedir('POST', '/auth/v1/token?grant_type=password', { cuerpo: { email: correo, password: clave } });
    if (r.estado !== HTTP.ok || typeof r.datos?.access_token !== 'string') {
      throw new Incompleto(`No se pudo iniciar sesión como ${correo}: HTTP ${r.estado} ${resumir(r.datos)}`);
    }
    const claims = JSON.parse(Buffer.from(r.datos.access_token.split('.')[1], 'base64url').toString('utf8'));
    return { correo, token: r.datos.access_token, expiraEn: r.datos.expires_in, claims };
  }

  rpc(funcion, cuerpo, token) {
    return this.pedir('POST', `/rest/v1/rpc/${funcion}`, { token, cuerpo });
  }
}

// ---------------------------------------------------------------------------
// Informe
// ---------------------------------------------------------------------------

class Informe {
  constructor() {
    this.comprobaciones = [];
    this.observaciones = [];
  }

  seccion(titulo) {
    console.log(`\n${titulo}`);
  }

  comprobar(nombre, ok, detalle = '') {
    this.comprobaciones.push({ nombre, ok: Boolean(ok), detalle });
    console.log(`  ${ok ? ' ok  ' : 'FALLA'} ${nombre}${ok || detalle === '' ? '' : `\n        ${detalle}`}`);
    return Boolean(ok);
  }

  observar(texto) {
    this.observaciones.push(texto);
    console.log(`   ·    ${texto}`);
  }

  get fallidas() {
    return this.comprobaciones.filter((c) => !c.ok);
  }

  cerrar(extra = {}) {
    const fallidas = this.fallidas;
    console.log(
      `\n${String(this.comprobaciones.length)} comprobaciones, ${String(fallidas.length)} fallidas.` +
        (fallidas.length > 0 ? `\n${fallidas.map((f) => `  - ${f.nombre}`).join('\n')}` : ''),
    );
    console.log(
      `${MARCA_INFORME} ${JSON.stringify({ comprobaciones: this.comprobaciones.length, fallidas: fallidas.map((f) => f.nombre), observaciones: this.observaciones, ...extra })}`,
    );
    return fallidas.length === 0 ? CODIGO.ok : CODIGO.fallo;
  }
}

const LARGO_DEL_RESUMEN = 240;

function resumir(datos) {
  const texto = typeof datos === 'string' ? datos : JSON.stringify(datos);
  return texto.length > LARGO_DEL_RESUMEN ? `${texto.slice(0, LARGO_DEL_RESUMEN)}…` : texto;
}

const filasDe = (r) => (Array.isArray(r.datos?.filas) ? r.datos.filas : []);
const resultadosDe = (r) => filasDe(r).map((f) => f.resultado).join(',');
const huellasDe = (r) => filasDe(r).map((f) => f.huella).join(',');

/**
 * Compara una respuesta con lo esperado: código HTTP, un texto que tiene que
 * aparecer en el cuerpo, y la lista de resultados por fila que la función
 * devuelve (`insertada`, `actualizada`, `sin_cambios`, `ya_existia`).
 */
function esperar(informe, nombre, r, { estado, texto, resultados }) {
  let ok = r.estado === estado;
  if (ok && texto !== undefined) ok = JSON.stringify(r.datos).includes(texto);
  if (ok && resultados !== undefined) ok = resultadosDe(r) === resultados;
  return informe.comprobar(
    nombre,
    ok,
    `esperaba HTTP ${String(estado)}${texto === undefined ? '' : ` con «${texto}»`}${resultados === undefined ? '' : ` y filas ${resultados}`}; ` +
      `llegó HTTP ${String(r.estado)} ${resumir(r.datos)}${resultados === undefined ? '' : ` (filas ${resultadosDe(r)})`}`,
  );
}

// ---------------------------------------------------------------------------
// Filas de mentira, con la forma EXACTA que manda la terminal: todas las
// columnas de la tabla en la nube menos `recibido_en`, decimales como cadenas
// canónicas y booleanos como 0/1, igual que los guarda SQLite.
// ---------------------------------------------------------------------------

const cambio = (tabla, operacion, datos) => ({ tabla, id: datos.id, operacion, datos });

const asiento = (usuarioId, entidadTipo, entidadId) =>
  cambio('auditoria_log', 'insertar', {
    id: randomUUID(),
    usuario_id: usuarioId,
    accion: `prueba_${entidadTipo}`,
    entidad_tipo: entidadTipo,
    entidad_id: entidadId,
    valor_anterior: null,
    // Como lo manda SQLite: un TEXTO con JSON adentro. La nube lo parsea.
    valor_nuevo: JSON.stringify({ origen: 'verify:nube' }),
    fecha: FECHA,
  });

const filaUsuario = (id, nombre, rol, activo) => ({ id, nombre, rol, activo, creado_en: FECHA, actualizado_en: FECHA });

const filaCategoria = (id, nombre) => ({ id, nombre, orden: 0, creado_en: FECHA, actualizado_en: FECHA, activo: 1 });

const filaProducto = (id, nombre, categoriaId, precio, inventario, contador, vendida) => ({
  id,
  nombre,
  categoria_id: categoriaId,
  foto_path: null,
  tipo_medida: 'peso',
  unidad_peso: 'lb',
  cantidad_predefinida_icono: '1.000',
  precio_base: precio,
  inventario_disponible: inventario,
  contador_ventas: contador,
  activo: 1,
  creado_en: FECHA,
  actualizado_en: FECHA,
  cantidad_vendida: vendida,
});

/** `cierre` en null es una caja abierta; con valores, una cerrada. */
const filaCaja = (id, usuarioId, montoInicial, cierre) => ({
  id,
  usuario_id: usuarioId,
  monto_inicial: montoInicial,
  abierta_en: FECHA,
  monto_esperado: cierre?.esperado ?? null,
  monto_real: cierre?.real ?? null,
  diferencia: cierre?.diferencia ?? null,
  cerrada_en: cierre ? FECHA_DE_CIERRE : null,
  estado: cierre ? 'cerrada' : 'abierta',
  creado_en: FECHA,
  actualizado_en: FECHA,
  diferencia_autorizada_por: cierre?.autorizadaPor ?? null,
  diferencia_autorizada_via: cierre?.via ?? null,
  cerrada_por: null,
});

const filaDesglose = (cajaId, momento, cantidad) => ({
  id: randomUUID(),
  caja_sesion_id: cajaId,
  denominacion_id: DENOMINACION_Q5,
  momento,
  cantidad,
  creado_en: FECHA,
});

const filaVenta = (id, cajaId, usuarioId, formaPago, boleta) => ({
  id,
  caja_sesion_id: cajaId,
  usuario_id: usuarioId,
  fecha: FECHA,
  subtotal: '17.50',
  descuento_tipo: null,
  descuento_valor: null,
  descuento_autorizado_por: null,
  total: '17.50',
  forma_pago: formaPago,
  num_boleta: boleta,
  estado: 'completada',
  creado_en: FECHA,
  actualizado_en: FECHA,
  descuento_autorizado_via: null,
});

const filaDetalle = (ventaId, productoId, nombre) => ({
  id: randomUUID(),
  venta_id: ventaId,
  producto_id: productoId,
  producto_nombre_snap: nombre,
  unidad_snap: 'lb',
  cantidad: '2.500',
  precio_unitario_snap: '7.00',
  subtotal_exacto: '17.5',
  subtotal_impreso: '17.50',
  orden_linea: 0,
  creado_en: FECHA,
});

const filaRecibo = (ventaId, numero) => ({
  id: randomUUID(),
  venta_id: ventaId,
  numero_recibo: numero,
  pdf_path: `recibos/${String(numero)}.pdf`,
  impreso: 0,
  creado_en: FECHA,
});

// ---------------------------------------------------------------------------
// El contrato y la foto (mitad B de §9.2)
// ---------------------------------------------------------------------------

/** Ordena las claves de todo objeto, para que la foto sea estable y comparable. */
function canonico(valor) {
  if (Array.isArray(valor)) return valor.map(canonico);
  if (valor !== null && typeof valor === 'object') {
    return Object.fromEntries(
      Object.keys(valor)
        .sort()
        .map((clave) => [clave, canonico(valor[clave])]),
    );
  }
  return valor;
}

async function leerContratoDeLaNube(cliente, entorno) {
  const sesion = await cliente.iniciarSesion(entorno.POS_NUBE_RESTAURACION_CORREO, entorno.POS_NUBE_RESTAURACION_CLAVE);
  const r = await cliente.rpc(FUNCION_DEL_CONTRATO, {}, sesion.token);
  if (r.estado !== HTTP.ok || typeof r.datos?.version_del_contrato !== 'number') {
    throw new Incompleto(`La nube no devolvió el contrato: HTTP ${String(r.estado)} ${resumir(r.datos)}`);
  }
  return canonico(r.datos);
}

function leerFoto() {
  if (!existsSync(ARCHIVO_DE_FOTO)) {
    throw new Incompleto(`No existe ${ARCHIVO_DE_FOTO}. Tomala primero con: npm run verify:nube -- --tomar-foto`);
  }
  return canonico(JSON.parse(readFileSync(ARCHIVO_DE_FOTO, 'utf8')));
}

function describirColumna(c) {
  return `${c.tipo}${c.nulable ? ' nulable' : ' NOT NULL'}`;
}

/** Las diferencias entre la foto y la nube, una por renglón y con nombre. */
function diferenciasEntre(foto, nube) {
  const diferencias = [];
  if (foto.version_del_contrato !== nube.version_del_contrato) {
    diferencias.push(`la nube declara el contrato ${String(nube.version_del_contrato)} y la foto dice ${String(foto.version_del_contrato)}`);
  }
  const tablasFoto = Object.keys(foto.tablas ?? {});
  const tablasNube = Object.keys(nube.tablas ?? {});
  for (const tabla of tablasFoto) if (!tablasNube.includes(tabla)) diferencias.push(`la tabla ${tabla} está en la foto y no en la nube`);
  for (const tabla of tablasNube) if (!tablasFoto.includes(tabla)) diferencias.push(`la tabla ${tabla} está en la nube y no en la foto`);
  for (const tabla of tablasFoto.filter((t) => tablasNube.includes(t))) {
    const enFoto = new Map(foto.tablas[tabla].map((c) => [c.nombre, c]));
    const enNube = new Map(nube.tablas[tabla].map((c) => [c.nombre, c]));
    for (const [nombre, columna] of enFoto) {
      const otra = enNube.get(nombre);
      if (otra === undefined) diferencias.push(`${tabla}.${nombre} está en la foto y no en la nube`);
      else if (otra.tipo !== columna.tipo || otra.nulable !== columna.nulable) {
        diferencias.push(`${tabla}.${nombre}: la foto dice ${describirColumna(columna)} y la nube ${describirColumna(otra)}`);
      }
    }
    for (const nombre of enNube.keys()) if (!enFoto.has(nombre)) diferencias.push(`${tabla}.${nombre} está en la nube y no en la foto`);
  }
  const funcionesFoto = Object.keys(foto.funciones ?? {});
  const funcionesNube = Object.keys(nube.funciones ?? {});
  for (const f of funcionesFoto) if (!funcionesNube.includes(f)) diferencias.push(`la función ${f} está en la foto y no en la nube`);
  for (const f of funcionesNube) if (!funcionesFoto.includes(f)) diferencias.push(`la función ${f} está en la nube y no en la foto`);
  for (const f of funcionesFoto.filter((x) => funcionesNube.includes(x))) {
    const a = JSON.stringify(foto.funciones[f]);
    const b = JSON.stringify(nube.funciones[f]);
    if (a !== b) diferencias.push(`la función ${f} cambió: la foto dice ${a} y la nube ${b}`);
  }
  return diferencias;
}

function resumenDelContrato(contrato) {
  return `contrato v${String(contrato.version_del_contrato)}: ${String(Object.keys(contrato.tablas).length)} tablas, ${String(Object.keys(contrato.funciones).length)} funciones`;
}

async function correrComparacionDelContrato(entorno, informe) {
  exigirVariables(entorno, [...VARIABLES_BASE, ...VARIABLES_DE.restauracion]);
  const cliente = new ClienteDeNube(entorno.POS_NUBE_URL, entorno.POS_NUBE_LLAVE_PUBLICABLE);
  informe.seccion(`Mitad B de la prueba de deriva contra ${entorno.POS_NUBE_PROYECTO}`);
  const foto = leerFoto();
  const nube = await leerContratoDeLaNube(cliente, entorno);
  informe.observar(`la nube declara: ${resumenDelContrato(nube)}`);
  const diferencias = diferenciasEntre(foto, nube);
  informe.comprobar(
    'lo que la nube declara coincide con supabase/esquema-nube.json',
    diferencias.length === 0,
    diferencias.map((d) => `- ${d}`).join('\n        '),
  );
  return informe.cerrar({ proyecto: entorno.POS_NUBE_PROYECTO, diferencias });
}

async function correrTomaDeFoto(entorno, informe) {
  exigirVariables(entorno, [...VARIABLES_BASE, ...VARIABLES_DE.restauracion]);
  const cliente = new ClienteDeNube(entorno.POS_NUBE_URL, entorno.POS_NUBE_LLAVE_PUBLICABLE);
  informe.seccion(`Foto del contrato de ${entorno.POS_NUBE_PROYECTO}`);
  const nube = await leerContratoDeLaNube(cliente, entorno);
  writeFileSync(ARCHIVO_DE_FOTO, `${JSON.stringify(nube, null, 2)}\n`);
  informe.observar(`escrita ${ARCHIVO_DE_FOTO}: ${resumenDelContrato(nube)}`);
  informe.comprobar('la foto se pudo tomar y guardar', true);
  return informe.cerrar({ proyecto: entorno.POS_NUBE_PROYECTO });
}

// ---------------------------------------------------------------------------
// Modo destructivo
// ---------------------------------------------------------------------------

/** Vacía lo que se puede vaciar con la service_role, por PostgREST. */
async function vaciarProyectoDePruebas(cliente, llaveDeServicio, informe) {
  const comunes = { token: llaveDeServicio, prefer: 'return=minimal' };
  const exigirOk = (r, que) => {
    if (r.estado >= 300) throw new Incompleto(`No se pudo ${que}: HTTP ${String(r.estado)} ${resumir(r.datos)}`);
  };
  // usuarios no se borra: auditoria_log lo referencia y es inmutable (ni el
  // SET NULL de su llave foránea pasa el trigger). Se desactivan, que es lo
  // que el invariante de administradores necesita.
  exigirOk(await cliente.pedir('PATCH', '/rest/v1/usuarios?activo=eq.true', { ...comunes, cuerpo: { activo: false } }), 'desactivar los usuarios');
  for (const tabla of ['recibos', 'venta_detalle', 'ventas', 'caja_sesion_denominaciones', 'caja_sesiones', 'precios_especiales', 'productos', 'categorias']) {
    exigirOk(await cliente.pedir('DELETE', `/rest/v1/${tabla}?id=not.is.null`, comunes), `vaciar ${tabla}`);
  }
  exigirOk(
    await cliente.pedir('PATCH', '/rest/v1/configuracion_negocio?id=eq.unica', {
      ...comunes,
      cuerpo: { nombre_comercial: null, direccion: null, telefono: null, nit: null },
    }),
    'vaciar configuracion_negocio',
  );
  informe.observar('tablas vaciadas con la service_role del proyecto de pruebas (usuarios: desactivados; auditoria_log: intacta, es inmutable)');
}

async function correrBateria(cliente, sesiones, version, informe) {
  const { terminal, restauracion, sinRol } = sesiones;
  const rpc = (funcion, lote, token, v = version) => cliente.rpc(funcion, { lote, version_de_contrato: v }, token);

  informe.seccion('Puertas: quién puede llamar a qué');
  for (const funcion of FUNCIONES_DE_ESCRITURA) {
    esperar(informe, `la llave publicable sola no puede llamar a ${funcion}`, await rpc(funcion, [], null), { estado: HTTP.sinAutenticar });
    esperar(informe, `un usuario sin rol no puede llamar a ${funcion}`, await rpc(funcion, [], sinRol.token), { estado: HTTP.prohibido, texto: 'Solo la terminal' });
    esperar(informe, `restauracion no puede llamar a ${funcion}`, await rpc(funcion, [], restauracion.token), { estado: HTTP.prohibido, texto: 'Solo la terminal' });
  }
  esperar(informe, 'la llave publicable sola no puede leer el contrato', await cliente.rpc(FUNCION_DEL_CONTRATO, {}, null), { estado: HTTP.sinAutenticar });
  esperar(informe, 'un usuario sin rol no puede leer el contrato', await cliente.rpc(FUNCION_DEL_CONTRATO, {}, sinRol.token), { estado: HTTP.prohibido });
  esperar(informe, 'la terminal no puede leer el contrato', await cliente.rpc(FUNCION_DEL_CONTRATO, {}, terminal.token), { estado: HTTP.prohibido });
  esperar(informe, 'restauracion sí lee el contrato', await cliente.rpc(FUNCION_DEL_CONTRATO, {}, restauracion.token), { estado: HTTP.ok, texto: '"version_del_contrato"' });
  esperar(
    informe,
    'la terminal no puede llamar al ayudante interno escribir_fila',
    await cliente.rpc('escribir_fila', { destino: 'public.categorias', datos: {}, si_existe: 'ignorar' }, terminal.token),
    { estado: HTTP.prohibido },
  );
  esperar(informe, 'una versión de contrato distinta se rechaza nombrando las dos', await rpc('sincronizar_usuario', [], terminal.token, version + 1), {
    estado: HTTP.peticionInvalida,
    texto: `manda la versión ${String(version + 1)} y la nube declara la ${String(version)}`,
  });

  informe.seccion('Acceso directo a las tablas: ninguno');
  const categoriaDirecta = filaCategoria(randomUUID(), `Directa ${randomUUID().slice(0, 8)}`);
  esperar(informe, 'la llave publicable sola no puede escribir en categorias', await cliente.pedir('POST', '/rest/v1/categorias', { cuerpo: categoriaDirecta, prefer: 'return=minimal' }), {
    estado: HTTP.sinAutenticar,
  });
  esperar(
    informe,
    'la terminal no puede escribir directamente en categorias (RLS sin políticas)',
    await cliente.pedir('POST', '/rest/v1/categorias', { token: terminal.token, cuerpo: categoriaDirecta, prefer: 'return=minimal' }),
    { estado: HTTP.prohibido },
  );

  informe.seccion('Usuarios');
  const admin = randomUUID();
  const sufijo = admin.slice(0, 8);
  const loteAdmin = [cambio('usuarios', 'insertar', filaUsuario(admin, `Admin ${sufijo}`, 'administrativo', 1)), asiento(admin, 'usuario', admin)];
  const alta = await rpc('sincronizar_usuario', loteAdmin, terminal.token);
  esperar(informe, 'la terminal da de alta a un administrador: usuario y asiento', alta, { estado: HTTP.ok, resultados: 'insertada,insertada' });
  const repetida = await rpc('sincronizar_usuario', loteAdmin, terminal.token);
  esperar(informe, 'repetir el MISMO lote de usuario no cambia nada (idempotencia real)', repetida, { estado: HTTP.ok, resultados: 'sin_cambios,ya_existia' });
  informe.comprobar('…y devuelve exactamente las mismas huellas', huellasDe(alta) !== '' && huellasDe(alta) === huellasDe(repetida), `${huellasDe(alta)} vs ${huellasDe(repetida)}`);
  const recibidoEn = filasDe(alta)[0]?.recibido_en;
  informe.comprobar(
    'recibido_en lo puso el servidor con su reloj',
    typeof recibidoEn === 'string' && Math.abs(Date.parse(recibidoEn) - Date.now()) < MARGEN_DEL_RELOJ_MS,
    `recibido_en = ${String(recibidoEn)}`,
  );
  esperar(
    informe,
    'un payload que trae recibido_en se rechaza: esa columna no viaja, la pone el servidor',
    await rpc('sincronizar_usuario', [cambio('usuarios', 'actualizar', { ...filaUsuario(admin, `Admin ${sufijo}`, 'administrativo', 1), recibido_en: '2000-01-01T00:00:00.000Z' }), asiento(admin, 'usuario', admin)], terminal.token),
    { estado: HTTP.peticionInvalida, texto: 'recibido_en' },
  );
  esperar(
    informe,
    'dar de baja al único administrador activo se rechaza (INVARIANTE)',
    await rpc('sincronizar_usuario', [cambio('usuarios', 'actualizar', filaUsuario(admin, `Admin ${sufijo}`, 'administrativo', 0)), asiento(admin, 'usuario', admin)], terminal.token),
    { estado: HTTP.peticionInvalida, texto: 'INVARIANTE' },
  );
  esperar(
    informe,
    'un payload con pin_hash se rechaza nombrando la columna',
    await rpc('sincronizar_usuario', [cambio('usuarios', 'actualizar', { ...filaUsuario(admin, `Admin ${sufijo}`, 'administrativo', 1), pin_hash: 'scrypt$1$…' }), asiento(admin, 'usuario', admin)], terminal.token),
    { estado: HTTP.peticionInvalida, texto: 'pin_hash' },
  );
  esperar(
    informe,
    'un lote de usuario sin su asiento de auditoría se rechaza',
    await rpc('sincronizar_usuario', [cambio('usuarios', 'actualizar', filaUsuario(admin, `Admin ${sufijo}`, 'administrativo', 1))], terminal.token),
    { estado: HTTP.peticionInvalida, texto: 'sin su asiento' },
  );

  informe.seccion('Lote simple: catálogo, topes y configuración');
  const categoria = randomUUID();
  const producto = randomUUID();
  const nombreDelProducto = `Maíz ${sufijo}`;
  esperar(
    informe,
    'alta de una categoría con su asiento',
    await rpc('sincronizar_lote_simple', [cambio('categorias', 'insertar', filaCategoria(categoria, `Granos ${sufijo}`)), asiento(admin, 'categoria', categoria)], terminal.token),
    { estado: HTTP.ok, resultados: 'insertada,insertada' },
  );
  esperar(
    informe,
    'alta de un producto, con los booleanos como 0/1 igual que en SQLite',
    await rpc('sincronizar_lote_simple', [cambio('productos', 'insertar', filaProducto(producto, nombreDelProducto, categoria, '6.69', '100.000', 0, '0.000')), asiento(admin, 'producto', producto)], terminal.token),
    { estado: HTTP.ok, resultados: 'insertada,insertada' },
  );
  const loteCambioDePrecio = [cambio('productos', 'actualizar', filaProducto(producto, nombreDelProducto, categoria, '7.00', '100.000', 0, '0.000')), asiento(admin, 'producto', producto)];
  esperar(informe, 'un cambio de precio actualiza el producto', await rpc('sincronizar_lote_simple', loteCambioDePrecio, terminal.token), { estado: HTTP.ok, resultados: 'actualizada,insertada' });
  esperar(informe, 'repetir el MISMO lote: el producto sin cambios y el asiento no se toca (DO NOTHING)', await rpc('sincronizar_lote_simple', loteCambioDePrecio, terminal.token), {
    estado: HTTP.ok,
    resultados: 'sin_cambios,ya_existia',
  });
  const tope = await rpc(
    'sincronizar_lote_simple',
    [
      cambio('limites_descuento', 'actualizar', { id: ID_TOPE_VENTA, rol: 'venta', descuento_max_porcentaje: '10.00', descuento_max_monto_fijo: '20.00', editado_por: null, creado_en: FECHA, actualizado_en: FECHA }),
      asiento(admin, 'limite_descuento', ID_TOPE_VENTA),
    ],
    terminal.token,
  );
  informe.comprobar(
    'el tope del rol venta entra (insertada, actualizada o sin_cambios, según lo que hubiera)',
    tope.estado === HTTP.ok && ['insertada', 'actualizada', 'sin_cambios'].includes(filasDe(tope)[0]?.resultado),
    `HTTP ${String(tope.estado)} ${resumir(tope.datos)}`,
  );
  esperar(
    informe,
    'la configuración del negocio se actualiza (su única fila ya existe)',
    await rpc('sincronizar_lote_simple', [cambio('configuracion_negocio', 'actualizar', { id: 'unica', nombre_comercial: `Tienda ${sufijo}`, direccion: null, telefono: null, nit: null, actualizado_en: FECHA }), asiento(admin, 'configuracion_negocio', null)], terminal.token),
    { estado: HTTP.ok, resultados: 'actualizada,insertada' },
  );
  esperar(informe, 'ventas NO entra por lote simple: la lista es cerrada', await rpc('sincronizar_lote_simple', [cambio('ventas', 'insertar', filaVenta(randomUUID(), randomUUID(), admin, 'efectivo', null))], terminal.token), {
    estado: HTTP.peticionInvalida,
    texto: 'no se sincroniza como lote simple',
  });
  esperar(informe, 'usuarios NO entra por lote simple: la lista es cerrada', await rpc('sincronizar_lote_simple', [cambio('usuarios', 'actualizar', filaUsuario(admin, `Admin ${sufijo}`, 'administrativo', 1))], terminal.token), {
    estado: HTTP.peticionInvalida,
    texto: 'no se sincroniza como lote simple',
  });
  esperar(
    informe,
    'una segunda fila que no sea de auditoría se rechaza',
    await rpc('sincronizar_lote_simple', [cambio('categorias', 'actualizar', filaCategoria(categoria, `Granos ${sufijo}`)), loteCambioDePrecio[0]], terminal.token),
    { estado: HTTP.peticionInvalida, texto: 'solo van asientos de auditoría' },
  );

  informe.seccion('Caja: apertura y cierre');
  const caja = randomUUID();
  const loteApertura = [cambio('caja_sesiones', 'insertar', filaCaja(caja, admin, '100.00', null)), cambio('caja_sesion_denominaciones', 'insertar', filaDesglose(caja, 'apertura', 20)), asiento(admin, 'caja_sesion', caja)];
  esperar(informe, 'apertura de caja: caja, desglose y asiento', await rpc('sincronizar_apertura_de_caja', loteApertura, terminal.token), { estado: HTTP.ok, resultados: 'insertada,insertada,insertada' });
  esperar(informe, 'repetir la MISMA apertura no cambia nada', await rpc('sincronizar_apertura_de_caja', loteApertura, terminal.token), { estado: HTTP.ok, resultados: 'ya_existia,ya_existia,ya_existia' });
  esperar(
    informe,
    'la misma caja con OTRO monto inicial se rechaza: una apertura no se reescribe',
    await rpc('sincronizar_apertura_de_caja', [cambio('caja_sesiones', 'insertar', filaCaja(caja, admin, '150.00', null)), asiento(admin, 'caja_sesion', caja)], terminal.token),
    { estado: HTTP.peticionInvalida, texto: 'otra apertura' },
  );
  const cierreCuadrado = { esperado: '100.00', real: '100.00', diferencia: '0.00' };
  const loteCierre = [cambio('caja_sesiones', 'actualizar', filaCaja(caja, admin, '100.00', cierreCuadrado)), cambio('caja_sesion_denominaciones', 'insertar', filaDesglose(caja, 'cierre', 20)), asiento(admin, 'caja_sesion', caja)];
  esperar(informe, 'cierre de caja: la única transición, abierta → cerrada', await rpc('sincronizar_cierre_de_caja', loteCierre, terminal.token), { estado: HTTP.ok, resultados: 'actualizada,insertada,insertada' });
  esperar(informe, 'repetir el MISMO cierre no cambia nada', await rpc('sincronizar_cierre_de_caja', loteCierre, terminal.token), { estado: HTTP.ok, resultados: 'sin_cambios,ya_existia,ya_existia' });
  esperar(
    informe,
    'cerrar una caja ya cerrada con OTROS números se rechaza',
    await rpc(
      'sincronizar_cierre_de_caja',
      [cambio('caja_sesiones', 'actualizar', filaCaja(caja, admin, '100.00', { esperado: '100.00', real: '90.00', diferencia: '-10.00', autorizadaPor: admin, via: 'presencial' })), asiento(admin, 'caja_sesion', caja)],
      terminal.token,
    ),
    { estado: HTTP.peticionInvalida, texto: 'otros números' },
  );
  esperar(
    informe,
    'cerrar una caja que la nube no tiene se rechaza',
    await rpc('sincronizar_cierre_de_caja', [cambio('caja_sesiones', 'actualizar', filaCaja(randomUUID(), admin, '100.00', cierreCuadrado)), asiento(admin, 'caja_sesion', caja)], terminal.token),
    { estado: HTTP.peticionInvalida, texto: 'no tiene su apertura' },
  );
  const reabrir = await cliente.pedir('PATCH', `/rest/v1/caja_sesiones?id=eq.${caja}`, { token: terminal.token, cuerpo: { estado: 'abierta' }, prefer: 'return=representation' });
  informe.comprobar('la terminal no puede actualizar caja_sesiones directamente: 0 filas afectadas', reabrir.estado < 300 && JSON.stringify(reabrir.datos) === '[]', `HTTP ${String(reabrir.estado)} ${resumir(reabrir.datos)}`);

  informe.seccion('Venta: todo o nada');
  const caja2 = randomUUID();
  esperar(
    informe,
    'se abre una segunda caja para vender (la primera ya está cerrada)',
    await rpc('sincronizar_apertura_de_caja', [cambio('caja_sesiones', 'insertar', filaCaja(caja2, admin, '50.00', null)), asiento(admin, 'caja_sesion', caja2)], terminal.token),
    { estado: HTTP.ok, resultados: 'insertada,insertada' },
  );
  const venta = randomUUID();
  const loteVenta = [
    cambio('productos', 'actualizar', filaProducto(producto, nombreDelProducto, categoria, '7.00', '97.500', 1, '2.500')),
    cambio('ventas', 'insertar', filaVenta(venta, caja2, admin, 'efectivo', null)),
    cambio('venta_detalle', 'insertar', filaDetalle(venta, producto, nombreDelProducto)),
    asiento(admin, 'venta', venta),
  ];
  esperar(informe, 'una venta entera: producto, venta, detalle y asiento', await rpc('sincronizar_venta', loteVenta, terminal.token), { estado: HTTP.ok, resultados: 'actualizada,insertada,insertada,insertada' });
  esperar(informe, 'repetir la MISMA venta no cambia nada', await rpc('sincronizar_venta', loteVenta, terminal.token), { estado: HTTP.ok, resultados: 'sin_cambios,ya_existia,ya_existia,ya_existia' });
  esperar(informe, 'el detalle antes que la venta se rechaza', await rpc('sincronizar_venta', [loteVenta[0], loteVenta[2], loteVenta[1], loteVenta[3]], terminal.token), {
    estado: HTTP.peticionInvalida,
    texto: 'no puede ir antes que la venta',
  });
  const ventaConBoleta = randomUUID();
  esperar(
    informe,
    'una venta en efectivo CON boleta la rechaza el CHECK de la tabla',
    await rpc(
      'sincronizar_venta',
      [loteVenta[0], cambio('ventas', 'insertar', filaVenta(ventaConBoleta, caja2, admin, 'efectivo', 'B-1')), cambio('venta_detalle', 'insertar', filaDetalle(ventaConBoleta, producto, nombreDelProducto)), asiento(admin, 'venta', ventaConBoleta)],
      terminal.token,
    ),
    { estado: HTTP.peticionInvalida, texto: 'ventas_boleta_solo_con_tarjeta' },
  );
  esperar(
    informe,
    '…y no entró nada de ese lote: el recibo de esa venta no encuentra la venta (se revirtió entera)',
    await rpc('sincronizar_lote_simple', [cambio('recibos', 'insertar', filaRecibo(ventaConBoleta, Date.now()))], terminal.token),
    { estado: HTTP.conflicto, texto: 'recibos_venta_id_fkey' },
  );

  informe.seccion('Recibo');
  const loteRecibo = [cambio('recibos', 'insertar', filaRecibo(venta, Date.now()))];
  esperar(informe, 'el recibo de la venta entra solo, sin asiento', await rpc('sincronizar_lote_simple', loteRecibo, terminal.token), { estado: HTTP.ok, resultados: 'insertada' });
  esperar(informe, 'repetir el MISMO recibo no cambia nada', await rpc('sincronizar_lote_simple', loteRecibo, terminal.token), { estado: HTTP.ok, resultados: 'ya_existia' });
  esperar(informe, 'un recibo con operacion actualizar se rechaza', await rpc('sincronizar_lote_simple', [cambio('recibos', 'actualizar', loteRecibo[0].datos)], terminal.token), {
    estado: HTTP.peticionInvalida,
    texto: 'recibos solo se inserta',
  });
  esperar(
    informe,
    'se cierra la segunda caja',
    await rpc('sincronizar_cierre_de_caja', [cambio('caja_sesiones', 'actualizar', filaCaja(caja2, admin, '50.00', { esperado: '67.50', real: '67.50', diferencia: '0.00' })), asiento(admin, 'caja_sesion', caja2)], terminal.token),
    { estado: HTTP.ok, resultados: 'actualizada,insertada' },
  );

  informe.seccion('Lo que la terminal NO puede leer ni tocar, aunque acabe de escribirlo');
  for (const tabla of ['ventas', 'venta_detalle', 'recibos', 'auditoria_log', 'usuarios', 'caja_sesiones']) {
    const lectura = await cliente.pedir('GET', `/rest/v1/${tabla}?select=id&limit=5`, { token: terminal.token });
    informe.comprobar(
      `la terminal no lee ${tabla} directamente: RLS sin políticas devuelve la lista vacía`,
      lectura.estado === HTTP.ok && Array.isArray(lectura.datos) && lectura.datos.length === 0,
      `HTTP ${String(lectura.estado)} ${resumir(lectura.datos)}`,
    );
  }
  const lecturaAnonima = await cliente.pedir('GET', '/rest/v1/ventas?select=id&limit=5');
  informe.comprobar(
    'la llave publicable sola no lee ventas: lista vacía',
    lecturaAnonima.estado === HTTP.ok && Array.isArray(lecturaAnonima.datos) && lecturaAnonima.datos.length === 0,
    `HTTP ${String(lecturaAnonima.estado)} ${resumir(lecturaAnonima.datos)}`,
  );
  const borrado = await cliente.pedir('DELETE', `/rest/v1/usuarios?id=eq.${admin}`, { token: terminal.token, prefer: 'return=representation' });
  informe.comprobar('la terminal no puede borrar usuarios directamente: 0 filas afectadas', borrado.estado < 300 && JSON.stringify(borrado.datos) === '[]', `HTTP ${String(borrado.estado)} ${resumir(borrado.datos)}`);

  informe.seccion('Auth: la vida del token');
  informe.comprobar(
    `el JWT de la terminal dura ${String(VIDA_DEL_JWT_SEGUNDOS)} s, como pide §1.6 del diseño`,
    terminal.expiraEn === VIDA_DEL_JWT_SEGUNDOS,
    `expires_in = ${String(terminal.expiraEn)} s; exp − iat = ${String(terminal.claims.exp - terminal.claims.iat)} s. Se cambia en el panel de Supabase: Project Settings → JWT Keys → Legacy JWT Secret → «Access token expiry time», en segundos.`,
  );
  informe.observar(`claims del JWT de la terminal: app_metadata.rol = ${String(terminal.claims.app_metadata?.rol)}, is_anonymous = ${String(terminal.claims.is_anonymous)}`);
}

async function correrModoDestructivo(entorno, opciones, informe) {
  exigirVariables(entorno, [...VARIABLES_BASE, ...VARIABLES_DE.terminal, ...VARIABLES_DE.restauracion, ...VARIABLES_DE.sinRol]);

  // EL SEGURO. Antes de crear el cliente, antes de leer la foto, antes de
  // cualquier petición: si el proyecto no es de prueba, no se hace nada más.
  exigirProyectoDePrueba(entorno.POS_NUBE_PROYECTO, entorno.POS_NUBE_URL);

  const foto = leerFoto();
  const version = foto.version_del_contrato;
  const cliente = new ClienteDeNube(entorno.POS_NUBE_URL, entorno.POS_NUBE_LLAVE_PUBLICABLE);
  informe.seccion(`Batería destructiva contra ${entorno.POS_NUBE_PROYECTO} (contrato v${String(version)} según la foto)`);

  if (opciones.reinicioHecho) {
    informe.observar('--reinicio-hecho: no se vacían las tablas; se confía en que ya están vacías');
  } else {
    if (!entorno.POS_NUBE_PRUEBAS_SERVICE_ROLE) {
      throw new Incompleto(
        'Para vaciar las tablas hace falta POS_NUBE_PRUEBAS_SERVICE_ROLE (la service_role del proyecto de PRUEBAS, del panel). ' +
          'Si ya las vaciaste por otra vía, pasá --reinicio-hecho.',
      );
    }
    await vaciarProyectoDePruebas(cliente, entorno.POS_NUBE_PRUEBAS_SERVICE_ROLE, informe);
  }

  const sesiones = {
    terminal: await cliente.iniciarSesion(entorno.POS_NUBE_TERMINAL_CORREO, entorno.POS_NUBE_TERMINAL_CLAVE),
    restauracion: await cliente.iniciarSesion(entorno.POS_NUBE_RESTAURACION_CORREO, entorno.POS_NUBE_RESTAURACION_CLAVE),
    sinRol: await cliente.iniciarSesion(entorno.POS_NUBE_SIN_ROL_CORREO, entorno.POS_NUBE_SIN_ROL_CLAVE),
  };
  await correrBateria(cliente, sesiones, version, informe);
  return informe.cerrar({ proyecto: entorno.POS_NUBE_PROYECTO });
}

async function correrEsperaDeVencimiento(entorno, informe) {
  exigirVariables(entorno, [...VARIABLES_BASE, ...VARIABLES_DE.terminal]);
  const cliente = new ClienteDeNube(entorno.POS_NUBE_URL, entorno.POS_NUBE_LLAVE_PUBLICABLE);
  informe.seccion(`Vencimiento del JWT de la terminal en ${entorno.POS_NUBE_PROYECTO}`);
  const sesion = await cliente.iniciarSesion(entorno.POS_NUBE_TERMINAL_CORREO, entorno.POS_NUBE_TERMINAL_CLAVE);
  informe.comprobar(`el token se emitió para ${String(VIDA_DEL_JWT_SEGUNDOS)} s`, sesion.expiraEn === VIDA_DEL_JWT_SEGUNDOS, `expires_in = ${String(sesion.expiraEn)}`);
  const recienEmitido = await cliente.rpc(FUNCION_DEL_CONTRATO, {}, sesion.token);
  esperar(informe, 'recién emitido, PostgREST acepta el token (contesta 403 por el rol, no 401)', recienEmitido, { estado: HTTP.prohibido });
  const espera = sesion.claims.exp * 1000 - Date.now() + MARGEN_DE_VENCIMIENTO_MS;
  informe.observar(`esperando ${String(Math.round(espera / 1000))} s hasta pasado exp = ${new Date(sesion.claims.exp * 1000).toISOString()}…`);
  await dormir(espera);
  const vencido = await cliente.rpc(FUNCION_DEL_CONTRATO, {}, sesion.token);
  esperar(informe, 'vencido, el MISMO token es rechazado con 401 (JWT expired)', vencido, { estado: HTTP.sinAutenticar, texto: 'expired' });
  return informe.cerrar({ proyecto: entorno.POS_NUBE_PROYECTO, expiraEn: sesion.expiraEn });
}

// ---------------------------------------------------------------------------
// Entrada
// ---------------------------------------------------------------------------

const MODOS = ['--destructivo', '--tomar-foto', '--esperar-vencimiento'];
const BANDERAS = ['--reinicio-hecho'];

function analizarArgumentos(argumentos) {
  const desconocidos = argumentos.filter((a) => !MODOS.includes(a) && !BANDERAS.includes(a));
  if (desconocidos.length > 0) {
    throw new Incompleto(`Argumentos desconocidos: ${desconocidos.join(' ')}. Válidos: ${[...MODOS, ...BANDERAS].join(' ')}`);
  }
  const modos = MODOS.filter((m) => argumentos.includes(m));
  if (modos.length > 1) throw new Incompleto(`Elegí un solo modo: ${modos.join(' ')}`);
  return { modo: modos[0] ?? '--comparar', reinicioHecho: argumentos.includes('--reinicio-hecho') };
}

async function principal(argumentos) {
  const informe = new Informe();
  try {
    const { modo, reinicioHecho } = analizarArgumentos(argumentos);
    const entorno = leerEntorno();
    switch (modo) {
      case '--destructivo':
        return await correrModoDestructivo(entorno, { reinicioHecho }, informe);
      case '--tomar-foto':
        return await correrTomaDeFoto(entorno, informe);
      case '--esperar-vencimiento':
        return await correrEsperaDeVencimiento(entorno, informe);
      default:
        return await correrComparacionDelContrato(entorno, informe);
    }
  } catch (error) {
    if (error instanceof ProyectoNoAdmitido) {
      console.error(`\nSEGURO: ${error.message}`);
      console.log(`${MARCA_INFORME} ${JSON.stringify({ seguro: error.message })}`);
      return CODIGO.seguro;
    }
    if (error instanceof Incompleto) {
      console.error(`\nINCOMPLETO: ${error.message}`);
      console.log(`${MARCA_INFORME} ${JSON.stringify({ incompleto: error.message })}`);
      return CODIGO.incompleto;
    }
    throw error;
  }
}

principal(process.argv.slice(2)).then(
  (codigo) => {
    process.exitCode = codigo;
  },
  (error) => {
    console.error(error);
    process.exitCode = CODIGO.fallo;
  },
);
