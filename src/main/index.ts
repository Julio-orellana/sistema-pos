/**
 * Punto de entrada del proceso principal de Electron.
 *
 * Orden de arranque, y el porqué de ese orden:
 *   1. abrir SQLite  — si la base no abre, no tiene sentido mostrar una caja;
 *   2. preparar la salida controlada — para que exista una forma ordenada de
 *      cerrar desde el primer segundo, y no haya que matar el proceso;
 *   3. registrar IPC — para que la ventana ya encuentre sus canales al cargar;
 *   4. crear ventana — en modo kiosko.
 */

import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, BrowserWindow, dialog, net, protocol, safeStorage } from 'electron';

import {
  abrirBaseDeDatos,
  cerrarBaseDeDatos,
  cerrarBaseDeDatosOrdenadamente,
  ejecutarDiagnostico,
  type ResultadoCierreOrdenado,
} from '@main/database/connection';
import {
  obtenerRutaBaseDeDatos,
  obtenerRutaBaseDeDatosDeVerificacion,
} from '@main/database/db-path';
import { obtenerBaseDeDatos } from '@main/database/connection';
import { crearRepositorios, type Repositorios } from '@main/database/repositories';
import { ServicioDeAutenticacion } from '@main/domain/usuarios/autenticacion';
import { SesionActual } from '@main/domain/usuarios/sesion';
import { ServicioDeUsuarios } from '@main/domain/usuarios/servicio-de-usuarios';
import { ServicioDeConfiguracionDeNegocio } from '@main/domain/negocio/servicio-de-configuracion';
import { ServicioDeReportes } from '@main/domain/reportes/servicio-de-reportes';
import { ServicioDeLimitesDeDescuento } from '@main/domain/venta/servicio-de-limites-de-descuento';
import { ServicioDeRecibos } from '@main/domain/recibo/servicio-de-recibos';
import { generarPdfDesdeHtml } from '@main/recibo/generador-de-pdf';
import { LogTecnicoEnArchivo } from '@main/log-tecnico';
import { CARPETA_DE_RECIBOS, crearImpresoraConfigurada } from '@main/adapters/impresora-configurada';
import { ServicioDeCaja } from '@main/domain/caja/servicio-de-caja';
import { ServicioDeCategorias } from '@main/domain/catalogo/servicio-de-categorias';
import { ServicioDeProductos } from '@main/domain/catalogo/servicio-de-productos';
import { ServicioDeVenta } from '@main/domain/venta/servicio-de-venta';
import {
  limpiarLimitesDeDescuento,
  sembrarLimitesDeDescuento,
  topesActuales,
} from '@main/domain/venta/limites-de-ejemplo';
import {
  AlmacenDeFotos,
  ESQUEMA_DE_FOTOS,
  rutaRelativaDesdeUrl,
} from '@main/domain/catalogo/almacen-de-fotos';
import {
  contarDatosDeEjemplo,
  limpiarDatosDeEjemplo,
  sembrarDatosDeEjemplo,
} from '@main/domain/catalogo/datos-de-ejemplo';
import { generarHashDePin } from '@shared/auth';
import { montoACadena } from '@shared/money';
import { ROLES } from '@shared/types/ipc';
import { quitarManejadoresIpc, registrarManejadoresIpc } from '@main/ipc/register-handlers';
import { ControladorDeSalidaControlada } from '@main/windows/controlled-exit';
import { cargarInterfaz, crearVentanaPrincipal, describirEstadoKiosko } from '@main/windows/main-window';
import {
  crearSyncProvider,
  leerConfiguracionAdaptadoresDelEntorno,
} from '@shared/adapters';
import { observarLotesEncolados } from '@main/database/bandeja-de-salida';
import { TrabajadorDeSincronizacion } from '@main/sincronizacion/trabajador';
import { PlanificadorDeSincronizacion } from '@main/sincronizacion/planificador';
import { SesionDeNube } from '@main/sincronizacion/sesion-de-nube';
import { ClienteDeAuthHttp } from '@main/sincronizacion/auth-de-nube';
import { AlmacenDeCredencial } from '@main/sincronizacion/credencial';
import { ATAJO_SALIDA_CONTROLADA, describirAtajo } from '@shared/kiosk-input';

/** Ruta al preload compilado, relativa a dist-electron/main. */
const RUTA_PRELOAD = join(__dirname, '../preload/index.js');

/** Carpeta del renderer compilado, relativa a dist-electron/main. */
const DIRECTORIO_RENDERER = join(__dirname, '../../dist/renderer');

/**
 * Modo de verificación de arranque (`npm run verify:arranque`).
 *
 * Arranca la aplicación de verdad —misma ventana, misma base de datos, mismos
 * adaptadores—, ejercita los bloqueos del kiosko dentro de la ventana real,
 * imprime un informe de lo que encontró y sale, sin tomarse la pantalla.
 * Existe para que el resultado esperado del sistema se pueda comparar contra
 * el resultado real sin depender de que alguien mire la pantalla y opine.
 */
const enVerificacionDeArranque = process.env.POS_VERIFICACION_ARRANQUE === '1';

/** Marca que la consola busca para extraer el informe de verificación. */
const MARCA_INFORME = 'INFORME_DE_VERIFICACION';

