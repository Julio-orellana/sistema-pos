/**
 * Manejadores IPC de la pantalla de venta.
 *
 * Son dos canales: `venta:estado`, que arma lo que la pantalla necesita para
 * dibujarse y no escribe nada, y `venta:cobrar`, que registra la venta entera
 * en una sola transacción.
 *
 * SON CANALES APARTE DE LOS DEL CATÁLOGO, y la razón importa: los de catálogo
 * exigen rol administrativo porque sirven para editar el catálogo, y vender lo
 * hace un cajero. Estos exigen solo que haya sesión, y a cambio devuelven
 * únicamente productos ACTIVOS y ningún dato de administración.
 *
 * EL COBRO NO CONFÍA EN NINGÚN PRECIO QUE VENGA DE LA VENTANA. El payload trae
 * qué producto y cuánto; el precio, el subtotal y el total los vuelve a
 * calcular el dominio contra el catálogo. Y el usuario y el rol salen de la
 * sesión del proceso principal, nunca del mensaje.
 */

import { ipcMain } from 'electron';

import {
  CANALES_IPC,
  esquemaCobro,
  type CategoriaDeVenta,
  type EstadoDeVenta,
  type ImpresionDeReciboTerminadaIpc,
  type ProductoParaVender,
  type ResultadoDeCobro,
  type RespuestaIpc,
  type TurnoAbierto,
} from '@shared/types/ipc';
import { montoACadena } from '@shared/money';
import { ErrorDeNegocio } from '@main/database/errores';
import { requiereSesion, type SesionActual } from '@main/domain/usuarios/sesion';
import type { ServicioDeAutenticacion } from '@main/domain/usuarios/autenticacion';
import type { ServicioDeCaja } from '@main/domain/caja/servicio-de-caja';
import type { ServicioDeCategorias } from '@main/domain/catalogo/servicio-de-categorias';
import type { ServicioDeProductos } from '@main/domain/catalogo/servicio-de-productos';
import type {
  AutorizacionDeDescuento,
  ServicioDeVenta,
} from '@main/domain/venta/servicio-de-venta';
import type { ServicioDeRecibos } from '@main/domain/recibo/servicio-de-recibos';
import type { RepositorioDePreciosEspeciales } from '@main/database/repositories/precios-especiales';
import type { RepositorioDeUsuarios } from '@main/database/repositories/usuarios';
import { urlDeFoto } from '@main/domain/catalogo/almacen-de-fotos';
import { ejecutarConRespuesta } from './respuesta';
import { productoParaVender } from './producto-para-vender';

/** Dependencias que necesitan los manejadores de venta. */
export interface DependenciasDeVenta {
  readonly sesion: SesionActual;
  readonly caja: ServicioDeCaja;
  readonly categorias: ServicioDeCategorias;
  readonly productos: ServicioDeProductos;
  readonly venta: ServicioDeVenta;
  readonly autenticacion: ServicioDeAutenticacion;
  readonly preciosEspeciales: RepositorioDePreciosEspeciales;
  readonly usuarios: RepositorioDeUsuarios;
  /** Emisión del recibo. Corre DESPUÉS de la transacción de la venta. */
  readonly recibos: ServicioDeRecibos;
  /** Reloj inyectable: decide qué precios especiales están vigentes. */
  readonly ahora?: () => number;
}

