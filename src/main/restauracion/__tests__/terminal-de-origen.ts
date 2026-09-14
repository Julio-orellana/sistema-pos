/**
 * Una TERMINAL DE ORIGEN realista, llenada con los servicios de verdad.
 *
 * Es lo que la nube «tenía» antes de que la terminal se perdiera, y lo que la
 * restauración tiene que reconstruir. La usan las pruebas del servicio (sobre
 * la nube de mentira) y el arnés contra `pos-pruebas-descartable` (subiendo
 * de verdad). Trae, a propósito, cada caso que el diseño nombra:
 *
 *   · dos usuarios, y uno BLOQUEADO por intentos fallidos, con sus asientos
 *     sueltos (los de `sincronizar_asiento`, sin fila hermana);
 *   · un catálogo con un producto CON foto, uno cuya foto ya no está en la
 *     nube, y uno sin foto;
 *   · el caso combinado de §4.13: una venta con precio especial vigente y un
 *     descuento que excede el tope del rol, autorizado por el administrador;
 *   · una segunda venta con tarjeta y boleta;
 *   · un tope de descuento con su id FIJO por rol (028 / 0028);
 *   · una caja CERRADA con diferencia autorizada y arqueo por denominaciones,
 *     y otra que queda ABIERTA;
 *   · los datos del negocio.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Database } from 'better-sqlite3';

import { generarHashDePin } from '@shared/auth';
import { NullPrinterProvider } from '@shared/adapters/receipt-printer';
import { crearRepositorios, type Repositorios } from '@main/database/repositories';
import type { ArchivoParaSubir } from '@main/database/bandeja-de-salida';
import { ServicioDeAutenticacion } from '@main/domain/usuarios/autenticacion';
import { ServicioDeUsuarios } from '@main/domain/usuarios/servicio-de-usuarios';
import { ServicioDeCaja } from '@main/domain/caja/servicio-de-caja';
import { ServicioDeCategorias } from '@main/domain/catalogo/servicio-de-categorias';
import { ServicioDeProductos } from '@main/domain/catalogo/servicio-de-productos';
import { AlmacenDeFotos } from '@main/domain/catalogo/almacen-de-fotos';
import { ServicioDeConfiguracionDeNegocio } from '@main/domain/negocio/servicio-de-configuracion';
import { ServicioDeLimitesDeDescuento } from '@main/domain/venta/servicio-de-limites-de-descuento';
import { ServicioDeVenta } from '@main/domain/venta/servicio-de-venta';
import { ServicioDeRecibos } from '@main/domain/recibo/servicio-de-recibos';
import { LogTecnicoSilencioso } from '@main/log-tecnico';

/** Los PIN de la terminal de origen. Ninguno tiene que servir después de restaurar. */
export const PIN_DE_JIMMY = '2468';
export const PIN_DE_ANA = '1357';

/** Un PNG de un píxel, válido, para que la firma binaria pase. */
export const PNG_DE_UN_PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

/** Un PNG distinto, para que las dos fotos no sean el mismo archivo. */
export const PNG_DE_OTRO_PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
  'base64',
);

export interface TerminalDeOrigen {
  readonly repos: Repositorios;
  readonly ids: {
    readonly jimmy: string;
    readonly ana: string;
    readonly categoria: string;
    readonly maiz: string;
    readonly huevos: string;
    readonly frijol: string;
    readonly cajaCerrada: string;
    readonly cajaAbierta: string;
    readonly ventaCombinada: string;
    readonly ventaConTarjeta: string;
    readonly reciboCombinado: string;
    readonly reciboConTarjeta: string;
  };
  /** Ruta relativa de la foto del maíz, y sus bytes. */
  readonly fotoDelMaiz: { readonly rutaRelativa: string; readonly objeto: string; readonly bytes: Buffer };
  /** Ruta relativa de la foto de los huevos: la fila la tiene, la nube no. */
  readonly fotoDeLosHuevos: { readonly rutaRelativa: string; readonly objeto: string };
  /** Los PDF que la terminal de origen escribió, absolutos. */
  readonly rutasDePdf: readonly string[];
}