/**
 * Modo de datos de ejemplo (`npm run seed:ejemplo` y `npm run seed:limpiar`).
 *
 * Se activa con un ARGUMENTO de línea de comandos y no con una variable de
 * entorno a propósito: `VARIABLE=valor comando` no funciona en el `cmd` de
 * Windows, que es la plataforma de producción, y un guion que solo corre en
 * macOS es un guion que tarde o temprano nadie puede usar.
 *
 * Arranca el proceso principal SIN abrir ventana, siembra o limpia el catálogo
 * de ejemplo contra la MISMA base de datos que usa la aplicación, imprime lo
 * que hizo y sale. Reutiliza este arranque en vez de tener un guion aparte
 * porque la ruta del archivo sale de `app.getPath('userData')`: un guion en
 * Node puro tendría que adivinar esa ruta por sistema operativo, y el día que
 * no coincidiera sembraría una base que nadie mira.
 *
 * NO es una migración y no toca el sistema de migraciones. Ver
 * src/main/domain/catalogo/datos-de-ejemplo.ts.
 */
const BANDERA_DATOS_DE_EJEMPLO = '--datos-de-ejemplo=';
const modoDatosDeEjemplo =
  process.argv.find((argumento) => argumento.startsWith(BANDERA_DATOS_DE_EJEMPLO))?.slice(
    BANDERA_DATOS_DE_EJEMPLO.length,
  ) ?? '';

/**
 * Modo semilla del TOPE DE DESCUENTO, por la misma vía y por la misma razón.
 *
 * `limites_descuento` arranca vacía y sin fila el tope es cero, así que no se
 * puede probar un descuento dentro del límite sin poner la fila a mano. Es un
 * guion APARTE del catálogo de ejemplo porque son dos cosas distintas: uno
 * siembra mercadería inventada, este siembra configuración. Quien limpie el
 * catálogo no debería perder su tope de descuento de paso.
 *
 * NO reemplaza la pantalla de configuración, que es un pendiente propio.
 * Ver src/main/domain/venta/limites-de-ejemplo.ts.
 */
const BANDERA_LIMITES = '--limites-descuento=';
const modoLimitesDeDescuento =
  process.argv.find((argumento) => argumento.startsWith(BANDERA_LIMITES))?.slice(
    BANDERA_LIMITES.length,
  ) ?? '';

/** ¿Se arrancó en alguno de los modos de semilla, sin abrir ventana? */
const modoSemilla = modoDatosDeEjemplo !== '' || modoLimitesDeDescuento !== '';

/** Evita que el cierre ordenado se ejecute dos veces. */
let cierreEnCurso = false;

/** Resultado del último cierre ordenado, que el informe de verificación lee. */
let ultimoCierre: ResultadoCierreOrdenado | null = null;

/**
 * Controlador de salida activo. Se guarda a nivel de módulo para que el cierre
 * ordenado pueda autorizarse a sí mismo y no quede atrapado por la
 * intercepción de cierres que él mismo instala.
 */
let controladorDeSalidaActivo: ControladorDeSalidaControlada | null = null;

/**
 * Cierra la aplicación de forma ordenada.
 *
 * "Ordenada" significa, en concreto: se quitan los canales IPC para que no
 * entre trabajo nuevo, se consolida el WAL de SQLite en el archivo principal y
 * recién entonces se cierra la conexión y la aplicación. Es exactamente lo que
 * NO ocurre cuando se mata el proceso desde el Administrador de tareas.
 */
/** El planificador vivo, para poder detenerlo en el cierre ordenado. */
let planificadorDeSincronizacion: PlanificadorDeSincronizacion | null = null;

/**
 * La sesión con Supabase Auth, para dejar de renovar en el cierre ordenado.
 *
 * `null` cuando la nube no está configurada, que hoy es el caso normal en
 * desarrollo: sin `POS_NUBE_URL` no hay a quién conectarse.
 */
let sesionDeNube: SesionDeNube | null = null;

function cerrarAplicacionOrdenadamente(): void {
  if (cierreEnCurso) {
    return;
  }
  cierreEnCurso = true;
  // El cierre ordenado se autoriza a sí mismo: si no, el `app.quit()` de abajo
  // volvería a caer en la intercepción y la aplicación no cerraría nunca.
  controladorDeSalidaActivo?.autorizarCierre();

  // TODO(caja): cuando exista el módulo de caja, avisarle aquí para que
  // persista el turno abierto antes de cerrar.

  /*
    LA SINCRONIZACIÓN SE DETIENE, NO SE APURA. Se podría intentar vaciar la cola
    antes de cerrar, y sería un error: dejaría la salida controlada esperando a
    la red —que puede no estar— justo cuando alguien pidió cerrar el punto de
    venta. No hace falta: la cola vive en SQLite y el trabajador retoma exacto
    donde quedó en el próximo arranque, que es para lo que la bandeja de salida
    guarda TODO su estado en la base y nada en memoria.
  */
  observarLotesEncolados(null);
  planificadorDeSincronizacion?.detener();
  planificadorDeSincronizacion = null;

  /*
    La renovación del token también se DETIENE y no se apura, por la misma
    razón. Y `detener()` NO borra la credencial: cerrar el punto de venta por
    la noche no es desconectar la terminal de la nube, y al día siguiente tiene
    que arrancar sola sin que nadie teclee nada.
  */
  sesionDeNube?.detener();
  sesionDeNube = null;

  quitarManejadoresIpc();
  ultimoCierre = cerrarBaseDeDatosOrdenadamente();
  console.info(`[cierre] ${ultimoCierre.mensaje}`);

  app.quit();
}

