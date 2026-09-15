/**
 * La bandeja de salida transaccional: que lo cobrado y lo que falta subir
 * vivan o mueran juntos.
 *
 * ES LA LISTA DE VERIFICACIÓN DE LA FASE 1.a. Cada operación de negocio de la
 * tabla 4.1 de `docs/SINCRONIZACION.md` tiene acá una prueba que dice, sin
 * abrir el código: qué filas deja en `sync_cola`, en qué orden, con qué lote y
 * con qué payload.
 *
 * TRES COSAS SE PRUEBAN, Y LAS TRES HACEN FALTA:
 *
 *   1. **Que encole lo correcto.** Las filas justas, con el lote compartido y
 *      los padres antes que los hijos. Una sola fila de menos es una venta que
 *      nunca va a subir; una de más es un dato que la nube va a rechazar.
 *   2. **Que el payload sea byte a byte lo que quedó en SQLite.** Los decimales
 *      viajan como CADENA canónica —`'2.500'`, nunca `2.5` ni el número 2.5—
 *      porque un `number` de JavaScript no puede representar exactamente todos
 *      los decimales (§5), y porque la forma canónica es la que la nube va a
 *      cotejar.
 *   3. **Que la atomicidad sea real, probada POR FALSIFICACIÓN.** Se rompe la
 *      última fila de la cola a propósito y se comprueba que no queda ni la
 *      venta ni ninguna fila de cola. Una garantía de «todo o nada» que nunca
 *      se vio fallar no prueba nada.
 *
 * Las operaciones se ejecutan con los SERVICIOS REALES, nunca insertando filas
 * a mano: armadas a mano, estas pruebas pasarían con datos que la transacción
 * de verdad nunca habría producido.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from 'better-sqlite3';

import { generarHashDePin } from '@shared/auth';
import { montoACadena } from '@shared/money';
import { NullPrinterProvider } from '@shared/adapters';
import { crearRepositorios, type Repositorios } from '@main/database/repositories';
import { crearBaseMigrada } from '@main/database/__tests__/ayuda-base-de-datos';
import { COLUMNAS_EXCLUIDAS } from '@main/database/bandeja-de-salida';
import { LogTecnicoSilencioso } from '@main/log-tecnico';
import { ServicioDeCaja } from '@main/domain/caja/servicio-de-caja';
import { ServicioDeCategorias } from '@main/domain/catalogo/servicio-de-categorias';
import { ServicioDeProductos } from '@main/domain/catalogo/servicio-de-productos';
import { ServicioDeUsuarios } from '@main/domain/usuarios/servicio-de-usuarios';
import { ServicioDeConfiguracionDeNegocio } from '@main/domain/negocio/servicio-de-configuracion';
import { ServicioDeLimitesDeDescuento } from '@main/domain/venta/servicio-de-limites-de-descuento';
import { ServicioDeRecibos } from '@main/domain/recibo/servicio-de-recibos';
import { ServicioDeVenta } from '@main/domain/venta/servicio-de-venta';

/** Una fila de `sync_cola`, cruda como la devuelve SQLite. */
interface FilaDeCola {
  readonly id: string;
  readonly entidad_tipo: string;
  readonly entidad_id: string;
  readonly operacion: string;
  readonly payload: string;
  readonly creado_en: string;
  readonly sincronizado_en: string | null;
  readonly lote_id: string;
  readonly orden_en_lote: number;
  readonly intentos: number;
  readonly proximo_intento_en: string | null;
  readonly bloqueante: number;
}

let base: Database;
let repos: Repositorios;
let limpiar: () => void;

let caja: ServicioDeCaja;
let venta: ServicioDeVenta;
let categorias: ServicioDeCategorias;
let productos: ServicioDeProductos;
let usuarios: ServicioDeUsuarios;
let negocio: ServicioDeConfiguracionDeNegocio;
let limites: ServicioDeLimitesDeDescuento;
let recibos: ServicioDeRecibos;

let idJimmy: string;
let idCajera: string;
let idCategoria: string;
let idMaiz: string;
let idFrijol: string;

/** Toda la cola, en el orden en que el trabajador la va a leer. */
function cola(): FilaDeCola[] {
  return base
    .prepare('SELECT * FROM sync_cola ORDER BY creado_en, orden_en_lote')
    .all() as FilaDeCola[];
}

/** Las tablas encoladas, en orden. Es la forma más legible de afirmar el lote. */
function tablasEncoladas(): string[] {
  return cola().map((fila) => fila.entidad_tipo);
}

/**
 * Vacía la cola para aislar la operación que se va a medir.
 *
 * El montaje de cada prueba usa los REPOSITORIOS directamente, que no encolan
 * nada, así que en teoría no haría falta. Se hace igual: si mañana el montaje
 * pasara a usar un servicio, la prueba seguiría midiendo solo su operación en
 * vez de empezar a fallar por filas que no le pertenecen.
 */
function vaciarCola(): void {
  base.prepare('DELETE FROM sync_cola').run();
}

