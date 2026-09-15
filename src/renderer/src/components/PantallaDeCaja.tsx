/**
 * Apertura y cierre del turno de caja.
 *
 * LA PANTALLA CONSULTA EL ESTADO REAL ANTES DE DECIDIR QUÉ MOSTRAR. Son tres
 * estados posibles, y ninguno es un botón fijo:
 *
 *   1. No hay ninguna caja abierta EN EL SISTEMA → se ofrece abrir. La palabra
 *      «cerrar» no aparece en ninguna parte.
 *   2. Hay una caja abierta y la abrió quien está en sesión → se muestra el
 *      resumen del turno y se puede cerrar directo, sin ningún código.
 *   3. Hay una caja abierta y la abrió OTRA persona → se muestra quién y
 *      cuándo, y cerrarla exige el PIN de un administrador.
 *
 * Antes, el estado se preguntaba por USUARIO: la pantalla mostraba «Abrir
 * caja» a quien no la había abierto, aunque la caja estuviera abierta por otro
 * y el cajón de dinero fuera el mismo. Ahora se pregunta por el sistema.
 *
 * Hay DOS autorizaciones posibles y son distintas, con candados distintos:
 * cerrar una caja ajena (solo PIN normal de administrador) y cerrar con
 * diferencia (acepta también el código de la app de autenticación). Un mismo cierre puede necesitar
 * las dos, y en ese orden.
 *
 * TRES AGREGADOS DEL 2026-09-14, de lo que Jimmy encontró probando en el
 * equipo real (§4.39):
 *
 *   · Con la caja abierta se ve el EFECTIVO TEÓRICO en vivo —monto inicial más
 *     las ventas en efectivo del turno—, recalculado cada pocos segundos.
 *   · Un cierre exitoso termina en una CONFIRMACIÓN con los tres montos: el
 *     inicial, el teórico y el contado, y la diferencia si la hubo.
 *   · Un conteo confirmado con diferencia QUEDA SELLADO: si el cajero vuelve a
 *     contar y cambia el número, cerrar exige el PIN de un administrador
 *     aunque ahora cuadre. Lo decide el proceso principal, no esta pantalla:
 *     acá solo se muestra.
 *
 * Y UNA RESTRICCIÓN DEL MISMO DÍA (§4.40): cerrar la caja son DOS PASOS.
 *
 *   · RESUMEN — quién la abrió, desde cuándo, y el teórico en vivo SI el
 *     proceso principal lo mandó, que es solo para un administrativo. Para
 *     consultarlo durante el día.
 *   · CONTEO — donde se teclea el efectivo del cierre. Acá el teórico NO se
 *     dibuja PARA NADIE, administrador incluido: si quien cuenta ve el número
 *     que el sistema espera, puede copiarlo en vez de contar el cajón. Se
 *     revela recién en la confirmación, cuando el conteo ya quedó registrado.
 */

import { useCallback, useEffect, useState } from 'react';

import type {
  DenominacionParaContar,
  EfectivoDeclaradoIpc,
  ResultadoDeCierreIpc,
  TurnoAbierto,
} from '@shared/types/ipc';
import { formatearQuetzales } from '@shared/money';
import { LARGOS_DE_AUTORIZACION } from '@shared/pin';
import { CapturaDeEfectivo } from './CapturaDeEfectivo';
import { TecladoNumerico } from './TecladoNumerico';
import { llamarAlProcesoPrincipal } from './llamar-al-proceso-principal';

/**
 * Con la caja abierta, en qué paso del cierre está la pantalla.
 *
 * Son dos pasos y no uno con un dato escondido, para que el teórico NO ESTÉ
 * en el árbol de la pantalla mientras se cuenta: una fila con `hidden` sigue
 * ahí para quien inspeccione la ventana.
 */
type PasoDelCierre = 'resumen' | 'contando';

/** Qué está esperando la pantalla ahora mismo. */
type Autorizacion =
  | { readonly tipo: 'ninguna' }
  /** La caja la abrió otro: falta el PIN normal de un administrador. */
  | { readonly tipo: 'caja-ajena'; readonly resultado: ResultadoDeCierreIpc }
  /** La caja no cuadra: falta el código que autorice la diferencia. */
  | { readonly tipo: 'diferencia'; readonly resultado: ResultadoDeCierreIpc }
  /** Cuadra, pero antes se confirmó otro conteo con diferencia. */
  | { readonly tipo: 'reconteo'; readonly resultado: ResultadoDeCierreIpc }
  /**
   * El PIN de un administrador ya se validó y el proceso principal reveló lo
   * que se autoriza. La caja SIGUE ABIERTA hasta la segunda confirmación
   * (§4.40.5). `anterior` es el diálogo al que se vuelve si se cancela.
   */
  | {
      readonly tipo: 'revelada';
      readonly resultado: ResultadoDeCierreIpc;
      readonly anterior: DialogoConPin | null;
    };