/**
 * El esquema `pos-foto:` se declara ANTES de que la aplicación esté lista.
 *
 * Registrarlo como estándar y seguro hace que la ventana lo trate como una
 * dirección normal: sin eso, la política de seguridad de contenido bloquearía
 * la imagen en el `<img>` y la miniatura del producto quedaría en blanco sin
 * ningún error visible. No se usa `file:` a propósito: ese daría acceso a
 * cualquier ruta del disco, y este solo entrega archivos de la carpeta de
 * fotos, comprobando la ruta antes de abrirlos.
 */
protocol.registerSchemesAsPrivileged([
  {
    scheme: ESQUEMA_DE_FOTOS,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

/**
 * Siembra o limpia el catálogo de ejemplo y cierra la aplicación.
 *
 * Imprime un informe con lo que hizo —no un "listo"— para que se pueda
 * comparar el resultado esperado contra el real sin abrir la base a mano.
 */
function ejecutarModoDatosDeEjemplo(modo: string, repositorios: Repositorios): void {
  const base = obtenerBaseDeDatos();
  const antes = contarDatosDeEjemplo(repositorios);

  try {
    if (modo === 'sembrar') {
      const informe = sembrarDatosDeEjemplo(base, repositorios);
      const despues = contarDatosDeEjemplo(repositorios);
      console.info(
        `[datos-de-ejemplo] Sembrado. Categorías creadas: ${String(informe.categoriasCreadas)}; ` +
          `productos creados: ${String(informe.productosCreados)}; ` +
          `ya existían y se dejaron como estaban: ${String(informe.yaExistian)}. ` +
          `Total de ejemplo en la base: ${String(despues.categorias)} categorías y ` +
          `${String(despues.productos)} productos.`,
      );
    } else if (modo === 'limpiar') {
      const informe = limpiarDatosDeEjemplo(base, repositorios);
      if (informe.conservadosPorTenerVentas.length > 0) {
        console.warn(
          '[datos-de-ejemplo] NO se borró nada: estos productos de ejemplo tienen ventas ' +
            `asociadas y borrarlos rompería un comprobante: ${informe.conservadosPorTenerVentas.join(', ')}.`,
        );
      } else {
        const despues = contarDatosDeEjemplo(repositorios);
        console.info(
          `[datos-de-ejemplo] Limpiado. Productos eliminados: ${String(informe.productosEliminados)}; ` +
            `categorías eliminadas: ${String(informe.categoriasEliminadas)}. ` +
            `Quedan en la base: ${String(despues.categorias)} categorías y ` +
            `${String(despues.productos)} productos de ejemplo.`,
        );
      }
    } else {
      console.error(
        `[datos-de-ejemplo] Modo desconocido: "${modo}". Se esperaba "sembrar" o "limpiar".`,
      );
    }
  } catch (error) {
    const detalle = error instanceof Error ? error.message : String(error);
    console.error(`[datos-de-ejemplo] Falló: ${detalle}`);
  }

  console.info(
    `[datos-de-ejemplo] Estado anterior: ${String(antes.categorias)} categorías y ` +
      `${String(antes.productos)} productos de ejemplo.`,
  );

  quitarManejadoresIpc();
  const cierre = cerrarBaseDeDatosOrdenadamente();
  console.info(`[cierre] ${cierre.mensaje}`);
  app.exit(0);
}

/**
 * Siembra o limpia el tope de descuento y cierra la aplicación.
 *
 * Imprime SIEMPRE el tope de cada rol después de trabajar, y no solo lo que
 * hizo: lo que importa saber antes de ir a probar un descuento es contra qué
 * número se va a comparar, y un rol sin fila —que es el caso del
 * administrativo— se lee mal como «no tiene tope» cuando significa lo
 * contrario, que su tope es cero.
 */
function ejecutarModoLimitesDeDescuento(modo: string, repositorios: Repositorios): void {
  try {
    if (modo === 'sembrar') {
      const informe = sembrarLimitesDeDescuento(repositorios);
      for (const aplicado of informe.aplicados) {
        console.info(
          `[limites-descuento] ${aplicado.reemplazo ? 'Reemplazado' : 'Sembrado'} el tope del ` +
            `rol "${aplicado.rol}": ${montoACadena(aplicado.limite.descuentoMaxPorcentaje)} % o ` +
            `Q${montoACadena(aplicado.limite.descuentoMaxMontoFijo)} fijos.`,
        );
      }
    } else if (modo === 'limpiar') {
      const informe = limpiarLimitesDeDescuento(repositorios);
      console.info(
        informe.borrados.length === 0
          ? '[limites-descuento] No había ningún tope sembrado que quitar.'
          : `[limites-descuento] Quitados los topes de: ${informe.borrados.join(', ')}. ` +
              'Esos roles vuelven a cero.',
      );
    } else {
      console.error(
        `[limites-descuento] Modo desconocido: "${modo}". Se esperaba "sembrar" o "limpiar".`,
      );
    }

    const topes = topesActuales(repositorios);
    for (const rol of ROLES) {
      const tope = topes.find((limite) => limite.rol === rol);
      console.info(
        tope === undefined
          ? `[limites-descuento] Rol "${rol}": SIN FILA, o sea tope CERO. Todo descuento que ` +
              'pida necesita el PIN de un administrador.'
          : `[limites-descuento] Rol "${rol}": hasta ${montoACadena(tope.descuentoMaxPorcentaje)} % ` +
              `o Q${montoACadena(tope.descuentoMaxMontoFijo)} sin autorización.`,
      );
    }
  } catch (error) {
    const detalle = error instanceof Error ? error.message : String(error);
    console.error(`[limites-descuento] Falló: ${detalle}`);
  }

  quitarManejadoresIpc();
  const cierre = cerrarBaseDeDatosOrdenadamente();
  console.info(`[cierre] ${cierre.mensaje}`);
  app.exit(0);
}

/**
 * Instancia única: dos copias del POS abiertas sobre la misma base de datos
 * serían una fuente segura de descuadres en el corte de caja.
 */
const obtuvoElCandado = app.requestSingleInstanceLock();
if (!obtuvoElCandado) {
  /*
    NO se sale en silencio, y menos en los guiones de datos de ejemplo.
    Se descubrió con la aplicación abierta: `npm run seed:limpiar` terminaba
    sin imprimir nada y con código de salida 0, o sea que parecía haber
    funcionado, cuando en realidad no había llegado a tocar la base. Un guion
    que miente sobre lo que hizo es peor que uno que falla.

    Para la aplicación normal, en cambio, salir callado es lo correcto: la
    segunda copia le pasa el foco a la primera (ver `second-instance`) y no
    tiene nada que decirle al cajero.
  */
  if (modoSemilla) {
    console.error(
      '[semilla] NO se hizo nada: el punto de venta ya está abierto y ' +
        'la aplicación es de instancia única. Cerralo y volvé a correr el guion.',
    );
    app.exit(1);
  } else {
    app.quit();
  }
}

app.on('second-instance', () => {
  const [ventanaExistente] = BrowserWindow.getAllWindows();
  if (ventanaExistente !== undefined) {
    ventanaExistente.focus();
  }
});

app.whenReady().then(
  () => {
    try {
      // En verificación se usa una base descartable en la carpeta temporal: la
      // prueba necesita sembrar un administrador y no puede dejar usuarios de
      // mentira en los datos reales de la tienda.
      const ruta = enVerificacionDeArranque
        ? obtenerRutaBaseDeDatosDeVerificacion()
        : obtenerRutaBaseDeDatos();
      if (enVerificacionDeArranque) {
        rmSync(ruta, { force: true });
        rmSync(`${ruta}-wal`, { force: true });
        rmSync(`${ruta}-shm`, { force: true });
      }
      const migraciones = abrirBaseDeDatos(ruta);
      if (migraciones.aplicadasAhora.length > 0) {
        console.info(`[base-de-datos] Migraciones aplicadas: ${migraciones.aplicadasAhora.join(', ')}`);
      }
    } catch (error) {
      const detalle = error instanceof Error ? error.message : String(error);
      dialog.showErrorBox(
        'No se pudo abrir la base de datos',
        `El punto de venta no puede iniciar sin su base de datos local ni sin sus migraciones aplicadas.\n\nDetalle: ${detalle}`,
      );
      app.quit();
      return;
    }

    const baseDeDatos = obtenerBaseDeDatos();
    const repositorios = crearRepositorios(baseDeDatos);
    const autenticacion = new ServicioDeAutenticacion({
      usuarios: repositorios.usuarios,
      auditoria: repositorios.auditoria,
      bloqueosDeAutorizacion: repositorios.bloqueosDeAutorizacion,
    });
    const sesion = new SesionActual();
    const caja = new ServicioDeCaja({
      base: baseDeDatos,
      cajaSesiones: repositorios.cajaSesiones,
      denominaciones: repositorios.denominaciones,
      desglose: repositorios.desgloseDeCaja,
      ventas: repositorios.ventas,
      auditoria: repositorios.auditoria,
    });

    const servicioDeCategorias = new ServicioDeCategorias({
      base: baseDeDatos,
      categorias: repositorios.categorias,
      auditoria: repositorios.auditoria,
    });
    const servicioDeProductos = new ServicioDeProductos({
      base: baseDeDatos,
      productos: repositorios.productos,
      categorias: repositorios.categorias,
      auditoria: repositorios.auditoria,
    });
    const almacenDeFotos = new AlmacenDeFotos(app.getPath('userData'));

    // Gestión de usuarios: cierra el hueco que dejaba el primer arranque, que
    // solo sabía crear al primer administrador y solo con la tabla vacía.
    const servicioDeUsuarios = new ServicioDeUsuarios({
      base: baseDeDatos,
      usuarios: repositorios.usuarios,
      auditoria: repositorios.auditoria,
    });

    const servicioDeNegocio = new ServicioDeConfiguracionDeNegocio({
      base: baseDeDatos,
      configuracion: repositorios.configuracionNegocio,
      auditoria: repositorios.auditoria,
    });

    /*
      REPORTES: leen mucho y no escriben nada.

      Reciben los cuatro repositorios que necesitan y ninguno más. No reciben la
      conexión: a diferencia del servicio de venta, acá no hay nada que
      delimitar en una transacción, y dársela invitaría a que algún reporte
      futuro escribiera de paso.
    */
    const servicioDeReportes = new ServicioDeReportes({
      ventas: repositorios.ventas,
      ventaDetalle: repositorios.ventaDetalle,
      productos: repositorios.productos,
      categorias: repositorios.categorias,
    });

    // Los topes de descuento, ya configurables desde la aplicación y no solo
    // con el guion `seed:limites`.
    const servicioDeLimites = new ServicioDeLimitesDeDescuento({
      base: baseDeDatos,
      limites: repositorios.limitesDescuento,
      auditoria: repositorios.auditoria,
      nombreDeUsuario: (usuarioId): string | null => repositorios.usuarios.obtenerPorId(usuarioId)?.nombre ?? null,
    });

    /*
      RECIBOS: PDF siempre, impresión si hay con qué.

      La carpeta de PDF y la bitácora TÉCNICA viven en `userData`, nunca en la
      carpeta de instalación: en Windows esa no es escribible de forma confiable
      y se reemplaza entera en cada actualización. Es la misma razón por la que
      las fotos de producto van ahí (§4.11).

      La impresora se lee de un archivo LOCAL de esta terminal y no de
      `configuracion_negocio`: dos cajas podrían tener la impresora en puertos
      distintos, y esa tabla se espeja en la nube. Ver §4.14.
    */
    const carpetaDePdf = join(app.getPath('userData'), CARPETA_DE_RECIBOS);
    mkdirSync(carpetaDePdf, { recursive: true });
    const logTecnico = new LogTecnicoEnArchivo(app.getPath('userData'));
    const impresora = crearImpresoraConfigurada(app.getPath('userData'), logTecnico);

    const servicioDeRecibos = new ServicioDeRecibos({
      base: baseDeDatos,
      ventas: repositorios.ventas,
      ventaDetalle: repositorios.ventaDetalle,
      recibos: repositorios.recibos,
      usuarios: repositorios.usuarios,
      configuracion: repositorios.configuracionNegocio,
      impresora,
      generarPdf: generarPdfDesdeHtml,
      ubicacion: { carpeta: carpetaDePdf, unir: join },
      log: logTecnico,
    });

    // La venta recibe la CONEXIÓN además de los repositorios: es quien delimita
    // la transacción que descuenta inventario, inserta la venta y su detalle y
    // mueve los contadores, todo o nada.
    const servicioDeVenta = new ServicioDeVenta({
      base: baseDeDatos,
      ventas: repositorios.ventas,
      ventaDetalle: repositorios.ventaDetalle,
      productos: repositorios.productos,
      preciosEspeciales: repositorios.preciosEspeciales,
      limitesDescuento: repositorios.limitesDescuento,
      cajaSesiones: repositorios.cajaSesiones,
      auditoria: repositorios.auditoria,
    });

    // Modo semilla: siembra o limpia el catálogo de ejemplo y sale, sin abrir
    // ventana. Va después de construir los repositorios y antes de cualquier
    // cosa de interfaz.
    if (modoDatosDeEjemplo !== '') {
      ejecutarModoDatosDeEjemplo(modoDatosDeEjemplo, repositorios);
      return;
    }
    if (modoLimitesDeDescuento !== '') {
      ejecutarModoLimitesDeDescuento(modoLimitesDeDescuento, repositorios);
      return;
    }

    const controladorDeSalida = new ControladorDeSalidaControlada({
      autenticacion,
      cerrarAplicacion: cerrarAplicacionOrdenadamente,
    });
    controladorDeSalidaActivo = controladorDeSalida;

    /**
     * Servidor del esquema `pos-foto:`.
     *
     * La ventana pide una URL y el proceso principal decide qué archivo
     * entrega. `rutaAbsolutaDe` comprueba que la ruta caiga dentro de la
     * carpeta de fotos: sin esa comprobación, un `foto_path` manipulado en la
     * base serviría cualquier archivo del disco a la ventana.
     */
    protocol.handle(ESQUEMA_DE_FOTOS, async (peticion) => {
      const NO_ENCONTRADA = 404;
      const relativa = rutaRelativaDesdeUrl(peticion.url);
      if (relativa === null || relativa === '') {
        return new Response('Foto no encontrada.', { status: NO_ENCONTRADA });
      }
      try {
        const absoluta = almacenDeFotos.rutaAbsolutaDe(relativa);
        return await net.fetch(pathToFileURL(absoluta).toString());
      } catch {
        return new Response('Foto no encontrada.', { status: NO_ENCONTRADA });
      }
    });

    /*
      ===================================================================
      SESIÓN CON LA NUBE (fase 3.a, primera mitad)
      ===================================================================
      Solo se construye si el proyecto está configurado. Sin `POS_NUBE_URL`
      no hay a quién conectarse, y montar la pantalla igual sería ofrecer un
      botón que no puede funcionar: la pantalla dice que falta configurar.

      La llave publicable NO es un secreto —solo identifica el proyecto, y
      sola no puede nada porque RLS está activo sin políticas para `anon`
      (§1.2)—, así que viaja por variable de entorno hoy y va a viajar dentro
      del instalador el día del empaquetado. **La `service_role` no aparece
      por ningún lado, y no debe aparecer nunca.**
    */
    const urlDeLaNube = process.env.POS_NUBE_URL ?? '';
    const llaveDeLaNube = process.env.POS_NUBE_LLAVE_PUBLICABLE ?? '';
    if (urlDeLaNube !== '' && llaveDeLaNube !== '') {
      sesionDeNube = new SesionDeNube({
        auth: new ClienteDeAuthHttp(urlDeLaNube, llaveDeLaNube),
        credencial: new AlmacenDeCredencial(app.getPath('userData'), safeStorage),
        // Para que el aviso de credencial revocada pueda decir cuántas filas
        // se están acumulando sin poder subir.
        contarPendientes: (): number => repositorios.syncCola.contarPendientes(),
        registrar: (mensaje): void => {
          logTecnico.registrar('sincronizacion', mensaje);
          console.info(`[nube] ${mensaje}`);
        },
      });
    }

    registrarManejadoresIpc({
      controladorDeSalida,
      autenticacion,
      sesion,
      usuarios: repositorios.usuarios,
      caja,
      venta: servicioDeVenta,
      gestionDeUsuarios: servicioDeUsuarios,
      negocio: servicioDeNegocio,
      recibos: servicioDeRecibos,
      repositorioDeRecibos: repositorios.recibos,
      preciosEspeciales: repositorios.preciosEspeciales,
      reportes: servicioDeReportes,
      limitesDeDescuento: servicioDeLimites,
      nube: sesionDeNube ?? undefined,
      catalogo: {
        categorias: servicioDeCategorias,
        productos: servicioDeProductos,
        fotos: almacenDeFotos,
      },
    });

    const ventana = crearVentanaPrincipal(RUTA_PRELOAD, !enVerificacionDeArranque);
    controladorDeSalida.conectarVentana(ventana);
    interceptarCierresDelSistema(ventana, controladorDeSalida);
    cargarInterfaz(ventana, DIRECTORIO_RENDERER);

    if (enVerificacionDeArranque) {
      ventana.webContents.once('did-finish-load', () => {
        void ejecutarVerificacionDeArranque(ventana, controladorDeSalida, autenticacion);
      });
      return;
    }

    /*
      ===================================================================
      TRABAJADOR DE SINCRONIZACIÓN (fase 1.b)
      ===================================================================
      Corre contra `SimulatedSyncProvider`: **no toca la red, no usa
      credenciales y no habla con Supabase.** Lo que sí hace de verdad es leer
      `sync_cola`, respetar el orden de los lotes, aplicar el backoff y detener
      la cola ante un error determinístico. El día que exista el adaptador real
      lo único que cambia es qué devuelve `crearSyncProvider`.

      Va DESPUÉS de crear la ventana porque el primer ciclo se agenda 30
      segundos más tarde, contados desde acá: es lo que §2.4 pide para no
      competir con el arranque en un i3.
    */
    /*
      Lo de sincronización va a la bitácora TÉCNICA y además a la consola: en
      desarrollo se ve en la terminal, y en producción la consola no la lee
      nadie pero el archivo queda. Nunca a `auditoria_log`.
    */
    const anotarSincronizacion = (mensaje: string): void => {
      logTecnico.registrar('sincronizacion', mensaje);
      console.info(`[sincronizacion] ${mensaje}`);
    };

    const proveedorDeSincronizacion = crearSyncProvider(
      leerConfiguracionAdaptadoresDelEntorno(process.env),
    );
    const trabajadorDeSincronizacion = new TrabajadorDeSincronizacion({
      cola: repositorios.syncCola,
      proveedor: proveedorDeSincronizacion,
      registrar: anotarSincronizacion,
    });
    planificadorDeSincronizacion = new PlanificadorDeSincronizacion({
      trabajador: trabajadorDeSincronizacion,
      registrar: anotarSincronizacion,
    });
    // El único aviso de «hay algo que subir» sale de la bandeja de salida, que
    // es el único lugar que escribe la cola. Ver `observarLotesEncolados`.
    observarLotesEncolados(() => {
      planificadorDeSincronizacion?.alConfirmarTransaccion();
    });
    planificadorDeSincronizacion.arrancar();

    /*
      La sesión con la nube arranca acá, después de la ventana, por la misma
      razón que el trabajador: no competir con el arranque en un i3. `arrancar`
      NO lanza aunque no haya red ni credencial —la tienda tiene que poder
      abrir sin internet—, así que no hace falta envolverlo en un `catch`.
    */
    void sesionDeNube?.arrancar();
    const avisoDeArranque =
      `trabajador en marcha con ${proveedorDeSincronizacion.nombre}; ` +
      `primer ciclo en 30 s. Pendientes en la cola: ` +
      `${String(repositorios.syncCola.contarPendientes())} filas en ` +
      `${String(repositorios.syncCola.contarLotesPendientes())} lotes.`;
    anotarSincronizacion(avisoDeArranque);

    // En macOS es normal que la aplicación siga viva sin ventanas; se recrea
    // la ventana al reactivarla desde el Dock.
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        const nuevaVentana = crearVentanaPrincipal(RUTA_PRELOAD);
        controladorDeSalida.conectarVentana(nuevaVentana);
        interceptarCierresDelSistema(nuevaVentana, controladorDeSalida);
        cargarInterfaz(nuevaVentana, DIRECTORIO_RENDERER);
      }
    });
  },
  (error: unknown) => {
    const detalle = error instanceof Error ? error.message : String(error);
    dialog.showErrorBox('Error al iniciar', detalle);
    app.quit();
  },
);