/** El payload de una fila de la cola, ya interpretado. */
function payloadDe(fila: FilaDeCola): Record<string, unknown> {
  return JSON.parse(fila.payload) as Record<string, unknown>;
}

/**
 * Comprueba que todas las filas comparten lote y que el orden es 0, 1, 2, …
 *
 * Devuelve el lote, para las pruebas que además quieran afirmar sobre él.
 */
function exigirUnSoloLote(filas: readonly FilaDeCola[]): string {
  expect(filas.length).toBeGreaterThan(0);
  const lote = filas[0]?.lote_id ?? '';
  expect(lote).not.toBe('');
  expect(lote).not.toBe('sin-lote');
  expect(filas.map((fila) => fila.lote_id)).toEqual(filas.map(() => lote));
  expect(filas.map((fila) => fila.orden_en_lote)).toEqual(filas.map((_, indice) => indice));
  return lote;
}

/** La fila viva de una tabla, cruda, para cotejar el payload contra ella. */
function filaGuardada(tabla: string, id: string): Record<string, unknown> {
  return base.prepare(`SELECT * FROM ${tabla} WHERE id = ?`).get(id) as Record<string, unknown>;
}

/** Un producto por peso, creado por repositorio para no ensuciar la cola. */
function sembrarProducto(nombre: string, precio: string, inventario: string): string {
  return repos.productos.crear({
    nombre,
    categoriaId: idCategoria,
    tipoMedida: 'peso',
    unidadPeso: 'lb',
    cantidadPredefinidaIcono: '1',
    precioBase: precio,
    inventarioDisponible: inventario,
  }).id;
}

/** Abre el turno de la cajera con Q500, en modo simple. */
function abrirCajaSimple(): string {
  return caja.abrir(idCajera, { modo: 'simple', monto: '500' }).id;
}

beforeEach(() => {
  const prueba = crearBaseMigrada();
  base = prueba.base;
  limpiar = prueba.limpiar;
  repos = crearRepositorios(base);

  caja = new ServicioDeCaja({
    base,
    cajaSesiones: repos.cajaSesiones,
    denominaciones: repos.denominaciones,
    desglose: repos.desgloseDeCaja,
    ventas: repos.ventas,
    auditoria: repos.auditoria,
  });
  venta = new ServicioDeVenta({
    base,
    ventas: repos.ventas,
    ventaDetalle: repos.ventaDetalle,
    productos: repos.productos,
    preciosEspeciales: repos.preciosEspeciales,
    limitesDescuento: repos.limitesDescuento,
    cajaSesiones: repos.cajaSesiones,
    auditoria: repos.auditoria,
    log: new LogTecnicoSilencioso(),
  });
  categorias = new ServicioDeCategorias({
    base,
    categorias: repos.categorias,
    auditoria: repos.auditoria,
  });
  productos = new ServicioDeProductos({
    base,
    productos: repos.productos,
    categorias: repos.categorias,
    auditoria: repos.auditoria,
    // Estas pruebas no son sobre archivos: sin foto no hay nada que encolar.
    describirFoto: (): null => null,
  });
  usuarios = new ServicioDeUsuarios({
    base,
    usuarios: repos.usuarios,
    auditoria: repos.auditoria,
  });
  negocio = new ServicioDeConfiguracionDeNegocio({
    base,
    configuracion: repos.configuracionNegocio,
    auditoria: repos.auditoria,
  });
  limites = new ServicioDeLimitesDeDescuento({
    base,
    limites: repos.limitesDescuento,
    auditoria: repos.auditoria,
    nombreDeUsuario: (id: string): string | null => repos.usuarios.obtenerPorId(id)?.nombre ?? null,
  });
  recibos = new ServicioDeRecibos({
    base,
    ventas: repos.ventas,
    ventaDetalle: repos.ventaDetalle,
    recibos: repos.recibos,
    usuarios: repos.usuarios,
    configuracion: repos.configuracionNegocio,
    impresora: new NullPrinterProvider(),
    log: new LogTecnicoSilencioso(),
    carpetaDeDatos: '/datos',
    generarPdf: (): Promise<void> => Promise.resolve(),
  });

  idJimmy = repos.usuarios.crear({
    nombre: 'Jimmy',
    rol: 'administrativo',
    pinHash: generarHashDePin('2468'),
  }).id;
  idCajera = repos.usuarios.crear({
    nombre: 'Ana',
    rol: 'venta',
    pinHash: generarHashDePin('1357'),
  }).id;

  idCategoria = repos.categorias.crear({ nombre: 'Granos', orden: 1 }).id;
  idMaiz = sembrarProducto('Maíz blanco', '6.69', '100');
  idFrijol = sembrarProducto('Frijol negro', '9.25', '80');

  vaciarCola();
});

afterEach(() => {
  limpiar();
});

// ===========================================================================
// La premisa del diseño: la cola tiene que sobrevivir a un corte de energía
// ===========================================================================