/** Los dos diálogos que piden el PIN de la diferencia. */
interface DialogoConPin {
  readonly tipo: 'diferencia' | 'reconteo';
  readonly resultado: ResultadoDeCierreIpc;
}

/** El PIN fue correcto: el proceso principal revela el monto y espera. */
const CODIGO_AUTORIZACION_VALIDADA = 'AUTORIZACION_VALIDADA';

/**
 * Cada cuánto se vuelve a pedir el estado mientras la caja está abierta.
 *
 * Diez segundos: las ventas se cobran en otra pantalla de la misma terminal,
 * así que el teórico cambia recién cuando alguien vuelve acá. Consultar más
 * seguido no mostraría nada nuevo y es una lectura de SQLite cada vez.
 */
const INTERVALO_DE_ACTUALIZACION_MS = 10_000;

/** Un monto que puede no haber viajado: sin él se escribe una raya. */
function montoOSinDato(monto: string | null): string {
  return monto === null ? '—' : formatearQuetzales(monto);
}

/** «faltante de Q20.00» / «sobrante de Q5.00» / «sin diferencia». */
function diferenciaLegible(diferencia: string): string {
  if (Number(diferencia) === 0) {
    return 'sin diferencia';
  }
  const magnitud = formatearQuetzales(diferencia.replace('-', ''));
  return diferencia.startsWith('-') ? `faltante de ${magnitud}` : `sobrante de ${magnitud}`;
}

/** Fecha y hora en el formato que se lee en el mostrador. */
function momentoLegible(iso: string): string {
  const fecha = new Date(iso);
  return Number.isNaN(fecha.getTime())
    ? iso
    : fecha.toLocaleString('es-GT', { dateStyle: 'short', timeStyle: 'short' });
}