/** Resultado de ejercitar los bloqueos dentro de la ventana real. */
interface BloqueosMedidosEnLaVentana {
  readonly menuContextualBloqueado: boolean;
  readonly zoomConCtrlRuedaBloqueado: boolean;
  readonly zoomConCmdRuedaBloqueado: boolean;
  readonly ruedaSinCtrlPermitida: boolean;
  readonly zoomConTecladoBloqueado: boolean;
  readonly tecleoNormalPermitido: boolean;
}

/**
 * Ejercita los bloqueos DENTRO de la ventana real y devuelve qué pasó.
 *
 * Se despachan eventos verdaderos y se lee si quedaron cancelados. Es la
 * diferencia entre afirmar "el código llama a preventDefault" y comprobar que
 * el gesto efectivamente no ocurre en la aplicación que se va a entregar.
 */
async function medirBloqueosEnLaVentana(
  ventana: BrowserWindow,
): Promise<BloqueosMedidosEnLaVentana> {
  const guion = `(() => {
    const despachar = (evento) => { document.body.dispatchEvent(evento); return evento.defaultPrevented; };
    const rueda = (mods) => new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 100, ...mods });
    const tecla = (init) => new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
    return {
      menuContextualBloqueado: despachar(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })),
      zoomConCtrlRuedaBloqueado: despachar(rueda({ ctrlKey: true })),
      zoomConCmdRuedaBloqueado: despachar(rueda({ metaKey: true })),
      ruedaSinCtrlPermitida: !despachar(rueda({})),
      zoomConTecladoBloqueado: despachar(tecla({ ctrlKey: true, code: 'Equal', key: '+' })),
      tecleoNormalPermitido: !despachar(tecla({ code: 'Digit5', key: '5' })),
    };
  })()`;

  return (await ventana.webContents.executeJavaScript(guion)) as BloqueosMedidosEnLaVentana;
}