describe('La conexión está configurada como el diseño de sincronización asume', () => {
  it('PRAGMA synchronous es FULL (2), no NORMAL: la cola sobrevive un corte de energía', () => {
    expect(base.pragma('synchronous', { simple: true })).toBe(2);
  });

  it('PRAGMA journal_mode es WAL', () => {
    expect(base.pragma('journal_mode', { simple: true })).toBe('wal');
  });
});

// ===========================================================================
// Una prueba por operación de negocio de la tabla 4.1
// ===========================================================================

describe('Registrar una venta encola su lote completo, padres antes que hijos', () => {
  it('deja productos, la venta, su detalle y la auditoría, en ese orden y en UN solo lote', () => {
    const sesion = abrirCajaSimple();
    vaciarCola();

    const resultado = venta.registrar(idCajera, 'venta', {
      lineas: [
        { productoId: idMaiz, cantidad: '2.5' },
        { productoId: idFrijol, cantidad: '1' },
      ],
      descuento: null,
      formaPago: 'efectivo',
      numBoleta: null,
    });

    expect(tablasEncoladas()).toEqual([
      'productos',
      'productos',
      'ventas',
      'venta_detalle',
      'venta_detalle',
      'auditoria_log',
    ]);
    exigirUnSoloLote(cola());

    // La venta encolada es la que se acaba de cobrar, no otra.
    const filaDeVenta = cola().find((fila) => fila.entidad_tipo === 'ventas');
    expect(filaDeVenta?.entidad_id).toBe(resultado.venta.id);
    expect(filaDeVenta?.operacion).toBe('insertar');
    expect(sesion).toBe(payloadDe(filaDeVenta!).caja_sesion_id);
  });

  it('los productos van como «actualizar»: la venta les movió el saldo, no los creó', () => {
    abrirCajaSimple();
    vaciarCola();

    venta.registrar(idCajera, 'venta', {
      lineas: [{ productoId: idMaiz, cantidad: '2.5' }],
      descuento: null,
      formaPago: 'efectivo',
      numBoleta: null,
    });

    const deProductos = cola().filter((fila) => fila.entidad_tipo === 'productos');
    expect(deProductos.map((fila) => fila.operacion)).toEqual(['actualizar']);
    expect(deProductos[0]?.entidad_id).toBe(idMaiz);
  });

  it('una venta con descuento autorizado encola DOS asientos de auditoría, no uno', () => {
    abrirCajaSimple();
    vaciarCola();

    venta.registrar(idCajera, 'venta', {
      lineas: [{ productoId: idMaiz, cantidad: '2' }],
      descuento: {
        tipo: 'porcentaje',
        valor: '30',
        autorizacion: { autorizadoPor: idJimmy, via: 'presencial' },
      },
      formaPago: 'efectivo',
      numBoleta: null,
    });

    // Son dos hechos distintos con dos responsables distintos (§4.13, paso 7).
    expect(tablasEncoladas()).toEqual([
      'productos',
      'ventas',
      'venta_detalle',
      'auditoria_log',
      'auditoria_log',
    ]);
    exigirUnSoloLote(cola());
  });
});

describe('Abrir y cerrar la caja encolan la sesión, su desglose y la auditoría', () => {
  /** Un arqueo detallado de dos denominaciones, con el monto que suman. */
  function desgloseDeDos(): { modo: 'detallado'; lineas: { denominacionId: string; cantidad: number }[] } {
    const activas = repos.denominaciones.listarActivas();
    const cien = activas.find((d) => montoACadena(d.valor) === '100.00');
    const veinte = activas.find((d) => montoACadena(d.valor) === '20.00');
    return {
      modo: 'detallado',
      lineas: [
        { denominacionId: cien?.id ?? '', cantidad: 4 },
        { denominacionId: veinte?.id ?? '', cantidad: 5 },
      ],
    };
  }

  it('abrir en modo detallado encola caja_sesiones, sus DOS líneas de desglose y la auditoría', () => {
    const sesion = caja.abrir(idCajera, desgloseDeDos());

    expect(tablasEncoladas()).toEqual([
      'caja_sesiones',
      'caja_sesion_denominaciones',
      'caja_sesion_denominaciones',
      'auditoria_log',
    ]);
    exigirUnSoloLote(cola());

    expect(cola()[0]?.entidad_id).toBe(sesion.id);
    expect(cola()[0]?.operacion).toBe('insertar');
  });

  it('cerrar encola la sesión como «actualizar», porque el cierre no la creó', () => {
    const sesion = caja.abrir(idCajera, { modo: 'simple', monto: '500' });
    vaciarCola();

    const resultado = caja.intentarCerrar(
      sesion.id,
      { modo: 'simple', monto: '500' },
      { usuarioQueCierra: idCajera },
    );

    expect(resultado.cerrada).toBe(true);
    expect(tablasEncoladas()).toEqual(['caja_sesiones', 'auditoria_log']);
    expect(cola()[0]?.operacion).toBe('actualizar');
    exigirUnSoloLote(cola());
  });

  it('el desglose de la APERTURA no se vuelve a encolar al cerrar', () => {
    const sesion = caja.abrir(idCajera, desgloseDeDos());
    vaciarCola();

    caja.intentarCerrar(sesion.id, { modo: 'simple', monto: '500' }, { usuarioQueCierra: idCajera });

    // Solo la sesión y el asiento: el desglose de apertura ya viajó en su lote.
    expect(tablasEncoladas()).toEqual(['caja_sesiones', 'auditoria_log']);
  });

  it('cerrar en modo detallado SÍ encola las líneas del cierre', () => {
    const sesion = caja.abrir(idCajera, { modo: 'simple', monto: '500' });
    vaciarCola();

    caja.intentarCerrar(sesion.id, desgloseDeDos(), {
      usuarioQueCierra: idCajera,
      autorizacion: { autorizadaPor: idJimmy, via: 'presencial' },
    });

    expect(tablasEncoladas()).toEqual([
      'caja_sesiones',
      'caja_sesion_denominaciones',
      'caja_sesion_denominaciones',
      'auditoria_log',
    ]);
    exigirUnSoloLote(cola());
  });

  it('denominaciones NUNCA se encola: las once del quetzal ya viven en la nube', () => {
    caja.abrir(idCajera, desgloseDeDos());
    expect(tablasEncoladas()).not.toContain('denominaciones');
  });
});