/** Llena `base` como si fuera la terminal de la tienda. `carpetaDeDatos` recibe las fotos y los PDF. */
export function sembrarTerminalDeOrigen(base: Database, carpetaDeDatos: string): TerminalDeOrigen {
  const repos = crearRepositorios(base);
  const autenticacion = new ServicioDeAutenticacion({
    base,
    usuarios: repos.usuarios,
    auditoria: repos.auditoria,
    bloqueosDeAutorizacion: repos.bloqueosDeAutorizacion,
  });
  const usuarios = new ServicioDeUsuarios({ base, usuarios: repos.usuarios, auditoria: repos.auditoria });
  const categorias = new ServicioDeCategorias({ base, categorias: repos.categorias, auditoria: repos.auditoria });
  const almacenDeFotos = new AlmacenDeFotos(carpetaDeDatos, { reducir: (): Buffer | null => null });
  const productos = new ServicioDeProductos({
    base,
    productos: repos.productos,
    categorias: repos.categorias,
    auditoria: repos.auditoria,
    describirFoto: (ruta): ArchivoParaSubir | null => almacenDeFotos.describirParaSubir(ruta),
  });
  const negocio = new ServicioDeConfiguracionDeNegocio({ base, configuracion: repos.configuracionNegocio, auditoria: repos.auditoria });
  const limites = new ServicioDeLimitesDeDescuento({
    base,
    limites: repos.limitesDescuento,
    auditoria: repos.auditoria,
    nombreDeUsuario: (id): string | null => repos.usuarios.obtenerPorId(id)?.nombre ?? null,
  });
  const caja = new ServicioDeCaja({
    base,
    cajaSesiones: repos.cajaSesiones,
    denominaciones: repos.denominaciones,
    desglose: repos.desgloseDeCaja,
    ventas: repos.ventas,
    auditoria: repos.auditoria,
  });
  const venta = new ServicioDeVenta({
    base,
    ventas: repos.ventas,
    ventaDetalle: repos.ventaDetalle,
    productos: repos.productos,
    preciosEspeciales: repos.preciosEspeciales,
    limitesDescuento: repos.limitesDescuento,
    cajaSesiones: repos.cajaSesiones,
    auditoria: repos.auditoria,
  });
  const carpetaDeRecibos = join(carpetaDeDatos, 'recibos');
  mkdirSync(carpetaDeRecibos, { recursive: true });
  const rutasDePdf: string[] = [];
  const recibos = new ServicioDeRecibos({
    base,
    ventas: repos.ventas,
    ventaDetalle: repos.ventaDetalle,
    recibos: repos.recibos,
    usuarios: repos.usuarios,
    configuracion: repos.configuracionNegocio,
    impresora: new NullPrinterProvider(),
    generarPdf: (_html, destino): Promise<void> => {
      writeFileSync(destino, '%PDF-1.4 de mentira\n');
      rutasDePdf.push(destino);
      return Promise.resolve();
    },
    ubicacion: { carpeta: carpetaDeRecibos, unir: join },
    log: new LogTecnicoSilencioso(),
  });

  // --- Usuarios: el primer administrador y una cajera que se bloquea -------
  const jimmy = autenticacion.crearPrimerAdministrador('Jimmy Cano', generarHashDePin(PIN_DE_JIMMY));
  const ana = usuarios.crear(jimmy.id, { nombre: 'Ana', rol: 'venta', pin: PIN_DE_ANA });
  const INTENTOS_HASTA_EL_BLOQUEO = 3;
  for (let i = 0; i < INTENTOS_HASTA_EL_BLOQUEO; i += 1) {
    autenticacion.autenticar(ana.id, '0000');
  }

  // --- Negocio y tope ------------------------------------------------------
  negocio.guardar(jimmy.id, { nombreComercial: 'Agroservicios Cano', direccion: 'Km 12, Chimaltenango', telefono: '5555-1234', nit: '1234567-8' });
  limites.fijar(jimmy.id, { rol: 'venta', porcentaje: '10', montoFijo: '20' });

  // --- Catálogo: tres productos, dos con foto -------------------------------
  const categoria = categorias.crear(jimmy.id, { nombre: 'Granos', orden: 1 });
  const origenDeFotos = join(carpetaDeDatos, 'origen-de-fotos');
  mkdirSync(origenDeFotos, { recursive: true });
  writeFileSync(join(origenDeFotos, 'maiz.png'), PNG_DE_UN_PIXEL);
  writeFileSync(join(origenDeFotos, 'huevos.png'), PNG_DE_OTRO_PIXEL);
  const rutaFotoMaiz = almacenDeFotos.guardar(join(origenDeFotos, 'maiz.png'));
  const rutaFotoHuevos = almacenDeFotos.guardar(join(origenDeFotos, 'huevos.png'));

  const maiz = productos.crear(jimmy.id, {
    nombre: 'Maíz blanco',
    categoriaId: categoria.id,
    tipoMedida: 'peso',
    unidadPeso: 'lb',
    cantidadPredefinidaIcono: '1',
    precioBase: '6.69',
    fotoPath: rutaFotoMaiz,
    inventarioInicial: '100',
  });
  const huevos = productos.crear(jimmy.id, {
    nombre: 'Huevos',
    categoriaId: categoria.id,
    tipoMedida: 'unidad',
    unidadPeso: null,
    cantidadPredefinidaIcono: '1',
    precioBase: '1.50',
    fotoPath: rutaFotoHuevos,
    inventarioInicial: '30',
  });
  const frijol = productos.crear(jimmy.id, {
    nombre: 'Frijol negro',
    categoriaId: categoria.id,
    tipoMedida: 'peso',
    unidadPeso: 'lb',
    cantidadPredefinidaIcono: '1',
    precioBase: '8.25',
    fotoPath: null,
    inventarioInicial: '50',
  });
  const AYER_MS = 24 * 60 * 60 * 1000;
  // Un precio especial de Q5.50 menos sobre los Q6.69 de lista: precio efectivo
  // Q1.19, el mismo del caso combinado de §4.25, y 3.5 lb × 1.19 = 4.165, el
  // subtotal exacto de tres decimales que la nube devuelve como 4.165000.
  repos.preciosEspeciales.crear({
    productoId: maiz.id,
    tipo: 'monto_fijo',
    valor: '5.50',
    vigenteDesde: new Date(Date.now() - AYER_MS).toISOString(),
    vigenteHasta: null,
  });

  // --- Caja de Ana, dos ventas, dos recibos, cierre con diferencia ---------
  const denominaciones = repos.denominaciones.listarActivas();
  const deCien = denominaciones.find((d) => d.valor.toFixed(2) === '100.00');
  const deVeinte = denominaciones.find((d) => d.valor.toFixed(2) === '20.00');
  if (deCien === undefined || deVeinte === undefined) {
    throw new Error('faltan denominaciones del quetzal en la base de origen');
  }
  const cajaCerrada = caja.abrir(ana.id, {
    modo: 'detallado',
    lineas: [
      { denominacionId: deCien.id, cantidad: 3 },
      { denominacionId: deVeinte.id, cantidad: 5 },
    ],
  });

  const ventaCombinada = venta.registrar(ana.id, 'venta', {
    lineas: [{ productoId: maiz.id, cantidad: '3.5' }],
    descuento: { tipo: 'porcentaje', valor: '25', autorizacion: { autorizadoPor: jimmy.id, via: 'presencial' } },
    formaPago: 'efectivo',
    numBoleta: null,
  });
  const ventaConTarjeta = venta.registrar(ana.id, 'venta', {
    lineas: [
      { productoId: huevos.id, cantidad: '12' },
      { productoId: frijol.id, cantidad: '2.25' },
    ],
    descuento: null,
    formaPago: 'tarjeta',
    numBoleta: 'B-000123',
  });

  let reciboCombinado = '';
  let reciboConTarjeta = '';
  // `emitir` es asíncrono solo por el PDF; con el generador de mentira resuelve enseguida.
  void recibos.emitir(ventaCombinada.venta.id).then((r) => {
    reciboCombinado = r.recibo.id;
  });
  void recibos.emitir(ventaConTarjeta.venta.id).then((r) => {
    reciboConTarjeta = r.recibo.id;
  });
  // Las dos filas de `recibos` ya están escritas: la transacción es síncrona y
  // ocurre antes del primer `await` de `emitir`.
  reciboCombinado = repos.recibos.obtenerPorVenta(ventaCombinada.venta.id)?.id ?? reciboCombinado;
  reciboConTarjeta = repos.recibos.obtenerPorVenta(ventaConTarjeta.venta.id)?.id ?? reciboConTarjeta;

  const cierre = caja.intentarCerrar(
    cajaCerrada.id,
    { modo: 'simple', monto: '390.00' },
    { usuarioQueCierra: ana.id, autorizacion: { autorizadaPor: jimmy.id, via: 'presencial' } },
  );
  if (!cierre.cerrada) {
    throw new Error(`la caja de origen no cerró: ${cierre.mensaje}`);
  }
  const cajaAbierta = caja.abrir(jimmy.id, { modo: 'simple', monto: '250.00' });

  return {
    repos,
    ids: {
      jimmy: jimmy.id,
      ana: ana.id,
      categoria: categoria.id,
      maiz: maiz.id,
      huevos: huevos.id,
      frijol: frijol.id,
      cajaCerrada: cajaCerrada.id,
      cajaAbierta: cajaAbierta.id,
      ventaCombinada: ventaCombinada.venta.id,
      ventaConTarjeta: ventaConTarjeta.venta.id,
      reciboCombinado,
      reciboConTarjeta,
    },
    fotoDelMaiz: { rutaRelativa: rutaFotoMaiz, objeto: rutaFotoMaiz.split('/').pop() ?? '', bytes: PNG_DE_UN_PIXEL },
    fotoDeLosHuevos: { rutaRelativa: rutaFotoHuevos, objeto: rutaFotoHuevos.split('/').pop() ?? '' },
    rutasDePdf,
  };
}