/**
 * Intercepta TODA vía de cierre que no sea el flujo con PIN.
 *
 * Cubre los atajos estándar del sistema operativo que macOS y Windows
 * reconocen como "salir": Cmd+Q, Alt+F4, el menú del Dock, el botón de cerrar
 * de la ventana y cualquier `app.quit()` de terceros. Todos terminan pidiendo
 * el PIN, igual que el atajo del administrador.
 *
 * Antes de esto, Cmd+Q cerraba el punto de venta de inmediato: sin PIN, sin
 * registro de auditoría y sin consolidar la base de datos.
 *
 * OJO: interceptar el cierre de la APLICACIÓN es legítimo. Lo que jamás se
 * hace es deshabilitar los mecanismos de escape del SISTEMA OPERATIVO —Forzar
 * Salida y Cmd+Tab—, que siguen funcionando siempre. Ver la sección 4.5 de
 * CLAUDE.md.
 */
function interceptarCierresDelSistema(
  ventana: BrowserWindow,
  controladorDeSalida: ControladorDeSalidaControlada,
): void {
  // Cmd+Q en macOS, el menú del Dock y cualquier app.quit() ajeno.
  app.on('before-quit', (evento) => {
    if (controladorDeSalida.evaluarIntentoDeCierre(ventana) === 'pedir-pin') {
      evento.preventDefault();
    }
  });

  // Alt+F4 en Windows y el cierre de la ventana por cualquier otra vía.
  ventana.on('close', (evento) => {
    if (controladorDeSalida.evaluarIntentoDeCierre(ventana) === 'pedir-pin') {
      evento.preventDefault();
    }
  });
}