describe('Gestión de usuarios: la fila del usuario antes que su asiento', () => {
  it('crear un usuario encola usuarios y auditoría', () => {
    const creado = usuarios.crear(idJimmy, { nombre: 'Pedro', rol: 'venta', pin: '4321' });

    expect(tablasEncoladas()).toEqual(['usuarios', 'auditoria_log']);
    expect(cola()[0]?.entidad_id).toBe(creado.id);
    expect(cola()[0]?.operacion).toBe('insertar');
    exigirUnSoloLote(cola());
  });

  it('editar encola usuarios como «actualizar»', () => {
    const creado = usuarios.crear(idJimmy, { nombre: 'Pedro', rol: 'venta', pin: '4321' });
    vaciarCola();

    usuarios.editar(idJimmy, creado.id, { nombre: 'Pedro Cano', rol: 'venta' });

    expect(tablasEncoladas()).toEqual(['usuarios', 'auditoria_log']);
    expect(cola()[0]?.operacion).toBe('actualizar');
  });

  it('cambiar el PIN encola la fila, y el PIN nuevo NO viaja en el payload', () => {
    const creado = usuarios.crear(idJimmy, { nombre: 'Pedro', rol: 'venta', pin: '4321' });
    vaciarCola();

    usuarios.cambiarPin(idJimmy, creado.id, '8765');

    expect(tablasEncoladas()).toEqual(['usuarios', 'auditoria_log']);
    const payload = JSON.stringify(cola().map(payloadDe));
    expect(payload).not.toContain('8765');
    expect(payload).not.toContain('scrypt$');
  });

  it('dar de baja encola usuarios como «actualizar»: nunca se borra a nadie', () => {
    const creado = usuarios.crear(idJimmy, { nombre: 'Pedro', rol: 'venta', pin: '4321' });
    vaciarCola();

    usuarios.fijarActivo(idJimmy, creado.id, false);

    expect(tablasEncoladas()).toEqual(['usuarios', 'auditoria_log']);
    expect(cola()[0]?.operacion).toBe('actualizar');
    expect(payloadDe(cola()[0]!).activo).toBe(0);
  });
});

describe('Catálogo: categorías y productos encolan su fila y su asiento', () => {
  it('crear una categoría encola categorias y auditoría', () => {
    const creada = categorias.crear(idJimmy, { nombre: 'Fertilizantes', orden: 2 });

    expect(tablasEncoladas()).toEqual(['categorias', 'auditoria_log']);
    expect(cola()[0]?.entidad_id).toBe(creada.id);
    expect(cola()[0]?.operacion).toBe('insertar');
    exigirUnSoloLote(cola());
  });

  it('editar y desactivar una categoría encolan «actualizar»', () => {
    const creada = categorias.crear(idJimmy, { nombre: 'Fertilizantes', orden: 2 });
    vaciarCola();

    categorias.editar(idJimmy, creada.id, { nombre: 'Abonos', orden: 2 });
    expect(cola().map((fila) => `${fila.entidad_tipo}:${fila.operacion}`)).toEqual([
      'categorias:actualizar',
      'auditoria_log:insertar',
    ]);

    vaciarCola();
    categorias.fijarActivo(idJimmy, creada.id, false);
    expect(cola().map((fila) => `${fila.entidad_tipo}:${fila.operacion}`)).toEqual([
      'categorias:actualizar',
      'auditoria_log:insertar',
    ]);
  });

  it('crear un producto encola productos y auditoría', () => {
    const creado = productos.crear(idJimmy, {
      nombre: 'Azúcar blanca',
      categoriaId: idCategoria,
      tipoMedida: 'peso',
      unidadPeso: 'lb',
      cantidadPredefinidaIcono: '1',
      precioBase: '4.50',
      fotoPath: null,
      inventarioInicial: '40',
    });

    expect(tablasEncoladas()).toEqual(['productos', 'auditoria_log']);
    expect(cola()[0]?.entidad_id).toBe(creado.id);
    exigirUnSoloLote(cola());
  });

  it('el ajuste de inventario encola productos como «actualizar»', () => {
    productos.ajustarInventario(idJimmy, {
      productoId: idMaiz,
      cantidad: '50',
      motivo: 'compra a proveedor',
    });

    expect(tablasEncoladas()).toEqual(['productos', 'auditoria_log']);
    expect(cola()[0]?.operacion).toBe('actualizar');
    expect(payloadDe(cola()[0]!).inventario_disponible).toBe('150.000');
  });
});