/** Registra los canales de la pantalla de venta. */
export function registrarManejadoresDeVenta(dependencias: DependenciasDeVenta): void {
  const { sesion, caja, categorias, productos, usuarios, preciosEspeciales } = dependencias;
  const ahora = dependencias.ahora ?? ((): number => Date.now());

  ipcMain.handle(
    CANALES_IPC.ventaEstado,
    async (): Promise<RespuestaIpc<EstadoDeVenta>> =>
      ejecutarConRespuesta('ESTADO_DE_VENTA_FALLIDO', () =>
        requiereSesion(sesion, () => {
          const enSesion = sesion.obtener();
          if (enSesion === null) {
            throw new ErrorDeNegocio(
              'PERMISO_DENEGADO',
              'No hay ninguna sesión iniciada. Ingresá con tu usuario para continuar.',
              'Se llegó al canal de venta sin sesión.',
            );
          }

          const estado = caja.estadoParaVender(enSesion.id);

          /**
           * La pantalla de venta no muestra el teórico, y este canal lo usan
           * los dos roles: no lo manda NUNCA (§4.40). Si lo mandara para un
           * administrativo, un cajero podría leerlo de la consola mientras
           * vende con la sesión de otro abierta, y no hay nada que ganar.
           */
          const sinTeorico: Pick<
            TurnoAbierto,
            'ventasEnEfectivo' | 'cantidadDeVentasEnEfectivo' | 'montoTeorico' | 'primerConteoSellado'
          > = {
            ventasEnEfectivo: null,
            cantidadDeVentasEnEfectivo: null,
            montoTeorico: null,
            primerConteoSellado: null,
          };

          /** El turno del sistema, con quién lo abrió ya resuelto. */
          const turnoAbierto: TurnoAbierto | null = estado.puede
            ? {
                id: estado.turno.id,
                montoInicial: montoACadena(estado.turno.montoInicial),
                abiertaEn: estado.turno.abiertaEn,
                abiertaPorId: estado.turno.usuarioId,
                abiertaPorNombre: enSesion.nombre,
                esDeOtroUsuario: false,
                ...sinTeorico,
              }
            : estado.motivo === 'CAJA_DE_OTRO_USUARIO'
              ? {
                  id: estado.turno.id,
                  montoInicial: montoACadena(estado.turno.montoInicial),
                  abiertaEn: estado.turno.abiertaEn,
                  abiertaPorId: estado.turno.usuarioId,
                  abiertaPorNombre:
                    usuarios.obtenerPorId(estado.turno.usuarioId)?.nombre ??
                    '(usuario eliminado)',
                  esDeOtroUsuario: true,
                  ...sinTeorico,
                }
              : null;

          // Sin caja propia no se manda catálogo. No es solo ahorro: la
          // pantalla no debe poder dibujar la cuadrícula "por si acaso" ni
          // dejar productos a la vista de un turno que no es de quien mira.
          if (!estado.puede) {
            const bloqueado: EstadoDeVenta = {
              puedeVender: false,
              motivo: estado.motivo,
              turnoAbierto,
              categorias: [],
              productos: [],
            };
            return bloqueado;
          }

          const activos = productos.listarParaVenta();
          const nombresDeCategorias = new Map(
            categorias.listarTodas().map((categoria) => [categoria.id, categoria.nombre]),
          );

          /** Cuántos productos activos tiene cada categoría, ya contados. */
          const productosPorCategoria = new Map<string, number>();
          for (const producto of activos) {
            productosPorCategoria.set(
              producto.categoriaId,
              (productosPorCategoria.get(producto.categoriaId) ?? 0) + 1,
            );
          }

          // Solo se ofrecen las categorías ACTIVAS que además tienen algo que
          // vender: una pestaña vacía es un toque que no lleva a ninguna parte.
          const paraLaBarra: CategoriaDeVenta[] = categorias
            .listarActivas()
            .filter((categoria) => (productosPorCategoria.get(categoria.id) ?? 0) > 0)
            .map((categoria) => ({
              id: categoria.id,
              nombre: categoria.nombre,
              productos: productosPorCategoria.get(categoria.id) ?? 0,
            }));

          /*
            Los precios especiales vigentes AHORA, en una sola consulta para
            todo el catálogo. El precio efectivo se resuelve acá, del lado del
            proceso principal, y no en la pantalla: la ventana no tiene por qué
            saber la regla de vigencia, y si la supiera podría equivocarse en
            silencio y cobrar un precio que ya venció.

            El total se vuelve a calcular igual al cobrar, contra los precios
            vigentes en ESE momento. Esto es lo que se MUESTRA.
          */
          const vigentes = preciosEspeciales.vigentesPorProductoEn(
            new Date(ahora()).toISOString(),
          );

          const paraLaCuadricula: ProductoParaVender[] = activos.map((producto) =>
            productoParaVender(
              producto,
              vigentes.get(producto.id) ?? [],
              nombresDeCategorias.get(producto.categoriaId) ?? '(categoría desconocida)',
              producto.fotoPath === null ? null : urlDeFoto(producto.fotoPath),
            ),
          );

          const listo: EstadoDeVenta = {
            puedeVender: true,
            motivo: null,
            turnoAbierto,
            categorias: paraLaBarra,
            productos: paraLaCuadricula,
          };
          return listo;
        }),
      ),
  );

  // =========================================================================
  // venta:cobrar — el canal que escribe
  // =========================================================================
  ipcMain.handle(
    CANALES_IPC.ventaCobrar,
    async (evento, payload: unknown): Promise<RespuestaIpc<ResultadoDeCobro>> =>
      ejecutarConRespuesta('COBRO_FALLIDO', async () =>
        requiereSesion(sesion, async () => {
          const pedido = esquemaCobro.parse(payload);
          const enSesion = sesion.obtener();
          if (enSesion === null) {
            throw new ErrorDeNegocio(
              'PERMISO_DENEGADO',
              'No hay ninguna sesión iniciada. Ingresá con tu usuario para continuar.',
              'Se llegó al canal de cobro sin sesión.',
            );
          }

          /*
            EL DESCUENTO, EN DOS PASOS.

            Primer paso, sin PIN: si excede el tope del rol NO se cobra y se
            devuelve cuánto es el tope y cuánto el exceso, para que la pantalla
            lo muestre. Quien autoriza tiene que ver qué está aprobando ANTES
            de teclear su código; es el mismo criterio del cierre con
            diferencia (§4.9).

            Segundo paso, con PIN: se verifica contra la superficie
            `descuento_excedente`, con su propio candado de intentos.
          */
          /*
            La autorización del descuento, si hizo falta. Es UN objeto y no dos
            variables sueltas: el autorizante y la vía van siempre juntos, y la
            base rechaza la venta entera si llegara uno sin el otro.
          */
          let autorizacion: AutorizacionDeDescuento | null = null;

          if (pedido.descuento !== null) {
            const veredicto = dependencias.venta.veredictoDeDescuento(
              enSesion.rol,
              pedido.descuento.tipo,
              pedido.descuento.valor,
            );

            if (veredicto.excede) {
              if (pedido.pinDescuento === undefined) {
                const aviso: ResultadoDeCobro = {
                  registrada: false,
                  codigo: 'REQUIERE_AUTORIZACION_DE_DESCUENTO',
                  mensaje:
                    'Ese descuento pasa el límite de tu rol. Un administrador tiene que autorizarlo con su PIN.',
                  requiereAutorizacion: true,
                  tope: montoACadena(veredicto.tope),
                  exceso: montoACadena(veredicto.exceso),
                  segundosParaReintentar: null,
                };
                return aviso;
              }

              /*
                ACEPTA EL PIN NORMAL Y EL REMOTO, y el sistema determina cuál
                coincidió. No siempre fue así: la superficie nació aceptando
                solo el normal, por el principio de alcance mínimo, y Julio
                decidió explícitamente el 2026-09-11 ampliarla —Jimmy no siempre
                está en la tienda y un cliente no puede esperar a que vuelva—.
                Es el mecanismo previsto funcionando, no una corrección.

                QUÉ ACEPTA CADA SUPERFICIE NO SE DECIDE ACÁ: sale de
                `ACEPTA_PIN_REMOTO`, en `autenticacion.ts`. `salida_controlada`
                y `cierre_de_caja_ajena` siguen sin aceptar el remoto.
              */
              const permiso = dependencias.autenticacion.autorizarComoAdministrador(
                pedido.pinDescuento,
                'descuento_excedente',
              );

              if (!permiso.autenticado || permiso.usuario === null) {
                const rechazo: ResultadoDeCobro = {
                  registrada: false,
                  codigo: permiso.codigo,
                  mensaje: permiso.mensaje,
                  requiereAutorizacion: true,
                  tope: montoACadena(veredicto.tope),
                  exceso: montoACadena(veredicto.exceso),
                  segundosParaReintentar: permiso.segundosParaReintentar,
                };
                return rechazo;
              }
              /*
                La vía la determinó la verificación, no el cajero: nunca se le
                pregunta si el código que le dictaron es el normal o el remoto.
                Viaja pegada al autorizante en un solo objeto, para que no se
                pueda guardar uno sin el otro (migración 017).
              */
              autorizacion = {
                autorizadoPor: permiso.usuario.id,
                via: permiso.viaDeAutorizacion ?? 'presencial',
              };
            }
          }

          const resultado = dependencias.venta.registrar(enSesion.id, enSesion.rol, {
            lineas: pedido.lineas,
            descuento:
              pedido.descuento === null
                ? null
                : { ...pedido.descuento, autorizacion },
            formaPago: pedido.formaPago,
            numBoleta: pedido.numBoleta,
          });

          /*
            EL RECIBO SE EMITE DESPUÉS DE LA TRANSACCIÓN, nunca adentro.
            Generar un PDF abre una ventana de Chromium e imprimir habla con un
            puerto: las dos cosas son lentas y pueden fallar por motivos ajenos
            a la venta. Meterlas en la transacción mantendría abierta una
            escritura de SQLite esperando a un aparato, y haría que una
            impresora sin papel revirtiera una venta ya cobrada.

            Por eso `emitir` nunca lanza hacia acá: el PDF y la impresión
            reportan lo que pasó en el resultado, y la venta ya está firme.

            Y LA IMPRESORA NO SE ESPERA (2026-09-18, §4.64). Se espera el PDF,
            que es el respaldo obligatorio, y se responde: la cajera ve «Venta
            registrada» sin depender de cuánto tarde un `powershell.exe` en
            arrancar ni de si la impresora contesta. La impresión sigue sola, y
            cuando termina se le avisa a ESTA ventana —la que cobró— con
            `recibosImpresionTerminada`. Un fallo sigue yendo solo a la
            bitácora técnica, nunca a `auditoria_log` (§4.14).
          */
          const emision = await dependencias.recibos.emitirSinEsperarLaImpresion(resultado.venta.id);
          const ventana = evento.sender;
          void emision.impresion.then((impresion) => {
            const aviso: ImpresionDeReciboTerminadaIpc = {
              reciboId: emision.recibo.id,
              numeroRecibo: emision.recibo.numeroRecibo,
              impreso: impresion.impreso,
              mensaje: impresion.mensaje,
            };
            // Si la ventana se cerró mientras tanto, no hay a quién avisar: el
            // resultado ya quedó en la fila (`impreso`) y, si falló, en la
            // bitácora técnica. Un aviso que no se pudo mandar no es un error
            // de la venta, así que tampoco puede dejar una promesa rechazada.
            try {
              if (!ventana.isDestroyed()) {
                ventana.send(CANALES_IPC.recibosImpresionTerminada, aviso);
              }
            } catch {
              // Ver arriba: el aviso es secundario.
            }
          });

          const registrada: ResultadoDeCobro = {
            registrada: true,
            ventaId: resultado.venta.id,
            fecha: resultado.venta.fecha,
            subtotal: resultado.subtotal,
            descuentoAplicado: resultado.descuentoAplicado,
            total: resultado.total,
            formaPago: resultado.venta.formaPago,
            numBoleta: resultado.venta.numBoleta,
            lineas: resultado.lineas,
            lineasConPrecioEspecial: resultado.lineasConPrecioEspecial,
            lineasConPrecioMayorista: resultado.lineasConPrecioMayorista,
            recibo: {
              id: emision.recibo.id,
              numeroRecibo: emision.recibo.numeroRecibo,
              rutaPdf: emision.rutaPdf,
              pdfGenerado: emision.pdfGenerado,
              impreso: false,
              impresionPendiente: true,
              mensajeDeImpresion: 'Enviando el recibo a la impresora…',
            },
          };
          return registrada;
        }),
      ),
  );
}