/** Cantidad de PIN posibles con un dígito menos, para sortear uno de cuatro. */
const RANGO_DE_PIN = 9000;

/** Menor PIN de cuatro dígitos. */
const PIN_MINIMO = 1000;

/**
 * Sortea un PIN de cuatro dígitos para la verificación de arranque.
 * No hay ningún PIN por defecto en el código, tampoco para las pruebas.
 */
function generarPinAleatorioDePrueba(): string {
  return String(Math.floor(Math.random() * RANGO_DE_PIN) + PIN_MINIMO);
}

/** Milisegundos que se espera a que el atajo sintético llegue de vuelta. */
const ESPERA_MAXIMA_DEL_ATAJO_MS = 3000;

/** Intervalo entre comprobaciones mientras se espera el atajo. */
const INTERVALO_DE_ESPERA_MS = 50;

/**
 * Espera a que se cumpla una condición, sin bloquear el bucle de eventos.
 * `sendInputEvent` viaja hasta el renderer y vuelve, así que el atajo no se
 * puede leer en la misma vuelta en que se envía.
 */
async function esperarHasta(condicion: () => boolean, limiteMs: number): Promise<boolean> {
  const inicio = Date.now();
  while (Date.now() - inicio < limiteMs) {
    if (condicion()) {
      return true;
    }
    await new Promise((continuar) => setTimeout(continuar, INTERVALO_DE_ESPERA_MS));
  }
  return condicion();
}