describe('Configuración del negocio y topes de descuento', () => {
  it('guardar la configuración encola «actualizar»: la fila nace con la migración, nunca se inserta', () => {
    negocio.guardar(idJimmy, {
      nombreComercial: 'Agroservicio Cano',
      direccion: 'Zona 1',
      telefono: '55551234',
      nit: '1234567-8',
    });

    expect(tablasEncoladas()).toEqual(['configuracion_negocio', 'auditoria_log']);
    expect(cola()[0]?.operacion).toBe('actualizar');
    expect(cola()[0]?.entidad_id).toBe('unica');
    exigirUnSoloLote(cola());
  });

  it('fijar un tope encola «insertar» la primera vez y «actualizar» la segunda', () => {
    limites.fijar(idJimmy, { rol: 'venta', porcentaje: '10', montoFijo: '20' });
    expect(cola().map((fila) => `${fila.entidad_tipo}:${fila.operacion}`)).toEqual([
      'limites_descuento:insertar',
      'auditoria_log:insertar',
    ]);

    vaciarCola();
    limites.fijar(idJimmy, { rol: 'venta', porcentaje: '15', montoFijo: '25' });
    expect(cola().map((fila) => `${fila.entidad_tipo}:${fila.operacion}`)).toEqual([
      'limites_descuento:actualizar',
      'auditoria_log:insertar',
    ]);
  });
});

describe('El recibo se encola UNA vez, al emitirse, y nunca más', () => {
  /** Cobra una venta y devuelve su id, con la cola ya vaciada. */
  function cobrar(): string {
    abrirCajaSimple();
    const resultado = venta.registrar(idCajera, 'venta', {
      lineas: [{ productoId: idMaiz, cantidad: '2' }],
      descuento: null,
      formaPago: 'efectivo',
      numBoleta: null,
    });
    vaciarCola();
    return resultado.venta.id;
  }

  it('emitir encola UNA sola fila de recibos, en su propio lote', async () => {
    const ventaId = cobrar();

    const emitido = await recibos.emitir(ventaId);

    expect(tablasEncoladas()).toEqual(['recibos']);
    expect(cola()[0]?.entidad_id).toBe(emitido.recibo.id);
    expect(cola()[0]?.operacion).toBe('insertar');
    exigirUnSoloLote(cola());
  });

  it('los cambios posteriores de impreso y pdf_path NO se encolan', async () => {
    const ventaId = cobrar();

    await recibos.emitir(ventaId);
    // La emisión ya marcó `impreso` y escribió `pdf_path` DESPUÉS de la
    // transacción. Si esos UPDATE se encolaran, acá habría más de una fila.
    expect(cola()).toHaveLength(1);

    vaciarCola();
    await recibos.emitir(ventaId);
    expect(cola()).toHaveLength(0);
  });

  it('no se encola ningún archivo: ni el PDF del recibo ni la foto del producto', async () => {
    const ventaId = cobrar();
    await recibos.emitir(ventaId);

    // Los PDF no se suben (§2.5.3). Lo que viaja es la RUTA, como dato de la
    // fila, y desde la migración 030 es RELATIVA a la carpeta de datos: la
    // absoluta de este disco no significaría nada en la máquina que restaure.
    expect(tablasEncoladas()).not.toContain('archivo_pdf');
    expect(tablasEncoladas()).not.toContain('archivo_foto');
    const pdfPath = payloadDe(cola()[0]!).pdf_path;
    expect(pdfPath).toMatch(/^recibos\/recibo-000001-.*\.pdf$/);
    expect(pdfPath).not.toContain('/datos');
  });
});

// ===========================================================================
// Qué NO viaja
// ===========================================================================