export function PantallaDeCaja({ alVolver }: { readonly alVolver: () => void }): React.JSX.Element {
  const [denominaciones, setDenominaciones] = useState<readonly DenominacionParaContar[]>([]);
  const [turno, setTurno] = useState<TurnoAbierto | null>(null);
  const [cargado, setCargado] = useState(false);
  const [efectivo, setEfectivo] = useState<EfectivoDeclaradoIpc | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const [recarga, setRecarga] = useState(0);

  const [autorizacion, setAutorizacion] = useState<Autorizacion>({ tipo: 'ninguna' });
  const [pin, setPin] = useState('');

  /** PIN ya verificado de la caja ajena, que hay que reenviar con el cierre. */
  const [pinDeCajaAjena, setPinDeCajaAjena] = useState<string | null>(null);

  /** El cierre que acaba de terminar bien, para confirmarlo con sus montos. */
  const [cierreConfirmado, setCierreConfirmado] = useState<ResultadoDeCierreIpc | null>(null);

  const [paso, setPaso] = useState<PasoDelCierre>('resumen');

  useEffect(() => {
    const control = new AbortController();
    void (async (): Promise<void> => {
      const respuesta = await llamarAlProcesoPrincipal(async () => window.pos.caja.estado());
      if (control.signal.aborted) {
        return;
      }
      if (respuesta.ok) {
        setDenominaciones(respuesta.datos.denominaciones);
        setTurno(respuesta.datos.turnoAbierto);
      } else {
        setMensaje(respuesta.error.mensaje);
      }
      setCargado(true);
    })();
    return (): void => {
      control.abort();
    };
  }, [recarga]);

  // Mientras la caja está abierta y se está mirando el RESUMEN, el teórico se
  // vuelve a pedir cada tanto: así se ve en vivo lo que entró por ventas.
  // Mientras se cuenta no: ahí no se dibuja, y no hay nada que refrescar.
  const cajaAbierta = turno !== null;
  const enReposo =
    autorizacion.tipo === 'ninguna' && cierreConfirmado === null && paso === 'resumen';
  useEffect(() => {
    if (!cajaAbierta || !enReposo) {
      return undefined;
    }
    const temporizador = setInterval(() => {
      setRecarga((anterior) => anterior + 1);
    }, INTERVALO_DE_ACTUALIZACION_MS);
    return (): void => {
      clearInterval(temporizador);
    };
  }, [cajaAbierta, enReposo]);

  const abrir = useCallback((): void => {
    if (efectivo === null) {
      return;
    }
    setTrabajando(true);
    void (async (): Promise<void> => {
      const respuesta = await llamarAlProcesoPrincipal(async () => window.pos.caja.abrir(efectivo));
      setTrabajando(false);
      if (!respuesta.ok) {
        setMensaje(respuesta.error.mensaje);
        return;
      }
      setMensaje(null);
      setEfectivo(null);
      setRecarga((anterior) => anterior + 1);
    })();
  }, [efectivo]);

  /**
   * Intenta cerrar. El proceso principal responde qué falta:
   * `REQUIERE_AUTORIZACION_DE_CAJA_AJENA` si la abrió otro, o
   * `REQUIERE_AUTORIZACION` si no cuadra. La pantalla no decide cuál hace
   * falta: pregunta y muestra lo que le contesten.
   */
  const cerrar = useCallback(
    (codigos: { readonly diferencia?: string; readonly cajaAjena?: string } = {}): void => {
      if (efectivo === null) {
        return;
      }
      setTrabajando(true);
      void (async (): Promise<void> => {
        const respuesta = await llamarAlProcesoPrincipal(async () =>
          window.pos.caja.cerrar(
            efectivo,
            codigos.diferencia,
            codigos.cajaAjena ?? pinDeCajaAjena ?? undefined,
          ),
        );
        setTrabajando(false);
        setPin('');

        if (!respuesta.ok) {
          setMensaje(respuesta.error.mensaje);
          return;
        }
        if (respuesta.datos.cerrada) {
          setMensaje(null);
          setAutorizacion({ tipo: 'ninguna' });
          setPinDeCajaAjena(null);
          setEfectivo(null);
          // No se recarga todavía: primero se confirma el cierre con sus montos.
          setCierreConfirmado(respuesta.datos);
          return;
        }

        if (respuesta.datos.codigo === CODIGO_AUTORIZACION_VALIDADA) {
          // El PIN fue correcto y NO se cerró nada: se muestra lo que se está
          // autorizando y se espera la confirmación explícita.
          const validada = respuesta.datos;
          setAutorizacion((previa) => ({
            tipo: 'revelada',
            resultado: validada,
            anterior: previa.tipo === 'diferencia' || previa.tipo === 'reconteo' ? previa : null,
          }));
          setMensaje(null);
          return;
        }

        if (respuesta.datos.codigo === 'REQUIERE_AUTORIZACION_DE_CAJA_AJENA') {
          setAutorizacion({ tipo: 'caja-ajena', resultado: respuesta.datos });
          setMensaje(null);
          return;
        }
        if (respuesta.datos.codigo === 'REQUIERE_AUTORIZACION') {
          // El PIN de caja ajena que ya se validó se recuerda para reenviarlo
          // junto con el de la diferencia: si no, el segundo paso volvería a
          // toparse con el primero y pediría los dos códigos en bucle.
          if (codigos.cajaAjena !== undefined) {
            setPinDeCajaAjena(codigos.cajaAjena);
          }
          setAutorizacion({ tipo: 'diferencia', resultado: respuesta.datos });
          setMensaje(null);
          return;
        }
        if (respuesta.datos.codigo === 'REQUIERE_AUTORIZACION_DE_RECONTEO') {
          if (codigos.cajaAjena !== undefined) {
            setPinDeCajaAjena(codigos.cajaAjena);
          }
          setAutorizacion({ tipo: 'reconteo', resultado: respuesta.datos });
          setMensaje(null);
          return;
        }

        // Un intento de autorización que falló: se muestra el motivo y se
        // conserva el diálogo para reintentar.
        setMensaje(respuesta.datos.mensaje);
      })();
    },
    [efectivo, pinDeCajaAjena],
  );

  /** Vuelve al diálogo del PIN, con un aviso. La caja sigue abierta. */
  const volverAlDialogo = useCallback((anterior: DialogoConPin | null, aviso: string): void => {
    setAutorizacion(anterior ?? { tipo: 'ninguna' });
    if (anterior === null) {
      setPaso('contando');
    }
    setPin('');
    setMensaje(aviso);
  }, []);

  /** Segunda confirmación: recién acá se cierra. */
  const confirmarCierreAutorizado = useCallback(
    (anterior: DialogoConPin | null): void => {
      if (efectivo === null) {
        return;
      }
      setTrabajando(true);
      void (async (): Promise<void> => {
        const respuesta = await llamarAlProcesoPrincipal(async () =>
          window.pos.caja.confirmarCierreAutorizado(efectivo),
        );
        setTrabajando(false);
        if (!respuesta.ok) {
          setMensaje(respuesta.error.mensaje);
          return;
        }
        if (respuesta.datos.cerrada) {
          setMensaje(null);
          setAutorizacion({ tipo: 'ninguna' });
          setPinDeCajaAjena(null);
          setEfectivo(null);
          setCierreConfirmado(respuesta.datos);
          return;
        }
        // La autorización ya no valía (venció, cambió el conteo o el monto):
        // se vuelve a pedir el PIN.
        volverAlDialogo(anterior, respuesta.datos.mensaje);
      })();
    },
    [efectivo, volverAlDialogo],
  );

  /**
   * Cancelar retira la autorización EN EL PROCESO PRINCIPAL. Solo cerrar el
   * cuadro la dejaría usable desde la consola durante dos minutos.
   */
  const cancelarCierreAutorizado = useCallback(
    (anterior: DialogoConPin | null): void => {
      setTrabajando(true);
      void (async (): Promise<void> => {
        const respuesta = await llamarAlProcesoPrincipal(async () =>
          window.pos.caja.cancelarAutorizacionDeCierre(),
        );
        setTrabajando(false);
        if (!respuesta.ok) {
          setMensaje(respuesta.error.mensaje);
          return;
        }
        volverAlDialogo(anterior, 'Se canceló la autorización. La caja sigue abierta.');
      })();
    },
    [volverAlDialogo],
  );

  const volverAContar = useCallback((): void => {
    setAutorizacion({ tipo: 'ninguna' });
    // Vuelve al paso de CONTEO, no al resumen: es lo que se pidió, y ahí el
    // teórico no se dibuja.
    setPaso('contando');
    // Se vuelve a pedir el estado: si el conteo quedó sellado, el aviso tiene
    // que aparecer ya, y lo trae el proceso principal.
    setRecarga((anterior) => anterior + 1);
    setPin('');
    setMensaje(null);
  }, []);

  // -------------------------------------------------------------------------
  // Diálogos de autorización
  // -------------------------------------------------------------------------

  if (autorizacion.tipo === 'caja-ajena' && turno !== null) {
    return (
      <div className="ingreso" data-prueba="pantalla-de-caja">
        <h1>Cerrar una caja ajena</h1>

        {mensaje !== null && (
          <p className="alerta" data-prueba="mensaje-de-caja">
            {mensaje}
          </p>
        )}

        <div className="autorizacion" data-prueba="autorizacion-de-caja-ajena">
          {/* Quien autoriza tiene que VER qué está aprobando, igual que con
              la diferencia: de quién es la caja y desde cuándo está abierta. */}
          <div className="autorizacion__resumen">
            <div className="dato">
              <span className="dato__etiqueta">La abrió</span>
              <span className="dato__valor" data-prueba="abierta-por">
                {turno.abiertaPorNombre}
              </span>
            </div>
            <div className="dato">
              <span className="dato__etiqueta">Desde</span>
              <span className="dato__valor">{momentoLegible(turno.abiertaEn)}</span>
            </div>
            <div className="dato">
              <span className="dato__etiqueta">Monto inicial</span>
              <span className="dato__valor">{formatearQuetzales(turno.montoInicial)}</span>
            </div>
          </div>

          <p className="subtitulo">
            Un administrador debe autorizar con su PIN, en persona. El PIN de autorización
            remota no sirve para esto.
          </p>

          <TecladoNumerico
            valor={pin}
            alCambiar={setPin}
            alConfirmar={() => {
              cerrar({ cajaAjena: pin });
            }}
            deshabilitado={trabajando}
          />

          <button type="button" className="boton--secundario" onClick={volverAContar}>
            Volver a contar
          </button>
        </div>
      </div>
    );
  }

  if (autorizacion.tipo === 'diferencia') {
    const resultado = autorizacion.resultado;
    // A quien no es administrativo el proceso principal le manda el esperado y
    // la diferencia en null (§4.40): con lo contado, cualquiera de los dos
    // revela el otro. La pantalla no decide por rol: dibuja lo que le llegó.
    const diferencia = resultado.diferencia;
    const conMontos = diferencia !== null && resultado.montoEsperado !== null;
    return (
      <div className="ingreso" data-prueba="pantalla-de-caja">
        <h1>Cerrar caja</h1>

        {mensaje !== null && (
          <p className="alerta" data-prueba="mensaje-de-caja">
            {mensaje}
          </p>
        )}

        <div className="autorizacion" data-prueba="autorizacion-de-diferencia">
          <h2>{conMontos ? 'La caja no cuadra' : 'El conteo necesita autorización'}</h2>

          {resultado.primerConteo !== null && (
            <p className="advertencia" data-prueba="primer-conteo-sellado">
              Antes se confirmó otro conteo: {formatearQuetzales(resultado.primerConteo.montoReal)}
              {resultado.primerConteo.diferencia !== null &&
                `, con ${diferenciaLegible(resultado.primerConteo.diferencia)}`}
              . Los dos quedan registrados.
            </p>
          )}

          {conMontos ? (
            <div className="autorizacion__resumen">
              <div className="dato">
                <span className="dato__etiqueta">Debería haber</span>
                {/* Solo le llega a un administrativo: es quien autoriza y tiene
                    que ver qué está aprobando (§4.9, §4.40). */}
                <span className="dato__valor">{montoOSinDato(resultado.montoEsperado)}</span>
              </div>
              <div className="dato">
                <span className="dato__etiqueta">Se contó</span>
                <span className="dato__valor">{formatearQuetzales(resultado.montoReal)}</span>
              </div>
              <div className="dato">
                <span className="dato__etiqueta">
                  {diferencia.startsWith('-') ? 'FALTANTE' : 'SOBRANTE'}
                </span>
                <span className="dato__valor autorizacion__diferencia" data-prueba="diferencia">
                  {formatearQuetzales(diferencia.replace('-', ''))}
                </span>
              </div>
            </div>
          ) : (
            <>
              <div className="autorizacion__resumen">
                <div className="dato">
                  <span className="dato__etiqueta">Se contó</span>
                  <span className="dato__valor">{formatearQuetzales(resultado.montoReal)}</span>
                </div>
              </div>
              <p className="advertencia" data-prueba="diferencia-sin-monto">
                Este cierre tiene una diferencia registrada. Un administrador tiene que
                autorizarlo.
              </p>
            </>
          )}

          <p className="subtitulo">
            Un administrador debe autorizar el cierre con su PIN en persona, o dictando por
            teléfono el código de seis dígitos de su aplicación.
          </p>

          <TecladoNumerico
            valor={pin}
            alCambiar={setPin}
            alConfirmar={() => {
              cerrar({ diferencia: pin });
            }}
            deshabilitado={trabajando}
            largos={LARGOS_DE_AUTORIZACION}
          />

          <button type="button" className="boton--secundario" onClick={volverAContar}>
            Volver a contar
          </button>
        </div>
      </div>
    );
  }

  if (autorizacion.tipo === 'reconteo') {
    const resultado = autorizacion.resultado;
    const primero = resultado.primerConteo;
    const diferenciaDelPrimero = primero?.diferencia ?? null;
    const esperadoEntonces = primero?.montoEsperado ?? null;
    return (
      <div className="ingreso" data-prueba="pantalla-de-caja">
        <h1>Cerrar caja</h1>

        {mensaje !== null && (
          <p className="alerta" data-prueba="mensaje-de-caja">
            {mensaje}
          </p>
        )}

        <div className="autorizacion" data-prueba="autorizacion-de-reconteo">
          <h2>Este turno ya tuvo un conteo con diferencia</h2>

          {/* Quien autoriza ve los DOS conteos Y los dos esperados: lo que pide
              el PIN puede ser que cambió lo contado, que cambió lo que el
              sistema espera (una venta en el medio) o las dos cosas, y son
              causas distintas (corregido el 2026-09-15). Este diálogo solo lo
              ve un administrativo: a otro rol el código llega como una
              autorización común (§4.40.3). */}
          <div className="autorizacion__resumen">
            <div className="dato">
              <span className="dato__etiqueta">Primer conteo</span>
              <span className="dato__valor" data-prueba="reconteo-primer-conteo">
                {primero === null ? '—' : formatearQuetzales(primero.montoReal)}
              </span>
            </div>
            <div className="dato">
              <span className="dato__etiqueta">Con</span>
              <span className="dato__valor">
                {diferenciaDelPrimero === null ? '—' : diferenciaLegible(diferenciaDelPrimero)}
              </span>
            </div>
            <div className="dato">
              <span className="dato__etiqueta">Esperado entonces</span>
              <span className="dato__valor" data-prueba="reconteo-esperado-entonces">
                {esperadoEntonces === null ? '—' : formatearQuetzales(esperadoEntonces)}
              </span>
            </div>
            <div className="dato">
              <span className="dato__etiqueta">Conteo de ahora</span>
              <span className="dato__valor" data-prueba="reconteo-conteo-actual">
                {formatearQuetzales(resultado.montoReal)}
                {resultado.diferencia !== null && ` (${diferenciaLegible(resultado.diferencia)})`}
              </span>
            </div>
            <div className="dato">
              <span className="dato__etiqueta">Esperado ahora</span>
              <span className="dato__valor" data-prueba="reconteo-esperado-ahora">
                {resultado.montoEsperado === null ? '—' : formatearQuetzales(resultado.montoEsperado)}
              </span>
            </div>
          </div>

          {/* El motivo lo arma el proceso principal: dice si cambió lo contado,
              lo esperado o las dos cosas. */}
          <p className="subtitulo" data-prueba="reconteo-motivo">
            {resultado.mensaje}
          </p>
          <p className="subtitulo">
            Puede autorizar con su PIN en persona, o dictando por teléfono el código de seis
            dígitos de su aplicación. Los conteos quedan registrados.
          </p>

          <TecladoNumerico
            valor={pin}
            alCambiar={setPin}
            alConfirmar={() => {
              cerrar({ diferencia: pin });
            }}
            deshabilitado={trabajando}
            largos={LARGOS_DE_AUTORIZACION}
          />

          <button type="button" className="boton--secundario" onClick={volverAContar}>
            Volver a contar
          </button>
        </div>
      </div>
    );
  }

  if (autorizacion.tipo === 'revelada') {
    const resultado = autorizacion.resultado;
    const diferencia = resultado.diferencia ?? '0.00';
    const cuadraAhora = Number(diferencia) === 0;
    const anterior = autorizacion.anterior;
    return (
      <div className="ingreso" data-prueba="pantalla-de-caja">
        <h1>Cerrar caja</h1>

        {mensaje !== null && (
          <p className="alerta" data-prueba="mensaje-de-caja">
            {mensaje}
          </p>
        )}

        {/* El mismo patrón de «esto es lo que estás autorizando» del descuento
            excedente y de la diferencia, con el orden invertido: el PIN ya
            probó que quien mira es un administrador, y recién ahora se ve el
            monto. Nada se cerró todavía (§4.40.5). */}
        <div className="autorizacion" data-prueba="revelacion-de-autorizacion">
          <h2>Esto es lo que se está autorizando</h2>
          <p className="subtitulo" data-prueba="revelacion-quien-autoriza">
            {resultado.mensaje}
          </p>

          {resultado.primerConteo !== null && (
            <p className="advertencia" data-prueba="revelacion-primer-conteo">
              Antes se confirmó otro conteo: {formatearQuetzales(resultado.primerConteo.montoReal)}
              {resultado.primerConteo.diferencia !== null &&
                `, con ${diferenciaLegible(resultado.primerConteo.diferencia)}`}
              . Los dos quedan registrados.
            </p>
          )}

          <div className="autorizacion__resumen">
            <div className="dato">
              <span className="dato__etiqueta">Debería haber</span>
              <span className="dato__valor" data-prueba="revelacion-esperado">
                {montoOSinDato(resultado.montoEsperado)}
              </span>
            </div>
            <div className="dato">
              <span className="dato__etiqueta">Se contó</span>
              <span className="dato__valor">{formatearQuetzales(resultado.montoReal)}</span>
            </div>
            <div className="dato">
              <span className="dato__etiqueta">
                {cuadraAhora ? 'Diferencia' : diferencia.startsWith('-') ? 'FALTANTE' : 'SOBRANTE'}
              </span>
              <span
                className={cuadraAhora ? 'dato__valor' : 'dato__valor autorizacion__diferencia'}
                data-prueba="revelacion-diferencia"
              >
                {cuadraAhora ? 'sin diferencia' : formatearQuetzales(diferencia.replace('-', ''))}
              </span>
            </div>
          </div>

          <p className="advertencia" data-prueba="revelacion-caja-abierta">
            La caja todavía NO se cerró. Se cierra recién al confirmar.
          </p>

          <div className="pie">
            <button
              type="button"
              data-prueba="confirmar-cierre-autorizado"
              disabled={trabajando}
              onClick={() => {
                confirmarCierreAutorizado(anterior);
              }}
            >
              Sí, cerrar la caja
            </button>
            <button
              type="button"
              className="boton--secundario"
              data-prueba="cancelar-cierre-autorizado"
              disabled={trabajando}
              onClick={() => {
                cancelarCierreAutorizado(anterior);
              }}
            >
              Cancelar
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (cierreConfirmado !== null) {
    // Una caja cerrada viaja entera a cualquier rol (§4.40); el null solo se
    // contempla para no afirmar que cuadró sin tener el dato.
    const diferenciaDelCierre = cierreConfirmado.diferencia ?? '0.00';
    const hubo = Number(diferenciaDelCierre) !== 0;
    return (
      <div className="ingreso" data-prueba="pantalla-de-caja">
        <div className="autorizacion" role="status" data-prueba="confirmacion-de-cierre">
          <h1>Caja cerrada con éxito</h1>

          <div className="autorizacion__resumen">
            <div className="dato">
              <span className="dato__etiqueta">Efectivo inicial</span>
              <span className="dato__valor" data-prueba="cierre-efectivo-inicial">
                {formatearQuetzales(cierreConfirmado.montoInicial)}
              </span>
            </div>
            <div className="dato">
              <span className="dato__etiqueta">Efectivo teórico</span>
              <span className="dato__valor" data-prueba="cierre-efectivo-teorico">
                {montoOSinDato(cierreConfirmado.montoEsperado)}
              </span>
            </div>
            <div className="dato">
              <span className="dato__etiqueta">Efectivo final</span>
              <span className="dato__valor" data-prueba="cierre-efectivo-final">
                {formatearQuetzales(cierreConfirmado.montoReal)}
              </span>
            </div>
            {hubo && (
              <div className="dato">
                <span className="dato__etiqueta">
                  {diferenciaDelCierre.startsWith('-') ? 'Faltante' : 'Sobrante'}
                </span>
                <span
                  className="dato__valor autorizacion__diferencia"
                  data-prueba="cierre-diferencia"
                >
                  {formatearQuetzales(diferenciaDelCierre.replace('-', ''))}
                </span>
              </div>
            )}
          </div>

          <p className="subtitulo">
            {hubo
              ? `Se cerró con ${diferenciaLegible(diferenciaDelCierre)}, autorizado por un administrador.`
              : 'La caja cuadró exactamente.'}
          </p>

          <div className="pie">
            <button
              type="button"
              data-prueba="aceptar-confirmacion-de-cierre"
              onClick={() => {
                setCierreConfirmado(null);
                setPaso('resumen');
                setRecarga((anterior) => anterior + 1);
              }}
            >
              Aceptar
            </button>
          </div>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Los tres estados de la caja
  // -------------------------------------------------------------------------

  if (!cargado) {
    return (
      <div className="ingreso" data-prueba="pantalla-de-caja">
        <p className="pendiente">Consultando el estado de la caja…</p>
      </div>
    );
  }

  const conteoSelladoDelTurno = turno?.primerConteoSellado ?? null;
  const esAjena = turno?.esDeOtroUsuario === true;

  const avisos = (
    <>
      {turno !== null && esAjena && (
        <div className="advertencia" data-prueba="aviso-de-caja-ajena">
          {/* Dicho para quien la tiene delante, aunque sea administrador: el PIN
              se pide igual (§4.9), y se pide DESPUÉS de contar. Sin la segunda
              frase, un administrador buscaba dónde teclear el PIN antes de
              contar y no lo encontraba. */}
          <p className="advertencia__principal">
            Esta caja la abrió <strong>{turno.abiertaPorNombre}</strong>. Vas a necesitar el
            PIN de un administrador para cerrarla.
          </p>
          <p data-prueba="aviso-de-caja-ajena-pasos">
            Primero contás el efectivo; al tocar «Cerrar turno» se pide el PIN. Si sos
            administrador, sirve el tuyo.
          </p>
        </div>
      )}

      {mensaje !== null && (
        <p className="alerta" data-prueba="mensaje-de-caja">
          {mensaje}
        </p>
      )}
    </>
  );

  // Estado 1: no hay ninguna caja abierta en todo el sistema. Se cuenta el
  // fondo de apertura; no hay teórico que mostrar ni que esconder.
  if (turno === null) {
    return (
      <div className="ingreso" data-prueba="pantalla-de-caja">
        <h1>Abrir caja</h1>
        <p className="subtitulo" data-prueba="estado-sin-caja">
          No hay ninguna caja abierta. Contá el fondo con el que arranca el turno.
        </p>

        {avisos}

        <CapturaDeEfectivo
          denominaciones={denominaciones}
          alCambiar={setEfectivo}
          deshabilitado={trabajando}
          alConfirmar={abrir}
        />

        <div className="pie">
          <button
            type="button"
            data-prueba="confirmar-caja"
            disabled={efectivo === null || trabajando}
            onClick={abrir}
          >
            Abrir turno
          </button>
          <button type="button" className="boton--secundario" onClick={alVolver}>
            Volver
          </button>
        </div>
      </div>
    );
  }

  // Estados 2 y 3, paso de CONTEO. NI el teórico NI las ventas en efectivo se
  // dibujan acá, para NINGÚN rol: aunque el proceso principal se los haya
  // mandado a un administrativo, este paso no los lee.
  if (paso === 'contando') {
    return (
      <div className="ingreso" data-prueba="pantalla-de-caja">
        <h1>Cerrar caja</h1>
        <p className="subtitulo" data-prueba="paso-de-conteo">
          Contá el efectivo que hay en el cajón. El monto que el sistema espera se muestra
          después de confirmar el conteo.
        </p>

        <div
          className="autorizacion__resumen"
          data-prueba={esAjena ? 'estado-caja-ajena' : 'estado-caja-propia'}
        >
          <div className="dato">
            <span className="dato__etiqueta">La abrió</span>
            <span className="dato__valor" data-prueba="abierta-por">
              {esAjena ? turno.abiertaPorNombre : 'Vos'}
            </span>
          </div>
          <div className="dato">
            <span className="dato__etiqueta">Desde</span>
            <span className="dato__valor">{momentoLegible(turno.abiertaEn)}</span>
          </div>
        </div>

        {conteoSelladoDelTurno !== null && (
          <p className="advertencia" data-prueba="aviso-de-conteo-sellado">
            A las {momentoLegible(conteoSelladoDelTurno.fecha)} se confirmó un conteo de{' '}
            {formatearQuetzales(conteoSelladoDelTurno.montoReal)}, y quedó registrado. Si ahora
            contás otro número, cerrar va a necesitar la autorización de un administrador
            aunque cuadre.
          </p>
        )}

        {avisos}

        <CapturaDeEfectivo
          denominaciones={denominaciones}
          alCambiar={setEfectivo}
          deshabilitado={trabajando}
          alConfirmar={() => {
            cerrar();
          }}
        />

        <div className="pie">
          <button
            type="button"
            data-prueba="confirmar-caja"
            disabled={efectivo === null || trabajando}
            onClick={() => {
              cerrar();
            }}
          >
            {esAjena ? 'Cerrar turno (requiere autorización)' : 'Cerrar turno'}
          </button>
          <button
            type="button"
            className="boton--secundario"
            data-prueba="volver-al-resumen"
            onClick={() => {
              setPaso('resumen');
              setEfectivo(null);
              setMensaje(null);
              setRecarga((anterior) => anterior + 1);
            }}
          >
            Volver
          </button>
        </div>
      </div>
    );
  }

  // Estados 2 y 3, paso de RESUMEN. El teórico se dibuja solo si viajó, y
  // viaja solo para un administrativo: la pantalla no decide el rol.
  const hayTeorico = turno.montoTeorico !== null;

  return (
    <div className="ingreso" data-prueba="pantalla-de-caja">
      <h1>Caja abierta</h1>

      <div
        className="autorizacion__resumen"
        data-prueba={esAjena ? 'estado-caja-ajena' : 'estado-caja-propia'}
      >
        <div className="dato">
          <span className="dato__etiqueta">La abrió</span>
          <span className="dato__valor" data-prueba="abierta-por">
            {esAjena ? turno.abiertaPorNombre : 'Vos'}
          </span>
        </div>
        <div className="dato">
          <span className="dato__etiqueta">Desde</span>
          <span className="dato__valor">{momentoLegible(turno.abiertaEn)}</span>
        </div>
        <div className="dato">
          <span className="dato__etiqueta">Monto inicial</span>
          <span className="dato__valor">{formatearQuetzales(turno.montoInicial)}</span>
        </div>
        {hayTeorico && (
          <>
            <div className="dato">
              <span className="dato__etiqueta">
                Ventas en efectivo ({turno.cantidadDeVentasEnEfectivo ?? 0})
              </span>
              <span className="dato__valor" data-prueba="ventas-en-efectivo">
                {montoOSinDato(turno.ventasEnEfectivo)}
              </span>
            </div>
            <div className="dato">
              <span className="dato__etiqueta">Efectivo teórico ahora</span>
              <span className="dato__valor" data-prueba="monto-teorico">
                {montoOSinDato(turno.montoTeorico)}
              </span>
            </div>
          </>
        )}
      </div>

      {hayTeorico && (
        <p className="subtitulo" data-prueba="nota-del-teorico">
          El teórico es para consultar durante el día. Al contar para cerrar no se muestra.
        </p>
      )}

      {conteoSelladoDelTurno !== null && (
        <p className="advertencia" data-prueba="aviso-de-conteo-sellado">
          A las {momentoLegible(conteoSelladoDelTurno.fecha)} se confirmó un conteo de{' '}
          {formatearQuetzales(conteoSelladoDelTurno.montoReal)}, y quedó registrado.
        </p>
      )}

      {avisos}

      <div className="pie">
        <button
          type="button"
          data-prueba="ir-a-contar"
          onClick={() => {
            setMensaje(null);
            setEfectivo(null);
            setPaso('contando');
          }}
        >
          Contar para cerrar
        </button>
        <button type="button" className="boton--secundario" onClick={alVolver}>
          Volver
        </button>
      </div>
    </div>
  );
}