/** Espera a que el diálogo de PIN exista en el DOM de la ventana real. */
async function esperarDialogoDeSalida(ventana: BrowserWindow): Promise<boolean> {
  const limite = Date.now() + ESPERA_MAXIMA_DEL_ATAJO_MS;
  while (Date.now() < limite) {
    const visible = (await ventana.webContents.executeJavaScript(
      `document.querySelector('[data-prueba="dialogo-salida"]') !== null`,
    )) as boolean;
    if (visible) {
      return true;
    }
    await new Promise((continuar) => setTimeout(continuar, INTERVALO_DE_ESPERA_MS));
  }
  return false;
}

/** Arma e imprime el informe de verificación y cierra la aplicación. */
async function ejecutarVerificacionDeArranque(
  ventana: BrowserWindow,
  controladorDeSalida: ControladorDeSalidaControlada,
  autenticacion: ServicioDeAutenticacion,
): Promise<void> {
  // Se siembra un administrador con un PIN sorteado en el momento. No hay
  // ningún PIN por defecto en el código, tampoco para la verificación.
  const pinDePrueba = generarPinAleatorioDePrueba();
  const requeriaConfiguracionInicial = autenticacion.requiereConfiguracionInicial();
  autenticacion.crearPrimerAdministrador('Administrador de prueba', generarHashDePin(pinDePrueba));
  const yaNoRequiereConfiguracion = !autenticacion.requiereConfiguracionInicial();
  const bloqueos = await medirBloqueosEnLaVentana(ventana);

  // Se envía el atajo real a la ventana para comprobar que el proceso
  // principal lo reconoce en ESTA plataforma y pide el PIN.
  ventana.webContents.sendInputEvent({
    type: 'keyDown',
    keyCode: 'q',
    modifiers: ['control', 'shift', 'alt'],
  });

  const atajoReconocido = await esperarHasta(
    () => controladorDeSalida.solicitudesRecibidas() > 0,
    ESPERA_MAXIMA_DEL_ATAJO_MS,
  );

  // Un PIN equivocado NO debe cerrar nada. Se usa uno de CUATRO dígitos y
  // distinto del sembrado: con un largo inválido fallaría por formato y no se
  // estaría probando el caso que importa, que es un PIN bien formado y erróneo.
  const pinIncorrecto = pinDePrueba === '1000' ? '9999' : '1000';
  const conPinIncorrecto = controladorDeSalida.confirmarSalida(pinIncorrecto);

  // --- El BOTÓN de la barra de estado dispara el mismo flujo que el atajo ---
  const solicitudesAntesDelBoton = controladorDeSalida.solicitudesRecibidas();
  const botonEncontrado = (await ventana.webContents.executeJavaScript(`(() => {
    const boton = document.querySelector('[data-prueba="boton-salida"]');
    if (boton === null) { return false; }
    boton.click();
    return true;
  })()`)) as boolean;

  const botonPidioLaSalida = await esperarHasta(
    () => controladorDeSalida.solicitudesRecibidas() > solicitudesAntesDelBoton,
    ESPERA_MAXIMA_DEL_ATAJO_MS,
  );

  // Y el diálogo de PIN aparece de verdad en el DOM, no solo en el proceso
  // principal: se consulta el documento de la ventana real hasta que React lo
  // dibuja o se agota el tiempo.
  const dialogoVisible = await esperarDialogoDeSalida(ventana);

  // --- Un cierre directo (lo que hace Cmd+Q) queda interceptado ---
  const solicitudesAntesDelCierre = controladorDeSalida.solicitudesRecibidas();
  app.quit();
  const cierreDirectoInterceptado = await esperarHasta(
    () => controladorDeSalida.solicitudesRecibidas() > solicitudesAntesDelCierre,
    ESPERA_MAXIMA_DEL_ATAJO_MS,
  );
  // Si llegamos a esta línea, el app.quit() de arriba no cerró la aplicación.
  const siguiaViva = !controladorDeSalida.cierreEstaAutorizado();

  // El diagnóstico de la base se toma ANTES del cierre, mientras sigue abierta.
  const baseDeDatos = ejecutarDiagnostico({ incluirConteoDeRegistros: true });

  // Camino completo: el PIN correcto autoriza y dispara el cierre ordenado.
  // Es la misma ruta que recorrerá el administrador en la tienda.
  const conPinCorrecto = controladorDeSalida.confirmarSalida(pinDePrueba);

  const informe = {
    plataforma: process.platform,
    ventana: describirEstadoKiosko(ventana),
    bloqueos,
    salidaControlada: {
      atajo: describirAtajo(ATAJO_SALIDA_CONTROLADA, process.platform),
      atajoReconocidoEnEstaPlataforma: atajoReconocido,
      pinSolicitado: atajoReconocido,
      salidaConPinIncorrectoRechazada: !conPinIncorrecto.autorizado,
      motivoDelRechazo: conPinIncorrecto.codigo,
      salidaConPinCorrectoAutorizada: conPinCorrecto.autorizado,
    },
    botonDeSalidaEnLaInterfaz: {
      botonEncontrado,
      botonPidioLaSalida,
      dialogoDePinVisible: dialogoVisible,
    },
    cierreSinPin: {
      // Es la ruta por la que pasa Cmd+Q en macOS y Alt+F4 en Windows.
      cierreDirectoInterceptado,
      aplicacionSiguioViva: siguiaViva,
    },
    primerArranque: {
      requeriaConfiguracionInicial,
      administradorCreado: yaNoRequiereConfiguracion,
    },
    cierreOrdenado: ultimoCierre,
    baseDeDatos,
  };

  console.info(`${MARCA_INFORME}${JSON.stringify(informe)}`);

  // Red de seguridad: si por alguna razón el PIN correcto no cerró (por
  // ejemplo, porque esta instalación no tiene PIN configurado), se cierra igual
  // para que la verificación no deje un proceso colgado.
  cerrarAplicacionOrdenadamente();
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  // Red de seguridad: si la aplicación se cierra por una vía que no pasó por
  // el cierre ordenado (por ejemplo Cmd+Q en macOS), igual se libera todo.
  quitarManejadoresIpc();
  cerrarBaseDeDatos();
});