describe('Las columnas excluidas no salen de esta terminal', () => {
  it('el payload de usuarios no lleva pin_hash, el secreto de TOTP, su último paso, intentos_fallidos ni bloqueado_hasta', () => {
    const creado = usuarios.crear(idJimmy, { nombre: 'Pedro', rol: 'venta', pin: '4321' });

    const fila = cola().find((f) => f.entidad_tipo === 'usuarios')!;
    const payload = payloadDe(fila);

    for (const columna of COLUMNAS_EXCLUIDAS.usuarios ?? []) {
      expect(Object.keys(payload)).not.toContain(columna);
    }
    // Y lo que sí tiene que viajar, viaja.
    expect(payload.id).toBe(creado.id);
    expect(payload.nombre).toBe('Pedro');
    expect(payload.rol).toBe('venta');
  });

  it('la lista de exclusiones de usuarios es exactamente la de la decisión 17, más las locales y las dos de TOTP (migración 036)', () => {
    expect(COLUMNAS_EXCLUIDAS.usuarios).toEqual([
      'intentos_fallidos',
      'bloqueado_hasta',
      'pin_hash',
      'totp_secreto_cifrado',
      'totp_ultimo_paso',
    ]);
  });

  it('el payload de ventas no lleva estado_sincronizacion', () => {
    abrirCajaSimple();
    vaciarCola();

    venta.registrar(idCajera, 'venta', {
      lineas: [{ productoId: idMaiz, cantidad: '1' }],
      descuento: null,
      formaPago: 'efectivo',
      numBoleta: null,
    });

    const fila = cola().find((f) => f.entidad_tipo === 'ventas')!;
    expect(Object.keys(payloadDe(fila))).not.toContain('estado_sincronizacion');
    // La columna SÍ existe en la fila guardada: se excluye al encolar, no se
    // dejó de escribir.
    expect(Object.keys(filaGuardada('ventas', fila.entidad_id))).toContain(
      'estado_sincronizacion',
    );
  });

  it('ninguna tabla local se encola nunca: sync_cola, bloqueos ni migraciones', () => {
    abrirCajaSimple();
    usuarios.crear(idJimmy, { nombre: 'Pedro', rol: 'venta', pin: '4321' });
    categorias.crear(idJimmy, { nombre: 'Fertilizantes', orden: 2 });

    for (const local of ['sync_cola', 'bloqueos_de_autorizacion', 'migraciones_aplicadas']) {
      expect(tablasEncoladas()).not.toContain(local);
    }
  });
});

// ===========================================================================
// El payload es byte a byte lo que quedó en SQLite
// ===========================================================================

describe('Los decimales viajan como CADENA canónica, nunca como número', () => {
  it('una venta con precio especial y descuento autorizado conserva el detalle BYTE A BYTE', () => {
    // Precio especial vigente hoy: la línea no se cobra al precio de lista.
    repos.preciosEspeciales.crear({
      productoId: idMaiz,
      tipo: 'porcentaje',
      valor: '10',
      vigenteDesde: '2020-01-01T00:00:00.000Z',
      vigenteHasta: null,
    });

    abrirCajaSimple();
    vaciarCola();

    // Sin fila en `limites_descuento` el tope es CERO, así que cualquier
    // descuento exige autorización: es el caso de §4.13 con las dos cosas
    // encima, precio especial y descuento excedente.
    venta.registrar(idCajera, 'venta', {
      lineas: [
        { productoId: idMaiz, cantidad: '0.333' },
        { productoId: idFrijol, cantidad: '2.5' },
      ],
      descuento: {
        tipo: 'porcentaje',
        valor: '7.5',
        autorizacion: { autorizadoPor: idJimmy, via: 'presencial' },
      },
      formaPago: 'efectivo',
      numBoleta: null,
    });

    const filasDeDetalle = cola().filter((fila) => fila.entidad_tipo === 'venta_detalle');
    expect(filasDeDetalle).toHaveLength(2);

    for (const fila of filasDeDetalle) {
      const payload = payloadDe(fila);
      const guardada = filaGuardada('venta_detalle', fila.entidad_id);

      // BYTE A BYTE: no «el mismo número», la misma CADENA. Un `2.5` donde la
      // base tiene `2.500` sería un payload distinto del dato guardado.
      expect(payload.subtotal_impreso).toBe(guardada.subtotal_impreso);
      expect(payload.precio_unitario_snap).toBe(guardada.precio_unitario_snap);
      expect(payload.subtotal_exacto).toBe(guardada.subtotal_exacto);
      expect(payload.cantidad).toBe(guardada.cantidad);

      // Y son cadenas, no números de JavaScript.
      expect(typeof payload.subtotal_impreso).toBe('string');
      expect(typeof payload.precio_unitario_snap).toBe('string');
      expect(typeof payload.cantidad).toBe('string');

      // Con la forma canónica que el CHECK del esquema exige.
      expect(payload.subtotal_impreso).toMatch(/^-?\d+\.\d{2}$/);
      expect(payload.cantidad).toMatch(/^-?\d+\.\d{3}$/);
    }

    /*
      El precio especial SÍ quedó en la foto: `precio_unitario_snap` guarda el
      precio EFECTIVO por libra al momento de vender —6.69 menos 10 % da 6.021,
      que redondea a 6.02—, no el precio de lista del catálogo. El payload lleva
      esa misma cadena porque la lee de la base, sin recalcular: si se
      reconstruyera desde la entidad, bastaría equivocarse de conversión para
      mandar a la nube un precio que nadie cobró.
    */
    const delMaiz = filasDeDetalle.find(
      (fila) => payloadDe(fila).producto_id === idMaiz,
    )!;
    expect(payloadDe(delMaiz).precio_unitario_snap).toBe('6.02');
    expect(filaGuardada('productos', idMaiz).precio_base).toBe('6.69');
  });

  it('la cabecera de la venta conserva subtotal, descuento y total tal cual se guardaron', () => {
    abrirCajaSimple();
    vaciarCola();

    venta.registrar(idCajera, 'venta', {
      lineas: [{ productoId: idMaiz, cantidad: '3' }],
      descuento: {
        tipo: 'monto_fijo',
        valor: '1.55',
        autorizacion: { autorizadoPor: idJimmy, via: 'presencial' },
      },
      formaPago: 'efectivo',
      numBoleta: null,
    });

    const fila = cola().find((f) => f.entidad_tipo === 'ventas')!;
    const payload = payloadDe(fila);
    const guardada = filaGuardada('ventas', fila.entidad_id);

    expect(payload.subtotal).toBe(guardada.subtotal);
    expect(payload.descuento_valor).toBe(guardada.descuento_valor);
    expect(payload.total).toBe(guardada.total);
    expect(payload.descuento_autorizado_por).toBe(idJimmy);
    expect(payload.descuento_autorizado_via).toBe('presencial');
  });

  it('en TODO el payload de un lote, ninguna columna decimal viaja como número', () => {
    abrirCajaSimple();
    productos.ajustarInventario(idJimmy, { productoId: idMaiz, cantidad: '12.5' });
    venta.registrar(idCajera, 'venta', {
      lineas: [{ productoId: idMaiz, cantidad: '2.25' }],
      descuento: null,
      formaPago: 'efectivo',
      numBoleta: null,
    });
    limites.fijar(idJimmy, { rol: 'venta', porcentaje: '10', montoFijo: '20' });

    const DECIMALES = [
      'monto_inicial',
      'monto_esperado',
      'monto_real',
      'diferencia',
      'precio_base',
      'inventario_disponible',
      'cantidad_vendida',
      'cantidad_predefinida_icono',
      'subtotal',
      'descuento_valor',
      'total',
      'cantidad',
      'precio_unitario_snap',
      'subtotal_exacto',
      'subtotal_impreso',
      'descuento_max_porcentaje',
      'descuento_max_monto_fijo',
      'valor',
    ];

    let comprobadas = 0;
    for (const fila of cola()) {
      const payload = payloadDe(fila);
      for (const columna of DECIMALES) {
        if (payload[columna] === undefined || payload[columna] === null) {
          continue;
        }
        expect(`${fila.entidad_tipo}.${columna} = ${typeof payload[columna]}`).toBe(
          `${fila.entidad_tipo}.${columna} = string`,
        );
        comprobadas += 1;
      }
    }
    // Que la prueba haya mirado algo de verdad, y no cero columnas.
    expect(comprobadas).toBeGreaterThan(10);
  });

  it('los booleanos viajan como 0 y 1, tal como los guarda SQLite', () => {
    const creada = categorias.crear(idJimmy, { nombre: 'Fertilizantes', orden: 2 });
    expect(payloadDe(cola()[0]!).activo).toBe(1);

    vaciarCola();
    categorias.fijarActivo(idJimmy, creada.id, false);
    expect(payloadDe(cola()[0]!).activo).toBe(0);
  });
});

// ===========================================================================
// Atomicidad, probada POR FALSIFICACIÓN
// ===========================================================================

describe('Atomicidad: si la última fila de la cola falla, no queda NADA', () => {
  /**
   * Rompe a propósito la última fila del lote de una venta.
   *
   * El disparador aborta el `INSERT` de la entrada de `auditoria_log`, que es
   * la ÚLTIMA del lote de una venta: para cuando muerde, la venta, su detalle
   * y el descuento de inventario ya están escritos y las otras filas de cola
   * ya entraron. Es exactamente el momento que interesa: después de escribir
   * la venta y antes del COMMIT.
   */
  function romperLaUltimaFilaDeLaCola(): void {
    base.exec(`
      CREATE TRIGGER prueba_falsifica_fallo_de_cola
      BEFORE INSERT ON sync_cola
      WHEN NEW.entidad_tipo = 'auditoria_log'
      BEGIN
        SELECT RAISE(ABORT, 'fallo falsificado en la ultima fila del lote');
      END;
    `);
  }

  /** Cuántas filas hay en una tabla. */
  function contar(tabla: string): number {
    const fila = base.prepare(`SELECT COUNT(*) AS n FROM ${tabla}`).get() as { n: number };
    return fila.n;
  }

  it('la venta se registra normalmente mientras la cola no falle (la prueba mide algo)', () => {
    abrirCajaSimple();

    venta.registrar(idCajera, 'venta', {
      lineas: [{ productoId: idMaiz, cantidad: '2.5' }],
      descuento: null,
      formaPago: 'efectivo',
      numBoleta: null,
    });

    expect(contar('ventas')).toBe(1);
    expect(contar('venta_detalle')).toBe(1);
    expect(cola().length).toBe(6);
  });

  it('si falla la ÚLTIMA fila del lote, no queda la venta, ni el detalle, ni una sola fila de cola', () => {
    abrirCajaSimple();
    vaciarCola();
    const asientosAntes = contar('auditoria_log');
    const inventarioAntes = filaGuardada('productos', idMaiz).inventario_disponible;

    romperLaUltimaFilaDeLaCola();

    expect(() =>
      venta.registrar(idCajera, 'venta', {
        lineas: [{ productoId: idMaiz, cantidad: '2.5' }],
        descuento: null,
        formaPago: 'efectivo',
        numBoleta: null,
      }),
    ).toThrow(/fallo falsificado/);

    expect(contar('ventas')).toBe(0);
    expect(contar('venta_detalle')).toBe(0);
    expect(cola()).toHaveLength(0);
    expect(contar('auditoria_log')).toBe(asientosAntes);
    // Y el inventario volvió a donde estaba: el descuento también se revirtió.
    expect(filaGuardada('productos', idMaiz).inventario_disponible).toBe(inventarioAntes);
  });

  it('lo mismo al abrir la caja: falla la cola y no queda ni la sesión ni su desglose', () => {
    romperLaUltimaFilaDeLaCola();

    expect(() => caja.abrir(idCajera, { modo: 'simple', monto: '500' })).toThrow(
      /fallo falsificado/,
    );

    expect(contar('caja_sesiones')).toBe(0);
    expect(contar('caja_sesion_denominaciones')).toBe(0);
    expect(cola()).toHaveLength(0);
  });

  it('lo mismo al crear un usuario: no queda el usuario ni su asiento', () => {
    const usuariosAntes = contar('usuarios');
    romperLaUltimaFilaDeLaCola();

    expect(() =>
      usuarios.crear(idJimmy, { nombre: 'Pedro', rol: 'venta', pin: '4321' }),
    ).toThrow(/fallo falsificado/);

    expect(contar('usuarios')).toBe(usuariosAntes);
    expect(cola()).toHaveLength(0);
  });

  it('un CHECK REAL de sync_cola también revierte el dato de negocio', () => {
    const antes = contar('categorias');

    // No es un disparador: es el CHECK `sync_cola_bloqueante_booleano` de la
    // migración 018, mordiendo dentro de una transacción que ya escribió una
    // categoría. Si el CHECK no mordiera, o si la transacción no envolviera
    // las dos escrituras, la categoría quedaría.
    const escribirYRomper = base.transaction((): void => {
      base
        .prepare(
          `INSERT INTO categorias (id, nombre, orden, activo, creado_en, actualizado_en)
           VALUES ('99999999-9999-4999-8999-999999999999', 'Rompe', 9, 1, ?, ?)`,
        )
        .run('2026-09-11T00:00:00.000Z', '2026-09-11T00:00:00.000Z');

      base
        .prepare(
          `INSERT INTO sync_cola (
             id, entidad_tipo, entidad_id, operacion, payload, creado_en,
             lote_id, orden_en_lote, intentos, bloqueante
           ) VALUES (?, 'categorias', ?, 'insertar', '{}', ?, 'lote-de-prueba', 0, 0, 2)`,
        )
        .run(
          '88888888-8888-4888-8888-888888888888',
          '99999999-9999-4999-8999-999999999999',
          '2026-09-11T00:00:00.000Z',
        );
    });

    expect(() => {
      escribirYRomper();
    }).toThrow(/sync_cola_bloqueante_booleano/);

    expect(contar('categorias')).toBe(antes);
    expect(cola()).toHaveLength(0);
  });
});

// ===========================================================================
// Las cinco columnas de la migración 018
// ===========================================================================

describe('Las filas nacen con los valores que el trabajador espera', () => {
  it('intentos en 0, proximo_intento_en en NULL, bloqueante en 0 y sin sincronizar', () => {
    categorias.crear(idJimmy, { nombre: 'Fertilizantes', orden: 2 });

    for (const fila of cola()) {
      expect(fila.intentos).toBe(0);
      expect(fila.proximo_intento_en).toBeNull();
      expect(fila.bloqueante).toBe(0);
      expect(fila.sincronizado_en).toBeNull();
    }
  });

  it('dos operaciones seguidas NO comparten lote: son dos unidades de trabajo', () => {
    categorias.crear(idJimmy, { nombre: 'Fertilizantes', orden: 2 });
    const primero = cola()[0]?.lote_id;

    categorias.crear(idJimmy, { nombre: 'Semillas', orden: 3 });
    const lotes = new Set(cola().map((fila) => fila.lote_id));

    expect(lotes.size).toBe(2);
    expect(lotes).toContain(primero);
  });

  it('el índice de pendientes existe y ordena por creado_en y orden_en_lote', () => {
    const indice = base
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?")
      .get('idx_sync_cola_pendientes') as { sql: string } | undefined;

    expect(indice?.sql).toContain('creado_en');
    expect(indice?.sql).toContain('orden_en_lote');
    expect(indice?.sql).toContain('sincronizado_en IS NULL');
  });
});
